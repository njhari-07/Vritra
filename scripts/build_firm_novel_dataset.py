"""Builder and Loader for Novel-Derived Forensic Intelligence Dataset:
Based on John Grisham's legal crime thriller 'The Firm' (The Morolto Syndicate & Bendini Law Firm).
Extracts evidence across:
  1. Court Proceedings (US Federal Grand Jury Indictments & Bail Hearings)
  2. Financial Wires (Casino skimming -> Memphis law firm -> Grand Cayman trusts -> Reinvestment)
  3. Crime Records (FBI RICO charges, Cayman Royal Police inquest, Grand Jury subpoenas)
  4. Telecom CDR (Intercepted nocturnal coordination calls between partners, mob boss, and Cayman banker)
  5. Raw FBI Complaint (Verbatim 18 U.S.C. RICO affidavit for zero-shot text ingestion)
"""
import csv
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from maha.store import Store
from maha.ingestion import ibm_records, narrative_records, cdr_records, history_records

DATASET_DIR = REPO_ROOT / "data/novel_dataset_the_firm"
DATASET_DIR.mkdir(parents=True, exist_ok=True)
CASE_ID = "CASE-THE-FIRM"


def generate_files():
    print(f"Generating interconnected files for '{CASE_ID}' from 'The Firm'...")

    # 1. Court Proceedings (JSON)
    court_docs = [
        {
            "document_id": "CR-COURT-FIRM-01",
            "case_id": CASE_ID,
            "filed_date": "2026-04-12",
            "synthetic": True,
            "text": (
                "IN THE UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TENNESSEE.\n"
                "CRIMINAL DOCKET NO. CR-2026-8819: UNITED STATES OF AMERICA v. JOEY MOROLTO ET AL.\n\n"
                "1. Person Joey Morolto [ID:P401] is named as Prime Accused and head of the Chicago criminal enterprise.\n"
                "2. Person Joey Morolto [ID:P401] owns account [Bank:010; Account:ACC-MOROLTO-CHI].\n"
                "3. Charges framed under 18 U.S.C. Section 1961 (Racketeer Influenced and Corrupt Organizations Act - RICO), "
                "18 U.S.C. Section 1956 (Laundering of Monetary Instruments), and 18 U.S.C. Section 1343 (Wire Fraud).\n"
                "4. Person Oliver Lambert [ID:P402] is named as Managing Partner of Bendini, Lambert & Locke and primary structuring architect.\n"
                "5. Person Oliver Lambert [ID:P402] owns account [Bank:010; Account:ACC-BENDINI-MEMPHIS].\n"
                "6. Person Nathan Locke [ID:P403] is named as Co-Accused and executive compliance enforcer in this case.\n"
                "7. Person Nathan Locke [ID:P403] owns account [Bank:010; Account:ACC-LOCKE-SPECIAL].\n"
                "8. Person Avery Tolar [ID:P407] owns account [Bank:010; Account:ACC-CAYMAN-TRUST] and operated offshore pass-through trusts in George Town, Grand Cayman.\n"
                "9. Prosecution establishes that Accused P401 skimmed $12,500,000 from gaming enterprises, routed tranches through "
                "Account 010 / ACC-BENDINI-MEMPHIS under fraudulent legal retainer billings, layered sums into Account 010 / ACC-CAYMAN-TRUST, "
                "and repatriated capital as foreign commercial loans to purchase US office complexes."
            )
        },
        {
            "document_id": "CR-COURT-FIRM-02",
            "case_id": CASE_ID,
            "filed_date": "2026-04-20",
            "synthetic": False,
            "text": (
                "MEMORANDUM DECISION AND PRETRIAL DETENTION ORDER // UNITED STATES MAGISTRATE COURT.\n"
                "In the Matter of the Pretrial Detention of Nathan Locke and Oliver Lambert.\n\n"
                "1. Accused Nathan Locke [ID:P403] was recorded at [Location:Cotton Exchange Building, Memphis].\n"
                "2. Pretrial release is DENIED under 18 U.S.C. Section 3142(e) due to clear danger to the community, flight risk, "
                "and substantial evidence of witness tampering.\n"
                "3. FBI electronic intercepts established that Accused Nathan Locke [ID:P403] authorized unauthorized surveillance "
                "and wiretaps on associates and maintained direct communication with hitman conduits following suspicious deaths in the Caymans.\n"
                "4. The court orders immediate seizure of Account 010 / ACC-LOCKE-SPECIAL."
            )
        },
        {
            "document_id": "CR-COURT-FIRM-03",
            "case_id": CASE_ID,
            "filed_date": "2026-04-28",
            "synthetic": False,
            "text": (
                "FEDERAL GRAND JURY PROCEEDINGS: WITNESS DEPOSITION UNDER 18 U.S.C. SECTION 3500.\n\n"
                "1. Person Mitchell Y McDeere [ID:P404] is referenced in this case as a witness.\n"
                "2. Witness Mitchell Y McDeere [ID:P404] served as Tax Associate at Bendini, Lambert & Locke.\n"
                "3. Witness P404 delivered unredacted corporate records, billing tapes, and offshore wire logs confirming "
                "that over 70% of firm billings were fictitious vehicles designed to launder Morolto cash.\n"
                "4. Witness P404 testified under oath that nocturnal wire transfers between 01:00 AM and 03:30 AM were routinely "
                "executed by Oliver Lambert [ID:P402] following encrypted telephone coordination with Chicago."
            )
        }
    ]
    court_path = DATASET_DIR / "court_proceedings.json"
    court_path.write_text(json.dumps(court_docs, indent=2), encoding="utf-8")
    print(f"  [Created] {court_path.name}")

    # 2. Financial Wires (CSV)
    # 20 daylight normal corporate business transactions + 10 nocturnal laundering wires
    wire_rows = [
        # Normal daylight legitimate legal retainer wires
        ["2026/04/01 09:15", "010", "ACC-CLIENT-CORP-A", "010", "ACC-BENDINI-MEMPHIS", "18500.00", "US Dollar", "18500.00", "US Dollar", "Wire", "0"],
        ["2026/04/01 10:30", "010", "ACC-CLIENT-CORP-B", "010", "ACC-BENDINI-MEMPHIS", "24000.00", "US Dollar", "24000.00", "US Dollar", "Cheque", "0"],
        ["2026/04/01 11:45", "010", "ACC-BENDINI-MEMPHIS", "010", "ACC-VENDOR-SUPPLIES", "8200.00", "US Dollar", "8200.00", "US Dollar", "ACH", "0"],
        ["2026/04/01 14:00", "010", "ACC-CLIENT-CORP-C", "010", "ACC-BENDINI-MEMPHIS", "35000.00", "US Dollar", "35000.00", "US Dollar", "Wire", "0"],
        ["2026/04/02 09:40", "010", "ACC-BENDINI-MEMPHIS", "010", "ACC-PAYROLL-STAFF", "45000.00", "US Dollar", "45000.00", "US Dollar", "Wire", "0"],
        ["2026/04/02 11:10", "010", "ACC-CLIENT-ESTATE-1", "010", "ACC-BENDINI-MEMPHIS", "12400.00", "US Dollar", "12400.00", "US Dollar", "ACH", "0"],
        ["2026/04/02 13:30", "010", "ACC-CLIENT-CORP-D", "010", "ACC-BENDINI-MEMPHIS", "29500.00", "US Dollar", "29500.00", "US Dollar", "Wire", "0"],
        ["2026/04/03 10:00", "010", "ACC-CLIENT-CORP-E", "010", "ACC-BENDINI-MEMPHIS", "16200.00", "US Dollar", "16200.00", "US Dollar", "Cheque", "0"],
        ["2026/04/03 14:15", "010", "ACC-BENDINI-MEMPHIS", "010", "ACC-OPERATIONS-TAX", "11000.00", "US Dollar", "11000.00", "US Dollar", "Wire", "0"],
        ["2026/04/04 11:20", "010", "ACC-CLIENT-CORP-F", "010", "ACC-BENDINI-MEMPHIS", "42000.00", "US Dollar", "42000.00", "US Dollar", "Wire", "0"],

        # Nocturnal Syndicate Layering Loop 1: 3-Hop Closed Loop ($850,000)
        # Morolto Chicago -> Bendini Memphis -> Cayman Trust -> Morolto Chicago (Reinvestment)
        ["2026/04/05 01:15", "010", "ACC-MOROLTO-CHI", "010", "ACC-BENDINI-MEMPHIS", "850000.00", "US Dollar", "850000.00", "US Dollar", "Wire", "1"],
        ["2026/04/05 02:00", "010", "ACC-BENDINI-MEMPHIS", "010", "ACC-CAYMAN-TRUST", "841500.00", "US Dollar", "841500.00", "US Dollar", "ACH", "1"],
        ["2026/04/05 02:45", "010", "ACC-CAYMAN-TRUST", "010", "ACC-MOROLTO-CHI", "833000.00", "US Dollar", "833000.00", "US Dollar", "Reinvestment", "1"],

        # Nocturnal Syndicate Layering Loop 2: 4-Hop Real Estate Conduit Loop ($620,000)
        # Morolto Chicago -> Locke Special -> Cayman Trust -> REIT Shell -> Morolto Chicago
        ["2026/04/06 01:25", "010", "ACC-MOROLTO-CHI", "010", "ACC-LOCKE-SPECIAL", "620000.00", "US Dollar", "620000.00", "US Dollar", "Wire", "1"],
        ["2026/04/06 02:10", "010", "ACC-LOCKE-SPECIAL", "010", "ACC-CAYMAN-TRUST", "613800.00", "US Dollar", "613800.00", "US Dollar", "ACH", "1"],
        ["2026/04/06 02:55", "010", "ACC-CAYMAN-TRUST", "010", "ACC-REIT-MEMPHIS", "607600.00", "US Dollar", "607600.00", "US Dollar", "Wire", "1"],
        ["2026/04/06 03:40", "010", "ACC-REIT-MEMPHIS", "010", "ACC-MOROLTO-CHI", "600000.00", "US Dollar", "600000.00", "US Dollar", "Reinvestment", "1"],

        # Nocturnal Hitman Payoff & Wiretap Conduit
        ["2026/04/06 04:15", "010", "ACC-LOCKE-SPECIAL", "010", "ACC-HITMAN-TAMPA", "65000.00", "US Dollar", "65000.00", "US Dollar", "Wire", "1"],
    ]
    wires_path = DATASET_DIR / "financial_wires.csv"
    with open(wires_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"])
        writer.writerows(wire_rows)
    print(f"  [Created] {wires_path.name}")

    # 3. Crime Records (CSV)
    crime_rows = [
        ["CR-RICO-401", "P401", CASE_ID, "2024-03-10", "Active Charge-Sheet", "FBI Special Organized Crime Task Force Indictment: Joey Morolto charged under 18 U.S.C. 1961 (RICO) and 1956 (Money Laundering) for casino skimming.", "false"],
        ["CR-LOC-402", "P401", CASE_ID, "2024-06-18", "Look Out Circular", "Federal Look Out Circular (LOC) issued by Department of Justice at all international airports and Caribbean maritime exits.", "false"],
        ["CR-SUB-403", "P402", CASE_ID, "2025-01-15", "Grand Jury Subpoena", "Federal Grand Jury Subpoena Duces Tecum served on Oliver Lambert demanding foreign account ledgers and Cayman flight manifests.", "false"],
        ["CR-HOMICIDE-404", "P403", CASE_ID, "2025-04-22", "Homicide Investigation", "Royal Cayman Islands Police Service formal homicide inquest into suspicious scuba diving deaths of Bendini partners Marty Kozinski and Joe Hodge.", "false"],
        ["CR-NBW-405", "P403", CASE_ID, "2025-09-08", "Non-Bailable Warrant", "Federal Arrest Warrant issued by US Magistrate Judge for Nathan Locke following flight risk and witness intimidation findings.", "false"],
        ["CR-DISBAR-406", "P402", CASE_ID, "2026-02-12", "Disbarred Attorney", "Supreme Court of Tennessee Emergency Order suspending legal license of Oliver Lambert for operating fraudulent shell conduits.", "false"],
        ["CR-WITSEC-407", "P404", CASE_ID, "2026-03-25", "Witness Protection Enrollment", "Formal enrollment of Mitchell Y. McDeere in Federal Witness Security Program (WITSEC) after surrendering 12,000 covert firm files.", "false"],
    ]
    crime_path = DATASET_DIR / "crime_records.csv"
    with open(crime_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"])
        writer.writerows(crime_rows)
    print(f"  [Created] {crime_path.name}")

    # 4. Telecom CDR (CSV)
    # Timed 10-20 minutes before each major wire!
    cdr_rows = [
        # Call 15 min before Loop 1 Wire 1 ($850,000): Morolto -> Lambert
        ["CDR-FIRM-401", "P401", "P402", "2026-04-05T01:00:00+00:00", 380, "true"],
        # Call 15 min before Loop 1 Wire 2 ($841,500): Lambert -> Avery Tolar (Cayman)
        ["CDR-FIRM-402", "P402", "P407", "2026-04-05T01:45:00+00:00", 290, "true"],
        # Call 15 min before Loop 1 Wire 3 ($833,000): Tolar -> Morolto
        ["CDR-FIRM-403", "P407", "P401", "2026-04-05T02:30:00+00:00", 310, "true"],
        # Call 15 min before Loop 2 Wire 1 ($620,000): Morolto -> Locke
        ["CDR-FIRM-404", "P401", "P403", "2026-04-06T01:10:00+00:00", 420, "true"],
        # Call 15 min before Loop 2 Wire 2 ($613,800): Locke -> Tolar (Cayman)
        ["CDR-FIRM-405", "P403", "P407", "2026-04-06T01:55:00+00:00", 330, "true"],
        # Call 15 min before Loop 2 Wire 3: Tolar -> REIT manager
        ["CDR-FIRM-406", "P407", "P402", "2026-04-06T02:40:00+00:00", 260, "true"],
        # Secret Payphone Call: Mitch McDeere (P404) contacting FBI Special Agent
        ["CDR-FIRM-407", "P404", "P402", "2026-04-06T04:00:00+00:00", 180, "true"],
    ]
    cdr_path = DATASET_DIR / "telecom_cdr.csv"
    with open(cdr_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"])
        writer.writerows(cdr_rows)
    print(f"  [Created] {cdr_path.name}")

    # 5. Raw Police FIR / FBI Complaint (Text)
    fbi_affidavit = (
        "UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TENNESSEE\n"
        "AFFIDAVIT IN SUPPORT OF APPLICATION FOR SEARCH AND SEIZURE WARRANTS\n"
        "CASE: OPERATION MEMPHIS LAW FIRM (MOROLTO SYNDICATE RACKETEERING)\n\n"
        "I, Special Agent F. Denton Voyles, Federal Bureau of Investigation, being duly sworn, depose and state:\n"
        "1. For the past twenty-two months, the FBI Organized Crime Strike Force has conducted an undercover investigation "
        "into Bendini, Lambert & Locke, a tax boutique law firm located in Memphis, Tennessee.\n"
        "2. Evidence establishes that the firm is a captive corporate conduit owned and controlled by Joey Morolto [ID:P401], "
        "head of the Morolto Crime Family in Chicago.\n"
        "3. Managing Partner Oliver Lambert [ID:P402] and Enforcer Partner Nathan Locke [ID:P403] systematically operated "
        "Account 010 / ACC-BENDINI-MEMPHIS and Account 010 / ACC-LOCKE-SPECIAL to receive millions in cash casino skims, "
        "funneling them offshore into Account 010 / ACC-CAYMAN-TRUST operated by Avery Tolar [ID:P407].\n"
        "4. Intercepted telecom records (CDR) demonstrate that wire executions between 01:00 AM and 03:00 AM were directly preceded "
        "by encrypted phone calls between Accused P401, P402, and P403.\n"
        "5. Cooperating witness Mitchell Y. McDeere [ID:P404] has provided physical custody of internal double-billing records and "
        "Cayman corporate ledgers establishing violations of 18 U.S.C. 1961, 18 U.S.C. 1956, and mail fraud.\n"
    )
    raw_path = DATASET_DIR / "raw_fbi_complaint.txt"
    raw_path.write_text(fbi_affidavit, encoding="utf-8")
    print(f"  [Created] {raw_path.name}")


def ingest_into_maha():
    print(f"\nIngesting novel evidence into Vritra ledger under '{CASE_ID}'...")
    store = Store()
    store.reset_case(CASE_ID)

    # Ensure case exists
    with store.db() as db:
        db.execute("INSERT OR IGNORE INTO cases(id, closed_at) VALUES (?, NULL)", (CASE_ID,))
        # Grant CASE-THE-FIRM to investigator and restricted users
        for user in ('investigator', 'restricted'):
            row = db.execute("SELECT cases FROM users WHERE name=?", (user,)).fetchone()
            if row:
                cases = json.loads(row[0])
                if CASE_ID not in cases:
                    cases.append(CASE_ID)
                    db.execute("UPDATE users SET cases=? WHERE name=?", (json.dumps(cases), user))

    # Ingest Court
    court_bytes = (DATASET_DIR / "court_proceedings.json").read_bytes()
    r1 = store.import_records("court_proceedings_firm.json", court_bytes, "court-proceedings", True,
                              CASE_ID, narrative_records(court_bytes), "novel-loader")
    print(f"  [OK] Ingested Court Orders: {r1.get('rows_seen', 0)} facts.")

    # Ingest Crime
    crime_bytes = (DATASET_DIR / "crime_records.csv").read_bytes()
    r2 = store.import_records("crime_records_firm.csv", crime_bytes, "crime-registry", True,
                              CASE_ID, history_records(crime_bytes, CASE_ID), "novel-loader")
    print(f"  [OK] Ingested Crime Records: {r2.get('rows_seen', 0)} records.")

    # Ingest Telecom
    cdr_bytes = (DATASET_DIR / "telecom_cdr.csv").read_bytes()
    r3 = store.import_records("telecom_cdr_firm.csv", cdr_bytes, "cdr-records", True,
                              CASE_ID, cdr_records(cdr_bytes), "novel-loader")
    print(f"  [OK] Ingested Telecom CDR: {r3.get('rows_seen', 0)} calls.")

    # Ingest Financial Wires
    wires_bytes = (DATASET_DIR / "financial_wires.csv").read_bytes()
    r4 = store.import_records("financial_wires_firm.csv", wires_bytes, "financial-wires", True,
                              CASE_ID, ibm_records(wires_bytes), "novel-loader")
    print(f"  [OK] Ingested Financial Wires: {r4.get('rows_seen', 0)} transactions.")

    print(f"\nSuccessfully populated case '{CASE_ID}' with John Grisham's 'The Firm' evidence!")


if __name__ == "__main__":
    generate_files()
    ingest_into_maha()
