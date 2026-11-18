"""Measure the effect of adding annotated narrative passages to ranker training."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

from prepare_case_narratives import prepare
from prepare_case_roles import index_sources
from train_case_passage_ranker import features, fit_ranker, labeled_documents


def narrative_documents(sources, rows):
    grouped = defaultdict(list)
    for row in rows:
        if row['split'] == 'development':
            grouped[row['source_id']].append(row)
    episode_sizes = Counter(
        episode for items in grouped.values()
        for episode, _ in {(row['episode'], row['locator']['paragraph']) for row in items}
    )
    for sid, items in grouped.items():
        source = sources[sid]
        units = [json.loads(line) for line in (source['folder'] / source['text']).read_text().splitlines()]
        paragraphs = {unit['paragraph']: i for i, unit in enumerate(units)}
        labels = {}
        for row in items:
            index = paragraphs[row['locator']['paragraph']]
            # A passage with a labeled organizer is relevant. A passage with
            # only other labeled roles is a weak negative for this experiment.
            labels[index] = labels.get(index, False) or row['role'] == 'organizer'
        yield {
            'source_id': sid,
            'texts': [unit['text'] for unit in units],
            'topic': 'role',
            'training_units': sorted(labels),
            'positive': {i for i, relevant in labels.items() if relevant},
            'weight': sum(1 / episode_sizes[episode]
                          for episode, _ in {(row['episode'], row['locator']['paragraph']) for row in items}),
        }


def rank_targets(doc, model, vectorizer):
    scores = model.decision_function(features(doc, vectorizer))
    order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
    ranks = {index: rank for rank, index in enumerate(order, 1)}
    return {index: ranks[index] for index in doc['positive']}


def evaluate(folder, seeds):
    sources = index_sources(folder)
    narrative = prepare(folder, seeds)
    supplemental = list(narrative_documents(sources, narrative))
    if not supplemental:
        raise ValueError('Narrative development annotations are required')
    documents = list(labeled_documents(folder))
    train = [doc for doc in documents if doc['split'] == 'development']
    test = [doc for doc in documents if doc['split'] == 'held_out']
    test_cases = {sources[doc['source_id']]['case_id'] for doc in test}
    if not test or any(sources[doc['source_id']]['case_id'] in test_cases for doc in supplemental):
        raise ValueError('A disjoint real-case holdout is required')
    models = {'real_only': fit_ranker(train)[:2], 'with_narratives': fit_ranker([*train, *supplemental])[:2]}
    rows = []
    for doc in test:
        rankings = {name: rank_targets(doc, *model) for name, model in models.items()}
        for index in sorted(doc['positive']):
            rows.append({
                'source_id': doc['source_id'], 'topic': doc['topic'], 'unit': index + 1,
                'ranks': {name: ranks[index] for name, ranks in rankings.items()},
            })
    summary = {}
    for topic in ('role', 'disposition'):
        subset = [row for row in rows if row['topic'] == topic]
        summary[topic] = {
            'targets': len(subset),
            **{name: {f'top{k}': sum(row['ranks'][name] <= k for row in subset) for k in (1, 5, 10)}
               for name in models},
        }
    return {
        'narrative_training_units': sum(len(doc['training_units']) for doc in supplemental),
        'narrative_organizer_units': sum(len(doc['positive']) for doc in supplemental),
        'summary': summary, 'details': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--seeds', type=Path, default=Path('docs/evaluation/case-narrative-role-seeds.json'))
    args = parser.parse_args()
    inputs = args.seeds.read_bytes()
    report = evaluate(args.folder, json.loads(inputs))
    report['input_sha256'] = {
        'narrative_seeds': hashlib.sha256(inputs).hexdigest(),
        'real_case_annotations': hashlib.sha256((args.folder / 'role-annotations.jsonl').read_bytes()).hexdigest(),
    }
    (args.folder / 'narrative-ranker-transfer.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2))


if __name__ == '__main__':
    main()
