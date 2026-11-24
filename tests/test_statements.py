from datetime import datetime
from hashlib import sha256
from io import BytesIO
import json
from math import cos, radians, sin
from pathlib import Path
import shutil

from fastapi.testclient import TestClient
import msoffcrypto
from openpyxl import Workbook
from PIL import Image
import pdfplumber
import pytest
import xlwt
from reportlab.lib import colors
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table

from maha.api import create_app
from maha.statements import balance_verified_rows, select_row_layout, statement_preview, statement_records
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


def make_payment_export(*, split=False):
    headings = ['Date', 'Time', 'Bank Name', 'Account\nNumber', 'Sender', 'Receiver',
                'Payment ID/Reference\nNumber', 'Pay\n/Collect', 'Amount (in\nRs.)', 'DR\n/CR', 'Status']
    values = [
        ('26/05\n/2001', '09:17:\n43', 'payer@upi (Example Payer)', 'owner@upi', 'TEST-001', 'PAY', '2.10', 'CR', 'SUCCESS'),
        ('26/05/2001', '09:17:42', 'owner@upi', 'vendor@upi (Example Vendor)', 'TEST-002', 'PAY', '3.45', 'DR', 'SUCCESS'),
        ('25/05/2001', '10:11:12', 'owner@upi', 'vendor@upi', 'TEST-003', 'COLLECT', '5.55', 'DR', 'SUCCESS'),
        ('25/05/2001', '10:11:11', 'owner@upi', 'vendor@upi', 'TEST-004', 'PAY', '20.00', 'DR', 'FAILED'),
        ('25/05/2001', '10:11:10', 'xxx0001@upi (Masked)', 'owner@upi', 'TEST-005', 'PAY', '1.10', 'CR', 'SUCCESS'),
        ('25/05/2001', '10:11:09', 'xxx0001@upi (Masked)', 'owner@upi', 'TEST-006', 'PAY', '1.00', 'CR', 'PENDING'),
    ]
    rows = [[day, time, 'Example Bank', 'XX1234', *details] for day, time, *details in values]
    continuation = []
    if split:
        rows[1][:2] = ['26/05', '09:17:']
        continuation.append(['/2001', '42', *[''] * 9])
    output = BytesIO()
    canvas = Canvas(output, pagesize=(920, 500))
    for page_rows in ([headings, *rows[:2]], [*continuation, *rows[2:]]):
        table = Table(page_rows, colWidths=[61, 55, 70, 59, 155, 155, 109, 50, 62, 35, 70])
        table.setStyle([('GRID', (0, 0), (-1, -1), .5, colors.black)])
        table.wrapOn(canvas, 850, 430)
        table.drawOn(canvas, 8, 307)
        canvas.showPage()
    canvas.save()
    return output.getvalue()


def test_payment_row_split_between_pdf_pages_retains_both_locations():
    content = make_payment_export(split=True)
    parsed = statement_records(content, '', 'INR', 'DMY', page_range=(1, 1), preview=True)
    assert len(parsed) == 2 and all('facts' in row for row in parsed)
    assert parsed[-1]['fields']['reference'] == 'TEST-002'
    assert parsed[-1]['locator']['page'] == 1
    assert parsed[-1]['locator']['continuation']['page'] == 2
    whole = statement_records(content, '', 'INR', 'DMY', preview=True)
    assert len(whole) == 6 and all('facts' in row for row in whole)
    assert [row['fields']['reference'] for row in whole].count('TEST-002') == 1


def test_money_flow_groups_legacy_statement_narrations_with_distinct_review_labels(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['CASE'])}
    workbook = Workbook()
    workbook.active.append(['Date', 'Narration', 'Debit', 'Credit'])
    for narration, debit, credit in [
        (f'WDL TFR\nUPI/DR/{1:012d}/Example Person/TEST/partial01/UPI', '5.25', None),
        (f'WDL TFR\nUPI/DR/{2:012d}/Example Person/TEST/partial01/UPI', '1.75', None),
        (f'UPI/DR/{3:012d}/Example Person/TEST/partial02/UPI', '2.00', None),
        (f'UPI/CR/{4:012d}/Example Person/TEST/vendor@upi/UPI', None, '6.00'),
        (f'UPI/CR/{5:012d}/Example Person/TEST/vendor@upi/UPI', '0.50', None),
        ('POS ATM PURCHASE', '1.50', None),
    ]:
        workbook.active.append(['11/10/2026', narration, debit, credit])
    content = BytesIO()
    workbook.save(content)
    with TestClient(create_app(store)) as client:
        imported = client.post('/api/import/bank-statement/CASE', headers=headers,
                               data={'currency': 'INR', 'date_order': 'DMY'},
                               files={'file': ('example.xlsx', content.getvalue())})
        assert imported.status_code == 200, imported.text
        path = f"/api/quality/{imported.json()['import_id']}/money-flow"
        flow = client.get(path, headers=headers).json()
        assert flow['totals'] == {'credit': '6.00', 'debit': '11.00', 'net': '-5.00'}
        assert flow['row_count'] == 6
        review = [group for group in flow['groups'] if group['kind'] == 'narration']
        assert [(group['count'], group['total']) for group in review] == [(2, '7.00'), (1, '2.00')]
        assert review[0]['key'] != review[1]['key']
        assert all('identity unconfirmed' in group['basis'] for group in review)
        assert [group['label'] for group in flow['groups'] if group['kind'] == 'identifier'] == ['vendor@upi']
        assert {group['label'] for group in flow['groups'] if group['kind'] == 'channel'} == {'UPI', 'Card payments'}
        assert not client.get('/api/graph?case=CASE', headers=headers).json()['edges']


