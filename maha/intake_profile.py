"""Read a bounded file sample to suggest an existing local intake adapter."""

import csv
from io import BytesIO, StringIO
import json
import re
from time import monotonic
from zipfile import BadZipFile, ZipFile
from xml.etree.ElementTree import ParseError

from defusedxml.common import DefusedXmlException
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.xml.functions import fromstring
import pdfplumber
from PIL import Image, ImageOps
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils import cluster_objects
from pdfplumber.utils.exceptions import MalformedPDFException, PdfminerException

from .ingestion import CDR_HEADER, HISTORY_HEADER, IBM_HEADER
from .limits import ResourceLimitError
from .document_intake import MAX_PIXELS, render_pdf_image
from .report_intake import raster_words, report_header
from .statements import (BIFF_SIGNATURES, IMAGE_EXTENSIONS, MAX_COLUMNS, OLE_SIGNATURE, header_map,
                         positioned_header, positioned_header_groups, ruled_word_cells)


def profile(file_type, kind=None):
    return {'file_type': file_type, 'kind': kind}


def text_kind(text, suffix):
    normalized = ' '.join(text.upper().split())
    if re.search(r'\bFIRST INFORMATION REPORT\b', normalized):
        return 'fir-document' if suffix == 'document' else None
    if re.search(r'\b(?:IN THE (?:HIGH COURT|COURT OF)|SUPREME COURT OF INDIA)\b', normalized):
        return 'judgment-document' if suffix == 'document' else 'judgment'
    return None


def table_kind(cells):
    for kind in ('calls', 'wires'):
        if report_header(cells, kind):
            return kind + '-document'
    return 'bank-statement' if header_map([cell or '' for cell in cells]) else None


def scan_kind(image):
    if image.width * image.height > MAX_PIXELS:
        return None
    try:
        words, vertical, horizontal = raster_words(image, monotonic() + 12)
    except (OSError, ValueError, ResourceLimitError):
        return None
    for _, cells, _ in list(ruled_word_cells(words, vertical, horizontal))[:20]:
        if kind := table_kind(cells):
            return kind
    lines = cluster_objects(words, 'top', 3)
    for line in lines[:32]:
        if kind := table_kind([group[0] for group in positioned_header_groups(line)]):
            return kind
    return text_kind(' '.join(word['text'] for word in words[:1000]), 'document')


def profile_pdf(content):
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            samples = []
            has_images = False
            for page in pdf.pages[:2]:
                try:
                    if len(page.chars) > 100_000:
                        raise ResourceLimitError('The PDF page exceeds the intake inspection limit')
                    text = page.extract_text() or ''
                    if 'MAHA-DEMO-STATEMENT v1' in text:
                        return profile('Digital PDF', 'pdf')
                    samples.append(text[:6000].strip())
                    has_images = has_images or bool(page.images)
                    if not text.strip():
                        continue
                    for table in page.find_tables():
                        for row in table.extract()[:12]:
                            if kind := table_kind(row):
                                return profile('Digital PDF', kind)
                    lines = cluster_objects(page.extract_words(), 'top', 3)[:32]
                    for line in lines:
                        if kind := table_kind([group[0] for group in positioned_header_groups(line)]):
                            return profile('Digital PDF', kind)
                    if any(positioned_header(lines, index, 6) for index in range(len(lines))):
                        return profile('Digital PDF', 'bank-statement')
                finally:
                    page.close()
            if not samples:
                raise ValueError('The PDF contains no pages')
            if not any(samples):
                kind = None
                first = pdf.pages[0]
                if has_images and first.width * first.height * (180 / 72) ** 2 <= MAX_PIXELS:
                    try:
                        with render_pdf_image(first, resolution=180, antialias=True).original as image:
                            kind = scan_kind(image)
                    finally:
                        first.close()
                return profile('Scanned PDF' if has_images else 'PDF without readable text', kind)
            return profile('Digital PDF' if all(samples) else 'Mixed PDF', text_kind(' '.join(samples), 'document'))
    except PDFPasswordIncorrect:
        return profile('Password-protected PDF')
    except PdfminerException as exc:
        if isinstance(exc.__cause__ or exc.__context__, PDFPasswordIncorrect):
            return profile('Password-protected PDF')
        raise ValueError('The PDF could not be read') from None
    except (MalformedPDFException, PDFSyntaxError):
        raise ValueError('The PDF could not be read') from None


def profile_excel(content):
    try:
        stream = BytesIO(content)
        with ZipFile(stream) as archive:
            entries = archive.infolist()
            if len(entries) > 2000 or sum(item.file_size for item in entries) > 64 * 1024 * 1024:
                raise ResourceLimitError('Expanded Excel workbook exceeds the processing limit')
            if 'xl/workbook.xml' not in archive.namelist():
                raise ValueError('Choose an Excel .xlsx workbook')
            fromstring(archive.read('xl/workbook.xml'))
        stream.seek(0)
        workbook = load_workbook(stream, read_only=True, data_only=True, keep_links=False)
        try:
            for sheet in workbook.worksheets[:3]:
                if any(header_map([str(cell) if cell is not None else '' for cell in row])
                       for row in sheet.iter_rows(max_col=MAX_COLUMNS, max_row=25, values_only=True)):
                    return profile('Excel workbook', 'bank-statement')
        finally:
            workbook.close()
    except (BadZipFile, InvalidFileException, ParseError, DefusedXmlException, KeyError, OSError):
        raise ValueError('The Excel workbook could not be read') from None
    return profile('Excel workbook')


def inspect_intake(content):
    if content.startswith(b'%PDF-'):
        return profile_pdf(content)
    if content.startswith(b'PK\x03\x04'):
        return profile_excel(content)
    if content.startswith((OLE_SIGNATURE, *BIFF_SIGNATURES)):
        return profile('Legacy or password-protected Excel workbook')
    if any(content.startswith(signature) for signature in IMAGE_EXTENSIONS):
        try:
            with Image.open(BytesIO(content), formats=['JPEG', 'PNG']) as image:
                if image.width * image.height <= MAX_PIXELS:
                    with ImageOps.exif_transpose(image).convert('RGB') as rotated:
                        return profile('Scanned image', scan_kind(rotated))
        except OSError:
            pass
        return profile('Scanned image')
    text = content[:32_768].decode('utf-8-sig', errors='replace')
    if not text.strip() or '\x00' in text:
        raise ValueError('Choose a PDF, Excel workbook, scanned image, CSV, JSON or text file')
    if text.lstrip().startswith('['):
        if len(content) <= 32_768:
            try:
                rows = json.loads(text)
            except (ValueError, RecursionError):
                return profile('JSON')
            if rows and isinstance(rows[0], dict) and {'text', 'document_id', 'filed_date', 'synthetic'} <= rows[0].keys():
                return profile('JSON', 'narrative')
        return profile('JSON')
    header = next(csv.reader(StringIO(text)), [])
    for known, kind in ((IBM_HEADER, 'ibm'), (CDR_HEADER, 'cdr'), (HISTORY_HEADER, 'history')):
        if header == known:
            return profile('CSV', kind)
    if kind := text_kind(text, 'text'):
        return profile('Text document', kind)
    return profile('CSV' if len(header) > 1 else 'Text document')
