# VRITRA · Evidence workspace

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

Case files, evidence, and findings are saved in the private SQLite ledger at
`data/private/runtime/ledger.sqlite3`. VRITRA also saves the last active case for
each user and reopens it after the workspace is unlocked. Creating a new case
keeps existing cases in the case selector.

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

SQLite is the source of truth. With Neo4j configured, the API reconciles the
ledger's committed revision in the background, including writes from CLI imports.
Neo4j publishes its revision in the same transaction as the graph replacement.
Until the revisions match, case graph reads use the SQLite ledger and identify
it as their backend. A failed sync is retried automatically with backoff.
Use `maha sync` to reconcile immediately. Run a dedicated Neo4j database per
ledger. Synchronization still rebuilds the MAHA projection in one transaction.

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

### FIR and judgment document intake

In **Import records**, choose an English FIR or Indian court judgment and upload
a PDF, JPEG, or PNG. MAHA reads usable embedded PDF text and runs local English
Tesseract on scanned pages. Install Tesseract and the English language data for
scan support. On this local Ubuntu installation, the private
`data/private/ocr-runtime/` directory provides the fallback runtime.

Use **Quality** to open an extracted observation, see its page and text source,
preview the original page, or download the file. Judgment mentions enter the existing review panel.
Document offsets refer to extracted page text. The importer preserves originals
and leaves NLP output as review evidence. Current limits are 25 MiB per upload,
20 PDF pages, 20 megapixels per OCR image, and 100,000 extracted characters.
This document adapter handles printed English prose. CDR and statement tables
still use their existing structured adapters.

### Bank statements

Create or select a case and open **Import records → Upload file**. Choose
**Bank statement (PDF, Excel, or scan)**, confirm the currency and numeric date
order, attach your file, and enter its password if protected. The adapter
supports text and scanned PDFs, PNG, JPEG, and multipage TIFF scans, and Excel .xlsx and .xls worksheets
with a recognized date and debit/credit or amount header. `Post Date` and `Value Date` are supported date
headers. If those are the only two date columns, the importer uses `Post Date`
for the timeline and preserves both source cells in the row evidence.
When the primary PDF reader cannot recover transaction cells, a second local
PDF text reader tries the embedded text before OCR. Local OCR can recover
headings or full scanned rows. For sideways, upside-down, and slightly tilted
scans, it can correct the orientation and still record each row's position on
the original page.
When the first reader accepts some rows and rejects others with readable dates,
another reader can recover a rejected row if both readers agree on a transaction
on the page and the replacement matches one source location.
The scanner uses ruling lines to keep wrapped details inside the same transaction. When only a signed
amount column is available, explicit Dr/Cr markers set direction. Without a
marker, positive values are credits and negative values are debits. The
parser accepts comma decimals with two fractional digits and validates their
digit grouping. Save encrypted legacy .xls files as .xlsx before uploading.

**Preview transactions** shows up to 25 extracted rows, validation errors, and
checks of adjacent running balances. It leaves the case ledger untouched.
For a ruled two-date, seven-column table with unreadable headers, the preview
can recover the layout when at least three transactions reconcile. Different
date values require readable date labels for that recovery.
If the headings are unfamiliar, open **Map columns manually** and enter the
column numbers from left to right. For borderless PDFs or scans, supply column
dividers as percentages of the page width or place them on **View PDF or scan page**.
Preview the result before importing.
For ruled PDFs and TIFFs, the importer can reuse a verified mapping from a nearby
page when the column borders match. Preview identifies the page that provided the
mapping. Only selected pages provide imported transactions. Rejected rows with
mapped cells can be corrected in the preview. The evidence drawer records the
extracted and corrected values with the reviewer.

A statement upload can read up to 200 PDF or TIFF pages, separate from the 20-page
document OCR limit. The default record limit is 5,000 per upload and the case
graph has a separate default limit of 2,000 nodes. Use **PDF or TIFF pages** to select a
page or range such as `1-10` when testing a layout or importing a large file.
Overlapping ranges of the same source count as repeats. Each import retains the
full original file and uses its original page numbers in the evidence. If the
import would exceed the case's graph capacity, MAHA rejects the whole batch.
The upload form shows progress and errors next to **Validate and import**.

After upload, the confirmation shows accepted, repeated, and quarantined counts.
**Quality** lists rejected row reasons and the page coverage of each statement
batch. The expandable transaction table shows both dates, narration, reference,
debit, credit, balance, and original row evidence.
For a saved PDF or TIFF, **Recover another page from this statement** previews
and imports a selected page from the retained source. Protected PDFs require
the original password for each request.
**Timeline** shows recognized transaction dates, with date-only records displayed
as dates. **Run case analysis** can rank unusual amounts in groups of at least
eight date-only transactions. These statement rows do not create account links
or fund-flow edges.

The original stored blob is byte-for-byte the upload. For an encrypted statement
it remains encrypted, with the same SHA-256 as the file received. MAHA uses the
password for that request and retains only the original blob and extracted
records, including row evidence. From the drawer, **Re-check original row**
opens the source again and compares it with the ingested row. Encrypted files
ask for the password again. Automated evidence audits defer statement replay to
this review action.
