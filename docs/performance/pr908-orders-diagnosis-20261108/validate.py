"""Serial acceptance with the repository's default runner. Run under the shared flock."""
import datetime,gzip,hashlib,json,os,pathlib,subprocess,sys,tempfile
REPO=pathlib.Path(__file__).resolve().parents[3];APP=REPO/'resources/app'
OUT=pathlib.Path(sys.argv[1]);OUT.mkdir(parents=True,exist_ok=False)
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
commands=[
    ('related',['npm','test','--','table-header','table-group','freeze','workspace-blur','shared-ui','motion-plus','i18n','model-image-cache','first-transition']),
    ('cp-pass-cache-guards',['node','--test',*['tests/'+name+'.test.js' for name in ['checklist-components-row-cache','cp-personal-layer-delta','checklist-columns-delta','checklist-summary-contribution-cache','checklist-applies-row-memo','checklist-answer-batch-notify','checklist-assistant-view-reuse','checklist-remote-merge-noop','checklist-components-count-lookups']]]),
    ('full',['npm','test']),('i18n',['npm','run','i18n:check']),('release-notes',['npm','run','release:notes:validate'])]
report={'startedAt':now(),'appTree':subprocess.check_output(['git','rev-parse','HEAD:resources/app'],cwd=REPO,text=True).strip(),'commands':[],'status':'running'}
save=lambda:(OUT/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for name,command in commands:
    env=dict(os.environ,TMPDIR=tempfile.mkdtemp(prefix='pr908-diagnosis-'+name+'-'))
    for key in ['NODE_OPTIONS','NODE_PATH','BUYER_LOG_TEST_CONCURRENCY']:env.pop(key,None)
    item={'name':name,'command':command,'startedAt':now(),'tmpdir':env['TMPDIR']};report['commands'].append(item);save()
    print('START',name,flush=True)
    log=OUT/(name+'.log')
    with log.open('w') as stream:r=subprocess.run(command,cwd=APP,env=env,stdout=stream,stderr=subprocess.STDOUT)
    data=log.read_bytes();item.update(returncode=r.returncode,finishedAt=now(),logSha256=hashlib.sha256(data).hexdigest())
    (OUT/(name+'.log.gz')).write_bytes(gzip.compress(data,mtime=0));save();print('END',name,r.returncode,flush=True)
report['status']='passed' if all(item['returncode']==0 for item in report['commands']) else 'failed';report['finishedAt']=now();save()
sys.exit(0 if report['status']=='passed' else 1)
