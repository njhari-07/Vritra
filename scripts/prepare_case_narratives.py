"""Export source-attributed narrative role seeds with verified evidence spans."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from prepare_case_roles import index_sources


def unique_span(text, anchor, source, number):
    if not anchor.strip():
        raise ValueError(f'Empty evidence anchor: {source} paragraph {number}')
    pattern = r'(?<!\w)' + r'\s+'.join(map(re.escape, anchor.split())) + r'(?!\w)'
    hits = list(re.finditer(pattern, text))
    if len(hits) != 1:
        raise ValueError(f'Expected one evidence match: {source} paragraph {number} ({anchor!r})')
    return {'start': hits[0].start(), 'end': hits[0].end()}


def checked_file(source, key, digest_key):
    data = (source['folder'] / source[key]).read_bytes()
    if hashlib.sha256(data).hexdigest() != source[digest_key]:
        raise ValueError(f'Unexpected file revision: {source["id"]} ({key})')
    return data


def prepare(folder, seeds):
    sources = index_sources(folder)
    books, partitions = {}, {}
    rows = []
    for seed in seeds:
        sid, episode, split = seed['source_id'], seed['episode'], seed['split']
        source = sources[sid]
        if (source['status'] != 'collected' or source['format'] != 'txt'
                or source['kind'] not in {'historical_narrative', 'fiction'}
                or source.get('text_units') != 'paragraph'):
            raise ValueError(f'Expected a collected narrative with book paragraphs: {sid}')
        if split not in {'development', 'held_out'} or not episode.strip():
            raise ValueError(f'Invalid episode or split: {sid}')
        for group in [('episode', episode), ('source', sid)]:
            if partitions.setdefault(group, split) != split:
                raise ValueError(f'Narrative leakage across splits: {group[1]}')
        if sid not in books:
            raw = checked_file(source, 'raw', 'sha256').decode('utf-8-sig').splitlines()
            content = checked_file(source, 'text', 'text_sha256')
            units = {}
            for line in content.splitlines():
                unit = json.loads(line)
                number = unit['paragraph']
                first, last = unit['line_start'], unit['line_end']
                if (number in units or not 1 <= first <= last <= len(raw)
                        or ' '.join(line.strip() for line in raw[first - 1:last]) != unit['text']):
                    raise ValueError(f'Invalid source line mapping: {sid} paragraph {number}')
                units[number] = unit
            books[sid] = units
        number = seed['paragraph']
        unit = books[sid][number]
        role_span = unique_span(unit['text'], seed['role_anchor'], sid, number)
        if seed.get('person_within_role'):
            start, end = role_span['start'], role_span['end']
            person_span = {
                key: value + start for key, value in
                unique_span(unit['text'][start:end], seed['person_anchor'], sid, number).items()
            }
        else:
            person_span = unique_span(unit['text'], seed['person_anchor'], sid, number)
        rows.append({
            'source_id': sid,
            'source_url': source.get('catalog_url', source['url']),
            'source_kind': source['kind'],
            'source_text_sha256': source['text_sha256'],
            'episode': episode,
            'split': split,
            'person': seed['person'],
            'role': seed['role'],
            'basis': seed['basis'],
            'locator': {k: unit[k] for k in ('paragraph', 'line_start', 'line_end')},
            'person_span': person_span,
            'role_span': role_span,
            'label_status': 'curated_seed_pending_independent_review',
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--seeds', type=Path, default=Path('docs/evaluation/case-narrative-role-seeds.json'))
    args = parser.parse_args()
    rows = prepare(args.folder, json.loads(args.seeds.read_text()))
    target = args.folder / 'narrative-role-annotations.jsonl'
    target.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    print(f'Exported {len(rows)} annotations from {len({row["episode"] for row in rows})} episodes to {target}')


if __name__ == '__main__':
    main()