def test_payment_export_flows_use_completed_directions_and_scoped_saved_rows(tmp_path, monkeypatch):
    from maha.ingestion import node

    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['CASE'])}
    outside = {'Authorization': 'Bearer ' + store.create_user('outside', ['OTHER'])}
    for case, person in [('CASE', 'example-owner'), ('OTHER', 'other-person')]:
        store.import_records(case + '.txt', case.encode(), 'fixture', True, case, [
            {'locator': {'row': 1}, 'facts': [node('Person', person, 'Example Person')]},
        ])

    url = '/api/import/bank-statement/CASE'
    fields = {'currency': 'INR', 'date_order': 'DMY', 'statement_name': 'Example payment export'}
    files = {'file': ('synthetic.pdf', make_payment_export())}
    with TestClient(create_app(store)) as client:
        result = client.post(url + '?preview=true', headers=headers, data=fields, files=files)
        assert result.status_code == 200, result.text
        preview = result.json()
        assert (preview['accepted'], preview['rejected']) == (6, 0)
        assert preview['rows'][0]['normalized'] == {'debit': '', 'credit': '2.10'}
        assert preview['rows'][0]['fields']['payment_type'] == 'PAY'
        assert preview['rows'][1]['normalized'] == {'debit': '3.45', 'credit': ''}
        assert preview['rows'][2]['locator']['header_page'] == 1

        saved = client.post(url, headers=headers, data=fields, files=files)
        assert saved.status_code == 200, saved.text
        batch = '/api/quality/' + saved.json()['import_id']
        flow_url = batch + '/money-flow'
        assert client.get(flow_url, headers=outside).status_code == 404
        flow = client.get(flow_url, headers=headers).json()
        assert flow['case_id'] == 'CASE'
        assert flow['totals'] == {'credit': '3.20', 'debit': '9.00', 'net': '-5.80'}
        assert flow['status_counts'] == {'completed': 4, 'failed': 1, 'pending': 1}
        assert flow['rows'][0]['printed_time'] == '09:17:43'
        assert flow['rows'][0]['locator']['page'] == 1
        assert flow['row_count'] == 4
        outgoing = flow['groups'][0]
        assert (outgoing['label'], outgoing['direction'], outgoing['count'], outgoing['total']) == ('vendor@upi', 'debit', 2, '9.00')
        assert any(group['basis'] == 'masked or incomplete identifiers' for group in flow['groups'])
        subset = client.get(flow_url, headers=headers, params={'group': outgoing['key']}).json()
        assert {row['fields']['reference'] for row in subset['rows']} == {'TEST-002', 'TEST-003'}
        failed = client.get(flow_url, headers=headers, params={'status': 'failed'}).json()
        assert failed['row_count'] == 1 and not failed['groups']
        assert failed['rows'][0]['fields']['reference'] == 'TEST-004'
        only_day = client.get(flow_url, headers=headers, params={'start': '2001-05-26', 'direction': 'debit'}).json()
        assert only_day['totals']['debit'] == '3.45' and only_day['row_count'] == 1
        assert client.get(flow_url, headers=headers, params={'account': 'not-an-account'}).status_code == 404

        owner = {'account': flow['account'], 'name': 'Example owner', 'person_id': 'other-person'}
        assert client.put(flow_url + '/owner', headers=headers, json=owner).status_code == 422
        owner['person_id'] = 'example-owner'
        assert client.put(flow_url + '/owner', headers=outside, json=owner).status_code == 404
        assert client.put(flow_url + '/owner', headers=headers, json=owner).status_code == 200
        assert client.get(flow_url, headers=headers).json()['accounts'][0]['owner']['name'] == 'Example owner'
        graph = client.get('/api/graph?case=CASE', headers=headers).json()
        links = [edge for edge in graph['edges'] if edge['type'] == 'OWNS_ACCOUNT']
        assert len(links) == 1 and links[0]['source'] == 'example-owner' and links[0]['evidence_ids']
        assert client.delete(batch + '/statement', headers=headers).status_code == 200
        assert not client.get('/api/graph?case=CASE', headers=headers).json()['edges']


def statement_with_printed_summary(*, declare_extra_debit=False, transactions_on_last_page=False):
    source = BytesIO()
    canvas = Canvas(source, encrypt=StandardEncryption(PASSWORD, strength=128))

    def draw(rows, top, widths, *, summary=False):
        table = Table(rows, colWidths=widths)
        table.setStyle([('GRID', (0, 0), (-1, -1), .5, colors.black)])
        if summary:
            table.setStyle([('SPAN', (0, 0), (-1, 0)), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#494888')),
                            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('ALIGN', (0, 0), (-1, 0), 'CENTER')])
        _, height = table.wrapOn(canvas, 550, 650)
        table.drawOn(canvas, 22, top - height)

    pages_with_transactions = 11 if transactions_on_last_page else 10
    for page in range(1, pages_with_transactions + 1):
        if page == 1:
            canvas.drawString(22, 790, 'Synthetic current account statement')
        draw([
            ['Value Date', 'Post Date', 'Details', 'Ref No/\nCheque No', 'Debit (INR)', 'Credit (INR)', 'Balance'],
            [f'{page:02d}/05/2001', f'{page:02d}/05/2001', 'Synthetic debit', '-', '11.50', '-', '11.50DR'],
            [f'{page:02d}/05/2001', f'{page:02d}/05/2001', 'Synthetic credit', '-', '-', '11.50', '0.00CR'],
        ], 690, [63, 63, 105, 62, 78, 78, 80])
        if page < 11:
            canvas.showPage()
    debit_count = pages_with_transactions + int(declare_extra_debit)
    credit_count = pages_with_transactions
    draw([
        [f'Statement Summary  01-05-2001 To {pages_with_transactions}-05-2001', '', '', '', '', ''],
        ['Brought Forward (INR)', 'Dr Count', 'Cr Count', 'Total Debits (INR)', 'Total Credits (INR)', 'Closing Balance (INR)'],
        ['0.00CR', str(debit_count), str(credit_count), f'{debit_count * 11.50:.2f}',
         f'{credit_count * 11.50:.2f}', '11.50DR' if declare_extra_debit else '0.00CR'],
    ], 300, [114, 53, 53, 101, 104, 113], summary=True)
    canvas.drawString(22, 200, 'Synthetic fixture footer')
    canvas.save()
    return source.getvalue()


def test_printed_summary_and_transactions_can_share_the_last_pdf_page():
    source = statement_with_printed_summary(transactions_on_last_page=True)
    summaries = []
    records = statement_records(source, PASSWORD, 'INR', 'DMY', preview=True, summaries=summaries)
    assert statement_preview(records, 'INR')['rejected'] == 0
    assert [row['locator']['page'] for row in records] == [page for page in range(1, 12) for _ in range(2)]
    assert summaries[0]['page'] == 11
    assert summaries[0]['arithmetic_matches'] is True


