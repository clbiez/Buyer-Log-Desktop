'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server/server.js'),'utf8'),metadata=require('../server/lib/oab-static-metadata');
function setup(options={}){
 const routes=new Map(),guards=[];
 const state={profile:{id:'demo',enabled:true,status:'ACTIVE'},area:true,capability:true};
 const context={app:{get:(url,...handlers)=>routes.set(url,handlers),post:(url,...handlers)=>routes.set(url,handlers)},
  userAccess:{requireAnyArea:area=>{guards.push(['area',area]);return 'area-guard';},requireCapability:cap=>{guards.push(['capability',cap]);return 'capability-guard';},sessionProfile:()=>state.profile,hasArea:()=>state.area,hasCapability:()=>state.capability},
  express:{json:()=> 'json-parser'},oabStaticMetadata:options.metadata||metadata,
  computedOabMetadataForRequest:()=>{throw Error('B3: unchanged bundled metadata must not make a worker round trip');},
  sendComputedResponse:()=>{throw Error('B3: the local metadata route must return its canonical object');},
  automationError:(res,error)=>res.status(error.statusCode||500).json({error:error.message,errorEn:error.errorEn,code:error.code})};
 const routeStart=source.indexOf("app.get('/api/oab/seasons'"),helperStart=source.indexOf('async function oabMetadataSnapshotForRequest('),start=helperStart>=0?helperStart:routeStart,end=source.indexOf('// OAB verisi: rapor',routeStart);
 assert.ok(start>=0&&end>start);vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {routes,guards,state};
}
async function request(f,url,body={}){
 const res={code:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
 await f.routes.get(url).at(-1)({body,currentUser:{id:'demo'}},res);return res;
}
test('bundled OAB routes retain area/capability gates and exact payloads without a worker trip',async()=>{
 const f=setup(),seasonRef=metadata.getSeasons()[0].SeasonRef,merchSubGroupRef=metadata.getMag(seasonRef)[0].MerchSubGroupRef;
 assert.deepEqual(f.guards,[['area','overview'],['capability','OAB.VIEW'],['area','overview'],['capability','OAB.VIEW'],['area','overview'],['capability','OAB.VIEW']]);
 for(const [url,key,body,rows] of [
  ['/api/oab/seasons','seasons',{},metadata.getSeasons()],
  ['/api/oab/mag','mag',{seasonRef},metadata.getMag(seasonRef)],
  ['/api/oab/mag','mag',{seasonRef:'unknown-demo-reference'},[]],
  ['/api/oab/buyer-groups','buyerGroups',{merchSubGroupRef},metadata.getBuyerGroups(merchSubGroupRef)],
  ['/api/oab/buyer-groups','buyerGroups',{merchSubGroupRef:'unknown-demo-reference'},[]]]){
  const result=await request(f,url,body),info=metadata.getInfo();assert.equal(result.code,200);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.equal(JSON.stringify(result.value),JSON.stringify({ok:true,[key]:rows,fromCache:true,source:'bundled-json',fetchedAt:info.generatedAt,metadata:info}));
  assert.deepEqual(f.routes.get(url).slice(0,2),['area-guard','capability-guard']);
 }
});
test('bundled OAB routes preserve required-reference validation before any metadata read',async()=>{
 const f=setup();
 for(const [url,code] of [['/api/oab/mag','OAB_SEASON_REQUIRED'],['/api/oab/buyer-groups','OAB_MAG_REQUIRED']]){
  for(const ref of [undefined,null,'']){
   const result=await request(f,url,url.endsWith('/mag')?{seasonRef:ref}:{merchSubGroupRef:ref});assert.equal(result.code,400);assert.equal(result.value.code,code);
  }
 }
});

test('async metadata reads recheck the actual session, active profile, area and capability before sending',async()=>{
 for(const [url,body] of [['/api/oab/seasons',{}],['/api/oab/mag',{seasonRef:1}],['/api/oab/buyer-groups',{merchSubGroupRef:2}]]){
  for(const mutate of [s=>s.profile=null,s=>s.profile={...s.profile,id:'other'},s=>s.profile.enabled=false,s=>s.profile.status='DISABLED',s=>s.area=false,s=>s.capability=false]){
   let release,reads=0;const gate=new Promise(r=>release=r),snapshot=metadata._load();
   const f=setup({metadata:{...metadata,getSnapshotAsync:async()=>{reads++;await gate;return snapshot;}}});
   const pending=request(f,url,body);await new Promise(setImmediate);
   try{assert.equal(reads,1,'every valid route awaits the nonblocking source');mutate(f.state);}
   finally{release();}
   const result=await pending;assert.ok([401,403].includes(result.code));assert.ok(result.value.errorEn);assert.equal(result.value.ok,undefined);
  }
 }
});
