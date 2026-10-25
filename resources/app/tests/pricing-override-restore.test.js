'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');

test('pricing history restores actual durable override presence with ordinary CAS and shared patches',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-pricing-history-')),names=['BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT'],before=names.map(name=>[name,process.env[name]]),server=path.join(__dirname,'../server')+path.sep;
 function reset(){for(const key of Object.keys(require.cache))if(key.startsWith(server))delete require.cache[key];}
 Object.assign(process.env,{BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local')});reset();
 t.after(()=>{for(const [name,value] of before){if(value===undefined)delete process.env[name];else process.env[name]=value;}reset();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
 const db=require('../server/db'),shared=require('../server/lib/cp-shared-store'),parse=require('../server/lib/parse'),key=parse.orderLineKey(100,'DEMO','01'),other=parse.orderLineKey(100,'OTHER','01'),selector={model:'DEMO',ccode:'01'};
 const initial=db.loadOverrides();initial.suppfobmap={100:5,[other]:9};initial.suppfobmetamap={100:{source:'manual'}};initial.licensormap={100:'LEGACY'};db.saveOverrides(initial,initial._revision);
 let saved=db.patchOrderOverride(100,{...selector,licensor:'EDIT',suppFob:12,suppFobMeta:{source:'manual'}});
 const stale=saved.revisions.suppFob;db.patchOrderOverride(100,{...selector,suppFob:13});
 assert.throws(()=>db.patchOrderOverride(100,{...selector,suppFob:null,pricingRestore:{suppFob:{present:false,metaPresent:false}}},null,stale),error=>error.code==='REVISION_CONFLICT');
 const beforeRestore=db.loadOverrides();saved=db.patchOrderOverride(100,{...selector,licensor:null,suppFob:null,suppFobMeta:null,pricingRestore:{licensor:{present:false},suppFob:{present:false,metaPresent:false}}},beforeRestore._revisions.orders,beforeRestore._revisions.suppFob);
 assert.equal(Object.hasOwn(saved.overrides.suppfobmap,key),false);assert.equal(Object.hasOwn(saved.overrides.suppfobmetamap,key),false);assert.equal(Object.hasOwn(saved.overrides.licensormap,key),false);assert.equal(saved.overrides.suppfobmap[100],5);assert.equal(saved.overrides.suppfobmap[other],9);assert.equal(saved.revisions.suppFob,beforeRestore._revisions.suppFob+1);
 const mirror=shared.patchFromOrderPatch(saved.overrides,key,{suppFob:null,licensor:null});assert.equal(mirror.suppFob,null);assert.equal(mirror.suppFobMeta,null);assert.equal(mirror.licensor,null);
 for(const meta of [{source:'manual',origin:'cpupdate'},{source:'rule',ruleId:'demo',applied:true}]){
  saved=db.patchOrderOverride(100,{...selector,suppFob:7,suppFobMeta:meta,pricingRestore:{suppFob:{present:true,metaPresent:true}}});assert.deepEqual(saved.overrides.suppfobmetamap[key],meta);
 }
 for(const bad of [{pricingRestore:{suppFob:{present:false,metaPresent:false}}},{licensor:null,pricingRestore:{licensor:{present:'false'}}},{suppFob:1,suppFobMeta:null,pricingRestore:{suppFob:{present:true,metaPresent:true}}}]){
  const bytes=fs.readFileSync(path.join(root,'server/overrides.json'));assert.throws(()=>db.patchOrderOverride(100,{...selector,...bad}),error=>error.code==='VALIDATION_ERROR');assert.deepEqual(fs.readFileSync(path.join(root,'server/overrides.json')),bytes,'malformed restore must not change the durable store');
 }
});
