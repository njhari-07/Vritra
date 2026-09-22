"""Streaming source validation and time-held-out Elliptic evaluation."""
import csv
import hashlib
import json
import time
import io
import zipfile
import gzip
import gc
from contextlib import contextmanager
from collections import Counter
from pathlib import Path
import numpy as np
from sklearn.ensemble import RandomForestClassifier,IsolationForest
from sklearn.metrics import precision_recall_fscore_support,average_precision_score,confusion_matrix,precision_recall_curve
from .ingestion import IBM_HEADER,amount,currency


@contextmanager
def source_open(path,mode='r'):
    path=Path(path)
    if path.exists():
        with path.open(mode,**({'newline':''} if mode=='r' else {})) as f:yield f
    else:
        archive=path.parent.parent/'elliptic.zip'
        with zipfile.ZipFile(archive) as z:
            names=[n for n in z.namelist() if Path(n).name==path.name]
            if len(names)!=1:raise ValueError('Missing or ambiguous archive member: '+path.name)
            with z.open(names[0]) as raw:
                if mode=='rb':yield raw
                else:
                    with io.TextIOWrapper(raw,encoding='utf-8',newline='') as f:yield f


def digest(path):
    h=hashlib.sha256()
    with source_open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def elliptic_load(folder, index_writer=None):
    folder=Path(folder)
    files={k:folder/f'elliptic_txs_{k}.csv' for k in ['features','classes','edgelist']}
    hashes={k:digest(p) for k,p in files.items()}
    labels={};class_lines={}
    with source_open(files['classes']) as f:
        r=csv.reader(f)
        if next(r)!=['txId','class']:raise ValueError('Unexpected Elliptic class header')
        for line,row in enumerate(r,2):
            if len(row)!=2 or row[1] not in {'1','2','unknown'} or row[0] in labels:raise ValueError(f'Invalid or duplicate class row {line}')
            labels[row[0]]=row[1];class_lines[row[0]]=line
    x=np.empty((len(labels),93),dtype=np.float32);steps=np.empty(len(labels),dtype=np.int16);y=np.empty(len(labels),dtype=np.int8)
    ids=[];seen=set();normalized=[]
    with source_open(files['features']) as f:
        for i,row in enumerate(csv.reader(f)):
            if len(row)!=167 or row[0] in seen or row[0] not in labels:raise ValueError(f'Invalid features row {i+1}')
            values=np.array(row[1:],dtype=np.float64)
            if not np.isfinite(values).all() or values[0]!=int(values[0]) or not 1<=values[0]<=49:raise ValueError(f'Invalid numeric/time value at row {i+1}')
            seen.add(row[0]);ids.append(row[0]);steps[i]=int(values[0]);x[i]=values[1:94];y[i]={'1':1,'2':0,'unknown':-1}[labels[row[0]]]
            record={'tx_id':row[0],'time_step':int(steps[i]),'label':labels[row[0]],'feature_row':i+1,'class_row':class_lines[row[0]],'synthetic':False}
            if index_writer is not None:index_writer.write(json.dumps(record)+'\n')
            else:normalized.append(record)
    if seen!=set(labels):raise ValueError('Feature/class ID sets do not match')
    edge_count=0
    with source_open(files['edgelist']) as f:
        r=csv.reader(f)
        if next(r)!=['txId1','txId2']:raise ValueError('Unexpected edge header')
        for line,row in enumerate(r,2):
            if len(row)!=2 or any(n not in seen for n in row):raise ValueError(f'Unresolved edge at row {line}')
            edge_count+=1
    return x,steps,y,{'source_hashes':hashes,'transactions':len(ids),'edges':edge_count,'labels':dict(Counter(labels.values())),'normalized_records':normalized}


def threshold(y,scores):
    p,r,t=precision_recall_curve(y,scores)
    f=2*p[:-1]*r[:-1]/np.maximum(p[:-1]+r[:-1],1e-12)
    i=max(range(len(t)),key=lambda i:(f[i],p[i],t[i]))
    return float(t[i])


def metrics(y,scores,cut):
    pred=scores>=cut
    p,r,f,_=precision_recall_fscore_support(y,pred,average='binary',zero_division=0)
    return {'precision':float(p),'recall':float(r),'f1':float(f),'average_precision':float(average_precision_score(y,scores)),
            'threshold':cut,'support':int(len(y)),'positives':int(np.sum(y,dtype=np.int64)),'confusion_matrix':confusion_matrix(y,pred,labels=[0,1]).tolist()}


