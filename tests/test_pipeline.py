import csv
import io
import json
from datetime import datetime,timezone,timedelta
import pytest
from fastapi.testclient import TestClient
from maha.store import Store,uid
from maha.ingestion import IBM_HEADER,ibm_records,narrative_records,pdf_records,account,node,edge
from maha.graph import snapshot
from maha.analytics import analyze,fund_flow,projection
from maha.nlp import candidates


def csv_bytes(rows):
    out=io.StringIO();w=csv.writer(out);w.writerow(IBM_HEADER);w.writerows(rows);return out.getvalue().encode()


def row(a='A',b='B',hour=9,paid='100',cur='US Dollar'):
    return [f'2022/09/01 {hour:02}:00','010',a,'020',b,paid,cur,paid,cur,'ACH','0']


@pytest.fixture
def store(tmp_path,monkeypatch):
    monkeypatch.delenv('NEO4J_URI',raising=False)
    return Store(tmp_path/'private')


def ingest(store,rows,case='C1'):
    data=csv_bytes(rows)
    return store.import_records('bank.csv',data,'ibm-hi-small',True,case,ibm_records(data))


def test_positional_accounts_leading_zero_and_decimal(store):
    ingest(store,[row(paid='0.10')]);g=snapshot(store,['C1'])
    accounts=[n for n in g['nodes'] if n['type']=='Account']
    assert {n['attrs']['bank'] for n in accounts}=={'010','020'}
    assert account('010','A')!=account('020','A')
    assert next(n for n in g['nodes'] if n['type']=='Transaction')['attrs']['amount_paid']=='0.10'
    assert {e['type'] for e in g['edges']}=={'SENT_FROM','SENT_TO','TRANSACTED_WITH'}


def test_access_file_cannot_restore_stale_tokens(store):
    old = store.create_user('reviewer', ['C1'])
    removed = store.create_user('removed', ['C2'])
    (store.root / 'access.json').write_text(json.dumps({'reviewer': old, 'removed': removed}))
    current = store.create_user('reviewer', ['C1'])
    with store.db() as db:
        db.execute("DELETE FROM users WHERE name='removed'")

    reopened = Store(store.root)
    for token in (old, removed):
        with pytest.raises(PermissionError):
            reopened.authenticate(token)
    assert reopened.authenticate(current) == {'name': 'reviewer', 'cases': ['C1']}


def test_role_scoring_is_scoped_to_bundled_sample_evidence(store):
    from maha.api import create_app

    case = 'C1'
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', [case])}
    with TestClient(create_app(store)) as client:
        assert client.post('/api/cases/C1/load-sample', headers=headers).status_code == 200
        trained = client.post('/api/cases/C1/train', headers=headers)
        assert trained.status_code == 200
        assert trained.json()['kingpin']['scope'] == 'bundled synthetic sample review cue'
        store.import_records('fixture.txt', b'Independent evidence fixture', 'fixture', False, case, [
            {'locator': {'line': 1}, 'facts': [node('Person', 'person:fixture', 'Example person')]},
        ])
        mixed = client.post('/api/cases/C1/train', headers=headers)
        assert mixed.status_code == 200
        assert mixed.json()['kingpin'] is None
        assert mixed.json()['suspects']
        assert all('kingpin_score' not in dossier for dossier in mixed.json()['suspects'])


def test_duplicate_values_retained_repeat_import_idempotent(store):
    r=ingest(store,[row(),row()]);assert r['accepted_new']==2
    assert any(i['reason']=='possible_duplicate_retained' for i in r['issues'])
    before=snapshot(store,['C1']);r=ingest(store,[row(),row()]);assert r['recognized_repeat']==2
    assert len(snapshot(store,['C1'])['nodes'])==len(before['nodes'])


@pytest.mark.parametrize('bad',['NaN','-1','Infinity','abc'])
def test_bad_amount_quarantined(store,bad):
    r=ingest(store,[row(),row(paid=bad)])
    assert r['rows_seen']==r['accepted_new']+r['recognized_repeat']+r['quarantined']==2
    assert r['quarantined']==1


def test_header_collision_and_multiline_locator(store):
    data=csv_bytes([row()]).replace(b'From Bank',b'Wrong Bank')
    with pytest.raises(ValueError):store.import_records('bad',data,'ibm',True,'C1',ibm_records(data))
    assert not store.history('imports',['C1'])
    r=row();r[9]='ACH\nreference';records=list(ibm_records(csv_bytes([r,row()])))
    assert records[0]['locator']['line_end']==3
    assert records[1]['locator']['line_start']==4


