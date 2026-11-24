import csv
from contextlib import asynccontextmanager, closing
import hashlib
import io
import json
import os
from pathlib import Path
import re
from threading import Event, Thread
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import Response, FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from .store import ImportSettingsConflict, Store, now, uid
from .limits import ResourceLimitError
from .graph import snapshot, synchronize_projection
from .analytics import analyze, fund_flow
from .nlp import candidates
from .judgments import judgment_records
from .document_intake import extract_document, render_source_page
from .judgment_review import ReviewConflict, load_review, save_review
from .suspects import compute_suspect_dossiers
from .ingestion import ibm_records, narrative_records, cdr_records, pdf_records, history_records, json_row
from .statements import CURRENCIES, MAX_BYTES, METHOD as STATEMENT_METHOD, STATEMENT_DATASET, statement_records, statement_rows


class StatementRequestTooLarge(MultiPartException):
    pass


async def read_statement_form(request, *, with_file):
    limit = MAX_BYTES + 16 * 1024 if with_file else 16 * 1024

    async def bounded_stream():
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise StatementRequestTooLarge('Statement request exceeds the upload limit')
            yield chunk

    if request.headers.get('content-type', '').split(';', 1)[0].lower() != 'multipart/form-data':
        raise HTTPException(422, 'Submit the statement as a multipart form')
    try:
        form = await MultiPartParser(
            request.headers, bounded_stream(), max_files=int(with_file),
            max_fields=4 if with_file else 1, max_part_size=4096,
        ).parse()
    except StatementRequestTooLarge as exc:
        raise HTTPException(413, exc.message) from None
    except (MultiPartException, MultipartParseError):
        raise HTTPException(422, 'Invalid statement upload form') from None
    try:
        password = form.get('password', '')
        if not isinstance(password, str) or len(password) > 1024:
            raise HTTPException(422, 'Invalid password field')
        if not with_file:
            return password
        source = form.get('file')
        currency, date_order = form.get('currency'), form.get('date_order')
        if not isinstance(source, UploadFile):
            raise HTTPException(422, 'Choose a statement file')
        if not isinstance(currency, str) or currency not in CURRENCIES or date_order not in ('DMY', 'MDY'):
            raise HTTPException(422, 'Choose a statement currency and date order')
        pages = form.get('pdf_pages', '')
        if not isinstance(pages, str) or len(pages) > 32:
            raise HTTPException(422, 'Enter a PDF page or range such as 1 or 1-10')
        page_range = None
        if pages.strip():
            match = re.fullmatch(r'\s*([0-9]+)(?:\s*[-–]\s*([0-9]+))?\s*', pages)
            if match is None:
                raise HTTPException(422, 'Enter a PDF page or range such as 1 or 1-10')
            start = int(match[1])
            end = int(match[2] or match[1])
            if not 1 <= start <= end:
                raise HTTPException(422, 'PDF page numbers must start at 1 or later and be in ascending order')
            page_range = (start, end)
        content = await source.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise HTTPException(413, '25 MiB upload limit exceeded')
        filename = Path((source.filename or '').replace('\\', '/')).name
        extension = '.pdf' if content.startswith(b'%PDF-') else '.xlsx'
        if Path(filename).suffix.lower() != extension or len(filename) > 120:
            filename = 'bank-statement' + extension
        return content, filename, password, currency, date_order, page_range
    finally:
        await form.close()


class JudgmentReview(BaseModel):
    decision: Literal['approved', 'corrected', 'rejected']
    reason: str = Field(min_length=3, max_length=2000)
    previous_id: int | None
    start: int | None = None
    end: int | None = None
    label: str | None = None


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
    source_type: Literal["police_fir", "court_judgment", "other"] = "police_fir"
    synthetic: bool = False


class TrainConfig(BaseModel):
    contamination: float=Field(default=0.05,ge=0.01,le=0.20)
    weight_financial: float=Field(default=35.0,ge=5.0,le=70.0)
    weight_court: float=Field(default=30.0,ge=5.0,le=70.0)
    weight_centrality: float=Field(default=20.0,ge=5.0,le=50.0)
    weight_cross_case: float=Field(default=15.0,ge=5.0,le=40.0)



