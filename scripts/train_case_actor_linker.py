"""Train a source-local actor linker on reviewed development sentences."""
import argparse
from dataclasses import dataclass
import hashlib
import json
import re
from pathlib import Path

import spacy
from spacy.tokens import Span
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

from evaluate_case_actor_attribution import (
    LINE_WRAP, PARTY_ARGUMENT, PARTY_TITLES, REJECTED_FINDING, REPORT_REFERENCE, ROLE,
    affirmed_finding, canonical, equivalent,
    find_anchor, score, subject_links,
)
from prepare_case_roles import index_sources

ROLE_CUE = re.compile(r'\b(?:leaders?|leadership|organi[sz]ers?|orchestrat\w+|mastermind\w*|main accused)\b', re.I)
NARRATIVE_ROLE_CUE = re.compile(r'\b(?:originators?|leading spirits?)\b', re.I)
NAME_SUFFIX = re.compile(r'^,\s+(?:junior|senior)\b', re.I)
SCHEME = re.compile(r'\b(?:ponzi|fraudulent|fraud|sophisticated|investment)\s+schemes?\b', re.I)
ALLEGATION = re.compile(r'\b(?:alleg\w+|charged with|according to the (?:charges|complaint)|argues?|argued)\b', re.I)
AFFIRMANCE = re.compile(r'\b(?:did not (?:clearly )?err|we affirm|court (?:found|ruled|concluded))\b', re.I)
PRONOUN = re.compile(r'\b(?:he|she|they|her|him)\b', re.I)
RUN_SCHEME = re.compile(r'\b(?:ran|run(?:ning|s)?|operat\w+)\b', re.I)
OPERATOR_FINDING = re.compile(r'\bfound that (?:he|she|they) (?:managed|operated|ran)\b', re.I)
SENTENCING_LIST = re.compile(r'\bsentenced (?:the )?(two|three|four) leaders\b[^:]*:', re.I)
LIST_NAME = re.compile(r"(?:[:;]\s*(?:and\s+)?(?:sentenced\s+)?)([A-Z][\w’'-]+(?: [A-Z][\w’'-]+){1,4}),\s+age\s+\d+")
LIST_COUNTS = {'two': 2, 'three': 3, 'four': 4}
UNCERTAIN = re.compile(
    r'\b(?:if|whether|might|may have|would have|could support (?:the|a) (?:conclusion|finding))\b',
    re.I,
)
ROLE_HEADS = {'be', 'lead', 'organize', 'orchestrate', 'operate', 'run'}
APPOSITIVE_ROLE = re.compile(r'\b(?:leader|organizer) of the (?:scheme|conspiracy|ring),\s+', re.I)
SCORE_THRESHOLD = 0.65


@dataclass(frozen=True)
class Candidate:
    actor: str
    sentence: Span
    features: dict


def sentencing_list_candidates(sentence, text):
    match = SENTENCING_LIST.search(text)
    if match:
        names = LIST_NAME.findall(text, match.end() - 1)
        if len(names) == len(set(names)) == LIST_COUNTS[match[1].lower()]:
            for name in names:
                yield Candidate(name, sentence, {'direct_rule': False, 'listed_leader': True,
                                                  'blocked_scope': False, 'unresolved_scope': False})


def sentence_people(sentence):
    people = [entity for entity in sentence.ents
              if entity.label_ == 'PERSON' and canonical(entity.text) not in PARTY_TITLES
              and not any(char.isdecimal() for char in entity.text)]
    for token in sentence:
        if (token.pos_ == 'PROPN' and token.ent_type_ in {'', 'GPE'}
                and token.dep_ in {'nsubj', 'poss'} and token.is_alpha
                and (token.head.lemma_ in ROLE_HEADS or token.head.lemma_ == 'role')):
            people.append(sentence.doc[token.i:token.i + 1])
    return people


def is_subject(person):
    root = person.root
    return root.dep_ in {'nsubj', 'nsubjpass'} or (
        root.dep_ == 'conj' and root.head.dep_ in {'nsubj', 'nsubjpass'}
    )


def role_subjects(sentence):
    for token in sentence:
        if ROLE.fullmatch(token.text) and token.dep_ in {'attr', 'acomp'} and token.head.lemma_ == 'be':
            verb = token.head
            if not any(child.dep_ == 'neg' or child.tag_ == 'MD' for child in verb.children):
                yield verb, [child for child in verb.children if child.dep_ == 'nsubj']


