"""Test offline actor attribution on hand-selected, source-linked passages."""
import argparse
import hashlib
import json
from pathlib import Path
import re

import spacy

from prepare_case_roles import index_sources

ROLE = re.compile(r'\b(?:leaders?|organizers?)\b', re.IGNORECASE)
TITLE = re.compile(r'^(?:(?:mr|ms|mrs|dr)\.\s+)+', re.IGNORECASE)
LINE_WRAP = re.compile(r'(?<=[A-Za-z])-\n(?=[a-z])')
BLOCKED_LANGUAGE = re.compile(
    r'\b(?:denied|disputed|disagrees?|alleged|whether|cannot|not|err(?:ed)?)\b', re.I
)
PARTY_TITLES = {'appellant', 'defendant', 'petitioner', 'respondent'}
REJECTED_FINDING = {'reverse', 'vacate', 'reject', 'overturn', 'withdraw', 'dispute'}
REPORT_REFERENCE = re.compile(r'\b(?:PS[IR]|pre[- ]?sentence (?:investigation )?report)\b', re.I)
CONDITIONAL = re.compile(r'\b(?:if|whether|supposing|would have)\b', re.I)
PARTY_ARGUMENT = re.compile(r'\b(?:argu\w+|suggests?|asserts?|claims?|contends?)\b', re.I)


def find_anchor(text, anchor, start=0):
    pattern = r'\s+'.join(re.escape(word) for word in anchor.split())
    match = re.search(pattern, text[start:], re.IGNORECASE)
    if match is None:
        raise ValueError(f'Anchor not found: {anchor}')
    return start + match.start(), start + match.end()


def affirmed_finding(verb):
    """Recognize a court affirming an explicit finding inside the role sentence."""
    finding = verb.head
    preposition = finding.head
    review = preposition.head
    if (finding.lemma_ in {'finding', 'determination'} and finding.dep_ == 'nsubj'):
        return (
            verb.dep_ in {'ccomp', 'acl'} and review == preposition and review.dep_ == 'ROOT'
            and any(child.lemma_ == 'erroneous' for child in review.children)
            and any(child.dep_ == 'neg' for child in review.children)
            and bool(re.search(r'\bcourt[’\x27]s (?:finding|determination)\b', verb.sent.text, re.I))
        )
    return (
        verb.dep_ == 'ccomp' and finding.lemma_ == 'find' and finding.dep_ == 'pcomp'
        and preposition.lower_ == 'in' and review.dep_ == 'ROOT' and review.lemma_ == 'err'
        and any(child.dep_ == 'neg' for child in review.children)
        and any(child.dep_ == 'nsubj' and child.lemma_ == 'court' for child in review.children)
        and not any(child.dep_ == 'mark' or child.tag_ == 'MD' for child in review.children)
    )


def named_parties(context):
    parties = {}
    if context is not None:
        for name in context.ents:
            if name.label_ != 'PERSON' or name.start == 0:
                continue
            title = context[name.start - 1].lower_
            if title in PARTY_TITLES:
                parties.setdefault(title, set()).add(name.text)
    return {title: next(iter(names)) for title, names in parties.items() if len(names) == 1}


def subject_links(doc, *, include_affirmed_findings=False, context=None):
    """Yield named subjects with the sentence that triggered each role match."""
    parties = named_parties(context)
    for token in doc:
        if not ROLE.fullmatch(token.text):
            continue
        # In an English spaCy parse, the role may be the copula's attribute,
        # including the head noun inside "one of the leaders".
        predicate = token
        if predicate.dep_ == 'pobj' and predicate.head.lower_ == 'of':
            predicate = predicate.head.head
        verb = predicate.head
        if predicate.dep_ not in {'attr', 'acomp'} or verb.lemma_ != 'be':
            continue
        if any(child.dep_ in {'neg', 'aux'} and (child.dep_ == 'neg' or child.tag_ == 'MD')
               for child in verb.children):
            continue
        if REPORT_REFERENCE.search(token.sent.text) or any(
            ancestor.lemma_ in REJECTED_FINDING for ancestor in verb.ancestors
        ):
            continue
        if CONDITIONAL.search(token.sent.text) or PARTY_ARGUMENT.search(token.sent.text):
            continue
        if BLOCKED_LANGUAGE.search(token.sent.text) and not (
            include_affirmed_findings and affirmed_finding(verb)
        ):
            continue
        for subject in (child for child in verb.children if child.dep_ == 'nsubj'):
            for member in (subject, *subject.conjuncts):
                if member.lower_ in PARTY_TITLES:
                    if member.lower_ in parties and not re.search(r'\b(?:another|other|different)\b',
                                                                 member.sent.text, re.I):
                        yield parties[member.lower_], token.sent
                    continue
                for entity in doc.ents:
                    if entity.label_ == 'PERSON' and entity.start <= member.i < entity.end:
                        yield entity.text, token.sent


