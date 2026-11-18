"""Train an offline passage ranker using the development cases only."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from evaluate_case_role_retrieval import DISPOSITION_QUERY, ROLE_QUERY
from prepare_case_roles import index_sources


def task(claim):
    return 'disposition' if claim['basis'] in {'appellate_disposition', 'appellate_scope'} else 'role'


def labeled_documents(folder, *, split=None):
    index = index_sources(folder)
    grouped = defaultdict(list)
    splits = {}
    for line in (folder / 'role-annotations.jsonl').read_text().splitlines():
        claim = json.loads(line)
        if splits.setdefault(claim['case_id'], claim['split']) != claim['split']:
            raise ValueError('Case crosses evaluation splits')
        if split is None or claim['split'] == split:
            grouped[claim['source_id'], task(claim)].append(claim)

    for (source_id, topic), claims in grouped.items():
        source = index[source_id]
        data = (source['folder'] / source['text']).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if any(row['source_text_sha256'] != digest for row in claims):
            raise ValueError(f'Source text revision mismatch: {source_id}')
        units = [json.loads(line) for line in data.splitlines()]
        positive = set()
        for row in claims:
            locator = row['locator']
            key = next(name for name in ('page', 'paragraph', 'line') if name in locator)
            positive.add(next(i for i, unit in enumerate(units) if unit[key] == locator[key]))
        yield {
            'source_id': source_id, 'split': claims[0]['split'], 'topic': topic,
            'texts': [unit['text'] for unit in units],
            'positive': positive,
        }


def features(document, vectorizer):
    texts = document['texts']
    positions = np.arange(len(texts)) / max(1, len(texts) - 1)
    query = ROLE_QUERY if document['topic'] == 'role' else DISPOSITION_QUERY
    # Query and position features are available at inference, independent of labels.
    query_words = set(query.split())
    coverage = [len(query_words.intersection(re.findall(r'\b\w+\b', text.lower())))
                for text in texts]
    lexical = vectorizer.transform(texts) @ vectorizer.transform([query]).T
    lexical = lexical.toarray().ravel()
    role = document['topic'] == 'role'
    return np.column_stack([
        lexical, np.log1p(coverage),
        positions, positions ** 2, np.log1p([len(text) for text in texts]),
        lexical * role, positions * role,
    ])


def fit_ranker(train):
    if not train:
        raise ValueError('Development split must be populated')
    vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
    selected = [doc.get('training_units', list(range(len(doc['texts'])))) for doc in train]
    vectorizer.fit(doc['texts'][i] for doc, indices in zip(train, selected, strict=True) for i in indices)
    x = np.vstack([features(doc, vectorizer)[indices] for doc, indices in zip(train, selected, strict=True)])
    y = [i in doc['positive'] for doc, indices in zip(train, selected, strict=True) for i in indices]
    # Non-anchor units are weak ranking negatives, not proven irrelevant.
    weights = [doc.get('weight', 1) / len(indices)
               for doc, indices in zip(train, selected, strict=True) for _ in indices]
    model = LogisticRegression(class_weight='balanced', max_iter=500)
    model.fit(x, y, sample_weight=weights)
    return model, vectorizer, y


def keyword_scores(texts, query):
    local = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
    matrix = local.fit_transform(texts)
    return (matrix @ local.transform([query]).T).toarray().ravel()


def main(folder):
    documents = list(labeled_documents(folder))
    train = [doc for doc in documents if doc['split'] == 'development']
    test = [doc for doc in documents if doc['split'] == 'held_out']
    if not test:
        raise ValueError('Held-out split must be populated')
    model, vectorizer, y = fit_ranker(train)

    results = []
    for doc in test:
        xdoc = features(doc, vectorizer)
        query = ROLE_QUERY if doc['topic'] == 'role' else DISPOSITION_QUERY
        baseline = keyword_scores(doc['texts'], query)
        scores = model.decision_function(xdoc)
        orders = [sorted(range(len(values)), key=lambda i: (-values[i], i))
                  for values in (baseline, scores)]
        for i in sorted(doc['positive']):
            results.append({
                'source_id': doc['source_id'], 'topic': doc['topic'], 'unit': i + 1,
                'keyword_rank': orders[0].index(i) + 1 if baseline[i] > 0 else None,
                'learned_rank': orders[1].index(i) + 1,
            })

    def hit(key, k):
        return sum(row[key] is not None and row[key] <= k for row in results)

    by_topic = {}
    for topic in sorted({row['topic'] for row in results}):
        selected = [row for row in results if row['topic'] == topic]
        by_topic[topic] = {
            'units': len(selected),
            **{f'{name}_top{k}': sum(row[f'{name}_rank'] is not None and row[f'{name}_rank'] <= k
                                    for row in selected)
               for name in ('keyword', 'learned') for k in (1, 5)},
        }

    report = {
        'model': 'logistic regression over lexical and position features',
        'train_cases': len({doc['source_id'] for doc in train}),
        'test_cases': len({doc['source_id'] for doc in test}),
        'train_candidate_units': len(y), 'train_annotated_units': sum(y),
        'test_annotated_units': len(results),
        'keyword_top1': hit('keyword_rank', 1), 'keyword_top5': hit('keyword_rank', 5),
        'learned_top1': hit('learned_rank', 1), 'learned_top5': hit('learned_rank', 5),
        'by_topic': by_topic,
        'details': results,
    }
    (folder / 'learned-passage-evaluation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'details'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    main(parser.parse_args().folder)
