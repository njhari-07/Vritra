"""Resolve anonymous sentencing leads using nearby, corroborating paragraphs."""
import re

from evaluate_case_actor_attribution import PARTY_ARGUMENT, ROLE, canonical

ROLE_LEAD = re.compile(
    r"^(?:[A-Z ]+—)?(?:The (?:leader|organizer) of\b|A (?:[^.!?]+?) who "
    r"(?:was the (?:leader|organizer) of|(?:helped )?orchestrate(?:d)?)\b)",
)
NUMBERS = dict(zip(
    ('one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'),
    range(1, 13), strict=True,
))
NUMBER = r'(\d+|' + '|'.join(NUMBERS) + ')'
PRISON_TERM = re.compile(
    rf"\b(?:sentenced (?:today )?to (more than )?{NUMBER} (months?|years?) in (?:federal )?prison"
    rf"|{NUMBER}-(month|year) prison term)\b", re.I,
)
BLOCKED = re.compile(r"\b(?:allegedly|alleged|if|would have)\b", re.I)
ROLE_RESTATEMENT = (
    r"\b{surname}\s+was\s+(?:one of (?:two|three|four) "
    r"(?:men|women|people|defendants) who led|(?:a|the) (?:leader|organizer) of)\b"
)
PERSON_NAME = r"(?:[A-Z][a-z’'-]+|[A-Z]\.) (?:[A-Z][a-z’'-]+(?: [A-Z][a-z’'-]+)?)"
SENTENCED_FOR_ROLE = re.compile(
    r"\bwas sentenced\b[^.;]*\bfor (?:leading\b|(?:his|her) leadership of\b)", re.I,
)
DATELINE = re.compile(r'^[A-Z][A-Z, .-]{1,50}—\s*')
NAMED_LEAD = re.compile(
    rf"^(?:[A-Z, ]+—)?(?P<name>{PERSON_NAME}),\s*(?:age )?\d{{2}},"
    r"\s+of [A-Z][\w. -]+(?:,\s*[A-Z][\w. -]+)?,?$",
)
NAMED_DEFENDANT = re.compile(rf"\blead defendant (?P<name>{PERSON_NAME})$")
SENTENCING_CONTEXT = {
    'count', 'conviction', 'follow', 'release', 'prison', 'month', 'year',
    'for', 'on', 'in', 'to',
}
SCHEME_TARGETS = {'scheme', 'ring', 'conspiracy', 'enterprise'}
MISCONDUCT = re.compile(r'\b(?:fraud\w*|illegal\w*|unlawful\w*|unregistered|offen[cs]e|ponzi)\b', re.I)
UNRESOLVED = re.compile(
    r'\b(?:alleg\w+|suspect\w+|accus\w+|charged|reportedly|purport\w+|denied|'
    r'acquitt\w*|overturned|discontinued|if|whether)\b', re.I,
)
GUILTY_PLEA = re.compile(r'\b(?:pleaded|pled) guilty to\b', re.I)
PLEA_CHARGES = re.compile(r'^(?:\w+ of )?(?:those|these) charges included\b', re.I)
DEFENDANT_INTRO = re.compile(r'\bdefendant(?: and former fugitive)?\s*$', re.I)
DIRECT_OPERATOR_PLEA = re.compile(
    r'\b(?:pleaded|pled) guilty(?: today| yesterday)? to '
    r'(?:(?:running|operating)|(?:wire|mail|securities|bank) fraud for (?:his|her) operation of)\b',
    re.I,
)


def direct_operator_plea_links(doc):
    """Yield a named defendant whose plea expressly attributes scheme operation."""
    for sentence in doc.sents:
        plea = DIRECT_OPERATOR_PLEA.search(sentence.text)
        if (plea is None or sentence.root.lemma_ not in {'plead', 'pled'}
                or sentence.root.idx != sentence.start_char + plea.start()
                or UNRESOLVED.search(sentence.text) or PARTY_ARGUMENT.search(sentence.text)
                or any(t.dep_ == 'neg' or t.tag_ == 'MD' for t in sentence)):
            continue
        operation = next((t for t in sentence if t.idx + len(t) == sentence.start_char + plea.end()), None)
        if operation is None:
            continue
        if operation.lower_ == 'of':
            targets = [t for t in operation.children if t.dep_ == 'pobj']
        else:
            targets = [t for t in operation.children if t.dep_ == 'dobj']
        if not any(t.lemma_ in SCHEME_TARGETS and any(
            modifier.dep_ in {'compound', 'amod'} and MISCONDUCT.fullmatch(modifier.text)
            for modifier in t.children
        ) for t in targets):
            continue
        prefix = [person for person in sentence.ents if person.label_ == 'PERSON'
                  and person.end_char <= sentence.root.idx]
        if len(prefix) != 1:
            continue
        person, = prefix
        if ((person.root.dep_ == 'nsubj' and person.root.head == sentence.root)
                or DEFENDANT_INTRO.search(doc.text[sentence.start_char:person.start_char])):
            yield person.text, sentence


