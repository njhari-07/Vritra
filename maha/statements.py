"""Read bank statement rows from PDF and XLSX, retaining original-byte provenance."""
from bisect import bisect_right
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from hashlib import sha256
from io import BytesIO, StringIO
from itertools import chain, tee
import json
from math import cos, radians, sin
import re
from struct import error as StructError
from time import monotonic
from types import SimpleNamespace
from zipfile import BadZipFile, ZipFile
from xml.etree.ElementTree import ParseError as XMLParseError

from defusedxml.common import DefusedXmlException
import msoffcrypto
from msoffcrypto.exceptions import DecryptionError, FileFormatError, InvalidKeyError, ParseError
from olefile import OleFileIO
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.xml.functions import fromstring
from PIL import Image, ImageOps, UnidentifiedImageError
import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import MalformedPDFException, PdfminerException
from pdfplumber.utils import cluster_objects, extract_words
from pypdfium2 import PdfDocument, PdfiumError, raw as pdfium
import xlrd
from xlrd.compdoc import CompDocError
from xlrd.xldate import XLDateError

from .document_intake import (
    MAX_PIXELS, ocr_pdf_word_band, ocr_statement_image, pdfium_lock, raster_table_rules, render_pdf_image,
    statement_deskew_angle,
)
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
BIFF_SIGNATURES = (b'\x09\x00', b'\x09\x02', b'\x09\x04', b'\x09\x08')
TIFF_SIGNATURES = (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+')
IMAGE_EXTENSIONS = {b'\x89PNG\r\n\x1a\n': '.png', b'\xff\xd8\xff': '.jpg',
                    **dict.fromkeys(TIFF_SIGNATURES, '.tiff')}
TEXT_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'text'}
HYBRID_TABLE = {'vertical_strategy': 'text', 'horizontal_strategy': 'lines'}
CURRENCIES = {'INR', 'USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'AED', 'JPY', 'CHF'}

HEADER_ALIASES = {
    'date': ('transaction date', 'txn date', 'tran date', 'time utc', 'date', 'posting date', 'booking date',
             'post date', 'value date'),
    'debit': ('debit', 'debit amt', 'debit amount', 'withdrawal', 'withdrawal amt', 'withdrawal amount', 'paid', 'money out'),
    'credit': ('credit', 'credit amt', 'credit amount', 'deposit', 'deposit amt', 'deposit amount', 'received', 'money in'),
    'amount': ('amount', 'transaction amount', 'txn amount', 'signed amount', 'amount dr cr', 'amount cr dr'),
    'direction': ('direction', 'type', 'debit credit', 'debit or credit', 'dr cr', 'cr dr', 'transaction type'),
    'currency': ('currency', 'ccy', 'iso currency'),
    'value_date': ('value date', 'effective date'),
    'post_date': ('post date', 'posting date', 'booking date'),
    'narration': ('details', 'narration', 'description', 'transaction details', 'particulars', 'remarks'),
    'reference': ('ref no cheque no', 'reference', 'reference number', 'cheque no', 'ref no', 'check number'),
    'balance': ('balance', 'running balance', 'closing balance', 'available balance', 'balance amount'),
}
HEADER_DIAGNOSTIC_LABELS = ('value date', 'post date', 'posting date', 'transaction date', 'date', 'details',
                            'narration', 'ref no', 'cheque no', 'debit', 'credit', 'withdrawal', 'deposit',
                            'amount', 'balance')
NUMERIC_DATE = re.compile(r'[0-9]{1,4}([./-])[0-9]{1,2}\1[0-9]{2,4}')
AMOUNT_DIRECTIONS = {'dr': 'debit', 'debit': 'debit', 'cr': 'credit', 'credit': 'credit'}
AMOUNT_DIRECTION_SUFFIX = re.compile(r'(debit|credit|dr|cr)\.?$', re.IGNORECASE)
DECIMAL_COMMA_AMOUNT = re.compile(r'[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+),\d{2}')
SPACE_GROUPED_AMOUNT = re.compile(r'[+-]?\d{1,3}(?: \d{3})+(?:\.\d+)?')
TWO_DATE_COLUMNS = {
    'value_date': 0, 'date': 1, 'narration': 2, 'reference': 3, 'debit': 4, 'credit': 5, 'balance': 6,
}
TWO_DATE_HEADERS = ['Value date', 'Posting date', 'Details', 'Reference', 'Debit', 'Credit', 'Balance']
CORRECTABLE_STATEMENT_FIELDS = frozenset({'date', 'debit', 'credit', 'amount', 'direction'})


class StatementPasswordError(ValueError):
    pass


class StatementOcrUnavailable(ValueError):
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


def validate_statement_layout(layout):
    if not isinstance(layout, dict) or set(layout) - {'columns', 'separators'}:
        raise ValueError('Invalid statement column mapping')
    columns = layout.get('columns')
    if not isinstance(columns, dict) or any(
        key not in HEADER_ALIASES or type(index) is not int or not 1 <= index <= MAX_COLUMNS
        for key, index in columns.items()
    ):
        raise ValueError('Use whole column numbers from 1 through 48')
    has_pair = {'debit', 'credit'} <= columns.keys()
    if ('date' not in columns or has_pair == ('amount' in columns)
            or (not has_pair and {'debit', 'credit'} & columns.keys())
            or len(set(columns.values())) != len(columns)):
        raise ValueError('Map distinct columns for the transaction date and either debit and credit or a signed amount')
    separators = layout.get('separators', [])
    if (not isinstance(separators, list)
            or any(type(value) not in {int, float} or not 0 < value < 100 for value in separators)
            or separators != sorted(set(separators))
            or (separators and max(columns.values()) > len(separators) + 1)
            or len(separators) >= MAX_COLUMNS):
        raise ValueError('Enter increasing percentages between 0 and 100 for the column dividers')
    return {'columns': columns, 'separators': separators}


def matched_rows(rows, location, manual=None):
    headers = columns = None
    if manual:
        columns = {key: index - 1 for key, index in manual['columns'].items()}
        location = {**location, 'statement_layout': manual}
    seen_transaction = False
    for row_number, values, bounds in rows:
        cells = [cell_text(value) for value in values]
        if not any(cell.strip() for cell in cells):
            continue
        if manual:
            if len(cells) <= max(columns.values()):
                continue
            date = cells[columns['date']]
            if not seen_transaction:
                if not viable_transaction(cells, columns):
                    continue
                seen_transaction = True
            elif header_map(cells) or (not date.strip() and not any(
                re.search(r'\d', cells[index])
                for key, index in columns.items() if key in {'balance', 'debit', 'credit', 'amount'}
            )):
                continue
            headers = [f'Column {index}' for index in range(1, len(cells) + 1)]
        elif next_columns := header_map(cells):
            headers, columns = cells, next_columns
            continue
        if headers is not None:
            yield statement_row_locator(location, row_number, bounds), headers, cells, columns


def statement_row_locator(location, row_number, bounds, *, bbox_units='points'):
    locator = {**location, 'row': row_number}
    if bounds is not None:
        locator.update(bbox=list(bounds), bbox_units=bbox_units, bbox_origin='top-left')
    return locator


def balance_verified_rows(rows, location):
    """Recognize a two-date, seven-column table only when both amounts and balances agree."""
    candidates = []
    amounts = []
    date_roles_known = False
    for row_number, values, bounds in rows:
        if len(values) != 7:
            continue
        cells = [cell_text(value).strip() for value in values]
        if (header_key(cells[0]) in HEADER_ALIASES['value_date']
                and header_key(cells[1]) in HEADER_ALIASES['post_date']):
            date_roles_known = True
        if not any(plausible_date(value) for value in cells[:2]):
            continue
        if not all(plausible_date(value) for value in cells[:2]) or not re.search(r'\d', cells[6]):
            return
        if not date_roles_known and cells[0] != cells[1]:
            # Balances can prove the financial columns, but they cannot distinguish two different dates.
            return
        try:
            balance = parse_balance(cells[6], None)
            _, _, amount, direction = transaction_fields(
                cells, TWO_DATE_COLUMNS, None, 'DMY' if plausible_date(cells[1], 'DMY') else 'MDY',
            )
        except (ValueError, OverflowError):
            return
        check(len(candidates) + 1, 'IMPORT_RECORDS', 5000)
        signed = Decimal(amount) if direction == 'credit' else -Decimal(amount)
        amounts.append((balance, signed))
        locator = statement_row_locator(location, row_number, bounds, bbox_units=location.get('bbox_units', 'points'))
        candidates.append((locator, TWO_DATE_HEADERS, cells, TWO_DATE_COLUMNS))
    if len(candidates) >= 3 and (balances_reconcile(amounts) or balances_reconcile(reversed(amounts))):
        yield from candidates


def balances_reconcile(amounts):
    sequence = iter(amounts)
    previous, _ = next(sequence)
    for balance, change in sequence:
        if previous + change != balance:
            return False
        previous = balance
    return True


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


def positioned_cells(words, boundaries):
    cells = [[] for _ in range(len(boundaries) + 1)]
    for word in words:
        column = bisect_right(boundaries, (word['x0'] + word['x1']) / 2)
        cells[column].append(word)
    return ['\n'.join(' '.join(word['text'] for word in sorted(line, key=lambda word: word['x0']))
                      for line in cluster_objects(cell, 'top', 3)) for cell in cells]


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


def positioned_pdf_rows(page, encrypted, lines, *, wrapped_only=False, gap=6, layout=None):
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
        method = layout or ('aligned-text' if gap == 6 else 'aligned-text-tight')
        yield positioned_row(page, encrypted, method, line_number, line, boundaries, headers, columns)


def ruled_word_cells(words, vertical, horizontal):
    if not 3 <= len(vertical) <= MAX_COLUMNS + 1 or len(horizontal) < 3:
        return
    bands = [[] for _ in range(len(horizontal) - 1)]
    for word in words:
        x = (word['x0'] + word['x1']) / 2
        y = (word['top'] + word['bottom']) / 2
        row = bisect_right(horizontal, y) - 1
        if vertical[0] <= x < vertical[-1] and 0 <= row < len(bands):
            bands[row].append(word)
    for index, band in enumerate(bands, 1):
        yield index, positioned_cells(band, vertical[1:-1]), (
            vertical[0], horizontal[index - 1], vertical[-1], horizontal[index])


def ruled_word_rows(words, vertical, horizontal, location, manual=None):
    yield from matched_rows(ruled_word_cells(words, vertical, horizontal), location, manual)


def statement_grid_schema(rows):
    """Keep headers only after at least one transaction validates under them."""
    rows = list(rows)
    headers = columns = None
    for _, values, _ in rows:
        cells = [cell_text(value) for value in values]
        if detected := header_map(cells):
            headers, columns = cells, detected
        elif columns and viable_transaction(cells, columns):
            return headers, columns, False
    with closing(balance_verified_rows(rows, {})) as inferred:
        if row := next(inferred, None):
            return row[1], row[3], True
    return None


def grid_signature(edges, left, width):
    return tuple((edge - left) / width for edge in edges) if width > 0 else ()


def nearby_grid_schema(page_number, signature, nearby_grids):
    if len(signature) < 3:
        return None
    prior = [*range(page_number - 1, max(0, page_number - 5), -1)]
    if page_number > 1:
        prior.append(1)
    following = range(page_number + 1, page_number + 4)
    for number in dict.fromkeys([*prior, *following]):
        for other, headers, columns, inferred in nearby_grids(number):
            if len(other) == len(signature) and all(abs(a - b) <= .006 for a, b in zip(other, signature)):
                return number, headers, columns, inferred
    return None


def continuation_grid_rows(rows, location, schema):
    if not schema:
        return
    header_page, headers, columns, inferred = schema
    location = {**location, 'header_page': header_page}
    for row_number, values, bounds in rows:
        cells = [cell_text(value) for value in values]
        if len(cells) != len(headers):
            continue
        if header_map(cells):
            return
        # Keep damaged transaction dates visible when the amount cells still have values.
        if not plausible_date(cells[columns['date']]) and not any(
            re.search(r'\d', cells[index]) for name, index in columns.items() if name in {'debit', 'credit', 'amount'}
        ):
            continue
        locator = statement_row_locator(location, row_number, bounds,
                                        bbox_units=location.get('bbox_units', 'points'))
        if inferred and cells[columns['value_date']].strip() != cells[columns['date']].strip():
            locator['date_roles_unverified'] = True
        yield locator, headers, cells, columns


def group_transaction_lines(rows):
    """Rows without dates can continue a narration, provided financial cells are empty."""
    current = None
    for locator, headers, cells, columns in rows:
        date_index = columns['date']
        if date_index < len(cells) and cells[date_index].strip():
            if current:
                yield current
            current = locator, headers, cells, columns
            continue
        if current is None:
            if any(cells[index].strip() for key, index in columns.items()
                   if key in {'debit', 'credit', 'amount', 'balance'} and index < len(cells)):
                yield locator, headers, cells, columns
            continue
        index = columns.get('narration', len(cells))
        if index >= len(cells) or not cells[index].strip() or locator['layout'] != current[0]['layout'] or any(
            value.strip() for position, value in enumerate(cells) if position != index
        ):
            yield current
            yield locator, headers, cells, columns
            current = None
            continue
        previous, old_headers, old_cells, _ = current
        if old_headers != headers:
            yield current
            current = None
            continue
        old_cells[index] += '\n' + cells[index]
        left, top, right, bottom = previous['bbox']
        x0, y0, x1, y1 = locator['bbox']
        previous['bbox'] = [min(left, x0), min(top, y0), max(right, x1), max(bottom, y1)]
    if current:
        yield current


def manually_positioned_rows(words, left, width, location, manual):
    boundaries = [left + width * value / 100 for value in manual['separators']]
    lines = cluster_objects(words, 'top', 3)
    coordinates = ((index, positioned_cells(line, boundaries),
                    (min(word['x0'] for word in line), min(word['top'] for word in line),
                     max(word['x1'] for word in line), max(word['bottom'] for word in line)))
                   for index, line in enumerate(lines, 1))
    # Date-less narration fragments are kept here so the grouping pass can attach them.
    headers = [f'Column {index}' for index in range(1, len(boundaries) + 2)]
    columns = {key: index - 1 for key, index in manual['columns'].items()}

    def positioned():
        for index, cells, bounds in coordinates:
            yield {**location, 'statement_layout': manual, 'row': index, 'bbox': list(bounds)}, headers, cells, columns
    with closing(group_transaction_lines(positioned())) as rows:
        for row in rows:
            if viable_transaction(row[2], row[3]):
                yield row
                yield from rows
                return


def scanned_candidates(page, words, vertical, horizontal, location, manual=None, *,
                       left=0, width=None, earlier_grids=None):
    if manual:
        if manual['separators']:
            yield manually_positioned_rows(words, left, width, {**location, 'layout': 'manual-ocr-aligned'}, manual)
        else:
            yield ruled_word_rows(words, vertical, horizontal, {**location, 'layout': 'manual-ocr-grid'}, manual)
        return
    yield ruled_word_rows(words, vertical, horizontal, location)
    lines = cluster_objects(words, 'top', 3)
    layout = location['layout'] + '-aligned'
    rows = group_transaction_lines(positioned_pdf_rows(page, location['encrypted'], lines, layout=layout))
    yield (({**locator, **location, 'layout': layout}, headers, cells, columns)
           for locator, headers, cells, columns in rows)
    if len(vertical) == 8:
        yield balance_verified_rows(ruled_word_cells(words, vertical, horizontal),
                                    {**location, 'layout': location['layout'] + '-balance-verified'})
    if earlier_grids and vertical and horizontal:
        signature = grid_signature(vertical, left, width)
        if schema := nearby_grid_schema(page.page_number, signature, earlier_grids):
            yield continuation_grid_rows(ruled_word_cells(words, vertical, horizontal),
                                         {**location, 'layout': 'continued-ocr-grid'}, schema)


def restore_scan_bounds(bounds, rotation, origin, width, height, deskew=0):
    origin_x, origin_y = origin
    theta = radians(deskew)
    horizontal, vertical = (height, width) if rotation in (90, 270) else (width, height)
    center_x, center_y = horizontal / 2, vertical / 2

    def undo(x, y):
        x, y = x - origin_x, y - origin_y
        if deskew:
            dx, dy = x - center_x, y - center_y
            x = center_x + dx * cos(theta) - dy * sin(theta)
            y = center_y + dx * sin(theta) + dy * cos(theta)
        if rotation == 90:
            x, y = width - y, x
        elif rotation == 180:
            x, y = width - x, height - y
        elif rotation == 270:
            x, y = y, height - x
        if deskew:
            x, y = min(width, max(0, x)), min(height, max(0, y))
        return origin_x + x, origin_y + y

    x0, y0, x1, y1 = bounds
    xs, ys = zip(*(undo(x, y) for x, y in ((x0, y0), (x0, y1), (x1, y0), (x1, y1))))
    return [min(xs), min(ys), max(xs), max(ys)]


def located_scan_rows(rows, rotation, origin, width, height, deskew=0):
    with closing(rows):
        for locator, headers, cells, columns in rows:
            locator = {**locator, 'bbox': restore_scan_bounds(locator['bbox'], rotation, origin, width, height, deskew)}
            if rotation:
                locator['ocr_rotation'] = rotation
            if deskew:
                locator['ocr_deskew_degrees'] = deskew
            yield locator, headers, cells, columns


def raster_orientations(image, allow_correction):
    yield image, 0, 0
    if not allow_correction:
        return
    if angle := statement_deskew_angle(image):
        with image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor='white') as corrected:
            yield corrected, 0, angle
    for rotation, transpose in ((90, Image.Transpose.ROTATE_90), (270, Image.Transpose.ROTATE_270),
                                (180, Image.Transpose.ROTATE_180)):
        with image.transpose(transpose) as oriented:
            yield oriented, rotation, 0
            if angle := statement_deskew_angle(oriented):
                with oriented.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor='white') as corrected:
                    yield corrected, rotation, angle


