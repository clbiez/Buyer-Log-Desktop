#!/usr/bin/env python3
"""Supplement existing read-only accounting with UI claims and pre-import fixture checks."""
import collections,json,math,pathlib,sys
root=pathlib.Path(sys.argv[1]);events=[json.loads(line) for line in (root/'operations.jsonl').open()];manifest=events[0]
accounting={v['operationId']:v for v in json.loads((root/'operation-accounting.json').read_text())};result=json.loads((root/'result.json').read_text()) if (root/'result.json').exists() else json.loads((root/'failure.json').read_text())
start=result.get('measurementAt');end=result.get('endAt');ui=[e for e in events if e['type']=='ui-result'];intents={e['id']:e for e in events if e['type']=='intent'}
def measured(e):return start is not None and start<=e['sentAt']<(end or float('inf'))
def percentiles(values):
 values=sorted(values);return {'samples':len(values),**{name:values[max(0,math.ceil(q*len(values))-1)] if values else None for name,q in [('p50',.5),('p95',.95),('p99',.99)]}}
accepted_edits=[e for e in ui if measured(e) and e['kind']=='edit' and accounting.get(e['id'],{}).get('status')=='accepted']
false_saved=[{'operationId':e['id'],'feedback':e.get('result',{}).get('feedback'),'accounting':accounting.get(e['id'],{}).get('status')} for e in ui if e['kind']=='edit' and e.get('result',{}).get('feedback',{}).get('status') in ['local','pending'] and accounting.get(e['id'],{}).get('status')!='accepted']
rejected_visible=[e for e in events if e['type']=='peer-visible' and accounting.get(e['operationId'],{}).get('status')=='explicitly-rejected']
peer_accepted=[e for e in events if e['type']=='peer-visible' and accounting.get(e['operationId'],{}).get('status')=='accepted' and measured(intents.get(e['operationId'],{'sentAt':0}))]
pre_files=sorted(root.glob('pre-quiescence-device-*.json'));pre_issues=[]
for f in pre_files:
 w=json.loads(f.read_text());rows=w.get('rows',[]);ids=[str(r.get('id')) for r in rows]
 if w.get('ownerId')!=manifest['owner']:pre_issues.append({'file':f.name,'kind':'wrong-owner','actual':w.get('ownerId')})
 if len(ids)!=manifest['users'] or len(ids)!=len(set(ids)):pre_issues.append({'file':f.name,'kind':'row-count-or-duplicate','rows':len(ids),'unique':len(set(ids))})
 for row in rows:
  expected={'plmId':'SYN-'+str(int(row['id'])-1),'season':'W26','country':'China','lisans':'E2E LICENSE','licensor':'E2E LICENSOR','qty':100,'trPrice':'400','trFx':'','exFactory':'2026-10-25','confirmedManufacturer':'Demo Supplier'}
  for key,value in expected.items():
   if str(row.get(key,''))!=str(value):pre_issues.append({'file':f.name,'rowId':row['id'],'field':key,'expected':value,'actual':row.get(key)})
  if str(row.get('pricing',{}).get('Demo Supplier'))!='4':pre_issues.append({'file':f.name,'rowId':row['id'],'field':'supplier-price','actual':row.get('pricing')})
conflicts=[{'operationId':e.get('operationId'),'rowId':c.get('id'),'reason':c.get('reason'),'planned':intents.get(e.get('operationId'),{}).get('kind')=='controlled-conflict'} for e in events if e['type']=='server-response' for c in e.get('data',{}).get('conflicts',[])]
crud=[{'operationId':e['id'],'user':e['user'],**e.get('result',{})} for e in ui if e['kind']=='create-delete']
out={'root':str(root),'acceptedEditUiLatencyMs':percentiles([e['elapsedMs'] for e in accepted_edits]),'acceptedFirstDifferentBackendVisibleMs':percentiles([e['elapsedMs'] for e in peer_accepted]),'falseLocalSavedClaims':false_saved,'explicitlyRejectedIntentObservedAtPeer':rejected_visible,'preQuiescenceFixtureFiles':len(pre_files),'preQuiescenceFixtureDifferences':pre_issues,'conflictRows':{'plannedBarrier':sum(e['planned'] for e in conflicts),'unplannedReported':sum(not e['planned'] for e in conflicts),'byReason':dict(collections.Counter(e['reason'] for e in conflicts))},'checkedCrudSideEffects':crud,'duplicateArchivedCopiesInCheckedCrud':sum(max(0,e.get('archivedCopies',0)-1) for e in crud),'pageErrors':[e for e in events if e['type']=='page-error'],'limits':'Per-request UUID uniqueness is not global exactly-once. Pre-import checks cover seeded immutable fields/owner/IDs, while latest accepted models and final canonical/DOM/cold checks are in the original reconciliation. Different later legitimate writes are not loss. Unplanned reported CAS conflicts are separated from controlled barriers; they are not automatically product bugs.'}
(root/'data-health-supplement.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k not in ['checkedCrudSideEffects','pageErrors']}))