def make_graph(times=(9,10,11),currencies=('US Dollar',)*3):
    rs=[]
    for a,b,h,c in zip('ABC','BCA',times,currencies):
        r=row(a,b,h,cur=c);r[3]='010';rs.append(r)
    facts=[]
    for r in ibm_records(csv_bytes(rs)):
        for f in r['facts']:facts.append({**f,'evidence_ids':['ev'],'case_ids':['C1'],'synthetic':True,'dataset_id':'test'})
    return {'nodes':list({f['id']:f for f in facts if f['kind']=='node'}.values()),'edges':[f for f in facts if f['kind']=='edge']}


def test_flow_time_currency_checks():
    assert len(fund_flow(make_graph())['paths'])==1
    assert not fund_flow(make_graph((9,9,11)))['paths']
    assert not fund_flow(make_graph((11,10,9)))['paths']
    assert not fund_flow(make_graph(currencies=('US Dollar','Euro','US Dollar')))['paths']


def test_flow_does_not_infer_same_day_order_from_date_only_transfers():
    graph = make_graph()
    transfers = [edge for edge in graph['edges'] if edge['type'] == 'TRANSACTED_WITH']
    day = datetime(2022, 9, 1, tzinfo=timezone.utc)
    for index, transfer in enumerate(transfers):
        transfer['attrs'].update(time_basis='date_only', event_time=(day + timedelta(days=index)).isoformat())
    assert len(fund_flow(graph)['paths']) == 1
    transfers[1]['attrs']['event_time'] = transfers[0]['attrs']['event_time']
    assert not fund_flow(graph)['paths']


def test_documents_do_not_change_projection():
    g=make_graph();before=projection(g)
    g['nodes'].append({'id':'doc','type':'Document'})
    g['edges'].append({'source':'doc','target':g['nodes'][0]['id'],'type':'MENTIONED_IN'})
    after=projection(g)
    assert set(before[0].edges)==set(after[0].edges)
    assert set(before[0].nodes)==set(after[0].nodes)


def test_nonfinancial_cross_case_and_authorization(store):
    for c in ['C1','C2']:
        records=[{'locator':{'row':1},'facts':[node('Person','p','Person P'),node('Case',c,c),edge('INVOLVED_IN_CASE','p',c)]}]
        store.import_records(c,c.encode(),'team',True,c,records)
    assert any(l['techniques']==['cross_case'] for l in analyze(snapshot(store,['C1','C2']))['leads'])
    assert not any(l['techniques']==['cross_case'] for l in analyze(snapshot(store,['C1']))['leads'])
    assert all('C2' not in n['case_ids'] for n in snapshot(store,['C1'])['nodes'])


def test_api_evidence_isolation_and_raw_blob_protection(store):
    from maha.api import create_app
    a=ingest(store,[row()],'C1');ingest(store,[row()],'C2')
    token=store.create_user('one',['C1']);client=TestClient(create_app(store));h={'Authorization':'Bearer '+token}
    assert client.get('/api/graph').status_code==401
    foreign=snapshot(store,['C2'])['nodes'][0]['evidence_ids'][0]
    assert client.get('/api/evidence/'+foreign,headers=h).status_code==404
    assert client.get('/api/source/'+a['source_id'],headers=h).status_code==404
    assert client.post('/api/import/ibm/C2',headers=h,content=csv_bytes([row()])).status_code==403
    assert client.get('/api/report',headers=h).status_code==200


def test_unresolvable_evidence_blocks_leads(store):
    from maha.api import create_app
    ingest(store,[row()]);token=store.create_user('one',['C1'])
    with store.db() as db:db.execute('DELETE FROM evidence')
    response=TestClient(create_app(store)).get('/api/analysis',headers={'Authorization':'Bearer '+token})
    assert response.status_code==200
    result=response.json()
    assert result['leads']==[] and result['blocked_untraceable']>0 and result['traceability_coverage']==0


