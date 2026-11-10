"""Bounded, isolated Neo4j benchmark using the ICIJ Offshore Leaks CSV archive."""
import argparse
from collections import Counter
import csv
import hashlib
from io import TextIOWrapper
import json
import os
from pathlib import Path
from statistics import median
from time import perf_counter
from uuid import uuid4
from zipfile import ZipFile

from neo4j import GraphDatabase

from .cli import load_env


def rows(archive, filename):
    member, = [name for name in archive.namelist() if Path(name).name == filename]
    with archive.open(member) as raw, TextIOWrapper(raw, encoding='utf-8-sig', newline='') as stream:
        yield from csv.DictReader(stream)


def normalize(value):
    return ' '.join(value.casefold().split())


def benchmark(path, limit):
    if not 1 <= limit <= 10000:
        raise ValueError('Choose 1–10,000 nodes per type')
    start = perf_counter()
    nodes, edges, counts = {}, [], {}
    with ZipFile(path) as archive:
        for kind in ('entities', 'officers', 'intermediaries', 'addresses', 'others'):
            filename = f'nodes-{kind}.csv'
            if filename not in {Path(n).name for n in archive.namelist()}:
                continue
            count = 0
            for count, row in enumerate(rows(archive, filename), 1):
                if count <= limit:
                    value = row.get('name') or row.get('address') or ''
                    nodes[row['node_id']] = {'id': row['node_id'], 'kind': kind,
                                             'key': normalize(value)}
            counts[kind] = count
        counts['relationships'] = 0
        for row in rows(archive, 'relationships.csv'):
            counts['relationships'] += 1
            left, right = row['node_id_start'], row['node_id_end']
            if left in nodes and right in nodes:
                edges.append({'left': left, 'right': right, 'kind': row['rel_type']})
    scan_seconds = perf_counter() - start
    load_env()
    run = uuid4().hex
    with GraphDatabase.driver(os.environ['NEO4J_URI'], auth=(
        os.getenv('NEO4J_USER', 'neo4j'), os.environ['NEO4J_PASSWORD']
    )) as driver, driver.session() as session:
        session.run('CREATE INDEX maha_icij_id IF NOT EXISTS FOR (n:MahaIcijBenchmark) ON (n.run, n.id)').consume()
        session.run('CREATE INDEX maha_icij_key IF NOT EXISTS FOR (n:MahaIcijBenchmark) ON (n.run, n.kind, n.key)').consume()
        session.run('CALL db.awaitIndexes(60)').consume()
        try:
            start = perf_counter()
            for query, records in [
                ("""UNWIND $batch AS row CREATE (:MahaIcijBenchmark
                    {run:$run,id:row.id,kind:row.kind,key:row.key})""", list(nodes.values())),
                ("""UNWIND $batch AS row
                    MATCH (a:MahaIcijBenchmark {run:$run,id:row.left})
                    MATCH (b:MahaIcijBenchmark {run:$run,id:row.right})
                    CREATE (a)-[:ICIJ_BENCHMARK_LINK {kind:row.kind}]->(b)""", edges),
            ]:
                for offset in range(0, len(records), 500):
                    session.run(query, run=run, batch=records[offset:offset+500]).consume()
            import_seconds = perf_counter() - start
            stored_edges = session.run(
                'MATCH (:MahaIcijBenchmark {run:$run})-[r:ICIJ_BENCHMARK_LINK]->() RETURN count(r) AS n',
                run=run).single()['n']
            if stored_edges != len(edges):
                raise RuntimeError('Edge count differs from source sample')
            keys = Counter((n['kind'], n['key']) for n in nodes.values() if n['key'])
            timings = []
            for kind, key in list(keys)[:100]:
                start = perf_counter()
                count = session.run('''MATCH (n:MahaIcijBenchmark {run:$run,kind:$kind,key:$key})
                    RETURN count(n) AS n''', run=run, kind=kind, key=key).single()['n']
                timings.append((perf_counter() - start) * 1000)
                if count != keys[kind, key]:
                    raise RuntimeError('Indexed lookup differs from source sample')
        finally:
            session.run('MATCH (n:MahaIcijBenchmark {run:$run}) DETACH DELETE n', run=run).consume()
    with path.open('rb') as archive_file:
        digest = hashlib.file_digest(archive_file, 'sha256').hexdigest()
    return {
        'source': 'International Consortium of Investigative Journalists (ICIJ)',
        'source_url': 'https://offshoreleaks.icij.org/pages/database',
        'licence': 'ODbL database; CC BY-SA contents',
        'archive_sha256': digest, 'full_csv_row_counts': counts,
        'sample_policy': f'First {limit} rows per node file and all edges between sampled nodes',
        'sample_nodes': len(nodes), 'sample_edges': stored_edges,
        'scan_seconds': scan_seconds, 'neo4j_import_seconds': import_seconds,
        'lookup_count': len(timings), 'lookup_median_ms': median(timings) if timings else None,
        'exact_normalized_collision_groups': sum(n > 1 for n in keys.values()),
        'candidate_pairs': sum(n * (n - 1) // 2 for n in keys.values()),
        'scope': 'Exact-name/address blocking and database performance; no identity or crime labels',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--limit', type=int, default=5000)
    args = parser.parse_args()
    result = benchmark(args.archive, args.limit)
    output = Path('artifacts/evaluation/icij-benchmark.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
