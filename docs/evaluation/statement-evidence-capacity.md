# Statement evidence capacity regression

This regression uses a synthetic case with 1,200 graph nodes and a synthetic workbook with 900 transactions. The preview estimates 2,100 nodes against the default 2,000-node cap.

- Direct graph import rolls back on capacity failure.
- Saving as evidence preserves all 900 rows and original workbook bytes. The financial explorer totals the saved rows while the case graph contains its original 1,200 nodes.
- Repeating the upload recognizes all 900 rows. Publishing fails atomically at the default cap and succeeds once in a test case with sufficient capacity.
- Out-of-scope publication is rejected.

Run from the project directory.

```sh
.venv/bin/python -m pytest -q tests/test_statements.py -k statement_evidence_can_be_saved_beyond_graph_capacity
```

These checks cover intake and publication behavior on synthetic data. Parser generalization and OCR accuracy require a separate evaluation with held-out layouts.
