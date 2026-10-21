# Multi-Modal Synthetic Investigation Dataset 2: "Operation Cyber-Phantom"

This directory contains **Dataset 2**, an expanded and rigorous multi-modal benchmark dataset engineered to thoroughly stress-test every subsystem of the MAHA investigation engine:
- **Isolation Forest AML Anomaly Detection:** 144 total transactions (110 normal daylight commercial transactions to build a solid distribution baseline, contrasted against 34 nocturnal, high-velocity structured money laundering wires).
- **Multi-Hop Graph Layering Cycles:** 3-hop, 4-hop, and 5-hop closed fund-flow cycles with direct corrupt bank official kickback transfers.
- **NLP Judicial & Statutory NER:** Extraction across PMLA Sec 3 & 4, IPC 420/120B/409/468/471, Prevention of Corruption Act Sec 7 & 13(1)(d), IT Act Sec 66D, and Companies Act Sec 447.
- **Police & Intelligence History Registry:** 18 records across EOW FIRs, Look-Out Circulars (LOC), Non-Bailable Arrest Warrants (NBW), Proclaimed Offender proclamations under Sec 82 CrPC, CBI special offenses, SFIO investigations, ICAI disciplinary bars, and INTERPOL alerts.
- **Telecom Call Detail Records (CDR):** 65 intercept logs with synchronized calls preceding fund transfers by 10 to 25 minutes.
- **Raw Free-Text FIR Document:** High-density, unformatted FIR complaint ready for zero-shot text ingestion.

---

## 📁 Included Dataset Files

