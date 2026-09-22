# Actual source sample inspection

Inspected 2026-09-19 using public Kaggle download endpoints, without credentials.
This satisfies direct inspection of initial records for the Week 0 schema decision;
it is not a complete dataset audit or evaluation.

Each request retrieved bytes 0–65535. IBM returned CSV bytes. Elliptic returned ZIP
prefixes; their initial deflate streams were expanded and only complete newline-terminated
CSV records retained. No full ZIP CRC check is claimed. Partial trailing rows were
excluded from this design sample, not treated as corrupt source records.

| Source | Complete data records inspected | Columns | Header |
|---|---:|---:|---|
| elliptic_txs_features.csv | 79 | 167 | None |
| elliptic_txs_classes.csv | 14,073 | 2 | txId,class |
| elliptic_txs_edgelist.csv | 8,544 | 2 | txId1,txId2 |
| HI-Small_Trans.csv | 684 | 11 | Two separate Account columns |

No empty cells were found in these excerpts. This makes no claim about the remaining
records, label balance, file-wide time range, duplicates, or overall data quality.

## Observed mappings

Elliptic feature record 1 (physical line 1) begins with transaction `230425980`, time
step `1`, and 165 numerical predictors after the step. Class record 1 (line 2) gives
that transaction `unknown`, so it cannot become a supervised negative. Edge record 1
(line 2) is `230425980` → `5530458`, connecting transaction IDs.

IBM record 1 (line 2) has timestamp `2022/09/01 00:20`, source and destination bank
`010`, source and destination account `8000EBD30`, paid/received amount `3697.34`,
currency `US Dollar` on both sides, payment format `Reinvestment`, and synthetic
evaluation label `0`. It is a self-transfer. Preserve the leading zero and source
record; exclude self-loops only from the stated structural projection.

The timestamp contains no zone. The proposed synthetic UTC convention is an explicit
import assumption; it is not observed timezone metadata. Both currency fields and both
account fields remain separate despite this particular row having identical values.

See [machine-readable inspection](dataset-inspection.json) for endpoints, fragment hashes,
excerpt hashes, observed label counts, raw headers, mapped records, and exact sample locators.
Raw review excerpts are retained under `data/private/review/` with private directory/file
permissions and excluded from Git. They are not registered as operational case evidence.

## Remaining ingestion checks

Download complete files and record their actual sizes and SHA-256 hashes; validate full
archive integrity where applicable. Profile all records, inspect middle/end examples,
validate cross-file ID coverage, and freeze exact temporal split counts. The initial
excerpts are not random samples and cannot support benchmark metrics or prevalence claims.
No real or synthetic case narratives have been loaded, and no model has been trained.

## Download size and local capacity

Checked public HTTP Content-Range totals on 2026-09-19:

| Download | Bytes | Approximate decimal size |
|---|---:|---:|
| Complete Elliptic dataset ZIP | 153,218,318 | 153 MB |
| Elliptic features single-file ZIP | 150,601,883 | 151 MB |
| IBM HI-Small_Trans.csv | 475,664,283 | 476 MB |

The features ZIP64 local header reports 689,683,771 uncompressed bytes (690 MB).
This header size has been read, but full decompression and CRC validation have not
been performed. Budget roughly 2–3 GB for downloaded source and processed copies,
plus separate Neo4j storage. Actual graph/index sizes must be measured after import.
Avoid full-data DataFrames as the default: stream CSV chunks and restrict interactive
graph work to the frozen demo subset. These are the selected files, not the entire
multi-variant IBM dataset. No full downloads have occurred.
