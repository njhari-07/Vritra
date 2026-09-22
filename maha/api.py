import csv
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .store import Store, now, uid
from .limits import ResourceLimitError
from .graph import snapshot, NeoGraph
from .analytics import analyze, fund_flow
from .nlp import candidates
from .ingestion import ibm_records, narrative_records, cdr_records, pdf_records, history_records


class Decision(BaseModel):
    state: Literal['accepted','rejected','revoked']
    reason: str=Field(min_length=3,max_length=2000)


class Review(BaseModel):
    state: Literal['relevant','not_relevant','insufficient_evidence']
    reason: str=Field(min_length=3,max_length=2000)


def create_app(store=None):
    app=FastAPI(title='MAHA · Evidence workspace',version='0.1.0')
    ledger=store or Store();bearer=HTTPBearer(auto_error=False)
    @app.exception_handler(ResourceLimitError)
    async def resource_limit(request,exc):
        return JSONResponse(status_code=413,content={'detail':str(exc)})
    def user(credentials:HTTPAuthorizationCredentials=Depends(bearer)):
        if not credentials:raise HTTPException(401,'Access token required')
        try:return ledger.authenticate(credentials.credentials)
        except PermissionError:raise HTTPException(401,'Invalid access token')
    def graph(u):return snapshot(ledger,u['cases'])
    def results(u):
        g=graph(u);cross_case_records=None
        if os.getenv('NEO4J_URI'):
            neo=NeoGraph()
            try:cross_case_records=neo.cross_cases(u['cases'],g['resolution_map'])
            finally:neo.close()
        result=analyze(g,cross_case_records)
        # Validate references against the ledger rather than assuming coverage from nonempty IDs.
        valid=[]
        for lead in result['leads']:
            try:
                for eid in lead['evidence_ids']:ledger.evidence(eid,u['cases'])
                valid.append(lead)
            except KeyError:pass
        total=len(result['leads'])
        result['traceability_coverage']=len(valid)/total if total else None
        result['blocked_untraceable']=total-len(valid);result['leads']=valid
        with ledger.db() as db:
            reviews={r['id']:json.loads(r['data']) for r in db.execute('SELECT * FROM reviews') if set(json.loads(r['case_scope'])).issubset(u['cases'])}
        for lead in valid:
            if lead['id'] in reviews:lead['review']=reviews[lead['id']];lead['review_state']=reviews[lead['id']]['state']
        return result
    @app.middleware('http')
    async def headers(request,call_next):
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Cache-Control']='no-store'
        response.headers['Referrer-Policy']='no-referrer'
        return response
    @app.get('/api/health')
    def health():return {'status':'ok','version':'0.1.0'}
    @app.get('/api/me')
    def me(u=Depends(user)):return u
    @app.get('/api/graph')
    def get_graph(u=Depends(user)):
        ledger.audit(u['name'],'graph_read',u['cases'][0] if u['cases'] else '')
        return graph(u)
    @app.get('/api/analysis')
    def get_analysis(u=Depends(user)):return results(u)
    @app.get('/api/evidence/{eid}')
    def evidence(eid:str,u=Depends(user)):
        try:ev=ledger.evidence(eid,u['cases'])
        except KeyError:raise HTTPException(404,'Evidence unavailable')
        ledger.audit(u['name'],'evidence_read',ev['case_ids'][0],eid)
        return ev
    @app.get('/api/source/{source_id}')
    def source(source_id:str,u=Depends(user)):
        try:name,content=ledger.source(source_id,u['cases'])
        except KeyError:raise HTTPException(404,'Source unavailable')
        ledger.audit(u['name'],'source_read',u['cases'][0],source_id)
        return Response(content,media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="source-{source_id[:12]}"'})
    @app.get('/api/candidates')
    def get_candidates(u=Depends(user)):
        raw=snapshot(ledger,u['cases'],resolve=False)
        ds={d['id']:d for d in ledger.decisions(u['cases'])}
        return [{**c,**({'state':ds[c['id']]['state'],'decision':ds[c['id']]} if c['id'] in ds else {})} for c in candidates(raw['nodes'])]
    @app.post('/api/candidates/{cid}')
    def decide(cid:str,body:Decision,u=Depends(user)):
        options={c['id']:c for c in get_candidates(u)}
        if cid not in options:raise HTTPException(404,'Candidate unavailable')
        c=options[cid]
        if body.state=='accepted':
            # Check entire existing components, so a name-only mention cannot bridge two IDs.
            import networkx as nx
            raw=snapshot(ledger,u['cases'],resolve=False);components=nx.Graph()
            components.add_nodes_from(n['id'] for n in raw['nodes'])
            for decision in ledger.decisions(u['cases']):
                if decision['state']=='accepted':components.add_edge(decision['left'],decision['right'])
            merged=nx.node_connected_component(components,c['left'])|nx.node_connected_component(components,c['right'])
            identifiers={a['attrs']['authoritative_id'] for n in raw['nodes'] if n['id'] in merged for a in n['assertions'] if a['attrs'].get('authoritative_id')}
            if len(identifiers)>1:raise HTTPException(409,'Conflicting authoritative identifiers; match blocked')
        if body.state=='revoked' and c['state']!='accepted':raise HTTPException(409,'Only an accepted match can be revoked')
        data={**c,'state':body.state,'reason':body.reason,'actor':u['name'],'at':now()}
        data.pop('decision',None)
        # Evidence scopes, not all current user grants, determine visibility of this decision.
        scopes=sorted({case for eid in c['evidence_ids'] for case in ledger.evidence(eid,u['cases'])['case_ids']})
        ledger.save_decision(data,scopes);return data
    @app.post('/api/leads/{lid}/review')
    def review(lid:str,body:Review,u=Depends(user)):
        leads={l['id']:l for l in results(u)['leads']}
        if lid not in leads:raise HTTPException(404,'Lead unavailable')
        data={**body.model_dump(),'actor':u['name'],'at':now()}
        with ledger.db() as db:db.execute('INSERT OR REPLACE INTO reviews VALUES(?,?,?)',(lid,json.dumps(leads[lid]['case_ids']),json.dumps(data)))
        ledger.audit(u['name'],'lead_review',leads[lid]['case_ids'][0],lid);return data
    @app.get('/api/quality')
    def quality(u=Depends(user)):
        return [{**r,'summary':json.loads(r['summary'])} for r in ledger.history('imports',u['cases'])]
    @app.get('/api/audit')
    def audit(u=Depends(user)):return ledger.history('audit',u['cases'])
    @app.get('/api/benchmarks')
    def benchmarks(u=Depends(user)):
        reports=[]
        for name in ['elliptic-evaluation.json','ibm-evaluation.json']:
            path=Path('artifacts/evaluation')/name
            if path.exists():
                data=json.loads(path.read_text());data.pop('source_line_numbers',None);reports.append(data)
        return reports
    @app.get('/api/timeline')
    def timeline(u=Depends(user)):
        g=graph(u);names={n['id']:n['label'] for n in g['nodes']}
        events=[{'id':n['id'],'label':n['label'],'event_time':n['attrs']['event_time'],'evidence_ids':n['evidence_ids']} for n in g['nodes'] if n['attrs'].get('event_time')]
        events += [{'id':e['id'],'label':f"Call: {names[e['source']]} → {names[e['target']]}",'event_time':e['attrs']['event_time'],'evidence_ids':e['evidence_ids']} for e in g['edges'] if e['type']=='COMMUNICATED_WITH' and e['attrs'].get('event_time')]
        return sorted(events,key=lambda n:n['event_time'])
    @app.get('/api/flow')
    def flow(start:str,end:str|None=None,u=Depends(user)):
        g=graph(u);ids={n['id'] for n in g['nodes']}
        if start not in ids or (end and end not in ids):raise HTTPException(404,'Entity unavailable')
        return fund_flow(g,start,end)
    @app.post('/api/import/{kind}/{case_id}')
    async def upload(kind:Literal['ibm','narrative','cdr','pdf','history'],case_id:str,request:Request,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        # Raw request streaming bounds memory before parsing. Filename/path supplied by client is ignored.
        chunks=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>25*1024*1024:raise HTTPException(413,'25 MiB upload limit exceeded')
            chunks.append(chunk)
        content=b''.join(chunks)
        del chunks
        adapter={'ibm':ibm_records,'narrative':narrative_records,'cdr':cdr_records,'pdf':pdf_records,'history':lambda data:history_records(data,case_id)}[kind]
        try:
            if kind=='narrative':
                docs=json.loads(content)
                if not isinstance(docs,list) or any(not isinstance(d,dict) for d in docs):raise ValueError('Narratives must be a JSON array of objects')
                if any(d.get('case_id')!=case_id for d in docs):raise ValueError('Document case does not match selected case')
            result=ledger.import_records(f'upload-{kind}',content,'ibm-hi-small' if kind=='ibm' else 'team-authored',True,case_id,adapter(content),u['name'])
        except (ValueError,UnicodeError,csv.Error,TypeError,KeyError) as e:
            ledger.audit(u['name'],'import_failed',case_id,uid(kind,hashlib.sha256(content).hexdigest()))
            raise HTTPException(422,str(e))
        if os.getenv('NEO4J_URI'):
            neo=NeoGraph()
            try:neo.sync(ledger)
            finally:neo.close()
        return result
    @app.get('/api/report')
    def report(u=Depends(user)):
        result=results(u);eids=sorted({e for l in result['leads'] for e in l['evidence_ids']})
        data={'title':'Investigator review report','generated_at':now(),'case_ids':u['cases'],'notice':'Decision support only. Synthetic demo results do not establish guilt. Structural context is separate from flagged behavior.','analysis':result,'evidence':[ledger.evidence(e,u['cases']) for e in eids]}
        ledger.audit(u['name'],'report_export',u['cases'][0] if u['cases'] else '')
        return Response(json.dumps(data,indent=2),media_type='application/json',headers={'Content-Disposition':'attachment; filename="investigator-review.json"'})
    dist=Path(__file__).resolve().parents[1]/'frontend/dist'
    if dist.exists():
        app.mount('/assets',StaticFiles(directory=dist/'assets'),name='assets')
        @app.get('/')
        def index():return FileResponse(dist/'index.html')
    return app


app=create_app()
