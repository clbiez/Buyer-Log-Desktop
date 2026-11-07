import os,json,pathlib,subprocess,datetime,hashlib,fcntl,tarfile,time
TOOLS=pathlib.Path('/tmp/buyerlog-shell-post901-tools');BEFORE=pathlib.Path('/tmp/buyerlog-post901-baseline');AFTER=pathlib.Path('/workspace/buyerlog-post-main-acceptance');OUT=AFTER/'docs/performance/startup-feature-assets-20261107/post-901';ARCHIVE=AFTER/'docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz'
lock=open('/tmp/buyerlog-performance-measurement.lock','a+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert not any(k in os.environ for k in ['BUYER_LOG_TEST_CONCURRENCY','NODE_OPTIONS','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT'])
def rev(tree):return subprocess.check_output(['git','rev-parse','HEAD'],cwd=tree,text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert rev(BEFORE)=='31004ea08982ffcce849640e5c5e3580448f0914'
assert rev(AFTER)=='e1d342939a8aee49b237e5e1ef9e725b66f83021'
assert sha(BEFORE/'resources/app/scripts/benchmark-startup-orders.js')==sha(AFTER/'resources/app/scripts/benchmark-startup-orders.js')
series={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic':True,'before':rev(BEFORE),'after':rev(AFTER),'fixtureArchiveSha256':sha(ARCHIVE),'harnessSha256':sha(AFTER/'resources/app/scripts/benchmark-startup-orders.js'),'resourceProbeSha256':sha(TOOLS/'resource-probe.cjs'),'moduleProbeSha256':sha(TOOLS/'module-probe.cjs'),'order':'A/B-B/A-A/B; fresh source/data/cache/server/browser per arm','runs':[],'status':'running'}
file=OUT/'series.json'
def persist():file.write_text(json.dumps(series,indent=2)+'\n')
persist();stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
try:
 for pair,order in enumerate([['before','after'],['after','before'],['before','after']],1):
  pair_rows={}
  for arm in order:
   tree=BEFORE if arm=='before' else AFTER;root=pathlib.Path('/tmp')/('buyerlog-startup-shellpost901-'+stamp+'-'+arm+'-'+str(pair));(root/'source').mkdir(parents=True,exist_ok=False)
   with tarfile.open(ARCHIVE,'r:gz') as tar:tar.extractall(root/'source',filter='data')
   metadata=json.loads((root/'source/benchmark-fixture.json').read_text());assert metadata['synthetic'] is True and metadata['rows']==30000
   for name,expected in metadata['hashes'].items():assert sha(root/'source'/name)==expected
   item={'pair':pair,'arm':arm,'revision':rev(tree),'appTree':subprocess.check_output(['git','rev-parse','HEAD:resources/app'],cwd=tree,text=True).strip(),'fixtureRoot':str(root),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'fixture':metadata,'status':'running'};series['runs'].append(item);persist();print('START '+arm+' '+str(pair)+' '+str(root),flush=True)
   env=dict(os.environ,PLAYWRIGHT_MODULE=str(TOOLS/'resource-probe.cjs'),CHROMIUM_PATH='/usr/bin/chromium',SHELL_METRICS_FILE=str(root/'shell-metrics.json'),SHELL_GUIDE_PROBE='0')
   command=['node','scripts/benchmark-startup-orders.js','--rows','30000','--fixture-root',str(root)];item['benchmarkCommand']=command
   with (root/'benchmark.log').open('w') as log:p=subprocess.run(command,cwd=tree/'resources/app',env=env,stdout=log,stderr=subprocess.STDOUT)
   item['benchmarkReturncode']=p.returncode;persist();assert p.returncode==0,'Benchmark failed: '+str(root)
   report=json.loads((root/'measurement.json').read_text());assert report['status']=='passed' and report['revision']==item['revision'];assert report['expected']['rows']['orders']==30000
   resources=json.loads((root/'shell-metrics.json').read_text());assert len(resources)==5 and all(x['resourceBufferFull']==0 for x in resources)
   hashes=json.loads(subprocess.check_output(['node',str(TOOLS/'cache-row-hashes.cjs'),str(root)],text=True));(root/'row-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n');pair_rows[arm]=hashes['modules'];item['rowHashes']=hashes;item['resourceNavigations']=len(resources);persist();print('BENCHMARK PASS '+arm+' '+str(pair),flush=True)
   module_command=['node',str(TOOLS/'module-probe.cjs'),str(tree/'resources/app'),str(root),str(root/'modules.json')];item['moduleCommand']=module_command
   with (root/'modules.log').open('w') as log:p=subprocess.run(module_command,cwd=tree/'resources/app',env=dict(os.environ),stdout=log,stderr=subprocess.STDOUT)
   item['moduleReturncode']=p.returncode;persist();assert p.returncode==0,'Module probe failed: '+str(root)
   modules=json.loads((root/'modules.json').read_text());assert modules['status']=='passed' and not modules['errors'];item['moduleCount']=len(modules['modules']);item['status']='passed';item['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();persist();print('MODULES PASS '+arm+' '+str(pair),flush=True)
  assert pair_rows['before']==pair_rows['after'],'Ordered projection row output differs in pair '+str(pair)
  series.setdefault('equivalencePairs',[]).append({'pair':pair,'equal':True,'modules':pair_rows['before']});persist()
 series['status']='passed'
except BaseException as e:
 series['status']='failed';series['error']=repr(e);raise
finally:
 series['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();persist()
