"""Read bank statement rows from PDF and XLSX, retaining original-byte provenance."""
from bisect import bisect_right
from collections import Counter
from contextlib import closing
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import re
from time import monotonic
from zipfile import BadZipFile, ZipFile
from xml.etree.ElementTree import ParseError as XMLParseError

from defusedxml.common import DefusedXmlException
import msoffcrypto
from msoffcrypto.exceptions import DecryptionError, FileFormatError, InvalidKeyError, ParseError
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.xml.functions import fromstring
import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import PdfminerException
from pdfplumber.utils import cluster_objects

from .document_intake import ocr_pdf_word_band
from .ingestion import json_row, node
from .limits import ResourceLimitError, check
from .store import uid


STATEMENT_DATASET = 'bank-statement'
METHOD = 'bank-statement-row'
MAX_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 200
MAX_COLUMNS = 48
NO_PDF_TEXT = 'No usable text found on this PDF page'
UNKNOWN_PDF_TABLE = 'PDF text found, but no supported transaction table recognized on this page'
OLE_SIGNATURE = bytes.fromhex('D0CF11E0A1B11AE1')
TEXT_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'text'}
HYBRID_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'lines'}
CURRENCIES = {'INR', 'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF'}

HEADER_ALIASES = {
    'date': ('transaction date', 'txn date', 'tran date', 'time utc', 'date', 'posting date', 'booking date',
             'post date', 'value date'),
    'debit': ('debit', 'debit amt', 'debit amount', 'withdrawal', 'withdrawal amt', 'withdrawal amount', 'paid', 'money out'),
    'credit': ('credit', 'credit amt', 'credit amount', 'deposit', 'deposit amt', 'deposit amount', 'received', 'money in'),
    'amount': ('amount', 'transaction amount', 'txn amount', 'signed amount'),
    'direction': ('direction', 'type', 'debit credit', 'debit or credit', 'dr cr', 'cr dr', 'transaction type'),
    'currency': ('currency', 'ccy', 'iso currency'),
}
HEADER_DIAGNOSTIC_LABELS = ('value date', 'post date', 'posting date', 'transaction date', 'date', 'details',
                            'narration', 'ref no', 'cheque no', 'debit', 'credit', 'withdrawal', 'deposit',
                            'amount', 'balance')
NUMERIC_DATE = re.compile(r'[0-9]{1,4}([./-])[0-9]{1,2}\1[0-9]{2,4}')


class StatementPasswordError(ValueError):
    pass


def cell_text(value):
    # Preserve whitespace in the evidence. Matching and value parsing normalize their own inputs.
    if value is None:
        return ''
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def header_key(value):
    # Some bank PDFs render a currency symbol but expose only a font CID in extracted text.
    value = re.sub(r'\(cid:\d+\)', ' ', value, flags=re.IGNORECASE)
    value = re.sub(r'[^a-z0-9]+', ' ', value.casefold()).strip()
    return re.sub(r'^(?:inr|rs|usd|gbp|eur) | (?:inr|rs|usd|gbp|eur)$', '', value)


def header_map(cells):
    keys = [header_key(cell) for cell in cells]
    columns = {}
    for name, aliases in HEADER_ALIASES.items():
        # Prefer the more specific date column when the statement includes
        # both a booking date and a transaction date.
        priority = [keys.index(alias) for alias in aliases if keys.count(alias) == 1]
        if priority:
            columns[name] = priority[0]
    if 'date' in columns and ({'debit', 'credit'} <= columns.keys() or 'amount' in columns):
        return columns
    return None


def matched_rows(rows, location):
    headers = columns = None
    for row_number, values, bounds in rows:
        cells = [cell_text(value) for value in values]
        if not any(cell.strip() for cell in cells):
            continue
        next_columns = header_map(cells)
        if next_columns is not None:
            headers, columns = cells, next_columns
            continue
        if headers is not None:
            locator = {**location, 'row': row_number}
            if bounds is not None:
                locator.update(bbox=list(bounds), bbox_units='points', bbox_origin='top-left')
            yield locator, headers, cells, columns


def positioned_header_groups(line, gap=6):
    groups = []
    for word in sorted(line, key=lambda word: word['x0']):
        if not groups or word['x0'] - groups[-1][2] >= gap:
            groups.append((word['text'], word['x0'], word['x1']))
        else:
            label, left, right = groups[-1]
            groups[-1] = (label + ' ' + word['text'], left, max(right, word['x1']))
    return groups


