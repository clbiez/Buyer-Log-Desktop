'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server/server.js'),'utf8'),metadata=require('../server/lib/oab-static-metadata');
function setup(){
 const routes=new Map(),guards=[];
 const context={app:{get:(url,...handlers)=>routes.set(url,handlers),post:(url,...handlers)=>routes.set(url,handlers)},
  userAccess:{requireAnyArea:area=>{guards.push(['area',area]);return 'area-guard';},requireCapability:cap=>{guards.push(['capability',cap]);return 'capability-guard';}},
  express:{json:()=> 'json-parser'},oabStaticMetadata:metadata,
  computedOabMetadataForRequest:()=>{throw Error('B3: unchanged bundled metadata must not make a worker round trip');},
  sendComputedResponse:()=>{throw Error('B3: the local metadata route must return its canonical object');},
  automationError:(res,error)=>res.status(500).json({error:error.message})};
 const start=source.indexOf("app.get('/api/oab/seasons'"),end=source.indexOf('// OAB verisi: rapor',start);
 assert.ok(start>=0&&end>start);vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {routes,guards};
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
