from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
import msoffcrypto
from openpyxl import Workbook
import pdfplumber
import pytest
from reportlab.lib import colors
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table

from maha.api import create_app
from maha.statements import statement_records
from maha.store import Store


PASSWORD = 'fixture-statement-pw-2026'
ROWS = [
    ['Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
    *[[f'{day:02d}/11/2026', 'Test transfer', '1,200.00', '', '20,000.00']
      for day in range(13, 21)],
    ['21/11/2026', 'Test credit', '', '2,500.00', '22,500.00'],
    ['Bad date', 'Unparseable line', '250.00', '', '22,250.00'],
]


def make_encrypted_pdf(page_count, rows=ROWS):
    original = BytesIO()
    canvas = Canvas(original, encrypt=StandardEncryption(PASSWORD, strength=128))
    table = Table(rows)
    table.setStyle([('GRID', (0, 0), (-1, -1), .5, colors.black)])
    for _ in range(page_count):
        table.wrapOn(canvas, 600, 600)
        table.drawOn(canvas, 40, 400)
        canvas.showPage()
    canvas.save()
    return original.getvalue()


@pytest.fixture(params=['pdf', 'xlsx'])
def encrypted_statement(request):
    if request.param == 'pdf':
        return 'fixture.pdf', make_encrypted_pdf(1)
    original = BytesIO()
    plain = BytesIO()
    workbook = Workbook()
    for row in ROWS:
        workbook.active.append(row)
    workbook.save(plain)
    plain.seek(0)
    msoffcrypto.OfficeFile(plain).encrypt(PASSWORD, original)
    return 'fixture.xlsx', original.getvalue()


def test_encrypted_statement_retains_exact_original_and_can_replay(tmp_path, monkeypatch, encrypted_statement):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    token = store.create_user('reviewer', ['C1'])
    restricted = store.create_user('restricted', ['C2'])
    headers = {'Authorization': 'Bearer ' + token}
    filename, original = encrypted_statement
    path = '/api/import/bank-statement/C1'

    with TestClient(create_app(store)) as client:
        def upload(password, currency='INR'):
            return client.post(path, headers=headers, data={'password': password, 'currency': currency, 'date_order': 'DMY'},
                               files={'file': (filename, original, 'application/octet-stream')})

        for password in ('', 'wrong-test-password'):
            rejected = upload(password)
            assert rejected.status_code == 422
            assert 'password' in rejected.json()['detail']
            assert not password or password not in rejected.text
            assert not store.history('imports', ['C1'])

        response = upload(PASSWORD)
        assert response.status_code == 200, response.text
        summary = response.json()
        assert (summary['accepted_new'], summary['quarantined']) == (9, 1)
        assert summary['source_id'] == sha256(original).hexdigest()
        assert PASSWORD not in response.text
        assert upload(PASSWORD).json()['recognized_repeat'] == 9
        assert upload(PASSWORD, currency='USD').status_code == 409

        eid = summary['statement_rows'][0]['evidence_id']
        evidence = client.get('/api/evidence/' + eid, headers=headers).json()
        locator = evidence['source_locator']
        assert locator['encrypted'] and locator['format'] == filename.rsplit('.', 1)[-1]
        assert locator['row'] == 2
        assert evidence['event_time'] == '2026-11-13T00:00:00+00:00'
        assert evidence['time_basis'] == 'date_only'
        assert not evidence['synthetic']
        download = client.get('/api/source/' + summary['source_id'], headers=headers)
        assert download.content == original
        replay_url = '/api/evidence/' + eid + '/statement-row'

        def replay(password, auth=headers):
            return client.post(replay_url, headers=auth, files={'password': (None, password)})

        assert replay('wrong-test-password').status_code == 422
        assert replay(PASSWORD, {'Authorization': 'Bearer ' + restricted}).status_code == 404
        replayed = replay(PASSWORD)
        assert replayed.status_code == 200, replayed.text
        assert replayed.json()['matches_ingested']
        assert replayed.json()['cells'] == json.loads(evidence['passage'])[1]
        assert PASSWORD not in replayed.text
        assert client.get('/api/evidence/audit', headers=headers).json()['unverified_records'] == 9

        analysis = client.get('/api/analysis?case=C1', headers=headers).json()
        leads = [lead for lead in analysis['leads'] if 'isolation_forest' in lead['techniques']]
        assert len(leads) == 5
        assert all(set(lead['model_inputs']) == {'log1p_amount_paid'} for lead in leads)
        assert not any('fund_flow' in lead['techniques'] for lead in analysis['leads'])

    with store.db() as db:
        assert db.execute('SELECT content FROM sources').fetchone()['content'] == original
    assert PASSWORD.encode() not in store.path.read_bytes()


def test_long_statement_ranges_preserve_page_locators_and_respect_case_limit(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    monkeypatch.setenv('MAHA_MAX_GRAPH_NODES', '2')
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    rows = [
        ['Value Date', 'Post Date', 'Details', 'Reference', 'Debit', 'Credit', 'Balance'],
        ['12/11/2026', '13/11/2026', 'Test transfer', '000123', '1,25,000.00', '', '20,000.00'],
    ]
    original = make_encrypted_pdf(117, rows)

    with TestClient(create_app(store)) as client:
        def upload(pages):
            return client.post('/api/import/bank-statement/C1', headers=headers,
                               data={'password': PASSWORD, 'currency': 'INR', 'date_order': 'DMY', 'pdf_pages': pages},
                               files={'file': ('long.pdf', original, 'application/pdf')})

        for pages in ('12-1', '0', '118'):
            assert upload(pages).status_code == 422
        oversized = upload('')
        assert oversized.status_code == 413
        assert 'case limit of 2 graph nodes' in oversized.json()['detail']
        assert not store.history('imports', ['C1']) and not store.facts(['C1'])
        with store.db() as db:
            assert db.execute('SELECT COUNT(*) FROM sources').fetchone()[0] == 0

        partial = upload('116–117')
        assert partial.status_code == 200, partial.text
        summary = partial.json()
        assert summary['accepted_new'] == 2
        assert summary['source_id'] == sha256(original).hexdigest()
        eid = summary['statement_rows'][1]['evidence_id']
        response = client.post(f'/api/evidence/{eid}/statement-row', headers=headers,
                               files={'password': (None, PASSWORD)})
        assert response.status_code == 200, response.text
        assert response.json()['locator']['page'] == 117
        assert response.json()['matches_ingested']
        assert response.json()['cells'] == rows[1]
        evidence = client.get(f'/api/evidence/{eid}', headers=headers).json()
        assert evidence['event_time'] == '2026-11-13T00:00:00+00:00'
        assert evidence['time_basis'] == 'date_only'
        assert upload('117').json()['recognized_repeat'] == 1

        monkeypatch.setenv('MAHA_MAX_GRAPH_NODES', '2000')
        full = upload('')
        assert full.status_code == 200, full.text
        assert (full.json()['accepted_new'], full.json()['recognized_repeat']) == (115, 2)


def test_bank_pdf_can_read_aligned_text_without_table_lines():
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.setFont('Helvetica', 10)
    rows = [['Value Date', *ROWS[0][1:]], *ROWS[1:4]]
    for index, row in enumerate(rows):
        for x, cell in zip((35, 110, 310, 390, 465), row, strict=True):
            canvas.drawString(x, 720 - 20 * index, cell)
    canvas.save()

    records = statement_records(pdf.getvalue(), '', 'INR', 'DMY')
    assert len(records) == 3 and all('facts' in record for record in records)
    assert records[0]['locator']['layout'] == 'aligned-text'
    assert records[0]['event_time'] == '2026-11-13T00:00:00+00:00'
    assert records[0]['facts'][0]['attrs']['amount_paid'] == '1200.00'


def test_bank_pdf_accepts_extracted_rupee_codes_and_multiline_reference_header():
    rows = [
        ['Value Date', 'Post Date', 'Details', 'Ref No/\nCheque\nNo', '(cid:45) Debit', 'Rs. Credit', 'Balance'],
        ['12/11/2026', '13/11/2026', 'Test debit', '000123', '1,25,000.00', '', '20,000.00'],
        ['13/11/2026', '13/11/2026', 'Test credit', '000124', '', '15,000.00', '35,000.00'],
    ]
    records = statement_records(make_encrypted_pdf(11, rows), PASSWORD, 'INR', 'DMY', page_range=(2, 3))
    assert [record['locator']['page'] for record in records] == [2, 2, 3, 3]
    attrs = [record['facts'][0]['attrs'] for record in records]
    assert [(a['direction'], a['amount_paid']) for a in attrs] == [('debit', '125000.00'), ('credit', '15000.00')] * 2
    assert json.loads(records[0]['passage'])[1] == rows[1]


def test_bank_pdf_can_join_two_lines_of_aligned_headers():
    pdf = BytesIO()
    canvas = Canvas(pdf, encrypt=StandardEncryption(PASSWORD, strength=128))
    canvas.setFont('Helvetica', 10)
    for y, cells in [
        (720, ['Post', 'Details', 'Withdrawal', 'Deposit', 'Balance']),
        (708, ['Date', '', 'Amount', 'Amount', '']),
        (690, ['13/11/2026', 'Test debit', '100.00', '', '200.00']),
    ]:
        for x, cell in zip((35, 110, 310, 390, 465), cells, strict=True):
            canvas.drawString(x, y, cell)
    canvas.save()
    records = statement_records(pdf.getvalue(), PASSWORD, 'INR', 'DMY')
    assert len(records) == 1
    assert records[0]['locator']['layout'] == 'aligned-text'
    assert records[0]['locator']['row'] == 3
    assert records[0]['facts'][0]['attrs']['amount_paid'] == '100.00'


@pytest.mark.parametrize('has_text, error', [
    (False, 'No usable text was found'),
    (True, 'could not identify the transaction columns'),
])
def test_bank_pdf_distinguishes_missing_text_from_unknown_columns(has_text, error):
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.rect(35, 690, 430, 30)
    if has_text:
        canvas.drawString(40, 700, 'Unrecognized layout')
    canvas.save()
    with pytest.raises(ValueError, match=error):
        statement_records(pdf.getvalue(), '', 'INR', 'DMY')


def test_bank_pdf_can_separate_tightly_spaced_date_headers():
    pdf = BytesIO()
    canvas = Canvas(pdf, encrypt=StandardEncryption(PASSWORD, strength=128))
    canvas.setFont('Helvetica', 10)
    second_date_x = 35 + canvas.stringWidth('Value Date', 'Helvetica', 10) + 4.5
    for y, cells in [
        (720, ['Value Date', 'Post Date', 'Details', 'Reference', 'Debit', 'Credit', 'Balance']),
        (700, ['12/11/26', '13/11/26', 'Test debit', '000001', '100.00', '', '200.00']),
    ]:
        for x, cell in zip((35, second_date_x, 180, 290, 360, 430, 500), cells, strict=True):
            canvas.drawString(x, y, cell)
    canvas.save()
    records = statement_records(pdf.getvalue(), PASSWORD, 'INR', 'DMY')
    assert len(records) == 1
    assert records[0]['locator']['layout'] == 'aligned-text-tight'
    assert records[0]['event_time'] == '2026-11-13T00:00:00+00:00'
    assert records[0]['facts'][0]['attrs']['amount_paid'] == '100.00'


def test_bank_pdf_error_shows_possible_headings_without_echoing_statement_text():
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.drawString(35, 700, 'Post Date     Details     Proprietary Name 1234567     Balance')
    canvas.save()
    with pytest.raises(ValueError, match='Possible headings on page 1: post date, details, balance') as failure:
        statement_records(pdf.getvalue(), '', 'INR', 'DMY')
    assert 'Proprietary Name' not in str(failure.value)
    assert '1234567' not in str(failure.value)


def test_rejects_false_layout_before_reading_statement_values(monkeypatch):
    import maha.statements as statements
    original = statements.pdf_table_rows

    def false_first(page, encrypted, strategy, settings):
        if strategy == 'ruled':
            yield {'page': 1, 'row': 2}, ['Date', 'Amount'], ['Header fragment', '10'], {'date': 0, 'amount': 1}
        else:
            yield from original(page, encrypted, strategy, settings)

    monkeypatch.setattr(statements, 'pdf_table_rows', false_first)
    rows = [['Date', 'Debit', 'Credit'], ['21 / 11 / 2026', 'Rs. 1,25,000.00', '']]
    result = statement_records(make_encrypted_pdf(1, rows), PASSWORD, 'INR', 'DMY')
    assert result[0]['facts'][0]['attrs']['amount_paid'] == '125000.00'
    with pytest.raises(ValueError, match='Amount currency differs from the selected statement currency'):
        statement_records(make_encrypted_pdf(1, rows), PASSWORD, 'USD', 'DMY')


@pytest.mark.parametrize('has_date_anchor', [True, False])
def test_encrypted_pdf_with_image_headings_keeps_transaction_values_from_original_text(tmp_path, monkeypatch, has_date_anchor):
    bundled_ocr = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime/usr/bin/tesseract'
    if not shutil.which('tesseract') and not bundled_ocr.is_file():
        pytest.skip('Local Tesseract runtime unavailable')
    monkeypatch.delenv('NEO4J_URI', raising=False)
    header = BytesIO()
    widths = (65, 65, 150, 65, 65, 65, 65)
    labels = ['Value Date', 'Post Date', 'Details', 'Ref No', 'Debit', 'Credit', 'Balance']
    if not has_date_anchor:
        widths = (28, *widths)
        labels.insert(0, 'No.')
    img_width = sum(widths)
    raster_source = Canvas(header, pagesize=(img_width, 34))
    raster_source.setFillColor(colors.HexColor('#494888'))
    raster_source.rect(0, 0, img_width, 34, stroke=0, fill=1)
    raster_source.setFillColor(colors.white)
    raster_source.setFont('Helvetica-Bold', 11)
    x = 0
    for label, width in zip(labels, widths, strict=True):
        raster_source.drawCentredString(x + width / 2, 14, label)
        x += width
    raster_source.save()

    pdf = BytesIO()
    canvas = Canvas(pdf, encrypt=StandardEncryption(PASSWORD, strength=128))
    if not has_date_anchor:
        for line_no in range(6):
            canvas.drawString(35, 760 - 25 * line_no, f'Synthetic account information line {line_no + 1}')
    table_top = 637 if has_date_anchor else 407
    table_left = 25 if has_date_anchor else 15
    with pdfplumber.open(header) as source, source.pages[0].to_image(resolution=200).original as image:
        canvas.drawImage(ImageReader(image), table_left, table_top, img_width, 34)
    canvas.setFont('Helvetica', 10)
    body = [
        ['12/11/26', '13/11/26', 'Test debit', '000001', '100.12', '', '299.88'],
        ['13/11/26', '14/11/26', 'Test credit', '000002', '', '55.67', '355.55'],
    ]
    for line_no, row in enumerate(body, 1):
        if not has_date_anchor:
            row.insert(0, str(line_no))
        y = table_top - 18 * line_no
        x = table_left
        for text, width in zip(row, widths, strict=True):
            canvas.drawCentredString(x + width / 2, y, text)
            x += width
    canvas.save()

    records = statement_records(pdf.getvalue(), PASSWORD, 'INR', 'DMY')
    layout = 'ocr-header' if has_date_anchor else 'ocr-header-scan'
    assert len(records) == 2 and all(record['locator']['layout'] == layout for record in records)
    attrs = [record['facts'][0]['attrs'] for record in records]
    assert [(row['direction'], row['amount_paid']) for row in attrs] == [('debit', '100.12'), ('credit', '55.67')]
    headers, cells = json.loads(records[1]['passage'])
    assert headers[-7:] == labels[-7:]
    assert cells == body[1]
    assert records[1]['event_time'] == '2026-11-14T00:00:00+00:00'

    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    original = pdf.getvalue()
    with TestClient(create_app(store)) as client:
        response = client.post('/api/import/bank-statement/C1', headers=headers,
                               data={'password': PASSWORD, 'currency': 'INR', 'date_order': 'DMY'},
                               files={'file': ('fixture.pdf', original, 'application/pdf')})
        assert response.status_code == 200, response.text
        summary = response.json()
        assert summary['source_id'] == sha256(original).hexdigest()
        eid = summary['statement_rows'][1]['evidence_id']
        result = client.post(f'/api/evidence/{eid}/statement-row', headers=headers,
                             files={'password': (None, PASSWORD)})
        assert result.status_code == 200 and result.json()['matches_ingested']
