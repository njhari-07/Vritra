"""Case-scoped synthetic location observations and uncertainty-aware queries."""

from bisect import bisect_left, bisect_right
import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
from math import asin, cos, isfinite, radians, sin, sqrt
import re

from .ingestion import csv_rows, json_row
from .limits import check


DATASET = 'synthetic-location'
LOCATION_HEADER = ['record_id', 'subject_id', 'device_id', 'observed_at', 'latitude', 'longitude',
                   'accuracy_m', 'source_kind', 'synthetic']
SCENARIO_HEADER = ['record_id', 'event_kind', 'event_time', 'end_time', 'description', 'synthetic']
SOURCE_KINDS = {'gps', 'cell_tower', 'photo_exif', 'manual'}
IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}')
EARTH_RADIUS_M = 6_371_008.8


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError('Use an ISO timestamp with a timezone') from None
    if parsed.utcoffset() is None:
        raise ValueError('Use an ISO timestamp with a timezone')
    return parsed.astimezone(timezone.utc).isoformat(timespec='microseconds')


def number(value, low, high, field):
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise ValueError(f'Enter a valid {field}') from None
    if not isfinite(result) or not low <= result <= high:
        raise ValueError(f'{field} is outside the supported range')
    return result


def location_records(content):
    seen = set()
    for values, locator in csv_rows(content, LOCATION_HEADER):
        check(locator['record_ordinal'], 'IMPORT_RECORDS', 5000)
        if len(values) != len(LOCATION_HEADER) or values[-1].strip().lower() != 'true':
            raise ValueError('Every location row must follow the template and be marked synthetic')
        record, subject, device, raw_time, lat, lon, accuracy, source, _ = map(str.strip, values)
        try:
            if not all(IDENTIFIER.fullmatch(value) for value in (record, subject, device)):
                raise ValueError('Record, subject, and device require valid synthetic IDs')
            if record in seen:
                raise ValueError('Record ID appears more than once in this file')
            if source not in SOURCE_KINDS:
                raise ValueError('Use gps, cell_tower, photo_exif, or manual as the source kind')
            event_time = timestamp(raw_time)
            radius = number(accuracy, 0, EARTH_RADIUS_M, 'accuracy radius')
            if radius == 0:
                raise ValueError('Accuracy radius must be greater than zero metres')
            data = {'record_id': record, 'subject_id': subject, 'device_id': device, 'source_kind': source,
                    'latitude': number(lat, -90, 90, 'latitude'), 'longitude': number(lon, -180, 180, 'longitude'),
                    'accuracy_m': radius}
        except (ValueError, OverflowError) as exc:
            yield {'locator': locator, 'error': str(exc)}
            continue
        seen.add(record)
        yield {'locator': locator, 'passage': json_row(values), 'facts': [], 'event_time': event_time,
               'time_basis': 'explicit_UTC', 'confidence': None,
               'confidence_basis': 'Synthetic observation with a stated accuracy radius', 'location_observation': data}


def csv_bytes(header, rows=()):
    stream = StringIO(newline='')
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow(header)
    writer.writerows(rows)
    return stream.getvalue().encode('utf-8')


