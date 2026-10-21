# Multi-Modal Synthetic Investigation Datasets

This directory contains a complete, interconnected synthetic benchmark dataset designed to evaluate the MAHA multi-modal intelligence and anti-money laundering (AML) graph models.

---

## 📁 Included Datasets

| File Name | Modality | Format | Description |
| :--- | :--- | :--- | :--- |
| **[`court_proceedings_sample.json`](file:///d:/Vritra-master/data/sample_datasets/court_proceedings_sample.json)** | Judicial Orders & Court Hearings | JSON | Special PMLA Court charges (Sec 3 & 4 PMLA, IPC 420/120B), High Court bail rejection orders, and Sec 164 CrPC witness depositions. |
| **[`financial_wires_sample.csv`](file:///d:/Vritra-master/data/sample_datasets/financial_wires_sample.csv)** | Banking & Financial Transactions | CSV (IBM format) | Closed 3-hop layering cycle (`ACC-MALHOTRA-771 ➔ ACC-AGARWAL-882 ➔ ACC-APEXSHELL-993 ➔ ACC-MALHOTRA-771`) and nocturnal wire structuring. |
| **[`crime_records_sample.csv`](file:///d:/Vritra-master/data/sample_datasets/crime_records_sample.csv)** | Police FIR & Crime Registry | CSV | Police history sheets, Economic Offenses Wing (EOW) FIRs, Non-Bailable Warrants (NBW), Look-Out Circulars (LOC), and MCA ROC director disqualifications. |
| **[`telecom_cdr_sample.csv`](file:///d:/Vritra-master/data/sample_datasets/telecom_cdr_sample.csv)** | Telecom Call Detail Records (CDR) | CSV | Phone call logs connecting the prime accused, mule coordinators, and shell directors synchronized 10 minutes prior to nocturnal fund transfers. |
| **[`raw_police_fir_sample.txt`](file:///d:/Vritra-master/data/sample_datasets/raw_police_fir_sample.txt)** | Unstructured Free-Text FIR Document | TXT | Raw unformatted police complaint for testing the Zero-Shot NLP NER extractor without requiring JSON conversion. |

---

## 🎯 Case Narrative: Operation "Zenith Healthcare Syndicate"

1. **Prime Accused (`P101` / Vikram Malhotra):**
   - Orchestrated public healthcare tender rigging ($750,000 USD).
   - Indicted under Section 3 & 4 PMLA, Section 420 IPC, and Section 120B IPC.
   - Active Look-Out Circular (LOC) issued at all international airports.
   - Master account: `010 / ACC-MALHOTRA-771`.

2. **Hawala Mule Coordinator (`P102` / Sanjay Agarwal):**
   - Receives rapid high-value wires from `ACC-MALHOTRA-771` and routes them into shell conduits.
   - Non-Bailable Arrest Warrant (NBW) active for evading summons.
   - Mule account: `010 / ACC-AGARWAL-882`.

3. **Shell Entity Dummy Director (`P103` / Karan Singhania):**
   - Disqualified as director under Section 164(2) Companies Act for managing 5 paper shell companies.
   - Conduit account: `010 / ACC-APEXSHELL-993`.

4. **Crypto Off-Ramp Operator (`P104` / Rohit Verma):**
   - Receives nocturnal disbursements for peer-to-peer crypto liquidation.
   - Summons active under Section 91 CrPC by Cyber Crime Investigation Cell.
   - Account: `010 / ACC-VERMA-104`.

5. **Whistleblower / Procurement Auditor (`P105` / Meera Kapoor):**
   - Prosecution witness who produced encrypted server logs demonstrating nocturnal transfer coordination.

---

## 🚀 How to Ingest & Test

### Option 1: One-Click Automated Script (Recommended)
Run the automated loader script to create a fresh case, import all 4 datasets, train the ML models, and display suspect ranking dossiers:

```bash
python scripts/load_sample_dataset.py --case CASE-2026-TEST
```

### Option 2: Through the Web Workspace UI (`http://localhost:5173`)
1. Open **`http://localhost:5173/`** in your browser.
2. Under **Case Management**, click **`+ New Case`** and name it (e.g. `CASE-2026-TEST`).
3. Under **Section 2: Multi-Modal Data Intake**:
   - **Upload Court Narrative:** Select `court_proceedings_sample.json` into the *Court Proceedings* card.
   - **Upload Financial CSV:** Select `financial_wires_sample.csv` into the *IBM HI-Small* card.
   - **Upload Crime Registry:** Select `crime_records_sample.csv` into the *Crime Registry* card.
   - **Upload Telecom CDR:** Select `telecom_cdr_sample.csv` into the *Telecom CDR* card.
   - **Or Paste Raw Text:** Copy and paste `raw_police_fir_sample.txt` into the *Raw Free-Text FIR Ingestor* card and click `⚡ Parse & Ingest with Zero-Shot NLP`.
4. Click **`⚡ Train ML Models & Extract Suspects`** in Section 3 to view:
   - Ranked suspects (*Suspect #1, #2, #3*).
   - 🌊 Hop-by-hop fund trail cards.
   - 🏛️ Printable court charge sheet.
