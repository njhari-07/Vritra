# Synthetic location timeline evaluation

Run from the repository root. The tests create isolated temporary ledgers and generate their data at runtime.

```bash
.venv/bin/python -m pytest -q tests/test_locations.py
npm --prefix frontend run build
```

| Check | Expected and observed synthetic result |
| --- | --- |
| Scenario and source coverage | Six observations and four contextual events. The 10 timeline rows resolve to their exact original CSV records and the original bytes match the retained SHA-256. A repeat load recognizes all 10 records. |
| Subject and time window | DEMO-A returns L01 in the 08:00–08:01 UTC window. The CSV import converts a +05:30 timestamp to UTC and the query rejects a timestamp without a timezone. |
| Place proximity | At the grid origin with a 100 m radius during that window, GPS rows L01 and L03 fit under their stated accuracies. Tower row L02 has possible overlap. Later locations outside the radius are absent from the result. |
| Pair proximity | DEMO-A and DEMO-B have possible overlap. DEMO-A and DEMO-C fit under their stated accuracies at the 60-second tolerance. Their timestamps differ, so a zero-second tolerance yields no result. Labels on the same device do not produce a pair. |
| Case isolation and capacity | An unauthorized account cannot open the observations, load the scenario, or retrieve its evidence. The case graph stays empty. An over-capacity import rolls back the new evidence and import history entry. |
| CSV validation | An invalid radius quarantines the row. A false synthetic marker rejects the upload with no recorded import. |

The Chrome smoke check used a temporary ledger and verified the demo import, six accuracy circles, the tower row and source drawer, proximity results, keyboard navigation of the time cursor, and grid fit at 390 CSS pixels. The frontend production build passed. The full application suite reported 90 passing tests and two skips.

These checks exercise a scripted development scenario with known times, coordinates, and provenance. They measure location query behavior and the ability to retrieve source rows. Real-world location accuracy and lead usefulness are unmeasured. Future work includes independent synthetic evaluation of contradictions and the two weak-evidence test cases for lead priority.
