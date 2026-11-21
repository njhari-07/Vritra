"""Propose source-linked organizer roles from a local text or extracted JSONL document."""
import argparse
import hashlib
import json
from pathlib import Path
import re

import spacy

from case_document_attribution import candidate_record, predict_document
from collect_case_text import CAP
from train_case_actor_linker import fit_actor_model, training_examples
from train_case_passage_ranker import fit_ranker, labeled_documents


def read_units(text, suffix):
    if suffix == '.txt':
        units = [
            {'paragraph': number, 'text': paragraph}
            for number, paragraph in enumerate(re.split(r'\r?\n[ \t]*(?:\r?\n)+', text), 1)
        ]
    elif suffix == '.jsonl':
        units = []
        previous = 0
        locator = None
        for line in text.removesuffix('\n').split('\n'):
            unit = json.loads(line)
            if not isinstance(unit, dict) or not isinstance(unit.get('text'), str):
                raise ValueError('Each JSONL unit must have string text')
            keys = unit.keys() & {'page', 'paragraph', 'line'}
            if len(keys) != 1:
                raise ValueError('Each JSONL unit needs one page, paragraph, or line locator')
            key, = keys
            number = unit[key]
            if ((locator is not None and key != locator)
                    or type(number) is not int or number <= previous):
                raise ValueError('JSONL locators must have one type and increase in source order')
            units.append(unit)
            locator, previous = key, number
    else:
        raise ValueError('Use a .txt or .jsonl document')
    if not any(unit['text'].strip() for unit in units):
        raise ValueError('Document contains no readable text')
    return units


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('document', type=Path)
    parser.add_argument('--source-kind', choices=('judgment', 'agency_report', 'news'), required=True)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--actor-challenge', type=Path,
                        default=Path('docs/evaluation/case-actor-challenge.json'))
    parser.add_argument('--top-k', type=int, default=10)
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error('--top-k must be positive')
    try:
        with args.document.open('rb') as document:
            content = document.read(CAP + 1)
        if len(content) > CAP:
            raise ValueError(f'Document exceeds the {CAP:,}-byte corpus input limit')
        units = read_units(content.decode('utf-8-sig'), args.document.suffix.lower())
        nlp = spacy.load('en_core_web_sm')
        if any(len(unit['text']) > nlp.max_length for unit in units):
            raise ValueError('A text unit exceeds the language model limit. Supply shorter source units.')
        train = list(labeled_documents(args.folder, split='development'))
        ranker, vectorizer, _ = fit_ranker(train)
        development = [item for item in json.loads(args.actor_challenge.read_text())
                       if item['split'] == 'development']
        actor_model, positive, total = fit_actor_model(training_examples(args.folder, development, nlp))
        ranks, predictions, _, identity_evidence, attribution = predict_document(
            units, args.source_kind, nlp, ranker, vectorizer, actor_model, args.top_k, paragraph_context=True,
        )
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    candidates = []
    for rank, i in enumerate(ranks['learned'], 1):
        for link in predictions['hybrid'][i]:
            candidates.append({
                **candidate_record(units[i], rank, link, identity_evidence.get((i, link)), attribution.get((i, link))),
                'review_status': 'unreviewed',
            })
    print(json.dumps({
        'document': args.document.name,
        'sha256': hashlib.sha256(content).hexdigest(),
        'source_kind': args.source_kind,
        'top_k': args.top_k,
        'training': {
            'ranker_sources': len({item['source_id'] for item in train}),
            'actor_positive_candidates': positive,
            'actor_training_candidates': total,
            'spacy_model_version': nlp.meta['version'],
        },
        'retrieved_units': [{key: value for key, value in units[i].items() if key != 'text'}
                            for i in ranks['learned']],
        'candidates': candidates,
    }, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
