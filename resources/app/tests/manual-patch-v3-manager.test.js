'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./helpers/manual-patch-v3-fixture.cjs'),F=require('../electron/manual-patch/files'),S=require('../electron/manual-patch/signature');
const {createLauncherState}=require('../electron/update/launcher-state');
test('a verified offline package stages an immutable candidate and persists sequence with pending state',t=>{
 const f=fixture(t),p=f.build(),before=fs.readFileSync(f.db),manager=f.manager();
 assert.equal(manager.preview(p.manifest).sequence,1);
 const result=manager.apply(p.manifest,p.archiveFile);assert.equal(result.ok,true);
 assert.equal(fs.readFileSync(path.join(result.pending.appCoreRoot,'public/index.html'),'utf8'),'<h1>Patched</h1>');
 assert.equal(fs.readFileSync(path.join(f.base,'public/index.html'),'utf8'),'<h1>Base</h1>');
 assert.deepEqual(fs.readFileSync(f.db),before);assert.equal(f.readState().manualPatchWatermarks['7.0.294:'+ 'a'.repeat(40)],1);
 manager.verifyStaged(result.pending);assert.equal(manager.apply(p.manifest,p.archiveFile).alreadyPrepared,true);
});
test('unsigned, coherently tampered and wrong-base packages cannot replace data or publish pending state',t=>{
 const f=fixture(t),p=f.build(),before=fs.readFileSync(f.db),unsigned={...p.manifest};delete unsigned.signature;
 assert.throws(()=>f.manager().apply(unsigned,p.archiveFile),{code:'PATCH_SIGNATURE_MISSING'});
 const changed=structuredClone(p.manifest);changed.artifact.sha256='f'.repeat(64);assert.throws(()=>f.manager().apply(changed,p.archiveFile),{code:'PATCH_SIGNATURE_INVALID'});
 const wrong=S.signManifest({...p.manifest,baseSourceCommit:'c'.repeat(40)},f.privateKey);assert.throws(()=>f.manager().apply(wrong,p.archiveFile),{code:'PATCH_BASE_MISMATCH'});
 assert.equal(fs.existsSync(f.stateFile),false);assert.deepEqual(fs.readFileSync(f.db),before);
});
test('damaged archive and changed target files cannot be activated',t=>{
 const f=fixture(t),p=f.build(),original=fs.readFileSync(p.archiveFile);fs.writeFileSync(p.archiveFile,Buffer.concat([original,Buffer.from('tampered')]));
 assert.throws(()=>f.manager().apply(p.manifest,p.archiveFile),{code:'PATCH_ARCHIVE_MISMATCH'});assert.equal(fs.existsSync(f.stateFile),false);
 fs.writeFileSync(p.archiveFile,original);const prepared=f.manager().apply(p.manifest,p.archiveFile);
 fs.writeFileSync(path.join(prepared.pending.appCoreRoot,'electron/main.js'),'throw Error("must not execute");');
 assert.throws(()=>f.manager().verifyStaged(prepared.pending),{code:'PATCH_FILE_MISMATCH'});
});
test('a modified installed kernel is rejected before its code can execute',t=>{
 const f=fixture(t),p=f.build(),sentinel=path.join(f.root,'kernel-executed');
 fs.writeFileSync(path.join(f.base,'electron/manual-patch/kernel/shared-file-transaction.js'),`require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad');`);
 assert.throws(()=>f.manager().apply(p.manifest,p.archiveFile),{code:'PATCH_BOOTSTRAP_REQUIRED'});assert.equal(fs.existsSync(sentinel),false);assert.equal(fs.existsSync(f.stateFile),false);
});
test('rollback preserves the accepted network sequence while restoring the acknowledged DB',t=>{
 const f=fixture(t),p=f.build();f.manager().apply(p.manifest,p.archiveFile);
 const lifecycle=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable}),trial=lifecycle.activatePending();assert.ok(trial?.activation);
 fs.writeFileSync(f.db,'trial state');lifecycle.requestRollback(trial.activation,'synthetic failure');lifecycle.rollbackExistingTrial();
 assert.equal(fs.readFileSync(f.db,'utf8'),'synthetic acknowledged baseline');
 assert.equal(f.readState().manualPatchWatermarks['7.0.294:'+ 'a'.repeat(40)],1);
 assert.throws(()=>f.manager().apply(p.manifest,p.archiveFile),{code:'PATCH_REPLAY'});
});
test('cumulative history supports a reverted file on a previously patched installation',t=>{
 const f=fixture(t),first=f.build(),one=f.manager().apply(first.manifest,first.archiveFile),lifecycle=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable});
 const trial=lifecycle.activatePending();assert.equal(lifecycle.confirmHealth(trial.activation.token,{version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true}),true);
 const priorHash=F.metadata(one.pending.appCoreRoot,'public/index.html').sha256;
 f.write(f.source,'public/index.html','<h1>Base</h1>');f.write(f.source,'server/new-feature.js','module.exports=true;');
 const second=f.build({sequence:2,sourceCommit:'c'.repeat(40),acceptedBefore:{'public/index.html':[priorHash]}}),two=f.manager().apply(second.manifest,second.archiveFile);
 assert.equal(fs.readFileSync(path.join(two.pending.appCoreRoot,'public/index.html'),'utf8'),'<h1>Base</h1>');
 assert.throws(()=>f.manager().apply(first.manifest,first.archiveFile),{code:'PATCH_REPLAY'});
});
test('an uncertain state publication keeps the candidate and supports verified retry',t=>{
 const f=fixture(t),p=f.build(),rename=fs.renameSync;let injected=false;
 fs.renameSync=(from,to)=>{const result=rename(from,to);if(to===f.stateFile&&!injected){injected=true;throw Object.assign(Error('after rename'),{code:'EIO'});}return result;};
 try{assert.throws(()=>f.manager().apply(p.manifest,p.archiveFile),{code:'EIO'});}finally{fs.renameSync=rename;}
 const state=f.readState();assert.ok(fs.existsSync(state.pending.appCoreRoot));f.manager().verifyStaged(state.pending);
 assert.equal(f.manager().apply(p.manifest,p.archiveFile).alreadyPrepared,true);assert.equal(fs.readFileSync(f.db,'utf8'),'synthetic acknowledged baseline');
});
test('state changes during staging cannot overwrite another accepted transition',t=>{
 const f=fixture(t),p=f.build();
 const manager=f.manager({beforeCommit:()=>{fs.writeFileSync(f.stateFile,JSON.stringify({schemaVersion:1,state:'EXTERNAL',manualPatchWatermarks:{['7.0.294:'+ 'a'.repeat(40)]:9}}));}});
 assert.throws(()=>manager.apply(p.manifest,p.archiveFile),{code:'PATCH_STATE_CHANGED'});assert.equal(f.readState().state,'EXTERNAL');assert.equal(fs.readFileSync(f.db,'utf8'),'synthetic acknowledged baseline');
});
test('corrupt state fails closed instead of resetting the anti-replay watermark',t=>{
 const f=fixture(t),p=f.build();fs.mkdirSync(path.dirname(f.stateFile),{recursive:true});fs.writeFileSync(f.stateFile,'{');
 assert.throws(()=>f.manager().preview(p.manifest),{code:'PATCH_STATE_INVALID'});assert.equal(fs.readFileSync(f.stateFile,'utf8'),'{');
});
test('the normal launcher cannot turn a corrupt accepted-sequence record into a new installation',t=>{
 const f=fixture(t),p=f.build();f.manager().apply(p.manifest,p.archiveFile);
 fs.writeFileSync(f.stateFile,'{');const lifecycle=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable});
 assert.throws(()=>lifecycle.readState(),{code:'UPDATE_STATE_INVALID'});
 assert.equal(fs.readFileSync(f.stateFile,'utf8'),'{');assert.equal(fs.readFileSync(f.db,'utf8'),'synthetic acknowledged baseline');
});
test('producer rejects protected bootstrap changes and immutable sequence replacement',t=>{
 const f=fixture(t),first=f.build(),original=fs.readFileSync(first.archiveFile);
 f.write(f.source,'public/index.html','<h1>Different</h1>');assert.throws(()=>f.build(),{code:'PATCH_OUTPUT_IMMUTABLE'});assert.deepEqual(fs.readFileSync(first.archiveFile),original);
 f.write(f.source,'electron/launcher.js','tampered');assert.throws(()=>f.build({sequence:2}),{code:'PATCH_BOOTSTRAP_REQUIRED'});
});

