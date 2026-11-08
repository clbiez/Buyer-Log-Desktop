import pathlib,os,subprocess,json,hashlib,datetime,fcntl,shutil,statistics
ROOT=pathlib.Path('/tmp/buyerlog-908-firstcp-final-after917');ROOT.mkdir(exist_ok=False)
A=pathlib.Path('/workspace/buyerlog-analytics904');B=pathlib.Path('/tmp/buyerlog-shared-ui908')
INPUT=pathlib.Path('/tmp/buyerlog-startup-shellpost901-20261107T201347-after-3/measurement.json')
AH='1796193f0a57c7785e7bf9fdb3557e33c550b25e';BH='b954526199ed066feff77b438466cd48b78e03f5'
lock=open('/tmp/buyerlog-performance-measurement.lock','a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert json.loads((B/'docs/performance/shared-ui-post-main-20261107/post-917-20261108/acceptance.json').read_text())['status']=='passed'
for tree,head in [(A,AH),(B,BH)]:assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=tree,text=True).strip()==head
helper='resources/app/scripts/lib/first-transition-probe.js';assert (A/helper).read_bytes()==(B/helper).read_bytes()
assert not subprocess.check_output(['git','diff','--name-only','HEAD','--','resources/app','.github'],cwd=B,text=True).strip()
proof=pathlib.Path('/tmp/buyerlog-908-post916-schema-proof')
schema60=json.loads((proof/'initial-orders-schema-cells.json').read_text())['schemas']['orders']
extra=['__checklist__'+x for x in ['pps','soff','artwork','tests','fabric','accessories','supplierConfirmation']]
assert [x['key'] for x in schema60['header'][-7:]]==extra
assert all(x['checklistSupplierColumn'] for x in schema60['definitions'][-7:])
cp_header=json.loads((proof/'initial-cp-schema-cells.json').read_text())['schemas']['cp']['header']
contracts={'declaredBeforeRuns':True,'fullNormalizedRows':{'cp':'6ae360b5cc7f2c9b2f125c3814653393438ecc7e175e671d830e0bbc6a50db4b','orders':'3611e608734e9d1db9400fd85fd3be566e55f0ba871ac780a36a381eb514c59b'},'cpFullVisibleCellsSha256':'d991c092fadd3b5d20f52e84b5dc66b1f288bb3e193ee4edd7e2d14030b9f4da','ordersFullVisibleCellsByObservedBaselineVariant':{'60':'c6a6a9c7db927b18d4b1529890469b69fa82a63441f16bdf83816ce1c32a1da9','53':'de378cdec53e573ba35abd87afc8575a2c0587bbd367fb744200fb790a5e5a9b'},'variantEvidence':'Two same-code A/A controls before this cohort show 60/53 cells; exact common 53 cell texts/ids match all50rows and seven extras are checklist fields with dash cells. Preserve both full variants; do not claim identical initial DOM when variants differ.','ordersHeaders':{'60':schema60['header'],'53':schema60['header'][:-7]},'headers53Evidence':'Inferred from source append order and exact observed53 full-cell snapshot; headers53 not separately captured in historical A2. A new unexpected header rejects.','cpHeader':cp_header,'source916':'0c85445f1989cafbae4f104c13ddf5d8f0b84c6c'}
(ROOT/'predeclared-equivalence.json').write_text(json.dumps(contracts,indent=2)+'\n')
shutil.copy2('/tmp/buyerlog-908-final-schema-observer.cjs',ROOT/'observer.cjs')
report={'status':'running','base':AH,'candidate':BH,'commonHelperSha256':hashlib.sha256((A/helper).read_bytes()).hexdigest(),'observerSha256':hashlib.sha256((ROOT/'observer.cjs').read_bytes()).hexdigest(),'input':str(INPUT),'order':'A/B–B/A–A/B','environment':{'timezone':'Europe/Istanbul','node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':'Linux headless Chromium,4vCPUquota; notWindows/Electron'},'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runs':[]}
def save():(ROOT/'series.json').write_text(json.dumps(report,indent=2)+'\n')
save()
try:
 for pair,arms in [(1,['A','B']),(2,['B','A']),(3,['A','B'])]:
  for arm in arms:
   if shutil.disk_usage('/tmp').free<170*1024*1024:raise RuntimeError('Disk admission refused; previous evidence retained')
   tree=A if arm=='A' else B;out=ROOT/('pair'+str(pair)+'-'+arm);out.mkdir()
   env=dict(os.environ,TZ='Europe/Istanbul',PLAYWRIGHT_MODULE=str(ROOT/'observer.cjs'),CHROMIUM_PATH='/usr/bin/chromium',FIRST_TRANSITION_EXTRA=str(out/'post-timing-data.json'))
   env.pop('FIRST_TRANSITION_EXTRA_NAV',None)
   command=['node',str(A/'resources/app/scripts/benchmark-first-transitions.js'),'--app-root',str(tree/'resources/app'),'--measurement',str(INPUT),'--out',str(out/'measurement.json')]
   item={'pair':pair,'arm':arm,'head':AH if arm=='A' else BH,'command':command,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};report['runs'].append(item);save();print('START',pair,arm,flush=True)
   with (out/'benchmark.log').open('w') as log:r=subprocess.run(command,cwd=tree/'resources/app',env=env,stdout=log,stderr=subprocess.STDOUT)
   item.update(returncode=r.returncode,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());save();assert r.returncode==0,'Run failed; no automatic retry'
   m=json.loads((out/'measurement.json').read_text());item['fixtureRoot']=m['fixtureRoot'];item['transitions']=m['transitions'];captures=json.loads((out/'post-timing-data.json').read_text());item['captures']=captures;save()
   for capture in captures:
    module=capture['module'];assert capture['stage']=='initial';assert capture['unobscured'] is True
    assert capture['normalizedRowsSha256']==contracts['fullNormalizedRows'][module],module+' complete normalized row mismatch'
    s=json.loads((out/('initial-'+module+'-schema-cells.json')).read_text());header=s['schemas'][module]['header']
    if module=='cp':
     assert capture['visibleCellsSha256']==contracts['cpFullVisibleCellsSha256'],'CP full visible cell mismatch'
     assert header==contracts['cpHeader'],'CP header mismatch'
    else:
     counts=set(capture['cellsPerRow']);assert len(counts)==1;variant=str(next(iter(counts)))
     assert variant in contracts['ordersFullVisibleCellsByObservedBaselineVariant'],'new Orders schema variant'
     assert capture['visibleCellsSha256']==contracts['ordersFullVisibleCellsByObservedBaselineVariant'][variant],'Orders full visible cell content mismatch'
     assert header==contracts['ordersHeaders'][variant],'Orders full header mismatch'
     item['ordersSchemaVariant']=int(variant)
   source=pathlib.Path(json.loads(INPUT.read_text())['fixtureRoot']);marker=json.loads((source/'source/benchmark-fixture.json').read_text());dedup=[]
   for filename,expected in marker['hashes'].items():
    target=pathlib.Path(m['fixtureRoot'])/'source'/filename;original=source/'source'/filename;assert hashlib.sha256(target.read_bytes()).hexdigest()==expected
    temporary=target.with_name(target.name+'.post-measurement-link');os.link(original,temporary);os.replace(temporary,target);dedup.append({'path':str(target),'sha256':expected})
   (out/'post-measurement-dedup.json').write_text(json.dumps(dedup,indent=2)+'\n');item['status']='passed';save();print('PASS',pair,arm,[round(t['elapsedMs']) for t in m['transitions']],item['ordersSchemaVariant'],flush=True)
 summary={}
 for module in ['cp','orders']:
  summary[module]={}
  for key in ['elapsedMs','firstRowsPaintedMs','dataReadyMs','observationEndMs']:
   summary[module][key]={arm:statistics.median(next(t[key] for t in run['transitions'] if t['module']==module) for run in report['runs'] if run['arm']==arm) for arm in ['A','B']}
  summary[module]['pairedPercent']=[100*(next(t['elapsedMs'] for r in report['runs'] if r['pair']==p and r['arm']=='B' for t in r['transitions'] if t['module']==module)/next(t['elapsedMs'] for r in report['runs'] if r['pair']==p and r['arm']=='A' for t in r['transitions'] if t['module']==module)-1) for p in [1,2,3]]
 report['summary']=summary;report['cpFirstIntentMedianRegression']=summary['cp']['elapsedMs']['B']>summary['cp']['elapsedMs']['A'];report['status']='passed';print(json.dumps(summary),flush=True)
except BaseException as e:report['status']='failed';report['error']=repr(e);raise
finally:report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
