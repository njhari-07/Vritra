# Document intake

## Findings before implementation

The bank-statement adapter already reads digital and scanned PDFs, Excel workbooks, and images. It keeps source row locations, supports correction and replay, and checks running balances and printed totals when the source supplies them. Synthetic regressions cover wrapped payment headers and transaction rows split across pages. FIR and court uploads already use the local document OCR and NLP readers. Structured CSV and JSON imports use the existing ingestion adapters.

The original upload form asked the investigator to select an adapter. Statement preview covers a sample of rows and offers corrections for rejected fields. Intake still needs a complete review queue, per-field quality indicators, and an explicit accept or reject decision for each record. The original statement import also allocated one case-graph node per transaction, even when the investigator only needed the dedicated financial explorer.

## Statement evidence and the case graph

Statement preview estimates the graph impact from newly accepted rows, excluding evidence IDs already saved. The import and publication paths enforce the actual cap inside the SQLite write transaction. The normal graph import publishes accepted transactions immediately. **Save as statement evidence** retains the original bytes, the same source and evidence IDs, row locations, correction history, and normalized transactions for reconciliation and the financial explorer. The case graph only receives those transactions when the investigator selects **Publish to case graph** in Quality. Publication checks the case budget, reuses the existing graph fact format, and records an audit event. Repeated imports and publications are idempotent for the same records.

## Unified intake design

The shared upload entry point profiles the local file before import. Digital payment headers, workbook headers, some narrative headings, and exact template headers can suggest an existing reader. Locked files, scanned inputs, and unfamiliar formats can be routed by the investigator using the format picker. Inspection keeps the ledger read-only. The original templates remain under **Advanced imports**.

The review stage will show original pages or workbook rows next to extracted records. Source locations, reader agreement, OCR confidence, and reconciliation results will explain why a field needs review. Acceptances, corrections, rejections, and quarantine reasons belong in case-scoped review history. The commit will use the existing ledger and graph limits, retain original bytes, and keep decimal amounts in the supplied currency.
