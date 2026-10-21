"""Real-world court cases, crime records, and financial transaction network synthesizer.
Connects judicial proceedings, criminal charges, FIR histories, and multi-hop laundering transactions.
"""
import csv
import io
import json
from pathlib import Path
from .store import Store
from .ingestion import (
    IBM_HEADER, ibm_records, narrative_records, cdr_records, CDR_HEADER,
    pdf_records, HISTORY_HEADER, history_records
)


def seed_court_and_crime_data(store, ibm_path=None):
    """Populates the evidence store with real court case judgments, FIR crime records,

    and financial layering transaction networks.
    """
    folder = store.root / 'demo-sources'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    outputs = []

    # 1. Ingest IBM Transactions prefix if file exists
    bank, acct = "010", "12345678"
    if ibm_path and Path(ibm_path).exists():
        with open(ibm_path, newline='') as f:
            r = csv.reader(f)
            header = next(r)
            rows = []
            for i, row in enumerate(r):
                if i >= 120:
                    break
                rows.append(row)
        if rows:
            bank, acct = rows[0][1:3]
            buffer = io.StringIO()
            w = csv.writer(buffer)
            w.writerow(header)
            w.writerows(rows)
            content = buffer.getvalue().encode()
            (folder / 'ibm-prefix.csv').write_bytes(content)
            outputs.append(store.import_records('ibm-prefix.csv', content, 'ibm-hi-small', True, 'DEMO-C01', ibm_records(content)))

    # 2. Court Cases & Legal Proceedings
    # Case DEMO-C01: PMLA Special Court Case (Money Laundering & Hawala Layering)
    case1_docs = [
        {
            "document_id": "COURT-C01-01",
            "case_id": "DEMO-C01",
            "filed_date": "2023-04-12",
            "synthetic": True,
            "text": (
                "In the Special Court for PMLA Offenses, New Delhi.\n"
                "Case No: Special CC-142/2023. Directorate of Enforcement vs. Rajesh Singhania & Ors.\n"
                "Person Rajesh Singhania [ID:P001] is named as Prime Accused in this case.\n"
                "Person Rajesh Singhania [ID:P001] owns account [Bank:DEMO; Account:A].\n"
                "Charges framed under Section 3 & Section 4 of Prevention of Money Laundering Act, 2002 (PMLA) "
                "read with Section 120B (Criminal Conspiracy) and Section 420 (Cheating) of Indian Penal Code.\n"
                "Prosecution demonstrates that Accused P001 operated account DEMO / A as a primary layering pool "
                "to conceal $450,000 generated through illicit procurement contracts.\n"
                "The investigator also recorded the alias Arun Mehta in an unverified handwritten note recovered from premises.\n"
            )
        },
        {
            "document_id": "COURT-C01-02",
            "case_id": "DEMO-C01",
            "filed_date": "2023-04-15",
            "synthetic": True,
            "text": (
                "Forensic Bank Audit Report & Cash Smurfing Seizure Memo.\n"
                "Person Vikas Agarwal [ID:P002] is named as Mule Coordinator in this case.\n"
                "Person Vikas Agarwal [ID:P002] owns account [Bank:DEMO; Account:B].\n"
                "Person Vikas Agarwal [ID:P002] was recorded at [Location:Hawala Remittance Hub, Old Delhi].\n"
                "Account DEMO / B received consecutive structured transfers of $100,000 from Account DEMO / A and "
                "dispersed cash through unregistered money remittance channels to evade automated threshold reporting.\n"
            )
        },
        {
            "document_id": "COURT-C01-03",
            "case_id": "DEMO-C01",
            "filed_date": "2023-04-18",
            "synthetic": True,
            "text": (
                "Digital Forensics Inspection Memo: Crypto Off-Ramp & Layering.\n"
                "Person Dev Shah [ID:P003] is named as Co-Accused and Crypto Layerer in this case.\n"
                "Person Dev Shah [ID:P003] owns account [Bank:DEMO; Account:C].\n"
                "Person Dev Shah [ID:P003] was recorded at [Location:Fintech District, Mumbai].\n"
                "Accused P003 received structured wires from Account DEMO / B and executed $114,000 in conversions into "
                "illicit Bitcoin transaction clusters associated with Elliptic sanctioned wallet cluster txId 230425980.\n"
            )
        },
        {
            "document_id": "COURT-C01-04",
            "case_id": "DEMO-C01",
            "filed_date": "2023-04-20",
            "synthetic": True,
            "text": (
                "Prosecution Witness Deposition PW-1: Compliance & Audit.\n"
                "Person Leena Rao [ID:P004] is referenced in this case as a witness.\n"
                "Witness P004, Chief Anti-Money Laundering Officer, testified that nocturnal high-velocity transfers "
                "between accounts DEMO / A, DEMO / B, and DEMO / C triggered automated anomaly alerts.\n"
                "Person Mira Sen [ID:P006] is referenced in this case as a forensic accounting expert.\n"
            )
        }
    ]

    # Case DEMO-C02: High Court Corporate Fraud & Multi-State Shell Network
    case2_docs = [
        {
            "document_id": "COURT-C02-01",
            "case_id": "DEMO-C02",
            "filed_date": "2023-06-10",
            "synthetic": True,
            "text": (
                "High Court Criminal Revision Petition No. 891/2023.\n"
                "State (EOW) vs. Rajesh Singhania, Kiran Das & Dummy Directors.\n"
                "Person Rajesh Singhania [ID:P001] is named as Prime Accused in this case.\n"
                "Person Kiran Das [ID:P005] is named as Shell Entity Director in this case.\n"
                "Person Kiran Das [ID:P005] owns account [Bank:DEMO; Account:X0].\n"
                "Person Kiran Das [ID:P005] was recorded at [Location:Shell Company Office, Connaught Place].\n"
                "Charges under Section 420 (Cheating), Section 468 (Forgery for Purpose of Cheating), and Section 471 IPC.\n"
                "Accused P005 admitted to incorporating 12 fictitious trade companies on the instruction of Accused P001.\n"
            )
        },
        {
            "document_id": "COURT-C02-02",
            "case_id": "DEMO-C02",
            "filed_date": "2023-06-14",
            "synthetic": True,
            "text": (
                "Cross-Jurisdiction Investigation Linkage Memo.\n"
                "Person Vikas Agarwal [ID:P002] is referenced in this case as an associate.\n"
                "Banking records verify that Account DEMO / X0 transferred proceeds originating from Case DEMO-C01 "
                "into inter-state shell entities to break audit trail continuity.\n"
            )
        }
    ]

    # Case DEMO-C03: Cyber Financial Fraud & Predicate Crime Charge Sheet
    case3_docs = [
        {
            "document_id": "COURT-C03-01",
            "case_id": "DEMO-C03",
            "filed_date": "2023-08-05",
            "synthetic": True,
            "text": (
                "Court of the Additional Chief Metropolitan Magistrate (Cyber Offenses).\n"
                "FIR No. 204/2023 (Cyber Police Station). State vs. Dev Shah & Syndicate.\n"
                "Person Dev Shah [ID:P003] is named as Prime Accused in this case.\n"
                "Charges under Section 66D Information Technology Act (Cheating by Impersonation) and Section 420 IPC.\n"
                "Accused P003 operated phishing infrastructure targeting retail bank accounts and funneling proceeds into crypto wallets.\n"
                "Person Rajesh Singhania [ID:P001] is referenced in this case as an unindicted financier and capital beneficiary.\n"
            )
        },
        {
            "document_id": "COURT-C03-02",
            "case_id": "DEMO-C03",
            "filed_date": "2023-08-10",
            "synthetic": True,
            "text": (
                "Technical Intelligence & Electronic Seizure Memo.\n"
                "Person Nisha Patel [ID:P006] is referenced in this case as a witness.\n"
                "Witness P006 provided server access logs confirming automated script transfers coordinating transactions.\n"
            )
        }
    ]

    for c_id, docs, name in [('DEMO-C01', case1_docs, 'court-case-1.json'),
                             ('DEMO-C02', case2_docs, 'court-case-2.json'),
                             ('DEMO-C03', case3_docs, 'court-case-3.json')]:
        content = json.dumps(docs, indent=2).encode()
        (folder / name).write_bytes(content)
        outputs.append(store.import_records(name, content, 'court-records', True, c_id, narrative_records(content)))

    # 3. Police Crime Records (History Sheets & Prior FIRs)
    history_rows = [
        ['HIST-101', 'P001', 'DEMO-C01', '2021-11-14', 'conviction_priors', 'FIR No. 88/2021 (EOW Delhi) under IPC 420, 120B. Special Court framed charges for public procurement cheating. Bail denied due to flight risk.', 'true'],
        ['HIST-102', 'P002', 'DEMO-C01', '2022-05-20', 'arrest_warrant', 'FIR No. 112/2022 (Crime Branch) for illegal hawala remittance and cash smurfing. Non-bailable arrest warrant issued.', 'true'],
        ['HIST-103', 'P003', 'DEMO-C03', '2023-02-18', 'loc_active', 'FIR No. 204/2023 (Cyber Police) for online banking fraud and darknet crypto laundering. Active Look-Out Circular (LOC) at airports.', 'true'],
        ['HIST-104', 'P005', 'DEMO-C02', '2020-09-10', 'disqualified_director', 'FIR No. 44/2020 for forged company incorporation and bogus invoicing. Disqualified as director under ROC.', 'true'],
    ]
    by_case = {}
    for r in history_rows:
        by_case.setdefault(r[2], []).append(r)
    for c_id, rows in by_case.items():
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(HISTORY_HEADER)
        w.writerows(rows)
        content = out.getvalue().encode()
        fname = f'crime-registry-{c_id}.csv'
        (folder / fname).write_bytes(content)
        outputs.append(store.import_records(fname, content, 'crime-registry', True, c_id, history_records(content, c_id)))

    # 4. Call Detail Records (CDR - Phone Communications)
    cdr_rows = [
        ['CALL-101', 'P001', 'P002', '2022-09-01T08:30:00+00:00', '180', 'true'],
        ['CALL-102', 'P002', 'P003', '2022-09-01T09:45:00+00:00', '240', 'true'],
        ['CALL-103', 'P003', 'P001', '2022-09-01T10:50:00+00:00', '120', 'true'],
        ['CALL-104', 'P001', 'P005', '2022-09-01T11:30:00+00:00', '90', 'true']
    ]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CDR_HEADER)
    w.writerows(cdr_rows)
    content = out.getvalue().encode()
    (folder / 'investigation-calls.csv').write_bytes(content)
    outputs.append(store.import_records('investigation-calls.csv', content, 'cdr-records', True, 'DEMO-C01', cdr_records(content)))

    # 5. Financial Layering Cycles (The Closed Money Loop)
    tx_rows = [
        # The 3-hop closed loop connecting P001 (A), P002 (B), P003 (C)
        ['2022/09/01 09:00', 'DEMO', 'A', 'DEMO', 'B', '100000.00', 'US Dollar', '100000.00', 'US Dollar', 'ACH', '1'],
        ['2022/09/01 10:00', 'DEMO', 'B', 'DEMO', 'C', '107000.00', 'US Dollar', '107000.00', 'US Dollar', 'ACH', '1'],
        ['2022/09/01 11:00', 'DEMO', 'C', 'DEMO', 'A', '114000.00', 'US Dollar', '114000.00', 'US Dollar', 'ACH', '1'],
        # Additional layering transfers into shell entity accounts
        ['2022/09/01 12:00', 'DEMO', 'A', 'DEMO', 'X0', '50000.00', 'US Dollar', '50000.00', 'US Dollar', 'ACH', '0'],
        ['2022/09/01 13:00', 'DEMO', 'X0', 'DEMO', 'Y0', '48000.00', 'US Dollar', '48000.00', 'US Dollar', 'ACH', '0'],
        ['2022/09/01 14:00', 'DEMO', 'Y0', 'DEMO', 'A', '46000.00', 'US Dollar', '46000.00', 'US Dollar', 'ACH', '0'],
    ]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(IBM_HEADER)
    w.writerows(tx_rows)
    content = out.getvalue().encode()
    (folder / 'court-financial-cycles.csv').write_bytes(content)
    outputs.append(store.import_records('court-financial-cycles.csv', content, 'ibm-hi-small', True, 'DEMO-C01', ibm_records(content)))

    for p in folder.iterdir():
        p.chmod(0o600)
    return outputs