def test_resolution_is_reviewed_reversible_and_preserves_assertions(store):
    from maha.api import create_app
    records=[{'locator':{'row':1},'facts':[node('Person','a','Arun Mehta'),node('Person','b','Arun Mehta')]}]
    store.import_records('names',b'names','team',True,'C1',records)
    assert len(snapshot(store,['C1'])['nodes'])==2
    token=store.create_user('reviewer',['C1']);client=TestClient(create_app(store));h={'Authorization':'Bearer '+token}
    c=client.get('/api/candidates',headers=h).json()[0]
    assert client.post('/api/candidates/'+c['id'],headers=h,json={'state':'accepted','reason':'Source checked'}).status_code==200
    assert len(snapshot(store,['C1'])['nodes'])==1
    assert client.post('/api/candidates/'+c['id'],headers=h,json={'state':'revoked','reason':'New contradictory evidence'}).status_code==200
    assert len(snapshot(store,['C1'])['nodes'])==2
    with store.db() as db:assert db.execute('SELECT COUNT(*) FROM decision_events').fetchone()[0]==2


def test_transitive_resolution_blocks_conflicting_ids(store):
    from maha.api import create_app
    records=[{'locator':{'row':1},'facts':[node('Person','a','Same Name',authoritative_id='A'),node('Person','m','Same Name'),node('Person','b','Same Name',authoritative_id='B')]}]
    store.import_records('names',b'bridge-test','team',True,'C1',records)
    token=store.create_user('reviewer',['C1']);client=TestClient(create_app(store));h={'Authorization':'Bearer '+token}
    cs=client.get('/api/candidates',headers=h).json();assert len(cs)==2
    body={'state':'accepted','reason':'Reviewing source identities'}
    assert client.post('/api/candidates/'+cs[0]['id'],headers=h,json=body).status_code==200
    assert client.post('/api/candidates/'+cs[1]['id'],headers=h,json=body).status_code==409


def test_narrative_case_spoof_is_rejected(store):
    from maha.api import create_app
    token=store.create_user('one',['C1']);client=TestClient(create_app(store))
    r=client.post('/api/import/narrative/C1',headers={'Authorization':'Bearer '+token},content=json.dumps([{'case_id':'C2'}]))
    assert r.status_code==422 and not store.history('imports',['C1'])


def test_structured_upload_parses_in_worker_thread(store, monkeypatch):
    import asyncio
    import maha.api as api

    def checked_records(content):
        with pytest.raises(RuntimeError, match='no running event loop'):
            asyncio.get_running_loop()
        yield from ibm_records(content)

    monkeypatch.setattr(api, 'ibm_records', checked_records)
    token = store.create_user('importer', ['C1'])
    with TestClient(api.create_app(store)) as client:
        response = client.post('/api/import/ibm/C1', content=csv_bytes([row()]),
                               headers={'Authorization': f'Bearer {token}'})
        assert client.get('/api/health').json()['status'] == 'ok'
    assert response.status_code == 200, response.text
    assert response.json()['rows_seen'] == 1
    assert any(item['type'] == 'Transaction' for item in snapshot(store, ['C1'])['nodes'])


def test_history_status_is_sourced_not_inferred(store):
    from maha.ingestion import HISTORY_HEADER,history_records
    out=io.StringIO();w=csv.writer(out);w.writerow(HISTORY_HEADER);w.writerow(['h1','P001','C1','2022-09-01','witness_reference','Synthetic statement','true'])
    rows=list(history_records(out.getvalue().encode(),'C1'))
    assert rows[0]['facts'][2]['attrs']['source_record_status']=='witness_reference'


def test_conflicting_unique_person_identifiers_never_candidate():
    assert not candidates([{'id':'a','type':'Person','label':'Same Name','attrs':{'authoritative_id':'1'},'evidence_ids':['e']},{'id':'b','type':'Person','label':'Same Name','attrs':{'authoritative_id':'2'},'evidence_ids':['e']}])


def test_retention_removes_sources_and_facts(store):
    ingest(store,[row()]);store.close_case('C1')
    assert store.purge(datetime.now(timezone.utc)+timedelta(days=31))==['C1']
    assert not snapshot(store,['C1'])['nodes']
    with store.db() as db:assert db.execute('SELECT COUNT(*) FROM sources').fetchone()[0]==0


def test_pdf_fixed_layout_extraction(tmp_path):
    from maha.demo import statement_pdf
    p=tmp_path/'statement.pdf';statement_pdf(p)
    records=list(pdf_records(p.read_bytes()))
    assert len(records)==2 and not any('error' in r for r in records)
    assert records[0]['locator']['page']==1 and len(records[0]['locator']['bbox'])==4
    assert records[0]['facts'][2]['attrs']['amount_paid']=='100.00'
    q=tmp_path/'same.pdf';statement_pdf(q)
    assert p.read_bytes()==q.read_bytes()