def resolved_role_names(sentence, previous_sentence, people, text):
    """Find appositives or uniquely supported subjects in explicit role clauses."""
    appositive = APPOSITIVE_ROLE.search(text)
    if appositive and sentence.root.lemma_ == 'sentence':
        after_role = APPOSITIVE_ROLE.search(sentence.text.replace('\n', ' '))
        if after_role:
            for person in people:
                if person.start_char - sentence.start_char == after_role.end():
                    yield person.text
    for verb, subjects in role_subjects(sentence):
        affirmed = affirmed_finding(verb)
        for subject in subjects:
            if subject.pos_ == 'PROPN' and subject.is_alpha and (verb == sentence.root or affirmed):
                name = next((person.text for person in people if person.start <= subject.i < person.end), subject.text)
                yield name
            if subject.lower_ not in {'he', 'she'} or not affirmed or previous_sentence is None:
                continue
            antecedents = [token for token in previous_sentence if token.dep_ == 'nsubj'
                           and token.pos_ == 'PROPN' and token.is_alpha
                           and token.head.lemma_ in {'recruit', 'direct', 'organize', 'operate', 'run', 'lead'}]
            if len(antecedents) == 1:
                antecedent = antecedents[0]
                name = next((person.text for person in sentence_people(previous_sentence)
                             if person.start <= antecedent.i < person.end), antecedent.text)
                yield name


def actor_candidates(doc, *, narrative_cues=False):
    direct = {(canonical(name), sentence.start) for name, sentence in
              subject_links(doc, include_affirmed_findings=True)}
    preceding = []
    previous_sentence = None
    for sentence in doc.sents:
        text = ' '.join(sentence.text.split())
        current = sentence_people(sentence)
        named = {canonical(person.text): person for person in current}
        if PRONOUN.search(text):
            for person in (person for people in preceding for person in people):
                named.setdefault(canonical(person.text), person)
        court_role = bool(ROLE_CUE.search(text))
        operating_scheme = bool(SCHEME.search(text) and (
            RUN_SCHEME.search(text) or OPERATOR_FINDING.search(text)
        ))
        blocked = (
            ALLEGATION.search(text) or REPORT_REFERENCE.search(text)
            or sentence.root.lemma_ in REJECTED_FINDING or UNCERTAIN.search(text)
        )
        concerning = re.search(r'\b(?:not|no|err(?:ed)?)\b', text, re.I)
        resolved = (
            {canonical(name): name for name in resolved_role_names(sentence, previous_sentence, current, text)}
            if court_role and not blocked and not PARTY_ARGUMENT.search(text) else {}
        )
        if court_role or operating_scheme or (narrative_cues and NARRATIVE_ROLE_CUE.search(text)):
            for name, person in named.items():
                direct_rule = (name, sentence.start) in direct
                in_sentence = person.start >= sentence.start
                subject = is_subject(person)
                suffix = NAME_SUFFIX.match(doc.text[person.end_char:person.sent.end_char]) if narrative_cues else None
                actor = person.text + suffix[0] if suffix else person.text
                yield Candidate(actor, sentence, {
                    'direct_rule': direct_rule,
                    'resolved_role': name in resolved,
                    'blocked_scope': bool(blocked),
                    'unresolved_scope': bool(concerning and not (direct_rule or AFFIRMANCE.search(text))),
                    'court_role': court_role,
                    'operating_scheme': operating_scheme,
                    'operator_finding': bool(operating_scheme and OPERATOR_FINDING.search(text)),
                    'affirmance': bool(AFFIRMANCE.search(text)),
                    'subject': subject,
                    'person_entity': person.label_ == 'PERSON',
                    'named_in_sentence': in_sentence,
                    'named_subject_in_sentence': in_sentence and subject,
                    'preceding_subject': not in_sentence and subject,
                    'entity_dependency': person.root.dep_,
                    'governing_verb': person.root.head.lemma_ if person.root.head.lemma_ in {
                        'be', 'run', 'operate', 'convict', 'sentence', 'find', 'lead',
                    } else 'other',
                    'sentence_person_count': len(current),
                })
            for name, actor in resolved.items():
                if name not in named:
                    yield Candidate(actor, sentence, {'resolved_role': True, 'blocked_scope': False,
                                                      'unresolved_scope': False, 'direct_rule': False})
        if not blocked:
            yield from sentencing_list_candidates(sentence, text)
        preceding = [current, *preceding[:1]]
        previous_sentence = sentence


def labeled_sentences(doc, example):
    reviewed = {}
    for label in example.get('sentence_labels', []):
        start, end = find_anchor(doc.text, label['anchor'])
        sentence = next((sent for sent in doc.sents
                         if sent.start_char <= start < end <= sent.end_char), None)
        if sentence is None:
            raise ValueError(f'Label crosses a sentence boundary: {example["source_id"]}')
        if sentence.start in reviewed:
            raise ValueError(f'Duplicate sentence label: {example["source_id"]}')
        if not set(label['actors']).issubset(example['actors']):
            raise ValueError(f'Sentence actor missing from the excerpt labels: {example["source_id"]}')
        reviewed[sentence.start] = label['actors']
    return reviewed


