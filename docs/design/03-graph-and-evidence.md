# Graph, evidence, and resolution design

Status: design contract; Cypher examples have not been executed against Neo4j.

## Domain graph

All domain nodes carry a stable `id`, dataset namespace, synthetic status, and nonempty
`evidence_ids`. Access is determined by evidence case scope, not by possession of a node ID.

| Relationship | Endpoints | Meaning |
|---|---|---|
| OWNS_ACCOUNT | Person → Account | Sourced ownership assertion |
| SENT_FROM | Transaction → Account | Explicit payer endpoint |
| SENT_TO | Transaction → Account | Explicit recipient endpoint |
| TRANSACTED_WITH | Account → Account | One derived edge per transaction, with `transaction_id` |
| FLOWS_TO | Transaction → Transaction | Elliptic payment-flow edge; no invented account |
| COMMUNICATED_WITH | Person → Person | Call plus evidence assigning both endpoints to people |
| INVOLVED_IN_CASE | Person/Account → Case | Sourced case association; not an allegation of guilt |
| LOCATED_AT | Person/Account → Location | Sourced location assertion |
| MENTIONED_IN | Entity → Document | Exact source text span |
| FILED_UNDER | Document → Case | Filing association |
| RELATED_TO | Domain entity → Domain entity | Typed explanation mandatory; no inference from co-mention alone |

Person, Account, Transaction, Case, Location, Organization, and Document are domain labels.
Evidence, Observation, Assertion, ImportRun, and ResolutionDecision are supporting records
excluded from structural analytics. Organization relations use an explained RELATED_TO
assertion initially. Version the schema before adding specialized relationship types.

## Stable identity and conflicting facts

- Account: hash of length-delimited canonical `(dataset, bank_id, account_id)` tuple.
- Person: authoritative ID plus issuer/namespace; otherwise observation-local ID.
- Case: issuing organization plus case ID; Document: source content hash plus namespace.
- IBM Transaction: observation-derived ID; Elliptic Transaction: dataset plus txId.
- Location/Organization: authoritative ID if provided; otherwise observation-local.
- Assertion: hash of subject, predicate, object/value, observation ID, and extractor version.
- Derived relationship: stable assertion ID, or transaction ID plus relationship type.

Names, addresses, owner assertions, and statuses are separate evidence-backed assertions.
They are not overwritten entity properties. A display name is a chosen view with its
supporting assertion ID. Conflicting assertions remain visible and can be disputed.
Materialized graph edges are rebuildable from active assertions and resolution decisions.
Re-imports are atomic/staged: incomplete imports never become visible to investigation queries.

## Evidence envelope and source locators

Each evidence record has `id`, `source`, `source_id` (content hash), `source_locator`,
`import_id`, `extraction_method`, `extraction_version`, `confidence`, `event_time`,
`ingestion_time`, `dataset_id`, `synthetic`, `case_ids`, and `time_basis`.
`event_time` can be null with a reason (for example Elliptic exposes only `time_step`).
Extraction confidence describes extraction/matching certainty, never source truth.

- CSV: record ordinal, physical line start/end, columns/positions, source hash.
- Text: document ID, 0-based Unicode code-point offsets `[start,end)`, 1-based line
  interval, original text hash, and passage. Preserve original Unicode/newlines.
- PDF: source hash, 1-based page, table/row index, bounding box, and extracted text;
  bbox coordinates declare origin and units. Preserve parser/layout version.
- Derived finding: algorithm/version, projection ID, parameters, observation cutoff,
  supporting assertion IDs, and source evidence IDs. No source-free findings.

