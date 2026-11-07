from pathlib import Path
import subprocess,json
repo=Path('/workspace/Buyer-Log-Desktop');root=Path('/tmp/buyerlog-startup-final-after-3');results=[]
for mode in ['green','delayed']:
 for lang in ['tr','en']:
  for theme in ['light','dark']:
   out=Path(f'/tmp/buyerlog-manufacturers-drill-{mode}-{lang}-{theme}.json')
   print('START',mode,lang,theme,flush=True)
   with out.with_suffix('.log').open('w') as log:subprocess.run(['node','/tmp/buyerlog-manufacturers-drill-probe.cjs',str(repo/'resources/app'),str(root),str(out),mode,lang,theme],stdout=log,stderr=subprocess.STDOUT,check=True)
   result=json.loads(out.read_text());assert result['status']=='passed' and not result['errors'];results.append(result)
   Path('/tmp/buyerlog-p2-visual.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print('PASS',mode,lang,theme,flush=True)