def synthetic_location_scenario():
    """Generate the case source in memory. The coordinate grid and subjects are fictional."""
    first = csv_bytes(LOCATION_HEADER, [
        ('L01', 'DEMO-A', 'DEVICE-A', '2026-10-01T08:00:00+00:00', 0, 0, 15, 'gps', 'true'),
        ('L02', 'DEMO-B', 'DEVICE-B', '2026-10-01T08:00:30+00:00', 0.0005, 0, 150, 'cell_tower', 'true'),
        ('L03', 'DEMO-C', 'DEVICE-C', '2026-10-01T08:00:15+00:00', 0.0002, 0, 10, 'gps', 'true'),
        ('L04', 'DEMO-A', 'DEVICE-A', '2026-10-01T08:15:00+00:00', 0.0040, 0.0030, 20, 'gps', 'true'),
        ('L05', 'DEMO-B', 'DEVICE-B', '2026-10-01T08:15:00+00:00', 0.0060, 0.0060, 220, 'cell_tower', 'true'),
        ('L06', 'DEMO-C', 'DEVICE-C', '2026-10-01T08:19:00+00:00', 0.0010, 0.0030, 50, 'photo_exif', 'true'),
    ])
    second = csv_bytes(SCENARIO_HEADER, [
        ('S01', 'reported_time_range', '2026-10-01T07:55:00+00:00', '2026-10-01T08:10:00+00:00',
         'Synthetic postmortem estimate of the time window', 'true'),
        ('S02', 'contact', '2026-10-01T08:00:30+00:00', '',
         'Synthetic call record between DEMO-A and DEMO-B', 'true'),
        ('S03', 'credit', '2026-10-01T08:13:00+00:00', '',
         'Synthetic bank credit linked to DEMO-B', 'true'),
        ('S04', 'statement', '2026-10-01T08:15:00+00:00', '',
         'Synthetic narrative claims DEMO-A was at the grid origin at 08:15 UTC', 'true'),
    ])
    records = list(location_records(first))
    offset = first.count(b'\n')
    record_offset = len(records)
    for row, locator in csv_rows(second, SCENARIO_HEADER):
        _, kind, start, end, label, _ = row
        locator['record_ordinal'] += record_offset
        locator['line_start'] += offset
        locator['line_end'] += offset
        records.append({'locator': locator, 'passage': json_row(row), 'facts': [], 'event_time': timestamp(start),
                        'time_basis': 'explicit_UTC', 'confidence': None, 'confidence_basis': 'Synthetic scenario context',
                        'location_context': {'kind': kind, 'label': label, 'end_time': timestamp(end) if end else None}})
    return first + second, records


def window_observations(observations, start=None, end=None, subject=None):
    if start and end and start > end:
        raise ValueError('Start must be on or before end')
    return [row for row in observations if (not start or row['event_time'] >= start)
            and (not end or row['event_time'] <= end) and (not subject or row['subject_id'] == subject)]


def proximity(first, second, radius):
    a, b = radians(first['latitude']), radians(second['latitude'])
    half_lat = (a - b) / 2
    half_lon = radians(first['longitude'] - second['longitude']) / 2
    distance = 2 * EARTH_RADIUS_M * asin(sqrt(min(1, sin(half_lat) ** 2 + cos(a) * cos(b) * sin(half_lon) ** 2)))
    uncertainty = first['accuracy_m'] + second['accuracy_m']
    low, high = max(0, distance - uncertainty), distance + uncertainty
    classification = 'within_radius' if high <= radius else 'possible_overlap' if low <= radius else 'outside'
    return {'classification': classification, 'distance_m': round(distance, 2),
            'minimum_m': round(low, 2), 'maximum_m': round(high, 2)}


def place_matches(rows, latitude, longitude, radius):
    point = {'latitude': latitude, 'longitude': longitude, 'accuracy_m': 0}
    return [{**match, 'observations': [row]} for row in rows
            if (match := proximity(row, point, radius))['classification'] != 'outside']


def pair_matches(rows, subject, other, radius, tolerance_seconds):
    right = [row for row in rows if row['subject_id'] == other]
    origin = datetime.min.replace(tzinfo=timezone.utc)
    times = [datetime.fromisoformat(row['event_time']) - origin for row in right]
    delta = timedelta(seconds=tolerance_seconds)
    results = []
    compared = 0
    for first in rows:
        if first['subject_id'] != subject:
            continue
        when = datetime.fromisoformat(first['event_time']) - origin
        begin, end = bisect_left(times, when - delta), bisect_right(times, when + delta)
        compared += end - begin
        check(compared, 'LOCATION_PAIR_COMPARISONS', 20_000)
        for second in right[begin:end]:
            if first['device_id'] == second['device_id']:
                continue
            match = proximity(first, second, radius)
            if match['classification'] != 'outside':
                results.append({**match, 'observations': [first, second]})
                check(len(results), 'LOCATION_MATCHES', 1000)
    return results