def reported_finding_links(index, doc):
    """Resolve a passive role finding to a named defendant in the same paragraph."""
    sentenced = {}
    for sentence in doc.sents:
        finding = sentence.root
        if (finding.lemma_ == 'find' and not UNRESOLVED.search(sentence.text)
                and not PARTY_ARGUMENT.search(sentence.text)
                and not any(t.dep_ == 'neg' or t.tag_ == 'MD' for t in sentence)):
            subjects = [t for t in finding.children if t.dep_ == 'nsubjpass']
            predicates = [t for t in finding.children if t.dep_ == 'xcomp' and t.lemma_ == 'be']
            if len(subjects) == 1 and any(
                role.dep_ == 'attr' and ROLE.fullmatch(role.text)
                and any(prep.lower_ == 'of' and any(target.dep_ == 'pobj'
                        and target.lemma_ in SCHEME_TARGETS for target in prep.children)
                        for prep in role.children)
                for predicate in predicates for role in predicate.children
            ):
                names = sentenced.get(canonical(subjects[0].text), {})
                if len(names) == 1:
                    name, identity = next(iter(names.values()))
                    yield name, sentence, [(index, identity)]
        for name in sentence.ents:
            root = name.root
            if (name.label_ == 'PERSON' and len(name) > 1 and root.head.lemma_ == 'sentence'
                    and root.dep_ in {'dobj', 'nsubjpass'} and not UNRESOLVED.search(sentence.text)
                    and not any(t.dep_ == 'neg' or t.tag_ == 'MD' for t in sentence)):
                full_name = canonical(name.text)
                sentenced.setdefault(full_name.split()[-1], {})[full_name] = (name.text, sentence)


def admitted_operator_links(doc):
    """Link a guilty plea to scheme operation stated in its charge summary."""
    sentences = list(doc.sents)
    for plea, charges in zip(sentences, sentences[1:]):
        if not (GUILTY_PLEA.search(plea.text) and PLEA_CHARGES.match(charges.text)
                and MISCONDUCT.search(charges.text)):
            continue
        if any(token.dep_ == 'neg' or token.tag_ == 'MD' for token in doc[plea.start:charges.end]):
            continue
        if UNRESOLVED.search(charges.text) or PARTY_ARGUMENT.search(charges.text):
            continue
        people = [person for person in plea.ents if person.label_ == 'PERSON']
        if (len(people) != 1 or plea.root.lemma_ not in {'plead', 'pled'}
                or people[0].root.dep_ != 'nsubj' or people[0].root.head != plea.root
                or any(person.label_ == 'PERSON' for person in charges.ents)):
            continue
        if any(verb.lemma_ in {'run', 'operate'} and verb.tag_ == 'VBG'
               and verb.dep_ == 'pcomp' and verb.head.lower_ == 'in'
               and verb.head.head.lemma_ == 'engage' and verb.head.head.head == charges.root
               and charges.root.lemma_ == 'include'
               and any(child.dep_ == 'dobj' and child.lemma_ in SCHEME_TARGETS for child in verb.children)
               for verb in charges):
            yield people[0].text, doc[plea.start:charges.end]