def evaluate_elliptic(folder,output):
    started=time.time();out=Path(output);out.mkdir(parents=True,exist_ok=True)
    staging=out/'elliptic-record-index.jsonl.gz.part'
    try:
        with gzip.open(staging,'wt',encoding='utf-8') as f:
            x,steps,y,manifest=elliptic_load(folder,index_writer=f)
        staging.replace(out/'elliptic-record-index.jsonl.gz')
    finally:
        staging.unlink(missing_ok=True)
    manifest.pop('normalized_records')
    train=(steps<=29)&(y>=0);val=(steps>=30)&(steps<=34)&(y>=0);test=(steps>=35)&(y>=0)
    for mask in [train,val,test]:
        if len(set(y[mask]))!=2:raise ValueError('Each labeled temporal partition needs both classes')
    results={}
    for name in ['random_forest','isolation_forest']:
        model=(RandomForestClassifier(n_estimators=300,class_weight='balanced',random_state=42,n_jobs=2).fit(x[train],y[train]) if name=='random_forest' else IsolationForest(n_estimators=200,random_state=42,n_jobs=2).fit(x[steps<=29]))
        score=lambda mask:model.predict_proba(x[mask])[:,1] if name=='random_forest' else -model.score_samples(x[mask])
        cut=threshold(y[val],score(val));results[name]=metrics(y[test],score(test),cut)
        del model
        gc.collect()
    report={'dataset':'Elliptic original transaction dataset','synthetic':False,'scope':'Transaction classification only',
            'split':{'train_steps':[1,29],'validation_steps':[30,34],'test_steps':[35,49]},
            'counts':{'train_labeled':int(train.sum()),'validation_labeled':int(val.sum()),'test_labeled':int(test.sum()),'unknown_excluded_from_metrics':int((y<0).sum())},
            'per_step':{str(s):dict(Counter(map(int,y[steps==s]))) for s in sorted(set(steps))},
            'features':'93 local predictors; txId, time step, labels and 72 aggregate features excluded',
            'threshold_policy':'validation positive F1; ties higher precision then threshold','seed':42,
            'metrics':results,'manifest':manifest,'elapsed_seconds':round(time.time()-started,2)}
    (out/'elliptic-evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def profile_ibm(path,output):
    from datetime import datetime
    rows=0;invalid=0;labels=Counter();currencies=Counter();errors=[];first=None;last=None;minimum=None;maximum=None
    with open(path,newline='') as f:
        reader=csv.reader(f)
        if next(reader)!=IBM_HEADER:raise ValueError('Unexpected IBM header')
        for line,r in enumerate(reader,2):
            rows+=1
            if first is None:first=r
            last=r
            try:
                if len(r)!=11 or any(not x for x in r) or r[10] not in {'0','1'}:raise ValueError('Invalid fields')
                dt=datetime.strptime(r[0],'%Y/%m/%d %H:%M');amount(r[5]);amount(r[7]);currency(r[6]);currency(r[8])
                minimum=dt if minimum is None else min(minimum,dt);maximum=dt if maximum is None else max(maximum,dt)
                labels[r[10]]+=1;currencies[r[6]]+=1;currencies[r[8]]+=1
            except ValueError as e:
                invalid+=1
                if len(errors)<100:errors.append({'line':line,'reason':str(e)})
    result={'dataset':'IBM HI-Small','synthetic':True,'sha256':digest(path),'bytes':Path(path).stat().st_size,'records':rows,'invalid_records':invalid,'error_examples':errors,'labels':dict(labels),'currency_fields':dict(currencies),'first_record':first,'last_record':last,'minimum_time':str(minimum),'maximum_time':str(maximum),'scope':'Full-file schema profile, not model evaluation'}
    Path(output).write_text(json.dumps(result,indent=2)+'\n');return result


def evaluate_ibm(path,output,sample_size=50000):
    """Seeded reservoir across the full synthetic file, then strictly temporal partitions."""
    import random
    from datetime import datetime
    from sklearn.compose import ColumnTransformer
    from sklearn.preprocessing import OneHotEncoder
    rng=random.Random(42);sample=[]
    with open(path,newline='') as f:
        reader=csv.reader(f)
        if next(reader)!=IBM_HEADER:raise ValueError('Unexpected IBM header')
        for index,row in enumerate(reader):
            if len(row)!=11:raise ValueError(f'Invalid IBM record {index+1}')
            pair=(index+2,row)
            if index<sample_size:sample.append(pair)
            else:
                j=rng.randrange(index+1)
                if j<sample_size:sample[j]=pair
    sample.sort(key=lambda pair:pair[1][0]);times=np.array([r[0] for _,r in sample])
    first=times[int(len(times)*.6)];second=times[int(len(times)*.8)]
    train=times<first;val=(times>=first)&(times<second);test=times>=second
    labels=np.array([int(r[10]) for _,r in sample])
    rows=[]
    for _,r in sample:
        rows.append([np.log1p(float(amount(r[7]))),np.log1p(float(amount(r[5]))),datetime.strptime(r[0],'%Y/%m/%d %H:%M').hour,currency(r[8]),currency(r[6]),r[9]])
    raw=np.array(rows,dtype=object)
    prep=ColumnTransformer([('numeric','passthrough',[0,1,2]),('categories',OneHotEncoder(handle_unknown='ignore',sparse_output=False),[3,4,5])])
    xtrain=prep.fit_transform(raw[train]).astype(float);xval=prep.transform(raw[val]).astype(float);xtest=prep.transform(raw[test]).astype(float)
    if len(set(labels[val]))!=2 or len(set(labels[test]))!=2:raise ValueError('Sample validation/test partitions need both classes; enlarge the sample before evaluation')
    model=IsolationForest(n_estimators=200,random_state=42,n_jobs=2).fit(xtrain)
    cut=threshold(labels[val],-model.score_samples(xval))
    report={'dataset':'IBM HI-Small','synthetic':True,'scope':'Illustrative synthetic transaction classification, not real-world validation',
            'source_sha256':digest(path),'selection':f'Seed-42 reservoir of {len(sample)} records from entire source; chronological split after sampling',
            'source_line_numbers':[line for line,_ in sample],'cutoffs':{'validation_start':str(first),'test_start':str(second)},
            'counts':{'train':int(train.sum()),'validation':int(val.sum()),'test':int(test.sum())},
            'features':['log1p_amount_paid','log1p_amount_received','hour','payment_currency','receiving_currency','payment_format'],
            'metrics':{'isolation_forest':metrics(labels[test],-model.score_samples(xtest),cut)},'seed':42,'threshold_policy':'Validation F1, then precision, then threshold'}
    Path(output).write_text(json.dumps(report,indent=2)+'\n');return report
