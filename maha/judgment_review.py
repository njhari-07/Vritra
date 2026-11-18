"""Append-only review of a legal mention against its original judgment."""
import json

from .store import now

LEGAL_LABELS = (
    'CASE_NUMBER', 'COURT', 'DATE', 'GPE', 'JUDGE', 'LAWYER', 'ORG',
    'OTHER_PERSON', 'PETITIONER', 'PRECEDENT', 'PROVISION', 'RESPONDENT',
    'STATUTE', 'WITNESS',
)


class ReviewConflict(Exception):
    pass


def _review_context(db, evidence_id, cases):
    row = db.execute('SELECT case_id, source_id, data FROM evidence WHERE id=?',
                     (evidence_id,)).fetchone()
    if not row or row['case_id'] not in cases:
        raise KeyError(evidence_id)
    evidence = json.loads(row['data'])
    if evidence['dataset_id'] != 'court-judgment' or evidence['extraction_method'] != 'en_legal_ner_sm':
        raise KeyError(evidence_id)
    scopes = {r[0] for r in db.execute(
        'SELECT DISTINCT case_id FROM imports WHERE source_id=?', (row['source_id'],))}
    if not scopes or not scopes.issubset(cases):
        raise KeyError(evidence_id)
    source = db.execute('SELECT content FROM sources WHERE id=?', (row['source_id'],)).fetchone()
    if not source:
        raise KeyError(evidence_id)
    locator = evidence['source_locator']
    start, end = locator['char_start'], locator['char_end']
    excerpt = evidence.get('review_excerpt')
    if excerpt:
        left, context = excerpt['start'], excerpt['text']
    else:
        text = source['content'].decode('utf-8-sig')
        left = max(0, start - 180)
        context = text[left:end + 180]
    if not left <= start < end <= left + len(context) or context[start-left:end-left] != evidence['passage']:
        raise ReviewConflict('Stored mention does not match its source offsets')
    history = [
        {'id': event['id'], **json.loads(event['data'])}
        for event in db.execute(
            'SELECT id,data FROM judgment_reviews WHERE evidence_id=? ORDER BY id DESC LIMIT 50',
            (evidence_id,))
    ]
    return row['case_id'], {
        'evidence_id': evidence_id, 'context': context, 'context_start': left,
        'original': {'start': start, 'end': end, 'label': locator['legal_label'],
                     'passage': evidence['passage']},
        'labels': list(LEGAL_LABELS), 'history': history,
    }


def load_review(store, evidence_id, cases):
    with store.db() as db:
        db.execute('BEGIN')
        _, review = _review_context(db, evidence_id, cases)
        return review


def save_review(store, evidence_id, cases, actor, data):
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        case_id, review = _review_context(db, evidence_id, cases)
        latest = review['history'][0]['id'] if review['history'] else None
        if data['previous_id'] != latest:
            raise ReviewConflict('Another review was saved. Reload this mention before submitting.')
        decision = data['decision']
        start, end, label = data['start'], data['end'], data['label']
        mention = None
        if decision == 'corrected':
            left = review['context_start']
            context = review['context']
            if start is None or end is None or not left <= start < end <= left + len(context):
                raise ValueError('Correction offsets must select a span within the displayed excerpt')
            passage = context[start-left:end-left]
            if label not in LEGAL_LABELS or not passage.strip():
                raise ValueError('Select a legal label and a nonblank source span')
            mention = {'start': start, 'end': end, 'label': label, 'passage': passage}
        elif any(value is not None for value in (start, end, label)):
            raise ValueError('Correction fields are only allowed for a corrected decision')
        elif decision == 'approved':
            mention = review['original']
        reason = data['reason'].strip()
        if len(reason) < 3:
            raise ValueError('Enter a review reason of at least three characters')
        event = {'decision': decision, 'reason': reason, 'mention': mention,
                 'actor': actor, 'at': now()}
        cursor = db.execute('INSERT INTO judgment_reviews(evidence_id,data) VALUES (?,?)',
                            (evidence_id, json.dumps(event)))
        db.execute('INSERT INTO audit(at,actor,action,case_id,object_id) VALUES (?,?,?,?,?)',
                   (event['at'], actor, 'judgment_mention_review', case_id, evidence_id))
        return {'id': cursor.lastrowid, **event}
