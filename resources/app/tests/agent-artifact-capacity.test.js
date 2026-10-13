'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-artifact-capacity-'));for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const store=require('../server/lib/agent-artifact-store');test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('native undo backups do not consume the fixed user upload quota and retain owner/kind/integrity controls',async()=>{
 const profile={id:'capacity-owner'};for(let i=0;i<20;i++)await store.put(profile,Buffer.from('uploaded-'+i),'file-'+i+'.xlsx','workbook');
 for(let i=0;i<30;i++){const bytes=Buffer.from('native-before-'+i),meta=await store.put(profile,bytes,'before-'+i+'.gz','agent-native-inverse');assert.deepEqual(store.read(profile,meta.id,'agent-native-inverse').buffer,bytes);assert.throws(()=>store.read({id:'other'},meta.id,'agent-native-inverse'),{code:'OFFICE_NOT_FOUND'});assert.throws(()=>store.read(profile,meta.id,'workbook'),{code:'OFFICE_NOT_FOUND'});}
 await assert.rejects(store.put(profile,Buffer.from('upload21'),'file21.xlsx'),{code:'OFFICE_ARTIFACT_LIMIT'});await assert.rejects(store.put(profile,Buffer.from('unlisted'),'native-fake.gz','made-up-backup'),{code:'OFFICE_ARTIFACT_LIMIT'});
});
test('the native undo count remains bounded while the upload pool remains independently usable',async()=>{
 const profile={id:'undo-count-owner'},dir=path.join(root,'agent-office-artifacts',crypto.createHash('sha256').update(profile.id).digest('hex')),bytes=Buffer.from('x'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');fs.mkdirSync(dir,{recursive:true});
 for(let i=0;i<1000;i++){const id=i.toString(16).padStart(32,'0');fs.writeFileSync(path.join(dir,id+'.bin'),bytes);fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,ownerId:profile.id,kind:'agent-native-inverse',name:'before-'+i,sha256,bytes:1,expiresAt:new Date(Date.now()+store.TTL).toISOString()}));}
 await assert.rejects(store.put(profile,Buffer.from('next undo'),'next.gz','agent-native-inverse'),{code:'OFFICE_ARTIFACT_LIMIT'});const meta=await store.put(profile,Buffer.from('new uploaded document'),'input.xlsx','workbook');assert.equal(store.read(profile,meta.id,'workbook').buffer.toString(),'new uploaded document');
});
test('native undo and uploads still share the actual owner byte ceiling',async()=>{
 const profile={id:'byte-cap-owner'},large=Buffer.alloc(80*1024*1024,1);await store.put(profile,large,'one.gz','agent-native-inverse');await store.put(profile,large,'two.xlsx','workbook');await assert.rejects(store.put(profile,Buffer.alloc(50*1024*1024,2),'overflow.xlsx','workbook'),{code:'OFFICE_ARTIFACT_LIMIT'});
});
