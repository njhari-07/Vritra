"""Read bank statement rows from PDF and XLSX, retaining original-byte provenance."""
from bisect import bisect_right
from contextlib import closing
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import re
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

from .ingestion import json_row, node
from .limits import ResourceLimitError, check
from .store import uid


STATEMENT_DATASET = 'bank-statement'
METHOD = 'bank-statement-row'
MAX_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 200
MAX_COLUMNS = 48
OLE_SIGNATURE = bytes.fromhex('D0CF11E0A1B11AE1')
TEXT_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'text'}
HYBRID_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'lines'}
CURRENCIES = {'INR', 'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF'}

HEADER_ALIASES = {
    'date': ('transaction date', 'txn date', 'tran date', 'time utc', 'date', 'posting date', 'booking date'),
    'debit': ('debit', 'debit amt', 'debit amount', 'withdrawal', 'withdrawal amt', 'withdrawal amount', 'paid', 'money out'),
    'credit': ('credit', 'credit amt', 'credit amount', 'deposit', 'deposit amt', 'deposit amount', 'received', 'money in'),
    'amount': ('amount', 'transaction amount', 'txn amount', 'signed amount'),
    'direction': ('direction', 'type', 'debit credit', 'debit or credit', 'dr cr', 'cr dr', 'transaction type'),
    'currency': ('currency', 'ccy', 'iso currency'),
}


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
    value = re.sub(r'[^a-z0-9]+', ' ', value.casefold()).strip()
    return re.sub(r'^(?:inr|usd|gbp|eur) | (?:inr|usd|gbp|eur)$', '', value)


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


def positioned_pdf_rows(page, encrypted):
    """Use whitespace between a recognized header's columns on a borderless page."""
    headers = columns = None
    boundaries = []
    lines = cluster_objects(page.extract_words(), 'top', 3)
    for line_number, line in enumerate(lines, 1):
        words = sorted(line, key=lambda word: word['x0'])
        groups = []
        for word in words:
            if not groups or word['x0'] - groups[-1][-1]['x1'] >= 6:
                groups.append([])
            groups[-1].append(word)
        labels = [' '.join(word['text'] for word in group) for group in groups]
        if mapping := header_map(labels):
            headers, columns = labels, mapping
            boundaries = [(left[-1]['x1'] + right[0]['x0']) / 2
                          for left, right in zip(groups, groups[1:])]
            continue
        if headers is None:
            continue
        cells = [[] for _ in headers]
        for word in words:
            column = bisect_right(boundaries, (word['x0'] + word['x1']) / 2)
            cells[column].append(word['text'])
        locator = {
            'format': 'pdf', 'page': page.page_number, 'table': 1, 'row': line_number,
            'layout': 'aligned-text', 'encrypted': encrypted, 'bbox_units': 'points', 'bbox_origin': 'top-left',
            'bbox': [words[0]['x0'], min(word['top'] for word in words),
                     max(word['x1'] for word in words), max(word['bottom'] for word in words)],
        }
        yield locator, headers, [' '.join(value) for value in cells], columns


def pdf_statement_rows(content, password, page_range):
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
                for strategy, settings in [('ruled', {}), ('mixed', HYBRID_TABLE), ('text', TEXT_TABLE)]:
                    found = False
                    for index, table in enumerate(page.find_tables(settings), 1):
                        rows = ((i, cells, table.rows[i-1].bbox)
                                for i, cells in enumerate(table.extract(), 1))
                        location = {'format': 'pdf', 'page': page.page_number, 'table': index,
                                    'layout': strategy, 'encrypted': encrypted}
                        for item in matched_rows(rows, location):
                            found = True
                            yield item
                    if found:
                        break
                else:
                    rows = positioned_pdf_rows(page, encrypted)
                    first = next(rows, None)
                    if first is None:
                        yield {'format': 'pdf', 'page': page.page_number, 'encrypted': encrypted}, None, None, None
                    else:
                        yield first
                        yield from rows
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
    value = value.strip()
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
            for pattern in ('%d %b %Y', '%d-%b-%Y', '%d %b %y', '%d-%b-%y'):
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


def parse_amount(value):
    value = value.strip().replace('−', '-')
    if not value or value in {'–', '—', '-'}:
        return Decimal(0)
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
    event_time, time_basis = parse_date(cell('date'), date_order)
    if {'debit', 'credit'} <= columns.keys():
        debit, credit = parse_amount(cell('debit')), parse_amount(cell('credit'))
        if min(debit, credit) < 0 or (debit > 0) == (credit > 0):
            raise ValueError('Expected exactly one positive debit or credit')
        amount, direction = (debit, 'debit') if debit else (credit, 'credit')
    else:
        signed = parse_amount(cell('amount'))
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
            records.append({'locator': locator, 'error': 'No supported transaction table recognized on this page'})
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
        if any(record['locator'].get('row') for record in records):
            raise ValueError('A transaction table was found, but no rows matched the selected date and currency settings')
        raise ValueError('No supported statement table found. Use a text PDF or .xlsx with Date and Debit/Credit or Amount columns.')
    return records
