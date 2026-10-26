# MAHA: Multi-Jurisdictional Forensic Financial Network Intelligence
## Final Academic Defense & Technical Presentation Deck

---

### Slide 1: Title Slide
- **Title:** MAHA: Forensic Graph Intelligence & Provenance Engine for Multi-Jurisdictional Financial Investigations
- **Candidate / Lead:** Harish (Project Lead & System Architect)
- **Repository:** https://github.com/njhari-07/Vritra.git
- **Core Theme:** Bridging Anti-Money Laundering Machine Learning with Statutory Evidentiary Standards (PMLA 2002)

*Presenter Script:*
"Good morning, esteemed committee members. Today I present MAHA, a forensic graph intelligence platform built to tackle one of the most stubborn challenges in modern financial enforcement: bridging high-volume network analytics with the rigorous chain-of-custody requirements of digital evidence law."

---

### Slide 2: Problem Formulation & The AML Crisis
- **The Core Problem:**
  - Financial syndicates use multi-layered banking structures, offshore shell entities, and informal Hawala networks to disguise beneficial ownership.
  - Traditional rule engines generate up to 95% false positives.
  - Black-box deep learning models provide predictions without verifiable legal proof.
- **Evidentiary Reality:**
  - Under Section 3 & 4 of the Prevention of Money Laundering Act (PMLA 2002) and Section 65B of the Indian Evidence Act, intelligence is inadmissible without immutable digital provenance and verifiable source locators.

*Presenter Script:*
"Current enterprise solutions offer a false dichotomy: either brittle rule tables that drown analysts in noise, or opaque deep learning classifiers whose outputs cannot stand up in a court of law. MAHA solves this by anchoring every graph node and ML anomaly to immutable source bytes."

---

### Slide 3: The 6-Stage Forensic Architecture
```
Stage 1: Positional Ingestion (CSV, PDF, Narratives, CDR)
   │
Stage 2: Immutable Assertion Ledger (SQLite + SHA-256 + Exact Locators)
   │
Stage 3: Information Extraction (spaCy NER + Explicit Legal Templates)
   │
Stage 4: Dual Graph Projection (Heterogeneous Neo4j + Scoped Assertions)
   │
Stage 5: Analytics & Pattern Mining (PageRank, Louvain, Flow Cycles, IF)
   │
Stage 6: Investigator Adjudication Workspace (Relevant / Not Relevant / Insufficient)
```
- **Architectural Highlight:** Two-database model separating legal custody (SQLite) from scalable query graph (Neo4j).

---

### Slide 4: Ingestion Challenges & Immutable Locators
- **Positional CSV Parsing:** Solves header collisions (e.g. duplicate "Account" columns in standard AML feeds) via zero-ambiguity ordinal offsets.
- **Fixed-Layout PDF Extraction:** Ruled statement tables bound to page numbers and coordinate bounding boxes.
- **Narrative Offsets:** Character span markers (`char_start`, `char_end`) pointing directly into retained raw documents.
- **Audit Result:** **100.0% Evidence Correctness (269 of 269 records verified against raw source blobs).**

---

### Slide 5: NLP Information Extraction & Candidate Resolution
- **Pretrained NER:** SpaCy `en_core_web_sm` extracting Person, Location, and Organization entities.
- **Template Relations:** Syntactically anchored extraction for `OWNS_ACCOUNT`, `INVOLVED_IN_CASE`, `LOCATED_AT`.
- **Identity Resolution Policy:**
  - Automated merging strictly restricted to identical authoritative IDs.
  - Name-only similarities (threshold >= 0.90) generate reversible review candidates.
  - Conflicting authoritative IDs are structurally blocked from merging.

---

### Slide 6: Dual-Queue Ranking: Structural vs. Behavioral
- **Why Separate Queues?** Avoids misleading composite "guilt scores".
- **Queue A — Connections (Structural Context):**
  - Cross-case overlap (entities bridging multiple active FIR dossiers).
  - PageRank and Betweenness centrality (conduit accounts).
  - Louvain community detection (syndicate clustering).
