"""Generate one fictional case and evaluate the normal MAHA import and analysis endpoints."""

import argparse
from contextlib import ExitStack
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
from io import BytesIO
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
import httpx
import pdfplumber
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from maha.api import create_app
from maha.document_intake import render_pdf_image
from maha.store import Store


def text_pdf(lines):
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=(760, 420))
    canvas.setFont('Helvetica', 15)
    for index, line in enumerate(lines):
        canvas.drawString(40, 355 - index * 29, line)
    canvas.save()
    return stream.getvalue()


def scan_pdf(content, dimensions):
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=dimensions)
    with pdfplumber.open(BytesIO(content)) as original:
        for page in original.pages:
            with render_pdf_image(page, resolution=210, antialias=True).original as image:
                canvas.drawImage(ImageReader(image), 0, 0, *dimensions)
            canvas.showPage()
    canvas.save()
    return stream.getvalue()


def draw_table(canvas, rows, widths, top):
    table = Table(rows, colWidths=widths, rowHeights=26)
    table.setStyle([('GRID', (0, 0), (-1, -1), 1, colors.black),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('FONTSIZE', (0, 0), (-1, -1), 11)])
    _, height = table.wrapOn(canvas, 1000, 800)
    table.drawOn(canvas, 35, top - height)


def report_pdf(header, rows, widths):
    stream = BytesIO()
    dims = (1000, 690)
    canvas = Canvas(stream, pagesize=dims)
    for offset in range(0, len(rows), 13):
        draw_table(canvas, [header, *rows[offset:offset + 13]], widths, 622)
        canvas.showPage()
    canvas.save()
    return stream.getvalue()


def bank_pdf():
    header = ['Date', 'Details', 'Debit', 'Credit', 'Balance']
    payments = [
        ('18/05/2001', 'DR', '12500.00'), ('19/05/2001', 'CR', '4800.00'),
        ('20/05/2001', 'DR', '2100.00'), ('21/05/2001', 'CR', '800.00'),
        ('22/05/2001', 'DR', '1800.00'), ('23/05/2001', 'CR', '120.00'),
        ('24/05/2001', 'DR', '1400.00'), ('25/05/2001', 'CR', '350.00'),
    ]
    balance, debit_total, credit_total = Decimal('35000.00'), Decimal(0), Decimal(0)
    rows = [header]
    for index, (day, kind, amount) in enumerate(payments, 1):
        debit = amount if kind == 'DR' else ''
        credit = amount if kind == 'CR' else ''
        debit_total += Decimal(debit or 0)
        credit_total += Decimal(credit or 0)
        balance += Decimal(credit or 0) - Decimal(debit or 0)
        rows.append([day, f'UPI/{kind}/{index:012d}/Lina Quill/TEST/demoalias/UPI', debit, credit, str(balance)])
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=(1000, 690))
    canvas.drawString(35, 660, 'Fictional River Ledger Bank statement')
    draw_table(canvas, rows, [110, 470, 112, 112, 112], 615)
    draw_table(canvas, [
        ['Statement Summary  18-05-2001 To 25-05-2001', '', '', '', '', ''],
        ['Brought Forward (INR)', 'Dr Count', 'Cr Count', 'Total Debits (INR)', 'Total Credits (INR)', 'Closing Balance (INR)'],
        ['35000.00CR', '4', '4', str(debit_total), str(credit_total), str(balance) + 'CR'],
    ], [220, 108, 108, 155, 155, 155], 310)
    canvas.save()
    return stream.getvalue(), debit_total, credit_total


