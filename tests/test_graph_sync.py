from threading import Event

from fastapi.testclient import TestClient
from neo4j.exceptions import ServiceUnavailable

from maha.api import create_app
from maha.graph import NeoGraph
from maha.ingestion import node
from maha.store import Store


def test_import_recovers_after_projection_failure(tmp_path, monkeypatch):
    from maha import graph

    store = Store(tmp_path)
    token = store.create_user('investigator', ['C1'])
    headers = {'Authorization': 'Bearer ' + token}
    failed, allow_retry, recovered = Event(), Event(), Event()

    class Projection:
        revision = None
        facts = []
        fail_next_write = True

    class SimulatedNeo(NeoGraph):
        def __init__(self):
            pass

        def close(self):
            pass

        def revision(self):
            return Projection.revision

        def facts(self, cases):
            return [fact for fact in Projection.facts if fact['case_id'] in cases]

        def _replace(self, revision, facts, evidence):
            if facts and Projection.fail_next_write:
                Projection.fail_next_write = False
                failed.set()
                raise ServiceUnavailable('Simulated projection outage')
            if facts and not allow_retry.wait(10):
                raise ServiceUnavailable('Timed out waiting for fallback check')
            Projection.facts = facts
            Projection.revision = revision
            if facts:
                recovered.set()

    monkeypatch.setenv('NEO4J_URI', 'bolt://simulated')
    monkeypatch.setattr(graph, 'NeoGraph', SimulatedNeo)
    with TestClient(create_app(store)) as client:
        records = [{'locator': {'row': 1}, 'facts': [node('Person', 'p1', 'Person One')]}]
        before = store.graph_revision()
        store.import_records('sample', b'row 1', 'sample', True, 'C1', records)
        assert store.graph_revision() != before
        assert failed.wait(5)
        read = client.get('/api/graph?case=C1', headers=headers).json()
        assert read['backend'] == 'local-ledger'
        assert [n['id'] for n in read['nodes']] == ['p1']

        # A retry, including one made after the worker has recovered, is idempotent.
        store.import_records('sample', b'row 1', 'sample', True, 'C1', records)
        allow_retry.set()
        assert recovered.wait(8)
        assert SimulatedNeo().sync(store) is False
        read = client.get('/api/graph?case=C1', headers=headers).json()
        assert read['backend'] == 'neo4j'
        assert [n['id'] for n in read['nodes']] == ['p1']

        store.reset_case('C1')
        read = client.get('/api/graph?case=C1', headers=headers).json()
        assert not read['nodes']
        SimulatedNeo().sync(store)
        assert Projection.revision == store.graph_revision()
        assert not Projection.facts