def training_examples(folder, examples, nlp):
    sources = index_sources(folder)
    cases = {}
    for example in examples:
        if example.get('review_only'):
            continue
        source = sources[example['source_id']]
        if source['status'] != 'collected' or source['kind'] == 'fiction':
            raise ValueError(f'Expected collected real source: {source["id"]}')
        if example['split'] not in {'development', 'held_out'}:
            raise ValueError(f'Unknown split: {example["split"]}')
        if cases.setdefault(source['case_id'], example['split']) != example['split']:
            raise ValueError(f'Case crosses actor training splits: {source["case_id"]}')
        data = (source['folder'] / source['text']).read_bytes()
        if hashlib.sha256(data).hexdigest() != source['text_sha256']:
            raise ValueError(f'Hash mismatch: {source["id"]}')
        unit = json.loads(data.splitlines()[example['unit'] - 1])
        text = unit['text']
        start, start_end = find_anchor(text, example.get('context_start', example['start']))
        _, end = find_anchor(text, example['end'], start_end)
        excerpt = LINE_WRAP.sub('', text[start:end])
        for actor in example['actors']:
            find_anchor(excerpt, actor)
        doc = nlp(excerpt)
        yield example, source['case_id'], list(actor_candidates(doc)), labeled_sentences(doc, example)


def fit_actor_model(rows, supplemental=()):
    training = [
        (candidate.features, sum(equivalent(candidate.actor, actor) for actor in reviewed[candidate.sentence.start]) == 1)
        for example, _, candidates, reviewed in rows if example['split'] == 'development'
        for candidate in candidates if candidate.sentence.start in reviewed
    ]
    training.extend(supplemental)
    if {label for _, label in training} != {False, True}:
        raise ValueError('Actor training requires positive and negative candidates')
    model = make_pipeline(DictVectorizer(), LogisticRegression(class_weight='balanced', max_iter=500))
    model.fit([features for features, _ in training], [label for _, label in training])
    return model, sum(label for _, label in training), len(training)


def model_links(model, candidates):
    eligible = [candidate for candidate in candidates
                if not candidate.features['blocked_scope']
                and (candidate.features.get('resolved_role') or not candidate.features['unresolved_scope'])]
    if eligible:
        scores = model.predict_proba([candidate.features for candidate in eligible])[:, 1]
        for candidate, value in zip(eligible, scores, strict=True):
            if (candidate.features['direct_rule'] or candidate.features.get('listed_leader')
                    or candidate.features.get('resolved_role') or value >= SCORE_THRESHOLD):
                yield candidate.actor, candidate.sentence


def evaluate(folder, examples, nlp, *, supplemental=()):
    rows = list(training_examples(folder, examples, nlp))
    model, positives, total = fit_actor_model(rows, supplemental)
    results = []
    for example, case, candidates, _ in rows:
        if example['split'] != 'held_out':
            continue
        expected = example['actors']
        predicted = [actor for actor, _ in model_links(model, candidates)]
        results.append({
            'source_id': example['source_id'], 'case_id': case,
            'basis': example['basis'], 'unit': example['unit'],
            'no_answer': not expected, 'candidate_count': len(candidates),
            'candidate_scores': score([candidate.actor for candidate in candidates], expected),
            'model_scores': score(predicted, expected),
        })
    return {
        'model': 'Explicit clause links plus logistic regression over role and candidate features',
        'threshold': SCORE_THRESHOLD,
        'development_candidate_labels': {'positive': positives, 'negative': total - positives},
        'development_cases': len({case for row, case, _, _ in rows if row['split'] == 'development'}),
        'development_annotated_sentences': sum(len(reviewed) for row, _, _, reviewed in rows
                                               if row['split'] == 'development'),
        'held_out_passages': len(results),
        'held_out_no_answer_passages': sum(row['no_answer'] for row in results),
        'held_out_no_answer_false_links': sum(row['no_answer'] and bool(row['model_scores'][1]) for row in results),
        'held_out_candidate_counts': dict(zip(
            ('correct', 'incorrect', 'missed'), map(sum, zip(*(r['candidate_scores'] for r in results)))
        )),
        'held_out_model_counts': dict(zip(
            ('correct', 'incorrect', 'missed'), map(sum, zip(*(r['model_scores'] for r in results)))
        )),
        'details': results,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--challenge', type=Path, default=Path('docs/evaluation/case-actor-challenge.json'))
    args = parser.parse_args()
    result = evaluate(args.folder, json.loads(args.challenge.read_text()), spacy.load('en_core_web_sm'))
    (args.folder / 'learned-actor-evaluation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'details'}, indent=2))
