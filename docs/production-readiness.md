# MAHA production readiness

## Purpose and beneficiaries

MAHA helps authorized financial and case investigators organize records, trace
relationships, and review how each finding was derived. Review leads and evidence
custodians benefit from reproducible source links, access controls, and an audit
trail. People represented in records benefit when the system distinguishes
documented roles, ambiguous mentions, graph position, and transaction signals.

Success means an authorized reviewer can find relevant evidence faster, verify
the source and scope, correct a mistake, and reproduce an export. Evaluation
needs to measure those outcomes on representative work.

## Module audit and sequence

| Module | Observed gap | Next acceptance check |
| --- | --- | --- |
| Case access and sessions | The public token endpoint and baked-in investigator credentials defeated the login boundary. Creating an existing case ID granted access to it. Fixed those entry points. | Rotate exposed credentials before operational use. Define case ownership and separate import, review, reset, and export privileges. Test grant and revocation across all endpoints. |
| Dossiers and exports | Heuristics inferred legal charges and person risk. The export could fabricate statutory grounds and attestations. Replaced with source-backed observations and retired the charge-sheet route. | Review representative exports with investigators. Check that document roles can differ across sources and each observation has its own evidence. |
| Import and provenance | Format coverage is narrow. A malformed record can fail differently across import routes. Existing fact IDs preserve observations but the ledger is locally mutable. | Standardize import manifests and quarantine, validate adversarial inputs, measure field extraction accuracy, and implement tested backup and restore. |
| Legal NLP | InLegalNER evaluated judgment spans. FIR accuracy is unknown. Judgment mentions now support approval, correction, rejection, and history. Pasted text now routes to legal or general entity extraction by document type. | Evaluate fresh judgments and FIRs separately, including extraction errors and missed mentions. |
| Identity resolution | Name similarity is bounded and pairwise. Resolution reviews lack measured accuracy on independently labeled real pairs. ICIJ blocking produced large collision groups. | Add indexed candidate blocks with limits, adjudicate positives and hard negatives, and verify concurrent decisions cannot merge conflicting authoritative identities. |
| Neo4j synchronization | Committed revisions now gate reads. The background reconciler retries failures and SQLite serves fresh reads while Neo4j catches up. Global rebuilds still scale poorly. | Measure recovery under real database interruption and implement incremental projection updates for larger workloads. |
| Structural analytics | Montagna showed mixed role ranking and partial clan agreement. Metrics depend on projection and source coverage. | Document projection and case coverage in each result. Measure stability under missing or duplicate observations. Keep structural metrics out of person assessments. |
| Financial analytics | Isolation Forest fits and scores the same transactions on two features. Top-ranked records can appear even without a calibrated threshold. Cycle search is bounded. | Separate descriptive ranking from thresholded alerts. Validate held-out performance and show path evidence and truncation. |
| Human review and metrics | Automated heuristics were written as adjudications. That path is retired. Existing reviews without a manual provenance marker are withheld from current findings and need provenance review. | Collect independent labels on a frozen sample, record reviewer and rationale, and publish precision only when the relevant ranking window is adjudicated. |
| Dashboard and accessibility | The dashboard carries large state and has limited automated browser coverage. Some tabs intentionally span all authorized cases and need explicit scope labels. | Run browser checks for case switching, evidence drawers, role partitions, keyboard navigation, and export. Test long imports and empty cases. |
| Operations and data lifecycle | Local bearer tokens, manual retention, a single-machine database, and no measured availability target. | Establish deployment controls, encrypted backups, recovery and retention drills, monitoring, and resource budgets before using operational records. |

## First remediation pass

Person dossiers now group source-backed observations without a person risk
score. Connections and transaction findings are shown separately. The former
charge-sheet and automated adjudication endpoints return HTTP 410. Case-scoped
requests reject unauthorized cases, and creating a case cannot claim an
existing case. The dashboard sends the selected case on report and review
requests. The public token endpoint and built-in login token were removed.

## Synchronization remediation

SQLite transactions track changes to facts and evidence. Neo4j publishes the
ledger ID and revision with each atomic rebuild. The API falls back to
SQLite when that revision is stale or unavailable and uses one graph
snapshot for cross-case and structural findings. Web writes return after
the SQLite commit. The background worker retries with capped backoff.
The local lock serializes worker and CLI sync for one ledger. Operate with
one Neo4j database per ledger. Incremental sync, cross-host deployment,
and load testing remain open.

## Judgment mention review

From **Quality**, open an imported legal mention. The review panel shows
the original extraction and a source excerpt. Reviewers can approve it,
correct its label or span, or reject it with a reason. Corrections are
sliced from the stored source and each decision keeps its reviewer and
timestamp. The original extraction stays intact. Concurrent edits are
rejected until the reviewer reloads the latest decision. Decisions stay
in the evidence ledger for review and do not create graph assertions.
The review panel displays the 50 latest decisions per mention.
