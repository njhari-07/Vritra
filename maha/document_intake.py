"""Local document extraction for FIRs and judgments."""
import csv
from hashlib import sha256
from contextlib import closing
from io import BytesIO, StringIO
import os
import re
from pathlib import Path
import shutil
import subprocess
from threading import BoundedSemaphore
from time import monotonic

from PIL import Image, ImageOps, UnidentifiedImageError
import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError
from pdfplumber.utils.exceptions import MalformedPDFException

from .judgments import judgment_records
from .limits import ResourceLimitError
from .nlp import raw_text_records

MAX_PIXELS = 20_000_000
MAX_PAGES = 20
MAX_CHARACTERS = 100_000
_slots = BoundedSemaphore(1)


def _ocr(image, deadline, *, words=False):
    root = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime'
    bundled = root / 'usr/bin/tesseract'
    binary = shutil.which('tesseract')
    environment = os.environ.copy()
    environment.setdefault('OMP_THREAD_LIMIT', '1')
    if not binary and bundled.is_file():
        binary = str(bundled)
        libraries = str(root / 'usr/lib/x86_64-linux-gnu')
        environment['LD_LIBRARY_PATH'] = libraries + (
            ':' + environment['LD_LIBRARY_PATH'] if environment.get('LD_LIBRARY_PATH') else '')
        environment['TESSDATA_PREFIX'] = str(root / 'usr/share/tesseract-ocr/5/tessdata')
    if not binary:
        raise FileNotFoundError('Local OCR is unavailable. Install Tesseract and its English language data.')
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise ResourceLimitError('Document OCR exceeded its time budget')
    with BytesIO() as pixels:
        image.save(pixels, format='PNG')
        try:
            result = subprocess.run(
                [binary, 'stdin', 'stdout', '-l', 'eng', *(['--psm', '11', 'tsv'] if words else [])],
                input=pixels.getvalue(),
                capture_output=True, timeout=min(20, remaining), env=environment,
            )
        except subprocess.TimeoutExpired as exc:
            raise ResourceLimitError('Document OCR exceeded its time budget') from exc
    if result.returncode:
        raise FileNotFoundError('Local OCR could not run. Check Tesseract and its English language data.')
    return result.stdout.decode('utf-8')


def ocr_pdf_word_band(page, top, bottom, deadline):
    """Recover positioned words from a small region of an already-open PDF page."""
    resolution = 200
    width = page.width * resolution / 72
    height = page.height * resolution / 72
    if min(width, height) <= 0 or width * height > MAX_PIXELS:
        raise ResourceLimitError('Statement page exceeds the OCR size limit')
    if not _slots.acquire(blocking=False):
        raise ResourceLimitError('Local OCR is busy. Retry the statement upload.')
    try:
        try:
            raster = page.to_image(resolution=resolution, antialias=True)
        except MalformedPDFException as exc:
            raise ValueError('The statement header could not be rendered for OCR') from exc
        origin_x, origin_y = raster.bbox[:2]
        scale = raster.scale
        with raster.original as image:
            start = max(0, round((top - origin_y) * scale))
            end = min(image.height, round((bottom - origin_y) * scale))
            if start >= end:
                return []
            with image.crop((0, start, image.width, end)) as band:
                data = _ocr(band, deadline, words=True)
    finally:
        _slots.release()
    words = []
    for item in csv.DictReader(StringIO(data), delimiter='\t'):
        if item['level'] != '5' or not item['text'] or not item['text'].strip():
            continue
        x, y = int(item['left']), int(item['top'])
        w, h = int(item['width']), int(item['height'])
        words.append({'text': item['text'], 'x0': origin_x + x / scale, 'x1': origin_x + (x + w) / scale,
                      'top': origin_y + (start + y) / scale, 'bottom': origin_y + (start + y + h) / scale})
    return words


def _usable(text):
    if re.search(r'\(cid:\d+\)', text):
        return False
    visible = [character for character in text if not character.isspace()]
    return bool(visible) and sum(character.isprintable() and character != '\ufffd'
                                 for character in visible) / len(visible) >= .95


def _pdf_pages(content, deadline, wanted=None):
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            if not 1 <= len(pdf.pages) <= MAX_PAGES:
                raise ResourceLimitError(f'PDF must contain 1–{MAX_PAGES} pages')
            for number, page in enumerate(pdf.pages, 1):
                try:
                    if wanted is not None and number not in wanted:
                        continue
                    if monotonic() >= deadline:
                        raise ResourceLimitError('Document extraction exceeded its time budget')
                    text = page.extract_text() or ''
                    if _usable(text):
                        yield number, text, 'pdf-text'
                        continue
                    width, height = page.width * 200 / 72, page.height * 200 / 72
                    if min(width, height) <= 0 or width * height > MAX_PIXELS:
                        raise ResourceLimitError('PDF page exceeds the OCR image size limit')
                    with page.to_image(resolution=200).original as image:
                        yield number, _ocr(image, deadline), 'tesseract-eng'
                finally:
                    page.close()
    except PDFPasswordIncorrect as exc:
        raise ValueError('Provide an unlocked copy of the PDF') from exc
    except PDFSyntaxError as exc:
        raise ValueError('Invalid PDF document') from exc


