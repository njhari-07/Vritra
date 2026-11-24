# VRITRA · MAHA evidence workspace

VRITRA is a local criminal-network analysis workspace for the BAI506 project. It helps investigators ingest case records, inspect the original evidence behind each finding, and review relationships, money movement, and timelines. Findings are leads for human review. The project has been evaluated on synthetic investigations and separate benchmark datasets.

## Local setup

Run setup commands from the repository root. The existing Ubuntu installation is at `/opt/MAHA`. On a new checkout, use Python 3.12 and Node.js 22.12 or newer with npm 10.5.1 or newer. Docker Compose is optional for the Neo4j graph projection.

### Install dependencies and initialize the ledger

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
npm --prefix frontend ci
.venv/bin/python -m maha.cli init
```

Use `init` once per new ledger. It creates an investigator token for the three demo case IDs and a restricted token for `DEMO-C01`. An existing installation can go straight to starting the app. Python setup installs the general English spaCy model `en_core_web_sm`.

For scanned PDFs and images on Ubuntu, install Tesseract and its English language data. The OCR pipeline runs locally.

```bash
sudo apt install tesseract-ocr tesseract-ocr-eng
```

The Indian court judgment reader needs the optional `en_legal_ner_sm` model. Configure `MAHA_LEGAL_MODEL` to point to the extracted model directory with `config.cfg`. See [InLegalNER model setup and evaluation](docs/evaluation/inlegalner.md) for the compatible artifact.

### Start the backend and frontend

Open two terminals at the repository root.

**Terminal 1 — FastAPI backend**

```bash
.venv/bin/python -m maha.cli serve
```

**Terminal 2 — React and Vite frontend**

```bash
npm --prefix frontend run dev -- --port 5173 --strictPort
```

Open [the workspace](http://127.0.0.1:5173/app). Vite forwards `/api` requests to FastAPI at `127.0.0.1:8765`, including requests for local map assets. Check the backend at [`/api/health`](http://127.0.0.1:8765/api/health).

For a single-process setup, run `npm --prefix frontend run build` and serve the built frontend through FastAPI at [`http://127.0.0.1:8765/app`](http://127.0.0.1:8765/app).

### Unlock the workspace

Read the investigator token in your local terminal and paste it into the workspace sign-in. If you changed `MAHA_DATA`, use the `access.json` in that directory.

```bash
.venv/bin/python -c 'import json; from pathlib import Path; print(json.loads(Path("data/private/runtime/access.json").read_text())["investigator"])'
```

The token stays in browser memory and clears when you reload or lock the workspace. Cases, original sources, imports, and review decisions persist in the SQLite ledger. The app restores your last selected case after you unlock it. Keep the token and `data/private/` outside Git. With no Clerk publishable key, the frontend uses local token sign-in. Optional Clerk setup is documented in [`frontend/.env.example`](frontend/.env.example). The local API still checks its own token and case grants.

### Optional Neo4j and map assets

For Neo4j, create a root `.env` from [`.env.example`](.env.example) if it is absent. Set a local `NEO4J_PASSWORD`, start Docker, then run these commands. Restart a running backend to load the new configuration.

```bash
docker compose up -d neo4j
.venv/bin/python -m maha.cli sync
```

SQLite is the source of truth. When Neo4j is configured, the backend synchronizes the case graph in the background. Reads use the authorized SQLite projection when Neo4j is unavailable or behind the ledger revision. For a SQLite-only run on a machine with Neo4j configured in `.env`, start the backend with `NEO4J_URI= .venv/bin/python -m maha.cli serve`.