def stated_operator_links(doc):
    """Yield operators of a scheme in an asserted, source-attributed clause."""
    for sentence in doc.sents:
        line = sentence.text
        if not MISCONDUCT.search(line) or UNRESOLVED.search(line) or any(
            token.dep_ == 'neg' or token.tag_ == 'MD'
            or (token.pos_ == 'VERB' and PARTY_ARGUMENT.fullmatch(token.text))
            for token in sentence
        ):
            continue
        actor_tokens = set()
        for verb in sentence:
            if verb.lower_ != 'operated' or verb.lemma_ != 'operate':
                continue
            clause = verb.head if verb.dep_ == 'conj' else verb
            if clause.dep_ == 'ROOT' and any(
                child.dep_ == 'dobj' and child.lemma_ in SCHEME_TARGETS for child in verb.children
            ):
                actor_tokens.update(child for child in clause.children if child.dep_ == 'nsubj')
            reduced_passive = clause.dep_ == 'acl' and clause.head.lemma_ in SCHEME_TARGETS
            finite_passive = clause.dep_ == 'ROOT' and any(
                child.dep_ == 'nsubjpass' and child.lemma_ in SCHEME_TARGETS for child in clause.children
            )
            if reduced_passive or finite_passive:
                for agent in (child for child in verb.children if child.dep_ == 'agent'):
                    actor_tokens.update(child for child in agent.children if child.dep_ == 'pobj')
        for person in sentence.ents:
            if person.label_ == 'PERSON' and any(
                person.start <= token.i < person.end
                for actor in actor_tokens for token in [actor, *actor.conjuncts]
            ):
                yield person.text, sentence


def prison_term(match):
    count, unit = (match[2], match[3]) if match[2] else (match[4], match[5])
    value = int(count) if count.isdecimal() else NUMBERS[count.lower()]
    return value * (12 if unit.lower().startswith('year') else 1)


def possessive_scheme_links(index, docs):
    """Resolve a named operator's possessive reference to a previously described scheme."""
    for lead_index in range(index - 3, index - 1):
        if lead_index not in docs or lead_index + 1 not in docs:
            continue
        lead = next(iter(docs[lead_index].sents), None)
        if lead is None or UNRESOLVED.search(lead.text):
            continue
        term = PRISON_TERM.search(lead.text)
        if (term is None or term[1] or lead.root.lemma_ != 'sentence'
                or not re.search(r'\badmitted (?:running|operating) (?:a|the) (?:Ponzi|fraudulent) scheme\b',
                                 lead.text, re.I)):
            continue
        identity_doc = docs[lead_index + 1]
        identity_sentences = list(identity_doc.sents)
        people = [(person, sentence) for sentence in identity_sentences for person in named_sentencing(sentence)]
        if len(people) != 1:
            continue
        person, identity = people[0]
        surname = canonical(person.text).split()[-1]
        term_sentence = next((s for s in identity_sentences if s.start >= identity.start
                              and PRISON_TERM.search(s.text)
                              and re.search(r'\b' + re.escape(surname) + r'\b', s.text, re.I)), None)
        if term_sentence is None or UNRESOLVED.search(identity.text):
            continue
        corroborating_term = PRISON_TERM.search(term_sentence.text)
        if corroborating_term[1] or prison_term(corroborating_term) != prison_term(term):
            continue
        for sentence in docs[index].sents:
            if (UNRESOLVED.search(sentence.text) or PARTY_ARGUMENT.search(sentence.text)
                    or any(t.dep_ == 'neg' or t.tag_ == 'MD' for t in sentence)
                    or sentence.root.lemma_ not in {'run', 'operate'}):
                continue
            subjects = [t for t in sentence.root.children if t.dep_ == 'nsubj']
            if len(subjects) != 1 or canonical(subjects[0].text) != surname:
                continue
            if any(t.dep_ == 'dobj' and t.lemma_ == 'scheme'
                   and any(c.dep_ == 'poss' and c.lower_ in {'his', 'her'} for c in t.children)
                   for t in sentence.root.children):
                identity_span = identity_doc[identity.start:max(identity.end, term_sentence.end)]
                yield person.text, sentence, [(lead_index, lead), (lead_index + 1, identity_span)]


def named_sentencing(sentence):
    for person in sentence.ents:
        token = person.root
        if (person.label_ == 'PERSON' and token.dep_ == 'nsubjpass'
                and token.head.lemma_ == 'sentence'):
            yield person


def named_role_links(doc):
    for sentence in doc.sents:
        line = ' '.join(sentence.text.split())
        role = SENTENCED_FOR_ROLE.search(line)
        if role is None or BLOCKED.search(line) or PARTY_ARGUMENT.search(line):
            continue
        subject = line[:role.start()].rstrip()
        match = NAMED_DEFENDANT.search(subject) or NAMED_LEAD.fullmatch(subject)
        if match:
            yield match['name'], sentence


