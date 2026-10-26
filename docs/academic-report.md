# MAHA: Multi-Jurisdictional Forensic Financial Network Intelligence
## Comprehensive Academic Technical Report and System Specification

**Author / Project Lead:** Harish (Project Lead & Forensic System Architect)  
**Repository:** [njhari-07/Vritra](https://github.com/njhari-07/Vritra.git)  
**System Version:** v2.0-academic  
**Date:** October 2026  
**Status:** Integrated Academic Prototype with Live Benchmark Validations  

---

## 1. Abstract

Modern financial crime syndicates exploit jurisdictional boundaries, informal value transfer systems (Hawala), and disparate banking formats to obscure beneficial ownership and illicit capital flow. Current anti-money laundering (AML) architectures predominantly rely on siloed, single-institution rule sets or opaque machine learning models that lack evidentiary provenance, creating high false-positive rates and failing evidentiary admissibility standards under statutory frameworks such as the Prevention of Money Laundering Act (PMLA), 2002.

This report presents **MAHA**, an end-to-end, privacy-preserving, forensic graph intelligence prototype designed for multi-jurisdictional criminal network investigation. MAHA unifies:
1. An immutable, source-anchored SQLite evidence ledger preserving exact byte locators.
2. A dual-layer projection engine separating structural contextual ranking from behavioral anomaly detection.
3. Pretrained natural language processing with syntactically constrained relation templates and reversible, reviewer-adjudicated entity resolution.
4. Temporal fund-flow and circular layering cycle detection under strict chronological and single-currency constraints.
5. Multi-benchmark validation across the public Elliptic Bitcoin network (203,769 transactions), IBM HI-Small synthetic transaction network (5,078,345 records), and domain-specific gold evaluation sets.

Empirical evaluation demonstrates an evidence fidelity rate of **100.0%** across 269 source-linked records, held-out NLP span extraction **F1 of 0.900** (Precision: 0.931, Recall: 0.871), and adjudicated lead prioritization achieving **Precision@5 of 1.00** and **Precision@10 of 0.90**.

---

## 2. System Architecture and Pipeline Design

MAHA operates as a deterministic, six-stage investigative pipeline:

```
[Raw Sources: IBM CSV / PDF / Narratives / Telecom CDR]
                        │
                        ▼ (Stage 1: Ingestion & Quarantine)
        [Positional Header & Schema Validation]
                        │
                        ▼ (Stage 2: Immutable Storage)
     [SQLite Ledger: Exact Source Locators & Assertions]
                        │
                        ▼ (Stage 3: Information Extraction)
 [Pretrained spaCy NER + Explicit Relation Templates + Authority Matching]
                        │
                        ▼ (Stage 4: Heterogeneous Projection)
      [Neo4j Scoped Cypher Graph + In-Memory Fallback]
                        │
                        ▼ (Stage 5: Analytics & Pattern Mining)
    [PageRank / Communities / Flow Cycles / Isolation Forest]
                        │
                        ▼ (Stage 6: Adjudication & UI Workspace)
   [Human Review: Relevant / Not Relevant / Insufficient Evidence]
```

### 2.1 The Two-Database Architecture
- **Primary Source Ledger (SQLite):** Acts as the authoritative legal ledger. Stores raw source blobs, SHA-256 digests, row/char/bbox locators, audit event history, user permissions, and human adjudication decisions.
- **Analytical Graph Projection (Neo4j / NetworkX):** Acts as a transient, scoped projection. Nodes and edges are derived deterministically from authorized ledger assertions for active case scopes. If the Neo4j instance is offline or unreachable, MAHA falls back automatically to an in-memory graph projection without data loss.

---

## 3. Evidence Fidelity and Locators

A central tenet of forensic computing is chain-of-custody preservation. MAHA avoids synthetic identifier hallucination by maintaining exact source-to-field references:

| Modality | Extraction Method | Locator Semantics | Verified Fidelity |
|---|---|---|---|
| Bank Statements (CSV) | `csv-positional` | Exact line number (`line_start`, `line_end`) & row ordinal | 100.0% (136/136) |
| Case Files (JSON) | `explicit-identifier-rule` | Exact Unicode character offsets (`char_start`, `char_end`) | 100.0% (54/54) |
| Case Narrative Text | `spacy-en_core_web_sm` | Substring span offsets with confidence basis metadata | 100.0% (48/48) |
| Ruled Financial Tables | `pdfplumber-fixed-v1` | Document page, table coordinate bounding box (`bbox`) | 100.0% (6/6) |
| Document Metadata | `document-metadata` | Full text hash, case scope, and filing timestamp | 100.0% (24/24) |
| Case History Logs | `synthetic-history-csv` | Source line reference and recording agency | 100.0% (1/1) |
| **Overall Evidence Fidelity** | **All Ingestion Adapters** | **Exact match against immutable raw source bytes** | **100.0% (269/269)** |

---

## 4. NLP Extraction and Identity Resolution Evaluation

### 4.1 Evaluation Protocol
Following `docs/design/04-evaluation.md`, evaluation is conducted on a representative, held-out corpus strictly segregated from development fixtures.

### 4.2 Held-Out Experimental Metrics

| Evaluation Dimension | Metric / Target | Value | Forensic Standard |
|---|---|---|---|
| **Held-Out Test Entities** | Micro Precision | **0.9310** (93.1%) | Exact character-span boundary |
| | Micro Recall | **0.8710** (87.1%) | Zero heuristic padding |
| | Micro F1-Score | **0.9000** (90.0%) | Pretrained `en_core_web_sm` |
| **Per-Entity Breakdown** | Person (Precision / Recall / F1) | **1.000 / 0.909 / 0.952** | High precision prevents misidentification |
| | Location (Precision / Recall / F1) | **1.000 / 0.846 / 0.917** | Cities, jurisdictions, ports |
| | Organization (Precision / Recall / F1) | **0.750 / 0.857 / 0.800** | Banks, shell corporations |
| **Relation Extraction** | Template Precision / Recall | **0.714 / 1.000** | Explicit syntactical anchors |
| **Identity Resolution** | Conflicting Authority IDs Blocked | **100.0% (Enforced)** | Zero false transitive merges |
| | Candidate Recall | **1.000** (100.0%) | Pair retrieval at threshold >= 0.90 |

### 4.3 Qualitative Error Analysis
1. **Capitalized Common Suffixes:** SpaCy occasionally classifies corporate indicators (e.g. "Holdings", "Capital") as locations or ambiguous organizations without contextual financial fine-tuning.
2. **Compound Multi-Token Names:** Honorifics and transliterated South Asian names require character-boundary tolerance; strict exact-span matching penalizes minor boundary shifts even when identity semantics are captured.
3. **Reversible Human-in-the-Loop Safeguard:** MAHA never executes automated entity merging based on string similarity alone. Candidates with similarity >= 0.90 require explicit investigator sign-off, and all decisions are stored in a reversible event ledger.

---

## 5. Lead Prioritization and Adjudication (Precision@K)

### 5.1 Adjudication Methodology
Investigative leads generated by graph analytics, temporal cycle search, and isolation forest anomaly detection were adjudicated under a three-state forensic taxonomy:
- `relevant`: Actionable evidentiary link directly advancing case hypotheses.
- `not_relevant`: Verified benign transaction or peripheral single-degree account.
- `insufficient_evidence`: Plausible link lacking corroborating telecommunication or financial records.

**Conservative Forensic Standard:** Per protocol, `insufficient_evidence` is strictly treated as *not established relevant* for Precision@K calculations.

### 5.2 Adjudication Results

| Metric | Sample (K) | Relevant Count | Precision@K | Benchmark Standard |
|---|---|---|---|---|
| **Precision@5** | Top 5 Leads | 5 / 5 | **1.0000 (100.0%)** | Top 5 ranked leads verified relevant |
| **Precision@10** | Top 10 Leads | 9 / 10 | **0.9000 (90.0%)** | High investigator prioritization efficiency |
| **Precision@20** | Top 20 Leads | 16 / 20 | **0.8000 (80.0%)** | Sustainable triage across larger lead queues |
| **Overall Precision** | All 28 Leads | 19 / 28 | **0.6786 (67.9%)** | Includes exploratory peripheral nodes |
| **Connection Precision@10** | Graph Structural Leads | 9 / 10 | **0.9000 (90.0%)** | Centrality & Cross-Case linkages |
| **Behavior Precision@10** | Behavioral Anomaly Leads | 5 / 10 | **0.5000 (50.0%)** | Unsupervised IF exhibits higher false-positive rate |

---

## 6. Open Shortcomings and Viva Defense Points

To maintain academic rigor and transparency, the following technical limitations must be openly stated:

1. **Synthetic Demo Scale:** The interactive demonstration environment operates on a curated synthetic dataset (~500 entities/transactions). While full datasets (Elliptic 203K, IBM 5M) were acquired and profiled, they are not loaded simultaneously into an interactive client-side graph.
2. **Pretrained NER Limits:** The NLP component utilizes pretrained spaCy models without fine-tuning on custom legal case corpora. Syntactical relation extraction relies on template matching rather than broad semantic dependency parsing.
3. **Unsupervised Anomaly Precision:** Isolation Forest alone produces high false positives (Precision@10 = 0.50) when unaccompanied by structural graph or CDR corroboration.
4. **Chronological Routing Assumption:** Fund-flow paths trace strictly increasing timestamps and identical currency hops; they do not establish that identical currency tokens moved through each hop.
5. **Coverage vs. Correctness:** High evidence coverage (100% resolvable links) confirms provenance integrity, not the truth of the underlying source narrative.
6. **Dual Transaction Boundaries:** SQLite commits and Neo4j synchronization are separate transactions; resilient fallbacks mitigate offline states, but distributed 2PC is outside prototype scope.

---

## 7. Conclusion

MAHA demonstrates that forensic financial network intelligence can achieve high investigator utility (P@10 = 0.90) and uncompromised evidentiary fidelity (100% locator audit) by grounding machine learning algorithms in immutable, verifiable digital provenance. The system establishes a sound, defensible architectural baseline for automated financial intelligence triage under modern statutory and evidentiary standards.
