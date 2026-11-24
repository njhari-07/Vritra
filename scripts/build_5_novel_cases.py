"""Builder and Loader for 5 Multi-Modal Case Datasets derived from Classic Investigative Novels.
Cases created:
  1. CASE-VALLEY-FEAR   : The Valley of Fear (Moriarty Syndicate & Scowrers Extortion Network)
  2. CASE-RED-LEAGUE    : The Red-Headed League (City & Suburban Bank Bullion Vault Tunneling)
  3. CASE-MONTE-CRISTO  : The Count of Monte Cristo (Danglars Bank Forged Credit & Market Manipulation)
  4. CASE-BERYL-CORONET : The Beryl Coronet (Holder & Stevenson Banking Collateral Embezzlement)
  5. CASE-BLUE-CARBUNCLE: The Blue Carbuncle (Hotel Cosmopolitan Gem Burglary & Fencing Ring)

Each case contains all 4 strictly interconnected modalities:
  - court_proceedings.json
  - financial_wires.csv
  - crime_records.csv
  - telecom_cdr.csv
  - raw_police_inquest.txt
"""
import csv
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from maha.store import Store
from maha.ingestion import ibm_records, narrative_records, cdr_records, history_records

CASES_DIR = REPO_ROOT / "data/novel_cases"
CASES_DIR.mkdir(parents=True, exist_ok=True)


