'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const fixture=require('./helpers/manual-patch-v3-fixture.cjs'),F=require('../electron/manual-patch/files');
const {prepareFromPicker}=require('../electron/manual-patch/desktop');
const {BuyerLogUpdater}=require('../electron/update/updater');
const {createLauncherState}=require('../electron/update/launcher-state');

test('the native picker authenticates before confirmation and rechecks moderator authority before staging',async t=>{
 const f=fixture(t),p=f.build();let confirmations=0,authorizations=0;
 const dialog={showOpenDialog:async()=>({filePaths:[p.manifestFile]}),showMessageBox:async()=>{confirmations++;return {response:0};}};
 await assert.rejects(prepareFromPicker({manager:f.manager(),dialog,authorize:async()=>++authorizations<2}),{code:'UPDATE_ADMIN_REQUIRED'});
 assert.equal(confirmations,1);assert.equal(authorizations,2);assert.equal(fs.existsSync(f.stateFile),false);
});

test('cancelling and an unsigned manifest never read the companion ZIP or change updater state',async t=>{
 const f=fixture(t),p=f.build();let confirmations=0;
 const dialog={showOpenDialog:async()=>({filePaths:[p.manifestFile]}),showMessageBox:async()=>{confirmations++;return {response:1};}};
 assert.equal((await prepareFromPicker({manager:f.manager(),dialog,authorize:async()=>true})).cancelled,true);
 fs.unlinkSync(p.archiveFile);const unsigned={...p.manifest};delete unsigned.signature;fs.writeFileSync(p.manifestFile,JSON.stringify(unsigned));
 await assert.rejects(prepareFromPicker({manager:f.manager(),dialog,authorize:async()=>true}),{code:'PATCH_SIGNATURE_MISSING'});
 assert.equal(confirmations,1);assert.equal(fs.existsSync(f.stateFile),false);
});

test('the offline native picker prepares a verified package without requiring a network provider',async t=>{
 const f=fixture(t),p=f.build();let summary;
 const dialog={showOpenDialog:async()=>({filePaths:[p.manifestFile]}),showMessageBox:async(_window,options)=>{summary=options;return {response:0};}};
 const result=await prepareFromPicker({manager:f.manager(),dialog,language:'en',authorize:async()=>true});
 assert.equal(result.ok,true);assert.match(summary.detail,/Synthetic patch/);f.manager().verifyStaged(result.pending);
});

test('automatic checks queue behind native patch preparation and cannot replace its pending identity',async t=>{
 const f=fixture(t),p=f.build(),u=new BuyerLogUpdater({appCoreRoot:f.base,portableRoot:f.portable,localDataRoot:path.dirname(f.db),packaged:true,currentVersion:'7.0.294'});
 let release;const waiting=new Promise(resolve=>release=resolve),prepare=u.prepareSignedPatch(async()=>{await waiting;return f.manager().apply(p.manifest,p.archiveFile);});
 const automatic=u.checkAndStage({});release();assert.equal((await prepare).ok,true);
 assert.equal((await automatic).pendingManualPatch,true);assert.equal(u.state().pending.manualPatch.sequence,1);
 fs.writeFileSync(f.stateFile,'{');assert.throws(()=>u.saveState({state:'IDLE'}),{code:'UPDATE_STATE_INVALID'});assert.equal(fs.readFileSync(f.stateFile,'utf8'),'{');
});

function installMain(f){
 const code="require('node:fs').writeFileSync(process.env.TEST_MARKER,'main loaded'); if(process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN)global.__buyerLogLauncherHealthReady({version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true});\n";
 for(const root of [f.base,f.source]){f.write(root,'electron/main.js',code);f.write(root,'electron/app-integrity.json',F.integrityBytes(F.inventory(root),'7.0.294'));}
}
function launch(f,envOverrides={}){
 const marker=path.join(f.root,'main-was-loaded'),script=path.join(f.root,'launch.cjs');
 fs.writeFileSync(script,`const Module=require('node:module'),load=Module._load;Module._load=function(id){if(id==='electron')return {app:{isPackaged:true,setPath(){},requestSingleInstanceLock(){return true;},exit(){},quit(){},relaunch(){}}};return load.apply(this,arguments)};Object.defineProperty(process,'execPath',{value:${JSON.stringify(path.join(f.portable,'BuyerLog.exe'))}});try{require(${JSON.stringify(path.join(f.base,'electron/launcher.js'))})}catch(e){console.error(e.code||e.message);process.exitCode=1}`);
 const result=child.spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,...envOverrides,TEST_MARKER:marker},timeout:20000});
 return {...result,loaded:fs.existsSync(marker)};
}

