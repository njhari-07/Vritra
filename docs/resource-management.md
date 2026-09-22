# Local resource budgets

The project now lives in `/opt/MAHA` on the root partition.
`/home/nj/MAHA` is a compatibility symlink to that directory.
The move verified 19,850 entries (file SHA-256, permissions, and symlink targets)
before deleting the original copy. See `artifacts/qa/storage-migration.json`.
Docker Desktop storage and external Codex runtimes remain under home. A storage check on 2026-09-20 confirmed
that `/home` is on `/dev/nvme0n1p6` and `/` is on `/dev/nvme0n1p5`.
They are separate filesystems; the earlier statement that they shared a filesystem
was incorrect. Relocating selected files to the root filesystem can relieve home
partition pressure, but does not reduce total disk usage. `/tmp` is memory-backed;
putting large datasets there consumes RAM and is not durable storage.

The full Elliptic ZIP and IBM CSV are retained. Elliptic validation reads all three
CSV members directly from the ZIP. Redundant extracted classes and edges were
removed only after their SHA-256 hashes matched the archive members. The existing
record index was losslessly compressed with a matching decompressed SHA-256.
These changes reclaimed 30,225,149 bytes (28.8 MiB); the cleanup log is
`artifacts/qa/resource-cleanup.json`.

Elliptic evaluation streams row provenance into
`artifacts/evaluation/elliptic-record-index.jsonl.gz` instead of retaining 203,769
record dictionaries during training. Models train sequentially with two workers.
The feature matrix, ID lookup tables, and current model still occupy RAM; this is
not an out-of-core training pipeline. The loader's default programmatic interface
still returns normalized records for compatibility; evaluation uses its streaming
writer option.

Interactive defaults, configurable in `.env` before restarting:

| Variable | Default | Behavior |
| --- | ---: | --- |
| `MAHA_MAX_IMPORT_RECORDS` | 5,000 | Whole import rolls back when exceeded, including its source blob and duplicate index entries. |
| `MAHA_MAX_GRAPH_FACTS` | 20,000 | Ledger and Neo4j queries fetch at most limit + 1 and reject an oversized projection. |
| `MAHA_MAX_GRAPH_NODES` | 2,000 | Rejects large projections before graph analytics. |
| `MAHA_MAX_CANDIDATE_PAIRS` | 20,000 | Rejects excessive name comparisons before the pairwise loop. |

The API returns HTTP 413 with an explanation, never a silently truncated result.
These are per-operation limits, not a process-wide memory guarantee. The UI uses
all cases granted to the current account; narrower scope currently requires a
separately configured account or programmatic projection. Benchmark dataset
validation is separate from interactive ingestion and still processes the full
datasets. Large global Neo4j synchronization and concurrent requests remain
limitations of this local prototype.

Duplicate detection uses a persistent indexed SQLite table scoped by case and
dataset. Existing evidence is migrated by streaming rows once. Import history and
audit queries apply authorization and a 200-row limit inside SQL. Source download
authorization is checked before loading its blob into memory. Neo4j remains
configured for a 512 MiB maximum heap and 256 MiB page cache.

Do not remove the private ledger, access file, Docker data volume, or source
datasets to reclaim space. They contain evidence, credentials, or reproducibility
inputs. Rebuildable dependencies are retained so the local application stays usable.