@pytest.mark.parametrize('declare_extra_debit', [False, True])
def test_printed_summary_checks_all_statement_pages(tmp_path, monkeypatch, declare_extra_debit):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    source = statement_with_printed_summary(declare_extra_debit=declare_extra_debit)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    url = '/api/import/bank-statement/C1'
    fields = {'password': PASSWORD, 'currency': 'INR', 'date_order': 'DMY'}
    files = {'file': ('synthetic.pdf', source)}
    with TestClient(create_app(store)) as client:
        def submit(*, preview=True, pages=''):
            return client.post(url, params={'preview': str(preview).lower()}, headers=headers,
                               data={**fields, 'pdf_pages': pages}, files=files)

        response = submit(pages='1-11')
        assert response.status_code == 200, response.text
        preview = response.json()
        assert (preview['accepted'], preview['rejected']) == (20, 0)
        assert [page['accepted'] for page in preview['page_coverage']] == [2] * 10 + [0]
        assert 'summary found' in preview['page_coverage'][-1]['diagnostic']
        assert preview['rows'][1]['balance_check'] == 'Matched'
        assert preview['balance_checks'] == {'matched': 19, 'mismatched': 0, 'unverified': 1}
        report = preview['reconciliation']
        assert report['page'] == 11
        assert report['bbox']
        assert report['arithmetic_matches'] is True
        assert report['printed']['closing_balance'].endswith('DR' if declare_extra_debit else 'CR')
        assert report['checks'] == {
            'debit_count': {'extracted': '10', 'matches': not declare_extra_debit},
            'credit_count': {'extracted': '10', 'matches': True},
            'total_debit': {'extracted': '115.00', 'matches': not declare_extra_debit},
            'total_credit': {'extracted': '115.00', 'matches': True},
        }

        footer = submit(pages='11').json()
        assert (footer['accepted'], footer['rejected']) == (0, 0)
        assert footer['reconciliation']['checks'] is None
        assert submit(preview=False, pages='11').status_code == 422
        assert not store.history('imports', ['C1'])

        result = submit(preview=False).json()
        assert (result['accepted_new'], result['quarantined']) == (20, 0)
        assert result['statement_scope']['reconciliation'] == report
        history = client.get(f"/api/quality/{result['import_id']}/statement-rows", headers=headers).json()
        assert history['scope']['reconciliation'] == report
        assert [item['page'] for item in history['pages']] == list(range(1, 11))
        saved = client.get(f"/api/quality/{result['import_id']}/statement-rows?all_rows=true", headers=headers).json()
        assert saved['accepted'] == 20
        assert saved['saved_reconciliation'] == report
        if not declare_extra_debit:
            evidence_id = saved['rows'][0]['evidence_id']
            with store.db() as db:
                db.execute('DELETE FROM facts WHERE evidence_id=?', (evidence_id,))
                db.execute('DELETE FROM evidence WHERE id=?', (evidence_id,))
            after_loss = client.get(f"/api/quality/{result['import_id']}/statement-rows?all_rows=true", headers=headers).json()
            assert after_loss['accepted'] == 19
            assert after_loss['saved_reconciliation']['checks']['debit_count'] == {'extracted': '9', 'matches': False}
            assert after_loss['scope']['reconciliation']['checks']['debit_count']['matches'] is True


