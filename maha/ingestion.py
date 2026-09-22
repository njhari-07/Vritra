"""Strict adapters: positional IBM CSV, source-span narratives, CDR, fixed PDF."""
import csv
import io
import math
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from .store import uid

IBM_HEADER = ['Timestamp','From Bank','Account','To Bank','Account','Amount Received','Receiving Currency','Amount Paid','Payment Currency','Payment Format','Is Laundering']
CURRENCIES = {'US Dollar':'USD','Euro':'EUR','UK Pound':'GBP','Yen':'JPY','Yuan':'CNY','Rupee':'INR','Ruble':'RUB','Canadian Dollar':'CAD','Australian Dollar':'AUD','Swiss Franc':'CHF','Bitcoin':'BTC','Mexican Peso':'MXN','Brazil Real':'BRL','Shekel':'ILS','Saudi Riyal':'SAR','USD':'USD','INR':'INR','EUR':'EUR'}


def node(kind, identifier, label=None, **attrs):
    return dict(kind="node", id=identifier, type=kind, label=label or identifier, attrs=attrs)


def edge(kind, source, target, key="", **attrs):
    return dict(kind="edge", id=uid(kind, source, target, key), type=kind, source=source, target=target, attrs=attrs)


def account(bank, number, namespace="ibm-hi-small"):
    return "account:" + uid(namespace, bank, number)


def amount(value):
    try: d = Decimal(value)
    except InvalidOperation: raise ValueError("invalid_amount")
    if not d.is_finite() or d < 0: raise ValueError("nonfinite_or_negative_amount")
    return str(d)


def currency(value):
    if value not in CURRENCIES: raise ValueError("unmapped_currency:" + value)
    return CURRENCIES[value]


def csv_rows(content, header):
    stream = io.StringIO(content.decode("utf-8-sig"), newline="")
    reader = csv.reader(stream, strict=True)
    if next(reader, None) != header: raise ValueError("Unexpected header or column order")
    last = reader.line_num
    for ordinal, row in enumerate(reader, 1):
        locator = {"record_ordinal": ordinal, "line_start": last + 1, "line_end": reader.line_num}
        last = reader.line_num
        yield row, locator


def transfer_facts(r, transaction_id, namespace="ibm-hi-small", iso_time=None):
    if len(r) != 11 or any(not v.strip() for v in r): raise ValueError("missing_or_extra_fields")
    t = iso_time or datetime.strptime(r[0], "%Y/%m/%d %H:%M").replace(tzinfo=timezone.utc).isoformat()
    paid, received = amount(r[7]), amount(r[5])
    pc, rc = currency(r[8]), currency(r[6])
    if r[10] not in {"0", "1"}: raise ValueError("invalid_label")
    a, b = account(r[1], r[2], namespace), account(r[3], r[4], namespace)
    attrs = dict(event_time=t, amount_paid=paid, amount_received=received, payment_currency=pc,
                 receiving_currency=rc, payment_currency_raw=r[8], receiving_currency_raw=r[6],
                 payment_format=r[9], transaction_id=transaction_id, evaluation_label=int(r[10]),
                 time_basis="synthetic_UTC_assumption" if iso_time is None else "explicit_UTC")
    facts = [node("Account",a,f"{r[1]} / {r[2]}", bank=r[1], account=r[2]),
             node("Account",b,f"{r[3]} / {r[4]}", bank=r[3], account=r[4]),
             node("Transaction",transaction_id,f"{paid} {pc}", **attrs),
             edge("SENT_FROM",transaction_id,a,transaction_id), edge("SENT_TO",transaction_id,b,transaction_id),
             edge("TRANSACTED_WITH",a,b,transaction_id,**attrs)]
    return facts, t


def ibm_records(content, namespace="ibm-hi-small"):
    import hashlib
    source_hash = hashlib.sha256(content).hexdigest()
    for row, locator in csv_rows(content, IBM_HEADER):
        try:
            facts, t = transfer_facts(row, "transaction:"+uid(namespace,source_hash,locator),namespace)
            warnings=['zero_amount_retained'] if Decimal(row[5])==0 or Decimal(row[7])==0 else []
            yield dict(locator=locator,facts=facts,event_time=t,time_basis="synthetic_UTC_assumption",passage=json_row(row),warnings=warnings)
        except (ValueError, OverflowError) as e:
            yield {"locator":locator,"error":str(e)}


def json_row(row):
    import json
    return json.dumps(row, ensure_ascii=False)