def wrapped_header_groups(upper, lower, gap):
    if min(word['top'] for word in lower) - max(word['bottom'] for word in upper) > 10:
        return []
    if any(re.search(r'\d', header_key(word['text'])) for word in (*upper, *lower)):
        return []
    first, second = positioned_header_groups(upper, gap), positioned_header_groups(lower, gap)
    if header_map([label for label, _, _ in second]):
        return []
    joined = list(first)
    used = set()
    for label, left, right in second:
        matches = [i for i, (_, start, end) in enumerate(first) if left < end and right > start]
        if not matches:
            joined.append((label, left, right))
            continue
        if len(matches) > 1 or matches[0] in used:
            return []
        index = matches[0]
        used.add(index)
        top_label, start, end = first[index]
        joined[index] = (top_label + ' ' + label, min(start, left), max(end, right))
    return sorted(joined, key=lambda group: group[1]) if used else []


def positioned_header(lines, index, gap):
    groups = positioned_header_groups(lines[index], gap)
    labels = [label for label, _, _ in groups]
    if mapping := header_map(labels):
        return groups, labels, mapping, 1
    if index + 1 < len(lines):
        groups = wrapped_header_groups(lines[index], lines[index + 1], gap)
        labels = [label for label, _, _ in groups]
        if mapping := header_map(labels):
            return groups, labels, mapping, 2
    return None


def positioned_boundaries(groups, rules=()):
    boundaries = []
    for left, right in zip(groups, groups[1:]):
        midpoint = (left[2] + right[1]) / 2
        separators = [x for x in rules if left[2] < x < right[1]]
        boundaries.append(min(separators, key=lambda x: abs(x - midpoint), default=midpoint))
    return boundaries


def positioned_row(page, encrypted, layout, row_number, words, boundaries, headers, columns):
    words = sorted(words, key=lambda word: word['x0'])
    cells = [[] for _ in headers]
    for word in words:
        column = bisect_right(boundaries, (word['x0'] + word['x1']) / 2)
        cells[column].append(word['text'])
    locator = {
        'format': 'pdf', 'page': page.page_number, 'table': 1, 'row': row_number,
        'layout': layout, 'encrypted': encrypted, 'bbox_units': 'points', 'bbox_origin': 'top-left',
        'bbox': [words[0]['x0'], min(word['top'] for word in words),
                 max(word['x1'] for word in words), max(word['bottom'] for word in words)],
    }
    return locator, headers, [' '.join(value) for value in cells], columns


def positioned_pdf_rows(page, encrypted, lines, *, wrapped_only=False, gap=6):
    """Use whitespace between a recognized header's columns on a borderless page."""
    headers = columns = None
    boundaries = []
    skip_line = 0
    for line_number, line in enumerate(lines, 1):
        if line_number == skip_line:
            continue
        if header := positioned_header(lines, line_number - 1, gap):
            groups, labels, mapping, size = header
            if wrapped_only and headers is None and size == 1:
                continue
            headers, columns = labels, mapping
            skip_line = line_number + size - 1
            boundaries = positioned_boundaries(groups)
            continue
        if headers is None:
            continue
        layout = 'aligned-text' if gap == 6 else 'aligned-text-tight'
        yield positioned_row(page, encrypted, layout, line_number, line, boundaries, headers, columns)


def ocr_header_bands(page, lines):
    _, page_top, _, page_bottom = page.cropbox
    for index, line in enumerate(lines):
        leading = sorted(line, key=lambda word: word['x0'])[:2]
        if len(leading) == 2 and all(NUMERIC_DATE.fullmatch(word['text']) for word in leading):
            top = min(word['top'] for word in leading)
            yield max(page_top, top - 120), top - 1, index, 'ocr-header'
            break
    yield page_top, page_bottom, 0, 'ocr-header-scan'


