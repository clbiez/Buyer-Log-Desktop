"""Run under flock -n -E 75 /tmp/buyerlog-performance-measurement.lock.
Unmodified benchmark-first-transitions; isolated native server/browser per arm.
"""
import datetime, hashlib, json, os, pathlib, shutil, statistics, subprocess, sys

REPO=pathlib.Path(__file__).resolve().parents[3]
HERE=pathlib.Path(__file__).resolve().parent
OUT=pathlib.Path(sys.argv[1]);OUT.mkdir(parents=True,exist_ok=False)
INPUT=pathlib.Path(sys.argv[2]);PROFILE='--profile' in sys.argv
TREES={'A':pathlib.Path('/workspace/pr908-main'),'B':REPO}
HEADS={'A':'1796193f0a57c7785e7bf9fdb3557e33c550b25e','B':'96b7d12712259fac9680dd852778bfd73daa292c'}
sha=lambda b:hashlib.sha256(b).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
report={'classification':'instrumented diagnosis only' if PROFILE else 'native first-intent A/B diagnostic replication',
        'profiled':PROFILE,'startedAt':now(),'order':'A/B' if PROFILE else 'A/B–B/A–A/B',
        'input':str(INPUT),'inputSha256':sha(INPUT.read_bytes()),'heads':HEADS,
        'timezone':'Europe/Istanbul','wrapperSha256':sha((HERE/'observe.cjs').read_bytes()),
        'rowEquivalence':'Complete JSON and own-key order must match in every run; complete visible cells and headers must match the same 53/60 baseline variant. Different variants do not establish full DOM equality.',
        'runs':[],'status':'running'}
save=lambda:(OUT/'series.json').write_text(json.dumps(report,indent=2)+'\n')
for arm,tree in TREES.items():
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=tree,text=True).strip()==HEADS[arm]
for name in ['scripts/benchmark-first-transitions.js','scripts/lib/first-transition-probe.js','public/app-main.js','public/perf-runtime.js','public/motion-plus.js','public/index.html']:
    assert (TREES['A']/'resources/app'/name).read_bytes()==(TREES['B']/'resources/app'/name).read_bytes(),name
report['sourceHashes']={arm:{str(p.relative_to(tree)):sha(p.read_bytes()) for p in [tree/'resources/app/public/table-header-tracking.js',tree/'resources/app/public/workspace-blur.js']} for arm,tree in TREES.items()}
expected=json.loads(INPUT.read_text())['expected'];report['expected']=expected
save()
try:
    schedule=[(1,['A','B'])] if PROFILE else [(1,['A','B']),(2,['B','A']),(3,['A','B'])]
    for pair,arms in schedule:
        for arm in arms:
            assert shutil.disk_usage('/tmp').free>1024**3,'Disk admission refused; prior evidence retained'
            out=OUT/('pair'+str(pair)+'-'+arm);out.mkdir()
            env=dict(os.environ,TZ='Europe/Istanbul',CHROMIUM_PATH='/usr/bin/chromium',
                     PLAYWRIGHT_MODULE=str(HERE/'observe.cjs'),PR908_OUT=str(out),PR908_PROFILE='1' if PROFILE else '0')
            for name in ['NODE_OPTIONS','NODE_PATH','BUYER_LOG_TEST_CONCURRENCY']:
                env.pop(name,None)
            command=['node',str(TREES[arm]/'resources/app/scripts/benchmark-first-transitions.js'),'--app-root',str(TREES[arm]/'resources/app'),'--measurement',str(INPUT),'--out',str(out/'measurement.json')]
            item={'arm':arm,'pair':pair,'startedAt':now(),'command':command,'diskFreeBytes':shutil.disk_usage('/tmp').free}
            report['runs'].append(item);save();print('START',pair,arm,flush=True)
            with (out/'benchmark.log').open('w') as log:
                result=subprocess.run(command,env=env,cwd=TREES[arm]/'resources/app',stdout=log,stderr=subprocess.STDOUT)
            item.update(returncode=result.returncode,finishedAt=now());save()
            assert result.returncode==0,'Native benchmark failed; no automatic retry'
            measurement=json.loads((out/'measurement.json').read_text())
            item['transitions']=measurement['transitions'];item['fixtureRoot']=measurement['fixtureRoot'];item['captures']={}
            assert measurement['status']=='passed'
            for module in ['cp','orders']:
                value=json.loads((out/(module+'-observations.json')).read_text())
                assert value['unobscured'] and value['rowCount']==expected['rows'][module]
                assert value['revisions']==expected['revisions']
                item['captures'][module]={k:value[k] for k in ['rowCount','rowsSha256','ownKeyOrderSha256','cellsSha256','schemaSha256']}
                item['captures'][module]['cellsPerRow']=len(value['cells'][0]['cells'])
            item['status']='passed';save()
            print('PASS',pair,arm,[(t['module'],round(t['elapsedMs'])) for t in item['transitions']],flush=True)
    report['summary']={}
    for module in ['cp','orders']:
        report['summary'][module]={key:{arm:statistics.median(next(t[key] for t in run['transitions'] if t['module']==module) for run in report['runs'] if run['arm']==arm) for arm in ['A','B']} for key in ['elapsedMs','dataReadyMs','firstRowsPaintedMs','observationEndMs']}
        report['summary'][module]['pairedPercent']=[100*(next(t['elapsedMs'] for run in report['runs'] if run['arm']=='B' and run['pair']==p for t in run['transitions'] if t['module']==module)/next(t['elapsedMs'] for run in report['runs'] if run['arm']=='A' and run['pair']==p for t in run['transitions'] if t['module']==module)-1) for p,_ in schedule]
        for key in ['rowsSha256','ownKeyOrderSha256']:
            assert len({run['captures'][module][key] for run in report['runs']})==1,(module,key)
        variants={}
        for run in report['runs']:
            capture=run['captures'][module];variant=capture['cellsPerRow']
            assert module!='orders' or variant in [53,60],'Unexpected Orders schema'
            prior=variants.setdefault(variant,capture)
            for key in ['schemaSha256','cellsSha256']:assert capture[key]==prior[key],(module,variant,key)
        report['summary'][module]['observedSchemaVariants']=list(variants)
    report['status']='passed'
except BaseException as error:
    report['status']='failed';report['error']=repr(error);raise
finally:
    report['finishedAt']=now();save()
