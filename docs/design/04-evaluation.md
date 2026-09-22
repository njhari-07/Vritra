# Evaluation protocol

Status: protocol only. No training, evaluation, metrics, or performance claims exist yet.

## Dataset separation and temporal design

Elliptic validates transaction classification only. IBM HI-Small and team-authored cases
validate synthetic pipeline behavior. Report each dataset in separate tables, with source
release, hashes, preprocessing version, and included/excluded counts. Never call the
combined results system accuracy or real-world investigative effectiveness.

Proposed Elliptic split: time steps 1–29 train, 30–34 validation, 35–49 test. Confirm actual
label counts per step before freezing; retain this chronological order and document any
pre-training revision if a partition cannot support evaluation. Class 1 is positive,
class 2 negative, unknown is excluded from supervised training and all supervised metrics.
Unknown transactions may enter unsupervised training only inside the training period.

Fit imputation/scaling and feature selection on training data only. Begin Random Forest
with 300 trees, balanced class weights, seed 42. Use the 93 local predictors after the
time-step field as the primary baseline, subject to actual feature-layout verification.
Exclude txId and labels. Evaluate the supplied aggregate-feature set only as a separately
labeled retrospective benchmark: neighbor features may include future information relative
to a transaction. No claims of prospective deployment from that experiment.

Isolation Forest: 200 trees, seed 42, training-period records only, excluding label fields.
Use validation labels solely to choose a review threshold and report that use. For the RF,
choose the validation threshold maximizing positive-class F1; tie-break toward higher
precision then higher threshold. Freeze thresholds before test evaluation. For IF apply
the same validation policy on its anomaly scores. No iterative test-set tuning.

IBM Isolation Forest uses a chronological partition by distinct timestamp boundaries:
earliest approximately 60% train, next 20% validation, last 20% test; ties stay in one
partition. Record concrete cutoff values after profiling. Fit currency/payment-format
encoding on training only; keep amounts separated by currency. Never use Is Laundering,
generator pattern annotations, case narrative labels, or generated person identities as
predictors. All IBM metrics remain illustrative synthetic results.

## Measures and acceptance criteria

| Component | Measurement | Required check |
|---|---|---|
| CSV parsing | Exact-match required fields on manually checked records | 100% on frozen deterministic fixtures; report actual-dataset audit separately |
| Fixed PDF layout | Cell/field exact match on manually annotated statements | Report per-field precision/recall and quarantine unsupported layouts |
| NLP | Span precision/recall/F1; relation precision/recall | Held-out narrative template families; gold annotations fixed before tuning |
| Resolution | Pairwise precision/recall; candidate recall | Report auto and human-reviewed separately; no name-only auto merges |
| Evidence completeness | Findings with all evidence resolvable / all findings | 100% of displayed findings; source-less outputs blocked and counted |
| Evidence correctness | Locator/passages actually support the stated assertion | Manual audit distinct from evidence coverage |
| Classification | Positive precision, recall, F1, PR curve, average precision | Include support, prevalence, threshold, confusion matrix and per-time-step counts |
| Lead review | Precision@10 and Precision@20, per category | Only after explicit relevance adjudication |
| Graph logic | Cross-case, projection, chronological/currency controls | All frozen positive and negative examples behave as specified |
| Data protection | Unauthorized access and export probes | No leaked records, IDs, counts, source text, or derived relationships |

Use average precision as the primary PR summary and label it **AP**, not an unspecified
PR-AUC formula. If trapezoidal PR-AUC is added, name it separately. Report undefined
metrics and zero support explicitly. No target model score is promised before evaluation.

## Ranking without a combined suspicion score

Present two independently ordered queues:

- Connections: cross-case findings first by distinct authorized case count descending,
  then centrality findings by PageRank, then community summaries; ties use stable IDs.
  Display betweenness and degree as context. Show the user's selected technique sort.
- Flagged behavior: transaction anomalies ordered by within-model score descending;
  fund-flow patterns occupy a separate technique group ordered by most recent hop.
  The UI labels the sort and model scope. No conversion of a cycle into a guilt score.

Each finding lists all contributing techniques and evidence. A combined page can contain
both queues but has no universal numerical rank across categories/models/datasets.
Manual relevance annotation is `relevant`, `not_relevant`, or `insufficient_evidence`,
with rationale and reviewer. For P@K, insufficient evidence counts as not established
relevant; also report its count. If fewer than K findings exist, report P@n with actual n.
The current solo reviewer is not an independent panel; disclose this limitation, and
use a second reviewer for a blinded subset if teammates join later.

## Mandatory controls

Freeze tests for repeated imports, identical-valued distinct rows, duplicate Account
headers, same account ID at different banks, leading zeros, unknown labels, missing
times, mixed currencies, reverse/equal-time cycles, conflicting ownership, revoked
matches, nonfinancial cross-case links, Document-heavy graphs, and revoked case access.

For projection correctness, adding many Document/Evidence nodes must not change
structural metrics. Removing financial edges must retain the explicit nonfinancial
cross-case finding. Cross-case counts must change when authorization changes.

Before evaluation, retain a run manifest containing code revision, environment lock,
dataset hashes, seeds, split membership, threshold policy, projection specification,
quality totals, and exclusion reasons. Week 8 produces the evaluation report, demo
recording, limitations, and presentation; no new features are scheduled then.
