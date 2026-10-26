#!/usr/bin/env python3
"""Index retained runs without upgrading failures, skips or missing results."""
import json,pathlib,hashlib
base=pathlib.Path('/workspace/scratch');audit=pathlib.Path(__file__).resolve().parent
runs=[]
for root in sorted(base.glob('bl-*')):
 if not root.is_dir():continue
 manifest={}
 if (root/'manifest.json').is_file():
  try:manifest=json.loads((root/'manifest.json').read_text())
  except ValueError:pass
 records=[]
 for name in ['result.json','results.json','failure.json','interrupted.json','failed-run-recovery.json','oracle-correction.json','reconciliation.json','intent-reconciliation.json','analysis.json','diagnostic-result.json']:
  p=root/name
  if not p.is_file():continue
  try:d=json.loads(p.read_text())
  except ValueError:continue
  record={'file':name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  for key in ['status','source','users','backends','backendInstances','replicas','requestedUsers','requestedSeconds','usersOpened','measurementAt','measurementDurationMs','completedOperations','error','activityComplete']:
   if key in d:record[key]=d[key]
  if isinstance(d.get('results'),list):record['scenarios']=[{k:v for k,v in x.items() if k in ['name','status','error']} for x in d['results']]
  # A recovery pass never changes the original run's failure into a pass.
  records.append(record)
 if records:runs.append({'root':str(root),'sourceHeadAtSetup':manifest.get('source'),'sourceDirtyRecorded':manifest.get('sourceDirty'),'records':records})
(audit/'scenario-evidence.json').write_text(json.dumps({'note':'Statuses are copied from original retained files. Recovery/correction is separate evidence; not a replacement result. Scope and source inheritance are in final-report.md. A lower user count is never a 50-user pass.','runs':runs},ensure_ascii=False,indent=2)+'\n')
print('indexed retained run roots',len(runs))