test('present but invalid watermark maps cannot be treated as an unpatched installation',t=>{
 const f=fixture(t),p=f.build(),lifecycle=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable});
 for(const value of [null,[],0,{'invalid-source':1},{['7.0.294:'+ 'a'.repeat(40)]:-1}]){
  fs.writeFileSync(f.stateFile,JSON.stringify({schemaVersion:1,manualPatchWatermarks:value}));
  assert.throws(()=>lifecycle.readState(),{code:'UPDATE_STATE_INVALID'});
  assert.throws(()=>f.manager().preview(p.manifest),{code:'PATCH_STATE_INVALID'});
 }
});

test('verified predecessor history carries all supported prior file hashes and rejects documentation-only republishing',t=>{
 const f=fixture(t),first=f.build();
 assert.throws(()=>f.build({sequence:2,sourceCommit:'c'.repeat(40),previousManifest:first.manifest}),{code:'PATCH_NO_RUNTIME_CHANGES'});
 f.write(f.source,'public/index.html','<h1>Base</h1>');f.write(f.source,'server/new-feature.js','module.exports=2;');
 const second=f.build({sequence:2,sourceCommit:'c'.repeat(40),previousManifest:first.manifest});
 assert.ok(second.manifest.changes.find(c=>c.path==='public/index.html').beforeSha256.includes(first.manifest.files.find(file=>file.path==='public/index.html').sha256));
 const changed=structuredClone(first.manifest);changed.sourceCommit='d'.repeat(40);
 assert.throws(()=>f.build({sequence:2,previousManifest:changed}),{code:'PATCH_SIGNATURE_INVALID'});
 assert.throws(()=>require('../scripts/signed-manual-patch').historyFrom(first.manifest,f.base,3),{code:'PATCH_HISTORY_INVALID'});
});
