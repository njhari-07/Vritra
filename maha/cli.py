import argparse
import json
import os
from pathlib import Path
from .store import Store


def load_env():
    path=Path('.env')
    if path.exists():
        for line in path.read_text().splitlines():
            if line and not line.startswith('#') and '=' in line:
                k,v=line.split('=',1);os.environ.setdefault(k,v)


def main():
    load_env();p=argparse.ArgumentParser(description='MAHA local prototype')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('init')
    demo=sub.add_parser('demo');demo.add_argument('--ibm',required=True)
    sub.add_parser('sync')
    server=sub.add_parser('serve');server.add_argument('--port',type=int,default=8765)
    bench=sub.add_parser('evaluate');bench.add_argument('--elliptic',required=True);bench.add_argument('--output',default='artifacts/evaluation')
    profile=sub.add_parser('profile-ibm');profile.add_argument('path');profile.add_argument('--output',default='artifacts/evaluation/ibm-profile.json')
    ibm_eval=sub.add_parser('evaluate-ibm');ibm_eval.add_argument('path');ibm_eval.add_argument('--output',default='artifacts/evaluation/ibm-evaluation.json')
    sub.add_parser('evaluate-demo')
    close=sub.add_parser('close-case');close.add_argument('case_id')
    sub.add_parser('purge')
    args=p.parse_args();store=Store()
    if args.command=='init':
        target=store.root/'access.json'
        if target.exists():raise SystemExit('Access file already exists; existing credentials were preserved.')
        keys={'investigator':store.create_user('investigator',['DEMO-C01','DEMO-C02','DEMO-C03']),
              'restricted':store.create_user('restricted',['DEMO-C01'])}
        target.write_text(json.dumps(keys,indent=2));target.chmod(0o600)
        print(f'Access tokens written to {target}; keep this file private.')
    elif args.command=='demo':
        from .demo import seed
        print(json.dumps(seed(store,args.ibm),indent=2))
    elif args.command=='sync':
        from .graph import NeoGraph
        neo=NeoGraph()
        try:neo.sync(store)
        finally:neo.close()
        print('Neo4j synchronized from immutable assertions.')
    elif args.command=='serve':
        import uvicorn
        uvicorn.run('maha.api:app',host='127.0.0.1',port=args.port)
    elif args.command=='evaluate':
        from .benchmark import evaluate_elliptic
        print(json.dumps(evaluate_elliptic(args.elliptic,args.output),indent=2))
    elif args.command=='profile-ibm':
        from .benchmark import profile_ibm
        Path(args.output).parent.mkdir(parents=True,exist_ok=True)
        print(json.dumps(profile_ibm(args.path,args.output),indent=2))
    elif args.command=='evaluate-ibm':
        from .benchmark import evaluate_ibm
        Path(args.output).parent.mkdir(parents=True,exist_ok=True)
        result=evaluate_ibm(args.path,args.output);result.pop('source_line_numbers',None)
        print(json.dumps(result,indent=2))
    elif args.command=='evaluate-demo':
        from .demo_evaluation import evaluate
        Path('artifacts/evaluation').mkdir(parents=True,exist_ok=True)
        print(json.dumps(evaluate('artifacts/evaluation/demo-evaluation.json'),indent=2))
    elif args.command=='close-case':store.close_case(args.case_id);print('Case closed; retention clock started.')
    elif args.command=='purge':
        expired=store.purge()
        if os.getenv('NEO4J_URI'):
            from .graph import NeoGraph
            neo=NeoGraph()
            try:neo.sync(store)
            finally:neo.close()
        print(json.dumps({'purged_cases':expired}))


if __name__=='__main__':main()
