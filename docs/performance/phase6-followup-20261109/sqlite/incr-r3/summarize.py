import json,statistics,pathlib,re,hashlib,gzip
root=pathlib.Path(__file__).parent
median=statistics.median
summary={}
for name in ['A','AA','AA-small','B']:
 path=root/name/'raw.json'
 if not path.exists():continue
 raw=json.loads(path.read_text()); result={'source':raw['source'],'complete':raw.get('completed',False),'error':raw.get('error'),'seeds':raw['seeds'],'sizes':{}}
 for size in sorted({t['size'] for t in raw['trials']}):
  trials=[t for t in raw['trials'] if t['size']==size]; labels=list(dict.fromkeys(t['label'] for t in trials)); groups={}
  def metric(t,k):
   if k in ['connectionMs','ensureReplayMs','firstFullReadMs','coldOpenToFullReadyMs','mixedMs','peakRssBytes','peakHeap','maxEventLoopGapMs']:return t[k]
   if k=='cpuUserMs':return t['timedCpu']['user']/1000
   if k=='cpuSystemMs':return t['timedCpu']['system']/1000
   if k=='processWriteBytes':return t['timedIo']['write_bytes']
   if k=='closedDiskBytes':return t['disk']['totalBytes']
   return median(s['ms'] for s in t['samples'][k])
  keys=['connectionMs','ensureReplayMs','firstFullReadMs','coldOpenToFullReadyMs','get','filter','pending','repeatFullRead','singleWrite','batch20','upload','singleAck','ackThrough','compact','mixedMs','cpuUserMs','cpuSystemMs','peakRssBytes','peakHeap','maxEventLoopGapMs','processWriteBytes','closedDiskBytes']
  for label in labels:
   ts=[t for t in trials if t['label']==label]; groups[label]={'rounds':len(ts),'metrics':{k:{'rawTrialValues':[metric(t,k) for t in ts],'median':median(metric(t,k) for t in ts)} for k in keys}}
   groups[label]['singleWriteDml']=[median(s['dml'] for s in t['samples']['singleWrite']) for t in ts]
   groups[label]['singleWriteSqlMaterializedRows']=[median(s['rows'] for s in t['samples']['singleWrite']) for t in ts]
   groups[label]['singleWriteSqlAllMs']=[median(s['allMs'] for s in t['samples']['singleWrite']) for t in ts]
   groups[label]['compactEnvelopeBytes']=[t['samples']['compact'][0]['envelopeBytes'] for t in ts]
  paired={}
  if len(labels)==2:
   for k in keys:
    vals=[]
    for round in [1,2,3]:
     pair=[next((t for t in trials if t['round']==round and t['label']==l),None) for l in labels]
     if all(pair):vals.append(metric(pair[1],k)-metric(pair[0],k))
    paired[k]=vals
  result['sizes'][str(size)]={'groups':groups,'pairedCandidateMinusBaseline':paired,'oracle':'all completed pairs pass complete envelope, receipt, business and reopen assertions'}
 summary[name]=result
validation={}
for name in ['contract-gates','prototype','compat-r2','incremental-r3','related','full']:
 path=root/(name+'.log')
 if path.exists() or path.with_suffix('.log.gz').exists():
  s=path.read_text() if path.exists() else gzip.open(path.with_suffix('.log.gz'),'rt').read();validation[name]={k:(sum(map(int,re.findall(r'(?:# |ℹ )'+k+r' (\d+)',s))) if name=='full' else int(re.findall(r'(?:# |ℹ )'+k+r' (\d+)',s)[-1])) for k in ['tests','pass','fail','skipped','cancelled'] if re.findall(r'(?:# |ℹ )'+k+r' (\d+)',s)}
summary['validation']=validation
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'comparisons':{k:{'complete':v['complete'],'sizes':list(v['sizes'])} for k,v in summary.items() if k!='validation'},'validation':validation},indent=2))
