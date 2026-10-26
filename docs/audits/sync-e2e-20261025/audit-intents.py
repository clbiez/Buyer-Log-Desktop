#!/usr/bin/env python3
"""Match actual submitted field values to accepts; do not infer acceptance from a UI label/op tag."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);data=[json.loads(l) for l in (root/'operations.jsonl').read_text().splitlines()];m=data[0];owner=m['owner']
intents={x['id']:x for x in data if x['type']=='intent'};requests={x['requestId']:x for x in data if x['type']=='submitted'};latest={};accepted=[];misattributed=[]
for x in data:
 if x['type'] not in ('server-response','upstream-acceptance') or x.get('status')!=200:continue
 req=requests.get(x.get('requestId'),{});i=intents.get(x.get('operationId'),{})
 if req.get('url')!='/api/collection-workspaces/'+owner:continue
 applied={str(v['id']) for v in x.get('data',{}).get('applied',[]) if v.get('kind')!='removed'}
 for row in req.get('body',{}).get('upserts',[]):
  if str(row['id']) not in applied:continue
  v={'at':x['at'],'requestId':x.get('requestId'),'operationId':x.get('operationId'),'rowId':str(row['id']),'modelKod':row.get('modelKod'),'sentRev':row.get('_rev'),'backend':req.get('backend')};accepted.append(v)
  if i.get('kind')=='edit' and str(i.get('rowId'))==str(row['id']):
   if row.get(i.get('field'))==i['id']:latest[str(row['id'])]=v
   else:misattributed.append(v)
changes=[]
for id,v in latest.items():
 later=[x for x in accepted if x['rowId']==id and x['at']>v['at'] and x['modelKod']!=v['modelKod']]
 for x in later:
  target=intents.get(x['modelKod'],{});x['matchesExplicitModelIntent']=target.get('kind')=='edit' and str(target.get('rowId'))==id and target.get('sentAt',0)>v['at']
 if later:changes.append({'acceptedUserIntent':v,'laterDifferentAcceptedWrites':later})
files=sorted(root.glob('pre-recovery-device-*.json')) or sorted(root.glob('durable-device-*.json'))
missing=[]
for f in files:
 w=json.loads(f.read_text());rows={str(r['id']):r for r in w.get('rows',[])}
 for id,x in latest.items():
  if rows.get(id,{}).get('modelKod')!=x['modelKod']:missing.append({'snapshot':f.name,'rowId':id,'accepted':x['modelKod'],'actual':rows.get(id,{}).get('modelKod')})
out={'root':str(root),'latestMatchedAcceptedUserIntents':list(latest.values()),'misattributedBulkAccepts':misattributed,'laterDifferentAcceptedWrites':changes,'snapshotDifferences':missing,'uniqueDifferingRows':len({x['rowId'] for x in missing}),'note':'A later native write explains a state change, but background replay of an older model is not a new legitimate user model-edit decision. Original recovery outputs are retained unchanged.'}
(root/'intent-reconciliation.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'root':root.name,'matchedLatestIntents':len(latest),'misattributedBulkAccepts':len(misattributed),'uniqueDifferingRows':out['uniqueDifferingRows'],'rowsWithLaterDifferentAcceptedWrites':len(changes)}))
