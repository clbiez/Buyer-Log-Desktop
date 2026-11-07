import datetime,gzip,hashlib,json,os,re,subprocess,tempfile,time
from pathlib import Path
repo=Path('/workspace/Buyer-Log-Desktop');app=repo/'resources/app'
out=repo/'docs/performance-program/evidence/pricing-client-cost-20261107/acceptance'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert sha=='30f5315474fc898bec99e2630a0cd4c378b39eb0'
assert not [k for k in os.environ if k.startswith('BUYER_LOG_') or k=='NODE_OPTIONS']
results={'testedCommit':sha,'appTree':subprocess.check_output(['git','rev-parse','HEAD:resources/app'],cwd=repo,text=True).strip(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'concurrency':'runner default 4','environmentOverrides':'TMPDIR only; no BUYER_LOG_* or NODE_OPTIONS overrides','execution':'outside filesystem sandbox; actual newly empty default /home/agent/.buyer-log available; no app-root overrides','runs':[]}
commands=[('related',['npm','test','--','pricing','quotation','open-costing','local-iam-migration-authority','v714']),('full',['npm','test']),('i18n',['npm','run','i18n:check']),('release-notes',['npm','run','release:notes:validate'])]
for label,argv in commands:
 temp=tempfile.mkdtemp(prefix='bl-pr901-'+label+'-')
 env={**os.environ,'TMPDIR':temp}
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();tic=time.monotonic()
 print('START',label,sha,argv,'TMPDIR='+temp,flush=True)
 stdout=Path('/tmp/pr901-'+label+'.stdout');stderr=Path('/tmp/pr901-'+label+'.stderr')
 with stdout.open('wb') as so,stderr.open('wb') as se:
  result=subprocess.run(argv,cwd=app,env=env,stdout=so,stderr=se)
 raw=stdout.read_bytes();err=stderr.read_bytes();s=raw.decode(errors='replace')
 run={'name':label,'argv':argv,'cwd':str(app),'environmentOverrides':{'TMPDIR':temp},'startedAt':start,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':round(time.monotonic()-tic,3),'exitCode':result.returncode,'stdoutBytes':len(raw),'stderrBytes':len(err),'stdoutSha256':hashlib.sha256(raw).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest(),'batches':[]}
 # Keep the original runner plan; parse its native spec/TAP summary.
 chunks=re.split(r'\[Buyer Log tests\] Batch (\d+)/(\d+) \((\d+) dosya\)',s)
 for i in range(1,len(chunks),4):
  b={'number':int(chunks[i]),'total':int(chunks[i+1]),'files':int(chunks[i+2])}
  for field in ['tests','pass','fail','cancelled','skipped','todo']:
   m=re.search(r'^(?:#|ℹ) '+field+r' (\d+)$',chunks[i+3],re.M)
   b[field]=int(m.group(1)) if m else None
  run['batches'].append(b)
 if not run['batches']:
  run['tapSummary']={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',s,re.M)}
 for suffix,data in [('stdout',raw),('stderr',err)]:
  with (out/(label+'.'+suffix+'.log.gz')).open('wb') as f:
   with gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0) as g:g.write(data)
 results['runs'].append(run)
 (out/'results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False)+'\n')
 print('END',label,json.dumps(run,ensure_ascii=False),flush=True)
 if label in ['i18n','release-notes']:print(s,err.decode(errors='replace'),flush=True)
 if result.returncode:
  for m in re.finditer(r'^not ok.*$',s,re.M):print(s[max(0,m.start()-150):m.start()+2200],flush=True)
  print(err.decode(errors='replace')[-4000:],flush=True)
  break
