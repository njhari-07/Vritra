# MAHA — Complete implementation status, pending work, and shortcomings

**Status date:** 20 September 2026  
**Project:** AI-Powered Criminal Network Analysis System, BAI506 mini project  
**Scope reference:** [Project handoff v2](docs/reference/project-handoff-v2.md)  
**Current owner:** Solo project owner; team assignments remain deferred.  
**Physical location:** `/opt/MAHA`  
**Compatibility path:** `/home/nj/MAHA` → `/opt/MAHA`  
**Local application:** <http://127.0.0.1:8765/>

## 1. How far the project has progressed

**An integrated local academic prototype is implemented and has passed its current verification suite. It is not a finished production system or a fully evaluated research submission.**

The implemented flow is:

> Import synthetic records → retain source evidence → extract entities → resolve exact identifiers → review possible name matches → construct the Neo4j graph → calculate structural and behavioral findings separately → inspect source references → review findings → export JSON.

This includes a non-financial cross-case demonstration, not just transaction anomaly detection. Separate real Elliptic and synthetic IBM benchmarks have been run. The dashboard, API, graph database, evidence ledger, and fixed-layout PDF parser exist as working code.

There is no defensible single completion percentage: feature coverage is much further along than representative evaluation, operational reliability, and presentation readiness. Earlier statements that all phases were built refer to the prototype feature path, not every acceptance criterion in the original plan.

| Dimension | Current assessment |
| --- | --- |
| Design review and architecture | Written baseline exists for all seven review areas. |
| Core demonstration | Implemented, integrated, and locally verified. |
| Transaction benchmarks | Completed baseline experiments with recorded results and source provenance. |
| NLP and resolution validation | Small authored fixtures only; representative evaluation remains incomplete. |
| Investigator usefulness | Review controls exist; no adjudicated lead-relevance dataset yet. |
| Large-scale processing | Bounded local prototype; not a five-million-row interactive graph. |
| Academic submission | Technical notes and presentation outline exist; final report and slide deck are pending. |
| Production deployment | Outside the completed scope; substantial work remains. |

## 2. Evidence used for this report

This report was checked against source code, the handoff, design documents, stored evaluation reports, post-migration API checks, and test output. A fresh check during this report returned HTTP 200 from `/api/health`.

The latest recorded full regression run after migration has **26 passed tests**, including live Neo4j integration. The full suite was not rerun solely to write this document. Previously verified frontend behavior and model metrics are identified below as recorded results rather than new experiments.

### Current ledger and latest verified graph

| Item | Count | Meaning |
| --- | ---: | --- |
| Authorized demo cases in ledger | 3 | Synthetic demonstration cases. |
| Source blobs | 10 | Distinct retained source bytes, including development fixture versions. |
| Import runs | 31 | Includes repeated imports; not 31 unique datasets. |
| Evidence records | 269 | Exact source observations. |
| Stored facts/assertions | 1,148 | Multiple observations can describe the same entity or relationship. |
| Saved identity decisions | 0 | Current live database has no user decisions; test fixtures exercised the workflow separately. |
| Identity decision events | 0 | No live review history has yet been accumulated. |
| Saved lead reviews | 0 | Human relevance adjudication has not started in this database. |
| Graph entities | 360 | Latest post-migration API snapshot. |
| Graph relationships | 555 | Recorded graph verification snapshot. |
| Displayed findings | 28 | Latest post-migration API snapshot; not 28 confirmed suspicious events. |

Different counts are expected: source observations, assertions, graph entities, and findings are different objects. Earlier PDF versions remain as distinct observations; a clean seed can have fewer nodes than this development database.

## 3. Completed work by phase

### Phase A — Review, scope, and data contracts

Completed:

- Preserved the v2 handoff and wrote seven design documents.
- Defined the minimum investigation demonstration and non-financial cross-case example.
- Inspected actual dataset fields, including IBM's duplicate column names and bank-scoped account identifiers.
- Defined transaction endpoints, document-to-case links, stable identifiers, repeat imports, and evidence locators.
- Separated structural context from behavioral anomaly findings.
- Defined temporal evaluation, unknown-label treatment, synthetic tagging, and solo delivery sequencing.

