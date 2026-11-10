"""Neo4j stores evidence-scoped graph assertions; SQLite is the import/audit ledger."""
import fcntl
import json
import logging
import os
from neo4j.exceptions import DriverError, Neo4jError
from .limits import budget, check


class NeoGraph:
    def __init__(self):
        from neo4j import GraphDatabase
        self.driver=GraphDatabase.driver(os.environ['NEO4J_URI'],auth=(os.getenv('NEO4J_USER','neo4j'),os.environ['NEO4J_PASSWORD']),
            connection_timeout=3, max_transaction_retry_time=5)

    def close(self): self.driver.close()

    def revision(self):
        with self.driver.session() as session:
            row = session.run(
                'MATCH (n:Maha:ProjectionState) RETURN n.ledger_id AS ledger_id, n.revision AS revision'
            ).single(strict=False)
        return (row['ledger_id'], row['revision']) if row else None

    def sync(self, store):
        """Publish the committed ledger revision atomically with its graph."""
        with (store.root / 'graph-sync.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if self.revision() == store.graph_revision():
                return False
            revision, facts, evidence = store.graph_export()
            self._replace(revision, facts, evidence)
            return True

    def _replace(self, revision, facts, evidence):
        def write(tx):
            tx.run('MATCH (n:Maha) DETACH DELETE n').consume()
            for start in range(0,len(facts),1000):
                tx.run('UNWIND $rows AS row CREATE (a:Maha:Assertion {id:row.id,case_id:row.case_id,payload:row.payload})',rows=[dict(id=f['fact_id'],case_id=f['case_id'],payload=json.dumps(f)) for f in facts[start:start+1000]]).consume()
            for start in range(0,len(evidence),1000):
                tx.run('UNWIND $rows AS row CREATE (e:Maha:Evidence {id:row.id,case_id:row.case_id,payload:row.payload})',rows=[dict(id=e['id'],case_id=e['case_ids'][0],payload=json.dumps(e)) for e in evidence[start:start+1000]]).consume()
            # Global identity only: labels/attributes live in scoped assertions, never on these nodes.
            for f in facts:
                if f['kind']=='node':
                    tx.run('MERGE (n:Maha:Entity {id:$id}) SET n.entity_type=$type',**{k:f[k] for k in ['id','type']}).consume()
            for f in facts:
                if f['kind']!='edge':continue
                rel=f['type']
                if rel not in RELATIONS:raise ValueError('Unsupported relationship')
                props={**{k:v for k,v in f['attrs'].items() if isinstance(v,(str,int,float,bool))},'id':f['id'],'case_id':f['case_id'],'evidence_ids':f['evidence_ids']}
                evidence_ids=props.pop('evidence_ids')
                tx.run(f'MATCH (a:Maha:Entity {{id:$source}}),(b:Maha:Entity {{id:$target}}) MERGE (a)-[r:{rel} {{id:$id,case_id:$case_id}}]->(b) SET r += $props, r.evidence_ids=reduce(acc=coalesce(r.evidence_ids,[]), e IN $evidence_ids | CASE WHEN e IN acc THEN acc ELSE acc+e END)',source=f['source'],target=f['target'],case_id=f['case_id'],id=f['id'],props=props,evidence_ids=evidence_ids).consume()
            tx.run(
                'CREATE (:Maha:ProjectionState {ledger_id:$ledger_id, revision:$revision})',
                ledger_id=revision[0], revision=revision[1],
            ).consume()
        with self.driver.session() as session:session.execute_write(write)

    def facts(self,cases):
        with self.driver.session() as session:
            rows=list(session.run('MATCH (a:Maha:Assertion) WHERE a.case_id IN $cases RETURN a.payload AS payload LIMIT $limit',cases=cases,limit=budget('GRAPH_FACTS',20000)+1))
            check(len(rows),'GRAPH_FACTS',20000)
            return [json.loads(r['payload']) for r in rows]

    def cross_cases(self,cases,canonical=None):
        with self.driver.session() as session:
            return [dict(r) for r in session.run('''MATCH (e:Maha:Entity)-[r:INVOLVED_IN_CASE]->(c:Maha:Entity)
                WHERE r.case_id IN $cases AND c.id IN $cases
                WITH coalesce($canonical[e.id],e.id) AS entity_id, collect(DISTINCT c.id) AS cases, collect(r.evidence_ids) AS evidence_groups
                WHERE size(cases)>1 RETURN entity_id,cases,evidence_groups''',cases=cases,canonical=canonical or {})]

    def cycles(self,cases):
        with self.driver.session() as session:
            return [dict(r) for r in session.run('''MATCH p=(a:Maha:Entity)-[:TRANSACTED_WITH*2..4]->(a)
                WITH relationships(p) AS hs, nodes(p)[0..-1] AS ns
                WHERE all(h IN hs WHERE h.case_id IN $cases AND h.event_time IS NOT NULL
                  AND h.payment_currency=h.receiving_currency AND h.payment_currency=hs[0].payment_currency
                  AND h.time_basis=hs[0].time_basis)
                  AND all(i IN range(0,size(hs)-2) WHERE hs[i].event_time<hs[i+1].event_time)
                  AND all(n IN ns WHERE single(m IN ns WHERE m=n))
                RETURN [h IN hs|h.transaction_id] AS transaction_ids, [h IN hs|h.evidence_ids] AS evidence_groups
                LIMIT 50''',cases=cases)]


def synchronize_projection(store, stop):
    """Reconcile durable revisions on startup and after every committed change."""
    logger = logging.getLogger(__name__)
    delay = 1
    reported_failure = False
    while not stop.is_set():
        try:
            neo = NeoGraph()
            try:
                neo.sync(store)
            finally:
                neo.close()
        except Exception:
            if not reported_failure:
                logger.exception('Graph synchronization failed; retrying from the ledger')
                reported_failure = True
            delay = min(delay * 2, 30)
        else:
            if reported_failure:
                logger.info('Graph synchronization recovered')
                reported_failure = False
            delay = 1
        stop.wait(delay)


RELATIONS={'OWNS_ACCOUNT','SENT_FROM','SENT_TO','TRANSACTED_WITH','FLOWS_TO','COMMUNICATED_WITH','INVOLVED_IN_CASE','LOCATED_AT','MENTIONED_IN','FILED_UNDER','RELATED_TO'}


def snapshot(store,cases,use_neo=True,resolve=True):
    facts = None
    backend = 'local-ledger'
    if use_neo and os.getenv('NEO4J_URI'):
        try:
            neo = NeoGraph()
            try:
                expected = store.graph_revision()
                if neo.revision() == expected:
                    projected = neo.facts(cases)
                    if neo.revision() == expected == store.graph_revision():
                        facts = projected
                        backend = 'neo4j'
            finally:
                neo.close()
        except (DriverError, Neo4jError, OSError, KeyError):
            pass
    if facts is None:
        facts = store.facts(cases)
    nodes={};edges={}
    for f in facts:
        target=nodes if f['kind']=='node' else edges
        key=f['id']
        if key not in target:
            target[key]={k:v for k,v in f.items() if k not in {'fact_id','case_id'}}
            target[key]['case_ids']=[];target[key]['assertions']=[];target[key]['evidence_ids']=[]
        item=target[key]
        item['case_ids']=sorted(set(item['case_ids']+[f['case_id']]))
        item['evidence_ids']=sorted(set(item['evidence_ids']+f['evidence_ids']))
        item['assertions'].append(dict(attrs=f['attrs'],label=f.get('label'),evidence_ids=f['evidence_ids']))
        if f['kind']=='node':
            for ak,av in f.get('attrs',{}).items():
                if av and ak not in item['attrs']:item['attrs'][ak]=av
            cur_lbl=item.get('label','')
            new_lbl=f.get('label','')
            auth_id=item.get('attrs',{}).get('authoritative_id','')
            if new_lbl and (not cur_lbl or cur_lbl==key or cur_lbl==auth_id or (len(new_lbl)>len(cur_lbl) and not new_lbl.startswith('person:'))):
                item['label']=new_lbl
    resolution_map={}
    if resolve:
        parent={}
        def find(x):
            while x in parent:x=parent[x]
            return x
        for d in store.decisions(cases):
            if d['state']=='accepted' and d['left'] in nodes and d['right'] in nodes:
                a,b=find(d['left']),find(d['right'])
                if a!=b:parent[max(a,b)]=min(a,b)
        resolution_map={n:find(n) for n in nodes if find(n)!=n}
        for old in list(nodes):
            new=find(old)
            if new!=old:
                for field in ['evidence_ids','case_ids']:nodes[new][field]=sorted(set(nodes[new][field]+nodes[old][field]))
                nodes[new]['assertions']+=nodes[old]['assertions'];del nodes[old]
        for e in edges.values():e['source']=find(e['source']);e['target']=find(e['target'])
    valid=[e for e in edges.values() if e['source'] in nodes and e['target'] in nodes]
    check(len(nodes),'GRAPH_NODES',2000)
    return {'nodes':list(nodes.values()),'edges':valid,'case_ids':sorted(cases),'projection_version':'0.1','resolution_map':resolution_map,'backend':backend}
