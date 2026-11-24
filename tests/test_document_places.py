from fastapi.testclient import TestClient

from maha.api import create_app
from maha.ingestion import node
from maha.store import Store


def test_resolution_is_case_scoped_and_preserves_same_pair_decisions(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['ONE', 'TWO', 'EMPTY'])}
    for case in ('ONE', 'TWO'):
        store.import_records('fixture.txt', case.encode(), 'fixture', True, case, [
            {'locator': {'line': 1}, 'facts': [node('Person', 'a', 'Example Name')]},
            {'locator': {'line': 2}, 'facts': [node('Person', 'b', 'Example Name')]},
        ])
    with TestClient(create_app(store)) as client:
        assert client.get('/api/candidates?case=EMPTY', headers=headers).json() == []
        assert client.get('/api/candidates?case=OTHER', headers=headers).status_code == 404
        one, = client.get('/api/candidates?case=ONE', headers=headers).json()
        two, = client.get('/api/candidates?case=TWO', headers=headers).json()
        assert one['id'] != two['id']
        assert len(one['left_sources']) == len(one['right_sources']) == 1
        body = {'state': 'accepted', 'reason': 'Example source review'}
        route = '/api/candidates/' + one['id']
        assert client.post(route + '?case=TWO', json=body, headers=headers).status_code == 404
        assert client.post(route + '?case=ONE', json=body, headers=headers).status_code == 200
        assert client.get('/api/candidates?case=TWO', headers=headers).json()[0]['state'] == 'pending'
        assert client.get('/api/candidates?case=ONE', headers=headers).json()[0]['state'] == 'accepted'
        assert len(client.get('/api/graph?case=ONE', headers=headers).json()['nodes']) == 1
        assert len(client.get('/api/graph?case=TWO', headers=headers).json()['nodes']) == 2


def test_source_backed_places_can_be_confirmed_and_unresolved(tmp_path, monkeypatch):
    monkeypatch.delenv('NEO4J_URI', raising=False)
    monkeypatch.delenv('MAHA_LOCAL_GEOCODER', raising=False)
    store = Store(tmp_path / 'ledger')
    headers = {'Authorization': 'Bearer ' + store.create_user('reviewer', ['PLACES', 'EMPTY'])}
    store.import_records('people.txt', b'fixture', 'fixture', True, 'PLACES', [
        {'locator': {'line': 1}, 'facts': [node('Person', 'local-person', 'Example Person')]},
    ])
    text = ('Example Person was seen at Kempegowda International Airport on 2001-05-17.\n'
            'Meeting occurred in Bengaluru, Karnataka on 2001-05-18.\n'
            'Registered address: Unnamed Warehouse Annex.')
    with TestClient(create_app(store)) as client:
        result = client.post('/api/import/raw-text/PLACES', headers=headers,
                             json={'text': text, 'title': 'Example report', 'synthetic': True})
        assert result.status_code == 200
        rows = client.get('/api/places/PLACES', headers=headers).json()
        assert client.get('/api/places/EMPTY', headers=headers).json() == []
        presence = next(row for row in rows if row['place']['relation'] == 'reported_presence')
        city = next(row for row in rows if row['place']['relation'] == 'event_location')
        address = next(row for row in rows if row['place']['relation'] == 'address')
        assert all(row['review'] is None for row in rows)
        assert presence['event_time'] == '2001-05-17'
        route = '/api/places/PLACES/' + presence['id']
        assert client.get('/api/places/EMPTY/' + presence['id'] + '/matches', headers=headers).status_code == 404
        candidate = client.get(route + '/matches', headers=headers).json()[0]
        assert candidate['geometry'] == 'point'
        assert client.get('/api/places/PLACES/' + city['id'] + '/matches', headers=headers).json()[0]['geometry'] == 'area'
        review = client.put(route, headers=headers, json={'status': 'confirmed', 'match_id': candidate['id'],
                                                         'person_id': 'local-person'})
        assert review.status_code == 200, review.text
        assert review.json()['person']['id'] == 'local-person'
        assert client.put('/api/places/PLACES/' + address['id'], headers=headers,
                          json={'status': 'unresolved'}).status_code == 200
        event, = client.get('/api/timeline?case=PLACES', headers=headers).json()
        assert event['kind'] == 'document_place' and event['event_time'] == '2001-05-17'
        assert client.get('/api/evidence/' + presence['id'], headers=headers).json()['passage'] in text
        graph = client.get('/api/graph?case=PLACES', headers=headers).json()
        assert not graph['edges']