def scanned_grid_schemas(image, deadline):
    if image.width * image.height > MAX_PIXELS:
        return ()
    with closing(raster_orientations(image, True)) as orientations:
        for oriented, _, _ in orientations:
            grid_x, grid_y = raster_table_rules(oriented)
            if len(grid_x) < 3 or len(grid_y) < 3:
                continue
            try:
                words, grid_x, grid_y = ocr_statement_image(oriented, deadline)
            except FileNotFoundError:
                return ()
            if schema := statement_grid_schema(ruled_word_cells(words, grid_x, grid_y)):
                return ((grid_signature(grid_x, 0, oriented.width), *schema),)
    return ()


def raster_scan_candidates(page, image, location, deadline, manual, *,
                           origin=(0, 0), scale=1, page_width=None, earlier_grids=None):
    origin_x, origin_y = origin
    # User-drawn dividers refer to the uploaded page as displayed.
    with closing(raster_orientations(image, not (manual and manual['separators']))) as orientations:
        for corrected, rotation, angle in orientations:
            words, vertical, horizontal = ocr_statement_image(corrected, deadline)
            for word in words:
                for key in ('x0', 'x1'):
                    word[key] = origin_x + word[key] / scale
                for key in ('top', 'bottom'):
                    word[key] = origin_y + word[key] / scale
            for rows in scanned_candidates(page, words, [origin_x + x / scale for x in vertical],
                                           [origin_y + y / scale for y in horizontal], location, manual,
                                           left=origin_x, width=corrected.width / scale if rotation else
                                           page_width or image.width / scale, earlier_grids=earlier_grids):
                if rotation or angle:
                    yield located_scan_rows(rows, rotation, origin, image.width / scale, image.height / scale, angle)
                else:
                    yield rows


