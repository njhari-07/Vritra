# Project Handoff v2: AI-Powered Criminal Network Analysis System

**Supersedes the previous handoff.** This version incorporates a design review that identified real risks in the original plan — read the "Key Corrections" section (§2) before writing any code, even if you've already seen v1.

**Mini Project — BMS Institute of Technology and Management, BAI506**
**Scope basis:** SIH26189 (Criminal Network Analysis System) as primary scope, with CIDECODE's Automated Bank Statement Analysis as the fully-specified financial-transaction module within it.
**Timeline:** 8 weeks, team of 4. Risk is in parsing, entity resolution, and Neo4j integration — not the ML model choice. Plan accordingly.

---

## 1. Design Review — complete this before implementation

Do not start building until each row below has an actual answer written down, not just "we'll figure it out later." This is a design phase, not a formality.

| # | Review area | What to check | Expected output |
|---|---|---|---|
| 1 | Minimum demo | Define one complete investigation flow: ingest records → resolve entities → explore graph → review a lead → inspect evidence. Include a **non-financial** cross-case example (not everything can be a money trail). | Demo script + acceptance checklist |
| 2 | Dataset fit | Inspect actual Elliptic and IBM AML fields directly. Identify which persons, cases, calls, and locations must be synthetically generated. Keep synthetic additions **explicitly labeled** as synthetic in the data. | Dataset-to-schema mapping |
| 3 | Evidence model | Decide how each finding points to an exact CSV row, PDF page/table row, or document passage. Define how multiple sources can support the same entity. | Provenance schema + example records |
| 4 | Graph design | Resolve missing relationships for transaction endpoints and document-to-case links. Define stable IDs, repeat-import behavior, and how conflicting facts are retained (not silently overwritten). | Graph schema + query examples |
| 5 | Ingestion & resolution | Specify required fields, currencies, timestamps, duplicate handling, rejected-record handling, and matching thresholds. Define how uncertain matches get reviewed by a human. | Input contracts + resolution rules |
| 6 | Analytics & evaluation | Specify graph projections, baselines, temporal splits, ranking rules, and what each dataset can actually validate (see §3). | Evaluation protocol |
| 7 | Delivery feasibility | Assign ownership, dependencies, integration checkpoints, explicit scope cuts. | Revised 8-week schedule (see §7) |

**The review is complete when the team has:** an agreed demo script, mapped sample records, a graph schema with exact evidence references, a written evaluation protocol, and a must-have vs. stretch backlog. Without these five artifacts, implementation has no concrete target and the project risks becoming a transaction detector with an unfinished investigation layer around it.

---

## 2. Key corrections to the original plan

These are the specific fixes that came out of the design review. Each one changes how a module should be built, not just how it's described.

1. **Separate structural importance from suspicion.** Centrality and community membership explain *connections* — they do not automatically raise a criminality score. A shared location or a large legitimate case can produce highly connected entities for entirely ordinary reasons. Keep these as two distinct outputs in the lead record, never merged into one "suspicion number."

2. **"Whole graph" needs a deliberate projection, not a literal dump.** Yes, include financial and non-financial relationships together — but Document and Provenance nodes must be excluded from the centrality/community graph projection, or they'll distort the results (a Document node connected to 50 mentions isn't "central" in any investigative sense). Define the projection explicitly before running any graph algorithm.

3. **Elliptic validates one thing only: transaction classification.** It cannot validate person resolution, case linking, or the full heterogeneous graph — there's no ground truth there. Also: unlabeled Elliptic transactions are *unknown*, not *negative* — never treat them as confirmed-licit during evaluation.

4. **Provenance needs more than 5 fields.** Expand beyond `source, source_id, extraction_method, confidence, timestamp` to also include: source locator (exact row/page/line), import identifier (which ingestion run produced this), extraction version (which model/parser version ran). Also distinguish **event time** (when the transaction/call actually happened) from **ingestion time** (when the system processed it) — these are different fields, not one. A resolved entity should carry multiple evidence references, not a single overwritten `source_id`.

5. **Treat entity matching as a high-risk operation.** Exact identifiers (account number, case ID) can resolve automatically. Similar names alone must only produce a *candidate* match for human review — never an automatic merge. Keep original unmerged records intact and make every merge reversible.

