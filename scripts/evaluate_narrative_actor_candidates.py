"""Measure whether the narrative evidence contains usable actor candidates."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import spacy

from evaluate_case_actor_attribution import equivalent
from prepare_case_narratives import prepare
from prepare_case_roles import index_sources
from train_case_actor_linker import actor_candidates, evaluate as evaluate_actor_model


def evaluate(folder, seeds, nlp, challenge=None):
    sources = index_sources(folder)
    annotations = prepare(folder, seeds)
    units = {}
    rows = []
    training = {}
    for row in annotations:
        sid = row['source_id']
        if sid not in units:
            source = sources[sid]
            texts = (source['folder'] / source['text']).read_text().splitlines()
            units[sid] = {unit['paragraph']: unit['text'] for unit in map(json.loads, texts)}
        number = row['locator']['paragraph']
        paragraph = units[sid][number]
        doc = nlp(paragraph)
        role = row['role_span']
        actor = row['person_span']
        mention = paragraph[actor['start']:actor['end']]
        counts = {}
        for mode in ('default', 'narrative'):
            candidates = [
                candidate for candidate in actor_candidates(doc, narrative_cues=mode == 'narrative')
                if candidate.sentence.start_char <= role['start'] < role['end'] <= candidate.sentence.end_char
            ]
            names = sorted({candidate.actor for candidate in candidates})
            counts[mode] = {
                'matched_annotated_person': any(equivalent(name, mention) for name in names),
                'candidates': names,
            }
            if mode == 'narrative' and row['split'] == 'development':
                for candidate in candidates:
                    if equivalent(candidate.actor, mention):
                        key = sid, number, candidate.sentence.start, candidate.actor
                        label = row['role'] == 'organizer'
                        previous = training.setdefault(key, (candidate.features, label))
                        if previous[1] != label:
                            raise ValueError(f'Conflicting narrative candidate labels: {key}')
        rows.append({
            'source_id': sid, 'episode': row['episode'], 'paragraph': number,
            'person': row['person'], 'role': row['role'], 'basis': row['basis'], 'coverage': counts,
        })
    summary = defaultdict(lambda: {'annotations': 0, 'default_matches': 0, 'narrative_matches': 0})
    for row in rows:
        totals = summary['organizer' if row['role'] == 'organizer' else 'other_roles']
        totals['annotations'] += 1
        for mode in ('default', 'narrative'):
            totals[f'{mode}_matches'] += row['coverage'][mode]['matched_annotated_person']
    result = {'summary': dict(summary), 'details': rows}
    if challenge is not None:
        held_out = {sources[row['source_id']]['case_id'] for row in challenge if row['split'] == 'held_out'}
        if any(sources[key[0]]['case_id'] in held_out for key in training):
            raise ValueError('Narrative candidate source overlaps the real-case holdout')
        if {label for _, label in training.values()} != {False, True}:
            raise ValueError('Narrative transfer requires both candidate classes')
        baseline = evaluate_actor_model(folder, challenge, nlp)
        augmented = evaluate_actor_model(folder, challenge, nlp, supplemental=list(training.values()))
        result['transfer'] = {
            'added_positive_candidates': sum(label for _, label in training.values()),
            'added_negative_candidates': sum(not label for _, label in training.values()),
            'held_out_passages': baseline['held_out_passages'],
            'real_only': baseline['held_out_model_counts'],
            'with_narratives': augmented['held_out_model_counts'],
            'changed_passages': [
                {'source_id': old['source_id'], 'unit': old['unit'],
                 'real_only': old['model_scores'], 'with_narratives': new['model_scores']}
                for old, new in zip(baseline['details'], augmented['details'], strict=True)
                if old['model_scores'] != new['model_scores']
            ],
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--seeds', type=Path, default=Path('docs/evaluation/case-narrative-role-seeds.json'))
    parser.add_argument('--transfer-challenge', type=Path, help='Compare models on a real-case actor challenge')
    args = parser.parse_args()
    challenge = json.loads(args.transfer_challenge.read_text()) if args.transfer_challenge else None
    result = evaluate(args.folder, json.loads(args.seeds.read_text()), spacy.load('en_core_web_sm'), challenge)
    (args.folder / 'narrative-actor-candidates.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary'], indent=2))
    if 'transfer' in result:
        print(json.dumps(result['transfer'], indent=2))


if __name__ == '__main__':
    main()
