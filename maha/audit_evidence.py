"""Check sampled evidence locators against the retained source."""
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
from time import monotonic

from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.pdfparser import PDFSyntaxError

from .document_intake import replay_document_pages
from .ingestion import pdf_records
from .limits import ResourceLimitError
from .store import Store
from .statements import METHOD as STATEMENT_METHOD


CSV_METHODS = {'csv-positional', 'synthetic-history-csv'}
TEXT_METHODS = {
    'explicit-identifier-rule', 'spacy-en_core_web_sm', 'document-metadata',
    'raw-text-source', 'en_legal_ner_sm',
    'document-place-mention',
}


def audit_source(blob, records, deadline):
    same_source = [(data['source_locator'], data['extraction_method']) for data in records]
    wanted_pages = {locator.get('page') for locator, method in same_source
                    if method != 'reviewed-report-table' and locator.get('text_method') and type(locator.get('page')) is int}
    pages, pdf_rows, raw_text, csv_lines, narratives = {}, {}, None, None, None
    page_error = None
    if wanted_pages:
        try:
            pages = replay_document_pages(blob, deadline, wanted_pages)
        except (FileNotFoundError, ResourceLimitError) as exc:
            page_error = ('unverified', str(exc))
        except (ValueError, OSError, PDFPasswordIncorrect, PDFSyntaxError):
            page_error = ('passage_mismatches', 'Source pages could not be extracted')
    if any(method == 'pdfplumber-fixed-v1' for _, method in same_source):
        try:
            pdf_rows = {(item['locator']['page'], item['locator']['row']): item
                        for item in pdf_records(blob) if 'passage' in item}
        except (ValueError, OSError, PDFPasswordIncorrect, PDFSyntaxError):
            pass
    if any(method in CSV_METHODS | TEXT_METHODS and not locator.get('text_method')
           for locator, method in same_source):
        try:
            raw_text = blob.decode('utf-8-sig')
            if any(method in CSV_METHODS for _, method in same_source):
                csv_lines = io.StringIO(raw_text, newline='').readlines()
            if any('document_ordinal' in locator for locator, _ in same_source):
                narratives = json.loads(raw_text)
        except ValueError:
            pass
    return pages, page_error, pdf_rows, raw_text, csv_lines, narratives


def check_span(text, locator, passage):
    start, end = locator.get('char_start'), locator.get('char_end')
    if not isinstance(text, str):
        return 'passage_mismatches', 'Source text could not be read'
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        return 'invalid_locators', 'Character span falls outside source text'
    if text[start:end] != passage:
        return 'passage_mismatches', 'Passage differs from source text at the recorded span'
    return None


def check_record(data, source):
    pages, page_error, pdf_rows, raw_text, csv_lines, narratives = source
    locator, passage = data['source_locator'], data['passage']
    method = data['extraction_method']
    if not locator:
        return 'missing_locators', 'Missing source locator'
    if method == STATEMENT_METHOD:
        reason = 'Encrypted statement requires password replay' if locator.get('encrypted') else 'Verify the statement row from its evidence panel'
        return 'unverified', reason
    if method == 'reviewed-report-table':
        return 'unverified', 'Verify this report row against its source page.'
    if text_method := locator.get('text_method'):
        number = locator.get('page')
        if type(number) is not int or number < 1:
            return 'invalid_locators', 'Invalid document page number'
        if page_error:
            return page_error
        if number not in pages:
            return 'invalid_locators', 'Document page is unavailable'
        text, observed_method = pages[number]
        if (text_method != observed_method
                or locator.get('page_text_sha256') != hashlib.sha256(text.encode()).hexdigest()):
            return 'passage_mismatches', 'Reproduced page text or extraction method differs'
        return check_span(text, locator, passage)
    if method in CSV_METHODS:
        first = locator.get('line_start')
        last = locator.get('line_end', first)
        if csv_lines is None:
            return 'passage_mismatches', 'CSV source could not be decoded'
        if type(first) is not int or type(last) is not int or not 1 <= first <= last <= len(csv_lines):
            return 'invalid_locators', 'CSV locator falls outside source lines'
        try:
            data = json.loads(passage)
            rows = list(csv.reader(csv_lines[first - 1:last], strict=True))
        except (csv.Error, TypeError, ValueError):
            return 'passage_mismatches', 'CSV passage or source row could not be parsed'
        if rows != [data]:
            return 'passage_mismatches', 'CSV fields differ from the recorded source rows'
        return None
    if method in TEXT_METHODS:
        if 'document_ordinal' in locator:
            ordinal = locator['document_ordinal']
            if (not isinstance(narratives, list) or type(ordinal) is not int
                    or not 1 <= ordinal <= len(narratives) or not isinstance(narratives[ordinal - 1], dict)):
                return 'invalid_locators', 'Invalid narrative document ordinal'
            raw_text = narratives[ordinal - 1].get('text')
        return check_span(raw_text, locator, passage)
    if method == 'pdfplumber-fixed-v1':
        page, row = locator.get('page'), locator.get('row')
        expected = pdf_rows.get((page, row)) if type(page) is int and type(row) is int else None
        if expected is None or locator != expected['locator']:
            return 'invalid_locators', 'Fixed-layout PDF row locator could not be reproduced'
        if passage != expected['passage']:
            return 'passage_mismatches', 'PDF fields differ from the recorded row'
        return None
    return 'unverified', 'Extraction method has no source comparison'


