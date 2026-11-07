import pathlib,json,statistics,csv,hashlib,gzip
from html.parser import HTMLParser
from urllib.parse import urlparse,unquote
AFTER=pathlib.Path('/workspace/buyerlog-post-main-acceptance');BEFORE=pathlib.Path('/tmp/buyerlog-post901-baseline');OUT=AFTER/'docs/performance/startup-feature-assets-20261107/post-901'
s=json.loads((OUT/'series.json').read_text());assert s['status']=='passed' and len(s['runs'])==6 and len(s['equivalencePairs'])==3
class Inventory(HTMLParser):
 def __init__(self,tree):super().__init__();self.tree=tree;self.scripts=[];self.styles=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs);key=None
  if tag=='script' and a.get('src') and 'async' not in a and 'defer' not in a and a.get('type','')!='module':key='scripts';url=a['src']
  elif tag=='link' and a.get('rel')=='stylesheet':key='styles';url=a.get('href','')
  else:return
  u=urlparse(url)
  if u.scheme or u.netloc:return
  p=self.tree/'resources/app/public'/unquote(u.path.lstrip('/'))
  assert p.is_file() or u.path=='/user-context.js',str(p)
  getattr(self,key).append({'path':u.path,'bytes':p.stat().st_size if p.is_file() else None})
inventory={}
for arm,tree in [('before',BEFORE),('after',AFTER)]:
 i=Inventory(tree);i.feed((tree/'resources/app/public/index.html').read_text());inventory[arm]={k:{'count':len(getattr(i,k)),'bytes':sum(x['bytes'] or 0 for x in getattr(i,k)),'files':getattr(i,k)} for k in ['scripts','styles']}
rows=[];module_rows=[]
for run in s['runs']:
 root=pathlib.Path(run['fixtureRoot']);d=json.loads((root/'measurement.json').read_text());c=d['sameTab']['overview'];resource=json.loads((root/'shell-metrics.json').read_text())[0];assert resource['module']=='overview' and resource['resourceBufferFull']==0
 row={'pair':run['pair'],'arm':run['arm'],'revision':run['revision'],'fixtureRoot':str(root),'refreshWallMs':d['refreshWallMs'],'domContentLoadedMs':resource['domContentLoadedMs']}
 for key in ['primaryScreenReadyMs','startupReadyMs','startupCompleteMs','userWaitMs','continueDispatchDelayMs','systemStartupCompleteMs','primaryToGateMs','longTaskCount','longTaskTotalMs','maxLongTaskMs','jsHeapUsedBytes']:row[key]=c.get(key)
 for kind in ['js','css']:
  rs=[r for r in resource['resources'] if r['kind']==kind];row[kind+'Requests10s']=len(rs);row[kind+'UniqueFiles10s']=len(set(r['path'] for r in rs));
  for size in ['decodedBytes','encodedBytes','transferBytes']:row[kind+size[0].upper()+size[1:]+'10s']=sum(r[size] for r in rs)
 for transition in d['sameTab']['switches']:row['sameTab_'+transition['module']+'Ms']=transition['ms']
 for name in ['p50Ms','p95Ms','maxMs','count','failed']:row['refreshHealth_'+name]=d['health']['refresh'][name]
 row['runtimeStallLogCount']=len(d['stalls']);rows.append(row)
 modules=json.loads((root/'modules.json').read_text());assert modules['status']=='passed' and not modules['errors']
 for m in modules['modules']:module_rows.append({'arm':run['arm'],'pair':run['pair'],**m})
medians={}
for key in rows[0]:
 if key in ['pair','arm','revision','fixtureRoot']:continue
 if any(r[key] is None for r in rows):continue
 v={arm:statistics.median(r[key] for r in rows if r['arm']==arm) for arm in ['before','after']};v['pairedPercentChanges']=[((next(r[key] for r in rows if r['arm']=='after' and r['pair']==p)/next(r[key] for r in rows if r['arm']=='before' and r['pair']==p)-1)*100) if next(r[key] for r in rows if r['arm']=='before' and r['pair']==p) else None for p in range(1,4)];medians[key]=v
module_summary={}
for name in sorted(set(m['module'] for m in module_rows)):
 module_summary[name]={}
 for key in ['uiReadyMs','featureReadyMs']:
  values={arm:[m[key] for m in module_rows if m['module']==name and m['arm']==arm and key in m] for arm in ['before','after']}
  if all(len(v)==3 for v in values.values()):module_summary[name][key]={arm:statistics.median(v) for arm,v in values.items()}
first=json.loads((pathlib.Path(s['runs'][0]['fixtureRoot'])/'measurement.json').read_text());env={k:first.get(k) for k in ['platform','node','cpu','cpuCount','availableParallelism','cpuQuota','memoryLimitBytes','chromium']}
summary={'before':s['before'],'after':s['after'],'environment':env,'inventory':inventory,'coldOverviewAndRefreshMedians':medians,'moduleFirstOpenMedians':module_summary,'runs':rows,'moduleRuns':module_rows,'orderedRowEquivalence':s['equivalencePairs'],'limits':['Three fresh paired runs per arm; Linux/headless Chromium, not Windows/Electron.','DOMContentLoaded and cold first Overview are distinct from warm same-tab transitions.','Health roundtrips include harness scheduling; not an independent server-loop bound.','Runtime stall log threshold is 3000ms with 5000ms sampling; no log does not imply no stalls above200ms.','Heap is uncollected and is not retained-heap or peak-memory evidence.','Collection workspace starts empty; module-probe adds one synthetic row for controls.']}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with (OUT/'cold-overview.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
manifest=[]
for run in s['runs']:
 root=pathlib.Path(run['fixtureRoot']);dest=OUT/(run['arm']+'-'+str(run['pair']));dest.mkdir(exist_ok=False)
 names=['measurement.json','measurement.json.partial','shell-metrics.json','row-hashes.json','modules.json','server.log','module-server.log','benchmark.log','modules.log']
 for name in names:
  p=root/name
  if not p.exists():continue
  raw=p.read_bytes();target=dest/(name+'.gz');target.write_bytes(gzip.compress(raw,mtime=0));manifest.append({'file':str(target.relative_to(OUT)),'source':str(p),'rawSha256':hashlib.sha256(raw).hexdigest(),'gzipSha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(OUT/'measurement-manifest.json').write_text(json.dumps({'rawRootsPreserved':True,'files':manifest},indent=2)+'\n')
print(json.dumps({'medians':medians,'modules':module_summary,'inventory':{a:{k:{z:v[z] for z in ['count','bytes']} for k,v in x.items()} for a,x in inventory.items()}},indent=2))