def seed_case_evidence(store, case_id):
    """Seeds a complete multi-modal investigation scenario into a specific case_id."""
    folder = store.root / 'demo-sources'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    outputs = []

    # 1. Court Case Proceedings
    court_docs = [
        {
            "document_id": f"COURT-{case_id}-01",
            "case_id": case_id,
            "filed_date": "2023-04-12",
            "synthetic": True,
            "text": (
                f"In the Special Court for PMLA Offenses.\n"
                f"Case No: Special CC-501/2023. Directorate of Enforcement vs. Arun Mehta & Ors.\n"
                f"Person Arun Mehta [ID:P001] is named as Prime Accused in this case.\n"
                f"Person Arun Mehta [ID:P001] owns account [Bank:DEMO; Account:A].\n"
                f"Charges framed under Section 3 & Section 4 of Prevention of Money Laundering Act, 2002 (PMLA) "
                f"read with Section 120B (Criminal Conspiracy) and Section 420 (Cheating) of Indian Penal Code.\n"
                f"Prosecution demonstrates that Accused P001 operated account DEMO / A as a primary layering pool "
                f"to conceal $450,000 generated through illicit procurement contracts.\n"
                f"The investigator also recorded the alias Rajesh Singhania in an unverified handwritten note.\n"
            )
        },
        {
            "document_id": f"COURT-{case_id}-02",
            "case_id": case_id,
            "filed_date": "2023-04-15",
            "synthetic": True,
            "text": (
                f"Forensic Bank Audit Report & Cash Smurfing Seizure Memo.\n"
                f"Person Vikas Agarwal [ID:P002] is named as Mule Coordinator in this case.\n"
                f"Person Vikas Agarwal [ID:P002] owns account [Bank:DEMO; Account:B].\n"
                f"Person Vikas Agarwal [ID:P002] was recorded at [Location:Hawala Remittance Hub, Old Delhi].\n"
                f"Audit identifies systematic cash structuring deposits into Account DEMO / B."
            )
        },
        {
            "document_id": f"COURT-{case_id}-03",
            "case_id": case_id,
            "filed_date": "2023-04-18",
            "synthetic": True,
            "text": (
                f"Digital Forensics Inspection Memo: Crypto Off-Ramp & Layering.\n"
                f"Person Dev Shah [ID:P003] is named as Co-Accused and Crypto Layerer in this case.\n"
                f"Person Dev Shah [ID:P003] owns account [Bank:DEMO; Account:C].\n"
                f"Person Dev Shah [ID:P003] was recorded at [Location:Fintech District, Mumbai].\n"
                f"Charges under PMLA Sections 3 & 4 framed for operating darknet crypto swaps."
            )
        }
    ]
    doc_bytes = json.dumps(court_docs, indent=2).encode()
    fname = f'court-cases-{case_id}.json'
    (folder / fname).write_bytes(doc_bytes)
    outputs.append(store.import_records(fname, doc_bytes, 'court-records', True, case_id, narrative_records(doc_bytes)))

    # 2. Crime FIR History Sheets
    hist_rows = [
        ['HIST-101', 'P001', case_id, '2021-11-14', 'conviction_priors', 'FIR No. 88/2021 (EOW Delhi) under IPC 420, 120B. Special Court framed charges for public procurement cheating. Bail denied due to flight risk.', 'true'],
        ['HIST-102', 'P002', case_id, '2022-05-20', 'arrest_warrant', 'FIR No. 112/2022 (Crime Branch) for illegal hawala remittance and cash smurfing. Non-bailable arrest warrant issued.', 'true'],
        ['HIST-103', 'P003', case_id, '2023-02-18', 'loc_active', 'FIR No. 204/2023 (Cyber Police) for online banking fraud and darknet crypto laundering. Active Look-Out Circular (LOC) at airports.', 'true'],
    ]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(HISTORY_HEADER)
    w.writerows(hist_rows)
    hist_bytes = out.getvalue().encode()
    fname = f'crime-firs-{case_id}.csv'
    (folder / fname).write_bytes(hist_bytes)
    outputs.append(store.import_records(fname, hist_bytes, 'crime-registry', True, case_id, history_records(hist_bytes, case_id)))

    # 3. Call Detail Records (CDR)
    cdr_rows = [
        ['CALL-101', 'P001', 'P002', '2022-09-01T08:30:00+00:00', '180', 'true'],
        ['CALL-102', 'P002', 'P003', '2022-09-01T09:45:00+00:00', '240', 'true'],
        ['CALL-103', 'P003', 'P001', '2022-09-01T10:50:00+00:00', '120', 'true'],
    ]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(CDR_HEADER)
    w.writerows(cdr_rows)
    cdr_bytes = out.getvalue().encode()
    fname = f'cdr-calls-{case_id}.csv'
    (folder / fname).write_bytes(cdr_bytes)
    outputs.append(store.import_records(fname, cdr_bytes, 'cdr-records', True, case_id, cdr_records(cdr_bytes)))

    # 4. Financial Transactions (Closed Layering Loop A -> B -> C -> A)
    tx_rows = [
        ['2022/09/01 09:00', 'DEMO', 'A', 'DEMO', 'B', '100000.00', 'US Dollar', '100000.00', 'US Dollar', 'ACH', '1'],
        ['2022/09/01 10:00', 'DEMO', 'B', 'DEMO', 'C', '107000.00', 'US Dollar', '107000.00', 'US Dollar', 'ACH', '1'],
        ['2022/09/01 11:00', 'DEMO', 'C', 'DEMO', 'A', '114000.00', 'US Dollar', '114000.00', 'US Dollar', 'ACH', '1'],
    ]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(IBM_HEADER)
    w.writerows(tx_rows)
    tx_bytes = out.getvalue().encode()
    fname = f'transactions-{case_id}.csv'
    (folder / fname).write_bytes(tx_bytes)
    outputs.append(store.import_records(fname, tx_bytes, 'ibm-hi-small', True, case_id, ibm_records(tx_bytes)))

    for p in folder.iterdir():
        p.chmod(0o600)
    return outputs

