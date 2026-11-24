from io import BytesIO

from fastapi.testclient import TestClient
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table
import pdfplumber
import pytest

from maha.api import create_app
from maha.document_intake import printed_document_fields, render_pdf_image
from maha.report_intake import report_rows
from maha.store import Store


CALL_HEAD = ['Calling Number', 'Called Number', 'Call Date', 'Call Time', 'Duration (seconds)']
CALLS = [
    ['5550100123', '5550100456', '17/05/2001', '08:15:00', '23'],
    ['5550100456', '5550100123', '18/05/2001', '09:20:00', '00:01:04'],
]
WIRE_HEAD = ['Date', 'Sender Bank', 'Sender Account', 'Receiver Bank', 'Receiver Account', 'Amount', 'Currency']


def pdf_tables(*pages, width=900):
    source = BytesIO()
    canvas = Canvas(source, pagesize=(width, 370))
    for rows in pages:
        table = Table(rows, colWidths=[130 if width > 900 else 112] * len(rows[0]), rowHeights=36)
        table.setStyle([
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('FONTSIZE', (0, 0), (-1, -1), 13),
        ])
        table.wrapOn(canvas, 900, 370)
        table.drawOn(canvas, 45, 170)
        canvas.showPage()
    canvas.save()
    return source.getvalue()


def scanned_copy(content):
    output = BytesIO()
    canvas = Canvas(output, pagesize=(900, 370))
    with pdfplumber.open(BytesIO(content)) as document:
        for page in document.pages:
            with render_pdf_image(page, resolution=210, antialias=True).original as image:
                canvas.drawImage(ImageReader(image), 0, 0, width=900, height=370)
            canvas.showPage()
    canvas.save()
    return output.getvalue()


@pytest.mark.parametrize('scan', [False, True])
def test_call_pdf_review_import_and_scoped_source(tmp_path, monkeypatch, scan):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['CASE'])}
    outside = {'Authorization': 'Bearer ' + store.create_user('outside', ['OTHER'])}
    original = pdf_tables([CALL_HEAD, CALLS[0]], [CALL_HEAD, CALLS[1]])
    if scan:
        original = scanned_copy(original)
    path = '/api/report-intake/calls/CASE'
    settings = {'offset': '+05:30'}
    with TestClient(create_app(store)) as client:
        inspection = client.post('/api/intake/CASE/inspect', content=original, headers=headers)
        assert inspection.json()['kind'] == 'calls-document'
        preview = client.post(path, content=original, headers=headers, params=settings)
        assert preview.status_code == 200, preview.text
        result = preview.json()
        assert result['accepted'] == 2, result
        assert [page['candidates'] for page in result['pages']] == [1, 1]
        assert all(page['method'] == ('tesseract-eng' if scan else 'pdf-text') for page in result['pages'])
        assert not store.history('imports', ['CASE'])
        image = client.post('/api/report-intake/CASE/source-page/2', content=original, headers=headers)
        assert image.content.startswith(b'\x89PNG')
        params = {**settings, 'review_digest': result['review_digest']}
        if not scan:
            wrong = client.post(path, params={**params, 'offset': 'UTC'}, headers=headers, content=original)
            assert wrong.status_code == 409
        saved = client.post(path, params=params, headers=headers, content=original)
        assert saved.status_code == 200, saved.text
        batch = saved.json()
        assert batch['accepted_new'] == 2
        graph = client.get('/api/graph?case=CASE', headers=headers).json()
        assert graph['nodes'] == graph['edges'] == []
        route = '/api/quality/' + batch['import_id'] + '/call-report'
        calls = client.get(route, headers=headers).json()['calls']
        assert [item['duration_seconds'] for item in calls] == [23, 64]
        assert calls[0]['time'] == '2001-05-17T02:45:00+00:00'
        assert calls[0]['caller'] == calls[1]['callee'] == '5550100123'
        assert client.get(route, headers=outside).status_code == 404
        assert client.get(f"/api/evidence/{calls[1]['id']}/source-page", headers=headers).content.startswith(b'\x89PNG')
        assert client.get('/api/source/' + batch['source_id'], headers=headers).content == original