def create_app(store=None):
    ledger=store or Store()
    bearer=HTTPBearer(auto_error=False)

    @asynccontextmanager
    async def lifespan(app):
        stop = Event()
        worker = None
        if os.getenv('NEO4J_URI'):
            worker = Thread(target=synchronize_projection, args=(ledger, stop),
                            name='maha-graph-sync', daemon=True)
            worker.start()
        try:
            yield
        finally:
            stop.set()
            if worker:
                await run_in_threadpool(worker.join, 2)

    app=FastAPI(title='MAHA · Evidence workspace',version='0.1.0',lifespan=lifespan)
    @app.exception_handler(ResourceLimitError)
    async def resource_limit(request,exc):
        return JSONResponse(status_code=413,content={'detail':str(exc)})

    def user(credentials:HTTPAuthorizationCredentials=Depends(bearer)):
        if not credentials:raise HTTPException(401,'Access token required')
        try:return ledger.authenticate(credentials.credentials)
        except PermissionError:raise HTTPException(401,'Invalid access token')
    def case_scope(u, target_case):
        if target_case is None:
            return u['cases']
        if target_case not in u['cases']:
            raise HTTPException(404, 'Case unavailable')
        return [target_case]

    def graph(u,target_case=None):
        return snapshot(ledger,case_scope(u,target_case))

    def evidence_exists(evidence_id, cases):
        try:
            ledger.evidence(evidence_id,cases)
            return True
        except KeyError:
            return False

    def results(u,target_case=None,*,include_unreviewed=False):
        active_cases=case_scope(u,target_case)
        g=snapshot(ledger,active_cases)
        # Keep cross-case correlation on the same scoped graph as the other findings.
        result=analyze(g)
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
            if reviews.get(lead['id'], {}).get('review_origin') == 'manual':
                lead['review']=reviews[lead['id']]
                lead['review_state']=reviews[lead['id']]['state']
        primary_case=target_case or (u['cases'][0] if u['cases'] else None)
        t_run=ledger.get_training_run(primary_case) if primary_case else None
        result['is_trained']=(t_run is not None)
        result['training_run']={k:v for k,v in t_run.items() if k in {
            'case_id','trained_at','nodes_count','edges_count','leads_count',
            'suspects_count','anomaly_status'
        }} if t_run else None
        result['active_case']=primary_case
        result['case_graph_size']=(len(g['nodes']),len(g['edges']))
        dossiers=compute_suspect_dossiers(g,valid,result['metrics']) if t_run or include_unreviewed else []
        filtered_suspects=[d for d in dossiers if d['evidence_ids'] and
                           all(evidence_exists(eid,active_cases) for eid in d['evidence_ids'])]
        result['suspects']=filtered_suspects
        kingpin_suspect=next((s for s in filtered_suspects if s.get('is_kingpin')), None)
        result['kingpin']={
            'id': kingpin_suspect['id'],
            'name': kingpin_suspect['name'],
            'kingpin_score': kingpin_suspect.get('kingpin_score'),
            'syndicate_role': kingpin_suspect.get('syndicate_role'),
            'role_badge': kingpin_suspect.get('role_badge'),
            'reasons': kingpin_suspect.get('kingpin_reasons', []),
            'breakdown': kingpin_suspect.get('kingpin_breakdown', {})
        } if kingpin_suspect else None
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
        if not 2 <= len(cid) <= 64:
            raise HTTPException(422,'Case identifier must be 2–64 characters')
        try:
            ledger.add_case_to_user(u['name'],cid)
        except ValueError as exc:
            raise HTTPException(409,str(exc)) from exc
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
    def load_sample_endpoint(case_id:str,dataset:str|None='the_exchange',u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        from .court_data import seed_case_evidence
        res=seed_case_evidence(ledger,case_id,dataset=dataset or 'the_exchange')
        ledger.audit(u['name'],'seed_sample_evidence',case_id)
        return {'status':'seeded','case_id':case_id,'dataset':dataset or 'the_exchange','details':len(res),'case':ledger.case_status([case_id])[0]}
    @app.post('/api/import/raw-text/{case_id}')
    def import_raw_text(case_id:str,body:RawTextImport,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        from .nlp import raw_text_records

        try:
            content = body.text.encode('utf-8')
            if body.source_type == 'court_judgment':
                dataset, records = 'court-judgment', judgment_records(content)
            else:
                dataset, records = body.source_type, raw_text_records(body.text)

            def marked_records():
                for record in records:
                    if body.synthetic:
                        record['locator']['synthetic_input'] = True
                    yield record

            title = body.title.strip() or 'Pasted text'
            result = ledger.import_records(title, content, dataset, body.synthetic,
                                           case_id, list(marked_records()), u['name'])
        except FileNotFoundError as exc:
            raise HTTPException(503, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {'status':'imported','case_id':case_id,'records_parsed':result['rows_seen'],'summary':result}
    @app.post('/api/cases/{case_id}/train')
    def train_models_endpoint(case_id:str,body:TrainConfig|None=None,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        status=ledger.case_status([case_id])[0]
        if status['facts_count']==0:
            raise HTTPException(400,f"Case {case_id} contains 0 evidence records. Please upload court proceedings, financial transactions, crime FIRs, or telecom CDR logs first, or click 'Load Sample Evidence Package'.")
        res=results(u,target_case=case_id,include_unreviewed=True)
        node_count,edge_count=res['case_graph_size']
        suspects=res['suspects']
        kingpin_suspect=next((s for s in suspects if s.get('is_kingpin')), None)
        train_meta={
            'case_id':case_id,
            'trained_at':now(),
            'nodes_count':node_count,
            'edges_count':edge_count,
            'leads_count':len(res['leads']),
            'suspects_count':len(suspects),
            'kingpin_identified':kingpin_suspect['name'] if kingpin_suspect else 'None',
            'kingpin_score':kingpin_suspect.get('kingpin_score') if kingpin_suspect else 0.0,
            'anomaly_status':res['anomaly_status'],
            'status':'ANALYSIS_COMPLETE',
        }
        ledger.record_training_run(case_id,train_meta)
        ledger.audit(u['name'],'train_models',case_id)
        return {
            'status':'success',
            'case_id':case_id,
            'training_metadata':train_meta,
            'kingpin':{
                'id': kingpin_suspect['id'],
                'name': kingpin_suspect['name'],
                'kingpin_score': kingpin_suspect.get('kingpin_score'),
                'syndicate_role': kingpin_suspect.get('syndicate_role'),
                'role_badge': kingpin_suspect.get('role_badge'),
                'reasons': kingpin_suspect.get('kingpin_reasons', []),
                'breakdown': kingpin_suspect.get('kingpin_breakdown', {})
            } if kingpin_suspect else None,
            'suspects':suspects,
            'leads':res.get('leads',[]),
            'metrics':res.get('metrics',{})
        }
    @app.get('/api/charge-sheet/{suspect_id}')
    def retired_charge_sheet(suspect_id:str,u=Depends(user)):
        raise HTTPException(410,'Charge sheet generation was retired. Use the evidence dossier.')

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
        active_cases=case_scope(u,case)
        ledger.audit(u['name'],'graph_read',active_cases[0] if active_cases else '')
        return snapshot(ledger,active_cases)
    @app.get('/api/analysis')
    def get_analysis(case:str|None=None,u=Depends(user)):return results(u,target_case=case)
    @app.get('/api/suspects')
    def get_suspects(case:str|None=None,u=Depends(user)):return results(u,target_case=case).get('suspects',[])
    @app.get('/api/dossier/{suspect_id}')
    def get_dossier(suspect_id:str,case:str|None=None,u=Depends(user)):
        active_cases=case_scope(u,case)
        dossiers=results(u,target_case=case)['suspects']
        dossier=next((item for item in dossiers if item['id']==suspect_id),None)
        if dossier is None:
            raise HTTPException(404,'Dossier unavailable in case scope')
        try:
            evidence=[ledger.evidence(eid,active_cases) for eid in dossier['evidence_ids']]
        except KeyError:
            raise HTTPException(409,'Dossier evidence changed. Refresh and retry.') from None
        ledger.audit(u['name'],'dossier_export',case or '',dossier['id'])
        return {'document_title':'Case evidence review dossier','generated_at':now(),
                'case_ids':active_cases,'person':dossier,'source_evidence':evidence}

    @app.post('/api/copilot')
    def copilot(body:CopilotQuery,case:str|None=None,u=Depends(user)):
        analysis=results(u,target_case=case)
        query=body.query.casefold().strip()
        dossiers=[d for d in analysis['suspects'] if query and (
            d['name'].casefold() in query or
            (d['authoritative_id'] and d['authoritative_id'].casefold() in query))]
        findings=[{'title':d['name'],'detail':d['role'] or 'Person referenced in case records',
                   'evidence_ids':d['evidence_ids']} for d in dossiers[:3]]
        return {'query':body.query,'summary':f'{len(dossiers)} matching person dossiers.',
                'findings':findings,'suspects':dossiers[:3]}

    @app.get('/api/evidence/audit')
    def get_evidence_audit(case:str|None=None,u=Depends(user)):
        from .audit_evidence import audit_evidence_correctness
        return audit_evidence_correctness(ledger, cases=case_scope(u, case))

    @app.get('/api/evidence/{eid}')
    def evidence(eid:str,u=Depends(user)):
        try:ev=ledger.evidence(eid,u['cases'])
        except KeyError:raise HTTPException(404,'Evidence unavailable')
        ledger.audit(u['name'],'evidence_read',ev['case_ids'][0],eid)
        return ev
    @app.get('/api/evidence/{eid}/judgment-review')
    def get_judgment_review(eid:str,u=Depends(user)):
        try:
            return load_review(ledger, eid, u['cases'])
        except KeyError as exc:
            raise HTTPException(404, 'Judgment mention unavailable') from exc
        except ReviewConflict as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post('/api/evidence/{eid}/judgment-review')
    def record_judgment_review(eid:str,body:JudgmentReview,u=Depends(user)):
        try:
            return save_review(ledger, eid, u['cases'], u['name'], body.model_dump())
        except KeyError as exc:
            raise HTTPException(404, 'Judgment mention unavailable') from exc
        except ReviewConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get('/api/evidence/{eid}/source-page')
    def document_source_page(eid:str,u=Depends(user)):
        try:
            item = ledger.evidence(eid, u['cases'])
            locator = item['source_locator']
            if not locator.get('text_method'):
                raise KeyError(eid)
            _, content = ledger.source(item['source_id'], u['cases'])
            image = render_source_page(content, locator['page'])
        except KeyError as exc:
            raise HTTPException(404, 'Source page unavailable') from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        ledger.audit(u['name'], 'source_page_view', item['case_ids'][0], eid)
        return Response(image, media_type='image/png')

    @app.get('/api/source/{source_id}')
    def source(source_id:str,u=Depends(user)):
        try:name,content=ledger.source(source_id,u['cases'])
        except KeyError:raise HTTPException(404,'Source unavailable')
        ledger.audit(u['name'],'source_read',u['cases'][0],source_id)
        return Response(content,media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="source-{source_id[:12]}"'})

    @app.post('/api/evidence/{eid}/statement-row')
    async def verify_statement_row(eid: str, request: Request, u=Depends(user)):
        def read_original():
            item = ledger.evidence(eid, u['cases'])
            if item['extraction_method'] != STATEMENT_METHOD:
                raise KeyError(eid)
            _, content = ledger.source(item['source_id'], u['cases'])
            if hashlib.sha256(content).hexdigest() != item['source_id']:
                raise HTTPException(409, 'The retained original no longer matches its evidence hash')
            return item, content

        try:
            item, content = await run_in_threadpool(read_original)
        except KeyError:
            raise HTTPException(404, 'Statement source unavailable') from None
        password = await read_statement_form(request, with_file=False)

        def verify():
            source_locator = item['source_locator']
            page = source_locator.get('page')
            page_range = (page, page) if source_locator['format'] == 'pdf' else None
            with closing(statement_rows(content, password, page_range=page_range)) as rows:
                for locator, headers, cells, _ in rows:
                    if locator == source_locator:
                        ledger.audit(u['name'], 'statement_row_verified', item['case_ids'][0], eid)
                        return {
                            'locator': locator, 'headers': headers, 'cells': cells,
                            'matches_ingested': json_row([headers, cells]) == item['passage'],
                        }
            raise HTTPException(409, 'The source row could not be reproduced')

        try:
            return await run_in_threadpool(verify)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        finally:
            del password

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
    def review(lid:str,body:Review,case:str|None=None,u=Depends(user)):
        leads={l['id']:l for l in results(u,target_case=case)['leads']}
        if lid not in leads:raise HTTPException(404,'Lead unavailable')
        data={**body.model_dump(),'actor':u['name'],'at':now(),'review_origin':'manual'}
        ledger.save_review(lid, leads[lid]['case_ids'], data)
        ledger.audit(u['name'],'lead_review',leads[lid]['case_ids'][0],lid);return data
    @app.get('/api/leads/{lid}/history')
    def lead_review_history(lid:str,u=Depends(user)):
        """Return the full ordered event history of review decisions for a specific lead."""
        history=ledger.review_history(lid,u['cases'])
        return {'lead_id':lid,'history':history,'count':len(history)}
    @app.get('/api/quality')
    def quality(case:str|None=None,u=Depends(user)):
        return [{**r,'summary':json.loads(r['summary'])} for r in ledger.history('imports',case_scope(u,case))]
    @app.get('/api/audit')
    def audit(case:str|None=None,u=Depends(user)):return ledger.history('audit',case_scope(u,case))
    @app.get('/api/benchmarks')
    def benchmarks(u=Depends(user)):
        reports=[]
        for name in ['montagna-evaluation.json','elliptic-evaluation.json','ibm-evaluation.json','nlp-evaluation.json','evidence-audit.json','demo-evaluation.json']:
            path=Path('artifacts/evaluation')/name
            if path.exists():
                try:
                    data=json.loads(path.read_text())
                    data.pop('source_line_numbers',None)
                    reports.append(data)
                except Exception:
                    pass
        return reports

    @app.get('/api/doctor')
    def get_doctor():
        from .doctor import diagnose_system
        return diagnose_system(str(ledger.root))

    @app.get('/api/adjudication')
    @app.post('/api/adjudicate/run')
    def retired_adjudication(u=Depends(user)):
        raise HTTPException(410,'Lead precision requires independent human labels. Automated adjudication is retired.')

    @app.get('/api/timeline')
    def timeline(case:str|None=None,u=Depends(user)):
        g=graph(u,case);names={n['id']:n['label'] for n in g['nodes']}
        events=[{'id':n['id'],'label':n['label'],'event_time':n['attrs']['event_time'],
                 'time_basis':n['attrs'].get('time_basis'),'evidence_ids':n['evidence_ids']}
                for n in g['nodes'] if n['attrs'].get('event_time')]
        events += [{'id':e['id'],'label':f"Call: {names[e['source']]} → {names[e['target']]}",'event_time':e['attrs']['event_time'],'evidence_ids':e['evidence_ids']} for e in g['edges'] if e['type']=='COMMUNICATED_WITH' and e['attrs'].get('event_time')]
        return sorted(events,key=lambda n:n['event_time'])
    @app.get('/api/flow')
    def flow(start:str,end:str|None=None,u=Depends(user)):
        g=graph(u);ids={n['id'] for n in g['nodes']}
        if start not in ids or (end and end not in ids):raise HTTPException(404,'Entity unavailable')
        return fund_flow(g,start,end)
    @app.post('/api/import/bank-statement/{case_id}')
    async def upload_statement(case_id: str, request: Request, u=Depends(user)):
        if case_id not in u['cases']:
            raise HTTPException(403, 'Case access required')
        content, filename, password, currency, date_order, page_range = await read_statement_form(request, with_file=True)
        try:
            records = await run_in_threadpool(statement_records, content, password, currency, date_order, page_range=page_range)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        finally:
            del password
        try:
            return await run_in_threadpool(
                ledger.import_records, filename, content, STATEMENT_DATASET, False, case_id, records, u['name'],
                statement_settings={'currency': currency, 'date_order': date_order},
            )
        except ImportSettingsConflict as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post('/api/import/{kind}/{case_id}')
    async def upload(kind:Literal['ibm','narrative','cdr','pdf','history','judgment','judgment-document','fir-document'],case_id:str,request:Request,u=Depends(user)):
        if case_id not in u['cases']:raise HTTPException(403,'Case access required')
        # Raw request streaming bounds memory before parsing. Filename/path supplied by client is ignored.
        chunks=[];size=0
        async for chunk in request.stream():
            size+=len(chunk)
            if size>25*1024*1024:raise HTTPException(413,'25 MiB upload limit exceeded')
            chunks.append(chunk)
        content=b''.join(chunks)
        del chunks
        if kind in {'judgment', 'judgment-document', 'fir-document'}:
            def import_document():
                judgment = kind != 'fir-document'
                dataset = 'court-judgment' if judgment else 'police_fir'
                if kind == 'judgment':
                    extension, records = 'txt', list(judgment_records(content))
                else:
                    extension, records = extract_document(content, judgment=judgment)
                return ledger.import_records(f'{dataset}.{extension}', content, dataset,
                                             False, case_id, records, u['name'])

            try:
                return await run_in_threadpool(import_document)
            except FileNotFoundError as exc:
                raise HTTPException(503, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        def import_structured(data):
            adapter = {
                'ibm': ibm_records, 'narrative': narrative_records, 'cdr': cdr_records,
                'pdf': pdf_records, 'history': lambda body: history_records(body, case_id),
            }[kind]
            if kind == 'narrative':
                docs = json.loads(data)
                if not isinstance(docs, list) or any(not isinstance(doc, dict) for doc in docs):
                    raise ValueError('Narratives must be a JSON array of objects')
                if any(doc.get('case_id') and doc['case_id'] not in (case_id, 'DEMO-C01') for doc in docs):
                    raise ValueError('Document case does not match selected case')
                for doc in docs:
                    doc['case_id'] = case_id
                data = json.dumps(docs).encode('utf-8')
            dataset = 'ibm-hi-small' if kind == 'ibm' else 'team-authored'
            return ledger.import_records(f'upload-{kind}', data, dataset, True,
                                         case_id, adapter(data), u['name'])

        try:
            return await run_in_threadpool(import_structured, content)
        except (ValueError,UnicodeError,csv.Error,TypeError,KeyError) as e:
            reference = uid(kind, hashlib.sha256(content).hexdigest())
            await run_in_threadpool(ledger.audit, u['name'], 'import_failed', case_id, reference)
            raise HTTPException(422, str(e)) from e
    @app.get('/api/report')
    def report(case:str|None=None,u=Depends(user)):
        cases=case_scope(u,case)
        result=results(u,target_case=case)
        eids=sorted({eid for item in result['leads']+result['suspects'] for eid in item['evidence_ids']})
        data={'title':'Investigator review report','generated_at':now(),'case_ids':cases,'notice':'Decision support only. Synthetic demo results do not establish guilt. Structural context is separate from flagged behavior.','analysis':result,'evidence':[ledger.evidence(e,cases) for e in eids]}
        ledger.audit(u['name'],'report_export',cases[0] if cases else '')
        return Response(json.dumps(data,indent=2),media_type='application/json',headers={'Content-Disposition':'attachment; filename="investigator-review.json"'})

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

        for route in ('/app', '/sign-in', '/sign-up'):
            app.add_api_route(route, index, methods=['GET'], include_in_schema=False)
            app.add_api_route(f'{route}/{{rest:path}}', index, methods=['GET'], include_in_schema=False)
    return app



app=create_app()
