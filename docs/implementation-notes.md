# Implementation decisions and limits

The working prototype implements all six architecture stages. This document distinguishes
implemented behavior from the broader handoff's aspirations; it does not certify operational readiness.

| Area | Implemented | Limits / follow-up |
|---|---|---|
| Input/protection | Local bearer tokens, explicit case grants, 25 MiB streamed request limit, private ledger, audit and purge | Local single-user administration; no institutional identity provider; purge is a command, not scheduled |
| CSV | IBM positional header handling, decimal amounts, full-file profile; Elliptic three-file validated joins and normalized record index | Demo imports 120 IBM rows, not the full five-million-row graph |
| Case text | 24 tagged narratives, pretrained spaCy NER, character spans, explicit ID/ownership/location/case rules | English only; arbitrary legal relation extraction is not implemented |
| CDR/history | Explicit synthetic person-ID CDR and history CSV adapters | No real telecom carrier-specific formats or inferred phone ownership |
| Resolution | Issuer-scoped exact IDs, candidate-only names, accepted/rejected/revoked decisions, immutable event history | No semantic embeddings; candidate similarity is not identity certainty |
| Graph | Neo4j typed relations, scoped assertions/evidence, atomic synchronization, shared entity IDs | Full rebuild sync is suitable for the bounded prototype; incremental production loading remains future work |
| Analytics | NetworkX projected centrality/community, separate behavioral findings, bounded paths/cycles, Cypher cross-case lookup and tested cycle query | GDS optional optimization deferred; centrality has no suspicion score |
| ML | Real Elliptic temporal RF/IF evaluation; separate synthetic IBM temporal IF evaluation | Baselines only; IF results are weak; no system-accuracy claim |
| Dashboard | React graph/search, separate finding lists, evidence drill-down, resolution/review, timeline, quality/audit, benchmarks | No collaborative workflow or sophisticated graph layout controls |
| PDF | Fixed ruled-table MAHA-DEMO-STATEMENT v1 plus tested page/row/bbox locators | Team-authored statement layout only; broad bank layouts and OCR remain stretch |
| Export | Evidence-linked JSON investigator report | No formatted investigator PDF/Word report; JSON is the implemented export format |
| Evaluation | Source profiles, real/synthetic model tables, tiny authored NLP/retrieval fixture scores, regression checks | Representative independently annotated NLP/resolution corpus and investigator Precision@K remain pending |

## Provenance and graph storage

SQLite is the immutable import/evidence ledger; Neo4j is the served graph store. Neo4j
keeps Evidence and Assertion records with source payloads and typed relationships.
Global identity nodes carry IDs/types only. Case-scoped assertions supply labels and
attributes after authorization, preventing a shared entity from revealing another case's
facts. Python combines authorized assertions and reversible resolution mappings for display.
Cross-case correlation uses Cypher with that same canonical mapping when Neo4j is configured.

Every fact includes evidence references; API report generation checks their resolvability.
Duplicate-valued CSV rows remain distinct observations and receive warnings. Duplicate
source imports do not create new facts. Changed source bytes are new sources and may
represent the same real event; no automatic cross-file transaction merge is attempted.
Historical extraction versions are retained rather than overwritten.

## Temporal and financial interpretation

Elliptic discrete time steps are never converted into invented dates or accounts. Only
93 local predictors enter the primary evaluation; unknown labels are excluded from
supervised training/metrics. IF training may use unlabeled records from the training
period only. Model threshold selection uses validation F1, never test labels.

IBM timestamps use the documented synthetic UTC assumption. Paid and received currencies
are retained separately. Verified routes require strictly increasing times, unchanged
currency on both sides of every hop, consistent time basis, and at most four hops.
Repeated-account interior nodes are excluded from simple cycles. Paths cannot establish
that identical money traversed the route. FX reconciliation is not implemented.

Dashboard IF results are explicitly descriptive, in-sample, and grouped by dataset/currency.
They are distinct from held-out benchmark numbers. Ranking is separate by category and
model; there is no combined criminality score.

## Storage notes

The full Elliptic ZIP and IBM HI-Small CSV are under `data/raw/`. The benchmark reads
Elliptic's large feature file inside the ZIP; extracted CSVs are optional. A temporary
extracted feature copy used during development is under `/tmp` and is not a required
runtime dependency. Docker holds its database volume separately. Package managers may
also cache dependencies under the user's home directory.

The host filesystem became full during installation. Only this project's redundant
extracted feature copy was moved to `/tmp`; no pre-existing user files were deleted.
Purge manages the ledger, generated demo-source copies, and graph, but cannot recall
exports already downloaded elsewhere or delete user-owned original input files.