def pdf_rows_with_ocr_header(page, encrypted, lines, deadline):
    if not lines:
        return
    bands = list(ocr_header_bands(page, lines))
    for top, bottom, body_start, layout in bands:
        try:
            words = ocr_pdf_word_band(page, top, bottom, deadline)
        except FileNotFoundError as exc:
            if len(bands) > 1:
                raise ValueError('The statement may have image-only headings, but local OCR is unavailable') from exc
            return
        header_lines = cluster_objects(words, 'top', 3)
        for index, line in enumerate(header_lines):
            header = positioned_header(header_lines, index, 6)
            if not header or not {'debit', 'credit'} <= header[2].keys():
                continue
            groups, labels, columns, size = header
            header_top = min(word['top'] for word in line)
            header_bottom = max(word['bottom'] for part in header_lines[index:index + size] for word in part)
            rules = [edge['x0'] for edge in page.vertical_edges if edge['top'] <= header_top <= edge['bottom']]
            boundaries = positioned_boundaries(groups, rules)
            # Only the original PDF text below the heading can become transaction cells.
            first_row = len(header_lines) + 1 if layout == 'ocr-header' else 1
            found = False
            for row_number, body_line in enumerate(lines[body_start:], first_row):
                if min(word['top'] for word in body_line) <= header_bottom:
                    continue
                found = True
                yield positioned_row(page, encrypted, layout, row_number, body_line, boundaries, labels, columns)
            if found:
                return


def header_signals(lines):
    # Return only known labels from the best-looking line. Never echo arbitrary PDF text.
    labels = []
    for line in lines:
        raw = ' '.join(word['text'] for word in sorted(line, key=lambda word: word['x0']))
        text = ' ' + header_key(raw) + ' '
        matches = [label for label in HEADER_DIAGNOSTIC_LABELS if f' {label} ' in text]
        found = [label for label in matches if not any(label in longer for longer in matches if longer != label)]
        if len(found) > len(labels):
            labels = found
    return labels if len(labels) >= 2 else []


def pdf_table_rows(page, encrypted, strategy, settings):
    for index, table in enumerate(page.find_tables(settings), 1):
        rows = ((i, cells, table.rows[i-1].bbox) for i, cells in enumerate(table.extract(), 1))
        location = {'format': 'pdf', 'page': page.page_number, 'table': index,
                    'layout': strategy, 'encrypted': encrypted}
        yield from matched_rows(rows, location)


def pdf_statement_rows(content, password, page_range):
    deadline = monotonic() + 60
    with pdfplumber.open(BytesIO(content), password=password or '') as pdf:
        total = len(pdf.pages)
        if not total:
            raise ValueError('The statement PDF has no pages')
        start, end = page_range or (1, total)
        if end > total:
            raise ValueError(f'The statement PDF has {total} pages. Choose a page or range within the document.')
        if end - start + 1 > MAX_PDF_PAGES:
            raise ResourceLimitError(f'A statement import can read up to {MAX_PDF_PAGES} PDF pages. Enter a smaller page range.')
        encrypted = bool(pdf.doc.encryption)
        for page in pdf.pages[start - 1:end]:
            try:
                lines = cluster_objects(page.extract_words(), 'top', 3)
                first_rejected_layout = []
                for rows in (
                    pdf_table_rows(page, encrypted, 'ruled', {}),
                    pdf_table_rows(page, encrypted, 'mixed', HYBRID_TABLE),
                    # The text-table heuristic can mistake the lower half of a header for the whole table.
                    positioned_pdf_rows(page, encrypted, lines, wrapped_only=True),
                    pdf_table_rows(page, encrypted, 'text', TEXT_TABLE),
                    positioned_pdf_rows(page, encrypted, lines),
                    positioned_pdf_rows(page, encrypted, lines, gap=4),
                    pdf_rows_with_ocr_header(page, encrypted, lines, deadline),
                ):
                    pending = []
                    for row in rows:
                        pending.append(row)
                        check(len(pending), 'IMPORT_RECORDS', 5000)
                        _, _, cells, columns = row
                        date_column = columns['date']
                        if date_column >= len(cells) or not plausible_date(cells[date_column]):
                            continue
                        yield from pending
                        yield from rows
                        break
                    else:
                        if not first_rejected_layout:
                            first_rejected_layout = pending
                        continue
                    break
                else:
                    if first_rejected_layout:
                        yield from first_rejected_layout
                        continue
                    diagnostic = UNKNOWN_PDF_TABLE if lines else NO_PDF_TEXT
                    location = {'format': 'pdf', 'page': page.page_number, 'encrypted': encrypted,
                                'diagnostic': diagnostic}
                    if labels := header_signals(lines):
                        location['header_signals'] = labels
                    yield location, None, None, None
            finally:
                page.close()


def unlock_workbook(content, password, output):
    with BytesIO(content) as original:
        document = msoffcrypto.OfficeFile(original)
        if document.format != 'ooxml' or not document.is_encrypted():
            raise ValueError('Upload an Excel .xlsx workbook')
        if not password:
            raise StatementPasswordError('This Excel workbook requires its password')
        document.load_key(password=password, verify_password=True)
        document.decrypt(output, verify_integrity=True)
        output.seek(0)


