'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-landed-authority-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),{createLocalDb}=require('../server/lib/local-db'),{createDeltaStore}=require('../server/lib/delta-store');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let seq=0;
function isolated(){const file=require.resolve('../server/db'),instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));instance._compile(fs.readFileSync(file,'utf8'),file);return instance.exports;}
test('native landed writer calls live authority before any legacy or journal effect',()=>{
 const before=db.loadOverrides();assert.throws(()=>db.replaceLandedMultipliers({tr:1.2,overseas:1.3},before._revisions.landedMultipliers,{assertAuthority(){throw Object.assign(Error('revoked'),{code:'OFFICE_TOOL_FORBIDDEN'});}}),{code:'OFFICE_TOOL_FORBIDDEN'});assert.deepEqual(db.loadOverrides(),before);
});
for(const mode of ['delta','delta-only'])test(mode+': native landed writer guards the actual journal against a peer commit',async()=>{
 const file=path.join(root,'journal'+(++seq),'BuyerLogLocal.db'),localA=createLocalDb(file),localB=createLocalDb(file);
 const a=createDeltaStore({localDb:localA,mode}),b=createDeltaStore({localDb:localB,mode});await a.hydrate();await b.hydrate();const first=isolated(),second=isolated();first.attachDeltaStore(a);second.attachDeltaStore(b);
 await first.mutateSharedResource('landedMultipliers',lease=>first.replaceLandedMultipliers({tr:1.05,overseas:1.11},null,lease));await b.hydrate();const before=second.loadOverrides(),original=localA.queuePatches.bind(localA);let introduced=false;
 localA.queuePatches=async(...args)=>{if(!introduced){introduced=true;await localB.queuePatches([{id:'store:overrides.json',entityType:'store',patch:{landedMultipliers:{tr:1.4,overseas:1.5},_revisions:{...before._revisions,landedMultipliers:before._revisions.landedMultipliers+1}}}]);}return original(...args);};
 try{await assert.rejects(first.mutateSharedResource('landedMultipliers',lease=>first.replaceLandedMultipliers({tr:1.2,overseas:1.3},before._revisions.landedMultipliers,lease)),{code:'OFFICE_PREVIEW_CHANGED'});}finally{localA.queuePatches=original;}
 assert.equal(introduced,true);await a.hydrate();assert.deepEqual(first.loadOverrides().landedMultipliers,{tr:1.4,overseas:1.5});
});
for(const mode of ['delta','delta-only'])for(const phase of ['replace','restore'])test(mode+': live authority revoked at the actual '+phase+' journal boundary prevents the effect',async()=>{
 const local=createLocalDb(path.join(root,'authority'+(++seq),'BuyerLogLocal.db')),delta=createDeltaStore({localDb:local,mode});await delta.hydrate();const database=isolated();database.attachDeltaStore(delta);
 const service=require('../server/lib/landed-multiplier-service').createLandedMultiplierService({db:database});let allowed=true;const ctx={assertAuthority(){if(!allowed)throw Object.assign(Error('revoked'),{code:'OFFICE_TOOL_FORBIDDEN'});}},prepared=await service.preview({tr:1.2,overseas:1.3},ctx);let expected=prepared;
 if(phase==='restore')expected=await service.replace(prepared.next,prepared,ctx);const before=database.loadOverrides(),original=local.queuePatches.bind(local);let reached=false;
 local.queuePatches=async(...args)=>{reached=true;allowed=false;return original(...args);};
 try{await assert.rejects(phase==='replace'?service.replace(prepared.next,expected,ctx):service.restore(prepared.multipliers,expected,ctx),{code:'OFFICE_TOOL_FORBIDDEN'});}finally{local.queuePatches=original;}
 assert.equal(reached,true);await delta.hydrate();assert.deepEqual(database.loadOverrides().landedMultipliers,before.landedMultipliers);assert.equal(database.loadOverrides()._revisions.landedMultipliers,before._revisions.landedMultipliers);
});
