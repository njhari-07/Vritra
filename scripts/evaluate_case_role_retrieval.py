"""Measure evidence passage retrieval on held-out, explicitly attributed cases."""
import argparse
import hashlib
from collections import defaultdict
import json
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
import spacy

from prepare_case_roles import index_sources

ROLE_QUERY = ('court finding role led leader organizer leadership mastermind directed recruiting '
              'orchestrated orchestrating ran running')
DISPOSITION_QUERY = 'court appeal dismissed allowed sentence vacated acquitted conviction set aside discharge restore proceedings order'


def evaluate(folder, annotations):
    grouped = defaultdict(list)
    for row in annotations:
        if row['split'] == 'held_out':
            grouped[row['source_id']].append(row)
    manifest = index_sources(folder)
    results = []
    nlp = spacy.load('en_core_web_sm', disable=['parser', 'tagger', 'lemmatizer'])
    actor_expected = actor_retrieved = actor_on_gold = 0
    for source_id, claims in sorted(grouped.items()):
        source = manifest[source_id]
        data = (source['folder'] / source['text']).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != source['text_sha256'] or any(claim['source_text_sha256'] != digest for claim in claims):
            raise ValueError(f'Source revision does not match annotations: {source_id}')
        units = [json.loads(line) for line in data.splitlines()]
        # Fit IDF on the document under review. The reference spans and actors are
        # used only for scoring and never supplied as query terms.
        vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)
        matrix = vectorizer.fit_transform([unit['text'] for unit in units])
        for claim in claims:
            query = DISPOSITION_QUERY if claim['basis'] in {'appellate_disposition', 'appellate_scope'} else ROLE_QUERY
            scores = (matrix @ vectorizer.transform([query]).T).toarray().ravel()
            order = sorted(range(len(units)), key=lambda i: (-scores[i], i))
            locator = claim['locator']
            key = next(name for name in ('page', 'paragraph', 'line') if name in locator)
            gold = next(i for i, unit in enumerate(units) if unit[key] == locator[key])
            rank = order.index(gold) + 1 if scores[gold] > 0 else None
            if claim['role'] == 'organizer_or_leader':
                candidates = [i for i in order[:5] if scores[i] > 0]
                spans = {}
                for i in {*candidates, gold}:
                    spans[i] = [(e.start_char, e.end_char) for e in nlp(units[i]['text']).ents
                                if e.label_ == 'PERSON']
                for actor in claim['actor_mentions']:
                    actor_expected += 1
                    # Treat overlap as mention recall only. Nearby people are
                    # not role predictions and cannot establish attribution.
                    found = any(start < span['end'] and end > span['start']
                                for start, end in spans[gold]
                                for span in actor['mentions_in_unit'])
                    actor_on_gold += found
                    actor_retrieved += found and gold in candidates
            results.append({
                'case_id': claim['case_id'], 'source_id': source_id, 'role': claim['role'],
                'basis': claim['basis'], 'gold_unit': {key: locator[key]},
                'candidate_units': [{key: units[i][key]} for i in order[:5] if scores[i] > 0],
                'gold_rank': rank,
            })
    denominator = len(results)
    if not denominator:
        raise ValueError('No held-out annotations found')
    return {
        'task': 'Within-document evidence unit retrieval',
        'model': 'TF-IDF lexical baseline',
        'held_out_cases': len(grouped), 'annotated_claims': denominator,
        'hit_at_1': sum(r['gold_rank'] == 1 for r in results) / denominator,
        'hit_at_5': sum(r['gold_rank'] is not None and r['gold_rank'] <= 5 for r in results) / denominator,
        'mean_reciprocal_rank': sum(1 / r['gold_rank'] for r in results if r['gold_rank']) / denominator,
        'organizer_mentions_expected': actor_expected,
        'organizer_mentions_detected_in_gold_unit': actor_on_gold,
        'organizer_mentions_detected_in_top5_gold_unit': actor_retrieved,
        'details': results,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    args = parser.parse_args()
    annotations = [json.loads(line) for line in (args.folder / 'role-annotations.jsonl').read_text().splitlines()]
    result = evaluate(args.folder, annotations)
    (args.folder / 'role-retrieval-evaluation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'details'}, indent=2))