def test_elliptic_loader_unknown_and_bad_edge(tmp_path):
    from maha.benchmark import elliptic_load
    (tmp_path/'elliptic_txs_classes.csv').write_text('txId,class\na,unknown\nb,1\n')
    (tmp_path/'elliptic_txs_features.csv').write_text('\n'.join(','.join([n,'1']+['0']*165) for n in ['a','b'])+'\n')
    e=tmp_path/'elliptic_txs_edgelist.csv';e.write_text('txId1,txId2\na,b\n')
    x,steps,y,m=elliptic_load(tmp_path)
    assert x.shape==(2,93) and y.tolist()==[-1,1]
    e.write_text('txId1,txId2\na,missing\n')
    with pytest.raises(ValueError,match='Unresolved edge'):elliptic_load(tmp_path)


def test_compressed_elliptic_loader(tmp_path):
    import zipfile
    from maha.benchmark import elliptic_load
    folder=tmp_path/'elliptic';folder.mkdir()
    with zipfile.ZipFile(tmp_path/'elliptic.zip','w') as z:
        z.writestr('elliptic_txs_classes.csv','txId,class\na,unknown\n')
        z.writestr('elliptic_txs_features.csv',','.join(['a','1']+['0']*165)+'\n')
        z.writestr('elliptic_txs_edgelist.csv','txId1,txId2\na,a\n')
    x,_,y,_=elliptic_load(folder)
    assert x.shape==(1,93) and y.tolist()==[-1]
    writer=io.StringIO()
    _,_,_,manifest=elliptic_load(folder,index_writer=writer)
    assert not manifest['normalized_records']
    assert json.loads(writer.getvalue())['tx_id']=='a'


def test_import_budget_rolls_back_entire_source(store,monkeypatch):
    from maha.limits import ResourceLimitError
    monkeypatch.setenv('MAHA_MAX_IMPORT_RECORDS','1')
    with pytest.raises(ResourceLimitError):ingest(store,[row(),row()])
    with store.db() as db:
        for table in ['sources','evidence','facts','imports','record_fingerprints']:
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]==0


def test_budgets_return_explicit_api_error(store,monkeypatch):
    from maha.api import create_app
    ingest(store,[row()]);token=store.create_user('limited',['C1'])
    monkeypatch.setenv('MAHA_MAX_GRAPH_FACTS','1')
    response=TestClient(create_app(store)).get('/api/graph',headers={'Authorization':'Bearer '+token})
    assert response.status_code==413 and 'no partial result' in response.json()['detail']


def test_duplicate_index_migration_and_case_scope(store):
    ingest(store,[row()])
    with store.db() as db:db.execute('DROP TABLE record_fingerprints')
    migrated=Store(store.root)
    other=ingest(migrated,[row(),row()],'C2')
    assert len([i for i in other['issues'] if i['reason']=='possible_duplicate_retained'])==1
    with migrated.db() as db:assert db.execute('SELECT COUNT(*) FROM record_fingerprints').fetchone()[0]==3


def test_history_authorized_before_limit(store):
    for i in range(205):store.audit('test','read','C1',str(i))
    for i in range(205):store.audit('test','read','C2',str(i))
    history=store.history('audit',['C1'])
    assert len(history)==200 and history[0]['object_id']=='204'
    assert all(r['case_id']=='C1' for r in history)


def test_adjudication_and_precision_at_k(store):
    from maha.adjudication import compute_precision_at_k, adjudicate_all_leads
    records = [
        {"id": "1", "category": "connection", "state": "relevant"},
        {"id": "2", "category": "connection", "state": "relevant"},
        {"id": "3", "category": "connection", "state": "insufficient_evidence"},
        {"id": "4", "category": "flagged_behavior", "state": "not_relevant"},
        {"id": "5", "category": "flagged_behavior", "state": "relevant"}
    ]
    metrics = compute_precision_at_k(records)
    assert metrics["precision_at_5"] == 0.6
    assert metrics["counts"]["relevant"] == 3
    assert metrics["counts"]["insufficient_evidence"] == 1
    assert metrics["counts"]["not_relevant"] == 1