def scanned_pdf_candidates(page, encrypted, deadline, manual=None, earlier_grids=None):
    resolution = 220
    if page.width * page.height * (resolution / 72)**2 > MAX_PIXELS:
        raise ResourceLimitError('Statement page exceeds the OCR size limit')
    try:
        raster = render_pdf_image(page, resolution=resolution, antialias=True)
        location = {'format': 'pdf', 'page': page.page_number, 'table': 1, 'layout': 'ocr-grid', 'encrypted': encrypted,
                    'bbox_units': 'points', 'bbox_origin': 'top-left'}
        with raster.original as image:
            yield from raster_scan_candidates(page, image, location, deadline, manual, origin=raster.bbox[:2],
                                             scale=raster.scale, page_width=raster.bbox[2] - raster.bbox[0],
                                             earlier_grids=earlier_grids)
    except (FileNotFoundError, MalformedPDFException):
        return


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
                raise StatementOcrUnavailable('The statement may have image-only headings, but local OCR is unavailable') from exc
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


def pdf_table_rows(page, encrypted, strategy, settings, manual=None):
    for index, table in enumerate(page.find_tables(settings), 1):
        rows = ((i, cells, table.rows[i-1].bbox) for i, cells in enumerate(table.extract(), 1))
        location = {'format': 'pdf', 'page': page.page_number, 'table': index,
                    'layout': strategy, 'encrypted': encrypted}
        if strategy == 'balance-verified-ruled':
            yield from balance_verified_rows(rows, location)
        else:
            yield from matched_rows(rows, location, manual)