**Qualification:** The early design documents are historical baselines. Some still say full profiling, graph integration, or PDF validation is pending even though later artifacts show completion. This status report and the verification artifacts should be used for current progress; the historical documents need a consistency pass.

### Phase B — Dataset acquisition and validation

**Elliptic:** Full original ZIP retained at `data/raw/elliptic.zip`; approximately 147 MiB. All three CSV members can be read directly from the ZIP. There are 203,769 transactions and 234,355 edges. Joins, labels, source hashes, archive integrity, and edge references were checked. The normalized provenance index is retained as compressed JSONL.

**IBM HI-Small:** Full CSV retained at `data/raw/HI-Small_Trans.csv`; 475,664,283 bytes, approximately 454 MiB. All 5,078,345 rows were profiled, with zero invalid rows under the implemented schema rules. This means the schema checks passed, not that every record has independently verified real-world meaning. IBM AML is synthetic.

**Demonstration inputs:** 120 IBM prefix records, 24 authored case narratives across three cases, synthetic CDR and history inputs, explicit cycle controls, and a fixed-layout PDF statement. Fictional people, ownership, and case associations are labeled synthetic and are not represented as identities supplied by IBM.

**Scope boundary:** Elliptic is implemented as a separate classification/validation pipeline. Its full transaction network is not loaded into the investigator's heterogeneous Neo4j graph or exposed as a separate graph workspace. IBM full-file profiling and sampled ML evaluation are also different from importing the full file into the interactive graph. This is a deliberate prototype scope decision, but falls short of any literal expectation that both complete datasets would populate the dashboard.

### Phase C — Ingestion and evidence storage

Implemented adapters:

| Input | Implemented behavior | Limit |
| --- | --- | --- |
| IBM CSV | Positional header validation, scoped account IDs, decimal amounts, currencies, timestamps, labels, source row locators | Specific IBM schema, not arbitrary bank CSVs. |
| Narrative JSON | Case validation, metadata, pretrained entity extraction, explicit relation templates, character spans | Controlled English narratives. |
| CDR CSV | Explicit person identifiers and timestamped communication edges | No telecom-provider-specific parser or inferred phone ownership. |
| History CSV | Source-provided case-history information | No independent verification of source claims. |
| PDF | Fixed ruled-table statement extraction with page, table/row, and bounding-box references | Only MAHA-DEMO-STATEMENT v1. |
| Elliptic CSV members | Validated feature/class/edge joins and provenance index | Separate benchmark pipeline. |

The SQLite ledger preserves source bytes, source hashes, import identifiers, extraction versions, event time, ingestion time, confidence metadata, source locators, and per-case evidence. Repeated imports recognize existing observations. Identical-valued rows at distinct locators remain distinct observations with duplicate warnings.

Rejected records have recorded reasons. A disk-backed, case-scoped duplicate index avoids repeatedly loading all prior evidence into memory. Oversized imports roll back atomically.

**Qualification:** “Immutable evidence” describes the application's observation-preserving behavior. The local SQLite file is not a cryptographically tamper-evident or legally certified evidence store.

### Phase D — NLP and identity resolution

Implemented:

- Pretrained spaCy `en_core_web_sm` extraction; no custom NER training.
- Explicit identifier, ownership, location, and case-association rules.
- Evidence-linked text spans for extracted mentions.
- Exact identifier linkage between authored text and IBM account references.
- Name-only match candidates using normalized `SequenceMatcher` similarity, default threshold 0.90.
- Human accept, reject, and revoke actions.
- Reversible identity mappings preserving source assertions.
- Conflict checks preventing transitive merging of distinct authoritative identifiers.
- Identity-decision event history.

Shortcomings:

- English only; names alone do not establish identity.
- Relation extraction relies on authored templates, not general legal narrative understanding.
- No semantic embeddings or learned matching model.
- Confidence/similarity values are not calibrated identity probabilities.
- No representative independently annotated corpus yet.
- Live users have not yet populated identity decisions; tests demonstrate mechanics, not investigator effectiveness.

### Phase E — Neo4j and graph construction

