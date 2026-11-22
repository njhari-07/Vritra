from hashlib import sha256
from io import BytesIO
import json

from fastapi.testclient import TestClient
import msoffcrypto
from openpyxl import Workbook
import pytest
from reportlab.lib import colors
from reportlab.lib.pdfencrypt import StandardEncryption
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
    original = make_encrypted_pdf(117, ROWS[:2])

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
        assert upload('117').json()['recognized_repeat'] == 1

        monkeypatch.setenv('MAHA_MAX_GRAPH_NODES', '2000')
        full = upload('')
        assert full.status_code == 200, full.text
        assert (full.json()['accepted_new'], full.json()['recognized_repeat']) == (115, 2)


def test_bank_pdf_can_read_aligned_text_without_table_lines():
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.setFont('Helvetica', 10)
    for index, row in enumerate(ROWS[:4]):
        for x, cell in zip((35, 110, 310, 390, 465), row, strict=True):
            canvas.drawString(x, 720 - 20 * index, cell)
    canvas.save()

    records = statement_records(pdf.getvalue(), '', 'INR', 'DMY')
    assert len(records) == 3 and all('facts' in record for record in records)
    assert records[0]['locator']['layout'] == 'aligned-text'
    assert records[0]['facts'][0]['attrs']['amount_paid'] == '1200.00'