def pdf_vector_grids(page):
    left, _, right, _ = page.cropbox
    for table_index, table in enumerate(page.find_tables(), 1):
        edges = sorted({edge for cell in table.cells for edge in (cell[0], cell[2])})
        signature = grid_signature(edges, left, right - left)
        cells = [(number, values, table.rows[number - 1].bbox)
                 for number, values in enumerate(table.extract(), 1)]
        yield table_index, signature, cells


def pdf_previous_grids(page, deadline):
    schemas = [(signature, *schema) for _, signature, cells in pdf_vector_grids(page)
               if (schema := statement_grid_schema(cells))]
    if schemas or not page.images:
        return tuple(schemas)
    resolution = 220
    if page.width * page.height * (resolution / 72)**2 > MAX_PIXELS:
        return ()
    try:
        with render_pdf_image(page, resolution=resolution, antialias=True).original as image:
            return scanned_grid_schemas(image, deadline)
    except MalformedPDFException:
        return ()


def continued_pdf_candidates(page, encrypted, earlier_grids):
    for table_index, signature, cells in pdf_vector_grids(page):
        if not statement_grid_schema(cells) and (
            schema := nearby_grid_schema(page.page_number, signature, earlier_grids)
        ):
            location = {'format': 'pdf', 'page': page.page_number, 'table': table_index,
                        'layout': 'continued-ruled', 'encrypted': encrypted}
            yield continuation_grid_rows(cells, location, schema)


def pdfium_words(content, password, page):
    if page.rotation:
        return []
    characters = []
    try:
        with pdfium_lock, PdfDocument(content, password=password or None) as document:
            source = document[page.page_number - 1]
            text = source.get_textpage()
            try:
                count = text.count_chars()
                if count > 100_000:
                    return []
                for index in range(count):
                    code = pdfium.FPDFText_GetUnicode(text, index)
                    letter = chr(code) if 0 < code <= 0x10FFFF else ''
                    if not letter.isprintable():
                        continue
                    left, bottom, right, top = text.get_charbox(index, loose=True)
                    if right <= left or bottom >= top:
                        continue
                    characters.append({'text': letter, 'x0': left, 'x1': right, 'top': page.height - top,
                                       'bottom': page.height - bottom, 'doctop': page.height - top, 'upright': True})
            finally:
                text.close()
                source.close()
    except PdfiumError:
        return []
    return extract_words(characters)


def alternate_pdf_candidates(content, password, page, encrypted, manual=None):
    words = pdfium_words(content, password, page)
    if not words:
        return
    location = {'format': 'pdf', 'page': page.page_number, 'table': 1, 'layout': 'pdfium-grid',
                'encrypted': encrypted, 'bbox_units': 'points', 'bbox_origin': 'top-left'}
    if manual and manual['separators']:
        left, _, right, _ = page.cropbox
        yield manually_positioned_rows(words, left, right - left, {**location, 'layout': 'pdfium-manual'}, manual)
        return
    for index, table in enumerate(page.find_tables(), 1):
        x = sorted({edge for cell in table.cells for edge in (cell[0], cell[2])})
        y = sorted({edge for row in table.rows for edge in (row.bbox[1], row.bbox[3])})
        yield ruled_word_rows(words, x, y, {**location, 'table': index}, manual)
        if not manual and len(x) == 8:
            yield balance_verified_rows(ruled_word_cells(words, x, y),
                                        {**location, 'layout': 'pdfium-grid-balance-verified', 'table': index})
    if not manual:
        lines = cluster_objects(words, 'top', 3)
        yield group_transaction_lines(positioned_pdf_rows(page, encrypted, lines, layout='pdfium-aligned'))


def row_values(row):
    locator, _, cells, columns = row
    if not locator.get('date_roles_unverified'):
        for order in ('DMY', 'MDY'):
            try:
                day, _, amount, direction = transaction_fields(cells, columns, None, order)
                return day, Decimal(amount), direction
            except (ValueError, OverflowError):
                pass
    return None


def matching_row_bounds(first, second):
    a, b = first.get('bbox'), second.get('bbox')
    if not a or not b or first.get('page') != second.get('page') or first.get('format') != second.get('format'):
        return False
    if first.get('format') == 'pdf' and first.get('bbox_units') != second.get('bbox_units'):
        return False
    for axis in (0, 1):
        span = min(a[axis + 2] - a[axis], b[axis + 2] - b[axis])
        overlap = min(a[axis + 2], b[axis + 2]) - max(a[axis], b[axis])
        if span <= 0 or overlap < .55 * span:
            return False
    return True


def damaged_date(row):
    locator, _, cells, columns = row
    index = columns['date']
    if not locator.get('date_roles_unverified') and locator.get('bbox') and index < len(cells):
        for order in ('DMY', 'MDY'):
            try:
                return parse_date(cells[index], order)[0]
            except (ValueError, OverflowError):
                pass
    return None


