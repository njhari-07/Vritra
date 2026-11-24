"""Turn source-backed call and wire tables into locally reviewed records."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import re
from time import monotonic

from PIL import Image, ImageOps
import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils import cluster_objects
from pdfplumber.utils.exceptions import MalformedPDFException, PdfminerException

from .document_intake import MAX_PAGES, MAX_PIXELS, ocr_statement_image, render_pdf_image
from .ingestion import CURRENCIES, amount, edge, json_row, node
from .limits import ResourceLimitError, check
from .statements import cell_text, positioned_boundaries, positioned_cells, positioned_header_groups, ruled_word_cells
from .store import uid


TIME = {
    'timestamp': {'timestamp', 'datetime', 'startdatetime', 'calldatetime', 'callstarttime', 'starttime', 'transactiondatetime'},
    'date': {'calldate', 'date', 'transactiondate', 'valuedate'},
    'time': {'calltime', 'time', 'transactiontime'},
}
COLUMNS = {
    'calls': {
        **TIME,
        'caller': {'caller', 'callernumber', 'callingnumber', 'fromnumber', 'aparty', 'originatingnumber', 'callingparty'},
        'callee': {'callee', 'calleenumber', 'callednumber', 'tonumber', 'bparty', 'destinationnumber', 'calledparty'},
        'duration': {'duration', 'durationseconds', 'durationsec', 'durations', 'callduration', 'calldurationinseconds', 'durationinseconds'},
    },
    'wires': {
        **TIME,
        'from_account': {'fromaccount', 'senderaccount', 'senderaccountnumber', 'debitaccount', 'originatoraccount'},
        'to_account': {'toaccount', 'receiveraccount', 'receiveraccountnumber', 'beneficiaryaccount', 'creditaccount'},
        'from_bank': {'frombank', 'senderbank', 'originatorbank', 'debitbank'},
        'to_bank': {'tobank', 'receiverbank', 'beneficiarybank', 'creditbank'},
        'amount': {'amount', 'transferamount', 'amountpaid', 'wireamount'},
        'currency': {'currency', 'currencycode', 'paymentcurrency'},
        'received_amount': {'amountreceived', 'receivedamount', 'receivingamount', 'beneficiaryamount'},
        'received_currency': {'receivingcurrency', 'receivedcurrency', 'beneficiarycurrency'},
        'reference': {'reference', 'referencenumber', 'transactionreference', 'utr', 'utrnumber', 'transactionid'},
    },
}
REQUIRED = {'calls': {'caller', 'callee', 'duration'},
            'wires': {'from_bank', 'to_bank', 'from_account', 'to_account', 'amount', 'currency'}}
REPORT_DATASETS = {'calls': 'call-report', 'wires': 'wire-report'}
FOOTER = re.compile(r'^(?:(?:grand\s+)?totals?\b|page\s+\d|end of report\b|generated\s+(?:on|at)\b)', re.I)
PHONE = re.compile(r'\+?\d{7,15}\Z')
ACCOUNT = re.compile(r'[A-Za-z0-9][A-Za-z0-9./-]{2,63}\Z')
OFFSET = re.compile(r'([+-])(0\d|1[0-4]):([0-5]\d)\Z')
WIRE_AMOUNT = re.compile(r'(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,2}(?:,[0-9]{2})+,[0-9]{3})(?:\.[0-9]{1,8})?\Z')


def key(text):
    return re.sub(r'[^a-z0-9]', '', text.casefold())


def usable_mapping(columns, kind):
    return REQUIRED[kind] <= columns.keys() and ('timestamp' in columns or 'date' in columns)


def report_header(cells, kind):
    labels = [key(cell_text(cell)) for cell in cells]
    columns = {}
    for name, aliases in COLUMNS[kind].items():
        matches = [index for index, label in enumerate(labels) if label in aliases]
        if len(matches) == 1:
            columns[name] = matches[0]
    return columns if usable_mapping(columns, kind) else None


def validate_mapping(text, dividers, kind):
    if not text and not dividers:
        return {}, []
    columns = {}
    for item in text.split(',') if text else []:
        name, sep, raw = item.partition(':')
        if not sep or name not in COLUMNS[kind] or not raw.isascii() or not raw.isdecimal() or not 1 <= int(raw) <= 48:
            raise ValueError('Map fields to column numbers from 1 through 48.')
        columns[name] = int(raw) - 1
    boundaries = [float(value) for value in dividers.split(',')] if dividers else []
    if (columns and (not usable_mapping(columns, kind) or len(set(columns.values())) != len(columns))
            or boundaries != sorted(set(boundaries)) or any(not 0 < x < 100 for x in boundaries)
            or len(boundaries) >= 48 or (columns and boundaries and max(columns.values()) > len(boundaries))):
        raise ValueError('Map the required fields to distinct columns and use increasing divider percentages.')
    return columns, boundaries


def parse_offset(value):
    if not value:
        return None
    if value in ('Z', 'UTC'):
        return timezone.utc
    match = OFFSET.fullmatch(value)
    if not match or (match[2] == '14' and match[3] != '00'):
        raise ValueError('Enter the report timezone as UTC or a numeric offset such as +05:30.')
    minutes = int(match[2]) * 60 + int(match[3])
    return timezone(timedelta(minutes=minutes if match[1] == '+' else -minutes))


def event_time(fields, tz, date_order, allow_date_only=False):
    raw = fields.get('timestamp') or ' '.join(filter(None, (fields.get('date'), fields.get('time'))))
    value = None
    if ':' not in raw:
        if allow_date_only:
            day = '%d/%m/%Y' if date_order == 'DMY' else '%m/%d/%Y'
            for form in ('%Y-%m-%d', '%Y/%m/%d', day, day.replace('/', '-')):
                try:
                    return datetime.strptime(raw, form).replace(tzinfo=timezone.utc).isoformat(), 'date_only'
                except ValueError:
                    continue
        raise ValueError('A printed date and time are required.')
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        day = '%d/%m/%Y' if date_order == 'DMY' else '%m/%d/%Y'
        for date in (day, day.replace('/', '-'), '%Y/%m/%d', '%Y-%m-%d'):
            for clock in ('%H:%M:%S', '%H:%M', '%I:%M:%S %p', '%I:%M %p'):
                for zone in (' %z', ''):
                    try:
                        value = datetime.strptime(raw, f'{date} {clock}{zone}')
                        break
                    except ValueError:
                        continue
                if value:
                    break
            if value:
                break
    if value is None:
        raise ValueError('The printed date or time could not be read.')
    if value.tzinfo is None:
        if tz is None:
            raise ValueError('Set the report timezone for rows without a printed offset.')
        value = value.replace(tzinfo=tz)
        basis = 'reviewer_report_offset'
    else:
        basis = 'explicit_UTC'
    return value.astimezone(timezone.utc).isoformat(timespec='seconds'), basis


def call_fields(fields):
    values = {name: re.sub(r'[\s()-]', '', fields[name]) for name in ('caller', 'callee')}
    if any(not PHONE.fullmatch(value) for value in values.values()):
        raise ValueError('Caller and callee need complete printed phone numbers.')
    printed = fields['duration']
    if re.fullmatch(r'\d{1,8}', printed):
        duration = int(printed)
    elif re.fullmatch(r'\d{1,4}:[0-5]\d(?::[0-5]\d)?', printed):
        duration = 0
        for unit in printed.split(':'):
            duration = duration * 60 + int(unit)
    else:
        raise ValueError('Duration must be in seconds or a clock duration such as 00:01:25.')
    return {**values, 'duration_seconds': duration}


def normalized_record(kind, fields, locator, digest, tz, date_order):
    when, basis = event_time(fields, tz, date_order, allow_date_only=kind == 'wires')
    data = {'event_time': when, 'time_basis': basis, 'facts': [], 'confidence': None,
            'confidence_basis': 'Reviewed report table row', 'method': 'reviewed-report-table'}
    if kind == 'calls':
        data['call_observation'] = call_fields(fields)
        return data
    if any(not ACCOUNT.fullmatch(fields[field]) for field in ('from_account', 'to_account')):
        raise ValueError('The sending and receiving accounts must be readable and complete.')
    code = CURRENCIES.get(fields['currency'], fields['currency'].upper())
    if 'received_amount' in fields and 'received_currency' not in fields:
        raise ValueError('Map the printed receiving currency for reports with a separate receiving amount.')
    received_currency = fields.get('received_currency', fields['currency'])
    received_code = CURRENCIES.get(received_currency, received_currency.upper())
    if not (re.fullmatch(r'[A-Z]{3}', code) and re.fullmatch(r'[A-Z]{3}', received_code)):
        raise ValueError('A three-letter currency code is required.')
    received_amount = fields.get('received_amount', fields['amount'])
    if received_code != code and 'received_amount' not in fields:
        raise ValueError('A cross-currency transfer needs a printed receiving amount.')
    if not (WIRE_AMOUNT.fullmatch(fields['amount']) and WIRE_AMOUNT.fullmatch(received_amount)):
        raise ValueError('The transfer amount could not be read.')
    transfer = amount(fields['amount'].replace(',', ''))
    received = amount(received_amount.replace(',', ''))
    transaction = 'transaction:' + uid('wire-report', digest, locator['page'], locator['table'], locator['row'])
    sender = 'account:' + uid('wire-report', fields['from_bank'].casefold(), fields['from_account'])
    receiver = 'account:' + uid('wire-report', fields['to_bank'].casefold(), fields['to_account'])
    attrs = dict(event_time=when, time_basis=basis, amount_paid=transfer, amount_received=received,
                 payment_currency=code, receiving_currency=received_code, transaction_id=transaction)
    if fields.get('reference'):
        attrs['reference'] = fields['reference']
    data['facts'] = [
        node('Account', sender, fields['from_bank'] + ' / ' + fields['from_account'],
             bank=fields['from_bank'], account=fields['from_account']),
        node('Account', receiver, fields['to_bank'] + ' / ' + fields['to_account'],
             bank=fields['to_bank'], account=fields['to_account']),
        node('Transaction', transaction, transfer + ' ' + code, **attrs),
        edge('SENT_FROM', transaction, sender, transaction),
        edge('SENT_TO', transaction, receiver, transaction),
        edge('TRANSACTED_WITH', sender, receiver, transaction, **attrs),
    ]
    return data


def raster_words(image, deadline, scale=1):
    words, vertical, horizontal = ocr_statement_image(image, deadline)
    for word in words:
        for axis in ('x0', 'x1', 'top', 'bottom'):
            word[axis] /= scale
    return words, [x / scale for x in vertical], [y / scale for y in horizontal]


def aligned_rows(words, kind, manual, dividers, width):
    lines = cluster_objects(words, 'top', 3)
    boundaries = [width * divider / 100 for divider in dividers]
    if not boundaries:
        for line in lines:
            groups = positioned_header_groups(line)
            labels = [group[0] for group in groups]
            if report_header(labels, kind):
                boundaries = positioned_boundaries(groups)
                break
        else:
            return []
    return [(index, positioned_cells(line, boundaries),
             (min(word['x0'] for word in line), min(word['top'] for word in line),
              max(word['x1'] for word in line), max(word['bottom'] for word in line)))
            for index, line in enumerate(lines, 1)]


def table_records(tables, kind, manual, carry):
    next_carry = None
    candidates = []
    for table, (grid, rows) in enumerate(tables, 1):
        columns = None
        first = True
        for index, cells, bbox in rows:
            cells = [cell_text(cell) for cell in cells]
            if not any(cells):
                continue
            if mapping := report_header(cells, kind):
                columns = manual or mapping
                next_carry = grid, columns, len(cells)
                first = False
                continue
            if first and grid and carry and len(cells) == carry[2] and len(grid) == len(carry[0]) and all(
                abs(current - previous) <= 5 for current, previous in zip(grid, carry[0])
            ):
                columns = manual or carry[1]
            elif first and manual and grid and max(manual.values()) < len(cells):
                columns = manual
                next_carry = grid, columns, len(cells)
                first = False
                continue  # the first populated ruled row is the header under manual mapping
            first = False
            if columns is None or FOOTER.match(next((cell for cell in cells if cell), '')):
                continue
            fields = {field: ' '.join(cells[pos].split()) if pos < len(cells) else '' for field, pos in columns.items()}
            if sum(bool(value) for value in fields.values()) >= 1:
                candidates.append((table, index, bbox, cells, fields))
    return candidates, next_carry or carry


def native_tables(page):
    for table in page.find_tables():
        rows = [(index, cells, row.bbox) for index, (cells, row) in enumerate(zip(table.extract(), table.rows), 1)]
        grid = sorted({bound for cell in table.cells for bound in (cell[0], cell[2])})
        yield grid, rows


def scanned_tables(words, vertical, horizontal, kind, manual, dividers, width):
    ruled = list(ruled_word_cells(words, vertical, horizontal))
    if ruled and not dividers:
        yield vertical, ruled
    else:
        yield tuple(width * x / 100 for x in dividers), aligned_rows(words, kind, manual, dividers, width)


def report_rows(content, kind, first=1, last=None, offset='', date_order='DMY', mapping='', dividers=''):
    manual, boundaries = validate_mapping(mapping, dividers, kind)
    tz = parse_offset(offset)
    deadline = monotonic() + 90
    digest = sha256(content).hexdigest()
    records, pages = [], []
    carry = None

    def add_page(number, tables, method, bbox_units):
        nonlocal carry
        rows, carry = table_records(tables, kind, manual, carry)
        pages.append({'page': number, 'candidates': len(rows), 'method': method,
                      'issue': None if rows else 'No supported transaction rows were found on this page.'})
        for table, row, bbox, cells, fields in rows:
            check(len(records) + 1, 'IMPORT_RECORDS', 5000)
            locator = {'page': number, 'table': table, 'row': row, 'bbox': list(bbox), 'bbox_units': bbox_units,
                       'bbox_origin': 'top-left', 'text_method': method}
            record = {'locator': locator, 'fields': fields, 'report_fields': fields, 'passage': json_row(cells)}
            try:
                if any(not fields.get(field) for field in REQUIRED[kind]):
                    raise ValueError('One or more required fields are blank.')
                record.update(normalized_record(kind, fields, locator, digest, tz, date_order))
            except (ValueError, OverflowError) as exc:
                record['error'] = str(exc)
            records.append(record)

    try:
        if content.startswith(b'%PDF-'):
            extension = 'pdf'
            with pdfplumber.open(BytesIO(content)) as pdf:
                through = len(pdf.pages) if last is None else last
                if not 1 <= first <= through <= len(pdf.pages):
                    raise ValueError('Select a page range within the source document.')
                if through - first + 1 > MAX_PAGES:
                    raise ResourceLimitError(f'Select up to {MAX_PAGES} pages per report review.')
                for page in pdf.pages[first - 1:through]:
                    try:
                        if monotonic() >= deadline or len(page.chars) > 100_000:
                            raise ResourceLimitError('Report page exceeds the processing limit.')
                        if page.chars:
                            tables = list(native_tables(page)) if not boundaries else []
                            if not table_records(tables, kind, manual, carry)[0]:
                                tables = [(tuple(page.width * x / 100 for x in boundaries),
                                           aligned_rows(page.extract_words(), kind, manual, boundaries, page.width))]
                            if table_records(tables, kind, manual, carry)[0]:
                                add_page(page.page_number, tables, 'pdf-text', 'points')
                                continue
                        if page.width * page.height * (180 / 72) ** 2 > MAX_PIXELS:
                            raise ResourceLimitError('Report page exceeds the OCR image size limit.')
                        tables = []
                        for resolution in (180, 220):
                            if page.width * page.height * (resolution / 72) ** 2 > MAX_PIXELS:
                                break
                            raster = render_pdf_image(page, resolution=resolution, antialias=True)
                            with raster.original as image:
                                words, vertical, horizontal = raster_words(image, deadline, raster.scale)
                            tables = list(scanned_tables(words, vertical, horizontal, kind, manual, boundaries, page.width))
                            if table_records(tables, kind, manual, carry)[0]:
                                break
                        add_page(page.page_number, tables, 'tesseract-eng', 'points')
                    finally:
                        page.close()
        else:
            if first != 1 or last not in (None, 1):
                raise ValueError('A standalone image has one page.')
            with Image.open(BytesIO(content), formats=['JPEG', 'PNG']) as source:
                if source.width * source.height > MAX_PIXELS:
                    raise ResourceLimitError('Report image exceeds the OCR image size limit.')
                extension = 'jpg' if source.format == 'JPEG' else 'png'
                with ImageOps.exif_transpose(source).convert('RGB') as image:
                    words, vertical, horizontal = raster_words(image, deadline)
                    add_page(1, scanned_tables(words, vertical, horizontal, kind, manual, boundaries, image.width),
                             'tesseract-eng', 'pixels')
    except PDFPasswordIncorrect as exc:
        raise ValueError('Provide an unlocked report PDF.') from exc
    except PdfminerException as exc:
        if isinstance(exc.__cause__ or exc.__context__, PDFPasswordIncorrect):
            raise ValueError('Provide an unlocked report PDF.') from exc
        raise ValueError('The report PDF could not be read.') from exc
    except (Image.UnidentifiedImageError, Image.DecompressionBombError, MalformedPDFException, PDFSyntaxError) as exc:
        raise ValueError('Choose a readable PDF, JPEG, or PNG report.') from exc
    return extension, digest, records, pages
