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
