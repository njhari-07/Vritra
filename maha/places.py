"""Source-backed place mentions and local geocoding."""

from datetime import date
from functools import lru_cache
from http.client import HTTPConnection, HTTPException
import json
from math import isfinite
import os
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlencode, urlsplit

from .store import uid


PLACE_LABELS = {'GPE', 'LOC', 'LOCATION', 'FAC', 'PLACE'}
PLACE_LINES = [
    ('reported_presence', re.compile(
        r'^[ \t]*(?:Witness (?:statement|account):[ \t]*)?(?P<subject>[A-Z][A-Za-z .\'-]{2,78}?)'
        r'[ \t]+was (?:seen|reported|recorded) (?:at|in)[ \t]+(?P<place>[^\r\n;]{2,180})$', re.M | re.I)),
    ('event_location', re.compile(
        r'^[ \t]*(?P<subject>Incident|Meeting|Delivery|Handover|Search|Pickup|Seizure|Event)'
        r'[ \t]+(?:took place|occurred|was reported) (?:at|in)[ \t]+(?P<place>[^\r\n;]{2,180})$', re.M | re.I)),
    ('address', re.compile(
        r'^[ \t]*(?P<subject>Registered address|Office address|Address of premises|Police station address|Court address|Place of occurrence)'
        r'[ \t]*:[ \t]*(?P<place>[^\r\n;]{2,180})$', re.M | re.I)),
]
DATE_SUFFIX = re.compile(r'[ \t]+on[ \t]+(\d{4}-\d{2}-\d{2})\.?\s*$', re.I)
REGIONAL_LINK = 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/'


def place_record(text, start, end, relation, subject=None, when=None):
    first = text.rfind('\n', 0, start) + 1
    last = text.find('\n', end)
    last = len(text) if last < 0 else last
    label = {'address': 'Printed address', 'reported_presence': 'Reported presence',
             'event_location': 'Reported event location', 'mention': 'Place mention'}[relation]
    return {
        'locator': {'char_start': first, 'char_end': last, 'place_start': start, 'place_end': end, 'text_label': label},
        'passage': text[first:last], 'method': 'document-place-mention', 'facts': [], 'confidence': None,
        'confidence_basis': 'Place or location association as reported by the source',
        'event_time': when, 'time_basis': 'date_only' if when else 'not_supplied',
        'document_place': {'text': text[start:end], 'relation': relation, 'subject': subject},
    }


def document_place_records(text, observations):
    explicit = []
    for relation, pattern in PLACE_LINES:
        for match in pattern.finditer(text):
            start, end = match.span('place')
            value = match['place'].rstrip(' .\r\t')
            when = None
            if suffix := DATE_SUFFIX.search(value):
                try:
                    when = date.fromisoformat(suffix[1]).isoformat()
                except ValueError:
                    continue
                value = value[:suffix.start()].rstrip(' .,')
            if len(value) < 2:
                continue
            end = start + len(value)
            explicit.append((start, end))
            category = 'event_location' if match['subject'].casefold() == 'place of occurrence' else relation
            yield place_record(text, start, end, category, match['subject'], when)
    seen = set()
    for item in observations:
        locator = item.get('locator', {})
        label = locator.get('legal_label') or locator.get('text_label')
        if label not in PLACE_LABELS:
            continue
        start, end = locator['char_start'], locator['char_end']
        if (start, end) in seen or any(left <= start and end <= right for left, right in explicit):
            continue
        seen.add((start, end))
        yield place_record(text, start, end, 'mention')


def normalize(value):
    normalized = unicodedata.normalize('NFKC', value).casefold()
    return ' '.join(re.findall(r'[^\W_]+', normalized))


@lru_cache(maxsize=2)
def catalogue(path):
    with Path(path).open(encoding='utf-8') as source:
        return json.load(source)


def catalogue_matches(place):
    default = Path(__file__).with_name('india_places.json')
    path = os.getenv('MAHA_PLACE_CATALOG', str(default))
    query = normalize(place)
    matches = []
    for item in catalogue(path):
        names = [normalize(value) for value in (item['name'], *item.get('aliases', []))]
        region = normalize(item['region'])
        if query in names or any(query == name + ' ' + region for name in names):
            score = 0
        elif any(name and len(name) >= 4 and f' {name} ' in f' {query} ' for name in names):
            score = 1
        else:
            continue
        level = item.get('level', 'city')
        matches.append((score, {
            'id': 'catalogue:' + item['id'], 'name': item['name'] + ', ' + item['region'],
            'lat': item['lat'], 'lon': item['lon'], 'level': level,
            'geometry': 'point' if level == 'site' else 'area', 'bounds': item.get('bounds'),
            'provider': 'Local reference catalogue',
        }))
    return [value for _, value in sorted(matches, key=lambda result: (result[0], result[1]['name']))[:10]]


def local_nominatim(place):
    address = os.getenv('MAHA_LOCAL_GEOCODER', '')
    if not address:
        return []
    url = urlsplit(address)
    if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', '::1')
            or url.username or url.password or url.query or url.fragment):
        return []
    params = urlencode({'q': place, 'format': 'jsonv2', 'countrycodes': 'in', 'limit': 6})
    connection = None
    try:
        connection = HTTPConnection(url.hostname, url.port, timeout=2.5)
        connection.request('GET', url.path.rstrip('/') + '/search?' + params, headers={'User-Agent': 'MAHA-local-place-review'})
        result = connection.getresponse()
        if result.status != 200:
            return []
        raw = result.read(262_145)
        if len(raw) > 262_144:
            return []
        records = json.loads(raw)
        matches = []
        for item in records:
            lat, lon = float(item['lat']), float(item['lon'])
            if not (isfinite(lat) and -90 <= lat <= 90 and isfinite(lon) and -180 <= lon <= 180):
                continue
            level = item.get('addresstype', item.get('type', 'place'))
            is_site = level in {'house', 'building', 'amenity', 'office', 'shop', 'tourism'}
            extent = item.get('boundingbox', [])
            bounds = [float(value) for value in extent] if len(extent) == 4 else None
            if bounds and not all(isfinite(value) for value in bounds):
                bounds = None
            matches.append({'id': 'osm:' + uid(item.get('osm_type'), item.get('osm_id'), lat, lon),
                            'name': item['display_name'][:400], 'lat': lat, 'lon': lon, 'level': level,
                            'geometry': 'point' if is_site else 'area', 'bounds': bounds,
                            'provider': 'Local Nominatim'})
        return matches
    except (TypeError, ValueError, KeyError, HTTPException, OSError):
        return []
    finally:
        if connection is not None:
            connection.close()


def lookup_place(text):
    return (local_nominatim(text) + catalogue_matches(text))[:12]
