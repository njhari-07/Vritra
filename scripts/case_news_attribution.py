"""Identify explicit organizer attributions quoted from a named judge."""
import re


JUDGE = re.compile(r'\b(?:Judge|Justice) (?P<name>[A-Z][a-z’\'-]+(?: [A-Z](?:\.|[a-z’\'-]+)){0,3})')
QUOTE = re.compile(r'"[^"\n]+"|“[^”\n]+”')
ROLE = {'instigator', 'organizer', 'leader', 'mastermind'}
WRONGDOING = {'fraud', 'conspiracy', 'scheme', 'ring', 'wrongdoing'}
OTHER_SPEAKER = re.compile(r'\b(?:attorney|lawyer|counsel|prosecutor|witness|defendant)\s*$', re.I)


def cited_judges(texts):
    judges = {}
    for i, text in enumerate(texts):
        for match in JUDGE.finditer(text):
            name = match['name']
            surname = name.split()[-1]
            names = judges.setdefault(surname, {})
            names.setdefault(name, (i, match.start(), match.end()))
    return judges


def quoted_judicial_links(doc, judges, unit_index):
    for sentence in doc.sents:
        quotes = [match.span() for match in QUOTE.finditer(sentence.text)]
        if not quotes:
            continue
        for role in sentence:
            if role.lemma_ not in ROLE or role.dep_ != 'attr':
                continue
            copula = role.head
            speech = copula.head
            carrier = speech.head if speech.dep_ == 'conj' else speech
            if (copula.lemma_ != 'be' or copula.dep_ != 'ccomp'
                    or speech.lemma_ not in {'say', 'state', 'write', 'conclude'}
                    or carrier.dep_ != 'ROOT'):
                continue
            if any(child.dep_ == 'neg' or child.tag_ == 'MD'
                   for token in {copula, speech, carrier} for child in token.children):
                continue
            if not any(token.lemma_ in WRONGDOING for token in role.subtree):
                continue
            speakers = [token for token in speech.children if token.dep_ == 'nsubj']
            if speech != carrier and not speakers:
                speakers = [token for token in carrier.children if token.dep_ == 'nsubj']
            if len(speakers) != 1:
                continue
            names = judges.get(speakers[0].text, {})
            if len(names) != 1:
                continue
            attribution, locator = next(iter(names.items()))
            speaker = speakers[0]
            if OTHER_SPEAKER.search(doc.text[sentence.start_char:speaker.idx]):
                continue
            explicit_name = next(
                (entity.text for entity in sentence.ents
                 if entity.label_ == 'PERSON' and entity.start <= speaker.i < entity.end),
                speaker.text,
            )
            if explicit_name not in {speaker.text, attribution}:
                continue
            if locator[0] > unit_index:
                continue
            for person in sentence.ents:
                if not (person.label_ == 'PERSON' and person.root.dep_ == 'nsubj' and person.root.head == copula):
                    continue
                start, end = person.start_char - sentence.start_char, role.idx + len(role) - sentence.start_char
                if any(left < start < end < right for left, right in quotes):
                    yield person.text, sentence, attribution, locator