def recover_damaged_rows(primary, damaged, alternative):
    """Fill rejected slots only when both readers agree on a nearby transaction."""
    trusted = defaultdict(list)
    for row, values in primary:
        if values is not None:
            trusted[values].append(row[0])
    valid = [(row, values) for row, values in alternative if values is not None and row[0].get('bbox')]
    if not any(matching_row_bounds(row[0], locator)
               for row, values in valid for locator in trusted.get(values, ())):
        return
    accepted_locators = [locator for locators in trusted.values() for locator in locators]
    by_date = defaultdict(list)
    needed_dates = set(damaged.values())
    for candidate, (row, values) in enumerate(valid):
        if values[0] in needed_dates and not any(matching_row_bounds(row[0], locator) for locator in accepted_locators):
            by_date[values[0]].append((candidate, row, values))
    options = {}
    for index, date in damaged.items():
        original = primary[index][0][0]
        matches = [candidate for candidate in by_date[date] if matching_row_bounds(original, candidate[1][0])]
        if len(matches) == 1:
            options[index] = matches[0]
    uses = Counter(item[0] for item in options.values())
    for index, (candidate, row, values) in options.items():
        if uses[candidate] == 1:
            locator, headers, cells, columns = row
            primary[index] = (({**locator, 'recovered_layout': True}, headers, cells, columns), values)
            damaged.pop(index)


def select_row_layout(candidates):
    first_rejected = []
    primary = []
    damaged = {}
    try:
        for rows in candidates:
            pending = []
            with closing(rows):
                for row in rows:
                    check(len(pending) + 1, 'IMPORT_RECORDS', 5000)
                    pending.append((row, row_values(row)))
            if not any(values is not None for _, values in pending):
                if not first_rejected:
                    first_rejected = pending
                continue
            if not primary:
                primary = pending
                damaged = {index: date for index, (row, values) in enumerate(primary)
                           if values is None and (date := damaged_date(row))}
            else:
                recover_damaged_rows(primary, damaged, pending)
            if not damaged:
                break
    except (ResourceLimitError, StatementOcrUnavailable):
        if not primary:
            raise
    finally:
        # A candidate generator can hold a decoded scan open while yielding alternatives.
        close = getattr(candidates, 'close', None)
        if close is not None:
            close()
    yield from (row for row, _ in primary or first_rejected)


def pdf_statement_rows(content, password, page_range, manual=None):
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

        @lru_cache(maxsize=MAX_PDF_PAGES)
        def earlier_grids(number):
            if number > total:
                return ()
            earlier = pdf.pages[number - 1]
            try:
                return pdf_previous_grids(earlier, deadline)
            finally:
                earlier.close()

        for page in pdf.pages[start - 1:end]:
            try:
                if manual:
                    location = {'format': 'pdf', 'page': page.page_number, 'table': 1, 'layout': 'manual-text',
                                'encrypted': encrypted, 'bbox_units': 'points', 'bbox_origin': 'top-left'}
                    if manual['separators']:
                        left, _, right, _ = page.cropbox
                        primary = manually_positioned_rows(page.extract_words(), left, right - left, location, manual)
                    else:
                        primary = pdf_table_rows(page, encrypted, 'manual-ruled', {}, manual)
                    with closing(select_row_layout(chain(
                        (primary,), alternate_pdf_candidates(content, password, page, encrypted, manual),
                        scanned_pdf_candidates(page, encrypted, deadline, manual),
                    ))) as rows:
                        if first := next(rows, None):
                            yield first
                            yield from rows
                            continue
                    yield {**location, 'diagnostic': 'No transaction rows matched the supplied columns'}, None, None, None
                    continue
                lines = cluster_objects(page.extract_words(), 'top', 3)
                direct = (
                    pdf_table_rows(page, encrypted, 'ruled', {}),
                    pdf_table_rows(page, encrypted, 'mixed', HYBRID_TABLE),
                    positioned_pdf_rows(page, encrypted, lines, wrapped_only=True),
                    pdf_table_rows(page, encrypted, 'text', TEXT_TABLE),
                    positioned_pdf_rows(page, encrypted, lines),
                    positioned_pdf_rows(page, encrypted, lines, gap=4),
                )
                grouped = group_transaction_lines(positioned_pdf_rows(page, encrypted, lines, layout='grouped-text'))
                def image_fallback():
                    if lines or page.images or page.curves:
                        yield group_transaction_lines(pdf_rows_with_ocr_header(page, encrypted, lines, deadline))
                        yield from scanned_pdf_candidates(page, encrypted, deadline, earlier_grids=earlier_grids)

                # Preserve existing locators for accepted text rows, with OCR and grouping as fallbacks.
                with closing(select_row_layout(chain(
                    direct, (grouped, pdf_table_rows(page, encrypted, 'balance-verified-ruled', {})),
                    alternate_pdf_candidates(content, password, page, encrypted),
                    continued_pdf_candidates(page, encrypted, earlier_grids), image_fallback(),
                ))) as rows:
                    if first := next(rows, None):
                        yield first
                        yield from rows
                        continue
                diagnostic = UNKNOWN_PDF_TABLE if lines else NO_PDF_TEXT
                location = {'format': 'pdf', 'page': page.page_number, 'encrypted': encrypted,
                            'diagnostic': diagnostic}
                if labels := header_signals(lines):
                    location['header_signals'] = labels
                yield location, None, None, None
            finally:
                page.close()


def image_statement_rows(content, manual=None, page_range=None):
    deadline = monotonic() + 60
    try:
        with Image.open(BytesIO(content), formats=['JPEG', 'PNG', 'TIFF']) as source:
            multipage = source.format == 'TIFF'
            if not multipage and getattr(source, 'n_frames', 1) != 1:
                raise ResourceLimitError('Upload a single-page JPEG or PNG or a multipage TIFF')
            first, last = page_range or (1, MAX_PDF_PAGES + 1 if multipage else 1)
            if page_range and last - first + 1 > MAX_PDF_PAGES:
                raise ResourceLimitError(f'A statement import can read up to {MAX_PDF_PAGES} TIFF pages')

            @lru_cache(maxsize=MAX_PDF_PAGES)
            def earlier_grids(number):
                current = source.tell()
                try:
                    source.seek(number - 1)
                    if source.width * source.height > MAX_PIXELS:
                        return ()
                    with ImageOps.exif_transpose(source).convert('RGB') as prior_image:
                        return scanned_grid_schemas(prior_image, deadline)
                except EOFError:
                    return ()
                finally:
                    source.seek(current)

            for page_number in range(first, last + 1):
                try:
                    source.seek(page_number - 1)
                except EOFError:
                    if page_range is not None:
                        raise ValueError('The selected TIFF page range exceeds the file length') from None
                    break
                if page_range is None and page_number > MAX_PDF_PAGES:
                    raise ResourceLimitError(f'A statement import can read up to {MAX_PDF_PAGES} TIFF pages')
                page = SimpleNamespace(page_number=page_number)
                location = {'format': 'tiff' if multipage else 'image', 'page': page_number, 'table': 1,
                            'layout': 'ocr-grid', 'encrypted': False, 'bbox_units': 'pixels', 'bbox_origin': 'top-left'}
                if source.width * source.height > MAX_PIXELS:
                    raise ResourceLimitError('Statement scan exceeds the 20 megapixel limit per page')
                with ImageOps.exif_transpose(source).convert('RGB') as image:
                    with closing(select_row_layout(raster_scan_candidates(
                        page, image, location, deadline, manual,
                        earlier_grids=earlier_grids if multipage else None,
                    ))) as rows:
                        if first_row := next(rows, None):
                            yield first_row
                            yield from rows
                        else:
                            yield {**location, 'diagnostic': 'No transaction table recognized on this scan page'}, None, None, None
    except FileNotFoundError as exc:
        raise ValueError('Local OCR is unavailable for statement images') from exc
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError('Invalid or oversized statement image') from exc


