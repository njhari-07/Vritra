import csv
import hashlib
import io
import json

from fastapi.testclient import TestClient

from maha.api import create_app
from maha.locations import LOCATION_HEADER, csv_bytes, synthetic_location_scenario
from maha.store import Store


def test_location_scenario_preserves_sources_and_time_area_queries(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['SCENARIO'])}
    outsider = {'Authorization': 'Bearer ' + store.create_user('outside', ['OTHER'])}
    path = '/api/locations/SCENARIO'
    start = '2026-10-01T08:00:00Z'
    end = '2026-10-01T08:01:00Z'
    window = {'start': start, 'end': end, 'radius_m': 100}
    with TestClient(create_app(store)) as client:
        created = client.post(path + '/demo', headers=headers)
        assert created.status_code == 200, created.text
        assert created.json()['accepted_new'] == 10
        assert client.post(path + '/demo', headers=headers).json()['recognized_repeat'] == 10
        rows = client.get(path, headers=headers).json()
        assert len(rows) == 6
        assert client.get(path, headers=outsider).status_code == 404
        assert client.post(path + '/demo', headers=outsider).status_code == 404
        range_rows = client.get(path, headers=headers, params={'start': start, 'end': end, 'subject': 'DEMO-A'}).json()
        assert [row['record_id'] for row in range_rows] == ['L01']
        assert client.get(path, headers=headers, params={'start': '2026-10-01T08:00:00'}).status_code == 422

        nearby = client.get(path + '/near-place', headers=headers, params={**window, 'latitude': 0, 'longitude': 0}).json()
        assert {item['observations'][0]['record_id']: item['classification'] for item in nearby} == {
            'L01': 'within_radius', 'L02': 'possible_overlap', 'L03': 'within_radius',
        }
        full_window = {**window, 'end': '2026-10-01T08:20:00Z', 'latitude': 0, 'longitude': 0}
        assert client.get(path + '/near-place', headers=headers, params=full_window).json() == nearby
        compare = {**window, 'subject': 'DEMO-A', 'other': 'DEMO-B', 'tolerance_seconds': 60}
        pair = client.get(path + '/near-pair', headers=headers, params=compare).json()
        assert len(pair) == 1 and pair[0]['classification'] == 'possible_overlap'
        assert [row['record_id'] for row in pair[0]['observations']] == ['L01', 'L02']
        compare['other'] = 'DEMO-C'
        assert client.get(path + '/near-pair', headers=headers, params=compare).json()[0]['classification'] == 'within_radius'
        compare['tolerance_seconds'] = 0
        assert client.get(path + '/near-pair', headers=headers, params=compare).json() == []

        events = client.get('/api/timeline?case=SCENARIO', headers=headers).json()
        assert len(events) == 10
        assert events[0]['kind'] == 'reported_time_range' and events[0]['end_time'].startswith('2026-10-01T08:10:00')
        assert {event['kind'] for event in events} == {'reported_time_range', 'location', 'contact', 'credit', 'statement'}
        source_id = created.json()['source_id']
        original = client.get('/api/source/' + source_id, headers=headers).content
        assert original == synthetic_location_scenario()[0] and hashlib.sha256(original).hexdigest() == source_id
        lines = io.StringIO(original.decode(), newline='').readlines()
        for event in events:
            evidence_id, = event['evidence_ids']
            response = client.get(f'/api/evidence/{evidence_id}', headers=headers)
            assert response.status_code == 200
            evidence = response.json()
            loc = evidence['source_locator']
            assert evidence['synthetic'] and evidence['source_id'] == source_id and evidence['case_ids'] == ['SCENARIO']
            assert evidence['import_id'] == created.json()['import_id']
            assert json.loads(evidence['passage']) == next(csv.reader(lines[loc['line_start'] - 1:loc['line_end']]))
            assert client.get(f'/api/evidence/{evidence_id}', headers=outsider).status_code == 404
        graph = client.get('/api/graph?case=SCENARIO', headers=headers).json()
        assert graph['nodes'] == graph['edges'] == []


def test_location_csv_validation_and_same_device_guard(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['DEMO'])}
    path = '/api/locations/DEMO'
    valid = ['A', 'DEMO-A', 'SYN-DEVICE', '2026-10-01T13:30:00+05:30', 0, 0, 10, 'gps', 'true']
    same = ['B', 'DEMO-B', 'SYN-DEVICE', '2026-10-01T08:00:00Z', 0, 0, 10, 'gps', 'true']
    invalid = ['C', 'DEMO-C', 'SYN-C', '2026-10-01T08:00:00Z', 0, 0, -1, 'gps', 'true']
    with TestClient(create_app(store)) as client:
        assert client.get(path + '/template', headers=headers).content == csv_bytes(LOCATION_HEADER)
        denied = client.post(path, headers=headers, content=csv_bytes(LOCATION_HEADER, [valid, [*same[:-1], 'false']]))
        assert denied.status_code == 422
        assert not store.history('imports', ['DEMO'])
        content = csv_bytes(LOCATION_HEADER, [valid, same, invalid])
        response = client.post(path, headers=headers, content=content)
        assert response.status_code == 200, response.text
        summary = response.json()
        assert (summary['accepted_new'], summary['quarantined']) == (2, 1)
        assert 'accuracy radius' in summary['issues'][0]['reason']
        assert client.post(path, headers=headers, content=content).json()['recognized_repeat'] == 2
        rows = client.get(path, headers=headers).json()
        assert {row['event_time'] for row in rows} == {'2026-10-01T08:00:00.000000+00:00'}
        query = {'start': '2026-10-01T08:00:00Z', 'end': '2026-10-01T08:01:00Z',
                 'subject': 'DEMO-A', 'other': 'DEMO-B', 'radius_m': 100}
        assert client.get(path + '/near-pair', headers=headers, params=query).json() == []


def test_location_case_capacity_rolls_back_import(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    monkeypatch.setenv('MAHA_MAX_LOCATION_RECORDS', '1')
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['DEMO'])}
    path = '/api/locations/DEMO'
    row = ['A', 'DEMO-A', 'SYN-DEVICE', '2026-10-01T08:00:00Z', 0, 0, 10, 'gps', 'true']
    with TestClient(create_app(store)) as client:
        assert client.post(path, headers=headers, content=csv_bytes(LOCATION_HEADER, [row])).status_code == 200
        response = client.post(path + '/demo', headers=headers)
        assert response.status_code == 413
        assert [item['record_id'] for item in client.get(path, headers=headers).json()] == ['A']
        assert len(store.history('imports', ['DEMO'])) == 1
