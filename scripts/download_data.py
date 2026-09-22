"""Public source downloads; keeps Elliptic compressed to reduce disk use."""
import hashlib
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'data/raw'
URLS={'elliptic.zip':'https://www.kaggle.com/api/v1/datasets/download/ellipticco/elliptic-data-set','HI-Small_Trans.csv':'https://www.kaggle.com/api/v1/datasets/download/ealtman2019/ibm-transactions-for-anti-money-laundering-aml/HI-Small_Trans.csv'}

def download(name,url):
    target=ROOT/name
    if target.exists():return target
    part=target.with_suffix(target.suffix+'.part');offset=part.stat().st_size if part.exists() else 0
    req=urllib.request.Request(url,headers={'Range':f'bytes={offset}-'} if offset else {})
    with urllib.request.urlopen(req,timeout=120) as response:
        append=offset and response.status==206
        if append and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise ValueError('Unexpected resume range')
        with part.open('ab' if append else 'wb') as out:shutil.copyfileobj(response,out,1024*1024)
    part.replace(target);target.chmod(0o600);return target

def main():
    ROOT.mkdir(parents=True,exist_ok=True,mode=0o700);manifest=[]
    for name,url in URLS.items():
        print('Downloading/checking',name,flush=True);path=download(name,url)
        with path.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
        manifest.append(dict(name=name,url=url,bytes=path.stat().st_size,sha256=sha))
    with zipfile.ZipFile(ROOT/'elliptic.zip') as z:
        if z.testzip() is not None:raise ValueError('Elliptic ZIP integrity failed')
        expected={f'elliptic_txs_{s}.csv' for s in ['features','classes','edgelist']}
        if not expected.issubset({Path(n).name for n in z.namelist()}):raise ValueError('Missing CSV member')
    (ROOT/'elliptic').mkdir(exist_ok=True)
    (ROOT/'download-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Sources ready; the benchmark reads CSV members directly from the archive.')
if __name__=='__main__':main()
