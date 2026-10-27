#!/usr/bin/env python3
"""One unchanged standard full suite, isolated from browser load; no retries."""
import datetime,json,os,pathlib,re,subprocess,sys
repo=pathlib.Path(__file__).resolve().parents[3];audit=pathlib.Path(__file__).resolve().parent;app=repo/'resources/app'
tag=sys.argv[1] if len(sys.argv)>1 else 'accepted-recovery'
assert re.fullmatch(r'[a-z0-9-]+',tag)
prefix='final-full-suite-'+tag
assert not (audit/(prefix+'-result.json')).exists(), 'Preserve existing evidence; choose a new tag'
git=lambda *a:subprocess.check_output(['git',*a],cwd=repo,text=True).strip()
manifest={'source':git('rev-parse','HEAD'),'sourceDirty':bool(git('status','--porcelain')),'productionTestTrees':{x:git('rev-parse','HEAD:resources/app/'+x) for x in ['server','public','tests']},'command':'cd resources/app && BUYER_LOG_TEST_CONCURRENCY=2 npm test','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':sorted(str(p.relative_to(app)) for p in (app/'tests').rglob('*.test.js')),'concurrency':2,'loadRunningAlongside':False,'automaticRetries':0}
(audit/(prefix+'-manifest.json')).write_text(json.dumps(manifest,indent=2)+'\n');log=audit/(prefix+'.log')
with log.open('w') as out:r=subprocess.run(['npm','test'],cwd=app,env={**os.environ,'BUYER_LOG_TEST_CONCURRENCY':'2'},stdout=out,stderr=subprocess.STDOUT)
text=log.read_text();result={**manifest,'files':len(manifest['files']),'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':r.returncode,'status':'passed' if r.returncode==0 else 'failed','summaryByBatch':[]}
for name in ['tests','pass','fail','cancelled','skipped','todo']:
 values=[int(x) for x in re.findall(r'^ℹ '+name+r' (\d+)',text,re.M)];result[name]=sum(values);result['summaryByBatch'].append({'metric':name,'batches':values})
(audit/(prefix+'-result.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(r.returncode)
