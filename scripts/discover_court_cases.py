"""Generate a bounded source list from Indian Supreme Court open-data metadata."""
import argparse
import json
from pathlib import Path
import re

import pyarrow.parquet as pq

HOST = 'https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com'
REGISTRY = 'https://registry.opendata.aws/indian-supreme-court-judgments/'
TOPICS = re.compile(r'money laundering|bank fraud|financial fraud|criminal conspiracy|corruption|cheating|embezzlement', re.I)
FINANCIAL = re.compile(r'money laundering|bank fraud|financial fraud|embezzlement', re.I)


def discover(metadata, limit):
    matches = {}
    for batch in pq.ParquetFile(metadata).iter_batches(columns=[
        'description', 'nc_display', 'path', 'year'
    ]):
        for row in batch.to_pylist():
            description = row['description'] or ''
            citation, path, year = row['nc_display'], row['path'], str(row['year'])
            if (not re.fullmatch(r'\d{4}INSC\d+', citation or '')
                    or not re.fullmatch(r'\d{4}', year)
                    or not re.fullmatch(r'[\d_]+', path or '')
                    or not TOPICS.search(description)):
                continue
            key = f'IN-ARCHIVE-{citation}'
            matches[key] = (bool(FINANCIAL.search(description)), {
                'id': key, 'case_id': key, 'citation': citation,
                'kind': 'judgment', 'publisher': 'Supreme Court of India via Dattam Labs',
                'url': f'{HOST}/data/pdf/year={year}/english/{path}_EN.pdf',
                'format': 'pdf', 'use': 'archive_cc_by_4_0', 'archive_attribution': REGISTRY,
                'selection': 'Topic mention in published metadata, pending reading',
            })
    ordered = sorted(matches.values(), key=lambda item: (not item[0], item[1]['citation']))
    return [row for _, row in ordered[:limit]], len(matches)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('metadata', type=Path)
    parser.add_argument('--limit', type=int, default=24)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error('--limit must be 1–100')
    rows, matched = discover(args.metadata, args.limit)
    args.output.write_text(json.dumps(rows, indent=2) + '\n')
    print(f'{matched} metadata matches, {len(rows)} selected for text collection')