def test_evidence_correctness_audit(store):
    from maha.audit_evidence import audit_evidence_correctness
    ingest(store, [row()])
    res = audit_evidence_correctness(store)
    assert res["total_audited"] >= 1
    assert res["overall_correctness_rate"] == 1.0
    assert res["discrepancies"]["missing_locators"] == 0


def test_evidence_audit_checks_multiline_csv_and_marks_unknown_methods(store):
    from maha.audit_evidence import audit_evidence_correctness
    from maha.ingestion import HISTORY_HEADER, history_records

    source = io.StringIO()
    writer = csv.writer(source)
    writer.writerow(HISTORY_HEADER)
    writer.writerow(['h1', 'P001', 'C1', '2022-09-01', 'witness_reference', 'First\nsecond', 'true'])
    raw = source.getvalue().encode()
    store.import_records('history.csv', raw, 'team-authored', True, 'C1', history_records(raw, 'C1'))
    store.import_records('unmapped', b'unmapped', 'team-authored', True, 'C1', [
        {'locator': {'row': 1}, 'method': 'unmapped', 'passage': 'irrelevant', 'facts': []}
    ])
    result = audit_evidence_correctness(store)
    assert result['correct_records'] == 1
    assert result['unverified_records'] == 1
    assert result['by_modality']['unmapped']['fidelity'] is None


def test_doctor_diagnostics(store):
    from maha.doctor import diagnose_system
    r = diagnose_system(str(store.root))
    assert "overall_status" in r
    assert r["checks"]["ledger"]["status"] == "PASS"
    assert "disk_space" in r["checks"]


def test_dossier_requires_sources_and_never_invents_charges(store):
    from maha.api import create_app

    token = store.create_user('reviewer', ['C1'])
    headers = {'Authorization': 'Bearer ' + token}
    person = node('Person', 'p', 'Example Person')
    history = edge('INVOLVED_IN_CASE', 'p', 'C1', 'history',
                   source_text='Witness mentioned PMLA, 420, and an FIR.',
                   source_record_status='witness')
    store.import_records('history', b'example', 'fixture', True, 'C1', [
        {'locator': {'row': 1}, 'facts': [person, node('Case', 'C1', 'C1'), history]}
    ])
    client = TestClient(create_app(store))
    run = client.post('/api/cases/C1/train', headers=headers)
    assert run.status_code == 200
    assert 'convergence_loss' not in run.json()['training_metadata']
    response = client.get('/api/dossier/p?case=C1', headers=headers)
    assert response.status_code == 200
    dossier = response.json()
    assert dossier['person']['key_details']['crime_records'][0]['status'] == 'witness'
    assert dossier['source_evidence']
    assert 'risk_score' not in dossier['person']
    assert 'recommended_actions' not in dossier['person']
    assert client.get('/api/charge-sheet/p', headers=headers).status_code == 410
    assert client.get('/api/token').status_code == 404
    for path in ('graph', 'analysis', 'dossier/p', 'report'):
        assert client.get(f'/api/{path}?case=C2', headers=headers).status_code == 404


def test_case_creation_cannot_grant_existing_case(store):
    from maha.api import create_app

    store.create_user('owner', ['C2'])
    token = store.create_user('reviewer', ['C1'])
    headers = {'Authorization': 'Bearer ' + token}
    client = TestClient(create_app(store))
    assert client.post('/api/cases', json={'case_id': 'C2'}, headers=headers).status_code == 409
    assert client.get('/api/me', headers=headers).json()['cases'] == ['C1']
    assert client.post('/api/cases', json={'case_id': 'C3'}, headers=headers).status_code == 200
    assert client.post('/api/adjudicate/run', headers=headers).status_code == 410


