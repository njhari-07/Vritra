"""Run with MAHA_NEO4J_TEST=1 after seeding and syncing the demo."""
import os
import pytest


@pytest.mark.skipif(os.getenv('MAHA_NEO4J_TEST')!='1',reason='Requires running seeded local Neo4j')
def test_live_neo4j_parity_and_scope():
    from maha.cli import load_env
    from maha.store import Store
    from maha.graph import NeoGraph,snapshot
    from maha.analytics import analyze,fund_flow
    load_env();store=Store();neo=NeoGraph();cases=['DEMO-C01','DEMO-C02','DEMO-C03']
    try:
        local=snapshot(store,cases,use_neo=False);remote=snapshot(store,cases)
        assert {n['id'] for n in local['nodes']}=={n['id'] for n in remote['nodes']}
        cypher=neo.cross_cases(cases,remote['resolution_map'])
        leads=analyze(local)['leads']
        assert {r['entity_id'] for r in cypher}=={l['subject_ids'][0] for l in leads if 'cross_case' in l['techniques']}
        assert len(cypher)>0 and not neo.cross_cases(['DEMO-C01'])
        paths=fund_flow(remote)['paths'];cycles=neo.cycles(cases)
        assert {tuple(e['attrs']['transaction_id'] for e in p) for p in paths}=={tuple(r['transaction_ids']) for r in cycles}
        assert all(e['case_id']=='DEMO-C01' for e in neo.facts(['DEMO-C01']))
    finally:neo.close()
