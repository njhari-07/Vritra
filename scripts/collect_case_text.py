"""Collect allowlisted case texts and retain provenance in private storage."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import pdfplumber

HOSTS = {'www.justice.gov', 'api.sci.gov.in', 'enforcementdirectorate.gov.in',
         'www.gutenberg.org', 'gutenberg.pglaf.org', 'www.govinfo.gov', 'www.fbi.gov', 'archives.fbi.gov',
         'www.asic.gov.au', 'asic.gov.au',
         'en.wikinews.org',
         'indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com'}
CAP = 8 * 1024 * 1024


class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.result = []

    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            self.current = []
        elif tag == 'br' and self.current is not None:
            self.current.append(' ')

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'p' and self.current is not None:
            text = ' '.join(''.join(self.current).split())
            if text:
                self.result.append(text)
            self.current = None


def digest(content):
    return hashlib.sha256(content).hexdigest()


def write(path, content):
    stage = path.with_suffix(path.suffix + '.part')
    stage.write_bytes(content)
    stage.replace(path)


def book_paragraphs(text, first_line):
    units, lines = [], []
    for number, line in enumerate(text.splitlines() + [''], first_line):
        if line.strip():
            lines.append(line.strip())
        elif lines:
            units.append({'paragraph': len(units) + 1, 'line_start': number - len(lines),
                          'line_end': number - 1, 'text': ' '.join(lines)})
            lines = []
    return units


def wikinews_article(markup, source):
    body = re.search(r'<div\b[^>]*class="[^"]*\bmw-parser-output\b[^"]*"[^>]*>', markup)
    end = re.search(r'\bid="Sources"', markup[body.end():]) if body else None
    revision = re.search(r'"wgRevisionId":\s*(\d+)', markup)
    if not (body and end and revision) or int(revision[1]) != source['revision']:
        raise ValueError(f'Wikinews article or revision mismatch: {source["id"]}')
    parser = Paragraphs()
    parser.feed(markup[body.end():body.end() + end.start()])
    return [p for p in parser.result if not p.startswith('Have an opinion on this story?')]


def collect(source, output):
    sid, fmt = source['id'], source['format']
    if not re.fullmatch(r'[A-Z0-9-]+', sid) or fmt not in {'pdf', 'html', 'txt'}:
        raise ValueError(f'Invalid source definition: {sid}')
    url = urlsplit(source['url'])
    if url.scheme != 'https' or url.hostname not in HOSTS or url.username:
        raise ValueError(f'Unapproved source URL: {sid}')
    request = Request(source['url'], headers={'User-Agent': 'MAHA case corpus research/0.1'})
    with urlopen(request, timeout=24) as response:
        final_url = response.geturl()
        if urlsplit(final_url).hostname not in HOSTS:
            raise ValueError(f'Download redirected outside approved publishers: {sid}')
        content = response.read(CAP + 1)
        encoding = response.headers.get_content_charset() or 'utf-8'
    if len(content) > CAP:
        raise ValueError(f'Source exceeds download limit: {sid}')
    if fmt == 'pdf':
        if not content.startswith(b'%PDF-'):
            raise ValueError(f'Expected a PDF: {sid}')
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            units = [{'page': i, 'text': page.extract_text() or ''}
                     for i, page in enumerate(pdf.pages, 1)]
    elif fmt == 'html':
        markup = content.decode(encoding, errors='replace')
        if 'bm-verify=' in markup and 'http-equiv="refresh"' in markup:
            raise ValueError('Publisher returned a browser verification page')
        if source['kind'] == 'news':
            paragraphs = wikinews_article(markup, source)
        else:
            parser = Paragraphs()
            parser.feed(markup)
            paragraphs = parser.result
        units = [{'paragraph': i, 'text': text}
                 for i, text in enumerate(paragraphs, 1)]
    else:
        text = content.decode('utf-8-sig')
        start = re.search(r'^\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\n',
                          text, re.M)
        end = re.search(r'^\*\*\* END OF THE PROJECT GUTENBERG EBOOK', text, re.M)
        if not start or not end or end.start() <= start.end():
            raise ValueError(f'Gutenberg markers missing: {sid}')
        body = text[start.end():end.start()]
        first_line = text.count('\n', 0, start.end()) + 1
        if source.get('text_units') == 'paragraph':
            units = book_paragraphs(body, first_line)
        else:
            units = [{'line': i, 'text': line.strip()} for i, line in enumerate(body.splitlines(), first_line)
                     if line.strip()]
    normalized = '\n'.join(json.dumps(unit, ensure_ascii=False) for unit in units).encode()
    characters = sum(len(unit['text']) for unit in units)
    if characters < 400 or (fmt == 'pdf' and not units):
        raise ValueError(f'Missing readable case text: {sid}')
    raw, extracted = f'{sid}.source.{fmt}', f'{sid}.units.jsonl'
    write(output / raw, content)
    write(output / extracted, normalized)
    return dict(source, status='collected', final_url=final_url, raw=raw, text=extracted,
                sha256=digest(content), text_sha256=digest(normalized), units=len(units),
                characters=characters, fetched_at=datetime.now(timezone.utc).isoformat(),
                empty_units=sum(not unit['text'] for unit in units))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=Path('docs/evaluation/case-text-sources.json'))
    parser.add_argument('--ids', nargs='+', help='Fetch only these source IDs')
    parser.add_argument('--output', type=Path, default=Path('data/private/case-corpus'))
    args = parser.parse_args()
    sources = json.loads(args.sources.read_text())
    if len({source['id'] for source in sources}) != len(sources):
        parser.error('Source identifiers must be unique')
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = args.output / 'manifest.json'
    previous = {row['id']: row for row in json.loads(manifest.read_text())} if manifest.exists() else {}
    selected = set(args.ids or [source['id'] for source in sources])
    if selected - {source['id'] for source in sources}:
        parser.error('Unknown source ID in --ids')
    targets = [source for source in sources if source['id'] in selected]
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(collect, source, args.output) for source in targets]
        for source, job in zip(targets, jobs, strict=True):
            try:
                report = job.result()
            except Exception as exc:
                report = dict(source, status='failed', error=str(exc))
            previous[source['id']] = report
            print(report['id'], report['status'], report.get('characters', report.get('error')), flush=True)
    reports = [previous[source['id']] for source in sources if source['id'] in previous]
    write(args.output / 'manifest.json', (json.dumps(reports, indent=2) + '\n').encode())
    return any(report['status'] != 'collected' for report in reports if report['id'] in selected)


if __name__ == '__main__':
    raise SystemExit(main())