def test_workspace_reopens_persisted_case_without_dropping_evidence(store):
    from maha.api import create_app

    token = store.create_user('investigator', ['C1'])
    other_token = store.create_user('other', ['C2'])
    headers = {'Authorization': 'Bearer ' + token}
    outside = {'Authorization': 'Bearer ' + other_token}
    imported = ingest(store, [row()], case='C1')
    with TestClient(create_app(store)) as client:
        assert client.put('/api/workspace/case', json={'case_id': 'C1'}, headers=headers).status_code == 200
        assert client.put('/api/workspace/case', json={'case_id': 'C1'}, headers=outside).status_code == 403
        assert client.post('/api/cases', json={'case_id': 'C3'}, headers=headers).status_code == 200
        assert client.post('/api/cases', json={'case_id': 'C2'}, headers=headers).status_code == 409
    with TestClient(create_app(Store(store.root))) as client:
        assert client.get('/api/me', headers=headers).json()['active_case'] == 'C3'
        cases = client.get('/api/cases', headers=headers).json()
        assert {case['case_id']: case['evidence_count'] for case in cases} == {'C1': 1, 'C3': 0}
        assert client.put('/api/workspace/case', json={'case_id': 'C1'}, headers=headers).status_code == 200
    with TestClient(create_app(Store(store.root))) as client:
        assert client.get('/api/me', headers=headers).json()['active_case'] == 'C1'
        assert client.get('/api/me', headers=outside).json()['active_case'] is None
        assert client.get('/api/source/' + imported['source_id'], headers=headers).status_code == 200


def test_judgment_review_preserves_original_and_case_scope(store):
    from maha.api import create_app

    reviewer = store.create_user('reviewer', ['C1'])
    outsider = store.create_user('outsider', ['C2'])
    headers = {'Authorization': 'Bearer ' + reviewer}
    outside = {'Authorization': 'Bearer ' + outsider}
    text = '🙂\r\nJustice A. Rao heard the matter.'
    start = text.index('A. Rao')
    result = store.import_records('judgment.txt', text.encode(), 'court-judgment', False, 'C1', [{
        'locator': {'char_start': start, 'char_end': start + 6, 'legal_label': 'LAWYER'},
        'method': 'en_legal_ner_sm', 'passage': 'A. Rao', 'facts': [],
    }])
    eid = result['legal_mentions'][0]['evidence_id']
    original = store.evidence(eid, ['C1'])
    revision = store.graph_revision()
    url = f'/api/evidence/{eid}/judgment-review'
    client = TestClient(create_app(store))
    assert client.get(url, headers=outside).status_code == 404
    initial = client.get(url, headers=headers).json()
    assert initial['context'] == text and initial['history'] == []
    payload = {'decision': 'corrected', 'reason': 'Honorific and context identify the judge',
               'previous_id': None, 'start': text.index('Justice'), 'end': start + 6,
               'label': 'JUDGE'}
    assert client.post(url, json=payload, headers=outside).status_code == 404
    assert client.post(url, json={**payload, 'end': len(text) + 1}, headers=headers).status_code == 422
    saved = client.post(url, json=payload, headers=headers)
    assert saved.status_code == 200
    event = saved.json()
    assert event['mention']['passage'] == 'Justice A. Rao'
    assert event['actor'] == 'reviewer'
    assert client.post(url, json=payload, headers=headers).status_code == 409
    rejected = client.post(url, json={'decision': 'rejected', 'reason': 'Review superseded',
                                    'previous_id': event['id']}, headers=headers)
    assert rejected.status_code == 200
    assert client.get(url, headers=headers).json()['history'] == [rejected.json(), event]
    assert store.evidence(eid, ['C1']) == original
    assert store.graph_revision() == revision
    assert len([row for row in store.history('audit', ['C1'])
                if row['action'] == 'judgment_mention_review']) == 2
    store.reset_case('C1')
    with store.db() as db:
        assert db.execute('SELECT count(*) FROM judgment_reviews').fetchone()[0] == 0


