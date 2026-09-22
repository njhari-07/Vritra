"""Tiny authored gold fixtures; never combined with real benchmark numbers."""
import json
from pathlib import Path
from .nlp import pipeline,candidates
from .ingestion import narrative_records

GOLD_TEXT=[
    ('Maya Desai met Daniel Brooks in London.', [('Maya Desai','Person'),('Daniel Brooks','Person'),('London','Location')]),
    ('Omar Hassan called Priya Kapoor from Delhi.', [('Omar Hassan','Person'),('Priya Kapoor','Person'),('Delhi','Location')]),
    ('Sofia Bennett travelled from Paris to Berlin.', [('Sofia Bennett','Person'),('Paris','Location'),('Berlin','Location')]),
    ('Elena Rossi spoke with Marcus Reed in Rome.', [('Elena Rossi','Person'),('Marcus Reed','Person'),('Rome','Location')]),
]


def scores(predicted,gold):
    tp=len(predicted&gold);fp=len(predicted-gold);fn=len(gold-predicted)
    p=tp/(tp+fp) if tp+fp else None;r=tp/(tp+fn) if tp+fn else None
    return dict(true_positives=tp,false_positives=fp,false_negatives=fn,precision=p,recall=r,
                f1=2*p*r/(p+r) if p is not None and r is not None and p+r else 0)


def evaluate(output):
    model=pipeline();pred=set();gold=set()
    mapping={'PERSON':'Person','GPE':'Location','LOC':'Location','ORG':'Organization'}
    for i,(text,annotations) in enumerate(GOLD_TEXT):
        for value,kind in annotations:gold.add((i,text.index(value),text.index(value)+len(value),kind))
        for e in model(text).ents:
            if e.label_ in mapping:pred.add((i,e.start_char,e.end_char,mapping[e.label_]))
    relation_gold={('OWNS_ACCOUNT','person:demo:Q1'),('INVOLVED_IN_CASE','person:demo:Q1')};relation_pred=set()
    doc={'document_id':'heldout-relations','case_id':'GOLD','filed_date':'2022-09-01','synthetic':True,
         'text':'Person Maya Desai [ID:Q1] owns account [Bank:010; Account:GOLD-A].\nPerson Maya Desai [ID:Q1] is referenced in this case as a witness.\n'}
    for record in narrative_records(json.dumps([doc]).encode(),model):
        for fact in record['facts']:
            if fact['kind']=='edge' and fact['type'] in {'OWNS_ACCOUNT','INVOLVED_IN_CASE'} and fact['source'].startswith('person:'):
                relation_pred.add((fact['type'],fact['source']))
    people=[dict(id='a',type='Person',label='Maya Desai',attrs={'authoritative_id':'Q1'},evidence_ids=['gold-a']),
            dict(id='b',type='Person',label='Maya Desai',attrs={},evidence_ids=['gold-b']),
            dict(id='c',type='Person',label='Maya Desai',attrs={'authoritative_id':'Q2'},evidence_ids=['gold-c'])]
    predicted_pairs={tuple(sorted([c['left'],c['right']])) for c in candidates(people)}
    result={'dataset':'Team-authored tiny gold fixtures','synthetic':True,
            'scope':'Illustrative extraction and candidate retrieval only; four sentences, two explicit relations, three identity observations',
            'ner':scores(pred,gold),'relations':scores(relation_pred,relation_gold),
            'candidate_retrieval':scores(predicted_pairs,{('a','b')}),
            'auto_resolution_policy':'Only exact issuer-scoped identifiers; name similarity never automatically merges',
            'precision_at_k':None,'precision_at_k_reason':'Awaiting investigator relevance adjudication; no labels fabricated',
            'limitations':['Tiny authored set, not representative or independently adjudicated','Candidate retrieval precision is not post-review merge precision','Rule-based relation syntax is intentionally constrained'],
            'model':model.meta.get('name'),'model_version':model.meta.get('version')}
    Path(output).write_text(json.dumps(result,indent=2)+'\n');return result
