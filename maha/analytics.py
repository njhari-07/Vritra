"""Structural context and behavioral findings are intentionally separate."""
from collections import defaultdict
from datetime import datetime
import math
import networkx as nx
import numpy as np
from sklearn.ensemble import IsolationForest
from .store import uid


STRUCTURAL={'OWNS_ACCOUNT','SENT_FROM','SENT_TO','COMMUNICATED_WITH','INVOLVED_IN_CASE','LOCATED_AT','RELATED_TO'}


def projection(graph):
    undirected=nx.Graph();directed=nx.DiGraph()
    for n in graph['nodes']:
        if n['type']!='Document':undirected.add_node(n['id']);directed.add_node(n['id'])
    for e in graph['edges']:
        a,b=e['source'],e['target']
        if e['type'] not in STRUCTURAL or a==b or a not in undirected or b not in undirected:continue
        undirected.add_edge(a,b)
        if e['type']=='SENT_FROM':directed.add_edge(b,a)
        elif e['type']=='SENT_TO':directed.add_edge(a,b)
        else:directed.add_edge(a,b);directed.add_edge(b,a)
    return undirected,directed


def fund_flow(graph,start=None,end=None,max_hops=4,limit=50):
    by_source=defaultdict(list)
    for e in graph['edges']:
        if e['type']!='TRANSACTED_WITH':continue
        a=e['attrs']
        if not a.get('event_time') or a.get('payment_currency')!=a.get('receiving_currency'):continue
        by_source[e['source']].append(e)
    output=[];explored=0;truncated=False
    def visit(origin,current,path,visited):
        nonlocal explored,truncated
        if len(output)>=limit or explored>=20000:truncated=True;return
        if len(path)>=max_hops:return
        for e in sorted(by_source[current],key=lambda e:e['attrs']['event_time']):
            explored+=1
            a=e['attrs']
            if path:
                p=path[-1]['attrs']
                if datetime.fromisoformat(a['event_time'])<=datetime.fromisoformat(p['event_time']):continue
                if a['payment_currency']!=p['payment_currency'] or a.get('time_basis')!=p.get('time_basis'):continue
            following=path+[e];dest=e['target']
            if ((end and dest==end) or (not end and dest==origin and len(following)>=2)):
                output.append(following)
            elif dest not in visited:visit(origin,dest,following,visited|{dest})
            if len(output)>=limit or explored>=20000:truncated=True;return
    for origin in ([start] if start else sorted(by_source)):
        visit(origin,origin,[],{origin})
        if truncated:break
    return {'paths':output,'truncated':truncated,'explored':explored,'max_hops':max_hops}


def analyze(graph,cross_case_records=None):
    g,d=projection(graph);nodes={n['id']:n for n in graph['nodes']};leads=[]
    degree=nx.degree_centrality(g)
    between=nx.betweenness_centrality(g,k=min(100,len(g)),seed=42) if g else {}
    rank=nx.pagerank(d) if d else {}
    communities=nx.community.louvain_communities(g,seed=42) if g.number_of_edges() else [{n} for n in g]
    community={n:i for i,c in enumerate(communities) for n in c}
    metrics={n:dict(degree=degree[n],betweenness=between[n],pagerank=rank[n],community=community[n]) for n in g}
    def add(category,techniques,subjects,reason,evidence,**extra):
        evidence=sorted(set(evidence))
        if not evidence:return
        scope=sorted({c for n in subjects if n in nodes for c in nodes[n]['case_ids']})
        leads.append(dict(id=uid(category,techniques,subjects,evidence),category=category,techniques=techniques,
                          subject_ids=subjects,case_ids=scope,reason=reason,evidence_ids=evidence,
                          synthetic=all(nodes[n]['synthetic'] for n in subjects if n in nodes),
                          review_state='pending',algorithm_version='0.1',projection_version='0.1',**extra))
    cases=defaultdict(set);case_evidence=defaultdict(list)
    for e in graph['edges']:
        if e['type']=='INVOLVED_IN_CASE':
            cases[e['source']].add(e['target']);case_evidence[e['source']]+=e['evidence_ids']
    if cross_case_records is not None:
        cases={r['entity_id']:set(r['cases']) for r in cross_case_records}
        case_evidence={r['entity_id']:[eid for group in r['evidence_groups'] for eid in group] for r in cross_case_records}
    for entity,cs in sorted(cases.items(),key=lambda x:(-len(x[1]),x[0])):
        if len(cs)>1:add('connection',['cross_case'],[entity],f'Referenced in {len(cs)} authorized cases; review the source passages.',case_evidence[entity],case_count=len(cs),structural_context=metrics.get(entity,{}))
    for n in sorted(g,key=lambda n:(-rank[n],n))[:10]:
        ev=list(nodes[n]['evidence_ids'])
        for e in graph['edges']:
            if n in {e['source'],e['target']} and e['type'] in STRUCTURAL:ev+=e['evidence_ids']
        add('connection',['centrality','community'],[n],f'Connects to {g.degree(n)} entities in the authorized projection. Structural context only.',ev,structural_context=metrics[n])
    # Currency-grouped, label-free descriptive IF. Full temporal evaluation is separate.
    groups=defaultdict(list)
    for n in nodes.values():
        if n['type']=='Transaction' and 'amount_paid' in n['attrs']:groups[(n['dataset_id'],n['attrs']['payment_currency'])].append(n)
    anomaly_status=[]
    for (dataset,currency),txs in groups.items():
        if len(txs)<8:
            anomaly_status.append({'dataset':dataset,'currency':currency,'status':'insufficient_records','count':len(txs)});continue
        x=np.array([[math.log1p(float(n['attrs']['amount_paid'])),datetime.fromisoformat(n['attrs']['event_time']).hour] for n in txs])
        model=IsolationForest(n_estimators=200,random_state=42,contamination='auto').fit(x)
        scores=-model.score_samples(x)
        for i in sorted(range(len(txs)),key=lambda i:-scores[i])[:min(5,len(txs))]:
            n=txs[i]
            add('flagged_behavior',['isolation_forest'],[n['id']],f'Unusual amount/time pattern within {dataset}, {currency}; descriptive in-sample demo score, not a probability.',n['evidence_ids'],behavior_score=float(scores[i]),model='IsolationForest/200/seed42',model_inputs={'log1p_amount_paid':float(x[i,0]),'hour_utc':float(x[i,1])},score_scope=f'{dataset}:{currency}')
        anomaly_status.append({'dataset':dataset,'currency':currency,'status':'descriptive_in_sample','count':len(txs)})
    flows=fund_flow(graph)
    for path in flows['paths']:
        subjects=[e['source'] for e in path]
        add('flagged_behavior',['fund_flow'],subjects,'Chronological same-currency cycle; possible route only, not proof of identical funds.',[ev for e in path for ev in e['evidence_ids']],transaction_ids=[e['attrs']['transaction_id'] for e in path])
    return {'leads':leads,'metrics':metrics,'communities':len(communities),'fund_flow_truncated':flows['truncated'],'anomaly_status':anomaly_status,
            'traceability_coverage':1.0 if leads else None,'projection':{'nodes':len(g),'edges':g.number_of_edges(),'excluded':['Document','Evidence','TRANSACTED_WITH shortcut'],'betweenness_sample_size':min(100,len(g))}}