The API returns a list of provenance objects. In Neo4j, use Evidence nodes and homogeneous
string `evidence_ids` arrays on domain nodes and relationships; assemble objects on read.
Do not try to store nested maps as relationship properties. This follows Neo4j's
[property type constraints](https://neo4j.com/docs/cypher-manual/current/values-and-types/property-structural-constructed/).
Keep source locators as flattened Evidence properties. Supporting records reference the
source hash/locator directly, avoiding infinite provenance-of-provenance relationships.

Illustrative envelope only (not an actual dataset row):

```json
{
  "id": "example-evidence-1",
  "source": "example.csv",
  "source_id": "<sha256-of-original-bytes>",
  "source_locator": {"record_ordinal": 1, "line_start": 2, "line_end": 2},
  "import_id": "example-import-1",
  "extraction_method": "csv-positional",
  "extraction_version": "proposed-0.1",
  "confidence": 1.0,
  "event_time": null,
  "time_basis": "not_supplied",
  "ingestion_time": "2026-09-19T09:00:00Z",
  "dataset_id": "design-example",
  "synthetic": true,
  "case_ids": ["DEMO-C01"]
}
```

Re-imports keep original evidence and add ImportRun associations. They do not rewrite
ingestion timestamps or duplicate factual assertions. Source blobs remain immutable
until retention deletion, after which locators are marked unavailable and claims of
complete traceability must be recalculated.

## Entity resolution

1. Exact validated identifiers in the same issuer/namespace auto-resolve (rule confidence
   1.0, meaning exact agreement only). Conflicting unique identifiers block the match.
2. Case-folded/whitespace-normalized names propose a candidate even on exact name equality.
   A normalized edit similarity ≥0.90 also proposes a candidate. This is a provisional
   threshold calibrated on development annotations, never an automatic merge threshold.
3. Semantic matching is deferred until the exact/rule baseline is evaluated; if introduced,
   it remains candidate-only regardless of its score. No arbitrary weighted confidence blend.
4. Review states: pending, accepted, rejected, revoked. Record reviewer, timestamp, reason,
   input observations, comparison features, and before/after membership mappings.
5. Accepting creates a versioned resolution mapping; revocation restores the prior mapping
   and rebuilds affected links/leads. Source observations are never deleted by a merge.
6. Only authorized evidence may support a candidate visible to that reviewer. Unreviewed
   candidate edges do not participate in analytics or cross-case findings.

## Structural projection

Scope first to the authorized case set and active assertions at a recorded cutoff.
Include Person, Account, Transaction, Case, Location, Organization. Include OWNS_ACCOUNT,
SENT_FROM, SENT_TO, COMMUNICATED_WITH, INVOLVED_IN_CASE, LOCATED_AT, and explained RELATED_TO.
Exclude Document/Evidence/support labels and all edges touching them, candidate matches,
and the redundant TRANSACTED_WITH shortcut (the transaction endpoint path already exists).
Include FLOWS_TO only in the isolated Elliptic benchmark projection, never the demo graph.

Use an undirected simple projection for degree, betweenness, and Louvain; collapse repeated
edges per endpoint pair and remove self-loops for these measures. PageRank uses directed
financial endpoints as Account → Transaction → Account and symmetric edges for associations.
Unit weights initially; report this choice. Communities are descriptive groupings.
Bound the interactive graph by the frozen demo subset; label sampled betweenness if used.
Keep all original multiedges and self-transfers in the evidence store.

## Query examples (design, not deployed code)

The backend derives `$allowed_case_ids` from authenticated grants, never from a caller's
unverified claim. The examples assume an already authorization-filtered materialization:
edge `case_ids` contains only cases in which that assertion has source support; evidence
references returned below are filtered again on read. Never return raw global node properties.

Cross-case lookup, including a purely nonfinancial Person association:

```cypher
MATCH (e {id: $entity_id})-[r:INVOLVED_IN_CASE]->(c:Case)
WHERE c.id IN $allowed_case_ids AND c.id IN r.case_ids
WITH e.id AS entity_id, collect(DISTINCT c.id) AS cases,
     collect(r.evidence_ids) AS evidence_groups
WHERE size(cases) > 1
RETURN entity_id, cases, evidence_groups
```

Bounded chronological financial cycle (no amount aggregation or FX inference):

```cypher
MATCH p=(a:Account {id: $account_id})-[:TRANSACTED_WITH*2..4]->(a)
WITH p, relationships(p) AS hops
WHERE all(h IN hops WHERE h.event_time IS NOT NULL
  AND h.payment_currency IS NOT NULL
  AND h.receiving_currency IS NOT NULL
  AND h.payment_currency = h.receiving_currency
  AND h.payment_currency = hops[0].payment_currency
  AND any(cid IN h.case_ids WHERE cid IN $allowed_case_ids))
  AND all(i IN range(0, size(hops)-2)
    WHERE hops[i].event_time < hops[i+1].event_time)
RETURN [h IN hops | h.transaction_id] AS transaction_ids,
       [h IN hops | h.evidence_ids] AS evidence_groups,
       [h IN hops | h.event_time] AS event_times
LIMIT 50
```

Use the same predicates for bounded source-to-destination paths. Limit query runtime
and report truncation. Unknown/assumed time basis is visible; incompatible time bases
must not be combined. Currency mismatch/FX and equal-time paths are excluded from verified
routes and counted in diagnostics. A cycle does not imply the same funds traversed it.

## Lead contract

Required: lead ID, category (`connection` or `flagged_behavior`), technique IDs, subject IDs,
case scope, plain-language reason, evidence IDs, algorithm/projection versions, synthetic
origin, review state, and created time. Structural metrics live only in `structural_context`.
Behavioral scores identify their model and unit; they are not comparable across datasets.
Deduplicate within category by subject/technique/evidence set. Cross-category records may
link to one another, but do not combine scores. See evaluation for ranking and review rules.