def test_statement_name_and_delete_apply_to_all_saved_pages_in_one_case(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    allowed = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1', 'C2'])}
    outside = {'Authorization': 'Bearer ' + store.create_user('outside', ['C3'])}
    original = make_encrypted_pdf(2, ROWS[:3])
    unrelated = make_encrypted_pdf(1, ROWS[:4])
    fields = {'password': PASSWORD, 'currency': 'INR', 'date_order': 'DMY'}
    name = 'Example Account 25-26'
    with TestClient(create_app(store)) as client:
        def upload(case, *, pages='', content=original, statement_name=name):
            return client.post(f'/api/import/bank-statement/{case}', headers=allowed,
                               files={'file': ('synthetic.pdf', content)},
                               data={**fields, 'pdf_pages': pages, 'statement_name': statement_name})

        assert upload('C1', statement_name='../../unsafe').status_code == 422
        initial = upload('C1', pages='2').json()
        assert initial['statement_name'] == name
        batch = initial['import_id']
        url = f'/api/quality/{batch}'
        first_page = client.post(f'{url}/statement-page?page=1&preview=false', headers=allowed,
                                 files={'password': (None, PASSWORD)}).json()
        assert first_page['statement_name'] == name
        same_elsewhere = upload('C2').json()
        other_file = upload('C1', content=unrelated).json()
        total = client.get(f'{url}/statement-rows?all_rows=true', headers=allowed).json()
        assert total['accepted'] == 4
        assert total['pages'] == [{'page': 1, 'count': 2}, {'page': 2, 'count': 2}]
        assert total['saved_reconciliation'] is None
        assert [row['locator']['page'] for row in total['rows']] == [1, 1, 2, 2]

        revised = '  Example Account 2025-26  '
        assert client.put(f'{url}/statement', headers=outside, json={'name': revised}).status_code == 404
        renamed = client.put(f'{url}/statement', headers=allowed, json={'name': revised}).json()
        assert renamed['statement_name'] == revised.strip()
        batches = client.get('/api/quality?case=C1', headers=allowed).json()
        assert {r['summary']['statement_name'] for r in batches if r['source_id'] == initial['source_id']} == {revised.strip()}
        assert client.delete(f'{url}/statement', headers=outside).status_code == 404
        assert client.delete(f'{url}/statement', headers=allowed).json() == {'deleted_rows': 4}
        assert client.delete(f'{url}/statement', headers=allowed).status_code == 404
        assert client.get(f'{url}/statement-rows', headers=allowed).status_code == 404
        assert client.get(f"/api/quality/{first_page['import_id']}/statement-rows", headers=allowed).status_code == 404
        assert client.get(f"/api/quality/{other_file['import_id']}/statement-rows", headers=allowed).status_code == 200
        assert client.get(f"/api/quality/{same_elsewhere['import_id']}/statement-rows", headers=allowed).status_code == 200
        for row in total['rows']:
            assert client.get(f"/api/evidence/{row['evidence_id']}", headers=allowed).status_code == 404
        assert client.get('/api/graph?case=C1', headers=allowed).json()['nodes']
        assert client.get('/api/source/' + initial['source_id'], headers=allowed).content == original
        assert client.delete(f"/api/quality/{same_elsewhere['import_id']}/statement", headers=allowed).status_code == 200
        assert client.get('/api/source/' + initial['source_id'], headers=allowed).status_code == 404
        assert any(row['action'] == 'statement_deleted' for row in store.history('audit', ['C1']))
        assert len(store.facts(['C1'])) == 3


@pytest.mark.parametrize('source_format', ['pdf', 'xlsx', 'xls', 'png'])
def test_manual_columns_preview_import_and_replay_unknown_headers(source_format, tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    rows = [['Recorded', 'Memo text', 'Outflows', 'Inflows', 'Total on hand'],
            ['13/11/2026', 'Synthetic withdrawal', '10.25', '-', '894.75'],
            ['14/11/2026', 'Synthetic deposit', '-', '12.00', '906.75']]
    password = ''
    if source_format == 'xlsx':
        workbook = Workbook()
        for row in rows:
            workbook.active.append(row)
        stream = BytesIO()
        workbook.save(stream)
        content = stream.getvalue()
    elif source_format == 'xls':
        workbook = xlwt.Workbook()
        sheet = workbook.add_sheet('Statement')
        date_style = xlwt.easyxf(num_format_str='DD/MM/YYYY')
        for y, row in enumerate(rows):
            for x, cell in enumerate(row):
                if y and x == 0:
                    sheet.write(y, x, datetime.strptime(cell, '%d/%m/%Y'), date_style)
                else:
                    sheet.write(y, x, cell)
        stream = BytesIO()
        workbook.save(stream)
        content = stream.getvalue()
    else:
        pdf = make_encrypted_pdf(1, rows)
        if source_format == 'pdf':
            content, password = pdf, PASSWORD
        else:
            bundled = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime/usr/bin/tesseract'
            if not shutil.which('tesseract') and not bundled.is_file():
                pytest.skip('Local Tesseract runtime unavailable')
            stream = BytesIO()
            with pdfplumber.open(BytesIO(pdf), password=PASSWORD) as document:
                page = document.pages[0]
                left, top, right, bottom = page.find_tables()[0].bbox
                page = page.crop((left - 12, top - 12, right + 12, bottom + 12))
                with page.to_image(resolution=240, antialias=True).original as image:
                    image.save(stream, 'PNG')
            content = stream.getvalue()
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    path = '/api/import/bank-statement/C1'
    fields = {'currency': 'INR', 'date_order': 'DMY', 'password': password}
    files = {'file': (f'fixture.{source_format}', content)}
    columns = {'date': 1, 'narration': 2, 'debit': 3, 'credit': 4, 'balance': 5}
    mapping = {'columns': columns, 'separators': []}
    with TestClient(create_app(store)) as client:
        if source_format in {'pdf', 'png'}:
            page = client.post(path + '?layout_page=true', headers=headers, data=fields, files=files)
            assert page.status_code == 200, page.text
            assert page.headers['Cache-Control'] == 'no-store'
            assert page.headers['X-Statement-Page'] == '1'
            assert page.content.startswith(b'\x89PNG\r\n\x1a\n')
            assert not store.history('imports', ['C1'])
            if password:
                locked = client.post(path + '?layout_page=true', headers=headers,
                                     data={**fields, 'password': 'wrong'}, files=files)
                assert locked.status_code == 422
        automatic = client.post(path + '?preview=true', headers=headers, data=fields, files=files)
        assert automatic.status_code == 422, automatic.text
        fields['column_mapping'] = json.dumps(mapping)
        preview = client.post(path + '?preview=true', headers=headers, data=fields, files=files)
        assert preview.status_code == 200, preview.text
        assert preview.json()['accepted'] == 2
        assert preview.json()['rows'][1]['balance_check'] == 'Matched'
        assert not store.history('imports', ['C1'])
        imported = client.post(path, headers=headers, data=fields, files=files)
        assert imported.status_code == 200, imported.text
        result = imported.json()
        assert result['accepted_new'] == 2
        assert result['source_id'] == sha256(content).hexdigest()
        for row in result['statement_rows']:
            evidence = row['evidence_id']
            response = client.post(f'/api/evidence/{evidence}/statement-row', headers=headers,
                                   files={'password': (None, password)})
            assert response.status_code == 200 and response.json()['matches_ingested']
            assert response.json()['locator']['format'] == ('image' if source_format == 'png' else source_format)
            assert response.json()['locator']['statement_layout'] == mapping
        assert client.post(path, headers=headers, data=fields, files=files).json()['recognized_repeat'] == 2
        fields['column_mapping'] = json.dumps({'columns': {**columns, 'narration': 5}})
        assert client.post(path, headers=headers, data=fields, files=files).status_code == 422
        fields['column_mapping'] = json.dumps({'columns': {key: value for key, value in columns.items() if key != 'narration'}})
        assert client.post(path, headers=headers, data=fields, files=files).status_code == 409


def test_manual_dividers_group_wrapped_borderless_pdf_rows():
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=(500, 500))
    canvas.drawString(25, 470, 'Page title')
    canvas.drawString(25, 410, '13/11/2026')
    canvas.drawString(130, 410, 'Synthetic transfer')
    canvas.drawString(330, 410, '10.25')
    canvas.drawString(130, 395, 'Memo continuation')
    canvas.drawString(25, 380, '14/11/2026')
    canvas.drawString(130, 380, 'Synthetic deposit')
    canvas.drawString(445, 380, '12.00')
    canvas.save()
    manual = {'columns': {'date': 1, 'narration': 2, 'debit': 3, 'credit': 4},
              'separators': [20, 60, 80]}
    records = statement_records(stream.getvalue(), '', 'INR', 'DMY', manual=manual)
    assert len(records) == 2
    assert [row['locator']['layout'] for row in records] == ['manual-text', 'manual-text']
    assert json.loads(records[0]['passage'])[1][1] == 'Synthetic transfer\nMemo continuation'
    assert [row['facts'][0]['attrs']['direction'] for row in records] == ['debit', 'credit']


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


def test_statement_evidence_can_be_saved_beyond_graph_capacity(tmp_path, monkeypatch):
    from maha.ingestion import node

    monkeypatch.delenv('NEO4J_URI', raising=False)
    monkeypatch.setenv('MAHA_MAX_GRAPH_NODES', '2000')
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    outside = {'Authorization': 'Bearer ' + store.create_user('outside', ['C2'])}
    store.import_records('synthetic.txt', b'seeded case graph', 'fixture', True, 'C1', (
        {'locator': {'row': index}, 'facts': [node('Transaction', f'original:{index}')]} for index in range(1200)
    ))
    workbook = Workbook()
    workbook.active.append(['Date', 'Details', 'Debit', 'Credit'])
    for _ in range(900):
        workbook.active.append(['27/05/2001', 'Synthetic payment', '2.10', None])
    stream = BytesIO()
    workbook.save(stream)
    content = stream.getvalue()
    url = '/api/import/bank-statement/C1'
    with TestClient(create_app(store)) as client:
        def upload(query=''):
            return client.post(url + query, headers=headers,
                               data={'currency': 'INR', 'date_order': 'DMY'},
                               files={'file': ('synthetic.xlsx', content)})

        preview = upload('?preview=true').json()
        assert preview['accepted'] == 900
        blocked = upload()
        assert blocked.status_code == 413
        assert 'case limit of 2,000 graph nodes' in blocked.json()['detail']
        assert len(store.history('imports', ['C1'])) == 1
        assert len(store.facts(['C1'])) == 1200
        assert preview['graph_impact']['nodes'] == {'current': 1200, 'added': 900, 'projected': 2100, 'limit': 2000}
        assert preview['graph_impact']['fits'] is False

        saved_response = upload('?destination=evidence')
        assert saved_response.status_code == 200, saved_response.text
        saved = saved_response.json()
        assert saved['accepted_new'] == 900 and saved['statement_destination'] == 'evidence'
        assert len(store.facts(['C1'])) == 1200
        batch = f"/api/quality/{saved['import_id']}"
        review = client.get(batch + '/statement-rows?all_rows=true', headers=headers).json()
        assert review['accepted'] == 900 and review['unpublished_rows'] == 900
        assert client.get(batch + '/money-flow', headers=headers).json()['totals']['debit'] == '1890.00'
        assert client.get('/api/source/' + saved['source_id'], headers=headers).content == content
        assert upload('?destination=evidence').json()['recognized_repeat'] == 900
        assert client.post(batch + '/publish-statement', headers=outside).status_code == 404
        assert client.post(batch + '/publish-statement', headers=headers).status_code == 413
        assert len(store.facts(['C1'])) == 1200
        assert client.get(batch + '/statement-rows?all_rows=true', headers=headers).json()['unpublished_rows'] == 900

        monkeypatch.setenv('MAHA_MAX_GRAPH_NODES', '2100')
        assert client.post(batch + '/publish-statement', headers=headers).json()['published_rows'] == 900
        assert client.post(batch + '/publish-statement', headers=headers).json()['published_rows'] == 0
        assert len(store.facts(['C1'])) == 2100
        assert client.get(batch + '/statement-rows?all_rows=true', headers=headers).json()['unpublished_rows'] == 0


def test_intake_inspection_suggests_existing_adapters_and_keeps_case_read_only(tmp_path, monkeypatch):
    from maha.ingestion import CDR_HEADER

    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    path = '/api/intake/C1/inspect'

    workbook = Workbook()
    workbook.active.append(['Account activity'])
    workbook.active.append(['Date', 'Details', 'Debit', 'Credit'])
    xlsx = BytesIO()
    workbook.save(xlsx)
    image = BytesIO()
    Image.new('RGB', (40, 40), 'white').save(image, format='PNG')
    fir = BytesIO()
    canvas = Canvas(fir)
    canvas.drawString(45, 770, 'FIRST INFORMATION REPORT')
    canvas.save()
    scans = BytesIO()
    canvas = Canvas(scans)
    canvas.drawImage(ImageReader(BytesIO(image.getvalue())), 45, 650, width=200, height=150)
    canvas.save()

    with TestClient(create_app(store)) as client:
        for content, file_type, kind in (
            (make_payment_export(), 'Digital PDF', 'bank-statement'),
            (make_encrypted_pdf(1), 'Password-protected PDF', None),
            (xlsx.getvalue(), 'Excel workbook', 'bank-statement'),
            (image.getvalue(), 'Scanned image', None),
            (scans.getvalue(), 'Scanned PDF', None),
            (fir.getvalue(), 'Digital PDF', 'fir-document'),
            (','.join(CDR_HEADER).encode() + b'\n', 'CSV', 'cdr'),
            (b'IN THE HIGH COURT, synthetic document.', 'Text document', 'judgment'),
            (b'generic,columns\nitem,value\n', 'CSV', None),
        ):
            response = client.post(path, headers=headers, content=content)
            assert response.status_code == 200, response.text
            assert response.json() == {'file_type': file_type, 'kind': kind}
        assert client.post(path, headers=headers, content=b'%PDF-broken').status_code == 422
        assert client.post('/api/intake/C2/inspect', headers=headers, content=xlsx.getvalue()).status_code == 403
        assert not store.history('imports', ['C1'])
        assert not store.facts(['C1'])
        with store.db() as db:
            assert db.execute('SELECT COUNT(*) FROM sources').fetchone()[0] == 0


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
            yield {'page': 1, 'row': 2}, ['Date', 'Amount'], ['21/11/2026', 'Narration 10'], {'date': 0, 'amount': 1}
        else:
            yield from original(page, encrypted, strategy, settings)

    monkeypatch.setattr(statements, 'pdf_table_rows', false_first)
    rows = [['Date', 'Debit', 'Credit'], ['21 / 11 / 2026', 'Rs. 1,25,000.00', '']]
    result = statement_records(make_encrypted_pdf(1, rows), PASSWORD, 'INR', 'DMY')
    assert result[0]['facts'][0]['attrs']['amount_paid'] == '125000.00'
    with pytest.raises(ValueError, match='Amount currency differs from the selected statement currency'):
        statement_records(make_encrypted_pdf(1, rows), PASSWORD, 'USD', 'DMY')


def test_pdfium_recovers_ruled_rows_when_primary_text_extraction_fails(monkeypatch):
    from pdfplumber.page import Page
    from pdfplumber.table import Table as PdfTable

    rows = [['Post Date', 'Details', 'Debit', 'Credit', 'Balance'],
            ['13/11/2026', 'Synthetic transfer\nNarration continuation', '10.25', '-', '894.75'],
            ['14/11/2026', 'Synthetic deposit', '-', '12.00', '906.75']]
    source = make_encrypted_pdf(1, rows)
    monkeypatch.setattr(Page, 'extract_words', lambda *args, **kwargs: [])
    monkeypatch.setattr(PdfTable, 'extract', lambda *args, **kwargs: [])
    result = statement_records(source, PASSWORD, 'INR', 'DMY', preview=True)
    assert [row['locator']['layout'] for row in result] == ['pdfium-grid', 'pdfium-grid']
    assert result[0]['fields']['narration'] == rows[1][1]
    assert [row['normalized'] for row in result] == [
        {'debit': '10.25', 'credit': ''}, {'debit': '', 'credit': '12.00'},
    ]


def test_fallback_recovers_a_failed_slot_without_replacing_the_accepted_row(monkeypatch):
    from pdfplumber.table import Table as PdfTable

    rows = [['Post Date', 'Details', 'Debit', 'Credit', 'Balance'],
            ['13/11/2026', 'Synthetic transfer', '10.25', '-', '894.75'],
            ['14/11/2026', 'Synthetic deposit', '-', '12.00', '906.75']]
    source = make_encrypted_pdf(1, rows)
    standard = statement_records(source, PASSWORD, 'INR', 'DMY')
    extract = PdfTable.extract

    def partial(self, *args, **kwargs):
        cells = extract(self, *args, **kwargs)
        for row in cells:
            if 'Synthetic deposit' in row and '12.00' in row:
                row[row.index('12.00')] = '12.OO'
        return cells

    monkeypatch.setattr(PdfTable, 'extract', partial)
    recovered = statement_records(source, PASSWORD, 'INR', 'DMY', preview=True)
    assert len(recovered) == 2
    assert recovered[0]['locator'] == standard[0]['locator']
    assert recovered[0]['facts'] == standard[0]['facts']
    assert recovered[1]['locator']['recovered_layout'] is True
    assert recovered[1]['normalized'] == {'debit': '', 'credit': '12.00'}
    assert statement_preview(recovered, 'INR')['recovered_layout_rows'] == 1


def test_fallback_rejects_a_reader_that_disagrees_on_the_accepted_transaction():
    columns = {'date': 0, 'debit': 1, 'credit': 2}
    headers = ['Date', 'Debit', 'Credit']

    def row(number, amount, layout):
        top = 10 * number
        return ({'page': 1, 'row': number, 'layout': layout, 'format': 'pdf', 'bbox_units': 'points',
                 'bbox': [0, top, 100, top + 9]}, headers, [f'{number:02d}/11/2026', amount, ''], columns)

    original = [row(13, '10', 'ruled'), row(14, 'unreadable', 'ruled')]
    disagreeing = [row(13, '15', 'pdfium-grid'), row(14, '20', 'pdfium-grid')]
    result = list(select_row_layout(((item for item in original), (item for item in disagreeing))))
    assert result == original


def test_decimal_comma_and_direction_markers_preserve_transaction_and_balance_signs():
    workbook = Workbook()
    for row in [
        ['Post Date', 'Amount (Dr/Cr)', 'Running Balance'],
        ['13/11/2026', '€ 1.000,25 Cr', '€ 500,00 Cr'],
        ['14/11/2026', '€ 1.050,25 DR', '550,25 Dr'],
        ['15/11/2026', '€ 2\u202f000,45Cr', '1\u202f450,20Cr'],
        ['16/11/2026', '-123,45 Cr', '1.326,75'],
    ]:
        workbook.active.append(row)
    stream = BytesIO()
    workbook.save(stream)
    records = statement_records(stream.getvalue(), '', 'EUR', 'DMY', preview=True)
    assert [row['normalized'] for row in records[:3]] == [
        {'debit': '', 'credit': '1000.25'},
        {'debit': '1050.25', 'credit': ''},
        {'debit': '', 'credit': '2000.45'},
    ]
    preview = statement_preview(records, 'EUR')
    assert [row['balance_check'] for row in preview['rows'][:3]] == ['Unverified', 'Matched', 'Matched']
    assert preview['rows'][3]['error'] == 'Invalid signed amount or debit/credit direction'


@pytest.mark.parametrize('source_format', ['pdf', 'png', 'xlsx'])
def test_recovers_seven_column_layout_from_balances_when_headings_are_unusable(source_format):
    rows = [
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        ['01/04/2025', '01/04/2025', 'Synthetic withdrawal\nAdditional detail', '-', '31.00', '-', '700.19'],
        ['02/04/2025', '02/04/2025', 'Synthetic transfer', '-', '13.00', '-', '687.19'],
        ['02/04/2025', '02/04/2025', 'Synthetic deposit', '-', '-', '29.00', '716.19'],
    ]
    content = make_encrypted_pdf(1, rows)
    if source_format == 'xlsx':
        workbook = Workbook()
        for row in rows:
            workbook.active.append(row)
        stream = BytesIO()
        workbook.save(stream)
        content = stream.getvalue()
    if source_format == 'png':
        bundled = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime/usr/bin/tesseract'
        if not shutil.which('tesseract') and not bundled.is_file():
            pytest.skip('Local Tesseract runtime unavailable')
        stream = BytesIO()
        with pdfplumber.open(BytesIO(content), password=PASSWORD) as document:
            page = document.pages[0]
            left, top, right, bottom = page.find_tables()[0].bbox
            with page.crop((left - 15, top - 15, right + 15, bottom + 15)).to_image(resolution=240, antialias=True).original as image:
                image.save(stream, 'PNG')
        content = stream.getvalue()
    detected = statement_records(content, PASSWORD, 'INR', 'DMY', preview=True)
    assert len(detected) == 3
    assert [row['normalized'] for row in detected] == [
        {'debit': '31.00', 'credit': ''}, {'debit': '13.00', 'credit': ''}, {'debit': '', 'credit': '29.00'},
    ]
    assert detected[0]['fields']['narration'] == rows[1][2]
    preview = statement_preview(detected, 'INR')
    assert preview['balance_inferred_pages'] == ([] if source_format == 'xlsx' else [1])
    assert preview['balance_inferred_sheets'] == (['Sheet'] if source_format == 'xlsx' else [])
    assert [row['balance_check'] for row in preview['rows']] == ['Unverified', 'Matched', 'Matched']


def test_balance_inference_defers_different_date_roles_or_unreconciled_amounts():
    unreadable_headers = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    body = [
        ['01/04/2025', '01/04/2025', 'Synthetic withdrawal', '-', '31.00', '-', '700.19'],
        ['01/04/2025', '02/04/2025', 'Synthetic transfer', '-', '13.00', '-', '687.19'],
        ['02/04/2025', '02/04/2025', 'Synthetic deposit', '-', '-', '29.00', '716.19'],
    ]
    location = {'format': 'pdf', 'page': 1, 'layout': 'balance-verified-ruled'}
    def extract(headers):
        table = ((number, row, None) for number, row in enumerate([headers, *body], 1))
        return list(balance_verified_rows(table, location))
    assert not extract(unreadable_headers)
    readable = ['Value Date', 'Post Date', *unreadable_headers[2:]]
    assert len(extract(readable)) == 3
    body[2][6] = '710.10'
    assert not extract(readable)


def test_first_page_can_use_verified_columns_from_page_two_and_quality_shows_details(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    first = [
        ['12/11/2026', '12/11/2026', 'Synthetic first-page withdrawal', '0007', '12.00', '-', '350.00'],
        ['13/11/2026', '13/11/2026', 'Synthetic first-page deposit', '0008', '-', '20.00', '369.00'],
    ]
    second = [
        ['14/11/2026', '14/11/2026', 'Synthetic withdrawal', '-', '30.00', '-', '339.00'],
        ['15/11/2026', '15/11/2026', 'Synthetic transfer', '-', '15.00', '-', '324.00'],
        ['15/11/2026', '15/11/2026', 'Synthetic deposit', '-', '-', '5.00', '329.00'],
    ]
    output = BytesIO()
    canvas = Canvas(output, pagesize=(600, 750), encrypt=StandardEncryption(PASSWORD, strength=128))
    for rows in (first, second):
        table = Table(rows, colWidths=[60, 60, 175, 50, 58, 58, 65])
        table.setStyle([('GRID', (0, 0), (-1, -1), .5, colors.black)])
        table.wrapOn(canvas, 600, 700)
        table.drawOn(canvas, 30, 420)
        canvas.showPage()
    canvas.save()
    content = output.getvalue()
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    restricted = {'Authorization': 'Bearer ' + store.create_user('other', ['C2'])}
    previous = store.import_records(
        'fixture.pdf', content, 'bank-statement', False, 'C1',
        statement_records(content, PASSWORD, 'INR', 'DMY', page_range=(2, 2)),
        statement_settings={'currency': 'INR', 'date_order': 'DMY'},
    )
    recovery = f"/api/quality/{previous['import_id']}/statement-page?page=1"
    fields = {'password': (None, PASSWORD)}
    with TestClient(create_app(store)) as client:
        assert client.post(recovery, headers=restricted, files=fields).status_code == 404
        assert client.post(recovery, headers=headers, files={'password': (None, 'wrong')}).status_code == 422
        preview = client.post(recovery, headers=headers, files=fields)
        assert preview.status_code == 200 and preview.json()['accepted'] == 2
        assert len(store.history('imports', ['C1'])) == 1
        response = client.post(recovery + '&preview=false', headers=headers, files=fields)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['accepted_new'] == 2
        assert data['statement_scope'] == {
            'requested': [1, 1], 'processed_pages': [1], 'accepted_pages': [1],
            'coverage': [{'page': 1, 'accepted': 2, 'rejected': 0, 'diagnostic': None}],
        }
        url = f"/api/quality/{data['import_id']}/statement-rows"
        quality = client.get(url, headers=headers).json()
        assert client.get(url, headers=restricted).status_code == 404
        assert quality['pages'] == [{'page': 1, 'count': 2}]
        assert quality['next_page'] == 3
        view = quality['rows'][0]
        assert view['locator']['header_page'] == 2
        assert view['fields']['reference'] == '0007'
        assert view['fields']['narration'] == first[0][2]
        assert view['fields']['value_date'] == first[0][0]
        assert view['fields']['balance'] == first[0][6]
        assert view['normalized'] == {'debit': '12.00'}
        replay = client.post(f"/api/evidence/{view['evidence_id']}/statement-row", headers=headers,
                             files={'password': (None, PASSWORD)})
        assert replay.status_code == 200 and replay.json()['matches_ingested']


def test_statement_new_pages_allow_a_different_mapping_without_changing_previous_rows(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    source = make_encrypted_pdf(2, ROWS[:3])
    store = Store(tmp_path / 'ledger')
    token = store.create_user('reviewer', ['C1'])
    previous = statement_records(source, PASSWORD, 'INR', 'DMY', page_range=(2, 2))
    store.import_records('original.pdf', source, 'bank-statement', False, 'C1', previous,
                         statement_settings={'currency': 'INR', 'date_order': 'DMY'})
    headers = {'Authorization': 'Bearer ' + token}
    fields = {'currency': 'INR', 'date_order': 'DMY', 'pdf_pages': '1', 'password': PASSWORD,
              'column_mapping': json.dumps({'columns': {'date': 1, 'narration': 2, 'debit': 3, 'credit': 4}})}
    files = {'file': ('original.pdf', source)}
    url = '/api/import/bank-statement/C1'
    with TestClient(create_app(store)) as client:
        assert client.post(url + '?preview=true', data=fields, files=files, headers=headers).json()['page_coverage'] == [
            {'page': 1, 'accepted': 2, 'rejected': 0, 'diagnostic': None},
        ]
        result = client.post(url, data=fields, files=files, headers=headers)
        assert result.status_code == 200, result.text
        assert result.json()['accepted_new'] == 2
        fields['pdf_pages'] = '2'
        assert client.post(url, data=fields, files=files, headers=headers).status_code == 409
        assert len(store.facts(['C1'])) == 4


def test_rejected_preview_correction_retains_original_extraction(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    workbook = Workbook()
    workbook.active.append(['Date', 'Debit', 'Credit'])
    workbook.active.append(['21/11/2026', '1O.25', ''])
    output = BytesIO()
    workbook.save(output)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
    fields = {'currency': 'INR', 'date_order': 'DMY'}
    files = {'file': ('fixture.xlsx', output.getvalue())}
    url = '/api/import/bank-statement/C1'
    with TestClient(create_app(store)) as client:
        preview = client.post(url + '?preview=true', headers=headers, data=fields, files=files)
        token = preview.json()['rows'][0]['candidate_id']
        assert preview.json()['rejected'] == 1
        fields['row_corrections'] = json.dumps({token: {'debit': '10.25'}})
        check = client.post(url + '?preview=true', headers=headers, data=fields, files=files)
        assert check.json()['rows'][0]['corrected']
        assert not store.history('imports', ['C1'])
        imported = client.post(url, headers=headers, data=fields, files=files)
        assert imported.status_code == 200, imported.text
        evidence_id = imported.json()['statement_rows'][0]['evidence_id']
        ev = store.evidence(evidence_id, ['C1'])
        assert json.loads(ev['passage'])[1][1] == '1O.25'
        assert ev['statement_correction']['fields']['debit'] == {'extracted': '1O.25', 'corrected': '10.25'}
        assert store.facts(['C1'])[0]['attrs']['amount_paid'] == '10.25'
        assert client.post(url, headers=headers, data=fields, files=files).json()['recognized_repeat'] == 1
        fields['row_corrections'] = json.dumps({token: {'debit': '12.25'}})
        assert client.post(url, headers=headers, data=fields, files=files).status_code == 409
        fields['row_corrections'] = json.dumps({'a' * 32: {'debit': '12.25'}})
        assert client.post(url, headers=headers, data=fields, files=files).status_code == 422


@pytest.mark.parametrize('source_format', ['pdf', 'scanned-pdf', 'tiff'])
def test_continuation_pages_reuse_confirmed_layout_for_ranges(source_format, tmp_path, monkeypatch):
    headings = ['Date', 'Details', 'Debit', 'Credit', 'Balance']
    first = [['21/11/2026', 'Synthetic withdrawal', '10.00', '', '490.00'],
             ['22/11/2026', 'Synthetic deposit', '', '20.00', '510.00']]
    second = [['23/11/2026', 'Synthetic second-page withdrawal', '30.00', '', '480.00'],
              ['24/11/2026', 'Synthetic second-page deposit', '', '15.00', '495.00']]
    origin = BytesIO()
    canvas = Canvas(origin, pagesize=(600, 750), encrypt=StandardEncryption(PASSWORD, strength=128))
    for data in ([headings, *first], second, second):
        table = Table(data, colWidths=[72, 190, 70, 70, 80])
        table.setStyle([('GRID', (0, 0), (-1, -1), .5, colors.black)])
        table.wrapOn(canvas, 600, 700)
        table.drawOn(canvas, 75 if canvas.getPageNumber() == 3 else 40, 400)
        canvas.showPage()
    canvas.save()
    source = origin.getvalue()
    password = PASSWORD
    if source_format != 'pdf':
        bundled = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime/usr/bin/tesseract'
        if not shutil.which('tesseract') and not bundled.is_file():
            pytest.skip('Local Tesseract runtime unavailable')
        with pdfplumber.open(BytesIO(source), password=PASSWORD) as document:
            images = [page.to_image(resolution=220, antialias=True).original for page in document.pages[:2]]
        scanned = BytesIO()
        try:
            if source_format == 'tiff':
                images[0].save(scanned, 'TIFF', save_all=True, append_images=images[1:], compression='tiff_deflate')
                password = ''
            else:
                scan = Canvas(scanned, pagesize=(600, 750), encrypt=StandardEncryption(PASSWORD, strength=128))
                for image in images:
                    scan.drawImage(ImageReader(image), 0, 0, 600, 750)
                    scan.showPage()
                scan.save()
        finally:
            for image in images:
                image.close()
        source = scanned.getvalue()
    full = statement_records(source, password, 'INR', 'DMY', page_range=(1, 2))
    partial = statement_records(source, password, 'INR', 'DMY', page_range=(2, 2))
    assert len(full) == 4 and len(partial) == 2
    assert partial == full[2:]
    assert [row['facts'][0]['attrs']['amount_paid'] for row in partial] == ['30.00', '15.00']
    assert all(row['locator'].get('header_page') == 1 for row in partial)
    assert all(row['locator']['page'] == 2 for row in partial)
    if source_format == 'pdf':
        with pytest.raises(ValueError, match='could not identify the transaction columns'):
            statement_records(source, password, 'INR', 'DMY', page_range=(3, 3))
        monkeypatch.delenv('NEO4J_URI', raising=False)
        store = Store(tmp_path / 'ledger')
        headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
        fields = {'currency': 'INR', 'date_order': 'DMY', 'password': password, 'pdf_pages': '2'}
        files = {'file': ('fixture.pdf', source, 'application/pdf')}
        with TestClient(create_app(store)) as client:
            response = client.post('/api/import/bank-statement/C1', headers=headers, data=fields, files=files)
            assert response.status_code == 200, response.text
            row_id = response.json()['statement_rows'][0]['evidence_id']
            replay = client.post(f'/api/evidence/{row_id}/statement-row', headers=headers,
                                 files={'password': (None, password)})
            assert replay.status_code == 200 and replay.json()['matches_ingested']


@pytest.mark.parametrize(('scan_format', 'turn', 'tilt'), [
    ('png', 0, 0), ('jpeg', 0, 0), ('pdf', 0, 0), ('jpeg', 270, 0), ('pdf', 180, 0),
    ('tiff', 0, 0), ('jpeg', 0, 3.5), ('jpeg', 270, -4),
])
def test_scanned_statement_recovers_ruled_multiline_rows(scan_format, turn, tilt, tmp_path, monkeypatch):
    bundled_ocr = Path(__file__).resolve().parents[1] / 'data/private/ocr-runtime/usr/bin/tesseract'
    if not shutil.which('tesseract') and not bundled_ocr.is_file():
        pytest.skip('Local Tesseract runtime unavailable')
    table = [
        ['Value Date', 'Post Date', 'Details', 'Ref No/\nCheque No', 'Debit', 'Credit', 'Balance'],
        ['01/04/2025', '01/04/2025', 'First synthetic transfer\nNarration continues here\nThird detail line', '-', '40.00', '-', '700.00'],
        ['02/04/2025', '02/04/2025', 'Second synthetic transfer\nAdditional detail', '-', '15.00', '-', '685.00'],
        ['02/04/2025', '02/04/2025', 'Synthetic deposit', '-', '-', '25.00', '710.00'],
    ]
    vector = make_encrypted_pdf(1, table)
    with pdfplumber.open(BytesIO(vector), password=PASSWORD) as doc:
        page = doc.pages[0]
        raster = page.to_image(resolution=240, antialias=True)
        source_row_bounds = [row.bbox for row in page.find_tables()[0].rows[1:]]
        output = BytesIO()
        with raster.original as image:
            image_width, image_height = image.size
            with image.rotate(tilt, resample=Image.Resampling.BICUBIC, fillcolor='white') as angled:
                scan_image = angled.transpose(getattr(Image.Transpose, f'ROTATE_{turn}')) if turn else angled.copy()
            with scan_image:
                if scan_format == 'pdf':
                    scan = Canvas(output, encrypt=StandardEncryption(PASSWORD, strength=128))
                    scan.drawImage(ImageReader(scan_image), 0, 0, raster.page.width, raster.page.height)
                    scan.save()
                elif scan_format == 'tiff':
                    with Image.new('RGB', scan_image.size, 'white') as cover:
                        cover.save(output, format='TIFF', save_all=True, append_images=[scan_image],
                                   compression='tiff_deflate')
                else:
                    scan_image.save(output, format=scan_format.upper())
    content = output.getvalue()
    page_range = (2, 2) if scan_format == 'tiff' else None
    records = statement_records(content, PASSWORD, 'INR', 'DMY', page_range=page_range)
    assert len(records) == 3
    assert all(record['locator']['layout'] == 'ocr-grid' for record in records)
    assert 'Narration continues here' in records[0]['passage']
    assert [(row['facts'][0]['attrs']['amount_paid'], row['facts'][0]['attrs']['direction']) for row in records] == [
        ('40.00', 'debit'), ('15.00', 'debit'), ('25.00', 'credit'),
    ]
    if turn or tilt:
        locators = [row['locator'] for row in records]
        assert all(item.get('ocr_rotation', 0) == (-turn) % 360 for item in locators)
        if tilt:
            assert all(abs(item['ocr_deskew_degrees'] + tilt) <= .5 for item in locators)
        axis = 0 if turn == 270 else 1
        if turn:
            assert locators[0]['bbox'][axis] > locators[-1]['bbox'][axis]
        else:
            assert locators[0]['bbox'][axis] < locators[-1]['bbox'][axis]
        assert all(x1 > x0 and y1 > y0 and x0 >= 0 and y0 >= 0
                   for x0, y0, x1, y1 in (item['bbox'] for item in locators))
    if tilt:
        angle = radians(tilt)
        center_x, center_y = image_width / 2, image_height / 2
        for record, (left, top, right, bottom) in zip(records, source_row_bounds, strict=True):
            offset_x = (left + right) * raster.scale / 2 - center_x
            offset_y = (top + bottom) * raster.scale / 2 - center_y
            x = center_x + offset_x * cos(angle) + offset_y * sin(angle)
            y = center_y - offset_x * sin(angle) + offset_y * cos(angle)
            if turn == 270:
                x, y = image_height - y, x
            x0, y0, x1, y1 = record['locator']['bbox']
            assert x0 < x < x1 and y0 < y < y1
    if scan_format in {'png', 'tiff'}:
        monkeypatch.delenv('NEO4J_URI', raising=False)
        store = Store(tmp_path / 'ledger')
        headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['C1'])}
        with TestClient(create_app(store)) as client:
            path = '/api/import/bank-statement/C1'
            form = {'headers': headers, 'data': {'currency': 'INR', 'date_order': 'DMY'},
                    'files': {'file': (f'fixture.{scan_format}', content, f'image/{scan_format}')}}
            if page_range:
                form['data']['pdf_pages'] = '2'
                page_view = client.post(path + '?layout_page=true', **form)
                assert page_view.status_code == 200 and page_view.headers['X-Statement-Page'] == '2'
            preview = client.post(path + '?preview=true', **form)
            assert preview.status_code == 200, preview.text
            assert preview.headers['Cache-Control'] == 'no-store'
            assert not store.history('imports', ['C1'])
            assert [row['balance_check'] for row in preview.json()['rows']] == ['Unverified', 'Matched', 'Matched']
            imported = client.post(path, **form)
            assert imported.status_code == 200, imported.text
            assert imported.json()['accepted_new'] == 3
            assert imported.json()['source_id'] == sha256(content).hexdigest()
            evidence = imported.json()['statement_rows'][0]['evidence_id']
            checked = client.post(f'/api/evidence/{evidence}/statement-row', headers=headers,
                                  files={'password': (None, '')})
            assert checked.status_code == 200 and checked.json()['matches_ingested']
            assert checked.json()['locator']['page'] == (2 if page_range else 1)


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