def audit_evidence_correctness(ledger: Store, sample_limit: int = 500, *, cases=None):
    """Sample cases before loading any blobs and check one source at a time."""
    if sample_limit < 1:
        raise ValueError('Audit sample size must be positive')
    by_source = defaultdict(list)
    discrepancies = Counter(dict.fromkeys((
        'missing_locators', 'invalid_locators', 'passage_mismatches', 'source_blob_missing', 'source_blob_mismatch',
    ), 0))
    modalities = defaultdict(Counter)
    statuses = Counter()
    samples = []
    deadline = monotonic() + 30

    with ledger.db() as db:
        if cases is None:
            rows = db.execute('SELECT * FROM evidence ORDER BY id LIMIT ?', (sample_limit,))
        elif cases:
            places = ','.join('?' for _ in cases)
            rows = db.execute(f'SELECT * FROM evidence WHERE case_id IN ({places}) ORDER BY id LIMIT ?',
                              (*cases, sample_limit))
        else:
            rows = ()
        for row in rows:
            by_source[row['source_id']].append((row['id'], row['case_id'], json.loads(row['data'])))
        for source_id, records in by_source.items():
            stored = db.execute('SELECT content FROM sources WHERE id=?', (source_id,)).fetchone()
            blob = stored['content'] if stored else None
            error = None
            if blob is None:
                error = ('source_blob_missing', 'Source blob is unavailable')
            elif hashlib.sha256(blob).hexdigest() != source_id:
                error = ('source_blob_mismatch', 'Source blob checksum differs from its identifier')
            else:
                source = audit_source(blob, [data for _, _, data in records], deadline)
            for eid, cid, data in records:
                outcome = error or check_record(data, source)
                status = 'correct'
                if outcome:
                    category, _ = outcome
                    status = 'unverified' if category == 'unverified' else 'failed'
                    if status == 'failed':
                        discrepancies[category] += 1
                method = data['extraction_method']
                modalities[method][status] += 1
                statuses[status] += 1
                if len(samples) < 15:
                    samples.append({'evidence_id': eid, 'case_id': cid, 'method': method,
                                    'status': status, 'errors': [outcome[1]] if outcome else []})

    def fidelity(counts):
        verified = counts['correct'] + counts['failed']
        return round(counts['correct'] / verified, 4) if verified else None

    return {
        'protocol': 'docs/design/04-evaluation.md § Evidence Correctness Audit Protocol',
        'total_audited': statuses.total(),
        'correct_records': statuses['correct'],
        'unverified_records': statuses['unverified'],
        'overall_correctness_rate': fidelity(statuses),
        'discrepancies': dict(discrepancies),
        'by_modality': {method: {'total': counts.total(), 'correct': counts['correct'],
                                'fidelity': fidelity(counts), 'error_count': counts['failed'],
                                'unverified': counts['unverified']}
                        for method, counts in modalities.items()},
        'sample_size': statuses.total(),
        'standard': 'Exact passage fidelity against retained source blobs and reproducible extracted text',
        'audit_sample_records': samples,
    }


def run_and_save_evidence_audit(ledger: Store, output_path: str = 'artifacts/evaluation/evidence-audit.json'):
    result = audit_evidence_correctness(ledger)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + '\n')
    return result
