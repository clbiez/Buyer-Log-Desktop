'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {createComputeReadGuard}=require('../server/lib/compute-read-guard');
const {sendComputedResponse}=require('../server/lib/compute-response');
const {createProjectionShadowRouter}=require('../server/lib/projection-shadow-http');
const source=require('./helpers/server-source')();
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
async function fixture(t){
 const f={profile:{id:'actor',status:'ACTIVE',areas:['cp','orders'],access:'access-1'},source:'source-1',cacheCurrent:true,available:true,jobs:[],acquires:[],releases:0,fullReleases:0};
 const buffer=zlib.gzipSync(Buffer.from('{"rows":[]}'));
 f.manifest={activeGeneration:'page-g1',contextHash:'cache-context',sourceRevisionKey:'source-r1',moduleInputKeys:{cp:'cp-i1',orders:'orders-i1'},
  sourceProjectionKeys:{cp:'cp-s1',orders:'orders-s1'},modules:{cp:{checksum:sha(buffer),uncompressedBytes:11},orders:{checksum:sha(buffer),uncompressedBytes:11}}};
 const guard=createComputeReadGuard({sessionProfile:()=>f.profile,profileById:()=>f.profile,hasArea:(profile,area)=>profile.areas.includes(area),
  contextFor:()=>({contextHash:'live-context'}),accessFor:profile=>({accessHash:profile.access}),sourceTokenFor:()=>f.source});
 const app=express();app.use(express.json({limit:'64kb'}));
 app.use('/api/page-projection',createProjectionShadowRouter({express,guard,secret:Buffer.alloc(32,17),assertSourceFilters(){if(f.filtersMissing)throw Object.assign(Error('filters missing'),{code:'SOURCE_FILTER_REQUIRED',statusCode:409});},
  contextFor:()=>({id:'owner',contextHash:'cache-context'}),
  projectionFor:async(_req,module,options)=>{f.acquires.push({module,...options});await f.beforeAcquire?.();return f.available?{value:{buffer},manifest:f.manifest,assertResponse(){},release(){f.fullReleases++;}}:null;},
  assertProjectionCurrent(_owner,_module,manifest){if(!f.cacheCurrent||manifest!==f.manifest)throw Object.assign(Error('stale'),{code:'PROJECTION_VIEW_STALE',statusCode:409});},
  runTask:async(_req,module,task,key,params)=>{f.jobs.push({module,task,key,params});await f.beforeWorker?.();return {value:{buffer:zlib.gzipSync(JSON.stringify({token:params.token,task})),uncompressedBytes:1},
   assertResponse(){},release(){f.releases++;}};},send:sendComputedResponse,
  apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code||'TEST_ERROR',error:error.message,errorEn:error.errorEn})}));
 app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.type||'ERROR'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 f.post=async(module,kind,body)=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/page-projection/${module}/${kind}`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
 f.view=module=>f.post(module||'cp','shadow',{requestGeneration:'request-1'});
 return f;
}
test('source wires the bounded parser before the broad parser and installs shadow routes beside the full projection route',()=>{
 const narrow=source.indexOf("app.use('/api/page-projection', express.json({ limit: '64kb' }));");
 assert.ok(narrow>0);assert.ok(narrow<source.indexOf("app.use(express.json({ limit: '100mb' }));"));
 assert.ok(source.includes("require('./lib/projection-shadow-http').createProjectionShadowRouter"));
 assert.ok(source.includes("app.get('/api/page-projection/:module'"));
});
test('native HTTP request uses current guards, a private owner/actor token and compressed worker output',async t=>{
 const f=await fixture(t),result=await f.view();assert.equal(result.status,200);assert.equal(f.jobs.length,1);
 assert.deepEqual(f.acquires,[{module:'cp',build:true}]);assert.equal(f.jobs[0].task,'projection-private-view');
 const token=result.body.token;assert.equal(token.ownerId,'owner');assert.equal(token.actorId,'actor');assert.equal(token.module,'cp');
 assert.equal(token.contextHash,'live-context');assert.equal(token.accessHash,'access-1');assert.equal(token.planRevision,'cp-orders-full-shadow-v1');
 assert.equal(token.sourceRevision,sha(JSON.stringify(['source-r1',f.manifest.modules.cp.checksum])));
 assert.equal(f.releases,1);assert.equal(f.fullReleases,1);
});
test('missing session, forbidden area, unknown module and missing source filters admit no worker',async t=>{
 const f=await fixture(t);f.profile=null;assert.equal((await f.view()).status,401);
 f.profile={id:'actor',status:'ACTIVE',areas:[],access:'access-1'};assert.equal((await f.view()).status,403);
 assert.equal((await f.view('unknown')).status,404);f.profile.areas=['cp'];f.filtersMissing=true;assert.equal((await f.view()).status,409);
 assert.equal(f.jobs.length,0);assert.equal(f.acquires.length,0);
});
test('native64KiB body bound rejects before projection acquisition and worker admission',async t=>{
 const f=await fixture(t),result=await f.post('cp','shadow',{requestGeneration:'x'.repeat(70*1024)});
 assert.equal(result.status,413);assert.equal(f.acquires.length,0);assert.equal(f.jobs.length,0);
});
test('details never rebuild a missing generation and changed source/access/actor/plan token cannot borrow current rows',async t=>{
 const f=await fixture(t),view=await f.view(),base={token:view.body.token,records:[{ordinal:0,handle:'A'.repeat(32)}],maxBytes:4096};
 for(const key of Object.keys(base.token)){
  const changed={...base,token:{...base.token,[key]:base.token[key]+'-changed'}};
  const result=await f.post('cp','details',changed);
  // requestGeneration belongs to the individual request, so a same-context
  // request may choose it. The signed worker handle remains the final binding.
  if(key==='requestGeneration')assert.equal(result.status,200);else assert.equal(result.status,409,key);
 }
 const count=f.jobs.length;f.available=false;assert.equal((await f.post('cp','details',base)).status,409);
 assert.equal(f.jobs.length,count);assert.ok(f.acquires.slice(1).every(x=>x.build===false));
});
test('rewritten bytes inside one generation invalidate the earlier detail token',async t=>{
 const f=await fixture(t),view=await f.view();f.manifest.modules.cp.checksum='1'.repeat(64);
 const result=await f.post('cp','details',{token:view.body.token,records:[{ordinal:0,handle:'A'.repeat(32)}],maxBytes:4096});
 assert.equal(result.status,409);assert.equal(f.jobs.length,1);
});
test('permission revocation while projection read awaits rejects before a worker can start',async t=>{
 const f=await fixture(t),gate=deferred(),started=deferred();f.beforeAcquire=async()=>{started.resolve();await gate.promise;};
 const pending=f.view();await started.promise;f.profile.areas=[];gate.resolve();const result=await pending;
 assert.equal(result.status,403);assert.equal(f.jobs.length,0);assert.equal(f.fullReleases,1);
});
test('source supersession or permission revoke while worker awaits rejects and releases unpublished output',async t=>{
 for(const change of [f=>{f.source='source-2';},f=>{f.profile.areas=[];},f=>{f.cacheCurrent=false;}]){
  const f=await fixture(t),gate=deferred(),started=deferred();f.beforeWorker=async()=>{started.resolve();await gate.promise;};
  const pending=f.view();await started.promise;change(f);gate.resolve();const result=await pending;
  assert.ok([403,409].includes(result.status));assert.equal(result.body.token,undefined);assert.equal(f.releases,1);assert.equal(f.fullReleases,1);
 }
});