def build_case_1():
    cid = "CASE-VALLEY-FEAR"
    cdir = CASES_DIR / "case_1_valley_of_fear"
    cdir.mkdir(exist_ok=True)
    base_t = datetime(2026, 5, 2, 1, 0)

    # 1. Court
    court = [{
        "document_id": "CR-COURT-VOF-01", "case_id": cid, "filed_date": "2026-05-10", "synthetic": True,
        "text": (
            "IN THE SPECIAL ASSIZES COURT OF SUSSEX // INQUEST INTO BIRLSTONE MANOR HOMICIDE.\n"
            "1. Person James Moriarty [ID:P501] is named as Prime Syndicate Controller in this case.\n"
            "2. Person James Moriarty [ID:P501] owns account [Bank:010; Account:ACC-MORIARTY-LDN].\n"
            "3. Charges framed under Section 120B (Criminal Conspiracy) and Section 302 (Murder) for funding contract killings.\n"
            "4. Person Boss McGinty [ID:P502] is named as Bodymaster Extortion Organizer in this case.\n"
            "5. Person Boss McGinty [ID:P502] owns account [Bank:010; Account:ACC-SCOWRERS-VALLEY].\n"
            "6. Person Ted Baldwin [ID:P503] is named as Co-Accused and syndicate hitman.\n"
            "7. Person Ted Baldwin [ID:P503] owns account [Bank:010; Account:ACC-BALDWIN-POOL].\n"
            "8. Person John Douglas [ID:P504] owns account [Bank:010; Account:ACC-DOUGLAS-BIRLSTONE] and is referenced as the primary target.\n"
            "9. Person Alec MacDonald [ID:P505] is referenced in this case as a witness and Scotland Yard investigating officer.\n"
            "10. Evidence confirms Accused P501 structured $400,000 in extortion proceeds from Account 010 / ACC-SCOWRERS-VALLEY into London investments."
        )
    }]
    (cdir / "court_proceedings.json").write_text(json.dumps(court, indent=2), encoding="utf-8")

    # 2. Wires (10 daylight + 6 nocturnal loop)
    wires = [
        # Normal
        ["2026/05/01 09:30", "010", "ACC-ESTATE-RENT-1", "010", "ACC-DOUGLAS-BIRLSTONE", "12000.00", "US Dollar", "12000.00", "US Dollar", "Wire", "0"],
        ["2026/05/01 11:00", "010", "ACC-DOUGLAS-BIRLSTONE", "010", "ACC-FARM-SUPPLIES", "4500.00", "US Dollar", "4500.00", "US Dollar", "Cheque", "0"],
        ["2026/05/01 14:15", "010", "ACC-ESTATE-RENT-2", "010", "ACC-DOUGLAS-BIRLSTONE", "9800.00", "US Dollar", "9800.00", "US Dollar", "Wire", "0"],
        ["2026/05/01 15:45", "010", "ACC-DOUGLAS-BIRLSTONE", "010", "ACC-LOCAL-SERVICES", "3100.00", "US Dollar", "3100.00", "US Dollar", "ACH", "0"],
        # Nocturnal 3-Hop Loop: Moriarty -> McGinty -> Baldwin -> Moriarty Reinvestment
        ["2026/05/02 01:15", "010", "ACC-MORIARTY-LDN", "010", "ACC-SCOWRERS-VALLEY", "400000.00", "US Dollar", "400000.00", "US Dollar", "Wire", "1"],
        ["2026/05/02 02:00", "010", "ACC-SCOWRERS-VALLEY", "010", "ACC-BALDWIN-POOL", "392000.00", "US Dollar", "392000.00", "US Dollar", "ACH", "1"],
        ["2026/05/02 02:45", "010", "ACC-BALDWIN-POOL", "010", "ACC-MORIARTY-LDN", "385000.00", "US Dollar", "385000.00", "US Dollar", "Reinvestment", "1"],
        ["2026/05/02 03:30", "010", "ACC-SCOWRERS-VALLEY", "010", "ACC-HITMAN-ESCAPE", "35000.00", "US Dollar", "35000.00", "US Dollar", "Wire", "1"],
    ]
    with open(cdir / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"]); w.writerows(wires)

    # 3. Crime
    crimes = [
        ["CR-VOF-501", "P501", cid, "2024-08-11", "Special Syndicate Warning", "Scotland Yard Special Branch Dossier on James Moriarty as master architect of London criminal underworld.", "true"],
        ["CR-VOF-502", "P502", cid, "2025-01-20", "Active Charge-Sheet", "Vermissa Valley Grand Jury indictment for coal cartel extortion and armed intimidation.", "true"],
        ["CR-VOF-503", "P503", cid, "2025-06-14", "Non-Bailable Warrant", "Arrest warrant issued for Ted Baldwin following armed assault and absconding bail.", "true"],
        ["CR-VOF-504", "P501", cid, "2026-03-10", "Look Out Circular", "Border surveillance alert for confederates traveling between Southampton and Pennsylvania.", "true"],
    ]
    with open(cdir / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"]); w.writerows(crimes)

    # 4. CDR (Timed 15 min prior to wires)
    cdrs = [
        ["CDR-VOF-501", "P501", "P502", "2026-05-02T01:00:00+00:00", 350, "true"],
        ["CDR-VOF-502", "P502", "P503", "2026-05-02T01:45:00+00:00", 280, "true"],
        ["CDR-VOF-503", "P503", "P501", "2026-05-02T02:30:00+00:00", 310, "true"],
        ["CDR-VOF-504", "P504", "P505", "2026-05-02T04:15:00+00:00", 420, "true"],
    ]
    with open(cdir / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"]); w.writerows(cdrs)

    return cid, cdir


def build_case_2():
    cid = "CASE-RED-LEAGUE"
    cdir = CASES_DIR / "case_2_red_headed_league"
    cdir.mkdir(exist_ok=True)

    # 1. Court
    court = [{
        "document_id": "CR-COURT-RHL-01", "case_id": cid, "filed_date": "2026-05-15", "synthetic": True,
        "text": (
            "CENTRAL CRIMINAL COURT, OLD BAILEY // THE KING v. JOHN CLAY & DUNCAN ROSS.\n"
            "1. Person John Clay [ID:P511] is named as Prime Accused and mastermind of the subterranean vault intrusion.\n"
            "2. Person John Clay [ID:P511] owns account [Bank:010; Account:ACC-CLAY-DISGUISE].\n"
            "3. Charges framed under Section 420 (Cheating by Impersonation) and Section 457 (Lurking House-Trespass by Night for Bank Burglary).\n"
            "4. Person Duncan Ross [ID:P512] is named as Co-Accused and manager of the dummy Red-Headed League office.\n"
            "5. Person Duncan Ross [ID:P512] owns account [Bank:010; Account:ACC-REDLEAGUE-OFFICE].\n"
            "6. Person Jabez Wilson [ID:P513] is referenced in this case as an exploited pawn and witness.\n"
            "7. Person Jabez Wilson [ID:P513] owns account [Bank:010; Account:ACC-PAWNSHOP-WILSON].\n"
            "8. Person Peter Jones [ID:P515] is referenced as a witness and official police inspector of Scotland Yard.\n"
            "9. Prosecution proves Accused P511 wired $180,000 in French gold coins from Account 010 / ACC-CLAY-DISGUISE into Account 010 / ACC-REDLEAGUE-OFFICE to finance tunneling operations."
        )
    }]
    (cdir / "court_proceedings.json").write_text(json.dumps(court, indent=2), encoding="utf-8")

    # 2. Wires (Daylight shop + Nocturnal Tunneling Loop)
    wires = [
        ["2026/05/03 10:15", "010", "ACC-CLIENT-PLEDGE-1", "010", "ACC-PAWNSHOP-WILSON", "150.00", "US Dollar", "150.00", "US Dollar", "Cheque", "0"],
        ["2026/05/03 12:30", "010", "ACC-CLIENT-PLEDGE-2", "010", "ACC-PAWNSHOP-WILSON", "450.00", "US Dollar", "450.00", "US Dollar", "Wire", "0"],
        ["2026/05/03 14:00", "010", "ACC-PAWNSHOP-WILSON", "010", "ACC-SHOP-RENT", "800.00", "US Dollar", "800.00", "US Dollar", "ACH", "0"],
        # Nocturnal Vault Loot Smurfing Loop: Clay -> Red League Office -> Smelter Front -> Clay
        ["2026/05/04 01:10", "010", "ACC-CLAY-DISGUISE", "010", "ACC-REDLEAGUE-OFFICE", "180000.00", "US Dollar", "180000.00", "US Dollar", "Wire", "1"],
        ["2026/05/04 01:50", "010", "ACC-REDLEAGUE-OFFICE", "010", "ACC-SMELTER-BULLION", "176400.00", "US Dollar", "176400.00", "US Dollar", "ACH", "1"],
        ["2026/05/04 02:40", "010", "ACC-SMELTER-BULLION", "010", "ACC-CLAY-DISGUISE", "173000.00", "US Dollar", "173000.00", "US Dollar", "Reinvestment", "1"],
        ["2026/05/04 03:15", "010", "ACC-CLAY-DISGUISE", "010", "ACC-PAWNSHOP-WILSON", "2400.00", "US Dollar", "2400.00", "US Dollar", "ACH", "0"],
    ]
    with open(cdir / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"]); w.writerows(wires)

    # 3. Crimes
    crimes = [
        ["CR-RHL-511", "P511", cid, "2023-04-18", "Prior Felony Conviction", "Scotland Yard record for royal jewel theft and forging of railway bonds.", "true"],
        ["CR-RHL-512", "P511", cid, "2024-09-02", "Look Out Circular", "Special surveillance notice for John Clay operating under alias Vincent Spaulding.", "true"],
        ["CR-RHL-513", "P512", cid, "2025-03-12", "Active Charge-Sheet", "City of London Police charge-sheet for leasing commercial suites under fraudulent charters.", "true"],
    ]
    with open(cdir / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"]); w.writerows(crimes)

    # 4. CDR
    cdrs = [
        ["CDR-RHL-511", "P511", "P512", "2026-05-04T00:55:00+00:00", 260, "true"],
        ["CDR-RHL-512", "P512", "P511", "2026-05-04T01:35:00+00:00", 310, "true"],
        ["CDR-RHL-513", "P513", "P515", "2026-05-04T03:30:00+00:00", 450, "true"],
    ]
    with open(cdir / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"]); w.writerows(cdrs)

    return cid, cdir


def build_case_3():
    cid = "CASE-MONTE-CRISTO"
    cdir = CASES_DIR / "case_3_monte_cristo"
    cdir.mkdir(exist_ok=True)

    # 1. Court
    court = [{
        "document_id": "CR-COURT-CMC-01", "case_id": cid, "filed_date": "2026-05-20", "synthetic": True,
        "text": (
            "COMMERCIAL TRIBUNAL & BANKRUPTCY COURT OF PARIS // BANQUE DANGLARS LIQUIDATION PROCEEDINGS.\n"
            "1. Person Baron Danglars [ID:P521] is named as Prime Accused in fraudulent bankruptcy and securities manipulation.\n"
            "2. Person Baron Danglars [ID:P521] owns account [Bank:010; Account:ACC-BANQUE-DANGLARS].\n"
            "3. Charges framed under Articles 405 & 408 French Penal Code (Swindling and Criminal Breach of Trust).\n"
            "4. Person Edmond Dantes [ID:P522] is named as the Count of Monte Cristo and beneficial owner of credit bonds.\n"
            "5. Person Edmond Dantes [ID:P522] owns account [Bank:010; Account:ACC-THOMSON-FRENCH].\n"
            "6. Person Gerard de Villefort [ID:P523] is named as Crown Prosecutor indicted for concealing judicial treason.\n"
            "7. Person Gerard de Villefort [ID:P523] owns account [Bank:010; Account:ACC-VILLEFORT-PROC].\n"
            "8. Person Lucien Debray [ID:P525] owns account [Bank:010; Account:ACC-MINISTRY-INSIDER] and operated insider telegraph signals.\n"
            "9. Evidence confirms Accused P521 diverted $950,000 from Account 010 / ACC-BANQUE-DANGLARS through telegraphic insider manipulation before attempting flight to Rome."
        )
    }]
    (cdir / "court_proceedings.json").write_text(json.dumps(court, indent=2), encoding="utf-8")

    # 2. Wires (Paris banking routine + Multi-Hop Danglars Run)
    wires = [
        ["2026/05/05 09:15", "010", "ACC-PARIS-COMMERCE-1", "010", "ACC-BANQUE-DANGLARS", "45000.00", "US Dollar", "45000.00", "US Dollar", "Wire", "0"],
        ["2026/05/05 11:30", "010", "ACC-PARIS-COMMERCE-2", "010", "ACC-BANQUE-DANGLARS", "62000.00", "US Dollar", "62000.00", "US Dollar", "Wire", "0"],
        ["2026/05/05 14:00", "010", "ACC-BANQUE-DANGLARS", "010", "ACC-PARIS-CLEARING", "35000.00", "US Dollar", "35000.00", "US Dollar", "ACH", "0"],
        # Nocturnal Telegraph Insider & Drain Loop: Danglars -> Insider -> Thomson French -> Danglars Drain
        ["2026/05/06 01:20", "010", "ACC-BANQUE-DANGLARS", "010", "ACC-MINISTRY-INSIDER", "950000.00", "US Dollar", "950000.00", "US Dollar", "Wire", "1"],
        ["2026/05/06 02:05", "010", "ACC-MINISTRY-INSIDER", "010", "ACC-THOMSON-FRENCH", "931000.00", "US Dollar", "931000.00", "US Dollar", "ACH", "1"],
        ["2026/05/06 02:50", "010", "ACC-THOMSON-FRENCH", "010", "ACC-BANQUE-DANGLARS", "912000.00", "US Dollar", "912000.00", "US Dollar", "Reinvestment", "1"],
        ["2026/05/06 03:40", "010", "ACC-BANQUE-DANGLARS", "010", "ACC-ROME-BANDITS", "150000.00", "US Dollar", "150000.00", "US Dollar", "Wire", "1"],
    ]
    with open(cdir / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"]); w.writerows(wires)

    # 3. Crimes
    crimes = [
        ["CR-CMC-521", "P521", cid, "2024-05-14", "Fraudulent Bankruptcy Indictment", "Tribunal de Commerce arrest warrant for embezzling hospital charity trust reserves.", "true"],
        ["CR-CMC-522", "P521", cid, "2024-11-20", "Look Out Circular", "Border surveillance issued at Italian and Austrian frontier checkpoints.", "true"],
        ["CR-CMC-523", "P523", cid, "2025-02-18", "Judicial Corruption Inquiry", "High Court of Justice investigation into unlawful imprisonment of political prisoners.", "true"],
    ]
    with open(cdir / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"]); w.writerows(crimes)

    # 4. CDR
    cdrs = [
        ["CDR-CMC-521", "P521", "P525", "2026-05-06T01:05:00+00:00", 390, "true"],
        ["CDR-CMC-522", "P525", "P522", "2026-05-06T01:50:00+00:00", 270, "true"],
        ["CDR-CMC-523", "P522", "P521", "2026-05-06T02:35:00+00:00", 440, "true"],
    ]
    with open(cdir / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"]); w.writerows(cdrs)

    return cid, cdir


def build_case_4():
    cid = "CASE-BERYL-CORONET"
    cdir = CASES_DIR / "case_4_beryl_coronet"
    cdir.mkdir(exist_ok=True)

    # 1. Court
    court = [{
        "document_id": "CR-COURT-BC-01", "case_id": cid, "filed_date": "2026-05-25", "synthetic": True,
        "text": (
            "BOW STREET MAGISTRATES COURT // COMMITTAL PROCEEDINGS FOR NOBLE COLLATERAL LARCENY.\n"
            "1. Person George Burnwell [ID:P531] is named as Prime Accused and high-society gambler.\n"
            "2. Person George Burnwell [ID:P531] owns account [Bank:010; Account:ACC-BURNWELL-GAMBLING].\n"
            "3. Charges framed under Larceny Act Section 20 (Theft of Pledged Security) and Conspiracy to Defraud.\n"
            "4. Person Alexander Holder [ID:P532] is named as Senior Partner of Holder & Stevenson Banking Firm.\n"
            "5. Person Alexander Holder [ID:P532] owns account [Bank:010; Account:ACC-HOLDER-BANKING].\n"
            "6. Person Arthur Holder [ID:P533] is named as Son and Co-Accused wrongly implicated in theft.\n"
            "7. Person Arthur Holder [ID:P533] owns account [Bank:010; Account:ACC-ARTHUR-CLUB].\n"
            "8. Person Mary Holder [ID:P534] owns account [Bank:010; Account:ACC-MARY-COVERT] and acted as secret confederate of Burnwell.\n"
            "9. Prosecution establishes that Accused P531 seduced and conspired with Mary Holder to steal the £50,000 Beryl Coronet pledged by an illustrious client, wiring $220,000 through gaming conduits."
        )
    }]
    (cdir / "court_proceedings.json").write_text(json.dumps(court, indent=2), encoding="utf-8")

    # 2. Wires
    wires = [
        ["2026/05/07 09:30", "010", "ACC-ARISTO-CLIENT", "010", "ACC-HOLDER-BANKING", "50000.00", "US Dollar", "50000.00", "US Dollar", "Wire", "0"],
        ["2026/05/07 11:45", "010", "ACC-HOLDER-BANKING", "010", "ACC-CITY-DISCOUNT", "35000.00", "US Dollar", "35000.00", "US Dollar", "Wire", "0"],
        ["2026/05/07 14:00", "010", "ACC-HOLDER-BANKING", "010", "ACC-ARTHUR-CLUB", "5000.00", "US Dollar", "5000.00", "US Dollar", "ACH", "0"],
        # Nocturnal Burnwell Gambling Layering Loop
        ["2026/05/08 01:15", "010", "ACC-HOLDER-BANKING", "010", "ACC-MARY-COVERT", "220000.00", "US Dollar", "220000.00", "US Dollar", "Wire", "1"],
        ["2026/05/08 02:00", "010", "ACC-MARY-COVERT", "010", "ACC-BURNWELL-GAMBLING", "215600.00", "US Dollar", "215600.00", "US Dollar", "ACH", "1"],
        ["2026/05/08 02:45", "010", "ACC-BURNWELL-GAMBLING", "010", "ACC-HOLDER-BANKING", "211200.00", "US Dollar", "211200.00", "US Dollar", "Reinvestment", "1"],
    ]
    with open(cdir / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"]); w.writerows(wires)

    # 3. Crimes
    crimes = [
        ["CR-BC-531", "P531", cid, "2024-02-19", "Arrest Warrant", "Bow Street Warrant for defaulting on £40,000 illegal hazard betting syndicates.", "true"],
        ["CR-BC-532", "P531", cid, "2024-07-28", "Look Out Circular", "Scotland Yard surveillance circular at Dover and Folkestone Continental packet ports.", "true"],
    ]
    with open(cdir / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"]); w.writerows(crimes)

    # 4. CDR
    cdrs = [
        ["CDR-BC-531", "P532", "P534", "2026-05-08T01:00:00+00:00", 310, "true"],
        ["CDR-BC-532", "P534", "P531", "2026-05-08T01:45:00+00:00", 420, "true"],
        ["CDR-BC-533", "P531", "P532", "2026-05-08T02:30:00+00:00", 250, "true"],
    ]
    with open(cdir / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"]); w.writerows(cdrs)

    return cid, cdir


def build_case_5():
    cid = "CASE-BLUE-CARBUNCLE"
    cdir = CASES_DIR / "case_5_blue_carbuncle"
    cdir.mkdir(exist_ok=True)

    # 1. Court
    court = [{
        "document_id": "CR-COURT-BCB-01", "case_id": cid, "filed_date": "2026-05-28", "synthetic": True,
        "text": (
            "MARLBOROUGH STREET POLICE COURT // SUMMARY COMMITTAL FOR JEWEL LARCENY & PERJURY.\n"
            "1. Person James Ryder [ID:P541] is named as Prime Accused and head attendant of Hotel Cosmopolitan.\n"
            "2. Person James Ryder [ID:P541] owns account [Bank:010; Account:ACC-RYDER-HOTEL].\n"
            "3. Charges framed under Larceny Act (Theft of Countess of Morcar's Blue Carbuncle Gemstone) and Section 193 IPC equivalent (False Evidence).\n"
            "4. Person Catherine Cusack [ID:P542] is named as Co-Accused and Countess's confidential maid.\n"
            "5. Person Catherine Cusack [ID:P542] owns account [Bank:010; Account:ACC-CUSACK-MAID].\n"
            "6. Person John Horner [ID:P543] is referenced as innocent plumber falsely framed by Ryder.\n"
            "7. Person John Horner [ID:P543] owns account [Bank:010; Account:ACC-HORNER-PLUMBING].\n"
            "8. Person Henry Baker [ID:P544] is referenced in this case as an innocent witness.\n"
            "9. Evidence proves Accused P541 wired $120,000 in gem fencing kickbacks into Account 010 / ACC-CUSACK-MAID after secreting the gem inside market livestock."
        )
    }]
    (cdir / "court_proceedings.json").write_text(json.dumps(court, indent=2), encoding="utf-8")

    # 2. Wires
    wires = [
        ["2026/05/09 09:15", "010", "ACC-HOTEL-GUEST-1", "010", "ACC-RYDER-HOTEL", "250.00", "US Dollar", "250.00", "US Dollar", "Cheque", "0"],
        ["2026/05/09 11:30", "010", "ACC-HOTEL-GUEST-2", "010", "ACC-RYDER-HOTEL", "500.00", "US Dollar", "500.00", "US Dollar", "Wire", "0"],
        ["2026/05/09 14:00", "010", "ACC-RYDER-HOTEL", "010", "ACC-HORNER-PLUMBING", "75.00", "US Dollar", "75.00", "US Dollar", "ACH", "0"],
        # Nocturnal Gem Fencing Payoff Loop
        ["2026/05/10 01:15", "010", "ACC-RYDER-HOTEL", "010", "ACC-CUSACK-MAID", "120000.00", "US Dollar", "120000.00", "US Dollar", "Wire", "1"],
        ["2026/05/10 02:00", "010", "ACC-CUSACK-MAID", "010", "ACC-FENCE-KILBURN", "117600.00", "US Dollar", "117600.00", "US Dollar", "ACH", "1"],
        ["2026/05/10 02:45", "010", "ACC-FENCE-KILBURN", "010", "ACC-RYDER-HOTEL", "115200.00", "US Dollar", "115200.00", "US Dollar", "Reinvestment", "1"],
    ]
    with open(cdir / "financial_wires.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["Timestamp","From Bank","Account","To Bank","Account","Amount Received","Receiving Currency","Amount Paid","Payment Currency","Payment Format","Is Laundering"]); w.writerows(wires)

    # 3. Crimes
    crimes = [
        ["CR-BCB-541", "P541", cid, "2024-11-05", "Active Charge-Sheet", "Metropolitan Police charge for aggravated grand larceny of registered crown jewel.", "true"],
        ["CR-BCB-542", "P543", cid, "2021-06-12", "Prior Acquittal Record", "Prior bar conviction record used by Ryder to falsely shift suspicion onto Horner.", "true"],
    ]
    with open(cdir / "crime_records.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","person_id","case_id","record_date","record_status","text","synthetic"]); w.writerows(crimes)

    # 4. CDR
    cdrs = [
        ["CDR-BCB-541", "P541", "P542", "2026-05-10T01:00:00+00:00", 340, "true"],
        ["CDR-BCB-542", "P542", "P541", "2026-05-10T01:45:00+00:00", 280, "true"],
        ["CDR-BCB-543", "P541", "P544", "2026-05-10T02:30:00+00:00", 190, "true"],
    ]
    with open(cdir / "telecom_cdr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["record_id","caller_person_id","callee_person_id","start_time","duration_seconds","synthetic"]); w.writerows(cdrs)

    return cid, cdir


def main():
    store = Store()
    builders = [build_case_1, build_case_2, build_case_3, build_case_4, build_case_5]
    all_cids = []

    for builder in builders:
        cid, cdir = builder()
        all_cids.append(cid)
        print(f"\n---> Ingesting '{cid}' into Vritra evidence store...")
        store.reset_case(cid)

        # Ensure case exists in ledger
        with store.db() as db:
            db.execute("INSERT OR IGNORE INTO cases(id, closed_at) VALUES (?, NULL)", (cid,))

        # Ingest Court
        c_bytes = (cdir / "court_proceedings.json").read_bytes()
        r1 = store.import_records(f"court-{cid}.json", c_bytes, "court-proceedings", True,
                                  cid, narrative_records(c_bytes), "novel-builder")
        print(f"  [OK] Court Orders: {r1.get('rows_seen', 0)} facts.")

        # Ingest Crimes
        cr_bytes = (cdir / "crime_records.csv").read_bytes()
        r2 = store.import_records(f"crime-{cid}.csv", cr_bytes, "crime-registry", True,
                                  cid, history_records(cr_bytes, cid), "novel-builder")
        print(f"  [OK] Crime Records: {r2.get('rows_seen', 0)} records.")

        # Ingest Telecom
        cdr_bytes = (cdir / "telecom_cdr.csv").read_bytes()
        r3 = store.import_records(f"cdr-{cid}.csv", cdr_bytes, "cdr-records", True,
                                  cid, cdr_records(cdr_bytes), "novel-builder")
        print(f"  [OK] Telecom CDR: {r3.get('rows_seen', 0)} calls.")

        # Ingest Wires
        w_bytes = (cdir / "financial_wires.csv").read_bytes()
        r4 = store.import_records(f"wires-{cid}.csv", w_bytes, "financial-wires", True,
                                  cid, ibm_records(w_bytes), "novel-builder")
        print(f"  [OK] Financial Wires: {r4.get('rows_seen', 0)} transactions.")

    # Grant all 5 cases to investigator and restricted
    with store.db() as db:
        for u in ("investigator", "restricted"):
            row = db.execute("SELECT cases FROM users WHERE name=?", (u,)).fetchone()
            if row:
                cases = json.loads(row[0])
                for cid in all_cids:
                    if cid not in cases:
                        cases.append(cid)
                db.execute("UPDATE users SET cases=? WHERE name=?", (json.dumps(cases), u))

    print(f"\n========================================================")
    print(f"Successfully generated and ingested all 5 Novel Cases:")
    for cid in all_cids:
        print(f"  * {cid}")
    print(f"All cases are now authorized for 'investigator' in the UI!")
    print(f"========================================================")


if __name__ == "__main__":
    main()