def statement_layout_page(content, password, page_number):
    """Render an upload for local column mapping without storing the source."""
    with BytesIO() as output:
        if content.startswith(b'%PDF-'):
            try:
                with pdfplumber.open(BytesIO(content), password=password or '') as document:
                    if not 1 <= page_number <= len(document.pages):
                        raise ValueError('The selected PDF page is unavailable')
                    page = document.pages[page_number - 1]
                    if page.width <= 0 or page.height <= 0:
                        raise ValueError('The selected PDF page has invalid dimensions')
                    dpi = min(145, 1440 * 72 / max(page.width, page.height))
                    try:
                        with render_pdf_image(page, resolution=dpi, antialias=True).original as image:
                            image.save(output, 'PNG')
                    finally:
                        page.close()
            except PdfminerException as exc:
                if isinstance(exc.__cause__ or exc.__context__, PDFPasswordIncorrect):
                    raise StatementPasswordError('This PDF requires the correct password') from None
                raise ValueError('The statement page could not be rendered') from None
            except PDFPasswordIncorrect:
                raise StatementPasswordError('This PDF requires the correct password') from None
            except MalformedPDFException:
                raise ValueError('The statement page could not be rendered') from None
        elif any(content.startswith(signature) for signature in IMAGE_EXTENSIONS):
            try:
                with Image.open(BytesIO(content), formats=['JPEG', 'PNG', 'TIFF']) as source:
                    if source.format != 'TIFF' and (page_number != 1 or getattr(source, 'n_frames', 1) != 1):
                        raise ValueError('Select page 1 for a JPEG or PNG statement')
                    source.seek(page_number - 1)
                    if source.width * source.height > MAX_PIXELS:
                        raise ResourceLimitError('Statement scan exceeds the 20 megapixel limit per page')
                    with ImageOps.exif_transpose(source).convert('RGB') as image:
                        image.thumbnail((1440, 1440))
                        image.save(output, 'PNG')
            except (UnidentifiedImageError, Image.DecompressionBombError, OSError):
                raise ValueError('Invalid or oversized statement image') from None
            except EOFError:
                raise ValueError('The selected TIFF page is unavailable') from None
        else:
            raise ValueError('Page view is available for PDF, PNG, JPEG, and TIFF statements')
        return output.getvalue()


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


def workbook_table_rows(rows, location, manual):
    if manual:
        yield from matched_rows(rows, location, manual)
        return
    primary, balance_input = tee(rows)
    rejected = []
    with closing(matched_rows(primary, location)) as mapped:
        for row in mapped:
            if viable_transaction(row[2], row[3]):
                del balance_input
                yield from rejected
                yield row
                yield from mapped
                return
            check(len(rejected) + 1, 'IMPORT_RECORDS', 5000)
            rejected.append(row)
    with closing(balance_verified_rows(balance_input, {**location, 'layout': 'balance-verified-sheet'})) as inferred:
        if first := next(inferred, None):
            yield first
            yield from inferred
            return
    yield from rejected


def excel_statement_rows(content, password, manual=None):
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

                yield from workbook_table_rows(rows(), location, manual)
        finally:
            workbook.close()


def legacy_excel_rows(content, manual=None):
    try:
        # xlrd can emit diagnostics to its logfile for malformed workbooks.
        with StringIO() as diagnostics:
            workbook = xlrd.open_workbook(file_contents=content, on_demand=True,
                                          ragged_rows=True, logfile=diagnostics)
            try:
                if workbook.nsheets > 10:
                    raise ResourceLimitError('Excel workbook contains more than 10 worksheets')
                scanned = 0
                for sheet_index in range(workbook.nsheets):
                    sheet = workbook.sheet_by_index(sheet_index)
                    scanned += sheet.nrows
                    if scanned > 15_000 or sheet.ncols > MAX_COLUMNS:
                        raise ResourceLimitError('Excel statement exceeds worksheet scanning limits')
                    location = {'format': 'xls', 'sheet': sheet.name, 'encrypted': False}

                    def rows():
                        for number in range(sheet.nrows):
                            cells = [xlrd.xldate_as_datetime(cell.value, workbook.datemode)
                                     if cell.ctype == xlrd.XL_CELL_DATE else cell.value
                                     for cell in sheet.row(number)]
                            yield number + 1, cells, None

                    yield from workbook_table_rows(rows(), location, manual)
                    if workbook.on_demand:
                        workbook.unload_sheet(sheet_index)
            finally:
                workbook.release_resources()
    except xlrd.XLRDError as exc:
        if str(exc) == 'Workbook is encrypted':
            raise StatementPasswordError('Save the password-protected .xls statement as .xlsx before uploading') from None
        raise ValueError('The legacy Excel statement could not be read') from None
    except (CompDocError, XLDateError, StructError, IndexError) as exc:
        raise ValueError('The legacy Excel statement could not be read') from exc


def spreadsheet_statement_rows(content, password, manual):
    legacy = content.startswith(BIFF_SIGNATURES)
    if content.startswith(OLE_SIGNATURE):
        with OleFileIO(BytesIO(content)) as container:
            legacy = not container.exists('EncryptionInfo') and (
                container.exists('Workbook') or container.exists('Book'))
    if legacy:
        yield from legacy_excel_rows(content, manual)
    else:
        yield from excel_statement_rows(content, password, manual)


def statement_rows(content, password, *, page_range=None, manual=None):
    """Yield raw row locators and fields. Decrypted workbook buffers close on return."""
    if content.startswith(b'%PDF-'):
        rows = pdf_statement_rows(content, password, page_range, manual)
    elif any(content.startswith(signature) for signature in IMAGE_EXTENSIONS):
        if page_range is not None and not content.startswith(TIFF_SIGNATURES):
            raise ValueError('Page ranges are only available for PDF and TIFF statements')
        rows = image_statement_rows(content, manual, page_range)
    elif content.startswith((OLE_SIGNATURE, b'PK\x03\x04', *BIFF_SIGNATURES)):
        if page_range is not None:
            raise ValueError('Page ranges are only available for PDF and TIFF statements')
        if manual and manual['separators']:
            raise ValueError('Column divider percentages are for PDFs and images')
        rows = spreadsheet_statement_rows(content, password, manual)
    else:
        raise ValueError('Upload a bank statement as PDF, Excel .xlsx or .xls, PNG, JPEG, or TIFF')
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


