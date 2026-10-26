#!/usr/bin/env python3
"""Package retained synthetic evidence; never build/publish an application release."""
import hashlib,json,pathlib,subprocess,zipfile
repo=pathlib.Path(__file__).resolve().parents[3]; audit=pathlib.Path(__file__).resolve().parent
out=pathlib.Path('/workspace/deliverables');out.mkdir(exist_ok=True)
patch=out/'buyer-log-sync-fixes.patch';patch.write_bytes(subprocess.check_output(['git','diff','--binary','3958d7436347de69f1465705b9ba24625adb2941','HEAD'],cwd=repo))
archive=out/'buyer-log-sync-audit-evidence.zip';manifest=[]
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 def add(p,name):
  z.write(p,name);manifest.append({'path':name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
 add(patch,patch.name)
 for p in audit.rglob('*'):
  if p.is_file():add(p,'audit/'+str(p.relative_to(audit)))
 for root in sorted(pathlib.Path('/workspace/scratch').glob('bl-*')):
  if not root.is_dir():continue
  for value in (root/'hub/BUYER_LOG_SYNC/collection-workspaces/v1').glob('*.json'):
   if value.is_file():add(value,'runs/'+root.name+'/hub/collection-workspaces/v1/'+value.name)
  for p in root.iterdir():
   if p.is_file() and p.suffix in ('.json','.jsonl','.png','.zip','.log','.xlsx','.cpuprofile'):
    add(p,'runs/'+root.name+'/'+p.name)
   if p.is_dir() and p.name.startswith('device-'):
    for log in p.glob('*.log'):add(log,'runs/'+root.name+'/'+p.name+'/'+log.name)
    for rel in ['server/collection-workspaces','server/collection-recycle-bin','local/collection-replication-state.json.bases']:
     for value in (p/rel).glob('*.json'):
      add(value,'runs/'+root.name+'/'+p.name+'/'+rel+'/'+value.name)
    state=p/'local/collection-replication-state.json'
    if state.exists():add(state,'runs/'+root.name+'/'+p.name+'/local/collection-replication-state.json')
 z.writestr('README.txt','Synthetic SYNC evidence only. Not a TEST/STABLE application release. See audit/final-report.md. Failed attempts are retained. Server auth stores and personal/production data are excluded. Original raw roots remain under /workspace/scratch/bl-*.\n')
 z.writestr('SHA256SUMS.json',json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'patch':str(patch),'files':len(manifest)},indent=2))
