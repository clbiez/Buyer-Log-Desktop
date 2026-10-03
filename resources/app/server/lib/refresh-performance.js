'use strict';

const fs=require('fs');
const fsp=require('fs/promises');
const path=require('path');
const crypto=require('crypto');
const {replaceFileWithRetry,withFileLeaseAsync}=require('./shared-file-transaction');

const SCHEMA_VERSION=1,SAMPLE_LIMIT=96,BUCKET_LIMIT=600,EVENT_ID_LIMIT=600;
function stableJson(value){
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return crypto.createHash('sha256').update(typeof value==='string'?value:stableJson(value)).digest('hex');}
function cleanTarget(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40);}
function rowBucketFor(value){
  const n=Number(value);if(!Number.isFinite(n)||n<=0)return'unknown';
  if(n<2500)return'<2.5k';if(n<7500)return'2.5k-7.5k';if(n<15000)return'7.5k-15k';
  if(n<30000)return'15k-30k';if(n<60000)return'30k-60k';if(n<120000)return'60k-120k';return'120k+';
}
function countLeaves(value){
  if(value==null||value==='')return 0;if(Array.isArray(value))return value.reduce((s,x)=>s+countLeaves(x),0);
  if(typeof value==='object')return Object.values(value).reduce((s,x)=>s+countLeaves(x),0);return 1;
}
function densityBucket(n){n=Math.max(0,Number(n)||0);return n<=3?'light':n<=10?'medium':'dense';}
function normalizeSourceModes(input){
  return Object.fromEntries(Object.entries(input&&typeof input==='object'?input:{})
    .map(([k,v])=>[cleanTarget(k),String(v||'').trim().toLowerCase().slice(0,40)])
    .filter(([k,v])=>k&&v).sort(([a],[b])=>a.localeCompare(b)));
}
function buildRefreshProfile(input={}){
  const targets=[...new Set((Array.isArray(input.targets)?input.targets:[]).map(cleanTarget).filter(Boolean))].sort();
  const counts=Object.values(input.rowCounts&&typeof input.rowCounts==='object'?input.rowCounts:{}).map(Number).filter(n=>Number.isFinite(n)&&n>=0);
  const rowCount=counts.length?Math.max(...counts):0;
  const horizons=(Array.isArray(input.horizons)?input.horizons:[]).map(item=>({
    targets:[...new Set((Array.isArray(item&&item.targets)?item.targets:[]).map(cleanTarget).filter(Boolean))].sort(),
    horizon:item&&item.horizon&&typeof item.horizon==='object'?item.horizon:{},
  })).sort((a,b)=>stableJson(a).localeCompare(stableJson(b)));
  const sourceModes=normalizeSourceModes(input.sourceModes),targetKey=targets.join('+')||'all';
  const sourceKey=Object.entries(sourceModes).map(([k,v])=>k+':'+v).join('|')||'default';
  return{targets,targetKey,sourceKey,horizonKey:digest(horizons).slice(0,16),
    horizonDensity:densityBucket(horizons.reduce((s,x)=>s+countLeaves(x.horizon),0)),
    rowCount,rowBucket:rowBucketFor(rowCount),scopeCount:horizons.length};
}
function emptySummary(){return{schemaVersion:SCHEMA_VERSION,updatedAt:null,buckets:{},recentEventIds:[]};}
function normalizeSummary(raw){
  if(!raw||Number(raw.schemaVersion)!==SCHEMA_VERSION||!raw.buckets||typeof raw.buckets!=='object')return emptySummary();
  return{schemaVersion:SCHEMA_VERSION,updatedAt:raw.updatedAt||null,buckets:raw.buckets,
    recentEventIds:Array.isArray(raw.recentEventIds)?raw.recentEventIds.map(String).slice(-EVENT_ID_LIMIT):[]};
}
function bucketCandidates(p){return[
  {basis:'exact',min:3,key:'exact|'+p.targetKey+'|'+p.sourceKey+'|'+p.horizonKey+'|'+p.rowBucket},
  {basis:'horizon',min:3,key:'horizon|'+p.targetKey+'|'+p.sourceKey+'|'+p.horizonKey},
  {basis:'volume',min:5,key:'volume|'+p.targetKey+'|'+p.sourceKey+'|'+p.rowBucket},
  {basis:'target',min:6,key:'target|'+p.targetKey+'|'+p.sourceKey},
];}
function median(values){const s=values.slice().sort((a,b)=>a-b),n=s.length;if(!n)return 0;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;}
function quantile(values,q){
  const s=values.slice().sort((a,b)=>a-b);if(!s.length)return 0;if(s.length===1)return s[0];
  const pos=(s.length-1)*Math.max(0,Math.min(1,Number(q)||0)),lo=Math.floor(pos),hi=Math.ceil(pos),f=pos-lo;
  return s[lo]+(s[hi]-s[lo])*f;
}
function robustDurations(samples){
  const values=(Array.isArray(samples)?samples:[]).map(x=>Number(x&&x.ms)).filter(n=>Number.isFinite(n)&&n>=500&&n<=1800000);
  if(values.length<7)return values;
  const mid=median(values),mad=median(values.map(n=>Math.abs(n-mid)));
  if(mad<=0)return values.filter(n=>n<=Math.max(mid*3,mid+30000));
  const limit=3.5*1.4826*mad,filtered=values.filter(n=>Math.abs(n-mid)<=limit);
  return filtered.length>=Math.max(3,Math.ceil(values.length*.55))?filtered:values;
}
function statsForBucket(bucket){
  const values=robustDurations(bucket&&bucket.samples);if(!values.length)return null;
  const lowMs=Math.round(quantile(values,.5)),highMs=Math.max(lowMs,Math.round(quantile(values,.8)));
  return{sampleCount:values.length,lowMs,highMs,estimateMs:Math.max(lowMs,Math.round(quantile(values,.65)))};
}
function estimateFromSummary(rawSummary,rawProfile){
  const summary=normalizeSummary(rawSummary),profile=rawProfile&&rawProfile.targetKey?rawProfile:buildRefreshProfile(rawProfile);let learning=null;
  for(const c of bucketCandidates(profile)){
    const stats=statsForBucket(summary.buckets[c.key]);if(!stats)continue;
    const base={available:false,basis:c.basis,sampleCount:stats.sampleCount,neededSamples:c.min,
      scope:{targets:profile.targets,rowBucket:profile.rowBucket,horizonDensity:profile.horizonDensity}};
    if(!learning||base.sampleCount>learning.sampleCount)learning=base;
    if(stats.sampleCount<c.min)continue;
    return{available:true,basis:c.basis,confidence:stats.sampleCount>=15?'high':stats.sampleCount>=7?'medium':'low',
      ...stats,scope:base.scope};
  }
  return learning||{available:false,basis:'none',sampleCount:0,neededSamples:3,
    scope:{targets:profile.targets,rowBucket:profile.rowBucket,horizonDensity:profile.horizonDensity}};
}
function appendBucket(summary,key,basis,event){
  const prev=summary.buckets[key]&&typeof summary.buckets[key]==='object'?summary.buckets[key]:{};
  const samples=Array.isArray(prev.samples)?prev.samples.slice(-SAMPLE_LIMIT+1):[];
  samples.push({ms:Math.round(Number(event.durationMs)||0),at:event.finishedAt||event.at});
  summary.buckets[key]={basis,count:Math.max(0,Number(prev.count)||0)+1,updatedAt:event.finishedAt||event.at,samples};
}
function pruneBuckets(summary){
  const entries=Object.entries(summary.buckets||{});if(entries.length<=BUCKET_LIMIT)return;
  entries.sort((a,b)=>String(b[1]&&b[1].updatedAt||'').localeCompare(String(a[1]&&a[1].updatedAt||'')));
  summary.buckets=Object.fromEntries(entries.slice(0,BUCKET_LIMIT));
}
function updateSummary(rawSummary,event){
  const summary=normalizeSummary(rawSummary),eventId=String(event&&event.eventId||'').trim();
  if(eventId&&summary.recentEventIds.includes(eventId))return summary;
  if(!event||event.status!=='done'||!event.profile||!Number.isFinite(Number(event.durationMs))||Number(event.durationMs)<500)return summary;
  const profile=event.profile.targetKey?event.profile:buildRefreshProfile(event.profile);
  for(const c of bucketCandidates(profile))appendBucket(summary,c.key,c.basis,event);
  if(eventId)summary.recentEventIds=[...summary.recentEventIds,eventId].slice(-EVENT_ID_LIMIT);
  summary.updatedAt=event.finishedAt||event.at||new Date().toISOString();pruneBuckets(summary);return summary;
}
async function readJson(file){try{return JSON.parse(await fsp.readFile(file,'utf8'));}catch(_){return null;}}
async function atomicJson(file,value){
  await fsp.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+process.pid+'.'+Date.now()+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
  try{
    const h=await fsp.open(tmp,'wx',0o600);
    try{await h.writeFile(JSON.stringify(value,null,2),'utf8');try{await h.sync();}catch(_){}}
    finally{await h.close();}
    await replaceFileWithRetry(tmp,file);
  }finally{await fsp.rm(tmp,{force:true}).catch(()=>{});}
}
function stampMonth(date=new Date()){return date.toISOString().slice(0,7);}
function safeSharedArea(checked){
  const root=path.resolve(checked.root),namespace=String(checked.manifest&&checked.manifest.layout&&checked.manifest.layout.sync||'BUYER_LOG_SYNC');
  const area=path.resolve(root,namespace,'performance','refresh'),relative=path.relative(root,area);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Refresh performance Shared Hub yolu geçersiz.'),{code:'REFRESH_PERFORMANCE_PATH_INVALID'});
  return area;
}
function createRefreshPerformance({syncSettings,sharedHub,localDb,localDataRoot,appVersion='',onError=null}={}){
  if(!syncSettings||!sharedHub||!localDb||!localDataRoot)throw new Error('Refresh performance dependencies are required.');
  const localRoot=path.join(localDataRoot,'refresh-performance'),localSummaryFile=path.join(localRoot,'summary-v1.json');
  let cachedSummary=normalizeSummary((()=>{try{return JSON.parse(fs.readFileSync(localSummaryFile,'utf8'));}catch(_){return null;}})());
  const deviceId=String(typeof localDb.getDeviceId==='function'?localDb.getDeviceId():crypto.randomUUID()),deviceHash=digest(deviceId).slice(0,20);
  let sharedRefreshInFlight=null;const report=(stage,error)=>{if(typeof onError==='function')onError(stage,error);};
  function estimate(profile){return estimateFromSummary(cachedSummary,profile);}
  async function checkedRoot(requireWrite=false){
    const settings=await syncSettings.read();if(!settings.sharedSyncRoot)return null;
    return sharedHub.validate(settings.sharedSyncRoot,{requireWrite});
  }
  async function persistLocalSummary(){try{await atomicJson(localSummaryFile,cachedSummary);}catch(error){report('local-summary',error);}}
  async function appendLocalEvent(event){
    const file=path.join(localRoot,'history',stampMonth(new Date(event.at))+'.jsonl');
    await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.appendFile(file,JSON.stringify(event)+'\n','utf8');
  }
  async function refreshSharedCache(){
    if(sharedRefreshInFlight)return sharedRefreshInFlight;
    sharedRefreshInFlight=(async()=>{
      const checked=await checkedRoot(false);if(!checked)return{configured:false};
      const shared=normalizeSummary(await readJson(path.join(safeSharedArea(checked),'summary-v1.json')));
      if(shared.updatedAt||Object.keys(shared.buckets).length){cachedSummary=shared;await persistLocalSummary();}
      return{configured:true,updatedAt:cachedSummary.updatedAt};
    })().catch(error=>{report('shared-read',error);return{configured:true,error:String(error&&error.message||error)};})
      .finally(()=>{sharedRefreshInFlight=null;});
    return sharedRefreshInFlight;
  }
  async function record(input={}){
    const at=input.finishedAt||new Date().toISOString();
    const event={schemaVersion:SCHEMA_VERSION,eventId:String(input.eventId||crypto.randomUUID()),at,startedAt:input.startedAt||null,
      finishedAt:input.finishedAt||at,durationMs:Math.max(0,Math.round(Number(input.durationMs)||0)),
      status:['done','cancelled','error'].includes(input.status)?input.status:'error',appVersion:String(appVersion||'').slice(0,40),
      profile:input.profile&&input.profile.targetKey?input.profile:buildRefreshProfile(input.profile)};
    try{await appendLocalEvent(event);}catch(error){report('local-history',error);}
    if(event.status==='done'){cachedSummary=updateSummary(cachedSummary,event);await persistLocalSummary();}
    try{
      const checked=await checkedRoot(true);if(!checked)return{configured:false,event};
      const area=safeSharedArea(checked);await fsp.mkdir(area,{recursive:true});
      await fsp.appendFile(path.join(area,'device-'+deviceHash+'-'+stampMonth(new Date(event.at))+'.jsonl'),JSON.stringify(event)+'\n','utf8');
      if(event.status==='done'){
        const summaryFile=path.join(area,'summary-v1.json');
        const shared=await withFileLeaseAsync(summaryFile,async()=>{
          const next=updateSummary(await readJson(summaryFile),event);await atomicJson(summaryFile,next);return next;
        });
        cachedSummary=normalizeSummary(shared);await persistLocalSummary();
      }
      return{configured:true,event};
    }catch(error){report('shared-write',error);return{configured:true,event,error:String(error&&error.message||error)};}
  }
  return{buildProfile:buildRefreshProfile,estimate,record,refreshSharedCache,cachedSummary:()=>cachedSummary};
}
module.exports={SCHEMA_VERSION,buildRefreshProfile,rowBucketFor,estimateFromSummary,updateSummary,robustDurations,createRefreshPerformance};
