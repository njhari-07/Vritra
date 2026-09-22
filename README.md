# MAHA · Evidence workspace

A runnable local academic prototype for the BAI506 criminal-network analysis project.
FastAPI + React/vis-network + Neo4j, with an immutable SQLite evidence ledger.

**Status:** ingestion, pretrained extraction, reversible resolution, graph construction,
analytics, dashboard, fixed-layout PDF intake, and baseline evaluation are implemented.
This is a synthetic investigation demonstration and a separate real transaction benchmark;
it is not an operational policing system or a validated assessment of people.

The installed project is stored at `/opt/MAHA` on the root partition.
`/home/nj/MAHA` remains a compatibility link, preserving existing virtualenv paths.
Docker Desktop and the bundled Python runtime remain external dependencies under home.

## Open the installed workspace

The local app runs at **http://127.0.0.1:8765**. Access tokens are stored privately in
`data/private/runtime/access.json`: `investigator` has three demo cases; `restricted`
has only DEMO-C01. Paste a token into the login screen. Tokens are kept in browser memory
only and cleared by Lock workspace or a reload.

If the service has stopped, from this folder:

```bash
docker compose up -d
.venv/bin/python -m maha.cli serve
```

The app binds to loopback. Neo4j uses loopback ports 7474 and 7687; its randomly generated
password is in the ignored `.env`. Do not expose either service publicly.

## Reproduce on another machine

Requires Python 3.12, Node 20.19+ or 22.12+, pnpm 11, Docker Compose, and about 2 GB of
project storage plus Docker image/volume space. Source datasets remain out of Git.

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/pip install -e .
cp .env.example .env
# Edit NEO4J_PASSWORD in .env to a random local password before starting Neo4j.
docker compose up -d
.venv/bin/python scripts/download_data.py
.venv/bin/python -m maha.cli init
.venv/bin/python -m maha.cli demo --ibm data/raw/HI-Small_Trans.csv
.venv/bin/python -m maha.cli sync
cd frontend
ppnpm install --frozen-lockfile
pnpm build
cd ..
.venv/bin/python -m maha.cli serve
```

The lock includes the pretrained `en_core_web_sm` 3.8.0 model. Installation needs internet
access to PyPI, GitHub, and the npm registry. The downloader uses public Kaggle endpoints;
provider access requirements may change. Elliptic stays in its original ZIP to save disk;
the benchmark also supports extracted CSVs under `data/raw/elliptic`.

## Try the full investigation flow

1. Open **Overview**: three cases, graph, and two separate finding categories.
2. Select Arun Mehta's cross-case finding and inspect its exact document passage.
   This linkage works without financial edges. The narratives explicitly identify him
   as a witness; case association is not suspicion.
3. Use **Connections** for centrality/community context, and **Flagged behavior** for
   descriptive transaction anomalies and a chronological same-currency cycle.
4. Use **Resolution** to inspect name-match candidates, record a decision, and undo it.
   Exact identifiers resolve automatically; names alone never do. Conflicting identifiers
   also block transitive matches.
5. Inspect **Timeline**, **Quality**, and **Audit**. Use **Import records** for synthetic
   IBM-format CSV, narrative JSON, CDR, history CSV, or the single supported PDF layout.
6. Export an evidence-linked JSON report. Every source reference includes its exact row,
   character span, or PDF page/table row and bbox.
7. Lock the workspace and sign in with the restricted token: other cases and their
   cross-case results disappear. Raw files shared across cases require all their grants.
8. **Benchmarks** displays dataset-specific temporal evaluation, separately from leads.

Import examples are generated under `data/private/runtime/demo-sources/` after controls
are initialized: 24 case narratives, CDR, history, a 120-record IBM prefix subset, separate
team-authored cycle controls, and a fixed-layout statement. Each generated record/source
is labeled synthetic; fictional ownership assertions are never attributed to IBM.

## Evaluation and tests

```bash
.venv/bin/python -m maha.cli profile-ibm data/raw/HI-Small_Trans.csv
.venv/bin/python -m maha.cli evaluate --elliptic data/raw/elliptic
.venv/bin/python -m maha.cli evaluate-ibm data/raw/HI-Small_Trans.csv
.venv/bin/python -m maha.cli evaluate-demo
.venv/bin/python -m pytest -q
MAHA_NEO4J_TEST=1 .venv/bin/python -m pytest -q
```

The last command additionally needs a running, seeded, synchronized Neo4j service.
Reports live under `artifacts/evaluation/`; committed summaries are in
[verification](docs/verification.md). Elliptic uses steps 1–29 train, 30–34 validation,
35–49 test; unknown labels never become negatives. IBM evaluation uses a fixed seeded
50,000-record reservoir and chronological partitions, with time ties kept together.

## Architecture and operating limits

- `maha/store.py`: private source blobs, evidence, assertions, permissions, audit, retention.
- `maha/ingestion.py`, `maha/nlp.py`: strict adapters, NER, explicit relation rules, candidates.
- `maha/graph.py`: Neo4j typed relationships and evidence-scoped assertions; local test fallback.
- `maha/analytics.py`, `maha/benchmark.py`: projected graph analysis, bounded flow search, temporal ML.
- `maha/api.py`, `frontend/`: authenticated API and React investigation workspace.
- `docs/design/`: the five design artifacts and initial source inspection.

Neo4j is the served graph when `.env` is loaded via the CLI. SQLite retains original
observations; graph sync is an atomic replacement of only `Maha`-labeled graph data.
After trusted CLI imports, run `sync`. Web imports sync automatically. If synchronization
fails, the import remains in the ledger and must be retried with `sync`; Neo4j errors are
not silently replaced with fabricated results.

The graph demo is bounded and deliberately small. Full datasets are profiled/evaluated
separately; the app does not load five million transfers into an interactive browser.
Relation extraction supports explicit templates, not arbitrary legal narratives. PDF
support is only MAHA-DEMO-STATEMENT v1, not commercial bank layouts or OCR. Structural
metrics have no criminality score. Descriptive dashboard Isolation Forest scores are
in-sample demonstrations, distinct from held-out benchmark metrics.

Case closure and purge:

```bash
.venv/bin/python -m maha.cli close-case DEMO-C01
.venv/bin/python -m maha.cli purge
```

Purge removes managed case evidence after 30 days, cleans generated source copies,
resynchronizes Neo4j, and removes audit entries after 90 days. User-owned input files,
externally downloaded exports, and externally created backups are outside managed
retention and must be handled by their owner. No automatic scheduled purge is installed.

The original [v2 handoff](docs/reference/project-handoff-v2.md) is preserved. See
[implementation decisions](docs/implementation-notes.md) for scope boundaries and remaining work.
# Resource management

See [local resource budgets](docs/resource-management.md) for memory limits,
compressed dataset handling, and the verified cleanup record.
