# Verification report

Verified locally on 2026-09-19. This is an academic prototype, not an operational deployment.

## Engineering checks

- 26 regression/integration tests pass, including live Neo4j projection/query parity,
  oversized import rollback, explicit resource errors, duplicate-index migration,
  and authorization before history limits.
- The full compressed Elliptic loader processed 203,769 records with an identical
  source manifest and approximately 271 MiB peak process RSS. This measurement covers
  loading/validation, not model training or concurrent server requests.
- The React/Vite production build passes. The graph library produces a large-bundle
  advisory; this is a performance optimization item, not a failed build.
- Python dependency consistency check passes. Test tooling emits two upstream
  deprecation warnings (Starlette/httpx and AnyIO); functional checks pass.
- All nine authenticated read/export API endpoints return successfully.
- Missing authentication is rejected; restricted access to another case's evidence
  returns 404; the restricted user has no cross-case findings.
- Browser verification covered login, the live graph overview, a cross-case source
  passage, and separately labeled real/synthetic benchmark tables.
- The generated PDF was rendered and visually inspected; fixed-layout extraction
  finds both rows with page/table/row bounding boxes. Repeated generation is byte-stable.
- Re-running the seeded pipeline adds no facts/nodes/edges after the final fixture version.
- SQLite integrity check passes. The compressed Elliptic feature member hashes identically
  to the extracted source used to train/evaluate the reported model.

## Current demonstration

The local development graph contains 360 entities and 555 relationships,
with 28 review findings. There are 24 tagged narratives in three cases, a
120-record IBM prefix subset, a CDR, a history entry, separate cycle controls, and a
fixed PDF fixture. Earlier PDF fixture versions remain as distinct source observations;
a fresh seed contains fewer transaction nodes. Changed source bytes are not silently merged.
Every displayed lead's evidence resolves in the authenticated API check. This is 100%
coverage of the displayed demo findings, not 100% factual correctness.

## Real Elliptic benchmark

203,769 transactions; 234,355 directed edges. Full archive CRC and all three source ID
sets were checked. 157,205 unknown labels are excluded from supervised metrics.
Labeled split: 26,381 train (steps 1–29), 3,513 validation (30–34), 16,670 test (35–49).
Only 93 local predictors are used. Thresholds are selected on validation F1.

| Model | Precision | Recall | F1 | Average precision |
|---|---:|---:|---:|---:|
| Random Forest | 0.9005 | 0.7018 | 0.7888 | 0.7824 |
| Isolation Forest | 0.0651 | 1.0000 | 0.1223 | 0.0386 |

The IF threshold flags almost every test transaction. Its high recall is accompanied
by very poor precision and is not a useful standalone result. These metrics validate
transaction classification only, not identity resolution or the heterogeneous case graph.

[Full Elliptic report](evaluation/elliptic-evaluation.json).

## Synthetic IBM evaluation — separate results

The complete 475,664,283-byte HI-Small file contains 5,078,345 data records; the configured
schema profile found zero invalid rows. This is schema validation, not proof of data truth.
Synthetic labels: 5,073,168 negative and 5,177 positive records.

IF uses a seed-42 reservoir of 50,000 records drawn across the full file. Chronological
partitions contain 29,997 train, 10,003 validation, and 10,000 test records. Time ties
stay in one partition. Test positives: 17. Precision 0.001775, recall 0.11765, AP 0.001764.
This weak baseline is retained honestly; synthetic metrics are illustrative only.

[IBM model report](evaluation/ibm-evaluation.json) · [Full-file profile](evaluation/ibm-profile.json).

## Synthetic extraction/retrieval checks

A tiny authored gold set outside the demo narratives gives NER span precision/recall
11/12 (0.9167), two explicit relation matches out of two, and candidate retrieval
precision 0.5 / recall 1.0 over three identity observations. These tiny examples are
not a representative, independently adjudicated evaluation. Candidate retrieval is
not post-review merge accuracy. They demonstrate why name matches require review.

[Fixture evaluation](evaluation/demo-evaluation.json).

Investigator Precision@K is deliberately unreported until relevance labels are supplied.
Human correctness audits and broader representative NLP/resolution evaluation remain
necessary before any stronger claim. No score is a guilt probability.

## Reproduction

See [README](../README.md), [implementation notes](implementation-notes.md), and the
[run manifest](evaluation/run-manifest.json). Reports with reservoir line membership and
normalized Elliptic row indices are retained locally in `artifacts/evaluation/`.
