# Document intake

## Findings before implementation

The bank-statement adapter already reads digital and scanned PDFs, Excel workbooks, and images. It keeps source row locations, supports correction and replay, and checks running balances and printed totals when the source supplies them. Synthetic regressions cover wrapped payment headers and transaction rows split across pages. FIR and court uploads already use the local document OCR and NLP readers. Structured CSV and JSON imports use the existing ingestion adapters.

The original upload form asked the investigator to select an adapter. Statement preview covers a sample of rows and offers corrections for rejected fields. Intake still needs a complete review queue, per-field quality indicators, and an explicit accept or reject decision for each record. The original statement import also allocated one case-graph node per transaction, even when the investigator only needed the dedicated financial explorer.

## Statement evidence and the case graph

Statement preview estimates the graph impact from newly accepted rows, excluding evidence IDs already saved. The import and publication paths enforce the actual cap inside the SQLite write transaction. The normal graph import publishes accepted transactions immediately. **Save as statement evidence** retains the original bytes, the same source and evidence IDs, row locations, correction history, and normalized transactions for reconciliation and the financial explorer. The case graph only receives those transactions when the investigator selects **Publish to case graph** in Quality. Publication checks the case budget, reuses the existing graph fact format, and records an audit event. Repeated imports and publications are idempotent for the same records.

## Unified intake design

The shared upload entry point profiles the local file before import. Digital headers, workbook headers, some narrative headings, and a bounded scan of the first page can suggest a reader. Investigators can correct the suggested type. Exact template formats are still recognized when uploaded through this same entry point. Inspection keeps the ledger read-only.

Call and wire reports have a source-page review with table column mapping, page ranges, date order, and an explicit timezone setting for timestamps that lack an offset. Saving reviewed records retains original bytes and page, table, and row locators. Unreadable rows and skipped pages require acknowledgement before a partial import. Calls go to a separate report explorer with a directed graph and timeline. Reviewed wire transfers can populate the case graph. English FIRs and judgments also retain common printed fields as source-linked observations for review.
