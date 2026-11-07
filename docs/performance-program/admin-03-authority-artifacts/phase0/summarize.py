import json,pathlib,statistics,hashlib,tarfile,datetime
TOOLS=pathlib.Path('/tmp/buyerlog-auth-phase0-tools');OUT=pathlib.Path('/workspace/buyerlog-authority-fix/docs/performance-program/admin-03-authority-artifacts/phase0');OUT.mkdir(parents=True,exist_ok=True)
series=json.loads((TOOLS/'results/series.json').read_text());assert series['status']=='passed' and len(series['runs'])==6
runs=[]
for r in series['runs']:
 root=pathlib.Path(r['fixtureRoot']);d=json.loads((root/'measurement.json').read_text());assert d['status']=='passed' and d['revision']==r['revision'];assert len(d['measurements'])==1 and d['measurements'][0]['module']=='overview';m=d['measurements'][0];loops=d['serverLoopProbe'];assert loops['enabled'] and loops['events']
 values={'refreshMs':d['refresh']['elapsedMs'],'primaryReadyMs':m['primaryScreenReadyMs'],'gateReadyMs':m['startupReadyMs'],'systemCompleteMs':m['startupCompleteMs'],'healthRefreshP50Ms':d['health']['refresh']['p50Ms'],'healthRefreshP95Ms':d['health']['refresh']['p95Ms'],'serverWholeMaxGapMs':loops['maxGapMs'],'overviewMaxGapMs':loops['modules'][0]['maxGapMs'],'overviewGapsOver200ms':loops['modules'][0]['gapsOver200ms'],'asasMainReceiveMs':d['refresh']['excelWorkers']['asas']['mainReceiveMs'],'asasWorkerPostMessageMs':d['refresh']['excelWorkers']['asas']['workerPostMessageMs']}
 runs.append({'pair':r['pair'],'arm':r['arm'],'values':values,'revision':r['revision'],'sourceGeneration':d['expected'],'stalls':d['stalls'],'health':d['health'],'refreshPhases':d['refresh']['phases'],'rowHashes':r['rowHashes'],'serverLoopModule':loops['modules'][0]})
 archive=OUT/(r['arm']+'-'+str(r['pair'])+'.tar.gz')
 with tarfile.open(archive,'w:gz') as tar:
  for name in ['measurement.json','measurement.json.partial','benchmark.log','server.log','row-hashes.json','shell-metrics.json','overview.png','config.json','source/benchmark-fixture.json','local/page-cache/moderator/manifest.json']:
   p=root/name
   if p.is_file():tar.add(p,arcname=name)
  for p in root.glob('event-loop-probe-*.jsonl'):tar.add(p,arcname=p.name)
  for p in (root/'local/logs/stall-profiles').glob('*'):
   if p.is_file():tar.add(p,arcname='stall-profiles/'+p.name)
summary={'status':'passed','scope':'overview-only Phase0; skip same-tab; server-loop observer; not original phase5 hard acceptance cohort','seriesBefore':series['before'],'seriesAfter':series['after'],'pairs':3,'order':series['order'],'fixtureArchiveSha256':series['fixtureArchiveSha256'],'harnessSha256':series['harnessSha256'],'metrics':{},'runs':runs,'limitations':['Health is harness-observed HTTP roundtrip, not a server-only latency bound.','Scope contains Overview only; no claim for CP/Orders first-open, Global Flow or Backlog hard acceptance.','Server whole-run maximum includes refresh. Module gaps include their normal 10ms timer interval.','This is a security regression check, not an optimization gain claim.']}
for key in runs[0]['values']:
 a=[r['values'][key] for r in runs if r['arm']=='before'];b=[r['values'][key] for r in runs if r['arm']=='after'];summary['metrics'][key]={'before':a,'after':b,'beforeMedian':statistics.median(a),'afterMedian':statistics.median(b),'pairedPct':[(next(r['values'][key] for r in runs if r['arm']=='after' and r['pair']==i)/next(r['values'][key] for r in runs if r['arm']=='before' and r['pair']==i)-1)*100 if next(r['values'][key] for r in runs if r['arm']=='before' and r['pair']==i) else None for i in range(1,4)]}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(OUT/'series.json').write_bytes((TOOLS/'results/series.json').read_bytes())
for n in ['series.py','summarize.py','cache-row-hashes.cjs','resource-probe.cjs']:(OUT/n).write_bytes((TOOLS/n).read_bytes())
(OUT/'series.log.txt').write_bytes((TOOLS/'series.log').read_bytes());manifest=[]
for p in sorted(OUT.iterdir()):
 if p.name!='manifest.json':manifest.append({'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(summary['metrics'],indent=2))
