"""Evaluate organizer attribution starting from complete collected documents."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

import spacy

from case_document_attribution import candidate_record, predict_document
from evaluate_case_actor_attribution import equivalent, find_anchor, score
from prepare_case_roles import index_sources
from train_case_actor_linker import fit_actor_model, training_examples
from train_case_passage_ranker import fit_ranker, labeled_documents


def annotated_excerpts(text, examples):
    for example in examples:
        start, start_end = find_anchor(text, example['start'])
        _, end = find_anchor(text, example['end'], start_end)
        yield start, end, example


def evaluate(folder, examples, top_k, fresh_examples=None, *, paragraph_context=False, regression_examples=None):
    if fresh_examples is not None and regression_examples is not None:
        raise ValueError('Choose a fresh or regression challenge')
    sources = index_sources(folder)
    train = [doc for doc in labeled_documents(folder) if doc['split'] == 'development']
    train_cases = {sources[doc['source_id']]['case_id'] for doc in train}
    model, vectorizer, _ = fit_ranker(train)
    evaluation_examples = examples
    if fresh_examples is not None:
        evaluation_examples = fresh_examples
    elif regression_examples is not None:
        if any(example['split'] != 'held_out' for example in regression_examples):
            raise ValueError('Regression challenge must contain only evaluation examples')
        evaluation_examples = regression_examples
    if fresh_examples is not None:
        prior_cases = {sources[example['source_id']]['case_id'] for example in examples}
        prior_cases.update(
            claim['case_id']
            for claim in map(json.loads, (folder / 'role-annotations.jsonl').read_text().splitlines())
        )
        for example in fresh_examples:
            if example['split'] != 'held_out' or sources[example['source_id']]['case_id'] in prior_cases:
                raise ValueError(f'Fresh evaluation requires a previously unused held-out case: {example["source_id"]}')
    grouped = defaultdict(lambda: defaultdict(list))
    for example in evaluation_examples:
        if example['split'] == 'held_out':
            source_id = example['source_id']
            if sources[source_id]['case_id'] in train_cases:
                raise ValueError(f'Held-out case used for training: {source_id}')
            grouped[source_id][example['unit'] - 1].append(example)
        elif example['split'] != 'development':
            raise ValueError(f'Unknown attribution split: {example["split"]}')
    if not grouped:
        raise ValueError('Held-out attribution documents are required')

    nlp = spacy.load('en_core_web_sm')
    development = [example for example in examples if example['split'] == 'development']
    actor_rows = list(training_examples(folder, development, nlp))
    actor_train_cases = {case for _, case, _, _ in actor_rows}
    if any(sources[sid]['case_id'] in actor_train_cases for sid in grouped):
        raise ValueError('Held-out case used for actor training')
    actor_model, _, _ = fit_actor_model(actor_rows)
    combinations = [(method, linker) for method in ('keyword', 'learned') for linker in ('rules', 'hybrid')]
    rows = []
    for sid, annotations in sorted(grouped.items()):
        source = sources[sid]
        data = (source['folder'] / source['text']).read_bytes()
        if hashlib.sha256(data).hexdigest() != source['text_sha256']:
            raise ValueError(f'Hash mismatch: {sid}')
        units = [json.loads(line) for line in data.splitlines()]
        texts = [unit['text'] for unit in units]
        gold = {i: list(annotated_excerpts(texts[i], [item for item in items if not item.get('review_only')]))
                for i, items in annotations.items()}
        audited = {i: list(annotated_excerpts(texts[i], [item for item in items if item.get('review_only')]))
                   for i, items in annotations.items()}
        identities = {}
        for i, excerpts in gold.items():
            for j, (_, _, item) in enumerate(excerpts):
                if identity := item.get('identity'):
                    unit_index = identity['unit'] - 1
                    if not i < unit_index < len(units):
                        raise ValueError(f'Invalid identity evidence unit: {sid}')
                    start, end = find_anchor(texts[unit_index], identity['anchor'])
                    identities[i, j] = (units[unit_index]['paragraph'], start, end)
        rankings, predictions, proposed, cross_paragraph, judicial_attribution = predict_document(
            units, source['kind'], nlp, model, vectorizer, actor_model, top_k,
            paragraph_context=paragraph_context, compare_baselines=True,
        )
        for method, linker in combinations:
            ranking = rankings[method]
            known_links = defaultdict(list)
            candidates = []
            for rank, i in enumerate(ranking, 1):
                for name, start, end in predictions[linker][i]:
                    identity_evidence = cross_paragraph.get((i, (name, start, end)), []) if linker == 'hybrid' else []
                    attribution = judicial_attribution.get((i, (name, start, end))) if linker == 'hybrid' else None
                    matches = [j for j, (a, b, _) in enumerate(gold.get(i, [])) if a < end and start < b]
                    verified = []
                    for j in matches:
                        if expected := identities.get((i, j)):
                            paragraph, lo, hi = expected
                            if not any(
                                evidence['locator']['paragraph'] == paragraph
                                and evidence['locator']['char_start'] <= lo < hi <= evidence['locator']['char_end']
                                for evidence in identity_evidence
                            ):
                                continue
                        known_links[i, j].append(name)
                        verified.append(j)
                    audit_matches = [item for a, b, item in audited.get(i, []) if a < end and start < b]
                    reviews = [gold[i][j][2] for j in verified] if matches else audit_matches
                    supported = [item['basis'] for item in reviews
                                 if any(equivalent(name, actor) for actor in item['actors'])]
                    candidates.append({
                        **candidate_record(units[i], rank, (name, start, end), identity_evidence, attribution),
                        'reviewed_basis': supported,
                        'review_status': (
                            'supported_in_annotated_excerpt' if supported and matches
                            else 'supported_in_candidate_review' if supported
                            else 'missing_identity_evidence' if matches and not verified
                            else 'unsupported_in_annotated_excerpt' if matches
                            else 'unsupported_in_candidate_review' if audit_matches
                            else 'unreviewed_sentence'
                        ),
                    })
            excerpt_scores = [
                score(known_links[i, j], item['actors'])
                for i, excerpts in gold.items()
                for j, (_, _, item) in enumerate(excerpts)
            ]
            misses = []
            for i, excerpts in gold.items():
                for j, (a, b, item) in enumerate(excerpts):
                    for actor in item['actors']:
                        if any(equivalent(name, actor) for name in known_links[i, j]):
                            continue
                        if i not in ranking:
                            reason = 'source_unit_not_retrieved'
                        elif linker == 'rules':
                            reason = 'no_matching_rule_output'
                        elif any(equivalent(name, actor) and a < end and start < b
                                 for name, start, end in proposed[i]):
                            reason = 'candidate_filtered'
                        else:
                            reason = 'no_matching_candidate'
                        misses.append({'unit': item['unit'], 'actor': actor, 'basis': item['basis'], 'reason': reason})
            rows.append({
                'source_id': sid, 'case_id': source['case_id'], 'source_url': source['url'],
                **({'published': source['published']} if 'published' in source else {}),
                'source_text_sha256': source['text_sha256'], 'method': method, 'linker': linker,
                'retrieved_units': [next(v for k, v in units[i].items() if k != 'text') for i in ranking],
                'expected_actor_links': sum(len(item['actors']) for excerpts in gold.values() for _, _, item in excerpts),
                'expected_links_in_retrieved_units': sum(len(item['actors']) for i in ranking
                                                        for _, _, item in gold.get(i, [])),
                'correct_links': sum(tp for tp, _, _ in excerpt_scores),
                'incorrect_reviewed_links': sum(fp for _, fp, _ in excerpt_scores),
                'missed_links': sum(fn for _, _, fn in excerpt_scores),
                'unreviewed_candidates': sum(c['review_status'] == 'unreviewed_sentence' for c in candidates),
                'supported_in_candidate_review': sum(c['review_status'] == 'supported_in_candidate_review'
                                                     for c in candidates),
                'unsupported_in_candidate_review': sum(c['review_status'] == 'unsupported_in_candidate_review'
                                                       for c in candidates),
                'candidates': candidates,
                'misses': misses,
                **({'stage_references': [
                    {'unit': item['unit'], 'basis': item['basis'], 'expected_actors': item['actors'],
                     'retrieved': i in ranking, 'char_start': start, 'char_end': end}
                    for i, excerpts in gold.items() for start, end, item in excerpts
                ]} if regression_examples is not None else {}),
            })
    metrics = (
        'expected_actor_links', 'expected_links_in_retrieved_units', 'correct_links',
        'incorrect_reviewed_links', 'missed_links', 'unreviewed_candidates',
        'supported_in_candidate_review', 'unsupported_in_candidate_review',
    )
    return {
        'task': 'Retrieve evidence units and link explicit organizer statements to actors',
        'top_k': top_k, 'held_out_documents': len(grouped), 'spacy_model': nlp.meta['version'],
        'held_out_case_groups': len({sources[sid]['case_id'] for sid in grouped}),
        'evaluation_set': ('fresh_case_groups' if fresh_examples is not None
                           else 'case_regression' if regression_examples is not None else 'iterated_challenge'),
        'paragraph_context': paragraph_context,
        'label_status': 'curated_excerpts_only',
        'summary': {
            f'{method}_{linker}': {
                metric: sum(row[metric] for row in rows if row['method'] == method and row['linker'] == linker)
                for metric in metrics
            }
            for method, linker in combinations
        },
        'details': rows,
    }


def pooled_examples(base, fixtures):
    unique = {}
    inputs = [(base, [item for item in json.loads(base.read_text()) if item['split'] == 'held_out'])]
    inputs.extend((path, json.loads(path.read_text())) for path in fixtures)
    for path, examples in inputs:
        for item in examples:
            if item['split'] != 'held_out':
                raise ValueError(f'Pooled regression fixture must contain only evaluation examples: {path}')
            key = tuple(item[field] for field in ('source_id', 'unit', 'start', 'end'))
            if unique.setdefault(key, item) != item:
                raise ValueError(f'Conflicting annotations for the same excerpt in {path}: {key}')
    return list(unique.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--challenge', type=Path, default=Path('docs/evaluation/case-actor-challenge.json'))
    challenge_mode = parser.add_mutually_exclusive_group()
    challenge_mode.add_argument('--fresh-challenge', type=Path, help='Evaluate unused cases with the existing development data')
    challenge_mode.add_argument('--regression-challenge', type=Path,
                                help='Evaluate a separate fixture that may revisit previously held-out cases')
    challenge_mode.add_argument('--pooled-regression', type=Path, nargs='+',
                                help='Pool these fixtures and the base challenge held-out excerpts')
    parser.add_argument('--top-k', type=int, default=5)
    parser.add_argument('--paragraph-context', action='store_true')
    parser.add_argument('--output', type=Path, help='Write this run to a separate report path')
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error('--top-k must be positive')
    fresh = json.loads(args.fresh_challenge.read_text()) if args.fresh_challenge else None
    regression = json.loads(args.regression_challenge.read_text()) if args.regression_challenge else None
    if args.pooled_regression:
        regression = pooled_examples(args.challenge, args.pooled_regression)
    report = evaluate(args.folder, json.loads(args.challenge.read_text()), args.top_k, fresh,
                      paragraph_context=args.paragraph_context, regression_examples=regression)
    if args.pooled_regression:
        report['evaluation_set'] = 'pooled_regression'
        report['annotation_count'] = len(regression)
        report['fixtures'] = [str(path) for path in [args.challenge, *args.pooled_regression]]
        miss_reasons = defaultdict(Counter)
        for row in report['details']:
            miss_reasons[f'{row["method"]}_{row["linker"]}'].update(miss['reason'] for miss in row['misses'])
        for method, summary in report['summary'].items():
            summary['miss_reasons'] = dict(miss_reasons[method])
    provenance_paths = [
        args.challenge, args.folder / 'role-annotations.jsonl', Path(__file__),
        *[Path(__file__).with_name(name) for name in (
            'evaluate_case_actor_attribution.py', 'evaluate_case_role_retrieval.py',
            'train_case_actor_linker.py', 'train_case_passage_ranker.py',
            'case_document_attribution.py',
            'case_paragraph_attribution.py',
            'case_news_attribution.py',
        )],
    ]
    if args.fresh_challenge:
        provenance_paths.append(args.fresh_challenge)
    if args.regression_challenge:
        provenance_paths.append(args.regression_challenge)
    if args.pooled_regression:
        provenance_paths.extend(args.pooled_regression)
    report['input_sha256'] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in provenance_paths}
    filename = 'fresh-document-attribution-evaluation.json' if fresh is not None else 'document-attribution-evaluation.json'
    if args.paragraph_context:
        filename = f'paragraph-context-{filename}'
    if args.regression_challenge:
        filename = f'regression-{filename}'
    if args.pooled_regression:
        filename = f'pooled-regression-{filename}'
    output = args.output or args.folder / filename
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2))
