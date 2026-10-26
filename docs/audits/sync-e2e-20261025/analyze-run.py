#!/usr/bin/env python3
"""Read-only independent accounting over a retained native-browser journal."""
import collections, json, math, pathlib, sys
root=pathlib.Path(sys.argv[1]); data=[json.loads(l) for l in (root/'operations.jsonl').read_text().splitlines() if l.strip()]
result=json.loads((root/'result.json').read_text()) if (root/'result.json').exists() else json.loads((root/'failure.json').read_text())
start=result.get('measurementAt'); end=result.get('endAt') or (start+result.get('requestedSeconds',0)*1000 if start else None)
intents={x['id']:x for x in data if x['type']=='intent'}
ui={x['id']:x for x in data if x['type'] in ('ui-result','operation-error')}
submitted=collections.defaultdict(list); responses=collections.defaultdict(list)
for x in data:
 if x['type']=='submitted':submitted[x['operationId']].append(x)
 if x['type'] in ('server-response','upstream-acceptance'):responses[x.get('operationId')].append(x)
accounting=[]
for id,i in intents.items():
 r=responses[id]; accepted=[x for x in r if x.get('status')==200 and x.get('data',{}).get('applied')]
 rejected=[x for x in r if x.get('status',0)>=400 or x.get('data',{}).get('conflicts')]
 rule_responses=[x for x in data if x['type']=='rule-response' and x.get('user')==i['user'] and i['sentAt']<=x['at']<=ui.get(id,{}).get('finishedAt',i['sentAt'])]
 if not accepted and i['kind'].startswith('moderator-') and any(x.get('status')==200 for x in rule_responses):accepted=rule_responses
 if not rejected and i['kind'].startswith('moderator-') and any(x.get('status',0)>=400 for x in rule_responses):rejected=rule_responses
 status='accepted' if accepted else 'explicitly-rejected' if rejected else 'acceptance-uncertain' if submitted[id] else 'not-submitted'
 if not accepted and not rejected and not submitted[id] and id in ui and not ui[id].get('error'):status='completed-non-collection-write' if i['kind']!='edit' else 'not-submitted'
 accounting.append({'operationId':id,'kind':i['kind'],'user':i['user'],'sentAt':i['sentAt'],'phase':i.get('phase'),'status':status,'submittedRequestIds':[s.get('requestId') for s in submitted[id]],'acceptedResponses':len(accepted),'replicationReceipts':[x.get('data',{}).get('replication') for x in r if x.get('data',{}).get('replication')],'rejectedResponses':len(rejected),'ui':ui.get(id,{}).get('result'),'error':ui.get(id,{}).get('error')})
measured=[x for x in accounting if start and start<=x['sentAt']<end]
conflicts=[]
for x in data:
 if x['type']=='server-response':
  for c in x.get('data',{}).get('conflicts',[]):conflicts.append({'operationId':x.get('operationId'),'requestId':x.get('requestId'),'rowId':c.get('id'),'reason':c.get('reason'),'phase':x.get('phase')})
rows=[json.loads(l) for l in (root/'resources.jsonl').read_text().splitlines()] if (root/'resources.jsonl').exists() else []
resource={}; selected=[x for x in rows if not start or start<=x['at']<end]
for group in ['driver','backend','application-renderer','browser-driver']:
 points=[]; seen={}
 for x in selected:
  ps=[p for p in x['processes'] if p['group']==group];points.append(sum(p['rssBytes'] for p in ps))
  for p in ps:
   q=seen.setdefault(p['pid'],{'first':p,'last':p});q['last']=p
 resource[group]={'peakAggregateRssBytes':max(points,default=0),'cpuSecondsBetweenSamples':sum((p['last']['cpuTicks']-p['first']['cpuTicks'])/100 for p in seen.values()),'physicalDiskReadBytesBetweenSamples':sum(max(0,p['last']['readBytes']-p['first']['readBytes']) for p in seen.values()),'physicalDiskWriteBytesBetweenSamples':sum(max(0,p['last']['writeBytes']-p['first']['writeBytes']) for p in seen.values()),'sampledProcessCount':len(seen)}
# Outstanding browser Collection writes are an observed request backlog, not an internal lock queue.
pending=set();peak=0
for x in data:
 key=x.get('requestId')
 if not key:continue
 if x['type']=='submitted':pending.add(key);peak=max(peak,len(pending))
 elif x['type'] in ('server-response','transport-failed'):pending.discard(key)
requests=[x.get('requestId') for x in data if x['type']=='submitted' and x.get('requestId')]
financial=[x for x in data if x['type']=='calculation-evidence']
financial_mapping=[]
for x in financial:
 candidates=[i['id'] for i in intents.values() if i['kind']=='calculate' and i['user']==x.get('user') and i['sentAt']<=x['at']<=ui.get(i['id'],{}).get('finishedAt',i['sentAt'])]
 financial_mapping.append({'at':x['at'],'user':x.get('user'),'rowId':x.get('rowId'),'operationId':candidates[0] if len(candidates)==1 else None,'candidateCount':len(candidates)})
missing_arithmetic=[x.get('operationId') for x in financial if not {'tr-landed','overseas-landed'}.issubset({c['name'] for c in x.get('independentChecks',[])})]
failed_arithmetic=[{'operationId':x.get('operationId'),'check':c} for x in financial for c in x.get('independentChecks',[]) if not c.get('ok')]
out={'root':str(root),'financialEvidenceCount':len(financial),'financialEvidenceMapping':financial_mapping,'financialSamplesWithoutBothArithmeticChecks':missing_arithmetic,'failedFinancialChecks':failed_arithmetic,'result':result,'logicalOperationCount':len(accounting),'measuredLogicalOperationCount':len(measured),'outcomesAll':dict(collections.Counter(x['status'] for x in accounting)),'outcomesMeasured':dict(collections.Counter(x['status'] for x in measured)),'measuredKinds':dict(collections.Counter(x['kind'] for x in measured)),'allConflictResponses':conflicts,'retryEvents':[x for x in data if x['type']=='application-retry'],'plannedFaultEvents':[x for x in data if x['type'] in ('fault-offline','fault-reconnected','upstream-acceptance')],'minuteActivity':[x for x in data if x['type']=='minute-activity'],'peakOutstandingBrowserCollectionRequests':peak,'outstandingBrowserCollectionRequestsAtEnd':len(pending),'duplicateJournalRequestIds':len(requests)-len(set(requests)),'nativeBackgroundWrites':sum(len(v) for k,v in submitted.items() if k not in intents),'resources':resource,'containerPeakMemoryBytes':max((x.get('memoryCurrent') or 0 for x in rows),default=0),'resourceSamples':len(rows),'sourceSamplingNote':'Linux USER_HZ=100; aggregate RSS can double-count shared pages; CPU/disk deltas omit work outside observed process lifetime. Network is completed browser HTTP only, excluding open SSE and setup. No per-process network or internal queue instrumentation is claimed.'}
(root/'operation-accounting.json').write_text(json.dumps(accounting,ensure_ascii=False,indent=2)+'\n')
(root/'analysis.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k not in ('result','allConflictResponses','retryEvents','plannedFaultEvents','minuteActivity')},ensure_ascii=False,indent=2))