def _image_pages(content, deadline):
    try:
        with Image.open(BytesIO(content), formats=['JPEG', 'PNG']) as image:
            if image.width * image.height > MAX_PIXELS:
                raise ResourceLimitError('Image exceeds the 20 megapixel OCR limit')
            if getattr(image, 'n_frames', 1) != 1:
                raise ValueError('Upload a single-page image')
            with ImageOps.exif_transpose(image).convert('RGB') as oriented:
                yield 1, _ocr(oriented, deadline), 'tesseract-eng'
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        if isinstance(exc, FileNotFoundError):
            raise
        raise ValueError('Invalid or oversized JPEG/PNG image') from exc


def render_source_page(content, page_number):
    """Return a safe raster preview of one authorized source page."""
    if not _slots.acquire(blocking=False):
        raise ResourceLimitError('Document processing is busy. Retry the page preview.')
    try:
        with BytesIO() as output:
            if content.startswith(b'%PDF-'):
                try:
                    with pdfplumber.open(BytesIO(content)) as pdf:
                        if not 1 <= page_number <= min(len(pdf.pages), MAX_PAGES):
                            raise ValueError('Source page is unavailable')
                        page = pdf.pages[page_number - 1]
                        width, height = page.width * 120 / 72, page.height * 120 / 72
                        if min(width, height) <= 0 or width * height > MAX_PIXELS:
                            raise ResourceLimitError('Source page exceeds the preview size limit')
                        with page.to_image(resolution=120).original as image:
                            image.save(output, format='PNG')
                except (PDFPasswordIncorrect, PDFSyntaxError) as exc:
                    raise ValueError('Source PDF cannot be previewed') from exc
            elif page_number == 1:
                try:
                    with Image.open(BytesIO(content), formats=['JPEG', 'PNG']) as image:
                        if image.width * image.height > MAX_PIXELS:
                            raise ResourceLimitError('Source image exceeds the preview size limit')
                        with ImageOps.exif_transpose(image).convert('RGB') as oriented:
                            oriented.thumbnail((1600, 2000))
                            oriented.save(output, format='PNG')
                except (Image.DecompressionBombError, OSError) as exc:
                    raise ValueError('Source image cannot be previewed') from exc
            else:
                raise ValueError('Source page is unavailable')
            return output.getvalue()
    finally:
        _slots.release()


def document_pages(content, deadline, wanted=None):
    """Select the same page reader for intake and evidence verification."""
    if content.startswith(b'%PDF-'):
        return 'pdf', _pdf_pages(content, deadline, wanted)
    if content.startswith(b'\xff\xd8\xff'):
        return 'jpg', _image_pages(content, deadline)
    if content.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png', _image_pages(content, deadline)
    raise ValueError('Upload a PDF, JPEG or PNG document')


def replay_document_pages(content, deadline, wanted):
    if not _slots.acquire(blocking=False):
        raise ResourceLimitError('Document processing is busy. Retry the evidence audit.')
    try:
        _, pages = document_pages(content, deadline, wanted)
        with closing(pages):
            return {
                number: (text.removeprefix('\ufeff'), method)
                for number, text, method in pages if number in wanted
            }
    finally:
        _slots.release()


def extract_document(content, *, judgment):
    """Return source extension and review-only records; never publish partial extraction."""
    if not _slots.acquire(blocking=False):
        raise ResourceLimitError('Another document is being extracted. Retry when it finishes.')
    try:
        deadline = monotonic() + 90
        extension, pages = document_pages(content, deadline)
        records, characters = [], 0
        for number, text, method in pages:
            text = text.removeprefix('\ufeff')
            if monotonic() >= deadline:
                raise ResourceLimitError('Document extraction exceeded its time budget')
            characters += len(text)
            if characters > MAX_CHARACTERS:
                raise ResourceLimitError('Document exceeds 100,000 extracted characters')
            if not _usable(text):
                records.append({'locator': {'page': number}, 'error': 'No readable text on this page'})
                continue
            digest = sha256(text.encode()).hexdigest()
            observations = judgment_records(text.encode()) if judgment else raw_text_records(text)
            page_records = list(observations)
            if judgment and not page_records:
                page_records.append({
                    'locator': {'char_start': 0, 'char_end': min(len(text), 360),
                                'text_label': 'Source excerpt'},
                    'passage': text[:360], 'method': 'document-page-excerpt', 'facts': [],
                })
            for record in page_records:
                locator = record['locator']
                locator.update(page=number, text_method=method, page_text_sha256=digest,
                               offset_basis='extracted page text')
                if record['method'] == 'en_legal_ner_sm':
                    start, end = locator['char_start'], locator['char_end']
                    left = max(0, start - 180)
                    record['review_excerpt'] = {'start': left, 'text': text[left:end + 180]}
                records.append(record)
                if len(records) > 5000:
                    raise ResourceLimitError('Document exceeds the extraction record limit')
        return extension, records
    finally:
        _slots.release()