Optional local OpenStreetMap vector tiles provide an India overview and street-level detail around Bengaluru and Mysuru. The app reads them in ranges from `data/private/map-assets/`. The default outline map remains available without those assets. See [map installation and coverage](docs/design/location-timeline.md#install-map-assets) for the download and verification commands.

## Investigation workflow

1. Create a case or choose an existing one. Use **Sample datasets** to load a bundled fictional case, or start from your own documents in **Import records**.
2. Paste English case text and select **Extract mentions**, or upload the original file. MAHA inspects the file locally and suggests a reader. Confirm or change the suggested record format before importing.
3. Review saved records in **Quality**. Check accepted, repeated, and quarantined rows, page coverage, original-page previews, and the extraction details. Source locators record the relevant page and row, cell, or text span.
4. Review identity candidates in **Resolution** and confirm place matches in **Timeline**. Use the separate financial and call report explorers for source-level transaction and call review.
5. Run case analysis to inspect **Dossiers**, **Connections**, and **Flagged behavior**. Follow the evidence links before recording a decision or exporting a case-scoped report.

### Unified ingestion

| Input | Review workflow |
| --- | --- |
| English FIR, Indian court judgment, or pasted case text | Digital PDFs use their text layer where usable. Scanned PDFs, JPEGs, and PNGs use local English OCR. The readers retain legal mentions and common printed fields, with original wording and source positions for review. |
| Bank statement | Supports text or scanned PDFs, `.xlsx` and `.xls`, JPEG, PNG, and TIFF. Preview transactions, review page ranges and field mapping, correct eligible rejected rows, and compare running balances and any recognized summary totals. |
| Call detail or wire transfer report | Upload a PDF, JPEG, or PNG. Review columns, dates, source page ranges and the timezone of timestamps without an offset. Acknowledge any skipped pages or unreadable rows before saving a partial import. |
| Structured files | Recognized CSV and JSON templates still use the same upload entry point. Existing readers cover IBM-format transfers, synthetic narratives, call detail records, and FIR history. |

FIR and judgment document extraction supports up to 20 PDF pages per upload. Call and wire PDF review supports up to 20 selected pages. The statement reader supports up to 200 selected PDF or TIFF pages, subject to the upload size, OCR time, and row limits. The default import budget is 5,000 rows. See [intake design](docs/design/document-intake.md) and [resource limits](docs/resource-management.md).

### Bank statements and the 3D financial explorer

- Statement review preserves value date, post date, narration, reference, debit, credit, balance, and the original row location where available. The page coverage and reconciliation panels show which ranges were parsed and which balances or printed totals could be checked.
- Password-protected PDFs and supported encrypted Excel workbooks use a password for the current request. The retained original remains byte-for-byte what was uploaded. Encrypted legacy `.xls` files need conversion to `.xlsx`. Rechecking an encrypted original requires its password again.
- Use **Save as statement evidence** to keep a statement available for review and the financial explorer without spending the case graph's node budget. **Import to case graph** and **Publish to case graph** check the graph budget before publishing. The default budget is 2,000 graph nodes per case.
- Use **Quality → Open 3D money flow** to inspect incoming payments in green and outgoing payments in red. A bidirectional connection carries both colors. Select a counterparty to see its rows and open the source. Printed payment labels and narration-derived names are leads for review. A saved statement can be named and removed from the case through **Quality**.

Call reports have their own directed call graph and timeline. Reviewed wire reports can populate the main case graph with source-linked transfers.

### Timeline, location analysis, and evidence detail

- **Places from documents** extracts place mentions, printed addresses, reported sightings, and event locations from supported English sources. Confirm a suggested match before it appears on the map. A reviewer can link a reported sighting to a person in the current case.
- The map shows confirmed site pins and area references with separate markers. Click a marker to zoom in or open the source. Place lookup uses a local catalogue and can use a locally hosted Nominatim instance. Case locations stay on the local machine.
- Timeline filters, the call explorer, and the evidence drawer display India Standard Time (IST, UTC+05:30). The ledger uses UTC for timestamped comparisons. Date-only records retain their original precision.
- **Synthetic coordinate tools** can load demo observations and compare time windows, reported accuracy radii, and proximity. The evidence drawer links observations and location mentions to their original source pages or records. [Location workflow and reproduction](docs/design/location-timeline.md)

### Graph analysis and models

- The case graph gives a 2D and 3D view of entities and evidence-backed relationships. NetworkX computes degree, sampled betweenness, PageRank, and Louvain communities. Dossier rankings use evidence and graph heuristics. Fuzzy names remain candidate matches for investigator review.
- Fund-flow search follows ordered transfers in the same currency and checks time precision. Dates alone provide no within-day sequence.
- Live Isolation Forest fits the current transaction rows grouped by dataset, currency, and time precision. A group needs at least eight rows. It uses log amount and the recorded UTC hour for timed rows, or log amount alone for date-only rows. The same group is scored in memory. The output is an in-case anomaly ranking.
- General English and legal NER load pretrained spaCy models. Separate benchmark runs evaluate Elliptic and IBM models, Montagna network structure, and InLegalNER extraction. [Model and dataset details](docs/SYSTEM_HANDOFF.md) · [Verification reports](docs/verification.md)

## Verify and reproduce

```bash
npm --prefix frontend run build
.venv/bin/python -m pytest -q
.venv/bin/python -m maha.cli doctor
```

The timeline and map release check passed the frontend build and 102 backend tests. Two live Neo4j tests were skipped. Chrome verification used a fictional case to check street tiles in both themes, pin-to-PDF navigation, IST and date-only display, and the narrow evidence drawer. To include the Neo4j integration tests, supply a running, seeded, synchronized service and run `MAHA_NEO4J_TEST=1 .venv/bin/python -m pytest -q`.

Run the full synthetic investigation in an isolated ledger. Choose an empty output directory.

```bash
.venv/bin/python scripts/evaluate_synthetic_investigation.py --case DEMO-RIVER-VERIFY --out /tmp/maha-river-verify
```

The script generates fictional inputs and a report covering the normal ingest and analysis flows. Use the CLI for optional benchmarks once the source data is available under `data/raw/`.

```bash
.venv/bin/python -m maha.cli evaluate --elliptic data/raw/elliptic.zip
.venv/bin/python -m maha.cli evaluate-ibm data/raw/HI-Small_Trans.csv
```

The bundled sample cases and local setup work without downloading the large benchmark datasets. See [benchmark reproduction](docs/SYSTEM_HANDOFF.md#benchmark-reproduction) and [resource budgets](docs/resource-management.md). Keep generated outputs, private evidence, local model artifacts, map archives, and credentials out of Git.

## Repository guide

| Area | Role |
| --- | --- |
| `frontend/` | React 19, Vite, Tailwind and CSS. vis-network and Three.js for graphs. MapLibre for document locations. |
| `maha/api.py` and `maha/store.py` | FastAPI, case-scoped access, SQLite source and evidence storage, review decisions, and audit. |
| `maha/document_intake.py`, `maha/report_intake.py`, and `maha/statements.py` | OCR, document reading, table review, and reconciliation. |
| `maha/graph.py`, `maha/analytics.py`, and `maha/suspects.py` | Neo4j projection, graph analysis, transaction scores, and dossier ranking. |
| [`docs/`](docs/) | [System handoff](docs/SYSTEM_HANDOFF.md), [design](docs/design/), [evaluation](docs/evaluation/), and [original project handoff](docs/reference/project-handoff-v2.md). |

The CLI provides `close-case` and `purge` for managed retention. Purge removes expired managed case evidence after 30 days and audit records after 90 days. Exports and backups are managed by their owner.
