# Minimum demo and acceptance checklist

Status: working script adopted for the user-directed solo workflow. All named identifiers below are
design placeholders. This document does not load or author realistic case records.

## Demonstration sequence

1. Sign in as an investigator assigned to synthetic cases `DEMO-C01` and `DEMO-C02`.
   Show the persistent synthetic-data badge and case scope.
2. Import a frozen IBM HI-Small subset through a controlled local import job. Show
   accepted, quarantined, repeated-import, and possible-duplicate counts. Drill into
   one original CSV record. A second import must add no duplicate transactions.
3. Import 24 explicitly synthetic narratives with case IDs and filed dates, plus
   a small synthetic CDR file. Generate these only after protection controls exist.
   Reference actual bank/account IDs from the frozen IBM subset; fictional owner
   assertions must be marked team-authored, never attributed to IBM.
4. Resolve an exact bank/account identifier across narrative and CSV observations.
   Show two similar person names as a pending match. Accept one candidate, inspect
   its audit entry, then undo the decision and restore the previous graph view.
5. Open a person explicitly referenced by the same authoritative synthetic person ID
   in both cases. Show both case-document passages and a communication connection.
   This cross-case finding must work with every financial relationship hidden.
6. Explore the authorized graph. Display degree, betweenness, PageRank, and community
   membership under **Connections**. Explain the selected projection and case scope.
7. Open **Flagged behavior**, select an anomalous transaction, and show model version,
   model inputs, score meaning, and its original row. Do not show a person's risk score.
8. Trace a bounded, strictly time-ordered, same-currency chain/cycle. If the IBM
   subset has no suitable cycle, use a separately labeled team-authored fixture;
   do not alter IBM rows or call that fixture IBM evidence. Reject the reverse-time
   and currency-mismatch controls. Describe a possible route, not traced identical money.
9. Review a lead, record relevant/not relevant/insufficient evidence with a rationale,
   then export an evidence-linked report with source origin and limitations.
10. Switch to an account without access to the second case. Its documents, counts,
    cross-case findings, graph connections, and export content must no longer appear.

Elliptic results are shown in a separate evaluation view labeled **Transaction
classification benchmark**. They are not joined to fictional people or cases.

## Acceptance checklist

- [ ] Every imported source and derived item preserves dataset origin and synthetic status.
- [ ] Every accepted node, edge, and displayed finding resolves to at least one source locator.
- [ ] Exact identifier linkage is demonstrated across structured and text records.
- [ ] Names alone never trigger automatic merging; reviewed matches are reversible.
- [ ] Nonfinancial cross-case correlation works with no financial path.
- [ ] Centrality/community results never increase a behavioral score.
- [ ] Re-import preserves transaction/node/edge counts while recording the new import run.
- [ ] Distinct identical-valued source rows are retained and flagged, not silently removed.
- [ ] Time/currency-invalid paths cannot appear in verified fund-flow results.
- [ ] Missing/invalid input is accounted for in a quality report.
- [ ] Case authorization is enforced in graph queries, evidence access, and reports.
- [ ] Elliptic and synthetic metrics are labeled and reported separately.
- [ ] Every UI/export result uses review language, never a verdict or guilt probability.

## Planned fixtures after the design gate

Use three cases, 24 narratives, and a bounded account-centered subset selected
deterministically from IBM after inspection. Target at most 10,000 transfer records
for the interactive demo; preserve selection seed, criteria, file hashes, and row IDs.
Keep separate controls for same-name/different-person, same-account/different-bank,
conflicting facts, malformed CSV, ambiguous time, duplicate imports, and denied access.
Split narrative templates into development and held-out families before tuning.
Freeze a separate manual annotation file for extraction and resolution evaluation.