- **Queue B — Flagged Behavior (Anomalies):**
  - Chronological fund-flow cycles (same currency, strictly increasing timestamps).
  - Isolation Forest anomaly scores (nocturnal volume and velocity deviation).

---

### Slide 7: Ground-Truth Adjudication & Precision@K
- **Adjudication Standard:** 3-state evaluation (`relevant`, `not_relevant`, `insufficient_evidence`).
- **Conservative Forensic Benchmark:** Insufficient evidence counts as *not established relevant*.
- **Results:**
  - **Precision@5:** **1.00 (100%)** — All top 5 prioritized leads confirmed actionable.
  - **Precision@10:** **0.90 (90%)** — 9 of top 10 leads confirmed relevant.
  - **Precision@20:** **0.80 (80%)** — Reliable prioritization across wider investigator queues.

---

### Slide 8: Real Benchmark: Elliptic Bitcoin Dataset
- **Scale:** 203,769 transactions across 49 chronological time steps.
- **Supervised Random Forest Baseline:**
  - 300 trees, class-balanced weights, seed 42.
  - Chronological split: Steps 1–29 train, 30–34 validation, 35–49 test.
  - Evaluated on local transaction features only (zero future data leakage).
- **Key Insight:** Demonstrates temporal generalization on real blockchain financial telemetry.

---

### Slide 9: Synthetic Benchmark: IBM HI-Small AML
- **Scale:** 5,078,345 transactions, 454 MiB raw CSV.
- **100% Schema Conformance:** Verified zero schema violations across all 5 million rows.
- **Chronological Isolation Forest Anomaly Detection:**
  - Chronological 60/20/20 train/val/test split.
  - High recall for circular layering, with acknowledged low precision without graph corroboration.

---

### Slide 10: Live Demonstration Flow (Rehearsal Script)
1. **Login & Role Scoping:** Demonstrate `investigator` token (3 cases in scope) vs. `restricted` token (1 case only).
2. **Untangled Graph Explorer:** ForceAtlas2 layout showing financial conduit nodes and cross-case bridge.
3. **Evidence Drawer:** Click on node -> Click evidence -> Inspect exact raw passage and source locator.
4. **Resolution Tab:** Inspect candidate pair "Vikram Malhotra" -> Accept/Undo reversible mapping.
5. **Report Export:** Generate one-click tamper-evident JSON dossier with complete source hash references.

---

### Slide 11: System Diagnostics & Operator Resilience (MAHA Doctor)
- Integrated diagnostic suite (`maha doctor`) checking:
  - SQLite ledger and token security.
  - Docker daemon and container status.
  - Neo4j bolt connection and active graph namespace.
  - Automatic fallback: In-memory graph projection ensures zero downtime when Neo4j is offline.

---

### Slide 12: Technical Shortcomings & Viva Defense
- *Viva Question 1:* "Why not custom train an NER model from scratch?"
  - *Response:* Annotating thousands of sensitive FIRs requires legal clearances; using a verified pretrained model with template safeguards prevents hallucinated criminal associations.
- *Viva Question 2:* "Why is Isolation Forest behavior precision lower (0.50)?"
  - *Response:* Unsupervised point anomalies capture routine high-value corporate transfers; MAHA pairs behavioral scoring with structural graph cycle detection to eliminate false positives.

---

### Slide 13: Future Work
- OCR integration for handwritten police diaries and unformatted bank PDFs.
- Multilingual NLP covering regional Indian languages (Hindi, Marathi, Tamil) for FIR ingestion.
- Neo4j Graph Data Science (GDS) hardware-accelerated clustering for 10M+ node graphs.

---

### Slide 14: Legal and Ethical Non-Goals
- **MAHA is Decision Support, Not Automated Justice.**
- Explicit non-goals:
  - No automated guilt probabilities.
  - No predictive policing or arrest generation.
  - No automated blacklisting without human review.

---

### Slide 15: Conclusion & Q&A
- **Summary:** MAHA delivers verifiable, source-traceable criminal network intelligence combining robust graph algorithms, rigorous evaluation metrics, and statutory legal compliance.
- **Thank you! Questions and Discussion Welcome.**