def excel_statement_rows(content, password):
    encrypted = content.startswith(OLE_SIGNATURE)
    with BytesIO() if encrypted else BytesIO(content) as workbook_bytes:
        if encrypted:
            unlock_workbook(content, password, workbook_bytes)
        with ZipFile(workbook_bytes) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(item.file_size for item in entries) > 64 * 1024 * 1024:
                raise ResourceLimitError('Expanded Excel workbook exceeds the processing limit')
            if 'xl/workbook.xml' not in archive.namelist():
                raise ValueError('Upload an Excel .xlsx workbook')
            # Validate the workbook descriptor with the same protected XML reader used by openpyxl.
            fromstring(archive.read('xl/workbook.xml'))
        workbook_bytes.seek(0)
        workbook = load_workbook(workbook_bytes, read_only=True, data_only=True, keep_links=False)
        try:
            if len(workbook.worksheets) > 10:
                raise ResourceLimitError('Excel workbook contains more than 10 worksheets')
            scanned = 0
            for sheet in workbook.worksheets:
                if sheet.max_column and sheet.max_column > MAX_COLUMNS:
                    raise ResourceLimitError('Excel statement exceeds 48 columns')
                location = {'format': 'xlsx', 'sheet': sheet.title, 'encrypted': encrypted}

                def rows():
                    nonlocal scanned
                    for number, cells in enumerate(sheet.values, 1):
                        scanned += 1
                        if scanned > 15_000 or len(cells) > MAX_COLUMNS:
                            raise ResourceLimitError('Excel statement exceeds worksheet scanning limits')
                        yield number, cells, None

                yield from matched_rows(rows(), location)
        finally:
            workbook.close()


def statement_rows(content, password, *, page_range=None):
    """Yield raw row locators and fields. Decrypted workbook buffers close on return."""
    if content.startswith(b'%PDF-'):
        rows = pdf_statement_rows(content, password, page_range)
    elif content.startswith((OLE_SIGNATURE, b'PK\x03\x04')):
        if page_range is not None:
            raise ValueError('Page ranges are only available for PDF statements')
        rows = excel_statement_rows(content, password)
    else:
        raise ValueError('Upload a bank statement in PDF or Excel .xlsx format')
    try:
        with closing(rows):
            for count, row in enumerate(rows, 1):
                check(count, 'IMPORT_RECORDS', 5000)
                yield row
    except PDFPasswordIncorrect:
        raise StatementPasswordError('This PDF requires the correct password') from None
    except PdfminerException as exc:
        if isinstance(exc.__cause__ or exc.__context__, PDFPasswordIncorrect):
            raise StatementPasswordError('This PDF requires the correct password') from None
        raise ValueError('The PDF statement could not be read') from None
    except (InvalidKeyError, DecryptionError):
        raise StatementPasswordError('The Excel workbook could not be unlocked with that password') from None
    except (BadZipFile, InvalidFileException, FileFormatError, ParseError, OSError,
            XMLParseError, DefusedXmlException):
        raise ValueError('The statement could not be opened. Check the file format and password.') from None


def parse_date(value, date_order):
    value = ' '.join(value.split())
    value = re.sub(r'(?<=\d)\s*([./-])\s*(?=\d)', r'\1', value)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        for separator in ('/', '-', '.'):
            fields = '%d{0}%m' if date_order == 'DMY' else '%m{0}%d'
            for year in ('%Y', '%y'):
                try:
                    parsed = datetime.strptime(value, fields.format(separator) + separator + year)
                    break
                except ValueError:
                    continue
            else:
                continue
            break
        else:
            for pattern in ('%d %b %Y', '%d-%b-%Y', '%d %b %y', '%d-%b-%y', '%d %B %Y', '%d-%B-%Y'):
                try:
                    parsed = datetime.strptime(value, pattern)
                    break
                except ValueError:
                    continue
            else:
                raise ValueError('Invalid transaction date; check the selected date order') from None
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).isoformat(), 'explicit_UTC'
    return datetime.combine(parsed.date(), datetime.min.time(), timezone.utc).isoformat(), 'date_only'


def plausible_date(value):
    for order in ('DMY', 'MDY'):
        try:
            parse_date(value, order)
            return True
        except (ValueError, OverflowError):
            continue
    return False