def narrative_records(content, nlp=None):
    import json
    from .nlp import extract
    docs = json.loads(content)
    if not isinstance(docs,list): raise ValueError("Narratives must be a JSON array")
    for ordinal, doc in enumerate(docs,1):
        base = {"document_ordinal":ordinal}
        try:
            required = ["document_id","case_id","filed_date","text","synthetic"]
            if any(k not in doc for k in required) or doc["synthetic"] is not True: raise ValueError("invalid_synthetic_document")
            datetime.strptime(doc["filed_date"],"%Y-%m-%d")
            if not isinstance(doc["text"],str) or not doc["text"].strip(): raise ValueError("empty_text")
            yield from extract(doc,base,nlp)
        except (ValueError,TypeError) as e:
            yield {"locator":base,"error":str(e)}


CDR_HEADER = ['record_id','caller_person_id','callee_person_id','start_time','duration_seconds','synthetic']


def cdr_records(content):
    for r, loc in csv_rows(content,CDR_HEADER):
        try:
            if len(r)!=6 or any(not x for x in r) or r[5]!="true": raise ValueError("invalid_cdr")
            dt=datetime.fromisoformat(r[3])
            if dt.tzinfo is None or int(r[4])<0: raise ValueError("invalid_cdr_time_or_duration")
            a,b="person:demo:"+r[1],"person:demo:"+r[2]
            # These IDs are explicit synthetic identity assignments, not inferred phone owners.
            yield dict(locator=loc,event_time=dt.astimezone(timezone.utc).isoformat(),time_basis="explicit_UTC",passage=json_row(r),facts=[
                node("Person",a,r[1],authoritative_id=r[1]),node("Person",b,r[2],authoritative_id=r[2]),
                edge("COMMUNICATED_WITH",a,b,r[0],event_time=dt.isoformat(),duration_seconds=int(r[4]))])
        except (ValueError,OverflowError) as e: yield {"locator":loc,"error":str(e)}


HISTORY_HEADER=['record_id','person_id','case_id','record_date','record_status','text','synthetic']


def history_records(content,case_id):
    for r,loc in csv_rows(content,HISTORY_HEADER):
        try:
            if len(r)!=7 or any(not x for x in r) or r[6]!='true' or r[2]!=case_id:raise ValueError('invalid_history_record_or_case')
            datetime.strptime(r[3],'%Y-%m-%d')
            pid='person:demo:'+r[1]
            yield dict(locator=loc,passage=json_row(r),method='synthetic-history-csv',facts=[
                node('Person',pid,r[1],authoritative_id=r[1]),node('Case',case_id,case_id),
                edge('INVOLVED_IN_CASE',pid,case_id,r[0],record_date=r[3],source_record_status=r[4],source_text=r[5])])
        except ValueError as e:yield {'locator':loc,'error':str(e)}


def pdf_records(content):
    """Only MAHA-DEMO-STATEMENT v1, a generated fixed-layout synthetic statement."""
    import pdfplumber
    import hashlib
    if not content.startswith(b'%PDF-'):raise ValueError('Invalid PDF signature')
    source_hash=hashlib.sha256(content).hexdigest()
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        if not pdf.pages or len(pdf.pages)>20: raise ValueError("Unsupported PDF page count")
        for page_no,page in enumerate(pdf.pages,1):
            if "MAHA-DEMO-STATEMENT v1" not in (page.extract_text() or ""):
                raise ValueError("Unsupported PDF layout; expected MAHA-DEMO-STATEMENT v1")
            tables=page.find_tables()
            if len(tables)!=1: raise ValueError("Expected one ruled table per page")
            table=tables[0];rows=table.extract()
            expected=['Time (UTC)','From bank','From account','To bank','To account','Paid','Received','Currency']
            if not rows or rows[0]!=expected: raise ValueError("Unsupported PDF table header")
            for index,r in enumerate(rows[1:],1):
                loc={"page":page_no,"table":1,"row":index,"bbox":list(table.rows[index].bbox),"bbox_origin":"top-left","bbox_units":"points"}
                try:
                    if len(r)!=8 or any(x is None for x in r): raise ValueError("missing_pdf_cell")
                    t=datetime.strptime(r[0],"%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).isoformat()
                    cells=[r[0],r[1],r[2],r[3],r[4],r[6],r[7],r[5],r[7],"Statement","0"]
                    facts,_=transfer_facts(cells,"transaction:"+uid(source_hash,loc),"demo-pdf",t)
                    for f in facts: f['attrs'].pop('evaluation_label',None)
                    yield dict(locator=loc,facts=facts,event_time=t,time_basis="explicit_UTC",method="pdfplumber-fixed-v1",passage=json_row(r))
                except (ValueError,OverflowError) as e: yield {"locator":loc,"error":str(e)}
