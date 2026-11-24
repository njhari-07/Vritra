"""Builder and Loader for Novel-Derived Forensic Intelligence Dataset:
Based on John Grisham's legal crime thriller 'The Exchange: After The Firm'.
Features Mitch & Abby McDeere 15 years after 'The Firm', investigating:
  1. Court Proceedings (Transnational Kidnapping & Hostage Extortion Indictment)
  2. Financial Wires (Scully & Pershing Escrow -> Geneva Swiss Accounts -> Tangier Conduit -> Tripoli Vaults -> Reinvestment)
  3. Crime Records (Interpol Red Notice, Look-Out Circulars, French/Italian CT Warrants, SFO Subpoenas)
  4. Telecom CDR (Encrypted satellite phone intercepts between militant warlord, negotiator, Turkish oligarch, and courier)
  5. Raw Affidavit (Zero-shot text extraction memo)
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

DATASET_DIR = REPO_ROOT / "data/novel_dataset_the_exchange"
DATASET_DIR.mkdir(parents=True, exist_ok=True)
CASE_ID = "CASE-THE-EXCHANGE"


def generate_files():
    print(f"Generating realistic, unbiased forensic files for '{CASE_ID}' from 'The Exchange'...")

    # 1. Court Proceedings (JSON)
    court_docs = [
        {
            "document_id": "CR-COURT-EXC-01",
            "case_id": CASE_ID,
            "filed_date": "2026-06-15",
            "synthetic": True,
            "text": (
                "IN THE UNITED STATES DISTRICT COURT FOR THE SOUTHERN DISTRICT OF NEW YORK // SPECIAL GRAND JURY INDICTMENT.\n"
                "CRIMINAL DOCKET NO. CR-2026-9944: UNITED STATES OF AMERICA v. MUSTAFA AL-KHATIB, NOURA AL-FASSI, BAYKAN LANNAK ET AL.\n\n"
                "1. Person Mustafa Al-Khatib [ID:P601] is named as Prime Accused and head of the Saharan militant hostage syndicate in this case.\n"
                "2. Person Mustafa Al-Khatib [ID:P601] owns account [Bank:010; Account:ACC-KHATIB-LIBYA-TRIPOLI].\n"
                "3. Person Mustafa Al-Khatib [ID:P601] owns account [Bank:010; Account:ACC-SAHARA-HOLDINGS].\n"
                "4. Charges framed under 18 U.S.C. Section 1203 (Hostage Taking), 18 U.S.C. Section 1956 (Money Laundering), and 18 U.S.C. Section 2332b (Transnational Terrorism Extortion).\n"
                "5. Person Noura Al-Fassi [ID:P602] is named as Co-Accused and extortion negotiator in this case.\n"
                "6. Person Noura Al-Fassi [ID:P602] owns account [Bank:010; Account:ACC-NOURA-TANGIER].\n"
                "7. Person Baykan Lannak [ID:P603] is named as Co-Accused and construction kickback conduit in this case.\n"
                "8. Person Baykan Lannak [ID:P603] owns account [Bank:010; Account:ACC-LANNAK-ISTANBUL].\n"
                "9. Person Baykan Lannak [ID:P603] owns account [Bank:010; Account:ACC-LANNAK-GENEVA].\n"
                "10. Person Tariq Ben-Zaid [ID:P608] is named as Co-Accused and tactical desert convoy coordinator in this case.\n"
                "11. Person Tariq Ben-Zaid [ID:P608] owns account [Bank:010; Account:ACC-BENZAID-TRIPOLI].\n"
                "12. Person Mitchell Y McDeere [ID:P604] owns account [Bank:010; Account:ACC-SCULLY-ESCROW-NY] and is referenced in this case as a witness and designated ransom courier.\n"
                "13. Person Giovanna Sandroni [ID:P605] owns account [Bank:010; Account:ACC-GIOVANNA-ROME] and is referenced in this case as an abducted associate attorney and primary victim.\n"
                "14. Person Abby McDeere [ID:P606] is referenced in this case as a witness and recipient of intercepted extortion communications.\n"
                "15. Person Luca Sandroni [ID:P607] is referenced in this case as a witness and senior partner of the Rome office.\n"
                "16. Prosecution establishes that Accused P601 orchestrated the ambush at the Great Gaddafi Bridge site, demanding a $100,000,000 ransom routed through Account 010 / ACC-LANNAK-GENEVA, layered into Account 010 / ACC-NOURA-TANGIER, and consolidated into Account 010 / ACC-SAHARA-HOLDINGS."
            )
        }
    ]
    (DATASET_DIR / "court_proceedings.json").write_text(json.dumps(court_docs, indent=2), encoding="utf-8")
    print("  [Created] court_proceedings.json")

    # 2. Financial Wires (CSV)
    # 5 Normal operations + 6 Nocturnal Extortion Laundering Loop ($100M cycle)
    wires = [
        # Normal operations
        ["2026/06/01 09:15", "010", "ACC-SCULLY-ESCROW-NY", "010", "ACC-GIOVANNA-ROME", "45000.00", "US Dollar", "45000.00", "US Dollar", "Wire", "0"],
        ["2026/06/01 11:30", "010", "ACC-LANNAK-ISTANBUL", "010", "ACC-DESERT-EQUIPMENT", "85000.00", "US Dollar", "85000.00", "US Dollar", "Cheque", "0"],
        ["2026/06/01 14:00", "010", "ACC-LANNAK-ISTANBUL", "010", "ACC-CEMENT-SUPPLIES", "120000.00", "US Dollar", "120000.00", "US Dollar", "Wire", "0"],
        ["2026/06/01 16:45", "010", "ACC-SCULLY-ESCROW-NY", "010", "ACC-ROME-OFFICE", "60000.00", "US Dollar", "60000.00", "US Dollar", "ACH", "0"],
        ["2026/06/02 10:00", "010", "ACC-GIOVANNA-ROME", "010", "ACC-MEDITERRANEAN-HOTEL", "8500.00", "US Dollar", "8500.00", "US Dollar", "ACH", "0"],

        # Nocturnal $100M Extortion Laundering Loop
        # Scully Escrow -> Geneva Escrow -> Tangier Conduit -> Tripoli/Mustafa -> Sahara Master Vault -> Return/Reinvestment
        ["2026/06/03 01:15", "010", "ACC-SCULLY-ESCROW-NY", "010", "ACC-LANNAK-GENEVA", "100000000.00", "US Dollar", "100000000.00", "US Dollar", "Wire", "1"],
        ["2026/06/03 02:00", "010", "ACC-LANNAK-GENEVA", "010", "ACC-NOURA-TANGIER", "98500000.00", "US Dollar", "98500000.00", "US Dollar", "SWIFT", "1"],
        ["2026/06/03 02:45", "010", "ACC-NOURA-TANGIER", "010", "ACC-BENZAID-TRIPOLI", "15000000.00", "US Dollar", "15000000.00", "US Dollar", "ACH", "1"],
        ["2026/06/03 03:00", "010", "ACC-NOURA-TANGIER", "010", "ACC-KHATIB-LIBYA-TRIPOLI", "82000000.00", "US Dollar", "82000000.00", "US Dollar", "Wire", "1"],
        ["2026/06/03 03:45", "010", "ACC-KHATIB-LIBYA-TRIPOLI", "010", "ACC-SAHARA-HOLDINGS", "79500000.00", "US Dollar", "79500000.00", "US Dollar", "Hawala", "1"],
        ["2026/06/03 04:30", "010", "ACC-SAHARA-HOLDINGS", "010", "ACC-SCULLY-ESCROW-NY", "75000000.00", "US Dollar", "75000000.00", "US Dollar", "Reinvestment", "1"],
    ]
    with open(DATASET_DIR / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Timestamp", "From Bank", "Account", "To Bank", "Account", "Amount Received",
                    "Receiving Currency", "Amount Paid", "Payment Currency", "Payment Format", "Is Laundering"])
        w.writerows(wires)
    print("  [Created] financial_wires.csv")

    # 3. Crime FIR / Intelligence Records (CSV)
    crimes = [
        ["CR-EXC-601", "P601", CASE_ID, "2024-03-12", "Interpol Red Notice",
         "Interpol Red Notice #A-2024/9918 issued for Mustafa Al-Khatib as designated terrorist commander and hostage extortion mastermind.", "true"],
        ["CR-EXC-602", "P601", CASE_ID, "2025-09-08", "Look Out Circular",
         "Border surveillance alert across Mediterranean maritime ports and North African checkpoints for armed militant commander.", "true"],
        ["CR-EXC-603", "P602", CASE_ID, "2025-11-20", "Active Warrant",
         "European Arrest Warrant issued by French and Italian counter-terrorism magistrates for Noura Al-Fassi for international kidnapping.", "true"],
        ["CR-EXC-604", "P603", CASE_ID, "2026-01-14", "Active Charge-Sheet",
         "US DOJ and Turkish Banking Regulatory prosecution against Baykan Lannak for illicit foreign corrupt payments and bridge kickbacks.", "true"],
        ["CR-EXC-605", "P608", CASE_ID, "2026-02-18", "Non-Bailable Warrant",
         "High Court warrant issued for Tariq Ben-Zaid for treason, ambush conspiracy, and murder of convoy security detail.", "true"],
        ["CR-EXC-606", "P604", CASE_ID, "2026-06-04", "Witness Deposition",
         "FBI Hostage Recovery Fusion Cell witness deposition provided under oath by partner Mitchell McDeere.", "true"],
        ["CR-EXC-607", "P605", CASE_ID, "2026-06-10", "Victim Incident Memo",
         "US Embassy and Italian Consulate forensic incident report documenting the abduction and medical clearance of attorney Giovanna Sandroni.", "true"],
    ]
    with open(DATASET_DIR / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["record_id", "person_id", "case_id", "record_date", "record_status", "text", "synthetic"])
        w.writerows(crimes)
    print("  [Created] crime_records.csv")

    # 4. Telecom CDR Intercepts (CSV)
    cdrs = [
        ["CDR-EXC-601", "P601", "P602", "2026-06-03T00:30:00+00:00", 540, "true"],
        ["CDR-EXC-602", "P601", "P608", "2026-06-03T00:50:00+00:00", 380, "true"],
        ["CDR-EXC-603", "P602", "P606", "2026-06-03T01:10:00+00:00", 195, "true"],
        ["CDR-EXC-604", "P603", "P602", "2026-06-03T01:40:00+00:00", 310, "true"],
        ["CDR-EXC-605", "P601", "P603", "2026-06-03T02:20:00+00:00", 420, "true"],
        ["CDR-EXC-606", "P604", "P607", "2026-06-03T08:00:00+00:00", 610, "true"],
    ]
    with open(DATASET_DIR / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["record_id", "caller_person_id", "callee_person_id", "start_time", "duration_seconds", "synthetic"])
        w.writerows(cdrs)
    print("  [Created] telecom_cdr.csv")

    # 5. Raw Complaint (Zero-Shot Text Intake)
    complaint_text = (
        "UNITED STATES DEPARTMENT OF JUSTICE // NATIONAL SECURITY DIVISION\n"
        "MEMORANDUM OF INVESTIGATION: THE LIBYAN AMBUSH & TRANSNATIONAL EXTORTION CONSPIRACY\n\n"
        "TARGET: MUSTAFA AL-KHATIB [ID:P601] (OPERATIONAL ALIAS: COMMANDER MUSTAFA)\n"
        "CO-CONSPIRATORS: NOURA AL-FASSI [ID:P602], BAYKAN LANNAK [ID:P603], TARIQ BEN-ZAID [ID:P608]\n"
        "VICTIM: GIOVANNA SANDRONI [ID:P605], ASSOCIATE ATTORNEY, SCULLY & PERSHING LLP\n\n"
        "1. PROBABLE CAUSE STATEMENT:\n"
        "Between June 1, 2026 and June 15, 2026, an armed transnational syndicate led by Mustafa Al-Khatib [ID:P601] "
        "executed a military-grade ambush near the Great Gaddafi Bridge outside Tripoli, Libya. Gunmen disguised as "
        "Libyan national guards ambushed the inspection convoy, executing the private security contractors and abducting "
        "American and Italian national Giovanna Sandroni [ID:P605].\n\n"
        "2. EXTORTION & DEMAND COMMUNICATION:\n"
        "A video transmission delivered to the family and firm demanded $100,000,000 in clean US Dollars. Communications "
        "were coordinated by Noura Al-Fassi [ID:P602] using encrypted satellite terminals to contact Abby McDeere [ID:P606] "
        "in New York. The syndicate instructed funds to be wired into Lannak Construction's Geneva escrow account "
        "[010 / ACC-LANNAK-GENEVA], controlled by Turkish national Baykan Lannak [ID:P603].\n\n"
        "3. FINANCIAL LAUNDERING TRAIL:\n"
        "Subpoenaed banking records confirm $100,000,000 was moved from Scully & Pershing's New York escrow into Geneva, "
        "instantly split and transferred through Tangier into Libyan accounts [010 / ACC-KHATIB-LIBYA-TRIPOLI], "
        "and funneled into Sahara Holdings [010 / ACC-SAHARA-HOLDINGS], before being layered into Mediterranean trusts."
    )
    (DATASET_DIR / "raw_hostage_complaint.txt").write_text(complaint_text, encoding="utf-8")
    print("  [Created] raw_hostage_complaint.txt")


def ingest_into_maha():
    print(f"\nIngesting novel evidence into Vritra ledger under '{CASE_ID}'...")
    store = Store()
    store.reset_case(CASE_ID)

    # Ensure case exists
    with store.db() as db:
        db.execute("INSERT OR IGNORE INTO cases(id, closed_at) VALUES (?, NULL)", (CASE_ID,))
        # Grant CASE-THE-EXCHANGE to investigator and restricted users
        for user in ('investigator', 'restricted'):
            row = db.execute("SELECT cases FROM users WHERE name=?", (user,)).fetchone()
            if row:
                cases = json.loads(row[0])
                if CASE_ID not in cases:
                    cases.append(CASE_ID)
                    db.execute("UPDATE users SET cases=? WHERE name=?", (json.dumps(cases), user))

    # Ingest Court
    court_bytes = (DATASET_DIR / "court_proceedings.json").read_bytes()
    r1 = store.import_records("court_proceedings_exchange.json", court_bytes, "court-proceedings", True,
                              CASE_ID, narrative_records(court_bytes), "exchange-builder")
    print(f"  [OK] Ingested Court Orders: {r1.get('rows_seen', 0)} facts.")

    # Ingest Crime
    crime_bytes = (DATASET_DIR / "crime_records.csv").read_bytes()
    r2 = store.import_records("crime_records_exchange.csv", crime_bytes, "crime-registry", True,
                              CASE_ID, history_records(crime_bytes, CASE_ID), "exchange-builder")
    print(f"  [OK] Ingested Crime Records: {r2.get('rows_seen', 0)} records.")

    # Ingest Telecom
    cdr_bytes = (DATASET_DIR / "telecom_cdr.csv").read_bytes()
    r3 = store.import_records("telecom_cdr_exchange.csv", cdr_bytes, "cdr-records", True,
                              CASE_ID, cdr_records(cdr_bytes), "exchange-builder")
    print(f"  [OK] Ingested Telecom CDR: {r3.get('rows_seen', 0)} calls.")

    # Ingest Financial Wires
    wires_bytes = (DATASET_DIR / "financial_wires.csv").read_bytes()
    r4 = store.import_records("financial_wires_exchange.csv", wires_bytes, "financial-wires", True,
                              CASE_ID, ibm_records(wires_bytes), "exchange-builder")
    print(f"  [OK] Ingested Financial Wires: {r4.get('rows_seen', 0)} transactions.")

    print(f"\nSuccessfully populated case '{CASE_ID}' with John Grisham's 'The Exchange' evidence!")


if __name__ == "__main__":
    generate_files()
    ingest_into_maha()
