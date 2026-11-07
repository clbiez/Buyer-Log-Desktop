import subprocess,os,json,datetime
from pathlib import Path
repo=Path('/workspace/Buyer-Log-Desktop');baseline=Path('/tmp/buyerlog-shell-before');series=[]
for repeat in range(1,4):
 for variant,tree in [('before',baseline),('after',repo)]:
  root=Path('/tmp/buyerlog-startup-shell-'+variant+'-'+str(repeat))
  print('RESOURCE START',variant,repeat,flush=True)
  env={**os.environ,'PLAYWRIGHT_MODULE':'/tmp/buyerlog-playwright-complete-probe.cjs','CHROMIUM_PATH':'/usr/bin/chromium','SHELL_METRICS_FILE':str(root/'resources-complete.json'),'SHELL_GUIDE_PROBE':'1'}
  started=datetime.datetime.now(datetime.timezone.utc).isoformat()
  with open(root/'resource-benchmark.log','w') as log:
   subprocess.run(['node','scripts/benchmark-startup-orders.js','--rows','30000','--fixture-root',str(root),'--skip-refresh','--skip-same-tab','--module','overview','--out',str(root/'resource-benchmark.json')],cwd=tree/'resources/app',env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
  metrics=json.loads((root/'resources-complete.json').read_text());original=json.loads((root/'measurement.json').read_text());sample=json.loads((root/'resource-benchmark.json').read_text())
  assert len(metrics)==1 and metrics[0]['resourceBufferFull']==0 and metrics[0]['totalResourceRecords']<20000 and metrics[0]['guideFirstOpenMs']>0 and metrics[0]['collectionFirstOpenMs']>0 and metrics[0]['collectionInitiallyLoaded'] is False
  assert original['fixture']==sample['fixture'] and original['expected']==sample['expected'] and sample['status']=='passed'
  series.append({'variant':variant,'repeat':repeat,'fixtureRoot':str(root),'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resourceRecords':metrics[0]['totalResourceRecords']})
  Path('/tmp/buyerlog-resource-series.json').write_text(json.dumps(series,indent=2)+'\n');print('RESOURCE PASS',variant,repeat,'records',metrics[0]['totalResourceRecords'],flush=True)
