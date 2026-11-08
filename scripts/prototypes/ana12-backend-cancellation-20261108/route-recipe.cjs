'use strict';
// Exact edits, applied only in memory. This module never writes a production file.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const readService='resources/app/server/lib/compute-read-service.js',server='resources/app/server/server.js';
const edits=[
 {file:readService,old:"'use strict';",next:"'use strict';\nconst {createBacklogComputeLifecycle}=require('./backlog-compute-lifecycle');"},
 {file:readService,old:'ttlMs=60000,now=Date.now})',next:'ttlMs=60000,now=Date.now,onLifecycleEvent})'},
 {file:readService,old:'  const flights=new Map(),cache=new Map();let cachedBytes=0,epoch=0;',next:`  const flights=new Map(),cache=new Map();let cachedBytes=0,epoch=0;
  const backlogLifecycle=createBacklogComputeLifecycle({onEvent:onLifecycleEvent});
  function runBacklog(req,area,task,keyParts,options){
    const captured=guard.capture(req,area),key=JSON.stringify([captured.key,task,keyParts]),cacheEpoch=epoch;
    let cacheHit=false;
    return backlogLifecycle.subscribe({req,res:options.response,captured,task,parts:keyParts,
      build:async context=>{
        context.assertCurrent();prune();
        const entry=cache.get(key);
        if(entry){
          cacheHit=true;cache.delete(key);cache.set(key,entry);entry.refs++;
          let released=false;
          return {value:entry.lease.value,metrics:entry.lease.metrics,release(){if(released)return;released=true;entry.refs--;releaseEntry(entry);}};
        }
        const source=await sourceFor(captured.profile);context.assertCurrent();
        const params=await paramsFor(captured.profile,source,task,{...context.parts,...options.payload});context.assertCurrent();
        await new Promise(setImmediate);context.assertCurrent();
        // The flight owns this signal; an individual HTTP request never owns it.
        return compute.run(task,source,params,{...options.computeOptions,signal:context.signal});
      },
      publish:lease=>{
        if(cacheHit||options.cache===false||cacheEpoch!==epoch){lease.release();return;}
        const entry={refs:0,bytes:lease.metrics.outputBytes||0,released:false,epoch:cacheEpoch,lease};
        cacheEntry(key,entry);releaseEntry(entry);
      }
    }).promise;
  }`},
 {file:readService,old:'  async function run(req,area,task,keyParts={},options={}){',next:`  async function run(req,area,task,keyParts={},options={}){
    if(area==='backlog'&&options.response)return runBacklog(req,area,task,keyParts,options);`},
 {file:readService,old:'  return {run,clear,stats};',next:'  return {run,clear,stats,revalidateBacklog:backlogLifecycle.revalidate,disposeBacklog:backlogLifecycle.dispose};'},
 {file:readService,old:'inFlight:flights.size,maxBytes',next:'inFlight:flights.size+backlogLifecycle.inFlight,maxBytes'},
 {file:server,old:"const liveEvents = require('./lib/live-events');",next:"const liveEvents = require('./lib/live-events');\nlet revalidateBacklogCompute=()=>{};"},
 {file:server,old:"onIamApplied: () => liveEvents.notifyChange('iam', null),",next:"onIamApplied: () => { revalidateBacklogCompute(); liveEvents.notifyChange('iam', null); },"},
 {file:server,old:'function rememberComputeSource(id,runtime,descriptor){publishedComputeSources.set(id,{key:projectionSourceRevision(runtime),descriptor});}',next:'function rememberComputeSource(id,runtime,descriptor){publishedComputeSources.set(id,{key:projectionSourceRevision(runtime),descriptor});revalidateBacklogCompute();}'},
 {file:server,old:'paramsFor:computeParamsFor});',next:'paramsFor:computeParamsFor});\nrevalidateBacklogCompute=computeReads.revalidateBacklog;'},
 {file:server,old:'httpServer.close();computeReads.clear();',next:'httpServer.close();computeReads.disposeBacklog();computeReads.clear();'},
];
// Attach after existing shared preparation. subscribe detects a socket that closed
// while preparation was pending, and never submits its analytical job.
const routeEdits=[
 ["app.get('/api/backlog',", "{options,pageCache:{hit:false}});", "{options,pageCache:{hit:false}},{response:res});"],
 ["app.get('/api/backlog-source-columns',", "'backlog-source-columns',{});", "'backlog-source-columns',{},{response:res});"],
 ["app.get('/api/backlog-export',", "{cache:json});", "{cache:json,response:res});"],
 ["app.get('/api/backlog-filter-values',", "field:String(req.query.field||'')});", "field:String(req.query.field||'')},{response:res});"],
 ["app.post('/api/backlog-map-details',", "includeSourceDetails:true});", "includeSourceDetails:true},{response:res});"],
];
function replaceOnce(source,old,next){
 const at=source.indexOf(old);if(at<0||source.indexOf(old,at+old.length)!==-1)throw Error('Exact edit anchor is missing or ambiguous: '+old);
 return source.slice(0,at)+next+source.slice(at+old.length);
}
function materialize(){
 const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'source-pins.json'),'utf8'));
 for(const [file,hash] of Object.entries(pins.sha256)){
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==hash)throw Error('Pinned source drift: '+file);
 }
 const sources={};for(const file of [readService,server])sources[file]=fs.readFileSync(path.join(root,file),'utf8');
 for(const edit of edits)sources[edit.file]=replaceOnce(sources[edit.file],edit.old,edit.next);
 for(const [anchor,old,next] of routeEdits){
  const begin=sources[server].indexOf(anchor),end=sources[server].indexOf('\n});',begin);
  if(begin<0||end<begin)throw Error('Route anchor missing: '+anchor);
  sources[server]=sources[server].slice(0,begin)+replaceOnce(sources[server].slice(begin,end),old,next)+sources[server].slice(end);
 }
 return sources;
}
if(require.main===module){
 // Machine-readable edits; render their unified diff with render-recipe.py.
 const sources=materialize();console.log(JSON.stringify({pins:require('./source-pins.json'),edits,routeEdits,validatedTargets:Object.keys(sources)},null,2));
}
module.exports={materialize,root,readService,server};
