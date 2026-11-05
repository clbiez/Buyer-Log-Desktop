'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'collection-lfl-persistence-tests-'));
for(const [key,folder] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp',BUYER_LOG_CONFIG_PATH:'config.json'}))process.env[key]=path.join(testRoot,folder);
test.after(()=>fs.rmSync(testRoot,{recursive:true,force:true}));
const {createReferenceCache}=require('../server/lib/collection-lfl-reference');
const {loadFromModelConnections}=require('../server/lib/model-refresh');
const order=(patch={})=>({orderCode:'DEMO-1',season:'S6',mag:'CU4E',classification:'K',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA',...patch});
function temporary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collection-reference-persist-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}

test('refreshing only CP leaves the LFL payload absent so the published source snapshot is preserved',async()=>{
 const result=await loadFromModelConnections([],{targets:['cp'],includeAsas:false,includeLfl:false,includeAntrepo:false,presetAsasOrdersByTarget:{cp:[]}});
 assert.equal(result.lflRows,null);
 assert.equal(result.lflMeta,null);
});

test('references survive source revisions and process restarts until an explicit refresh',async t=>{
 const directory=temporary(t),cache=createReferenceCache({directory});let loads=0;
 const args={identity:'buyer-scope',version:'v1',loadRows:async()=>{loads++;return [order()];}};
 const saved=await cache.get(args);
 const later={...args,version:'v2',loadRows:()=>{throw Error('source is unavailable');}};
 assert.deepEqual(await cache.get(later),saved);
 assert.deepEqual(await createReferenceCache({directory}).get(later),saved);
 const updated=await cache.get({...args,version:'v2',rebuild:true,loadRows:()=>[order({fob:20})]});
 assert.equal(updated.references[0].average,20);assert.equal(updated.version,'v2');assert.equal(loads,1);
 assert.equal((await createReferenceCache({directory}).read({identity:args.identity})).references[0].average,20);
 assert.equal(await cache.read({identity:'different-buyer-or-scope'}),null);
});

test('empty, incomplete and failed refreshes never replace the last saved references',async t=>{
 const directory=temporary(t),cache=createReferenceCache({directory});
 const args={identity:'buyer',version:'v1',loadRows:()=>[order(),order({inStoreMonth:'2026-03'})]};
 const saved=await cache.get(args);
 for(const rows of [[],[order()]]){
  await assert.rejects(cache.get({...args,version:'v2',rebuild:true,loadRows:()=>rows}),error=>error.code==='LFL_REFERENCE_INCOMPLETE');
  assert.deepEqual(await createReferenceCache({directory}).read({identity:args.identity}),saved);
 }
 await assert.rejects(cache.get({...args,rebuild:true,loadRows:()=>{throw Error('parse failed');}}),/parse failed/);
 assert.deepEqual(await cache.read({identity:args.identity}),saved);
});

test('an empty initial read is not persisted and cannot prevent later source recovery',async t=>{
 const directory=temporary(t),cache=createReferenceCache({directory});
 const args={identity:'buyer',version:'v1',loadRows:()=>[]};
 assert.deepEqual((await cache.get(args)).references,[]);
 assert.equal(await cache.read({identity:args.identity}),null);
 assert.equal((await cache.get({...args,loadRows:()=>[order()]})).references[0].average,10);
});

test('a failed durable write is reported and leaves the previous reference available',async t=>{
 const directory=temporary(t),cache=createReferenceCache({directory});
 const args={identity:'buyer',version:'v1',loadRows:()=>[order()]};
 const saved=await cache.get(args),file=path.join(directory,fs.readdirSync(directory)[0]);
 fs.renameSync(file,file+'.saved');fs.mkdirSync(file);
 await assert.rejects(cache.get({...args,rebuild:true,version:'v2',loadRows:()=>[order({fob:20})]}));
 assert.deepEqual(await cache.read({identity:args.identity}),saved);
 fs.rmdirSync(file);fs.renameSync(file+'.saved',file);
 assert.deepEqual(await createReferenceCache({directory}).read({identity:args.identity}),saved);
});

test('saved endpoint references are readable without a loaded source, and remain isolated by access scope',async t=>{
 const directory=temporary(t),routes=new Map(),runtime={lflLoadedAt:'v1',lflRows:[order()]};let ready=true,loads=0,iamRevision=1;
 require('../server/routes/lfl-routes')({get:(url,...handlers)=>routes.set(url,handlers),post(){}},{
  collectionLflCache:createReferenceCache({directory}),sourceUserId:()=> 'buyer',cacheForUser:()=>runtime,
  sourceFilterReadiness:()=>({ready}),ensureDataLoaded:async()=>{loads++;},
  userAccess:{requireArea:()=>()=>{},publicProfile:user=>user,localIamRevision:()=>iamRevision,filterRowsByScope:(_user,rows)=>rows},
  sendDateSafeJson:(res,data)=>res.json(data),apiError:(res,error)=>res.status(error.statusCode||500).json({code:error.code}),
 });
 const handler=routes.get('/api/collection-lfl-reference').at(-1);
 async function request(query={},user={id:'buyer',scopes:{mags:['CU4E']}}){
  const res={code:200,set(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler({query,currentUser:user},res);return res;
 }
 const saved=await request();assert.equal(saved.data.references[0].average,10);
 runtime.lflRows=[];runtime.lflLoadedAt=null;ready=false;iamRevision++;
 assert.deepEqual((await request()).data,saved.data);assert.equal(loads,0);
 assert.equal((await request({rebuild:'1'})).code,409);
 assert.equal((await request({}, {id:'buyer',scopes:{mags:['OTHER']}})).code,409);
 assert.deepEqual((await request()).data,saved.data,'a failed refresh or another scope cannot clear the saved result');
});

test('LFL upload saves source rows before publishing them and retains old rows on a write failure',async()=>{
 const routes=new Map(),runtime={loadedAt:'v1',asasOrders:[],lflLoadedAt:'v1',lflRows:[order()],sources:{lfl:'old.xlsx'}};
 let fail=false,saved;
 require('../server/routes/lfl-routes')({get(){},post:(url,...handlers)=>routes.set(url,handlers)},{
  sourceUserId:()=> 'buyer',cacheForUser:()=>runtime,initialDataLoadPromises:new Map(),ensureDataLoaded:async()=>{},
  runExcelTask:async()=>({rows:[order({fob:20})],meta:{}}),withFabricDimensions:meta=>meta,
  saveRuntimeModelSnapshot:async(id,next)=>{assert.equal(id,'buyer');assert.equal(runtime.lflRows[0].fob,10);if(fail)throw Error('disk full');saved=next;},
  userAccess:{requireArea:()=>()=>{},appendAudit(){},filterRowsByScope:(_user,rows)=>rows},
  attachModelImageIdentities:rows=>rows,modelImageIdentityOrders:()=>[],sendDateSafeJson:(res,data)=>res.json(data),apiError:(res,error)=>res.status(500).json({error:error.message}),
 });
 const handler=routes.get('/api/lfl/upload').at(-1);
 async function upload(){const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;}};await handler({body:{name:'new.xlsx',dataBase64:'AA=='},currentUser:{id:'buyer'}},res);return res;}
 fail=true;assert.equal((await upload()).code,500);assert.equal(runtime.lflRows[0].fob,10);
 fail=false;assert.equal((await upload()).code,200);assert.equal(saved.lflRows[0].fob,20);assert.equal(runtime.lflRows[0].fob,20);
});