Neo4j stores scoped assertions, evidence payloads, and typed relationships. SQLite remains the source/import/audit ledger. Shared identity nodes carry IDs and types; authorized assertions supply case-specific attributes for display.

Explicit transaction relationships include `SENT_FROM` and `SENT_TO`; documents use `FILED_UNDER`. Ownership, communication, case participation, location, and mention relationships are implemented. Resolution operates on authorized projections while original observations remain available.

Graph synchronization replaces the application's Neo4j namespace in a transaction. Integration tests compare local and Neo4j entity projections, cross-case results, and chronological cycle results.

**Remaining risk:** SQLite import commits and Neo4j synchronization are separate transactions. A graph-sync failure can leave newly committed ledger data absent from Neo4j until synchronization is retried. There is no persistent job/retry queue or automated reconciliation monitor.

### Phase F — Analytics

| Technique | Status | Interpretation and limits |
| --- | --- | --- |
| Degree centrality | Implemented | Structural connection context. |
| Betweenness | Implemented | Sampled with at most 100 source nodes, seed 42; not exact for larger graphs. |
| PageRank | Implemented | Structural ranking, not guilt likelihood. |
| Louvain communities | Implemented | Groups in the chosen graph projection. |
| Cross-case correlation | Implemented through Cypher | Uses explicit case relations and reviewed canonical identity mappings. |
| Dashboard Isolation Forest | Implemented | In-sample amount/time scores, grouped by dataset and currency; illustrative only. |
| Fund-flow paths and cycles | Implemented | Strictly increasing times, same currency and time basis, up to four hops. |
| Separate lead lists | Implemented | Connections remain separate from flagged behavior. |
| Evidence traceability checks | Implemented | Unresolvable lead references are excluded; coverage is not truth. |

The structural projection excludes documents and evidence, and avoids double-counting the direct account-transfer shortcut alongside transaction endpoints. It does not literally use every stored edge type.

Fund-flow search returns at most 50 paths with a 20,000-expansion budget and exposes truncation. These bounded results are not an exhaustive long-chain search. Currency exchange reconciliation and proof that the same money traversed a route are not implemented.

The API supports start/end path queries. The dashboard displays cycle findings but does not yet offer a dedicated interactive start/end flow-tracing screen.

### Phase G — Dashboard and investigator workflow

Working React/vis-network views:

- Overview and interactive graph.
- Connections and flagged behavior as separate lists.
- Graph explorer with basic search and entity detail.
- Evidence drawer with exact source passage/locator.
- Identity-resolution review and revocation.
- Timeline for dated entities and calls.
- Synthetic record import, quality ledger, and audit history.
- Separate benchmark results.
- Lead review as relevant, not relevant, or insufficient evidence.
- Evidence-linked JSON report export.
- Token login and workspace lock.

The API includes `/api/me`, `/api/graph`, `/api/analysis`, `/api/evidence/{id}`, `/api/source/{id}`, `/api/candidates`, `/api/quality`, `/api/audit`, `/api/benchmarks`, `/api/timeline`, `/api/flow`, import/review endpoints, and `/api/report`.

Shortcomings: no user/case administration screen, no case-subset selector for analysis, no collaborative assignment workflow, no advanced graph layout/filtering, no polished PDF/Word report export, and no dedicated flow-query controls. The frontend is concentrated in a small number of dense source files. The production build has a large graph-library bundle advisory. UI checks were manual, not a comprehensive browser regression suite.

### Phase H — Local protection and retention

Implemented: loopback binding, hashed bearer-token lookup, case grants, server-side case filtering, private runtime directory, 25 MiB request limit, audit entries, closed-case retention commands, and restricted-user checks. Shared raw blobs require access to all associated case scopes before download. Credentials are not included in this status document.

Pending or limited:

- No institutional login, MFA, session-expiry framework, or account-management UI.
- No comprehensive security audit, abuse/rate-limit testing, or operational deployment configuration.
- Retention is manually invoked, not scheduled. Downloaded exports and original external files cannot be recalled.
- Local file permissions are not application-level encryption or tamper-proof auditing.
- Uploads are intended for synthetic records and are tagged accordingly; that tag does not prove their origin.
- Identity decisions have event history; lead reviews currently store the latest state rather than an equivalent full decision-event ledger.