def generate(directory, case_id):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Keep the source statement on one OCR line for the initial printed-layout fixture.
    fir = text_pdf([
        'FIRST INFORMATION REPORT', 'FIR No: SAMPLE-001 | Date: 2001-05-17',
        'Police Station: Fictional River Ward',
        'Niren Vale was seen at Kempegowda International Airport on 2001-05-17.',
        'Meeting occurred in Bengaluru, Karnataka on 2001-05-18.',
        'Registered address: Unnamed Warehouse Annex.',
        'Sections cited: Example provisions for software testing.',
    ])
    judgment = text_pdf([
        'IN THE HIGH COURT OF KARNATAKA', 'Case No: TEST-235/2001', 'Decision Date: 2001-05-26',
        'Court: Fictional Trial Bench', 'Justice Mira Stone heard counsel for the petitioner.',
        'Petitioner: River Lantern Trading Limited.', 'The witness Niren Vale attended the hearing.',
        'Handover occurred in Mysuru, Karnataka on 2001-05-19.',
    ])
    account_rows = [
        ['2001-05-17T02:10:00+00:00', 'River Test', 'RL-001', 'Lake Test', 'LT-002', '84000.00', 'INR', 'LOOP-01'],
        ['2001-05-17T02:40:00+00:00', 'Lake Test', 'LT-002', 'Hill Test', 'HT-003', '80000.00', 'INR', 'LOOP-02'],
        ['2001-05-17T03:05:00+00:00', 'Hill Test', 'HT-003', 'River Test', 'RL-001', '76000.00', 'INR', 'LOOP-03'],
    ]
    for index in range(22):
        time = datetime.fromisoformat('2001-05-18T09:00:00+00:00') + timedelta(days=index // 4, hours=index % 4)
        account_rows.append([time.isoformat(), 'Trading Test', 'TT-100', 'Supplier Test', f'ST-{index:03d}',
                             f'{5500 + (index % 5) * 120}.00', 'INR', f'NORMAL-{index:02d}'])
    account_rows.append(['2001-05-24T01:05:00+00:00', 'Trading Test', 'TT-100', 'Supplier Test', 'ST-001',
                         '125000.00', 'INR', 'LEGIT-LARGE'])
    cdr = report_pdf(['Calling Number', 'Called Number', 'Call Date', 'Call Time', 'Duration (seconds)'], [
        ['5550100123', '5550100456', '17/05/2001', '08:15:00', '23'],
        ['5550100456', '5550100123', '18/05/2001', '09:20:00', '64'],
        ['5550100998', '5550100989', '19/05/2001', '10:45:00', '17'],
    ], [130, 130, 120, 120, 130])
    bank, debit, credit = bank_pdf()
    register = [
        {'document_id': 'FICTIONAL-REGISTER-01', 'case_id': case_id, 'filed_date': '2001-05-17', 'synthetic': True,
         'text': ('Person Niren Vale [ID:NV01] is named as company director in this case.\n'
                  'Person Niren Vale [ID:NV01] owns account [Bank:River Test; Account:RL-001].\n'
                  'Person Lina Quill [ID:LQ01] owns account [Bank:Lake Test; Account:LT-002].\n'
                  'Person Miro Finch [ID:MF01] owns account [Bank:Hill Test; Account:HT-003].\n'
                  'Person Dana Voss [ID:DV01] is named as a witness in this case.\n'
                  'An unsigned note mentions Niren Vale without any identifying details.')},
        {'document_id': 'FICTIONAL-REGISTER-02', 'case_id': case_id, 'filed_date': '2001-05-18', 'synthetic': True,
         'text': ('Person Niren Vale [ID:NV02] is named as a witness in this case.\n'
                  'Person Niren Vale [ID:NV02] owns account [Bank:Trading Test; Account:TT-100].\n'
                  'Niren Vale spoke at a separately recorded business meeting.')},
    ]
    files = {
        'fir-scan.pdf': scan_pdf(fir, (760, 420)), 'court-decision.pdf': judgment, 'bank-statement.pdf': bank,
        'wire-report.pdf': report_pdf(['Timestamp', 'Sender Bank', 'Sender Account', 'Receiver Bank', 'Receiver Account',
                                       'Amount', 'Currency', 'Reference'], account_rows, [185, 120, 110, 120, 110, 90, 84, 95]),
        'call-report-scan.pdf': scan_pdf(cdr, (1000, 690)),
        'fictional-account-register.json': json.dumps(register, indent=2).encode(),
    }
    for name, contents in files.items():
        (directory / name).write_bytes(contents)
    truth = {
        'case_id': case_id, 'organizer': 'person:demo:NV01', 'same_name_control': 'person:demo:NV02',
        'cycle_references': ['LOOP-01', 'LOOP-02', 'LOOP-03'], 'legitimate_large_reference': 'LEGIT-LARGE',
        'wire_rows': len(account_rows), 'call_rows': 3, 'bank_rows': 8, 'bank_debit': str(debit), 'bank_credit': str(credit),
    }
    (directory / 'expected.json').write_text(json.dumps(truth, indent=2) + '\n')
    return files, truth


def api_json(response):
    if not response.is_success:
        raise RuntimeError(f'{response.request.method} {response.request.url.path} HTTP {response.status_code}: {response.text[:300]}')
    return response.json()


def run(client, case, files, truth, directory):
    checks = []
    def record(label, passed, detail):
        checks.append((label, bool(passed), detail))

    assigned = api_json(client.get('/api/cases'))
    if any(row['case_id'] == case for row in assigned):
        raise RuntimeError('Choose a fresh demo case identifier.')
    api_json(client.post('/api/cases', json={'case_id': case}))

    def preview_import(kind, filename, params):
        path = f'/api/report-intake/{kind}/{case}'
        source = files[filename]
        preview = api_json(client.post(path, content=source, params=params))
        expected = truth['wire_rows' if kind == 'wires' else 'call_rows']
        record(f'{kind.title()} preview', preview['accepted'] == expected and preview['rejected'] == 0,
               f"{preview['accepted']}/{expected} accepted by preview, {preview['rejected']} rejected")
        batch = api_json(client.post(path, content=source, params={**params, 'review_digest': preview['review_digest'],
                                                                  'accept_partial': True}))
        return batch

    imports = {}
    for filename, kind in [('fir-scan.pdf', 'fir-document'), ('court-decision.pdf', 'judgment-document'),
                           ('wire-report.pdf', 'wires-document'), ('call-report-scan.pdf', 'calls-document'),
                           ('bank-statement.pdf', 'bank-statement')]:
        detection = api_json(client.post(f'/api/intake/{case}/inspect', content=files[filename]))
        record(f'Detect {filename}', detection['kind'] == kind, str(detection))
    for filename, kind in [('fir-scan.pdf', 'fir-document'), ('court-decision.pdf', 'judgment-document'),
                           ('fictional-account-register.json', 'narrative')]:
        batch = api_json(client.post(f'/api/import/{kind}/{case}', content=files[filename]))
        imports[filename] = batch
        record(f'Import {filename}', batch['accepted_new'] > 0 and batch['quarantined'] == 0,
               f"{batch['accepted_new']} observations, {batch['quarantined']} quarantined")
    calls = preview_import('calls', 'call-report-scan.pdf', {'offset': '+05:30'})
    wires = preview_import('wires', 'wire-report.pdf', {})
    imports.update({'call-report-scan.pdf': calls, 'wire-report.pdf': wires})
    call_items = api_json(client.get(f"/api/quality/{calls['import_id']}/call-report"))['calls']
    record('Dedicated call report', len(call_items) == truth['call_rows'] and
           all(item['locator']['text_method'] == 'tesseract-eng' for item in call_items),
           f'{len(call_items)} saved rows with OCR provenance')
    if call_items:
        page = client.get(f"/api/evidence/{call_items[0]['id']}/source-page")
        record('Open original call row', page.content.startswith(b'\x89PNG'), f'HTTP {page.status_code}')

    def statement(params):
        return api_json(client.post(f'/api/import/bank-statement/{case}', params=params,
                                    files={'file': ('bank-statement.pdf', files['bank-statement.pdf'])},
                                    data={'currency': 'INR', 'date_order': 'DMY', 'statement_name': 'Fictional River Bank statement'}))

    bank_preview = statement({'preview': 'true'})
    record('Bank statement preview', bank_preview['accepted'] == truth['bank_rows'],
           f"{bank_preview['accepted']}/{truth['bank_rows']} rows, {bank_preview['balance_checks']['matched']} running-balance matches")
    printed = bank_preview.get('reconciliation') or {}
    comparison = printed.get('checks') or {}
    record('Printed statement reconciliation', bool(comparison) and all(item['matches'] for item in comparison.values()),
           str(comparison))
    bank = statement({})
    imports['bank-statement.pdf'] = bank
    money_path = f"/api/quality/{bank['import_id']}/money-flow"
    money = api_json(client.get(money_path))
    record('Statement money flow', money['totals']['debit'] == truth['bank_debit'] and
           money['totals']['credit'] == truth['bank_credit'] and
           any(len(party['directions']) == 2 for party in money['counterparties']),
           f"Debit {money['totals']['debit']} and credit {money['totals']['credit']} INR, {len(money['counterparties'])} counterparties")
    owner = client.put(money_path + '/owner', json={'account': money['account'], 'name': 'Niren Vale', 'person_id': truth['organizer']})
    record('Explicit statement owner link', owner.status_code == 200, f'HTTP {owner.status_code}')
    if money['rows']:
        response = client.post(f"/api/evidence/{money['rows'][0]['evidence_id']}/statement-row",
                               files={'password': (None, '')})
        record('Replay saved bank row', response.status_code == 200 and response.json().get('matches_ingested'), f'HTTP {response.status_code}')

    matches = api_json(client.get('/api/candidates', params={'case': case}))
    prohibited_pair = {truth['organizer'], truth['same_name_control']}
    candidate = any({item['left'], item['right']} == prohibited_pair for item in matches)
    record('Same-name decoy stays separate', not candidate,
           f'{len(matches)} suggested pairs in this case, no pair joining the two conflicting IDs')
    for row in api_json(client.get(f'/api/places/{case}')):
        place = row['place']
        path = f"/api/places/{case}/{row['id']}"
        if place['relation'] == 'reported_presence' and 'International Airport' in place['text']:
            choices = api_json(client.get(path + '/matches'))
            found = next((item for item in choices if item['geometry'] == 'point' and 'Kempegowda' in item['name']), None)
            if found:
                api_json(client.put(path, json={'status': 'confirmed', 'match_id': found['id'], 'person_id': truth['organizer']}))
                source = client.get(f"/api/evidence/{row['id']}/source-page")
                record('Scanned reported presence pinned', source.content.startswith(b'\x89PNG'), found['name'])
        elif place['relation'] == 'event_location':
            choices = api_json(client.get(path + '/matches'))
            if choices and choices[0]['geometry'] == 'area':
                api_json(client.put(path, json={'status': 'confirmed', 'match_id': choices[0]['id']}))
        elif place['relation'] == 'address' and 'Warehouse' in place['text']:
            choices = api_json(client.get(path + '/matches'))
            api_json(client.put(path, json={'status': 'unresolved'}))
            record('Unmatched address left unresolved', not choices, place['text'])
    events = api_json(client.get('/api/timeline', params={'case': case}))
    place_events = [item for item in events if item.get('kind') == 'document_place']
    record('Reviewed places in timeline', len(place_events) >= 2, f'{len(place_events)} dated place entries')
    if not any(label.startswith('Scanned reported') for label, _, _ in checks):
        record('Scanned reported presence pinned', False, 'The expected site was not mapped.')

    trained = api_json(client.post(f'/api/cases/{case}/train'))
    analysis = api_json(client.get('/api/analysis', params={'case': case}))
    graph = api_json(client.get('/api/graph', params={'case': case}))
    by_transaction = {edge['attrs'].get('transaction_id'): edge for edge in graph['edges'] if edge['type'] == 'TRANSACTED_WITH'}
    involved = {edge['attrs'].get('reference'): edge for edge in by_transaction.values()}
    expected_cycle = truth['cycle_references']
    found = [lead for lead in analysis['leads'] if 'fund_flow' in lead['techniques']]
    cycles = [[by_transaction[transaction]['attrs'].get('reference') for transaction in lead['transaction_ids']] for lead in found]
    record('Recover ordered transfer cycle', expected_cycle in cycles, f'{len(cycles)} cycle leads, expected {expected_cycle}')
    rank = sorted(analysis['metrics'], key=lambda identifier: (-analysis['metrics'][identifier]['pagerank'], identifier))
    ranks = {node['label']: rank.index(node['id']) + 1 for node in graph['nodes']
             if node['id'] in rank and any(value in node['label'] for value in ('RL-001', 'LT-002', 'HT-003', 'TT-100'))}
    detected = [lead for lead in analysis['leads'] if 'isolation_forest' in lead['techniques']]
    transaction_map = {node['id']: node for node in graph['nodes'] if node['type'] == 'Transaction'}
    alerts = [(transaction_map[lead['subject_ids'][0]]['attrs'].get('reference'), lead['score_scope'])
              for lead in detected if lead['subject_ids'][0] in transaction_map]
    organizer_accounts = {edge['target'] for edge in graph['edges'] if edge['type'] == 'OWNS_ACCOUNT' and edge['source'] == truth['organizer']}
    cycle_accounts = {involved[reference]['source'] for reference in expected_cycle if reference in involved}
    linked = bool(organizer_accounts & cycle_accounts)
    record('Attribute the cycle to the planted organizer', linked,
           'The expected wire account was linked.' if linked else 'The declared and wire-report account IDs remain separate.')
    record('Rank the planted organizer', bool(trained.get('kingpin') and trained['kingpin']['id'] == truth['organizer']),
           'This fresh case is outside the bundled Exchange ranking scope.' if not trained.get('kingpin') else 'Ranking returned.')
    report = api_json(client.get('/api/report', params={'case': case}))
    lead_evidence = {eid for lead in analysis['leads'] for eid in lead['evidence_ids']}
    supported = {entry['id'] for entry in report['evidence']}
    record('Export contains every cited lead source', lead_evidence.issubset(supported),
           f'{len(lead_evidence & supported)}/{len(lead_evidence)} unique cited evidence items')
    hashes = set()
    for filename, batch in imports.items():
        raw = client.get('/api/source/' + batch['source_id'])
        if raw.status_code == 200 and raw.content == files[filename]:
            hashes.add(hashlib.sha256(raw.content).hexdigest())
    # Template JSON is normalized by its existing adapter before retention.
    record('Preserve original PDFs', all(hashlib.sha256(files[name]).hexdigest() in hashes for name in files if name.endswith('.pdf')),
           f"{sum(hashlib.sha256(files[name]).hexdigest() in hashes for name in files if name.endswith('.pdf'))}/5 PDFs matched byte for byte")

    result = {'case_id': case, 'checks': checks, 'wire_row_count': truth['wire_rows'], 'cycles': cycles,
              'anomaly_status': analysis['anomaly_status'], 'anomaly_alerts': alerts, 'account_ranks': ranks,
              'runtime': {name: version(name) for name in ('spacy', 'en-core-web-sm', 'scikit-learn', 'networkx')},
              'legal_ner_versions': sorted({api_json(client.get('/api/evidence/' + item['evidence_id']))['extraction_version']
                                            for item in imports['court-decision.pdf'].get('legal_mentions', [])[:1]})}
    (directory / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    lines = [f'# Synthetic investigation evaluation for {case}', '', '| Check | Result | Detail |', '| --- | --- | --- |']
    lines.extend(f'| {name} | {"Pass" if passed else "Gap"} | {detail.replace("|", "/")} |' for name, passed, detail in checks)
    lines.extend(['', '## Analysis observed', '', f'- Runtime versions {result["runtime"]}.',
                  f'- Legal NER model version {result["legal_ner_versions"]}.',
                  f'- Isolation Forest groups {analysis["anomaly_status"]}.',
                  f'- Flagged wire references and score scopes {alerts}.',
                  f'- Account PageRank positions {ranks}.',
                  '- PageRank, Louvain, betweenness, and chronological fund-flow tracing ran on the case graph.',
                  '- The anomaly detector fits and scores the same cases. Legitimate outliers are a negative control for interpreting those scores.',
                  '- The rule-based organizer ranking is scoped to the bundled Exchange sample.',
                  '- This synthetic run measures pipeline behavior on fixed fictional evidence.'])
    (directory / 'evaluation.md').write_text('\n'.join(lines) + '\n')
    print(f'{case} · {sum(passed for _, passed, _ in checks)}/{len(checks)} checks passed · {directory / "evaluation.md"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--live', action='store_true', help='Create the synthetic case on the existing loopback service.')
    args = parser.parse_args()
    if not re.fullmatch(r'DEMO-[A-Z0-9-]{3,55}', args.case):
        parser.error('Use a fresh case ID beginning with DEMO-.')
    output = args.out.resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error('Use an empty output directory for a fresh evaluation.')
    files, truth = generate(output, args.case)
    with ExitStack() as stack:
        if args.live:
            auth = json.loads((ROOT / 'data/private/runtime/access.json').read_text())
            client = stack.enter_context(httpx.Client(base_url='http://127.0.0.1:8765',
                headers={'Authorization': 'Bearer ' + auth['investigator']}, timeout=100, trust_env=False))
        else:
            os.environ.pop('NEO4J_URI', None)
            os.environ.pop('MAHA_LOCAL_GEOCODER', None)
            root = stack.enter_context(TemporaryDirectory(prefix='maha-evaluation-'))
            store = Store(Path(root) / 'ledger')
            token = store.create_user('synthetic-reviewer', ['DEMO-EMPTY'])
            client = stack.enter_context(TestClient(create_app(store), headers={'Authorization': 'Bearer ' + token}))
        run(client, args.case, files, truth, output)


if __name__ == '__main__':
    main()