def test_wire_pdf_flags_incomplete_rows_and_preserves_date_precision(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['CASE'])}
    original = pdf_tables([WIRE_HEAD, ['17/05/2001', 'Bank A', 'AC-001', 'Bank B', 'AC-002', '1,240.50', 'INR'],
                           ['18/05/2001', 'Bank A', 'AC-001', 'Bank B', '', '200.00', 'INR']])
    path = '/api/report-intake/wires/CASE'
    with TestClient(create_app(store)) as client:
        assert client.post('/api/intake/CASE/inspect', content=original, headers=headers).json()['kind'] == 'wires-document'
        preview = client.post(path, content=original, headers=headers).json()
        assert (preview['accepted'], preview['rejected']) == (1, 1)
        params = {'review_digest': preview['review_digest']}
        assert client.post(path, content=original, headers=headers, params=params).status_code == 422
        saved = client.post(path, content=original, headers=headers, params={**params, 'accept_partial': True})
        assert saved.status_code == 200, saved.text
        assert saved.json()['quarantined'] == 1
        wire_rows = client.get('/api/quality/' + saved.json()['import_id'] + '/wire-report', headers=headers).json()
        assert wire_rows['count'] == 1
        assert wire_rows['rows'][0]['fields']['from_account'] == 'AC-001'
        assert client.get('/api/evidence/' + wire_rows['rows'][0]['id'] + '/source-page', headers=headers).status_code == 200
        graph = client.get('/api/graph?case=CASE', headers=headers).json()
        transfer, = [edge for edge in graph['edges'] if edge['type'] == 'TRANSACTED_WITH']
        assert transfer['attrs']['time_basis'] == 'date_only'
        assert transfer['attrs']['amount_paid'] == '1240.50'
        assert 'evaluation_label' not in transfer['attrs']


def test_call_report_manual_mapping_and_continuation_without_headers():
    unknown = ['Calling', 'Destination', 'Day', 'Clock', 'Length']
    original = pdf_tables([unknown, CALLS[0]], [CALLS[1], CALLS[0]])
    _, _, records, coverage = report_rows(original, 'calls', offset='+05:30',
                                         mapping='caller:1,callee:2,date:3,time:4,duration:5')
    assert [page['candidates'] for page in coverage] == [1, 2]
    assert [record['call_observation']['duration_seconds'] for record in records] == [23, 64, 23]


def test_wire_report_uses_printed_receiving_amount_and_currency():
    header = [*WIRE_HEAD, 'Receiving Amount', 'Receiving Currency']
    original = pdf_tables([header, ['17/05/2001', 'Bank A', 'AC-001', 'Bank B', 'AC-002', '5.25', 'USD', '19.10', 'AED'],
                           ['18/05/2001', 'Bank A', 'AC-001', 'Bank B', 'AC-002', '4.25', 'USD', '', 'AED']], width=1280)
    _, _, rows, _ = report_rows(original, 'wires')
    transfer = next(fact['attrs'] for fact in rows[0]['facts'] if fact['type'] == 'TRANSACTED_WITH')
    assert (transfer['amount_paid'], transfer['payment_currency']) == ('5.25', 'USD')
    assert (transfer['amount_received'], transfer['receiving_currency']) == ('19.10', 'AED')
    assert 'error' in rows[1]


def test_printed_fir_fields_keep_source_offsets():
    text = 'FIRST INFORMATION REPORT\nFIR No: TEST/01 | Date: 17/05/2001\nPolice Station: Example Station\nActs & Sections: Example section\n'
    records = list(printed_document_fields(text, judgment=False))
    fields = {record['locator']['text_label']: record['passage'] for record in records}
    assert fields == {'FIR number': 'TEST/01', 'Report date': '17/05/2001',
                      'Police station': 'Example Station', 'Sections cited': 'Example section'}
    for record in records:
        locator = record['locator']
        assert text[locator['char_start']:locator['char_end']] == record['passage']
        assert record['facts'] == []