def explicit_sentencing_role_links(doc):
    """Link a person who is the subject of a sentence imposed for leading a scheme."""
    for sentence in doc.sents:
        line = sentence.text
        if re.search(r'\b(?:if|would have)\b', line, re.I) or any(
            token.pos_ == 'VERB' and PARTY_ARGUMENT.fullmatch(token.text) for token in sentence
        ):
            continue
        for person in named_sentencing(sentence):
            sentenced = person.root.head
            if sentenced.dep_ != 'ROOT' and not (
                sentenced.dep_ == 'ccomp' and sentenced.head.lemma_ == 'announce'
            ):
                continue
            if any(t.dep_ == 'neg' or t.tag_ == 'MD' or BLOCKED.fullmatch(t.text)
                   for head in {sentenced, sentenced.head} for t in head.children):
                continue
            for role in sentence[sentenced.i - sentence.start + 1:]:
                if role.lemma_ not in {'lead', 'operate', 'orchestrate'} or role.lower_ not in {
                    'leading', 'operating', 'orchestrating',
                }:
                    continue
                if role.dep_ != 'pcomp' or role.head.lower_ != 'for':
                    continue
                targets = [t for t in role.children if t.dep_ == 'dobj'
                           and t.lemma_ in SCHEME_TARGETS]
                if (targets and sentencing_reason(role.head, sentenced)
                        and not any(t.dep_ == 'neg' or BLOCKED.fullmatch(t.text)
                                    for head in [role, *targets] for t in head.children)):
                    yield person.text, sentence
                    break


def sentencing_reason(preposition, sentenced):
    # Some reports attach the reason to the conviction or supervised release.
    node = preposition.head
    while node != sentenced and node.lemma_ in SENTENCING_CONTEXT:
        if node.head == node:
            return False
        node = node.head
    return node == sentenced


def role_restatement(person, docs, start, stop):
    surname = re.escape(canonical(person.text).split()[-1])
    pattern = re.compile(ROLE_RESTATEMENT.format(surname=surname), re.I)
    for index in range(start, stop):
        if index not in docs:
            continue
        for sentence in docs[index].sents:
            line = sentence.text
            if pattern.search(line) and not (BLOCKED.search(line) or PARTY_ARGUMENT.search(line)):
                return index, sentence
    return None


def paragraph_link(index, docs):
    """Return the role sentence and identity evidence for a unique match."""
    first = next(iter(docs[index].sents), None)
    if first is None:
        return None
    lead = first.text.strip()
    term = PRISON_TERM.search(lead)
    if not (ROLE_LEAD.match(lead) and term and term[2]) or BLOCKED.search(lead) or PARTY_ARGUMENT.search(lead):
        return None
    if list(named_sentencing(first)):
        return None

    candidates = {}
    for identity_index in range(index + 1, index + 3):
        if identity_index not in docs:
            break
        for sentence in docs[identity_index].sents:
            people = list(named_sentencing(sentence))
            if len(people) > 1:
                return None
            if people:
                person = people[0]
                candidates[canonical(person.text)] = (identity_index, person, sentence)

    matches = {}
    for key, (identity_index, person, sentence) in candidates.items():
        if BLOCKED.search(sentence.text) or PARTY_ARGUMENT.search(sentence.text):
            continue
        evidence = [(identity_index, sentence)]
        named_term = PRISON_TERM.search(sentence.text)
        if not named_term and identity_index + 1 in docs:
            surname = canonical(person.text).split()[-1]
            followup = next(iter(docs[identity_index + 1].sents), None)
            if followup is not None and re.search(r'\b' + re.escape(surname) + r'\b', followup.text, re.I):
                if not BLOCKED.search(followup.text):
                    named_term = PRISON_TERM.search(followup.text)
                    if named_term:
                        evidence.append((identity_index + 1, followup))
        if named_term is None:
            if len(candidates) == 1 and (restatement := role_restatement(person, docs, identity_index + 1, index + 4)):
                matches[key] = (person.text, first, [*evidence, restatement])
            continue
        if named_term[1]:
            continue
        expected, observed = prison_term(term), prison_term(named_term)
        # A lead stated in whole years may round down a more precise sentence.
        agrees = expected < observed < expected + 12 if term[1] else expected == observed
        if agrees:
            matches[key] = (person.text, first, evidence)
    return next(iter(matches.values())) if len(matches) == 1 else None