| File Name | Modality | Records | Description |
| :--- | :--- | :--- | :--- |
| **[`court_proceedings_sample_2.json`](file:///d:/Vritra-master/data/sample_datasets_2/court_proceedings_sample_2.json)** | Judicial Orders & Proceedings | 8 Documents | Special PMLA Court complaints, High Court bail rejection under Section 45 PMLA, Magistrate remand orders, CBI prosecution sanction, and Section 164 CrPC forensic witness depositions. |
| **[`financial_wires_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/financial_wires_sample_2.csv)** | Banking & Financial Wires | 144 Wires | 34 nocturnal laundering wires across multiple overlapping closed loops (3-hop, 4-hop, 5-hop) and sub-$50k structuring bursts, amidst 110 daylight routine business background transactions. |
| **[`crime_records_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/crime_records_sample_2.csv)** | Crime & Intelligence Registry | 18 Records | High-severity criminal records: FIRs, LOCs, NBWs, Section 82 CrPC Proclaimed Offender status, CBI Banking Fraud Cell charges, SFIO inspection, and INTERPOL purple notices. |
| **[`telecom_cdr_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/telecom_cdr_sample_2.csv)** | Telecom Call Detail Records (CDR) | 65 Calls | Synchronized nocturnal communication bursts between masterminds, mule coordinators, shell directors, and corrupt banking officials minutes prior to wire execution. |
| **[`raw_police_fir_sample_2.txt`](file:///d:/Vritra-master/data/sample_datasets_2/raw_police_fir_sample_2.txt)** | Raw Unstructured FIR Complaint | ~3.6 KB Text | Dense, formal police complaint under IPC 420/120B/409/468/471, PC Act 7/13, IT Act 66D, and PMLA 3/4. Designed for the web UI's Free-Text Ingestion tab. |

---

## 🎯 Case Narrative & Entity Network

### Actors & Accounts
1. **Aditya Vardhan Oberoi (`P201`) - Prime Syndicate Mastermind**
   - **Account:** `010 / ACC-OBEROI-901`
   - **Role:** Directs ₹85,000,000 public procurement diversion; beneficial owner of primary conduit.
   - **Legal Status:** Declared Proclaimed Offender under Sec 82 CrPC, Active NBW, LOC at all airports, Indicted under PMLA Sec 3 & 4.
   - **Alias:** *Singhania*.

2. **Sameer Kulkarni (`P202`) - Chief Hawala & Cash Smurfing Controller**
   - **Account:** `010 / ACC-KULKARNI-902`
   - **Role:** Coordinates 12 hawala mules; splits high-value sums into structured tranches.
   - **Legal Status:** High Court bail dismissed under Section 45 PMLA twin conditions, Active CBI RC-04/2024.

3. **Radhika Singhania (`P203`) - Dummy Managing Director (Vertex Exim Corp)**
   - **Account:** `010 / ACC-VERTEX-903`
   - **Role:** Paper front entity for round-tripping capital back to Oberoi under "loan reinvestment" pretexts.
   - **Legal Status:** Disqualified under Sec 164(2) Companies Act, SFIO investigation for bogus invoicing, IPC 468/471 (Forgery).

4. **Farhan Akhtar Siddiqui (`P204`) - Angadia Courier Cash Mule Coordinator**
   - **Account:** `010 / ACC-FARHAN-904`
   - **Role:** Coordinates physical cash couriers; liquidates wires into physical currency.
   - **Legal Status:** Remand under IPC 420/467/468; seizure of ₹2.4 Crores unaccounted cash transit.

5. **Tanya Deshmukh (`P205`) - Darknet P2P Crypto Liquidity Operator**
   - **Account:** `010 / ACC-TANYA-905`
   - **Role:** Converts illicit banking deposits into untraceable cryptocurrency via unhosted wallets.
   - **Legal Status:** IT Act Sec 66D, INTERPOL Purple Notice intelligence sharing on crypto tumblers.

6. **Deepak Joshi (`P206`) - Syndicate Chartered Accountant & Bogus Invoice Architect**
   - **Account:** `010 / ACC-JOSHI-906`
   - **Role:** Generates fake e-way bills and inflated balance sheets for intermediary pass-through layering.
   - **Legal Status:** Companies Act Sec 447, ICAI disciplinary finding, Central GST Intelligence (DGGI) FIR.

7. **Kavita Roy (`P207`) - Corrupt Senior Branch Operations Manager**
   - **Account:** `010 / ACC-KAVITA-907`
   - **Role:** Manually suppressed automated AML anti-structuring alerts and blocked mandatory STR filings in exchange for wire kickbacks.
   - **Legal Status:** Sanctioned for prosecution under Sec 7 & 13(1)(d) PC Act, Central Vigilance Commission suspension.

8. **Arvind Swaminathan (`P208`) - Principal Core Banking Systems Auditor (Witness)**
   - **Role:** Witness who provided cryptographic core banking transaction ledgers and confirmed nocturnal coordination under Sec 164 CrPC.

---

## 🌊 Multi-Hop Layering Cycles in Dataset 2

1. **Cycle 1 (3-Hop Loop):**
   `ACC-OBEROI-901` ➔ `ACC-KULKARNI-902` ($450,000) ➔ `ACC-VERTEX-903` ($446,000) ➔ `ACC-OBEROI-901` ($440,000 Reinvestment)
2. **Cycle 2 (4-Hop Loop):**
   `ACC-OBEROI-901` ➔ `ACC-FARHAN-904` ($280,000) ➔ `ACC-JOSHI-906` ($276,500) ➔ `ACC-VERTEX-903` ($272,000) ➔ `ACC-OBEROI-901` ($268,000 Reinvestment)
3. **Cycle 3 (4-Hop Crypto Liquidity Loop):**
   `ACC-KULKARNI-902` ➔ `ACC-TANYA-905` ($185,000) ➔ `ACC-FARHAN-904` ($181,500) ➔ `ACC-JOSHI-906` ($178,000) ➔ `ACC-KULKARNI-902` ($174,000 Reinvestment)
4. **Cycle 4 (5-Hop Deep Layering Loop):**
   `ACC-OBEROI-901` ➔ `ACC-KULKARNI-902` ($320,000) ➔ `ACC-TANYA-905` ($315,000) ➔ `ACC-JOSHI-906` ($310,000) ➔ `ACC-VERTEX-903` ($305,000) ➔ `ACC-OBEROI-901` ($300,000 Reinvestment)
5. **Corrupt Bank Official Kickbacks:**
   - `ACC-OBEROI-901` ➔ `ACC-KAVITA-907` ($50,000)
   - `ACC-VERTEX-903` ➔ `ACC-KAVITA-907` ($35,000)
   - `ACC-FARHAN-904` ➔ `ACC-KAVITA-907` ($25,000)
   - `ACC-KULKARNI-902` ➔ `ACC-KAVITA-907` ($40,000)

---

## 🚀 How to Ingest & Rigorously Test

### Command Line Execution:
```bash
python scripts/load_sample_dataset.py --dataset 2 --case CASE-RIGOROUS-02
```

### Web Workspace Execution (`http://localhost:5173`):
1. In the Web UI, create or switch to a new case (e.g. `CASE-RIGOROUS-02`).
2. Navigate to **Data Intake**:
   - Upload [`court_proceedings_sample_2.json`](file:///d:/Vritra-master/data/sample_datasets_2/court_proceedings_sample_2.json)
   - Upload [`financial_wires_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/financial_wires_sample_2.csv)
   - Upload [`crime_records_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/crime_records_sample_2.csv)
   - Upload [`telecom_cdr_sample_2.csv`](file:///d:/Vritra-master/data/sample_datasets_2/telecom_cdr_sample_2.csv)
3. Or paste [`raw_police_fir_sample_2.txt`](file:///d:/Vritra-master/data/sample_datasets_2/raw_police_fir_sample_2.txt) into the **Raw Free-Text FIR / Judgment Paste** tab.
4. Click **`⚡ Run ML Intelligence Training`** to generate the ranked suspect dossiers, interactive layering trail visualizer, and court charge sheet briefs!
