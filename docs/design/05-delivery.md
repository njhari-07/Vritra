# Solo delivery workflow and backlog

The user is currently working alone; team division is deferred. All workstreams have
one owner: **project owner (user)**, with Codex assisting implementation. Workstream
labels below describe sequencing, not fictitious team assignments or parallel capacity.
The original eight-week target is retained as a planning target, not a solo delivery guarantee.

## Schedule and integration checkpoints

| Week | Sequential focus | Exit evidence |
|---|---|---|
| 0 | Five design artifacts; actual source inspection; lock contracts/demo | Review gate closed with known assumptions |
| 1 | Protection/bootstrap; immutable source registry; CSV adapters | Valid/rejected/repeat records fully accounted for |
| 2 | Both dataset adapters; frozen IBM subset; 24 synthetic narratives after protection | CP2: mapped records, manifest, quality report, shared contract |
| 3 | Pretrained NLP extraction and exact identifier resolution | Span evidence and CSV-to-text exact linkage |
| 4 | Candidate review, reversibility, conflict handling | CP4: extraction/resolution audit and held-out annotations |
| 5 | Neo4j loader/projection; then thin list/detail dashboard | CP5: re-import-safe graph, evidence lookup, access-filtered API/UI |
| 6 | RF/IF baselines; structural analytics; fund-flow and cross-case queries | Frozen analytical controls pass, separated result categories |
| 7 | One fixed PDF layout; lead composition, graph UI, report export | CP7: full demo script passes; feature freeze |
| 8 | Verification, report, presentation | Measured results and honest limitations; no features |

Stand up API contracts and a minimal health/status page during bootstrap; connect the
list/detail view as soon as the graph is ready in week 5. Do not defer UI integration to
week 8. At each checkpoint rerun the same demo subset through every completed stage.

## First implementation tickets (after review closure)

| ID | Task | Depends on | Completion evidence |
|---|---|---|---|
| W1-01 | Python environment, config, case authorization, source registry, audit/retention controls | Design gate | Denied-access checks; import size/type limits; logged actions |
| W1-02 | IBM positional CSV adapter with decimal/currency/time contracts | W1-01, inspected header | Duplicate header and bank-scoped identity controls pass |
| W1-03 | Elliptic three-file adapter with separate transaction/flow records | W1-01, inspected files | Unknown labels preserved, cross-file IDs validated |
| W1-04 | Quality report, quarantine, repeat-import manifests | W1-02/W1-03 | Every row disposition reconciles; repeat import stable |
| W2-01 | Freeze dataset subset and gold inspection samples | W1-04 | Hashes, selection rules, origin labels recorded |
| W2-02 | Author 24 synthetic narratives and CDR controls | W2-01, protection checks | Synthetic flags on every record; actual IBM account references |

## Protection baseline before realistic records are loaded

- Bind local services to loopback by default; no public deployment in this milestone.
- Require an authenticated user and explicit case grants for investigation endpoints.
  Enforce filtering server-side before graph algorithms, candidate matching, counts,
  evidence retrieval, and exports. Grant revocation invalidates caches and results.
- Keep dataset benchmark storage separate from case evidence. A trusted local import
  job can stream larger benchmark files; the web upload limit is 25 MiB per file with
  extension/content validation. No archive uploads or arbitrary filesystem paths from clients.
- Keep raw/quarantine data outside public/static directories, private to the local user.
  Use generated storage IDs; reject traversal and symlinks at intake boundaries.
- Audit imports, evidence reads, match decisions/revocations, exports, and deletions with
  actor/time/case/action/result. Avoid source passages and secrets in general logs.
- Prototype retention: delete raw, processed, quarantined, cached, and exported case data
  30 days after the owner closes a demo case; delete derived graph material too. Keep
  minimal audit metadata for 90 days, without passage text. Apply deletion to local
  backups, or do not create those backups. Provide an explicit purge command and test it.
- Synthetic demos require these controls too. Real operational cases require a separate
  readiness review and are outside this academic prototype's initial data plan.

## Must-have backlog

CSV adapters for both datasets; tagged synthetic text/CDR examples; pretrained extraction;
exact and reviewed candidate resolution; reversible merges; Neo4j with full provenance;
RF/IF plus all structural/fund-flow/cross-case techniques; separated lead queues; thin
React dashboard with vis-network; one fixed-layout PDF adapter; evidence-linked report;
quality logs; access/audit/retention controls; the evaluation protocol and presentation.

Use deterministic/rule extraction for identifiers alongside pretrained NER for names and
locations. Freeze one English pretrained pipeline first; multilingual support is deferred.
No custom model training or external LLM dependency is required for the initial pipeline.
Start graph algorithms in NetworkX over a bounded Neo4j projection; consider GDS only
after correctness and environment support are established.

## Stretch and scope pressure

Stretch: scanned OCR, arbitrary PDF layouts, extra formats, semantic candidate retrieval,
GDS optimization, richer graph controls, multilingual extraction. Start none before
must-haves pass. If solo capacity slips, reduce demo size/UI polish first, then explicitly
replan unfinished must-haves with the user. Do not silently declare required analytics
or the fixed PDF adapter optional, or use week 8 for unfinished features.

Non-goals remain: predictive policing, person risk scores outside active cases, guilt
probabilities, legal determinations, cybersecurity telemetry, threat-intelligence modules,
and training a custom NER model from scratch.