test('the installed launcher loads and confirms a verified core and verifies its receipt again on the next process',t=>{
 const f=fixture(t);installMain(f);const p=f.build();f.manager().apply(p.manifest,p.archiveFile);
 const first=launch(f);assert.equal(first.status,0,first.stderr);assert.equal(first.loaded,true);assert.equal(f.readState().state,'SUCCESS');
 fs.unlinkSync(path.join(f.root,'main-was-loaded'));const second=launch(f);assert.equal(second.status,0,second.stderr);assert.equal(second.loaded,true);
 assert.equal(f.readState().manualPatchWatermarks['7.0.294:'+ 'a'.repeat(40)],1);
});

test('staged tampering stops the real launcher module before main and before any database checkpoint',t=>{
 const f=fixture(t);installMain(f);const p=f.build(),result=f.manager().apply(p.manifest,p.archiveFile),before=fs.readFileSync(f.stateFile);
 fs.writeFileSync(path.join(result.pending.appCoreRoot,'public/index.html'),'unsigned replacement');
 const launched=launch(f);assert.equal(launched.status,1);assert.equal(launched.loaded,false);assert.match(launched.stderr,/PATCH_FILE_MISMATCH/);
 assert.deepEqual(fs.readFileSync(f.stateFile),before);assert.equal(fs.readFileSync(f.db,'utf8'),'synthetic acknowledged baseline');
});

test('legacy public/server mutations are rejected before loading the new full bootstrap application',t=>{
 const f=fixture(t);installMain(f);fs.writeFileSync(path.join(f.base,'public/index.html'),'legacy unsigned mutation');
 const result=launch(f);assert.equal(result.status,1);assert.equal(result.loaded,false);assert.match(result.stderr,/UPDATE_CORE_INTEGRITY/);
 const lifecycle=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable});assert.equal(lifecycle.readState().activation,null);
});

test('normal updater retention cannot delete the prepared or running signed patch core',t=>{
 const f=fixture(t),p=f.build(),prepared=f.manager().apply(p.manifest,p.archiveFile);
 const makeUpdater=core=>new BuyerLogUpdater({appCoreRoot:core,portableRoot:f.portable,localDataRoot:path.dirname(f.db),packaged:true,currentVersion:'7.0.294'});
 makeUpdater(f.base);assert.equal(fs.existsSync(path.join(prepared.pending.appCoreRoot,'package.json')),true,'prepared core must survive normal updater construction');
 const life=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable}),trial=life.activatePending();assert.ok(trial);
 makeUpdater(prepared.pending.appCoreRoot);assert.equal(fs.existsSync(path.join(prepared.pending.appCoreRoot,'server/server.js')),true,'running core must survive its own startup cleanup');
});

test('automatic update polling preserves the signed-patch rollback explanation and anti-replay state',async t=>{
 const f=fixture(t),u=new BuyerLogUpdater({appCoreRoot:f.base,portableRoot:f.portable,localDataRoot:path.dirname(f.db),packaged:true,currentVersion:'7.0.294'});
 const lastError={code:'UPDATE_HEALTH_FAILED',manualPatch:{sequence:2}},watermarks={['7.0.294:'+ 'a'.repeat(40)]:2};
 u.saveState({state:'ROLLBACK',lastError,manualPatchWatermarks:watermarks});
 assert.equal((await u.checkAndStage({})).manualPatchRollback,true);assert.deepEqual(u.state().lastError,lastError);assert.deepEqual(u.state().manualPatchWatermarks,watermarks);
});

test('a normal launcher clears inherited trial credentials and keeps control state aligned with the supported portable override',t=>{
 const f=fixture(t),override=path.join(f.root,'relocated-data');
 const code="require('node:fs').writeFileSync(process.env.TEST_MARKER,JSON.stringify({token:process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN||'',core:process.env.BUYER_LOG_ACTIVE_APP_CORE}));\n";
 for(const root of [f.base,f.source]){f.write(root,'electron/main.js',code);f.write(root,'electron/app-integrity.json',F.integrityBytes(F.inventory(root),'7.0.294'));}
 const result=launch(f,{BUYER_LOG_UPDATE_HEALTH_TOKEN:'stale-inherited-trial',BUYER_LOG_PORTABLE_ROOT:override});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'main-was-loaded'),'utf8')).token,'');
 assert.equal(fs.existsSync(path.join(override,'data/local/updater/db-backups')),true);
});