def subject_candidates(doc, *, include_affirmed_findings=False, context=None):
    for name, _ in subject_links(doc, include_affirmed_findings=include_affirmed_findings, context=context):
        yield name


def canonical(name):
    return ' '.join(TITLE.sub('', name).casefold().split())


def equivalent(predicted, actor):
    # The court often uses a surname in the annotation and a full name in prose.
    prediction, expected = canonical(predicted), canonical(actor)
    return prediction == expected or (
        ' ' not in expected and prediction.split()[-1:] == [expected]
    )


def score(candidates, actors):
    predictions = sorted({canonical(name) for name in candidates})
    unmatched = set(actors)
    false_positive = 0
    for prediction in predictions:
        matches = {actor for actor in actors if equivalent(prediction, actor)}
        if len(matches) == 1:
            unmatched -= matches
        else:
            false_positive += 1
    return len(actors) - len(unmatched), false_positive, len(unmatched)


def evaluate(folder, examples):
    sources = index_sources(folder)
    nlp = spacy.load('en_core_web_sm')
    rows, splits = [], {}
    for example in examples:
        if example.get('review_only'):
            continue
        source = sources[example['source_id']]
        if source['status'] != 'collected' or source['kind'] == 'fiction':
            raise ValueError(f'Expected collected primary text: {source["id"]}')
        if example['split'] not in {'development', 'held_out'}:
            raise ValueError(f'Unknown split: {example["split"]}')
        if splits.setdefault(source['case_id'], example['split']) != example['split']:
            raise ValueError(f'Case crosses attribution splits: {source["case_id"]}')
        data = (source['folder'] / source['text']).read_bytes()
        if hashlib.sha256(data).hexdigest() != source['text_sha256']:
            raise ValueError(f'Hash mismatch: {source["id"]}')
        unit = json.loads(data.splitlines()[example['unit'] - 1])
        text = unit.pop('text')
        start, start_end = find_anchor(text, example['start'])
        _, end = find_anchor(text, example['end'], start_end)
        context_start = find_anchor(text, example['context_start'])[0] if 'context_start' in example else start
        if context_start > start:
            raise ValueError(f'Context must precede evidence: {source["id"]}')
        passage = LINE_WRAP.sub('', text[start:end])
        context = LINE_WRAP.sub('', text[context_start:start])
        actors = example['actors']
        for actor in actors:
            find_anchor(context + ' ' + passage, actor)
        doc = nlp(passage)
        context_doc = nlp(context) if context else None
        all_names = [ent.text for parsed in ([context_doc, doc] if context_doc is not None else [doc])
                     for ent in parsed.ents if ent.label_ == 'PERSON']
        subjects = list(subject_candidates(doc, include_affirmed_findings=True))
        title_links = list(subject_candidates(doc, include_affirmed_findings=True, context=context_doc))
        rows.append({
            'source_id': source['id'], 'case_id': source['case_id'],
            'source_url': source['url'],
            'locator': {**unit, 'char_start': start, 'char_end': end},
            'context_start': context_start,
            'source_text_sha256': source['text_sha256'],
            'basis': example['basis'], 'split': example['split'],
            'expected_actor_count': len(actors),
            'all_names': score(all_names, actors),
            'direct_subjects': score(subject_candidates(doc), actors),
            'subjects_with_affirmed_findings': score(subjects, actors),
            'subjects_with_title_context': score(title_links, actors),
        })
    summary = {}
    for split in ('development', 'held_out'):
        selected = [row for row in rows if row['split'] == split]
        values = {'passages': len(selected), 'no_answer_passages': sum(not r['expected_actor_count'] for r in selected)}
        for method in ('all_names', 'direct_subjects', 'subjects_with_affirmed_findings',
                       'subjects_with_title_context'):
            tp, fp, fn = (sum(row[method][i] for row in selected) for i in range(3))
            values[method] = {
                'true_positive': tp, 'false_positive': fp, 'false_negative': fn,
                'exact_sets': sum(not row[method][1] and not row[method][2] for row in selected),
                'no_answer_false_links': sum(not row['expected_actor_count'] and bool(row[method][1]) for row in selected),
            }
        summary[split] = values
    return {'task': 'Explicit organizer attribution given the evidence passage',
            'label_status': 'curated_seed_pending_independent_review',
            'spacy_model': nlp.meta['version'], 'summary': summary, 'examples': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--challenge', type=Path, default=Path('docs/evaluation/case-actor-challenge.json'))
    args = parser.parse_args()
    report = evaluate(args.folder, json.loads(args.challenge.read_text()))
    (args.folder / 'actor-attribution-evaluation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary'], indent=2))
