"""Deterministic synthetic demonstration with IBM-linked identities and separate controls."""
import csv
import io
import json
from pathlib import Path
from .store import Store
from .ingestion import IBM_HEADER,ibm_records,narrative_records,cdr_records,CDR_HEADER,pdf_records,HISTORY_HEADER,history_records


def statement_pdf(path):
    from reportlab.lib.pagesizes import landscape,A4
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    styles=getSampleStyleSheet();story=[Paragraph('MAHA-DEMO-STATEMENT v1',styles['Title']),Paragraph('SYNTHETIC TEST DATA - not a real bank statement',styles['Normal']),Spacer(1,20)]
    rows=[['Time (UTC)','From bank','From account','To bank','To account','Paid','Received','Currency'],
          ['2022-09-01 09:00','DEMO','PDF-A','DEMO','PDF-B','100.00','100.00','USD'],
          ['2022-09-01 10:00','DEMO','PDF-B','DEMO','PDF-C','90.00','90.00','USD']]
    table=Table(rows,colWidths=[112,70,95,70,95,65,65,65]);table.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.5,colors.HexColor('#8c9e95')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8efe8')),('FONTSIZE',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),10)]));story.append(table)
    SimpleDocTemplate(str(path),pagesize=landscape(A4),rightMargin=25,leftMargin=25,invariant=1).build(story)


def seed(store,ibm_path):
    folder=store.root/'demo-sources';folder.mkdir(exist_ok=True,mode=0o700)
    # Preserve exact source rows; the prefix subset is explicitly nonrepresentative.
    with open(ibm_path,newline='') as f:
        r=csv.reader(f);header=next(r)
        if header!=IBM_HEADER:raise ValueError('Unexpected IBM source')
        rows=[]
        for i,row in enumerate(r):
            if i>=120:break
            rows.append(row)
    if not rows:raise ValueError('IBM source has no complete records')
    buffer=io.StringIO();w=csv.writer(buffer);w.writerow(header);w.writerows(rows);content=buffer.getvalue().encode()
    (folder/'ibm-prefix.csv').write_bytes(content)
    (folder/'subset-manifest.json').write_text(json.dumps({'source_file':str(Path(ibm_path).resolve()),'selection':'First 120 data records; not representative','source_record_range':[1,len(rows)],'synthetic':True},indent=2))
    outputs=[store.import_records('ibm-prefix.csv',content,'ibm-hi-small',True,'DEMO-C01',ibm_records(content))]
    bank,acct=rows[0][1:3]
    names=['Arun Mehta','Leena Rao','Dev Shah','Mira Sen','Kiran Das','Nisha Patel']
    for c in range(1,4):
        docs=[]
        for j in range(8):
            person=j%6;pid=f'P{person+1:03}';name=names[person]
            text=f'Synthetic investigation note {c}-{j+1}.\nPerson {name} [ID:{pid}] is referenced in this case as a witness.\n'
            if person==0:text+=f'Person {name} [ID:{pid}] owns account [Bank:{bank}; Account:{acct}].\n'
            text+=f'Person {name} [ID:{pid}] was recorded at [Location:Demo Office {person%2+1}].\n'
            text+='The investigator also recorded the name Arun Mehta in an unverified handwritten note.\n'
            docs.append({'document_id':f'SYN-{c}-{j+1:02}','case_id':f'DEMO-C0{c}','filed_date':f'2022-09-{j+1:02}','text':text,'synthetic':True})
        content=json.dumps(docs,indent=2).encode();name=f'case-{c}.json';(folder/name).write_bytes(content)
        outputs.append(store.import_records(name,content,'team-authored',True,f'DEMO-C0{c}',narrative_records(content)))
    out=io.StringIO();w=csv.writer(out);w.writerow(CDR_HEADER);w.writerow(['CALL-1','P001','P002','2022-09-01T08:00:00+00:00','120','true'])
    content=out.getvalue().encode();(folder/'calls.csv').write_bytes(content)
    outputs.append(store.import_records('calls.csv',content,'team-authored',True,'DEMO-C01',cdr_records(content)))
    out=io.StringIO();w=csv.writer(out);w.writerow(HISTORY_HEADER)
    w.writerow(['HISTORY-1','P001','DEMO-C01','2022-09-01','witness_reference','Synthetic case index entry; no finding of wrongdoing.','true'])
    content=out.getvalue().encode();(folder/'history.csv').write_bytes(content)
    outputs.append(store.import_records('history.csv',content,'team-authored',True,'DEMO-C01',history_records(content,'DEMO-C01')))
    out=io.StringIO();w=csv.writer(out);w.writerow(IBM_HEADER)
    for i,(a,b,h) in enumerate([('A','B',9),('B','C',10),('C','A',11)]+[(f'X{i}',f'Y{i}',12+i%8) for i in range(12)]):
        w.writerow([f'2022/09/01 {h:02}:00','DEMO',a,'DEMO',b,str(100+i*7),'US Dollar',str(100+i*7),'US Dollar','ACH','0'])
    content=out.getvalue().encode();(folder/'flow-controls.csv').write_bytes(content)
    outputs.append(store.import_records('flow-controls.csv',content,'team-flow-controls',True,'DEMO-C01',ibm_records(content,'team-flow-controls')))
    pdf=folder/'statement.pdf';statement_pdf(pdf);content=pdf.read_bytes()
    outputs.append(store.import_records('statement.pdf',content,'team-pdf-controls',True,'DEMO-C01',pdf_records(content)))
    for p in folder.iterdir():p.chmod(0o600)
    return outputs
