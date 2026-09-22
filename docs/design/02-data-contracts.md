# Dataset mapping and input contracts

Status: **schema 0.1 working contract, checked against actual source excerpts**.
See [inspection report](06-sample-inspection.md) for actual mapped records, retrieved
sample sizes, and limits. Full-source profiling remains pending.

## Primary references inspected

- [Elliptic original paper](https://arxiv.org/html/1908.02591v1): transactions are nodes,
  payment flows are edges; 166 features and discrete time steps. These are not
  identifiable bank accounts or calendar timestamps.
- [Elliptic distribution](https://www.kaggle.com/datasets/ellipticco/elliptic-data-set):
  source of the three requested CSVs; row preview was not readable during this review.
- [IBM provider repository](https://github.com/IBM/AML-Data): data is synthetic;
  dataset terms differ from repository code terms.
- [IBM-hosted field description](https://community.ibm.com/community/user/blogs/diego-cardalliaguet/2026/07/17/transaction-linking-in-a-retail-bank-with-ibm-sdi):
  lists the bank, account, timestamp, paired amount/currency, payment-format and label fields.
- [IBM Kaggle distribution](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml):
  obtain HI-Small here; actual values and release details remain unverified.

## Common envelope, distinct payloads

Every normalized record has `schema_version`, `record_id`, `record_type`, `dataset_id`,
`synthetic`, `evidence_ids`, `case_ids`, and `payload`. `case_ids` can be empty for
benchmark records; they remain outside investigation endpoints. `synthetic` is required,
never defaulted from a filename. Preserve original labels separately from model features.

### Elliptic (physical layout verified on excerpts)

| File / expected field | Normalized representation | Rules |
|---|---|---|
| features: first column, transaction ID | `elliptic_transaction.tx_id` | String; dataset-scoped identifier |
| features: second column, time step | `time_step` | Integer 1–49; never turn into invented UTC dates |
| features: remaining feature columns | ordered `features` | Preserve opaque feature positions; no guessed currency/amount |
| classes: `txId`, `class` | separate evaluation label | `1` illicit, `2` licit, `unknown` excluded from supervised labels |
| edgelist: `txId1`, `txId2` | `elliptic_flow.from_tx_id`, `to_tx_id` | Transaction endpoints, not accounts |

The excerpts verify the headerless layout (167 columns: ID plus 166 features),
edge/class header spellings, and initial time-step values. Validate ranges, feature order,
and full label vocabulary during complete-file profiling. Reject release/schema drift
rather than guessing. Missing amount, currency,
and bank endpoints are **not applicable**, not defective bank-transfer records.

### IBM HI-Small (11-column header verified on excerpt)

| 1-based position / field | Normalized bank-transfer field |
|---|---|
| 1 `Timestamp` | `event_time_raw`, then `event_time` with declared time policy |
| 2 `From Bank` | `source_bank_id` |
| 3 first `Account` | `source_account_id` |
| 4 `To Bank` | `destination_bank_id` |
| 5 second `Account` | `destination_account_id` |
| 6 `Amount Received` | `amount_received` (decimal string) |
| 7 `Receiving Currency` | `receiving_currency_raw`, mapped currency code |
| 8 `Amount Paid` | `amount_paid` (decimal string) |
| 9 `Payment Currency` | `payment_currency_raw`, mapped currency code |
| 10 `Payment Format` | `payment_format` |
| 11 `Is Laundering` | separate synthetic evaluation label |

Revalidate the exact header sequence on every import before positional parsing. Do not use a dictionary
reader that overwrites duplicate `Account` headers, or depend on automatic `Account.1`
renaming. Account identity is `(dataset namespace, bank ID, account ID)`; keep leading
zeros and original case. Do not infer account ownership, person identity, case linkage,
call records, or addresses from this file. Generate such assertions separately.

## Validation and normalization decisions

- Bank transfer requires both bank/account endpoints, both amount/currency pairs,
  source timestamp, and payment format. Benchmark label is required for the IBM
  evaluation release, but is not required for future unlabeled statement ingestion.
- Parse amounts as finite decimal values; preserve raw strings. Negative amounts are
  quarantined in this initial adapter until reversal semantics are specified. Zero is
  accepted with a quality warning. Never compute currency totals with binary floats.
- Preserve currency strings and use an explicit versioned mapping to canonical codes.
  Unknown currencies remain in raw/quarantine records; no silent conversion or guessed FX.
- Store known instants as RFC3339 UTC plus original text, zone, and time precision.
  A naive IBM timestamp uses a declared synthetic-only import convention of UTC,
  with `timezone_assumed=true`; this is not a claim about the provider's time zone.
  Real records without an explicit zone or approved source convention are quarantined.
  Minute-resolution timestamps remain minute-resolution; equal times cannot establish order.
- Case narrative requires document ID, case ID, filed date, UTF-8 text, language,
  synthetic flag, and authoring/source manifest. A filed date is a date, not an invented instant.
- CDR requires record ID, caller/callee identifiers, start time with zone, nonnegative
  duration seconds, case IDs, source namespace, and synthetic flag. Phone numbers alone
  identify endpoints; a sourced assignment is required to connect a call to a Person.
- Criminal-history input is a synthetic case-record assertion with subject identifier,
  case ID, record date, record status, and supporting text. No inferred conviction status.
- Elliptic requires complete feature rows with finite numbers, valid IDs/steps, label
  vocabulary, and resolvable edge endpoints. Do not drop unmatched rows from joins;
  account for them in the quality report. Unknown labels are retained.

## Identity, repeats, and rejected records

Source blob ID = SHA-256 of the exact bytes. Observation ID = SHA-256 of a canonical
tuple `(dataset_id, blob_hash, record_type, locator)`. This preserves two identical-valued
rows at different locators. Re-importing the same blob reuses observations and records
a new import run. A row fingerprint across different blobs creates a **possible duplicate**
for review; it never automatically deletes a potentially distinct transaction.

CSV locator records a 1-based record ordinal plus physical start/end lines and header
presence. Quoted multiline fields make physical line numbers insufficient on their own.
Elliptic IDs allow stable transaction identity across releases; differing feature/label
observations are retained by version, never overwritten. No native IBM transaction ID
is assumed, so identity across changed files is unresolved without reviewed linkage.

Every quality entry carries import ID, source hash, locator, code, severity, disposition,
and restricted raw-record reference. Counts reconcile:
`rows_seen = accepted_new + recognized_repeat + quarantined` (headers excluded).
Warnings and candidate duplicates are secondary counts, not extra row dispositions.
Malformed structure that makes row boundaries ambiguous fails the file explicitly.

## Full-source inspection required during ingestion

For each of the four original files, record filename, byte size, SHA-256, provider release,
encoding, delimiter, header/column count, data-row count, sample locators, null counts,
and label distribution where applicable. Inspect at least the first, middle, and last
records plus malformed/duplicate/currency/time edge cases discovered during profiling.
Create at least one mapped real source record per file with its exact locator. Keep
row contents in private review storage, and commit only non-sensitive inspection summaries.
Check Elliptic cross-file ID coverage and IBM duplicate column positions explicitly.

Week 0 sample inspection is recorded separately and supports beginning the adapters.
The full-source profile above is required before accepting those adapters for either
dataset. Never label mock examples or range hashes as full-source evidence.