### Phase I — Storage migration and memory improvements

The project was moved to `/opt/MAHA`; `/home/nj/MAHA` remains a compatibility link. The migration verified 19,850 entries, including file SHA-256 values, modes, and symlink targets, before removing the home copy. Datasets, evidence, dependencies, and credentials were retained.

Latest filesystem check:

| Filesystem | Available | Use |
| --- | ---: | --- |
| Root partition | 9.5 GiB | 73% |
| Home partition | 3.6 GiB | 88% |

Docker Desktop's shared VM and external Codex Python/Node runtimes remain under home. The project therefore is not completely independent of that partition. Root and home are separate filesystems; the earlier contrary statement was corrected.

Verified cleanup reclaimed 30,225,149 bytes (28.8 MiB) by losslessly compressing the Elliptic row index and deleting extracted CSV duplicates whose hashes matched retained ZIP members.

Resource defaults:

| Budget | Limit |
| --- | ---: |
| Upload bytes | 25 MiB |
| Import records | 5,000 |
| Graph facts per projection | 20,000 |
| Graph nodes | 2,000 |
| Name candidate pairs | 20,000 |
| History rows per response | 200 |
| Neo4j maximum heap | 512 MiB |
| Neo4j page cache | 256 MiB |

Graph/import/name-comparison budgets reject oversized work explicitly rather than presenting partial results as complete. History is capped. Fund-flow search separately reports truncation.

Elliptic evaluation now writes provenance incrementally to gzip and trains models sequentially. Full loader validation peaked at approximately 271 MiB RSS. This measurement does not cover model fitting, concurrent requests, or the complete server/database footprint. Full training was not rerun after that memory refactor.

Remaining bottlenecks include full Neo4j rebuilds, synchronous import/parsing work, repeated dashboard model fitting, and concurrent expensive requests. There is no worker queue or process-wide memory guarantee.

## 4. Measured benchmark results

### Real Elliptic transaction classification

- 203,769 transactions; 157,205 unknown labels.
- Unknowns are excluded from supervised training and metrics, not treated as negative examples.
- Train steps 1–29: 26,381 labeled records.
- Validation steps 30–34: 3,513 labeled records.
- Test steps 35–49: 16,670 labeled records.
- 93 local predictors; identifiers, time step, labels, and 72 aggregate features excluded.
- Threshold selected on validation F1, not test labels.

| Model | Precision | Recall | F1 | Average precision |
| --- | ---: | ---: | ---: | ---: |
| Random Forest | 0.9005 | 0.7018 | 0.7888 | 0.7824 |
| Isolation Forest | 0.0651 | 1.0000 | 0.1223 | 0.0386 |

Average precision is the recorded metric; it should not be relabeled as a separately calculated trapezoidal PR-AUC. Isolation Forest's high recall comes with very poor precision. These are transaction-classification results, not “system accuracy,” identity accuracy, or evidence that a person committed an offense.

### Synthetic IBM baseline

The full file contains 5,073,168 negative and 5,177 positive labels. The experiment uses a seed-42 reservoir of 50,000 rows, chronologically split into 29,997 train, 10,003 validation, and 10,000 test rows with timestamp ties kept together. There are only 17 positive test examples.

Isolation Forest test precision is approximately **0.001775**, recall **0.11765**, and average precision **0.001764**. This is a weak illustrative baseline, not a successful general AML detector. The full five-million-row dataset was profiled, not used as a full-size model experiment or interactive graph.

### Tiny NLP/resolution fixtures

- Entity-span precision and recall: 11/12, approximately 0.9167 each.
- Explicit relation matches: 2/2.
- Candidate retrieval precision: 0.5; recall: 1.0, over three identity observations.

These authored examples are too small for a meaningful generalization claim. Candidate retrieval metrics are not final reviewed-merge precision/recall. Investigator Precision@K is unreported because relevance labels have not been supplied.

## 5. Verification completed and not completed

Completed evidence includes:

- 26 regression/integration tests passing after relocation.
- Live Neo4j projection, cross-case, and cycle parity checks.
- Nine post-migration authenticated read/export endpoints returning HTTP 200.
- Access-denial tests, shared-source download protection, and narrative case-spoof rejection.
- Duplicate/re-import behavior, preserved account identifiers, and malformed amount checks.
- Reversible resolution and transitive conflicting-ID prevention.
- PDF extraction, locators, deterministic fixture generation, and earlier visual inspection.
- Oversized-import rollback, graph-budget error, duplicate-index migration, and authorized history limits.
- Compressed Elliptic loader validation against the original source manifest.
- Previously successful frontend production build and dependency consistency check.

Not established by those checks:

- Representative end-to-end parser accuracy across real banks and arbitrary narratives.
- Independently adjudicated identity-resolution precision/recall.
- Investigator Precision@K or demonstrated investigation outcomes.
- Multi-user concurrency, recovery under every failure mode, or production throughput.
- A clean install reproduced on another machine after relocation.
- Automated UI/accessibility coverage, security certification, or operational readiness.
- Fresh retraining parity following the latest benchmark memory refactor.

## 6. Prioritized pending work and acceptance criteria

These are proposed next actions, not claims that work has already been performed.

| Priority | Task | Completion evidence |
| --- | --- | --- |
| P0 — submission | Create a representative annotated NLP/resolution evaluation set | Separate gold labels, review procedure, held-out split, per-type precision/recall, and error analysis. |
| P0 — submission | Adjudicate a fixed sample of ranked findings | Relevant/not-relevant labels with rationale; reproducible Precision@K by category and a stated treatment of insufficient evidence. |
| P0 — submission | Audit evidence correctness, not only coverage | Sample source-to-field comparisons and wrong/missing-locator counts, separate from link-resolvability. |
| P0 — submission | Produce final academic report and presentation | Finished methodology, diagrams, result tables, limitations, citations, slide deck, and rehearsed demo. |
| P1 — correctness | Handle ledger/graph synchronization failures | Durable sync status, retry/recovery procedure, and a simulated failure test showing reconciliation without duplicate facts. |
| P1 — reproducibility | Re-run models after the memory refactor | Recorded metrics compared with stored baselines, dependency/source versions, elapsed time, and peak memory. |
| P1 — maintainability | Establish Git history and a recoverable backup | Local repository, ignored private/data/build paths, reviewed initial commit, and documented restore test. No Git repository currently exists. |
| P1 — documentation | Reconcile historical and current documents | Old pending items marked historical/closed; dataset/graph scope and storage paths consistent. |
| P1 — usability | Add analysis case selection and flow-query controls | Authorized subset selection and evidence-linked start/end routes shown in the UI, including truncation notices. |
| P1 — reliability | Add startup/readiness and recovery workflow | Explicit checks for Docker, Neo4j, configuration, API, and stale graph state; clear operator instructions. |
| P2 — scale | Move heavy work off request handling | Bounded worker concurrency, progress/error tracking, and measured memory/latency under concurrent requests. |
| P2 — scale | Replace full graph rebuild with incremental synchronization | Idempotent batches and deletion/recovery tests with substantially larger fixtures. |
| P2 — frontend | Split graph code and add browser checks | Smaller initial payload, component separation, and automated login/import/review/export smoke tests. |
| P2 — protection | Improve review history, retention operations, and token administration | Lead-review event history, tested scheduled retention if desired, and explicit token lifecycle controls. |
| P2 — packaging | Reproduce installation independently of this machine | Fresh setup using pinned dependencies and documented runtime assumptions, without relying on the old home path. |

Human annotation is genuine pending input/work. It cannot be replaced by invented relevance labels or treating authored test outcomes as independent investigator judgment. All tasks remain assigned to the solo project owner unless later delegated.

## 7. Shortcomings that should be stated openly in a review or viva