def plausible_date(value, date_order=None):
    for order in (date_order,) if date_order else ('DMY', 'MDY'):
        try:
            parse_date(value, order)
            return True
        except (ValueError, OverflowError):
            pass
    return False


def viable_transaction(cells, columns):
    date_column = columns['date']
    if date_column >= len(cells) or not cells[date_column].strip():
        return False
    for order in ('DMY', 'MDY'):
        try:
            transaction_fields(cells, columns, None, order)
            return True
        except (ValueError, OverflowError):
            pass
    return False


def parse_amount(value, currency):
    value = ' '.join(value.split()).translate(str.maketrans('−‐‑‒–—', '------'))
    if not value or value == '-':
        return Decimal(0)
    prefix = re.match(r'^(₹|€|£|Rs\.?|[A-Za-z]{3})\s*(?=[+\-\d(])', value, re.IGNORECASE)
    if prefix:
        unit = prefix[1].upper()
        units = {'₹': 'INR', 'RS': 'INR', 'RS.': 'INR', '€': 'EUR', '£': 'GBP'}
        if currency and units.get(unit, unit) != currency:
            raise ValueError('Amount currency differs from the selected statement currency')
        value = value[prefix.end():]
    value = re.sub(r'(?<=\d)\s*([,.])\s*(?=\d)', r'\1', value)
    if value.startswith('(') and value.endswith(')'):
        value = '-' + value[1:-1]
    if DECIMAL_COMMA_AMOUNT.fullmatch(value):
        value = value.replace('.', '').replace(' ', '').replace(',', '.')
    elif SPACE_GROUPED_AMOUNT.fullmatch(value):
        value = value.replace(' ', '')
    if not re.fullmatch(r'[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?', value):
        raise ValueError('Invalid transaction amount')
    try:
        amount = Decimal(value.replace(',', ''))
    except InvalidOperation:
        raise ValueError('Invalid transaction amount') from None
    if not amount.is_finite() or abs(amount) >= Decimal('1e18'):
        raise ValueError('Transaction amount is outside supported bounds')
    return amount


def split_amount_direction(value):
    suffix = AMOUNT_DIRECTION_SUFFIX.search(value)
    if suffix:
        return value[:suffix.start()].strip(), AMOUNT_DIRECTIONS[suffix[1].lower()]
    return value, None


def parse_balance(value, currency):
    text, marker = split_amount_direction(value)
    balance = parse_amount(text, currency)
    if marker == 'credit' and balance < 0:
        raise ValueError('Balance direction conflicts with its sign')
    return -abs(balance) if marker == 'debit' else balance


def transaction_fields(cells, columns, currency, date_order):
    def cell(key):
        index = columns.get(key, len(cells))
        return cells[index].strip() if index < len(cells) else ''

    observed_currency = cell('currency').upper()
    if currency and observed_currency and observed_currency != currency:
        raise ValueError('Row currency differs from the selected statement currency')
    if not cell('date'):
        raise ValueError('Mapped date column is empty')
    event_time, time_basis = parse_date(cell('date'), date_order)
    if {'debit', 'credit'} <= columns.keys():
        debit_raw, debit_marker = split_amount_direction(cell('debit'))
        credit_raw, credit_marker = split_amount_direction(cell('credit'))
        if debit_marker == 'credit' or credit_marker == 'debit':
            raise ValueError('Amount direction conflicts with the debit or credit column')
        debit, credit = parse_amount(debit_raw, currency), parse_amount(credit_raw, currency)
        if min(debit, credit) < 0 or (debit > 0) == (credit > 0):
            raise ValueError('Expected exactly one positive debit or credit')
        amount, direction = (debit, 'debit') if debit else (credit, 'credit')
    else:
        value, marker = split_amount_direction(cell('amount'))
        signed = parse_amount(value, currency)
        direction_field = cell('direction').casefold().rstrip('.')
        direction = AMOUNT_DIRECTIONS.get(direction_field)
        if (not signed or (direction_field and not direction) or (direction and marker and direction != marker)
                or (signed < 0 and (direction or marker) == 'credit')):
            raise ValueError('Invalid signed amount or debit/credit direction')
        amount, direction = abs(signed), direction or marker or ('debit' if signed < 0 else 'credit')
    return event_time, time_basis, str(amount), direction


def validate_statement_corrections(corrections):
    if not isinstance(corrections, dict) or len(corrections) > 25:
        raise ValueError('Supply corrections for up to 25 preview rows')
    for row_id, fields in corrections.items():
        if (not isinstance(row_id, str) or not re.fullmatch(r'[a-f0-9]{32}', row_id)
                or not isinstance(fields, dict) or not fields
                or any(key not in CORRECTABLE_STATEMENT_FIELDS or not isinstance(value, str) or len(value) > 64
                       for key, value in fields.items())):
            raise ValueError('Invalid statement row correction')
    return corrections


