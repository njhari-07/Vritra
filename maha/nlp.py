"""Pretrained NER plus explicit identifier and relation templates; no name-only merge."""
import re
from functools import lru_cache
from difflib import SequenceMatcher
from .store import uid
from .ingestion import node,edge,account


@lru_cache(maxsize=1)
def pipeline():
    import spacy
    # Fail visibly rather than silently replacing pretrained extraction with an empty model.
    return spacy.load("en_core_web_sm")


def extract(doc,base,nlp=None):
    text=doc['text']; did="document:"+uid(doc['document_id'],text); cid=doc['case_id']
    common=[node("Case",cid,cid),node("Document",did,doc['document_id'],filed_date=doc['filed_date']),edge("FILED_UNDER",did,cid)]
    yield dict(locator={**base,"char_start":0,"char_end":len(text)},passage=text,method="document-metadata",facts=common)
    # Only these explicit relation sentences assert ownership, location, or case participation.
    person_pattern=r"Person (?P<name>[^\n\[.]+) \[ID:(?P<pid>[A-Za-z0-9_-]+)\]"
    declared=[]
    for m in re.finditer(person_pattern,text):
        pid="person:demo:"+m['pid'];declared.append((m.start(),m.end(),pid))
        facts=[node("Person",pid,m['name'].strip(),authoritative_id=m['pid']),edge("MENTIONED_IN",pid,did, str(m.start()))]
        tail=text[m.end():].split('\n',1)[0]
        if tail.startswith(" is referenced in this case"):
            facts.append(edge("INVOLVED_IN_CASE",pid,cid,str(m.start())))
        own=re.match(r" owns account \[Bank:([^;\]]+); Account:([^\]]+)\]",tail)
        if own:
            aid=account(own[1],own[2]);facts.extend([node("Account",aid,own[1]+" / "+own[2],bank=own[1],account=own[2]),edge("OWNS_ACCOUNT",pid,aid,str(m.start())),edge("INVOLVED_IN_CASE",aid,cid,str(m.start()))])
        location=re.match(r" was recorded at \[Location:([^\]]+)\]",tail)
        if location:
            lid="location:"+uid("demo",location[1]);facts.extend([node("Location",lid,location[1]),edge("LOCATED_AT",pid,lid,str(m.start()))])
        end=m.end()+len(tail)
        yield dict(locator={**base,"char_start":m.start(),"char_end":end,"line_start":text.count('\n',0,m.start())+1},passage=text[m.start():end],method="explicit-identifier-rule",facts=facts)
    model=nlp if nlp is not None else pipeline()
    for ent in model(text).ents:
        kind={"PERSON":"Person","ORG":"Organization","GPE":"Location","LOC":"Location"}.get(ent.label_)
        if not kind or any(a<=ent.start_char<b for a,b,_ in declared):continue
        entity="mention:"+uid(did,ent.start_char,ent.end_char)
        yield dict(locator={**base,"char_start":ent.start_char,"char_end":ent.end_char},passage=ent.text,
                   method="spacy-en_core_web_sm",confidence=0.7,
                   extraction_version='model:'+model.meta.get('version','unknown')+';adapter:0.1',
                   confidence_basis='uncalibrated review-priority heuristic; model does not expose span probabilities',
                   facts=[node(kind,entity,ent.text),edge("MENTIONED_IN",entity,did,str(ent.start_char))])


def candidates(nodes,threshold=0.9):
    from .limits import check
    people=[n for n in nodes if n['type']=='Person'];result=[]
    check(len(people)*(len(people)-1)//2,'CANDIDATE_PAIRS',20000)
    for i,a in enumerate(people):
        for b in people[i+1:]:
            aid=a['attrs'].get('authoritative_id');bid=b['attrs'].get('authoritative_id')
            if aid and bid and aid!=bid:continue
            score=SequenceMatcher(None,' '.join(a['label'].casefold().split()),' '.join(b['label'].casefold().split())).ratio()
            if score>=threshold:
                left,right=sorted([a['id'],b['id']])
                result.append(dict(id=uid(left,right),left=left,right=right,left_name=a['label'],right_name=b['label'],similarity=score,state="pending",evidence_ids=sorted(set(a['evidence_ids']+b['evidence_ids']))))
    return sorted(result,key=lambda x:(-x['similarity'],x['id']))