1. **The working demonstration is small and predominantly synthetic.** Full dataset downloads do not mean full dataset graph integration.
2. **The NLP component is pretrained NER plus explicit relation templates.** It does not understand arbitrary case narratives reliably.
3. **Entity-resolution validation is preliminary.** Working review controls are different from measured identity accuracy.
4. **The Isolation Forest baselines perform poorly.** High recall alone is not success when precision is very low.
5. **The dashboard anomaly score is in-sample.** It is distinct from the held-out Elliptic and IBM experiments.
6. **Fund-flow paths are possible chronological routes.** They do not establish that identical funds moved through every hop.
7. **Evidence coverage is not evidence correctness.** A resolvable source can still be wrong or inaccurately interpreted.
8. **Local protection is a prototype baseline.** It is not enough to claim readiness for sensitive operational casework.
9. **Graph synchronization and concurrency need engineering work.** Resource limits reduce risk but do not eliminate all bottlenecks.
10. **Submission preparation is unfinished.** A presentation outline is not a final deck, and technical notes are not a polished academic report.

## 8. Stretch features and intentional non-goals

Deferred stretch work: OCR for scanned statements, arbitrary PDF layouts, additional bank formats, multilingual NLP, semantic matching, Neo4j GDS optimization, richer graph exploration, and formatted PDF/Word investigation reports.

Intentional non-goals remain predictive policing, person-level guilt probabilities, legal determinations, cybersecurity telemetry, threat-intelligence correlation, and training a custom NER model from scratch. Their absence is not a missing must-have feature.

## 9. Project map and useful files

| Path relative to `/opt/MAHA` | Purpose |
| --- | --- |
| `maha/store.py` | SQLite evidence ledger, case authorization data, audit, reviews, retention. |
| `maha/ingestion.py` | IBM, narrative, CDR, history, and PDF input adapters. |
| `maha/nlp.py` | Pretrained extraction and candidate name matching. |
| `maha/graph.py` | Neo4j synchronization, scoped graph projection, Cypher queries. |
| `maha/analytics.py` | Centrality, communities, cross-case findings, IF, routes/cycles. |
| `maha/benchmark.py` | Dataset validation and temporal benchmark experiments. |
| `maha/demo.py` / `maha/demo_evaluation.py` | Authored demonstration and tiny evaluation fixtures. |
| `maha/api.py` / `maha/cli.py` | Web endpoints and local commands. |
| `maha/limits.py` | Explicit per-operation resource budgets. |
| `frontend/src/main.jsx` / `style.css` | Dashboard components and styling. |
| `tests/test_pipeline.py` / `test_neo4j.py` | Regression and live integration checks. |
| `compose.yaml` | Local Neo4j service and memory configuration. |
| `data/raw/` | Full retained source datasets and download manifest. |
| `data/private/runtime/` | Private ledger, access file, and generated demo inputs. |
| `artifacts/evaluation/` | Full local evaluation reports and compressed row index. |
| `artifacts/qa/` | Test output, API checks, migration and resource validation records. |
| `docs/design/` | Historical review artifacts and contracts. |
| `docs/evaluation/` | Compact benchmark results and run manifest. |
| `docs/presentation-outline.md` | Presentation outline; no final deck yet. |
| `docs/resource-management.md` | Resource limits and migration notes. |
| `scripts/download_data.py` | Dataset download/integrity workflow. |
| `scripts/migrate-project.py` | Completed one-time verified migration utility; do not rerun on the migrated project. |

Access credentials are in the private runtime access file; they are deliberately omitted here so this report can be shared without disclosing them. Do not distribute the `.env`, private ledger, or access file with a public submission.

## 10. How to resume the current project

From a terminal, if the app has stopped:

```bash
cd /opt/MAHA
# Start Docker Desktop first if the Docker daemon is unavailable.
docker compose -p maha up -d --wait
.venv/bin/maha serve --port 8765
```

Only launch a server if port 8765 is not already serving MAHA. Sign in using the existing private investigator token. Use the restricted account to demonstrate case isolation.

Verification command:

```bash
cd /opt/MAHA
MAHA_NEO4J_TEST=1 .venv/bin/python -m pytest -q
```

If the ledger is newer than the graph, the current recovery command is `.venv/bin/maha sync` with Neo4j running. It rebuilds MAHA's graph namespace from the retained ledger. Do not reinitialize credentials or reseed the database merely to start the app.

**Recommended next milestone:** Freeze the existing demo, complete independent annotation and evidence audits, re-run the refactored benchmark, and assemble the final report/deck. Keep stretch feature work separate from closing those evaluation and delivery gaps.