def parse_amount(value, currency):
    value = value.strip().replace('−', '-')
    if not value or value in {'–', '—', '-'}:
        return Decimal(0)
    prefix = re.match(r'^(₹|Rs\.?|[A-Za-z]{3})\s*(?=[+\-\d(])', value, re.IGNORECASE)
    if prefix:
        unit = prefix[1].upper()
        if ('INR' if unit in {'₹', 'RS', 'RS.'} else unit) != currency:
            raise ValueError('Amount currency differs from the selected statement currency')
        value = value[prefix.end():]
    if value.startswith('(') and value.endswith(')'):
        value = '-' + value[1:-1]
    if not re.fullmatch(r'[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?', value):
        raise ValueError('Invalid transaction amount')
    try:
        amount = Decimal(value.replace(',', ''))
    except InvalidOperation:
        raise ValueError('Invalid transaction amount') from None
    if not amount.is_finite() or abs(amount) >= Decimal('1e18'):
        raise ValueError('Transaction amount is outside supported bounds')
    return amount


def transaction_fields(cells, columns, currency, date_order):
    def cell(key):
        index = columns.get(key, len(cells))
        return cells[index].strip() if index < len(cells) else ''

    observed_currency = cell('currency').upper()
    if observed_currency and observed_currency != currency:
        raise ValueError('Row currency differs from the selected statement currency')
    if not cell('date'):
        raise ValueError('Mapped date column is empty')
    event_time, time_basis = parse_date(cell('date'), date_order)
    if {'debit', 'credit'} <= columns.keys():
        debit, credit = parse_amount(cell('debit'), currency), parse_amount(cell('credit'), currency)
        if min(debit, credit) < 0 or (debit > 0) == (credit > 0):
            raise ValueError('Expected exactly one positive debit or credit')
        amount, direction = (debit, 'debit') if debit else (credit, 'credit')
    else:
        signed = parse_amount(cell('amount'), currency)
        direction = {'dr': 'debit', 'debit': 'debit', 'cr': 'credit', 'credit': 'credit'}.get(cell('direction').casefold())
        if not signed or (cell('direction') and not direction) or (signed < 0 and direction == 'credit'):
            raise ValueError('Invalid signed amount or debit/credit direction')
        amount, direction = abs(signed), direction or ('debit' if signed < 0 else 'credit')
    return event_time, time_basis, str(amount), direction


def statement_records(content, password, currency, date_order, *, page_range=None):
    digest = sha256(content).hexdigest()
    records = []
    for locator, headers, cells, columns in statement_rows(content, password, page_range=page_range):
        if columns is None:
            records.append({'locator': locator, 'error': locator['diagnostic']})
            continue
        try:
            event_time, time_basis, amount, direction = transaction_fields(cells, columns, currency, date_order)
        except (ValueError, OverflowError) as exc:
            records.append({'locator': locator, 'error': str(exc)})
            continue
        transaction_id = 'transaction:' + uid(STATEMENT_DATASET, digest, locator)
        day = event_time[:10]
        label = f'{day} · {direction.title()} {amount} {currency}'
        records.append({
            'locator': locator, 'method': METHOD, 'extraction_version': '1',
            'event_time': event_time, 'time_basis': time_basis, 'passage': json_row([headers, cells]),
            'statement_label': label,
            'facts': [node('Transaction', transaction_id, label, event_time=event_time, time_basis=time_basis,
                           amount_paid=amount, payment_currency=currency, direction=direction)],
        })
    if not any('facts' in record for record in records):
        rejected = [record for record in records if record['locator'].get('row')]
        if rejected:
            reasons = Counter(record['error'] for record in rejected)
            details = '. '.join(f'{reason} ({count})' for reason, count in reasons.most_common())
            raise ValueError(f'Table found. All {len(rejected)} candidate rows failed validation. {details}.')
        if records and all(record['error'] == NO_PDF_TEXT for record in records):
            raise ValueError('No usable text was found on the selected PDF pages. Try a text PDF or an Excel .xlsx export from the bank.')
        unknown_pages = [record['locator'] for record in records if record['error'] == UNKNOWN_PDF_TABLE]
        if unknown_pages:
            strongest = max(unknown_pages, key=lambda page: len(page.get('header_signals', [])))
            message = 'MAHA read text in the PDF but could not identify the transaction columns.'
            if labels := strongest.get('header_signals'):
                message += f' Possible headings on page {strongest["page"]}: {", ".join(labels)}.'
            else:
                message += ' No recognizable header line was found in the selected pages.'
            raise ValueError(message)
        raise ValueError('No supported statement table found. Use a text PDF or .xlsx with Date and Debit/Credit or Amount columns.')
    return records
