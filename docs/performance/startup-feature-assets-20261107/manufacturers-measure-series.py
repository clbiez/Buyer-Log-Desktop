import os,json,shutil,subprocess,socket,hashlib,datetime
from pathlib import Path
repo=Path('/workspace/Buyer-Log-Desktop');seed=Path('/tmp/buyerlog-startup-final-after-3');series=[]
# A single immutable warmed backend snapshot; each navigation uses a new HTTP context.
template=Path('/tmp/buyerlog-startup-p2-template');template.mkdir(exist_ok=False)
for name in ['data','app','local','tmp']:shutil.copytree(seed/name,template/name)
for i in range(1,4):
 for variant,tree,mode in [('before',Path('/tmp/buyerlog-shell-p2-before'),'measure-red'),('after',repo,'measure')]:
  root=Path(f'/tmp/buyerlog-startup-p2-{variant}-{i}');root.mkdir(exist_ok=False)
  for name in ['data','app','local','tmp']:shutil.copytree(template/name,root/name)
  (root/'source').mkdir();subprocess.run(['tar','-xzf',str(repo/'docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz'),'-C',str(root/'source')],check=True)
  with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  (root/'config.json').write_text(json.dumps({'port':port,'host':'127.0.0.1','sourceFolder':str(root/'source')}))
  print('START',variant,i,flush=True)
  with (root/'probe.log').open('w') as log:subprocess.run(['node','/tmp/buyerlog-manufacturers-drill-probe.cjs',str(tree/'resources/app'),str(root),str(root/'probe.json'),mode,'tr','light'],stdout=log,stderr=subprocess.STDOUT,check=True)
  result=json.loads((root/'probe.json').read_text());assert result['status'] in ('red-confirmed','passed') and not result['errors'];series.append({'variant':variant,'repeat':i,'baseRevision':'54174143','runtimeSha256':hashlib.sha256((tree/'resources/app/public/perf-runtime.js').read_bytes()).hexdigest(),'fixture':json.loads((root/'source/benchmark-fixture.json').read_text()),'root':str(root),'result':result})
  Path('/tmp/buyerlog-p2-measurements.json').write_text(json.dumps(series,ensure_ascii=False,indent=2)+'\n');print('PASS',variant,i,round(result['manufacturersReadyMs'],1),flush=True)