def test_pasted_text_routes_to_document_extractor(store, monkeypatch):
    from types import SimpleNamespace
    from maha import api, nlp

    token = store.create_user('reviewer', ['C1'])
    headers = {'Authorization': 'Bearer ' + token}
    text = '  Justice Rao heard the matter.'
    entity = SimpleNamespace(start_char=2, end_char=13, label_='PERSON', text='Justice Rao')

    class GenericModel:
        meta = {'version': 'test'}

        def __call__(self, value):
            assert value == text
            return SimpleNamespace(ents=[entity])

    def legal_records(content):
        assert content.decode() == text
        yield {'locator': {'char_start': 2, 'char_end': 13, 'legal_label': 'JUDGE'},
               'passage': 'Justice Rao', 'method': 'en_legal_ner_sm', 'facts': []}

    monkeypatch.setattr(nlp, 'pipeline', GenericModel)
    monkeypatch.setattr(api, 'judgment_records', legal_records)
    client = TestClient(api.create_app(store))
    url = '/api/import/raw-text/C1'
    payload = {'text': text, 'title': 'Review sample', 'source_type': 'police_fir', 'synthetic': True}
    generic = client.post(url, json=payload, headers=headers)
    assert generic.status_code == 200
    mention = generic.json()['summary']['text_mentions'][1]
    evidence = client.get('/api/evidence/' + mention['evidence_id'], headers=headers).json()
    assert evidence['synthetic'] and evidence['passage'] == 'Justice Rao'
    assert evidence['source_locator']['char_start'] == 2
    legal = client.post(url, json={**payload, 'source_type': 'court_judgment'}, headers=headers)
    assert legal.status_code == 200
    eid = legal.json()['summary']['legal_mentions'][0]['evidence_id']
    assert client.get(f'/api/evidence/{eid}/judgment-review', headers=headers).status_code == 200
    repeated = client.post(url, json=payload, headers=headers)
    assert repeated.json()['summary']['recognized_repeat'] == 2
    assert client.post(url, json={**payload, 'source_type': 'unknown'}, headers=headers).status_code == 422
    assert client.post('/api/import/raw-text/C2', json=payload, headers=headers).status_code == 403
    assert not store.facts(['C1'])


def test_document_intake_routes_pdf_text_and_image_to_review(store, monkeypatch):
    from io import BytesIO
    from PIL import Image
    from reportlab.pdfgen.canvas import Canvas
    from maha import document_intake
    from maha.api import create_app

    text = 'Justice Rao heard the petition.'
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.drawString(40, 750, text)
    canvas.save()
    image = BytesIO()
    Image.new('RGB', (30, 30), 'white').save(image, format='PNG')

    def legal_records(content):
        assert content.decode().strip() == text
        yield {'locator': {'char_start': 0, 'char_end': 11, 'legal_label': 'JUDGE'},
               'method': 'en_legal_ner_sm', 'passage': 'Justice Rao', 'facts': []}

    monkeypatch.setattr(document_intake, 'judgment_records', legal_records)
    monkeypatch.setattr(document_intake, '_ocr', lambda *_: text)
    token = store.create_user('reviewer', ['C1'])
    headers = {'Authorization': 'Bearer ' + token}
    client = TestClient(create_app(store))
    url = '/api/import/judgment-document/C1'
    evidence_ids = []
    for raw, method in ((pdf.getvalue(), 'pdf-text'), (image.getvalue(), 'tesseract-eng')):
        response = client.post(url, headers=headers, content=raw)
        assert response.status_code == 200
        eid = response.json()['legal_mentions'][0]['evidence_id']
        evidence_ids.append(eid)
        ev = client.get('/api/evidence/' + eid, headers=headers).json()
        assert ev['source_locator']['page'] == 1
        assert ev['source_locator']['text_method'] == method
        assert 'review_excerpt' not in ev
        assert client.get('/api/source/' + ev['source_id'], headers=headers).content == raw
        preview = client.get('/api/evidence/' + eid + '/source-page', headers=headers)
        assert preview.status_code == 200 and preview.content.startswith(b'\x89PNG')
        assert client.get('/api/evidence/' + eid + '/source-page').status_code == 401
        review = client.get('/api/evidence/' + eid + '/judgment-review', headers=headers)
        assert review.json()['context'].strip() == text
        assert client.post(url, headers=headers, content=raw).json()['recognized_repeat'] == 1
    assert client.post(url, headers=headers, content=b'not a document').status_code == 422
    assert not store.facts(['C1'])
    store.import_records('private', b'private', 'team-authored', True, 'C2', [
        {'locator': {'row': 1}, 'method': 'unmapped', 'passage': 'private', 'facts': []}
    ])
    audit_url = '/api/evidence/audit'
    assert client.get(audit_url, headers=headers, params={'case': 'C2'}).status_code == 404
    audit = client.get(audit_url, headers=headers)
    assert audit.status_code == 200
    assert audit.json()['total_audited'] == audit.json()['correct_records'] == 2

    with store.db() as db:
        db.execute("UPDATE evidence SET data=json_set(data, '$.passage', 'different') WHERE id=?",
                   (evidence_ids[0],))
    audit = client.get(audit_url, headers=headers, params={'case': 'C1'}).json()
    assert audit['correct_records'] == 1
    assert audit['discrepancies']['passage_mismatches'] == 1
