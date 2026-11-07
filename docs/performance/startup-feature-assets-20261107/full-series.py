import subprocess, os, json, datetime
from pathlib import Path
repo=Path('/workspace/Buyer-Log-Desktop'); baseline=Path('/tmp/buyerlog-shell-before'); archive=repo/'docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz'
series=[]
for repeat in range(1,4):
 for variant,tree in [('before',baseline),('after',repo)]:
  root=Path('/tmp/buyerlog-startup-final-'+variant+'-'+str(repeat));(root/'source').mkdir(parents=True,exist_ok=False)
  subprocess.run(['tar','-xzf',str(archive),'-C',str(root/'source')],check=True)
  item={'variant':variant,'repeat':repeat,'fixtureRoot':str(root),'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=tree,text=True).strip(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};series.append(item)
  print('START',variant,repeat,flush=True)
  env={**os.environ,'PLAYWRIGHT_MODULE':'/tmp/buyerlog-playwright-complete-probe.cjs','CHROMIUM_PATH':'/usr/bin/chromium','SHELL_METRICS_FILE':str(root/'shell-metrics.json'),'SHELL_GUIDE_PROBE':'0'}
  with open(root/'benchmark.log','w') as log:
   subprocess.run(['node','scripts/benchmark-startup-orders.js','--rows','30000','--fixture-root',str(root)],cwd=tree/'resources/app',env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
  resource=json.loads((root/'shell-metrics.json').read_text());assert len(resource)==5 and all(x['resourceBufferFull']==0 for x in resource)
  print('BENCHMARK PASS',variant,repeat,flush=True)
  with open(root/'modules.log','w') as log:
   subprocess.run(['node','/tmp/buyerlog-current-module-probe.cjs',str(tree/'resources/app'),str(root),str(root/'modules.json')],stdout=log,stderr=subprocess.STDOUT,check=True)
  item['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  Path('/tmp/buyerlog-final-current-series.json').write_text(json.dumps(series,indent=2)+'\n')
  print('MODULES PASS',variant,repeat,flush=True)
