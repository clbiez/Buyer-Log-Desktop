#!/usr/bin/env python3
import collections,json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);a=[json.loads(x) for x in (p/'operations.jsonl').read_text().splitlines()];r=[json.loads(x) for x in (p/'resources.jsonl').read_text().splitlines()] if (p/'resources.jsonl').exists() else [];now=time.time()*1000
active=[x for x in a if x['type']=='ramp-session-active'];out={'root':p.name,'openedUsers':max((x['count'] for x in active),default=0),'measurementStarted':any(x['type']=='measurement-start' for x in a),'recentCompletedUi':sum(x['type']=='ui-result' and x['at']>now-60000 for x in a),'operationErrors':[{'id':x.get('id'),'error':x.get('error','')[:100]} for x in a if x['type']=='operation-error'][-2:],'memoryGiB':round((r[-1].get('memoryCurrent',0) if r else 0)/2**30,2),'peakMemoryGiB':round(max((x.get('memoryCurrent',0) or 0 for x in r),default=0)/2**30,2)}
if len(r)>1:
 prev={x['pid']:x for x in r[-2]['processes']};cpu=collections.defaultdict(float)
 for x in r[-1]['processes']:
  if x['pid'] in prev:cpu[x['group']]+=(x['cpuTicks']-prev[x['pid']]['cpuTicks'])/(r[-1]['at']-r[-2]['at'])*1000
 out['cpuPercentOfOneCoreLastSample']=dict(cpu)
print(json.dumps(out))
