"""Evaluate structural metrics on the separate Montagna research case."""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
from statistics import median

import networkx as nx
from scipy.stats import rankdata
from sklearn.metrics import adjusted_rand_score

from .analytics import structural_metrics


def load_layer(path, *, meetings):
    graph = nx.Graph()
    with path.open(newline='', encoding='utf-8-sig') as source:
        rows = (line.split() for line in source) if meetings else csv.reader(source)
        if next(rows, None) != ['Source', 'Target', 'Weight']:
            raise ValueError(f'Unexpected header in {path}')
        for line, (left, right, weight) in enumerate(rows, 2):
            # The published phone list spells node N52 as 52 on line 118.
            if not meetings and (left, right) == ("N18", "52"):
                right = "N52"
            if not all(re.fullmatch(r'N\d+', node) for node in (left, right)) or int(weight) <= 0:
                raise ValueError(f'Invalid edge in {path}:{line}')
            if left != right:
                graph.add_edge(left, right)
    return graph


def evaluate_layer(graph, roles):
    metrics, communities = structural_metrics(graph, graph.to_directed())
    bosses = {node for node in graph if re.match(r'^boss\b', roles.get(node, ''), re.I)}
    members = {node for node in graph if re.match(r'^member\b', roles.get(node, ''), re.I)}
    ranks = {}
    for metric in ('degree', 'betweenness', 'pagerank'):
        positions = dict(zip(graph, rankdata([-metrics[n][metric] for n in graph])))
        ranks[metric] = {
            'boss_median_rank': median(positions[n] for n in bosses) if bosses else None,
            'member_median_rank': median(positions[n] for n in members) if members else None,
            'bosses_ranked_at_most_10': sum(1 for n in bosses if positions[n] <= 10),
        }

    clans = {}
    for node in graph:
        match = re.search(r"\bfamily ''([^']+)''", roles.get(node, ''), re.I)
        if match:
            clans[node] = match[1]
    detected = [metrics[n]['community'] for n in clans]
    return {
        'nodes': len(graph), 'edges': graph.number_of_edges(),
        'role_coverage': sum(bool(roles.get(n)) for n in graph),
        'bosses': len(bosses), 'explicit_members': len(members), 'ranks': ranks,
        'communities': len(communities),
        'clan_label_counts': dict(Counter(clans.values())),
        'clan_labeled_nodes': len(clans),
        'clan_adjusted_rand_index': (
            adjusted_rand_score(list(clans.values()), detected)
            if len(set(clans.values())) >= 2 else None
        ),
    }


def evaluate(folder):
    meetings, calls, role_file = [
        folder / f'Montagna_{suffix}.csv'
        for suffix in ('Meetings_Edgelist', 'Phone_Calls_Edgelist', 'Roles')
    ]
    layers = {'meetings': load_layer(meetings, meetings=True),
              'phone_calls': load_layer(calls, meetings=False)}
    with role_file.open(newline='', encoding='utf-8-sig') as source:
        roles = {row['Node']: row['Role'].strip() for row in csv.DictReader(source)}
    return {
        'dataset': 'Montagna Operation', 'synthetic': False,
        'scope': 'Separate structural benchmark on an observed, anonymized network',
        'source': 'https://doi.org/10.5281/zenodo.3938818',
        'networkx_version': nx.__version__,
        'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in (meetings, calls, role_file)},
        'projection': 'Unweighted undirected ties, no self-loops; reciprocal arcs for PageRank',
        'label_policy': 'Explicit boss and member prefixes only; clan from explicit quoted family names',
        'rank_policy': 'Descending scores; ties use average rank',
        'shared_nodes': len(set(layers['meetings']) & set(layers['phone_calls'])),
        'layers': {name: evaluate_layer(graph, roles) for name, graph in layers.items()},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--output', type=Path, default=Path('artifacts/evaluation/montagna-evaluation.json'))
    args = parser.parse_args()
    report = evaluate(args.folder)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
