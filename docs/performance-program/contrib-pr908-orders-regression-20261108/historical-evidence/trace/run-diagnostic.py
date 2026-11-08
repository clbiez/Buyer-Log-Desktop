#!/usr/bin/env python3
"""PREPARED, NEVER EXECUTED DURING PREPARATION. One serial NONFORMAL A/B only."""
import argparse,datetime,fcntl,gzip,hashlib,json,os,pathlib,shutil,signal,subprocess,time
PACKET=pathlib.Path(__file__).resolve().parent
NODE='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node'
MIB=1024*1024
# Planning allowances, not data/sample caps. Only the requested trace has a cap.
BUDGET={'trace':64*MIB,'cpuProfile':32*MIB,'captures':16*MIB,'logsAndScreenshots':8*MIB,'mutableGrowth':16*MIB,'browserTransient':64*MIB,'postExitCompressionTransient':64*MIB,'reserve':64*MIB}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(p):return json.loads(pathlib.Path(p).read_text())
def digest(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb') as f:
  for b in iter(lambda:f.read(MIB),b''):h.update(b)
 return h.hexdigest()
def save(p,v):
 p=pathlib.Path(p);t=p.with_name(p.name+'.partial')
 with t.open('w') as f:f.write(json.dumps(v,indent=2)+'\n');f.flush();os.fsync(f.fileno())
 os.replace(t,p)
def git(tree,*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=tree,text=True).strip()
def assert_pins(m):
 for name,expected in read(PACKET/'preparation-files-sha.json').items():assert digest(PACKET/name)==expected,'Prepared file changed: '+name
 for arm,p in m['arms'].items():
  tree=pathlib.Path(p['checkout']);assert git(tree,'rev-parse','HEAD')==p['head']
  assert git(tree,'rev-parse','HEAD:resources/app')==p['appTree']
  assert not git(tree,'diff','--name-only','HEAD','--','resources/app'),'Tracked app changes: '+arm
  assert not git(tree,'ls-files','--others','--exclude-standard','resources/app'),'Untracked app changes: '+arm
  for relative,pin in m['sourcePins'][arm].items():assert digest(tree/relative)==pin['sha256'],relative
 for name in ['input','observer','formalSeries','equivalence','acceptance']:
  assert digest(m[name]['path'])==m[name]['sha256'],name+' provenance changed'
 assert read(m['acceptance']['path'])['status']=='passed'
 original=read(m['input']['path']);assert original['synthetic'] is True and original['status']=='passed'
 assert original['schemaVersion']==3 and len(original['measurements'])==4
 assert original['requestedRows']==30000 and original['fixture']['seed']==7
 source=pathlib.Path(original['fixtureRoot']);assert source.resolve()==source and source.parent==pathlib.Path('/tmp')
 marker=read(source/'source/benchmark-fixture.json');assert marker==original['fixture']
 for filename,expected in marker['hashes'].items():assert digest(source/'source'/filename)==expected
 return source,marker

def copied_allocated_bytes(source):
 # Same exclusion rules as the immutable native fs.cpSync filter, with block rounding.
 total=4096
 for p in source.rglob('*'):
  relative=p.relative_to(source);parts=relative.parts
  if str(relative)=='server.log' or (len(parts)>=2 and parts[:2]==('local','logs')) or (len(parts)==1 and p.name.endswith('.png')):continue
  if p.is_symlink():raise RuntimeError('Unexpected symlink in synthetic input: '+str(relative))
  total+=4096 if p.is_dir() else max(4096,((p.stat().st_size+4095)//4096)*4096)
 return total

def process_identity(pid):
 try:return pathlib.Path('/proc',str(pid),'stat').read_text().split(') ')[1].split(' ')[19]
 except FileNotFoundError:return None

def children_exited(out):
 file=out/'child-processes.json'
 if not file.exists():return False,[]
 children=read(file)
 ok=bool(children) and sum(c.get('isServer',False) for c in children)==1
 for c in children:
  pid=c.get('pid');ticks=c.get('startTicks')
  if not pid or not ticks or not c.get('exitedAt') or process_identity(pid)==ticks:ok=False
 return ok,children

def cleanup_known_children(out):
 # Failure/interrupt only, never during a completed measurement. No broad pkill.
 file=out/'child-processes.json';actions=[]
 if not file.exists():return
 for c in reversed(read(file)):
  pid,ticks=c.get('pid'),c.get('startTicks')
  if not pid or not ticks or process_identity(pid)!=ticks:continue
  for sig in [signal.SIGTERM,signal.SIGKILL]:
   if process_identity(pid)!=ticks:break
   try:os.kill(pid,sig);actions.append({'pid':pid,'startTicks':ticks,'signal':sig.name,'at':now()})
   except ProcessLookupError:break
   until=time.monotonic()+10
   while process_identity(pid)==ticks and time.monotonic()<until:time.sleep(.1)
 save(out/'failure-child-cleanup.json',actions)

def dedup_completed_source(out,fixture,source,marker):
 changes=[]
 for filename,expected in marker['hashes'].items():
  original=source/'source'/filename;target=fixture/'source'/filename
  assert digest(original)==expected and digest(target)==expected
  before=target.stat();original_before=original.stat();temporary=target.with_name(target.name+'.completed-run-link')
  os.link(original,temporary);os.replace(temporary,target)
  after=target.stat();original_after=original.stat()
  assert digest(target)==expected and digest(original)==expected
  assert (after.st_dev,after.st_ino)==(original_after.st_dev,original_after.st_ino)
  assert original_after.st_mode==original_before.st_mode
  changes.append({'path':str(target),'original':str(original),'sha256':expected,'before':{'device':before.st_dev,'inode':before.st_ino,'bytes':before.st_size},'after':{'device':after.st_dev,'inode':after.st_ino,'bytes':after.st_size},'sourceLinkCountBefore':original_before.st_nlink,'sourceLinkCountAfter':original_after.st_nlink})
 save(out/'post-server-exit-source-dedup.json',{'performedAfterConfirmedChildExit':True,'changes':changes,'note':'No source chmod/chown or byte change. A hardlink necessarily changes source link count/ctime, only after run exit.'})

def pack_after_exit(out):
 records=[];manifest=out/'lossless-compression-manifest.json'
 for raw in sorted(out.iterdir()):
  if not raw.is_file() or raw.name.endswith('.gz') or raw.stat().st_size<MIB:continue
  if raw.name in ['lossless-compression-manifest.json']:continue
  expected=digest(raw);size=raw.stat().st_size;packed=raw.with_name(raw.name+'.gz');temporary=packed.with_name(packed.name+'.packing')
  assert not packed.exists() and not temporary.exists()
  with raw.open('rb') as src,temporary.open('xb') as dst:
   with gzip.GzipFile(filename='',mode='wb',fileobj=dst,mtime=0,compresslevel=6) as z:shutil.copyfileobj(src,z,MIB)
   dst.flush();os.fsync(dst.fileno())
  check=hashlib.sha256();decoded=0
  with gzip.open(temporary,'rb') as z:
   for b in iter(lambda:z.read(MIB),b''):check.update(b);decoded+=len(b)
  assert decoded==size and check.hexdigest()==expected,'Lossless gzip verification failed'
  os.replace(temporary,packed)
  records.append({'rawPath':str(raw),'rawBytes':size,'rawSha256':expected,'gzipPath':str(packed),'gzipBytes':packed.stat().st_size,'gzipSha256':digest(packed),'verifiedDecodedBytes':decoded,'verifiedDecodedSha256':check.hexdigest(),'serverAndBrowserExited':True,'rawReleased':False})
  save(manifest,records)  # durable manifest BEFORE raw removal
  assert digest(raw)==expected;raw.unlink();records[-1]['rawReleased']=True;save(manifest,records)
 if not records:save(manifest,[])

parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--label',required=True);args=parser.parse_args()
assert args.label and all(c.isalnum() or c in '-_' for c in args.label)
lock_path=pathlib.Path('/tmp/buyerlog-performance-measurement.lock');assert lock_path.exists(),'Existing common performance lock is required'
with lock_path.open('a+') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 m=read(PACKET/'prepared-manifest.json');source,marker=assert_pins(m)
 # Private roots are supplied by the immutable benchmark, not ambient app settings.
 blocked=[k for k,v in os.environ.items() if v and (k.startswith('BUYER_LOG_') or k in ['NODE_OPTIONS','NODE_PATH','BL_STALL_PROFILE'])]
 assert not blocked,'Ambient overrides present (names only): '+','.join(sorted(blocked))
 assert pathlib.Path(NODE).is_file() and pathlib.Path(m['chromium']).is_file()
 root=PACKET/'runs'/args.label;root.mkdir(parents=True,exist_ok=False)
 source_copy=copied_allocated_bytes(source);active_required=source_copy+sum(BUDGET.values())
 report={'classification':m['classification'],'formalAcceptance':False,'status':'running','startedAt':now(),'sourceManifest':str(PACKET/'prepared-manifest.json'),'sourceManifestSha256':digest(PACKET/'prepared-manifest.json'),'timezone':'Europe/Istanbul','order':['A','B'],'input':m['input'],'budgets':BUDGET,'copyAllocatedEstimateBytes':source_copy,'activeArmRequiredFreeBytes':active_required,'admissionPolicy':'Serial per-arm peak; first A retained, losslessly packed and original XLSX deduplicated after confirmed server/browser exit; B admission uses actual remaining free disk. No guaranteed second arm if disk cannot admit it. No concurrent arms.','runs':[]}
 def persist():save(root/'diagnostic-series.json',report)
 persist()
 try:
  for arm in ['A','B']:
   assert_pins(m)
   free=shutil.disk_usage('/tmp').free;admission={'arm':arm,'at':now(),'freeBytes':free,'requiredBytes':active_required,'admitted':free>=active_required};report.setdefault('admissions',[]).append(admission);persist()
   assert free>=active_required,'Disk admission refused before app start; earlier evidence retained'
   out=root/arm;out.mkdir();item={'arm':arm,'head':m['arms'][arm]['head'],'status':'running','startedAt':now(),'output':str(out)};report['runs'].append(item);persist()
   env=dict(os.environ,TZ='Europe/Istanbul',TMPDIR='/tmp',TMP='/tmp',TEMP='/tmp',CHROMIUM_PATH=m['chromium'],PLAYWRIGHT_MODULE=str(PACKET/'playwright-profile-wrapper.cjs'),FIRST_TRANSITION_EXTRA=str(out/'post-timing-data.json'),ORDERS_DIAGNOSTIC_ARM=arm,ORDERS_DIAGNOSTIC_DIR=str(out),ORDERS_DIAGNOSTIC_POSTCOPY_MIN_BYTES=str(sum(BUDGET.values())))
   env.pop('FIRST_TRANSITION_EXTRA_NAV',None)
   command=[NODE,str(PACKET/'launch-single-orders.cjs'),'--app-root',m['arms'][arm]['appRoot'],'--measurement',m['input']['path'],'--out',str(out/'measurement.json')];item['command']=command;persist()
   p=None;run_error=None
   try:
    with (out/'benchmark.log').open('w') as log:
     p=subprocess.Popen(command,cwd=m['arms'][arm]['appRoot'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
     item['launcherPid']=p.pid;persist();item['returncode']=p.wait()
   except BaseException as error:
    run_error=error
    if p and p.poll() is None:
     p.terminate()
     try:p.wait(timeout=10)
     except subprocess.TimeoutExpired:p.kill();p.wait()
   finally:
    safe,children=children_exited(out);item['childrenExitedBeforeArtifactMutation']=safe;item['children']=children
    if not safe:cleanup_known_children(out)
    item['finishedAt']=now();persist()
   # Native failure artifacts still get lossless packing, but only with exit proof.
   if not item['childrenExitedBeforeArtifactMutation']:raise RuntimeError('Child exit not proven; raw artifacts preserved; no next arm')
   measurement=out/'measurement.json';partial=out/'measurement.json.partial'
   raw=read(measurement) if measurement.exists() else (read(partial) if partial.exists() else None)
   validation_error=None
   try:
    assert run_error is None and item.get('returncode')==0,'Native benchmark failed; no retry'
    assert raw and raw['status']=='passed';assert len(raw['transitions'])==1 and raw['transitions'][0]['module']=='orders'
    instrumentation=read(out/'instrumentation.json');assert instrumentation['status']=='stopped' and instrumentation['cpuProfileComplete']
    assert instrumentation['traceCompleteReceived'] and not instrumentation['traceDataLoss'] and not instrumentation['errors'] and instrumentation['traceEvents']>0
    assert instrumentation['stopReason']=='native-first-transition-completed';assert instrumentation['traceBytes']<=64*MIB
    assert instrumentation['profileStoppedBeforeSupplementalCapture'] is True
    close=read(out/'context-close-diagnostic.json');assert not close['failures'] and close['profileStoppedBeforeObserver'] is True
    captures=read(out/'post-timing-data.json');assert len(captures)==1;capture=captures[0]
    assert capture['module']=='orders' and capture['stage']=='initial' and capture['unobscured'] is True and capture['timezone']=='Europe/Istanbul'
    contracts=read(m['equivalence']['path']);assert capture['normalizedRowsSha256']==contracts['fullNormalizedRows']['orders']
    counts=set(capture['cellsPerRow']);assert len(counts)==1;variant=str(next(iter(counts)));assert variant in contracts['ordersFullVisibleCellsByObservedBaselineVariant']
    assert capture['visibleCellsSha256']==contracts['ordersFullVisibleCellsByObservedBaselineVariant'][variant]
    schema=read(out/'initial-orders-schema-cells.json');assert schema['schemas']['orders']['header']==contracts['ordersHeaders'][variant]
    item.update(transition=raw['transitions'][0],capture=capture,ordersSchemaVariant=int(variant),status='passed')
   except BaseException as error:validation_error=error;item.update(status='failed',error=repr(error))
   if raw:
    fixture=pathlib.Path(raw['fixtureRoot']);assert fixture.parent==pathlib.Path('/tmp') and fixture.name.startswith('buyerlog-first-transition-')
    item['fixtureRoot']=str(fixture);dedup_completed_source(out,fixture,source,marker)
   pack_after_exit(out);persist()
   if validation_error:raise validation_error
   print('PASS diagnostic',arm,round(item['transition']['elapsedMs']),flush=True)
  report['status']='passed';report['interpretation']='One instrumented A/B diagnostic only. Profiling overhead/order/system state preclude a gain, root-cause or merge-acceptance claim. CP is unmeasured; natural CP background work remains enabled.'
 except BaseException as error:report.update(status='failed',error=repr(error));raise
 finally:report['finishedAt']=now();persist()
