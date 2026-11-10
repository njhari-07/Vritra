# Montagna structural benchmark

Source [Cavallaro et al., Zenodo record 3938818](https://doi.org/10.5281/zenodo.3938818).
The three downloaded files match the release MD5s. Run from the project root.

```bash
.venv/bin/python -m maha.montagna data/raw/montagna
```

The output goes to `artifacts/evaluation/montagna-evaluation.json`. It is served
through the Benchmarks tab. This is an isolated research case with separate
meeting and phone layers. It does not create live investigation dossiers.

The published description reports 101 meeting nodes, 100 phone nodes and 47
shared nodes. This run measures 95 and 94 incident nodes with 46 shared after
projection. The loader uses only edge-list endpoints, drops self-loops and
collapses repeated and reciprocal edges. The phone CSV contains an endpoint
written as `52`; the loader maps it to `N52`, which appears in both the phone
edge list and role file. Raw files are unchanged. Edge weights are ignored to
match the app's unweighted structural projection, with reciprocal arcs for
PageRank. The benchmark uses the same centrality and Louvain code as the app.

| Layer | Nodes / ties | Boss / member median rank, degree | Betweenness | PageRank | Clan ARI |
| --- | --- | --- | --- | --- | --- |
| Meetings | 95 / 248 | 44.5 / 49 | 66 / 66 | 33 / 58 | 0.410 (31 labels) |
| Phone calls | 94 / 120 | 38.5 / 28.5 | 43.5 / 61 | 16.25 / 33 | 0.370 (25 labels) |

Ranks are descending over the entire layer, with average ranks for ties.
The release provides free-text roles. The comparison uses explicit boss and
member prefixes, excluding deputy bosses from the strict boss group. Member
is the source label; the evaluation does not infer soldier status. Clan labels
come from explicit quoted family names. Louvain runs on the entire layer
before adjusted Rand index is computed on the labeled subset.

Only one of seven meeting bosses ranks 10 or better by degree. None does
by betweenness or PageRank. One of two phone bosses ranks 10 or better by
PageRank. Clan agreement is partial on both layers. These descriptive results
use small, incompletely labeled, anonymized observation networks. They
sanity-check structural ranking against recorded roles on this release.
