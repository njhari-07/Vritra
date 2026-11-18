"""Join reviewed role seeds to collected text and verify exact evidence locators."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re


def index_sources(folder):
    manifests = [folder / 'manifest.json', *sorted(folder.glob('archive-*/manifest.json'))]
    sources = {}
    for path in manifests:
        for record in json.loads(path.read_text()):
            if record['id'] in sources:
                raise ValueError(f'Duplicate source: {record["id"]}')
            sources[record['id']] = dict(record, folder=path.parent)
    return sources


def prepare(folder, seeds):
    sources = index_sources(folder)
    partitions = {}
    rows = []
    for annotation in seeds:
        source = sources[annotation['source_id']]
        if source['status'] != 'collected' or source['kind'] == 'fiction':
            raise ValueError(f'Real collected source required: {source["id"]}')
        case = source['case_id']
        split = annotation['split']
        if split not in {'development', 'held_out'}:
            raise ValueError(f'Invalid split: {split}')
        if partitions.setdefault(case, split) != split:
            raise ValueError(f'Case leakage across splits: {case}')
        content = (source['folder'] / source['text']).read_bytes()
        if hashlib.sha256(content).hexdigest() != source['text_sha256']:
            raise ValueError(f'Normalized text changed: {source["id"]}')
        units = [json.loads(line) for line in content.splitlines()]
        for claim in annotation['claims']:
            unit = units[claim['unit'] - 1]
            text = unit['text']
            anchor = claim['anchor']
            words = [re.escape(word) for word in anchor.split()]
            matches = list(re.finditer(r'\s+'.join(words), text, re.I))
            if len(matches) != 1:
                raise ValueError(f'Expected one verified match: {source["id"]} unit {claim["unit"]}')
            match = matches[0]
            actor_mentions = []
            for actor in claim['actors']:
                pattern = r'(?<!\w)' + r'\s+'.join(map(re.escape, actor.split())) + r'(?!\w)'
                mentions = [{'start': item.start(), 'end': item.end()}
                            for item in re.finditer(pattern, text, re.I)]
                if not mentions:
                    raise ValueError(f'Actor lacks a source span: {source["id"]} unit {claim["unit"]}')
                actor_mentions.append({'actor': actor, 'mentions_in_unit': mentions})
            rows.append({
                'case_id': case, 'source_id': source['id'], 'source_url': source['url'],
                'source_kind': source['kind'], 'split': split,
                'disposition': annotation['disposition'], 'role': claim['role'],
                'basis': claim['basis'], 'actors': claim['actors'],
                'actor_mentions': actor_mentions,
                'locator': {**{k: v for k, v in unit.items() if k != 'text'},
                            'char_start': match.start(), 'char_end': match.end()},
                'source_text_sha256': source['text_sha256'],
                'label_status': 'curated_seed_pending_independent_review',
            })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=Path('data/private/case-corpus'))
    parser.add_argument('--seeds', type=Path, default=Path('docs/evaluation/case-role-seeds.json'))
    args = parser.parse_args()
    rows = prepare(args.folder, json.loads(args.seeds.read_text()))
    target = args.folder / 'role-annotations.jsonl'
    target.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
    summary = {
        'cases_by_split': dict(Counter(split for _, split in
                                       {(row['case_id'], row['split']) for row in rows})),
        'claims_by_split': dict(Counter(row['split'] for row in rows)),
        'basis_counts': dict(Counter(row['basis'] for row in rows)),
    }
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