def statement_records(content, password, currency, date_order, *, page_range=None, preview=False, manual=None,
                      corrections=None):
    digest = sha256(content).hexdigest()
    supplied = validate_statement_corrections(corrections) if corrections is not None else {}
    remaining = set(supplied)
    records = []
    for locator, headers, cells, columns in statement_rows(content, password, page_range=page_range, manual=manual):
        if columns is None:
            records.append({'locator': locator, 'error': locator['diagnostic']})
            continue
        if locator.get('date_roles_unverified'):
            issue = {'locator': locator, 'error': 'Value and posting dates differ. Map the date columns manually.'}
            if preview:
                issue['fields'] = {key: cells[index] for key, index in columns.items() if index < len(cells)}
            records.append(issue)
            continue
        candidate_id = uid(digest, locator, headers, cells, columns, currency, date_order) if preview or supplied else None
        raw = {key: cells[index].strip() for key, index in columns.items() if index < len(cells)}
        repairable = sorted(CORRECTABLE_STATEMENT_FIELDS & raw.keys())
        correction = supplied.get(candidate_id)
        adjusted = None
        try:
            values = transaction_fields(cells, columns, currency, date_order)
        except (ValueError, OverflowError) as exc:
            issue = {'locator': locator, 'error': str(exc), 'candidate_id': candidate_id}
            if correction:
                if set(correction) - set(repairable):
                    raise ValueError('A correction refers to a column missing from the extracted row')
                remaining.discard(candidate_id)
                adjusted = list(cells)
                for field, value in correction.items():
                    adjusted[columns[field]] = value.strip()
                try:
                    values = transaction_fields(adjusted, columns, currency, date_order)
                except (ValueError, OverflowError) as corrected_error:
                    issue['error'] = str(corrected_error)
                    adjusted = None
                    if not preview:
                        raise ValueError(f'A corrected row still failed validation. {corrected_error}') from None
            if adjusted is None:
                if preview:
                    issue.update(fields={**raw, **(correction or {})}, repairable=repairable)
                records.append(issue)
                continue
        if candidate_id in remaining:
            raise ValueError('Only rejected rows can be corrected')
        event_time, time_basis, amount, direction = values
        transaction_id = 'transaction:' + uid(STATEMENT_DATASET, digest, locator)
        day = event_time[:10]
        label = f'{day} · {direction.title()} {amount} {currency}'
        record = {
            'locator': locator, 'method': METHOD, 'extraction_version': '1',
            'event_time': event_time, 'time_basis': time_basis, 'passage': json_row([headers, cells]),
            'statement_label': label,
            'facts': [node('Transaction', transaction_id, label, event_time=event_time, time_basis=time_basis,
                           amount_paid=amount, payment_currency=currency, direction=direction)],
        }
        if adjusted is not None:
            record['statement_correction'] = {
                field: {'extracted': raw[field], 'corrected': adjusted[columns[field]]}
                for field in correction
            }
            record['confidence_basis'] = 'transaction fields include reviewer corrections'
            record['warnings'] = ['Transaction fields corrected during review']
        if preview:
            record.update(fields={**raw, **(correction or {})}, candidate_id=candidate_id)
            if adjusted is not None:
                record.update(corrected=True, repairable=repairable)
            record['normalized'] = {'debit': amount if direction == 'debit' else '',
                                    'credit': amount if direction == 'credit' else ''}
        records.append(record)
    if remaining:
        raise ValueError('A corrected row no longer matches the selected file, pages, or import settings. Preview the statement again.')
    if not any('facts' in record for record in records):
        rejected = [record for record in records if record['locator'].get('row')]
        if rejected:
            if preview:
                return records
            reasons = Counter(record['error'] for record in rejected)
            details = '. '.join(f'{reason} ({count})' for reason, count in reasons.most_common())
            raise ValueError(f'Table found. All {len(rejected)} candidate rows failed validation. {details}.')
        if manual:
            raise ValueError('No transaction rows matched this mapping. Check the column numbers and any divider positions.')
        if records and all(record['error'] == NO_PDF_TEXT for record in records):
            raise ValueError('No usable text was found on the selected PDF pages. Try a text PDF or an Excel .xlsx export from the bank.')
        unknown_pages = [record['locator'] for record in records if record['error'] == UNKNOWN_PDF_TABLE]
        if unknown_pages:
            strongest = max(unknown_pages, key=lambda page: len(page.get('header_signals', [])))
            message = 'VRITRA read text in the PDF but could not identify the transaction columns.'
            if labels := strongest.get('header_signals'):
                message += f' Possible headings on page {strongest["page"]}: {", ".join(labels)}.'
            else:
                message += ' No recognizable header line was found in the selected pages.'
            raise ValueError(message)
        raise ValueError('No supported statement table found. Use a text PDF or .xlsx with Date and Debit/Credit or Amount columns.')
    return records


def statement_page_coverage(records):
    pages = {}
    for row in records:
        locator = row['locator']
        number = locator.get('page')
        if number is None:
            continue
        page = pages.setdefault(number, {'page': number, 'accepted': 0, 'rejected': 0, 'diagnostic': None})
        if 'facts' in row:
            page['accepted'] += 1
        elif 'row' in locator:
            page['rejected'] += 1
        elif not page['diagnostic']:
            page['diagnostic'] = row['error']
    return [pages[number] for number in sorted(pages)]


def statement_preview(records, currency, page_range=None):
    """Review up to 25 candidates in source order, verifying adjacent printed balances."""
    accepted = [row for row in records if 'facts' in row]
    dates = [row['event_time'][:10] for row in accepted]
    newest_first = dates == sorted(dates, reverse=True) and dates != sorted(dates)
    checks = {}
    previous = None
    for row in reversed(records) if newest_first else records:
        raw_balance = row.get('fields', {}).get('balance', '')
        if 'facts' not in row or not re.search(r'\d', raw_balance):
            previous = None
            continue
        try:
            balance = parse_balance(raw_balance, currency)
        except ValueError:
            previous = None
            continue
        attrs = row['facts'][0]['attrs']
        amount = Decimal(attrs['amount_paid'])
        change = amount if attrs['direction'] == 'credit' else -amount
        if previous is not None:
            checks[id(row)] = 'Matched' if previous + change == balance else 'Mismatch'
        previous = balance
    candidates = [row for row in records if 'fields' in row]
    visible = candidates[:25]
    if not accepted:
        visible = sorted(candidates, key=lambda row: not bool(row['fields'].get('date')))[:25]
    return {
        'accepted': len(accepted),
        'rejected': len(records) - len(accepted),
        'page_range': list(page_range) if page_range else None,
        'page_coverage': statement_page_coverage(records),
        'recovered_layout_rows': sum(bool(row['locator'].get('recovered_layout')) for row in accepted),
        'balance_inferred_pages': sorted({
            row['locator']['page'] for row in accepted
            if 'page' in row['locator'] and 'balance-verified' in row['locator'].get('layout', '')
        }),
        'balance_inferred_sheets': sorted({
            row['locator']['sheet'] for row in accepted
            if 'sheet' in row['locator'] and 'balance-verified' in row['locator'].get('layout', '')
        }),
        'rows': [
            {'locator': row['locator'], 'fields': row['fields'], 'normalized': row.get('normalized'),
             'candidate_id': row.get('candidate_id'), 'repairable': row.get('repairable', []),
             'corrected': row.get('corrected', False),
             'error': row.get('error'),
             'balance_check': checks.get(id(row), 'Unverified')}
            for row in visible
        ],
    }


def stored_statement_row(item, settings):
    headers, cells = json.loads(item['passage'])
    locator = item['source_locator']
    manual = locator.get('statement_layout')
    columns = {name: index - 1 for name, index in manual['columns'].items()} if manual else header_map(headers) or {}
    fields = {name: cells[index] for name, index in columns.items() if index < len(cells)}
    for name, value in item.get('statement_correction', {}).get('fields', {}).items():
        fields[name] = value['corrected']
        if name in columns and columns[name] < len(cells):
            cells[columns[name]] = value['corrected']
    normalized = {}
    if columns:
        try:
            _, _, amount, direction = transaction_fields(cells, columns, settings['currency'], settings['date_order'])
            normalized[direction] = amount
        except (ValueError, OverflowError):
            pass
    return {'evidence_id': item['id'], 'locator': locator, 'fields': fields, 'normalized': normalized,
            'event_time': item['event_time'], 'corrected': bool(item.get('statement_correction'))}