6. **Constrain fund-flow claims.** A graph path or cycle by itself does not prove the same money moved through it — paths need time ordering (B's transaction must happen after A's) and currency-aware interpretation (don't sum mismatched currencies). Build this check into the cycle-detection query, not as an afterthought.

7. **Make evaluation actually measurable, not just ML metrics.** Measure parser correctness (did we extract the right fields), resolution precision/recall (did we merge the right entities), and evidence completeness (does every lead have a source reference) — alongside the ML metrics. Precision@K needs explicitly adjudicated relevance labels (someone has to manually mark a sample as relevant/not) — it isn't free. Traceability measures evidence *coverage*, not *truth* — be careful not to conflate "this lead has a source link" with "this lead is correct."

8. **Add basic data protection before touching sensitive records.** Case access controls, upload limits, audit history, and a retention policy need to exist — even in prototype form — before real or synthetic-but-realistic case data gets loaded in.

---

## 3. Datasets — what each one can and cannot validate

| Dataset | Type | Validates | Does NOT validate |
|---|---|---|---|
| **Elliptic Bitcoin Dataset** | Real, partially labeled (~2%) | Transaction-level anomaly classification (precision/recall/PR-AUC) | Person resolution, case linking, the full heterogeneous graph, cross-case correlation |
| **IBM AML (HI-Small) or AMLSim** | Synthetic, fully labeled | End-to-end pipeline demo, entity/case metadata handling, fund-flow tracing demo | Nothing "real-world" — treat its numbers as illustrative, not evidentiary |
| **Synthetic case narratives** (team-authored) | Synthetic, explicitly labeled as such in the data itself | NLP extraction, entity resolution across text ↔ transaction sources, cross-case correlation demo | Real-world validity of any kind |

Setup:
- Elliptic: Kaggle "Elliptic Data Set" — `elliptic_txs_features.csv`, `elliptic_txs_edgelist.csv`, `elliptic_txs_classes.csv`.
- IBM AML: Kaggle "IBM Transactions for Anti Money Laundering (AML)," HI-Small variant.
- Synthetic case narratives: 20–40 short documents referencing entities that also appear in the transaction dataset, so entity resolution has something real to link. Tag every synthetic record with a `synthetic: true` field at the data level — not just in documentation — so it can never be accidentally reported as real evidence.

---

## 4. Data model

**Nodes:** Person, Account, Transaction, Case, Location, Organization, Document

**Relationships:**

| Relationship | Meaning |
|---|---|
| OWNS_ACCOUNT | Person → Account |
| TRANSACTED_WITH | Account → Account |
| COMMUNICATED_WITH | Person → Person (from CDR) |
| INVOLVED_IN_CASE | Person/Account → Case |
| LOCATED_AT | Person/Account → Location |
| MENTIONED_IN | Entity → Document |
| RELATED_TO | General fallback association |

**Open items from the review to resolve in §1 row 4 before building:**
- What connects a Transaction node to its two Account endpoints, explicitly (a labeled relationship, not an assumption).
- How a Document links to the Case it was filed under (missing in the original schema).
- ID stability across repeat imports (re-importing the same statement shouldn't create duplicate nodes).
- How conflicting facts about the same entity from two sources are retained (both kept with separate provenance, not one overwriting the other).

**Provenance schema (expanded per §2.4):**
```
source            # e.g. "elliptic_txs_edgelist.csv", "case_doc_014.txt"
source_locator    # e.g. row 4821, or "page 2, line 14"
import_id         # which ingestion run produced this
extraction_method # e.g. "regex", "spaCy NER v3.7", "manual"
extraction_version
confidence
event_time        # when the underlying event actually happened
ingestion_time    # when the system processed it
```
A resolved entity holds a **list** of these provenance records, one per contributing source — never a single overwritten field.

---

## 5. Analytics — corrected version

Run these over an explicitly defined **graph projection**: persons, accounts, transactions, cases, locations, organizations, and their direct relationships. Exclude Document/provenance nodes from this projection — they distort structural metrics if included.

1. **Individual anomaly detection** — supervised (Random Forest/XGBoost) on Elliptic's labeled subset, evaluated with precision/recall/PR-AUC; unsupervised (Isolation Forest) as the no-label baseline on both datasets. Report these as *transaction-classification* metrics only — do not extrapolate them to "system accuracy."

2. **Centrality analysis** — degree, betweenness, PageRank on the full projected graph. Output is framed as "structurally connects to N cases/entities," not a suspicion score.

3. **Community detection** — Louvain or Label Propagation on the full projected graph, mixed edge types included.

4. **Fund-flow tracing** — path queries and cycle detection on `TRANSACTED_WITH` specifically, with **time-ordering and currency checks built into the query** (per §2.6) — a cycle only counts if each hop happens after the previous one and currencies are reconciled or explicitly flagged as mismatched.

5. **Cross-case correlation** — Cypher lookup: does a resolved entity appear in more than one Case node. This is a query, not a model.

6. **Lead combination** — every lead in the final ranked list must show: which technique(s) flagged it, the structural-vs-suspicion distinction where relevant, and full source references. Structural findings (centrality/community) are shown as "connections," anomaly findings are shown as "flagged behavior" — kept visually/semantically separate in the UI, never merged into one score.

---

## 6. Ingestion & resolution rules (fill in during §1 row 5, then implement)

- Required fields per record type (transaction: amount, timestamp, source/dest account, currency; case doc: case ID, date filed; etc.) — finalize the exact list against the real dataset fields, not assumed ones.
- Currency handling: store original currency + amount; do not silently convert.
- Timestamp normalization: pick one timezone/format standard, document it, apply everywhere.
- Duplicate detection: define the dedup key per source type before writing the code.
- Rejected records: logged with reason, never silently dropped.
- Matching thresholds: exact ID = auto-resolve; string/semantic similarity = candidate only, held for review (per §2.5).

---

## 7. Delivery plan — must-have vs. stretch

**Must-have (build first, in this order):**
1. CSV ingestion (Elliptic + IBM AML) — no parsing risk, get the graph populated fast
2. Synthetic case-text ingestion + NLP extraction
3. Entity resolution across CSV ↔ text sources
4. Graph construction in Neo4j with full provenance
5. Analytics (all five techniques from §5) on the full projection
6. Thin dashboard — even a bare list-and-detail view — built **early**, not at the end, specifically to surface integration problems before week 8
7. One known/fixed PDF bank-statement layout (not general PDF parsing)

**Stretch (only if must-haves are done with time to spare):**
- Scanned statement OCR support
- Broad/arbitrary PDF layout support
- Additional statement formats beyond the one fixed layout

**Week 8 is reserved entirely for verification and presentation** — not for finishing features. If must-haves aren't done by end of week 7, cut stretch goals; do not compress week 8.

Revised schedule:

| Weeks | Focus |
|---|---|
| 0 (before coding) | Complete the §1 design review — all 7 rows answered, 5 artifacts produced |
| 1–2 | CSV ingestion (both datasets) + synthetic case-text authored and tagged |
| 3–4 | NLP extraction + entity resolution (exact + candidate matching, human-review path for candidates) |
| 5 | Graph construction in Neo4j with full provenance schema; thin dashboard skeleton stood up in parallel |
| 6 | Analytics: anomaly detection, centrality, community detection, fund-flow tracing (with time/currency checks), cross-case correlation |
| 7 | One fixed-layout PDF ingestion; lead-scoring combination; dashboard wired to real data end-to-end |
| 8 | Verification (parser correctness, resolution precision/recall, evidence completeness, ML metrics) + presentation prep. No new features. |

---

## 8. Non-goals (unchanged, still explicit)

- No predictive policing / risk-scoring of people outside an active case.
- No legal determination or "guilt probability" output anywhere in the UI language.
- No cybersecurity telemetry (auth logs, firewall data, endpoint alerts).
- No full threat-intelligence correlation module.
- No custom-trained NER model from scratch — pretrained models only, fine-tune only if time allows.
- No general-purpose PDF/OCR support in the must-have scope — one fixed layout only (see §7).

---

## 9. Ownership & integration checkpoints (fill in during §1 row 7)

Assign one owner per workstream (ingestion, NLP/resolution, graph/analytics, dashboard) — skills-based, not role-based, per the team's actual strengths. Define integration checkpoints at the end of weeks 2, 4, 5, and 7 where all workstreams sync their outputs against the shared graph schema, so integration problems surface early rather than in week 8.