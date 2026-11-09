import subprocess,json,statistics
from pathlib import Path
results=[]
for size in [474,952]:
 for variant2 in ['base-control','candidate']:
  for iteration in range(3 if variant2=='base-control' else 6):
   for variant in ['base',variant2]:
    item=json.loads(subprocess.check_output(['node','work/plm-progress/pipeline-perf.cjs',variant,str(size)],text=True));item['round']=iteration;results.append(item)
Path('work/plm-progress/pipeline-results.json').write_text(json.dumps(results,indent=2))
for size in [474,952]:
 items=[x for x in results if x['size']==size]
 assert len(set(x['digest'] for x in items))==1
 for variant in ['base','base-control','candidate']:
  subset=[x for x in items if x['variant']==variant]
  print(size,variant,{k:round(statistics.median(x[k] for x in subset),3) for k in ['elapsedMs','cpuMs','peakRss']})
