'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),zlib=require('node:zlib');
const source=require('./helpers/server-source')(),{extractFunction}=require('./helpers/app-main-functions');
const definitions=[['get','/api/oab/seasons','seasons',{}],['post','/api/oab/mag','mag',{seasonRef:'DEMO-SEASON'}],['post','/api/oab/buyer-groups','buyer-groups',{merchSubGroupRef:'DEMO-MAG'}]];
const metadata={schemaVersion:1,reportRef:'OrderBudget_List_Report',generatedAt:'2026-11-05T00:00:00Z',counts:{seasons:1,uniqueMags:1,uniqueBuyerGroups:1},source:'bundled-json'};
function fixture({afterWorker,beforeHeaders}={}){
 const profile={id:'synthetic-oab-viewer',status:'ACTIVE',enabled:true},state={session:true,area:true,capability:true},routes=new Map(),calls=[];let released=0;
 const response=operation=>({ok:true,[operation==='buyer-groups'?'buyerGroups':operation]:[{ref:'DEMO',Name:'DEMO'}],fromCache:true,source:'bundled-json',fetchedAt:metadata.generatedAt,metadata});
 const forbidden=()=>{throw Error('Bundled metadata must not load or index on the server main thread');};
 const c={Object,String,Error,Promise,Buffer,
  app:{get:(p,...h)=>routes.set(p,h.at(-1)),post:(p,...h)=>routes.set(p,h.at(-1))},express:{json:()=>()=>{}},
  userAccess:{requireAnyArea:()=>()=>{},requireCapability:()=>()=>{},sessionProfile:()=>state.session?profile:null,profileById:()=>profile,hasArea:()=>state.area,hasCapability:()=>state.capability},
  oabStaticMetadata:{getSeasons:forbidden,getMag:forbidden,getBuyerGroups:forbidden,getInfo:forbidden},
  serverCompute:()=>({runOabMetadata:async(owner,operation,ref,options)=>{
   assert.equal(owner,profile.id);options.assertCurrent();calls.push({operation,ref});await Promise.resolve();afterWorker?.(state,profile);
   return {value:{buffer:zlib.gzipSync(JSON.stringify(response(operation)))},release(){released++;}};
  }}),
  sendComputedResponse(req,res,lease){try{beforeHeaders?.(state,profile);lease.assertResponse();res.body=JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.buffer)));res.statusCode=200;return res;}finally{lease.release();}},
  automationError(res,error){res.statusCode=error.statusCode||500;res.error=error;return res;}
 };
 vm.createContext(c);
 for(const name of ['assertOabCurrentAccess','assertOabMetadataRequest','computedOabMetadataForRequest']){
  if(new RegExp('function '+name+'\\(').test(source))vm.runInContext(extractFunction(source,name),c);
 }
 const start=source.indexOf("app.get('/api/oab/seasons'"),end=source.indexOf('// OAB verisi:',start);assert.ok(start>=0&&end>start);
 vm.runInContext(source.slice(start,end),c);
 return {state,profile,calls,response,released:()=>released,request:async(path,body={})=>{
  const res={statusCode:200,status(code){this.statusCode=code;return this;},set(){return this;},json(value){this.body=value;return this;}};
  await routes.get(path)({currentUser:profile,body},res);return res;
 }};
}
test('all three OAB filter routes return the existing bundled response without reading metadata on main',async()=>{
 for(const [,path,operation,body] of definitions){const f=fixture(),res=await f.request(path,body);assert.equal(res.statusCode,200,res.error?.message);assert.deepEqual(res.body,f.response(operation));assert.equal(f.calls.length,1);assert.equal(f.calls[0].operation,operation);assert.equal(f.released(),1);}
});
for(const phase of ['afterWorker','beforeHeaders'])for(const mode of ['logout','disabled','area','capability']){
 test(`OAB ${mode} during ${phase} cannot publish a completed worker result`,async()=>{
  const deny=(state,profile)=>{if(mode==='logout')state.session=false;else if(mode==='disabled')profile.enabled=false;else state[mode]=false;};
  const f=fixture({[phase]:deny}),res=await f.request('/api/oab/seasons');assert.ok([401,403].includes(res.statusCode));assert.equal(res.body,undefined);assert.ok(['USER_LOGIN_REQUIRED','OAB_ACCESS_REVOKED'].includes(res.error?.code));assert.equal(f.released(),1);
 });
}
test('missing OAB refs retain 400 codes and do not admit metadata work',async()=>{
 for(const [path,code] of [['/api/oab/mag','OAB_SEASON_REQUIRED'],['/api/oab/buyer-groups','OAB_MAG_REQUIRED']])for(const ref of [null,'']){
  const f=fixture(),res=await f.request(path,{seasonRef:ref,merchSubGroupRef:ref});assert.equal(res.statusCode,400);assert.equal(res.body.code,code);assert.equal(f.calls.length,0);assert.equal(f.released(),0);
 }
});
test('OAB access revoked during metadata work has both Turkish and English error text',async()=>{
 const f=fixture({afterWorker:state=>{state.capability=false;}}),res=await f.request('/api/oab/seasons');
 assert.equal(res.error.code,'OAB_ACCESS_REVOKED');assert.match(res.error.message,/erişim|yetki/u);assert.match(res.error.message,/access|permission/i);
});
