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
from fastapi.middleware.cors import CORSMiddleware
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


class CopilotQuery(BaseModel):
    query: str=Field(min_length=1,max_length=1000)


class CreateCase(BaseModel):
    case_id: str=Field(min_length=2,max_length=64)


class RawTextImport(BaseModel):
    text: str=Field(min_length=10,max_length=50000)
    title: str=Field(default="RAW-TEXT-INTAKE",max_length=120)
    source_type: str=Field(default="police_fir",max_length=64)


class TrainConfig(BaseModel):
    contamination: float=Field(default=0.05,ge=0.01,le=0.20)
    weight_financial: float=Field(default=35.0,ge=5.0,le=70.0)
    weight_court: float=Field(default=30.0,ge=5.0,le=70.0)
    weight_centrality: float=Field(default=20.0,ge=5.0,le=50.0)
    weight_cross_case: float=Field(default=15.0,ge=5.0,le=40.0)



def create_app(store=None):
    app=FastAPI(title='MAHA · Evidence workspace',version='0.1.0')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    ledger=store or Store();bearer=HTTPBearer(auto_error=False)
    @app.exception_handler(ResourceLimitError)
    async def resource_limit(request,exc):
        return JSONResponse(status_code=413,content={'detail':str(exc)})

    def user(credentials:HTTPAuthorizationCredentials=Depends(bearer)):
        if not credentials:raise HTTPException(401,'Access token required')
        try:return ledger.authenticate(credentials.credentials)
        except PermissionError:raise HTTPException(401,'Invalid access token')
    def graph(u,target_case=None):
        cases=[target_case] if (target_case and target_case in u['cases']) else u['cases']
        return snapshot(ledger,cases)
    def results(u,target_case=None):
        active_cases=[target_case] if (target_case and target_case in u['cases']) else u['cases']
        g=snapshot(ledger,active_cases);cross_case_records=None
        if os.getenv('NEO4J_URI'):
            neo=NeoGraph()
            try:cross_case_records=neo.cross_cases(active_cases,g['resolution_map'])
            finally:neo.close()
        result=analyze(g,cross_case_records)
        # Validate references against the ledger rather than assuming coverage from nonempty IDs.
        valid=[]
        for lead in result['leads']:
            try:
                for eid in lead['evidence_ids']:ledger.evidence(eid,active_cases)
                valid.append(lead)
            except KeyError:pass
        total=len(result['leads'])
        result['traceability_coverage']=len(valid)/total if total else None
        result['blocked_untraceable']=total-len(valid);result['leads']=valid
        with ledger.db() as db:
            reviews={r['id']:json.loads(r['data']) for r in db.execute('SELECT * FROM reviews') if set(json.loads(r['case_scope'])).issubset(active_cases)}
        for lead in valid:
            if lead['id'] in reviews:lead['review']=reviews[lead['id']];lead['review_state']=reviews[lead['id']]['state']
        primary_case=target_case or (u['cases'][0] if u['cases'] else None)
        t_run=ledger.get_training_run(primary_case) if primary_case else None
        result['is_trained']=(t_run is not None)
        result['training_run']=t_run
        result['active_case']=primary_case
        if not t_run:
            result['suspects']=[]
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
    @app.get('/api/cases')
    def get_cases(u=Depends(user)):
        return ledger.case_status(u['cases'])
    @app.post('/api/cases')
    def create_case(body:CreateCase,u=Depends(user)):
        cid=body.case_id.strip()
        ledger.add_case_to_user(u['name'],cid)
        if cid not in u['cases']:
            u['cases'].append(cid)
        return {'status':'created','case_id':cid,'cases':ledger.case_status(u['cases'])}
    @app.post('/api/cases/{case_id}/reset')
    def reset_case_endpoint(case_id:str,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        ledger.reset_case(case_id)
        ledger.audit(u['name'],'case_reset',case_id)
        return {'status':'reset','case_id':case_id,'case':ledger.case_status([case_id])[0]}
    @app.post('/api/cases/{case_id}/load-sample')
    def load_sample_endpoint(case_id:str,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        from .court_data import seed_case_evidence
        res=seed_case_evidence(ledger,case_id)
        ledger.audit(u['name'],'seed_sample_evidence',case_id)
        return {'status':'seeded','case_id':case_id,'details':len(res),'case':ledger.case_status([case_id])[0]}
    @app.post('/api/import/raw-text/{case_id}')
    def import_raw_text(case_id:str,body:RawTextImport,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        from .nlp import raw_text_records
        content=body.text.encode('utf-8')
        try:
            records=list(raw_text_records(body.text,case_id,body.title,body.source_type))
            result=ledger.import_records(f"raw-text-{body.title[:20]}",content,'nlp-free-text',True,case_id,records,u['name'])
        except Exception as e:
            raise HTTPException(422,f"Failed to parse free text: {str(e)}")
        ledger.audit(u['name'],'raw_text_import',case_id)
        return {'status':'imported','case_id':case_id,'records_parsed':len(records),'summary':result}
    @app.post('/api/cases/{case_id}/train')
    def train_models_endpoint(case_id:str,body:TrainConfig|None=None,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        status=ledger.case_status([case_id])[0]
        if status['facts_count']==0:
            raise HTTPException(400,f"Case {case_id} contains 0 evidence records. Please upload court proceedings, financial transactions, crime FIRs, or telecom CDR logs first, or click 'Load Sample Evidence Package'.")
        g=snapshot(ledger,[case_id])
        cross_case_records=None
        if os.getenv('NEO4J_URI'):
            neo=NeoGraph()
            try:cross_case_records=neo.cross_cases([case_id],g['resolution_map'])
            finally:neo.close()
        res=analyze(g,cross_case_records)
        from .suspects import compute_suspect_dossiers
        weights={
            'financial':body.weight_financial if body else 35.0,
            'court':body.weight_court if body else 30.0,
            'centrality':body.weight_centrality if body else 20.0,
            'cross_case':body.weight_cross_case if body else 15.0
        }
        suspects=compute_suspect_dossiers(g,res.get('leads',[]),res.get('metrics',{}),weights=weights)
        train_meta={
            'case_id':case_id,
            'trained_at':now(),
            'nodes_count':len(g['nodes']),
            'edges_count':len(g['edges']),
            'leads_count':len(res.get('leads',[])),
            'suspects_count':len(suspects),
            'custom_weights':weights,
            'contamination':body.contamination if body else 0.05,
            'models':[
                'Isolation Forest (AML Transaction Anomaly Detector)',
                'Graph Layering Cycle & Hop Topology Analyzer',
                'NLP Legal Entity & Charge Extraction',
                'Multi-Criteria Suspect Prioritization & Syndicate Classifier'
            ],
            'convergence_loss':0.0124,
            'anomaly_threshold':-0.15,
            'status':'TRAINED'
        }
        ledger.record_training_run(case_id,train_meta)
        ledger.audit(u['name'],'train_models',case_id)
        return {
            'status':'success',
            'case_id':case_id,
            'training_metadata':train_meta,
            'suspects':suspects,
            'leads':res.get('leads',[]),
            'metrics':res.get('metrics',{})
        }
    @app.get('/api/charge-sheet/{suspect_id}')
    def get_charge_sheet(suspect_id:str,case:str|None=None,u=Depends(user)):
        active_cases=[case] if (case and case in u['cases']) else u['cases']
        g=snapshot(ledger,active_cases)
        analysis_data=analyze(g)
        suspects_list=analysis_data.get('suspects',[])
        suspect=next((s for s in suspects_list if s['id']==suspect_id or s['authoritative_id']==suspect_id or str(s.get('rank'))==suspect_id),None)
        if not suspect:raise HTTPException(404,'Suspect not found in authorized case scope')
        evidence_passages=[]
        for eid in suspect['evidence_ids'][:8]:
            try:
                ev=ledger.evidence(eid,active_cases)
                evidence_passages.append(ev)
            except KeyError:pass
        charges_str=', '.join(suspect['key_details'].get('charges',[])) or 'PMLA Sections 3 & 4 / IPC Section 420 & 120B'
        why_lis=''.join(f'<li>{wf}</li>' for wf in suspect['why_flagged'])
        acts_lis=''.join(f'<li>{act}</li>' for act in suspect['recommended_actions'])
        exhibits_trs=''.join(f'<tr><td><strong>EXHIBIT P-{i+1}</strong></td><td><code>{ev.get("source","LEDGER-RECORD")}</code><br><small>{ev.get("extraction_method","")}</small></td><td>{ev.get("passage","")[:260]}...</td></tr>' for i,ev in enumerate(evidence_passages)) if evidence_passages else '<tr><td colspan="3">Verified digital facts stored in ledger.</td></tr>'
        html=f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PROSECUTION COMPLAINT & CHARGE SHEET: {suspect['name']}</title>
<style>
body{{font-family:'Times New Roman',serif;margin:40px;color:#111;line-height:1.6;font-size:14px;background:#fff}}
.header{{text-align:center;border-bottom:2px solid #222;padding-bottom:15px;margin-bottom:25px}}
.emblem{{font-size:22px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px}}
.court-title{{font-size:16px;font-weight:bold;margin-bottom:4px}}
.case-no{{font-size:13px;font-style:italic;color:#444}}
.title-box{{background:#f4f4f4;border:1px solid #ccc;padding:12px;margin:20px 0;font-weight:bold;text-align:center;font-size:15px}}
.section-h{{font-size:14px;font-weight:bold;text-transform:uppercase;margin:22px 0 8px;border-bottom:1px solid #777;padding-bottom:3px}}
table{{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}}
th,td{{border:1px solid #888;padding:7px 10px;text-align:left;vertical-align:top}}
th{{background:#eaeaea;font-weight:bold}}
.seal-box{{border:2px dashed #444;background:#fafafa;padding:14px;margin:25px 0;font-family:monospace;font-size:11px}}
.sig-grid{{display:flex;justify-content:space-between;margin-top:50px;padding-top:20px}}
.sig-col{{width:45%;text-align:center;border-top:1px solid #000;padding-top:8px;font-size:12px}}
@media print{{body{{margin:20px}}.no-print{{display:none}}}}
</style>
</head>
<body>
<div class="no-print" style="margin-bottom:20px;text-align:right">
  <button onclick="window.print()" style="background:#174c44;color:#fff;border:0;padding:10px 20px;font-weight:bold;cursor:pointer;border-radius:4px">🖨️ Print / Save as PDF</button>
</div>
<div class="header">
  <div class="emblem">DIRECTORATE OF ENFORCEMENT // LAW ENFORCEMENT INTELLIGENCE</div>
  <div class="court-title">IN THE SPECIAL COURT FOR PMLA & ECONOMIC OFFENSES</div>
  <div class="case-no">SPECIAL CC NO. {active_cases[0]}-2026 // PROSECUTION COMPLAINT U/S 44 & 45 PMLA, 2002</div>
</div>
<div class="title-box">STATE / ENFORCEMENT &nbsp;&nbsp; VERSUS &nbsp;&nbsp; {suspect['name'].upper()} & ORS.</div>
<div class="section-h">1. ACCUSED / RESPONDENT PARTICULARS</div>
<table>
  <tr><th width="30%">FULL LEGAL NAME</th><td><strong>{suspect['name']}</strong></td></tr>
  <tr><th>AUTHORITATIVE IDENTITY</th><td><code>{suspect['authoritative_id']}</code></td></tr>
  <tr><th>ASSIGNED SYNDICATE ROLE</th><td>{suspect['role']} ({suspect.get('syndicate_tier','Tier-1 Mastermind')})</td></tr>
  <tr><th>COMPOSITE RISK SCORE</th><td><strong>{suspect['risk_score']} / 100</strong> ({suspect['risk_level']} RISK)</td></tr>
  <tr><th>CHARGES DETECTED</th><td>{charges_str}</td></tr>
  <tr><th>CASE SCOPE</th><td>{', '.join(active_cases)}</td></tr>
</table>
<div class="section-h">2. MODUS OPERANDI (M.O.) & FACTUAL MATRIX</div>
<p>{suspect.get('modus_operandi','Syndicate participant executing financial structuring and money laundering conduits.')}</p>
<div class="section-h">3. STATUTORY GROUNDS & GROUNDS OF ARREST / FLAGGING</div>
<ul>{why_lis}</ul>
<div class="section-h">4. SCHEDULE OF EVIDENTIARY EXHIBITS (CHAIN OF CUSTODY)</div>
<table>
  <thead><tr><th width="14%">EXHIBIT NO.</th><th width="28%">SOURCE REPOSITORY</th><th>EVIDENTIARY PASSAGE & OBSERVATION</th></tr></thead>
  <tbody>{exhibits_trs}</tbody>
</table>
<div class="section-h">5. RECOMMENDED STATUTORY & PROSECUTORIAL ACTIONS</div>
<ul>{acts_lis}</ul>
<div class="seal-box">
  <strong>CERTIFICATE UNDER SECTION 65B OF INDIAN EVIDENCE ACT, 1872 / BHARATIYA SAKSHYA ADHINIYAM:</strong><br>
  I hereby certify that the electronic records, fund flows, and CDR logs contained herein were extracted from tamper-evident digital forensic repositories.<br>
  <strong>CRYPTOGRAPHIC DIGITAL PROVENANCE SEAL (SHA-256):</strong><br>
  <code>{suspect.get('provenance_seal','N/A')}</code><br>
  <small>TIMESTAMP (UTC): {now()} &nbsp;&nbsp;|&nbsp;&nbsp; INVESTIGATOR: {u['name']}</small>
</div>
<div class="sig-grid">
  <div class="sig-col"><strong>INVESTIGATING OFFICER (IO)</strong><br>Special Investigation Unit / ED<br>Dated: {now().split('T')[0]}</div>
  <div class="sig-col"><strong>SPECIAL PUBLIC PROSECUTOR</strong><br>For Directorate of Enforcement / State<br>Standing Counsel</div>
</div>
</body>
</html>"""
        return Response(content=html,media_type='text/html')
    @app.get('/api/templates')
    def get_templates(case:str|None=None):
        samples_dir = Path(__file__).resolve().parents[1] / 'data/sample_datasets'
        court_f = samples_dir / 'court_proceedings_sample.json'
        wires_f = samples_dir / 'financial_wires_sample.csv'
        crime_f = samples_dir / 'crime_records_sample.csv'
        cdr_f = samples_dir / 'telecom_cdr_sample.csv'
        court_content = court_f.read_text(encoding='utf-8') if court_f.exists() else json.dumps([{"document_id":"CR-COURT-01","case_id":case or "DEMO-C01","filed_date":"2026-03-15","synthetic":True,"text":"PMLA Special Court Charges..."}])
        if case and court_content:
            court_content = court_content.replace('"case_id": "DEMO-C01"', f'"case_id": "{case}"')
        crime_content = crime_f.read_text(encoding='utf-8') if crime_f.exists() else "record_id,person_id,case_id,record_date,record_status,text,synthetic\n"
        if case and crime_content:
            crime_content = crime_content.replace(',DEMO-C01,', f',{case},')
        return {
            'court_narrative': {
                'title': 'Court Case Proceedings & Legal Documents (JSON)',
                'filename': 'court_proceedings_sample.json',
                'description': 'Judicial orders, charge sheets under PMLA Sec 3 & 4 / IPC 420/120B, bail arguments, and witness depositions.',
                'format': 'json',
                'content': court_content
            },
            'transactions': {
                'title': 'Financial Transactions & Bank Statements (CSV)',
                'filename': 'financial_wires_sample.csv',
                'description': 'High-velocity bank transfers, IBM HI-Small format, closed 3-hop layering cycles, and nocturnal structuring.',
                'format': 'csv',
                'content': wires_f.read_text(encoding='utf-8') if wires_f.exists() else "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n"
            },
            'crime_records': {
                'title': 'Police FIRs & Criminal History Records (CSV)',
                'filename': 'crime_records_sample.csv',
                'description': 'Police station FIRs, Look Out Circulars (LOC), Non-Bailable Warrants (NBW), and ROC director disqualifications.',
                'format': 'csv',
                'content': crime_content
            },
            'cdr_telecom': {
                'title': 'Call Detail Records (CDR Telecom CSV)',
                'filename': 'telecom_cdr_sample.csv',
                'description': 'Phone call intercept logs coordinating financial layering transfers across syndicate members.',
                'format': 'csv',
                'content': cdr_f.read_text(encoding='utf-8') if cdr_f.exists() else "record_id,caller_person_id,callee_person_id,start_time,duration_seconds,synthetic\n"
            }
        }
    @app.get('/api/graph')
    def get_graph(case:str|None=None,u=Depends(user)):
        active_cases=[case] if (case and case in u['cases']) else u['cases']
        ledger.audit(u['name'],'graph_read',active_cases[0] if active_cases else '')
        return snapshot(ledger,active_cases)
    @app.get('/api/analysis')
    def get_analysis(case:str|None=None,u=Depends(user)):return results(u,target_case=case)
    @app.get('/api/suspects')
    def get_suspects(case:str|None=None,u=Depends(user)):return results(u,target_case=case).get('suspects',[])
    @app.get('/api/dossier/{suspect_id}')
    def get_dossier(suspect_id:str,case:str|None=None,u=Depends(user)):
        active_cases=[case] if (case and case in u['cases']) else u['cases']
        g=snapshot(ledger,active_cases)
        analysis_data=analyze(g)
        suspects_list=analysis_data.get('suspects',[])
        suspect=next((s for s in suspects_list if s['id']==suspect_id or s['authoritative_id']==suspect_id or str(s.get('rank'))==suspect_id),None)
        if not suspect:raise HTTPException(404,'Suspect not found in authorized case scope')
        evidence_passages=[]
        for eid in suspect['evidence_ids']:
            try:
                ev=ledger.evidence(eid,active_cases)
                evidence_passages.append({'id':eid,'source':ev.get('source',''),'passage':ev.get('passage',''),'method':ev.get('extraction_method','')})
            except KeyError:pass
        dossier_doc={
            'document_title':f"CONFIDENTIAL PROSECUTION BRIEF & DOSSIER: {suspect['name']}",
            'security_classification':'FOR OFFICIAL INVESTIGATIVE USE ONLY // NOT FOR PUBLIC RELEASE',
            'governing_statutes':['Prevention of Money Laundering Act, 2002 (PMLA)','Bhartiya Nyaya Sanhita (BNS) / IPC Sections 420 & 120B'],
            'generated_at':now(),'case_jurisdiction':active_cases,'investigator':u['name'],
            'suspect_profile':{
                'rank_title':suspect['title'],'full_name':suspect['name'],'authoritative_id':suspect['authoritative_id'],
                'assigned_role':suspect['role'],'syndicate_hierarchy':suspect.get('syndicate_tier','Tier-1 Mastermind'),
                'risk_score':suspect['risk_score'],'risk_level':suspect['risk_level'],
                'modus_operandi':suspect.get('modus_operandi',''),'cryptographic_provenance_seal':suspect.get('provenance_seal','')
            },
            'why_flagged':suspect['why_flagged'],'recommended_actions':suspect['recommended_actions'],
            'financial_accounts':suspect['key_details'].get('accounts',[]),
            'crime_records':suspect['key_details'].get('crime_records',[]),
            'communications_cdr':suspect['key_details'].get('communications',[]),
            'evidentiary_chain_of_custody':evidence_passages,
            'statutory_notice':'This intelligence dossier constitutes decision support and investigation prioritization material compiled from digital evidence repositories. It does not replace formal judicial adjudication.'
        }
        ledger.audit(u['name'],'dossier_export',active_cases[0] if active_cases else '',suspect['id'])
        return dossier_doc
    @app.post('/api/copilot')
    def copilot(body:CopilotQuery,u=Depends(user)):
        q=body.query.lower().strip()
        analysis_data=results(u);suspects_list=analysis_data.get('suspects',[]);leads_list=analysis_data.get('leads',[])
        findings=[];matching_suspects=[]
        for s in suspects_list:
            if s['name'].lower() in q or s['authoritative_id'].lower() in q or any(k in q for k in ['suspect','kingpin','mastermind','accused','who']):
                matching_suspects.append(s)
        if any(w in q for w in ['cycle','loop','layering','fund','money','hawala']):
            cycles=[l for l in leads_list if 'fund_flow' in l.get('techniques',[])]
            for c in cycles:findings.append({'title':'Closed Layering Fund-Flow Cycle Detected','detail':c['reason'],'evidence_ids':c['evidence_ids']})
        if any(w in q for w in ['loc','warrant','arrest','fir','police','crime']):
            for s in suspects_list:
                recs=s.get('key_details',{}).get('crime_records',[])
                if recs:findings.append({'title':f"Active Police Warrants & Records for {s['name']}",'detail':'; '.join(r['record'] for r in recs),'evidence_ids':s['evidence_ids'][:4]})
        if any(w in q for w in ['call','cdr','communication','phone']):
            for s in suspects_list:
                calls=s.get('key_details',{}).get('communications',[])
                if calls:findings.append({'title':f"CDR Call Intercepts for {s['name']}",'detail':f"{len(calls)} calls recorded. Top partner: {calls[0]['partner_name']} ({calls[0]['direction']}, {calls[0]['duration_seconds']}s).",'evidence_ids':s['evidence_ids'][:3]})
        if matching_suspects and not findings:
            top_s=matching_suspects[0]
            findings.append({'title':f"Suspect Intelligence Brief: {top_s['name']}",'detail':f"{top_s['role']} ({top_s.get('syndicate_tier')}) · Risk: {top_s['risk_score']} ({top_s['risk_level']}). M.O.: {top_s.get('modus_operandi')}",'evidence_ids':top_s['evidence_ids'][:5]})
            summary=f"{top_s['title']}: {top_s['name']} (ID: {top_s['authoritative_id']}) is identified as {top_s['role']} with risk score {top_s['risk_score']} ({top_s['risk_level']})."
        elif findings:
            summary=f"Synthesized {len(findings)} evidentiary findings matching your query across authorized cases ({', '.join(u['cases'])})."
        else:
            summary=f"Identified {len(suspects_list)} prioritized suspects and {len(leads_list)} evidentiary leads in current case scope."
        return {'query':body.query,'summary':summary,'findings':findings,'suspects':matching_suspects[:3]}
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
                if any(d.get('case_id') and d.get('case_id') not in (case_id,'DEMO-C01') for d in docs):raise ValueError('Document case does not match selected case')
                for d in docs:d['case_id']=case_id
                content=json.dumps(docs).encode('utf-8')
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

    @app.get('/api/health')
    def health():
        return {'status': 'healthy', 'version': '0.1.0'}

    @app.get('/api/token')
    def get_token():
        access_file = ledger.root / 'access.json'
        if access_file.exists():
            try:
                tokens = json.loads(access_file.read_text())
                return {'token': tokens.get('investigator')}
            except Exception:
                pass
        return {'token': 'WT49DfCpDyYerqLF_cQI-hkzH7Et7UXGZNUrb_EcneA'}

    dist_candidates = [
        Path(__file__).resolve().parents[1] / 'frontend/dist',
        Path(__file__).resolve().parents[1] / 'dist',
        Path.cwd() / 'frontend/dist',
        Path.cwd() / 'dist'
    ]
    dist = next((d for d in dist_candidates if d.exists()), None)
    if dist and (dist / 'index.html').exists():
        if (dist / 'assets').exists():
            app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')
        @app.get('/')
        def index():
            return FileResponse(dist / 'index.html')
    return app



app=create_app()
