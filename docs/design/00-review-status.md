# Week 0 design review

Current implementation: [verification report](../verification.md). The sections below record the earlier design baseline.

Prepared 2026-09-19 against [handoff v2](../reference/project-handoff-v2.md).

## Gate status

**Working design baseline complete for starting the ingestion milestone.**
All seven review areas have written answers and the five required artifacts exist.
Following the user's instruction to start a solo workflow, the demo and engineering
choices are adopted as the initial baseline; no separate team approval is claimed.
Actual source excerpts from all four files were inspected and mapped. Full-file
profiling remains an ingestion acceptance requirement, not a completed result.

| Handoff review row | Written answer | Remaining closure evidence |
|---|---|---|
| 1. Minimum demo | [Demo and acceptance](01-demo.md) | Working script adopted under solo workflow instruction |
| 2. Dataset fit | [Mappings](02-data-contracts.md), [actual inspection](06-sample-inspection.md) | Samples verified; full-file profile pending |
| 3. Evidence model | [Provenance and locators](03-graph-and-evidence.md) | Sample record/line locators recorded; PDF locators tested in week 7 |
| 4. Graph design | [IDs, assertions, endpoints, query examples](03-graph-and-evidence.md) | Sample layout supports design; Cypher runtime checks scheduled week 5 |
| 5. Ingestion/resolution | [Contracts](02-data-contracts.md), [matching rules](03-graph-and-evidence.md) | Duplicate headers and naive minute timestamps verified; full currency vocabulary pending |
| 6. Evaluation | [Protocol](04-evaluation.md) | Freeze dataset manifest and split counts before experiments |
| 7. Delivery | [Owners, checkpoints, backlog](05-delivery.md) | Solo owner confirmed by user; later delegation deferred |

## Working decisions

- Use IBM HI-Small for the synthetic investigation demo; Elliptic remains an
  isolated transaction-classification benchmark. No inferred people/accounts in Elliptic.
- Use a shared evidence envelope with separate bank-transfer and Elliptic payloads.
- Preserve the two sides of a transfer (paid/received amount and currency).
- Keep immutable observations; make resolution a reversible mapping, not deletion.
- Add explicit transaction endpoints, document-case membership, and a distinct
  transaction-to-transaction relationship for Elliptic.
- Use separate structural and behavioral result lists, with explicit ranking rules.
- Start with Random Forest, Isolation Forest, NetworkX analysis of a Neo4j-backed
  projection, FastAPI, React, and vis-network. GDS is an optimization after parity checks.
- Build protection controls before importing realistic records, including synthetic ones.

## Evidence collected and limits

The workspace initially contained no data or implementation. The user confirmed no
local datasets were available. Provider documentation and then bounded public downloads
were inspected on 2026-09-19. The [inspection report](06-sample-inspection.md) records exact
observations. Review excerpts are private local files, not imported case records.
Full-file hashes, archive integrity, complete label/time coverage, and end-to-end joining
are not yet verified. Synthetic illustrative examples are identified separately.

## Next actions

1. Start W1-01 protection/bootstrap using this design baseline, schema version 0.1.
2. Retrieve complete original files; verify complete-file hashes/integrity and stream
   a profile. Do not substitute the reviewed excerpts for full benchmark releases.
3. Implement W1-02/W1-03 adapters, then quality/re-import reporting. Record schema drift
   explicitly if full profiling reveals exceptions to the reviewed layouts.
4. Keep analytics behind the populated-and-verified graph milestone.
