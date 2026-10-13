'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-license-authoritative-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const {createLocalDb}=require('../server/lib/local-db'),{createDeltaStore}=require('../server/lib/delta-store'),{createLicenseCardService}=require('../server/lib/license-card-service');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let seq=0;
function isolated(name){const file=require.resolve(name),instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));instance._compile(fs.readFileSync(file,'utf8'),file);return instance.exports;}
async function fixture(mode){const file=path.join(root,'journal'+(++seq),'BuyerLogLocal.db'),localA=createLocalDb(file),localB=createLocalDb(file),a=createDeltaStore({localDb:localA,mode}),b=createDeltaStore({localDb:localB,mode});await a.hydrate();await b.hydrate();const first=isolated('../server/db'),second=isolated('../server/db');first.attachDeltaStore(a);second.attachDeltaStore(b);const create=database=>createLicenseCardService({loadOverrides:database.loadOverrides,saveOverrides:database.saveOverrides,mutate:database.mutateSharedResource,getDiscoveryRows:async()=>({module:'cp',rows:[{License:'DEMO '+seq,Licensor:'OWNER'}]})});return {a,b,localA,localB,first,second,one:create(first),two:create(second),profile:{id:'owner'}};}
for(const mode of ['delta','delta-only']){
 test(mode+': the actual shared license transaction refreshes the journal, preserves foreign notes and can restore its exact profile',async()=>{
  const f=await fixture(mode);await f.one.discover(f.profile);const card=f.one.read().cards.find(card=>card.license==='DEMO '+seq),inverse=f.one.inverseSnapshot(card.id,false),preview=f.one.updatePreview(card.id,{profile:{workingNotes:'Agent'}});await f.b.hydrate();
  await f.second.mutateSharedResource('overrides',options=>{const current=f.second.loadOverrides();current.notesmap.UNRELATED={Notes:'OTHER USER NOTE'};current._revisions.orders++;return f.second.saveOverrides(current,current._revision,options);});
  const saved=await f.one.update(f.profile,card.id,{revision:preview.snapshot.revision,profile:{workingNotes:'Agent'}},{expected:preview.snapshot});assert.equal(f.first.loadOverrides().notesmap.UNRELATED.Notes,'OTHER USER NOTE');await f.a.hydrate();assert.equal(f.one.read().cards.find(item=>item.id===card.id).workingNotes,'Agent');
  await f.one.restore(f.profile,inverse,require('../server/lib/license-card-service').sectionSnapshot(saved.saved));await f.a.hydrate();assert.deepEqual(f.one.inverseSnapshot(card.id,false),inverse);assert.equal(f.first.loadOverrides().notesmap.UNRELATED.Notes,'OTHER USER NOTE');
 });
 test(mode+': an independent native runtime changes the same license revision and the stale preview stops without effect',async()=>{
  const f=await fixture(mode);await f.one.discover(f.profile);const card=f.one.read().cards.find(card=>card.license==='DEMO '+seq),preview=f.one.updatePreview(card.id,{profile:{workingNotes:'STALE'}});await f.b.hydrate();await f.two.update(f.profile,card.id,{revision:preview.snapshot.revision,profile:{workingNotes:'NEW NATIVE'}});
  await assert.rejects(f.one.update(f.profile,card.id,{revision:preview.snapshot.revision,profile:{workingNotes:'STALE'}},{expected:preview.snapshot}),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(f.one.read().cards.find(item=>item.id===card.id).workingNotes,'NEW NATIVE');
 });
}

for(const mode of ['delta','delta-only'])for(const phase of ['update','restore'])test(mode+' native license '+phase+' cannot overwrite a peer changing the actual journal after its optimistic write',async()=>{
 const f=await fixture(mode);await f.one.discover(f.profile);const card=f.one.read().cards.find(c=>c.license==='DEMO '+seq),before=f.one.inverseSnapshot(card.id,false),preview=f.one.updatePreview(card.id,{profile:{workingNotes:'AGENT'}});let saved;
 if(phase==='restore')saved=await f.one.update(f.profile,card.id,{revision:preview.snapshot.revision,profile:{workingNotes:'AGENT'}},{expected:preview.snapshot});
 await f.b.hydrate();const native=f.second.loadOverrides(),peer=JSON.parse(JSON.stringify(native.licenseCards));peer.items=peer.items.map(c=>c.id===card.id?{...c,workingNotes:'PEER'}:c);
 const original=f.localA.queuePatches.bind(f.localA);let introduced=false;f.localA.queuePatches=async(...args)=>{if(!introduced){introduced=true;await f.localB.queuePatches([{id:'store:overrides.json',entityType:'store',patch:{licenseCards:peer,_revisions:{...native._revisions,licenseCards:Number(native._revisions.licenseCards||0)+1}}}]);}return original(...args);};
 try{await assert.rejects(phase==='restore'?f.one.restore(f.profile,before,require('../server/lib/license-card-service').sectionSnapshot(saved.saved)):f.one.update(f.profile,card.id,{revision:preview.snapshot.revision,profile:{workingNotes:'AGENT'}},{expected:preview.snapshot}),{code:'OFFICE_PREVIEW_CHANGED'});}finally{f.localA.queuePatches=original;}
 assert.equal(introduced,true);await f.a.hydrate();assert.equal(f.one.read().cards.find(c=>c.id===card.id).workingNotes,'PEER');
});
