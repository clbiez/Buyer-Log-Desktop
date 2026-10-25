'use strict';
/* Kendi kendini güncelleyen launcher: 7.0.294/updater 1.0.0 ve 7.0.295–7.0.300/
 * updater 1.1.0 kurulumlarının gerçek eski launcher koduyla tek seferlik geçişi,
 * yönetilen launcher'ın doğrulanması, geri dönüşü ve veri bütünlüğü. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./helpers/launcher-migration-fixture.cjs');
const {verifyPackagedCore}=require('../electron/manual-patch/core-verification');
const {createLauncherHost}=require('../electron/update/launcher-host');
const {createLauncherState}=require('../electron/update/launcher-state');

function migrateFromLegacy10(t){
  const f=fixture(t);f.legacy10Bootstrap();f.stagePending('7.0.301');
  const legacyEntry=fs.readFileSync(path.join(f.base,'electron','launcher.js'));
  const first=f.launch({TEST_SYNC:'1'});
  assert.equal(first.status,0,first.stderr);
  return {f,legacyEntry,first};
}

test('updater 1.0.0 activates the bridge core, accepts its legacy health confirmation and installs launcher 1.2.0 once',t=>{
  const {f,legacyEntry,first}=migrateFromLegacy10(t),r=first.record;
  assert.equal(r.version,'7.0.301');assert.equal(r.updater,'1.0.0');assert.equal(r.trial,true);assert.equal(r.health,true);
  assert.equal(r.writesAllowed,true,'legacy launcher confirmation must release trial writes');
  assert.equal(r.sync.changed,true);assert.equal(r.sync.version,'1.2.0');
  const state=f.state();assert.equal(state.state,'SUCCESS');assert.equal(state.activation,null);assert.equal(state.currentVersion,'7.0.301');
  assert.equal(fs.readFileSync(f.db,'utf8'),'acknowledged business data');
  // Kurulum kökünde yalnız giriş dosyası değişti; eski dosya bayt bayt korundu.
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher-legacy.js')),legacyEntry);
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher.js')),fs.readFileSync(path.join(f.APP,'electron','launcher.js')));
  assert.equal(verifyPackagedCore(f.base,'7.0.294').launcherHost,true);
  const pointer=f.pointer();assert.equal(pointer.current.version,'1.2.0');assert.equal(pointer.current.confirmedAt,null);assert.equal(pointer.current.sourceVersion,'7.0.301');

  const second=f.launch({TEST_SYNC:'1'});assert.equal(second.status,0,second.stderr);
  assert.equal(second.record.updater,'1.2.0');assert.equal(second.record.host,'1');assert.equal(second.record.launcherId,pointer.current.id);
  assert.equal(second.record.version,'7.0.301');assert.equal(second.record.trial,false);assert.equal(second.record.sync.changed,false);
  assert.ok(f.pointer().current.confirmedAt,'a launcher that loaded the core is confirmed');
  assert.equal(fs.existsSync(path.join(f.local,'updater','launcher-boot.json')),false);
});

test('after migration a failed next release rolls back core and all database members under the new launcher',t=>{
  const {f}=migrateFromLegacy10(t);assert.equal(f.launch().status,0);
  f.stagePending('7.0.302');fs.writeFileSync(f.db+'.wal','acknowledged wal');
  const failed=f.launch({TEST_MAIN_WRITE_DB:'half-written by failing trial',TEST_MAIN_THROW:'7.0.302'});
  assert.equal(failed.status,0,failed.stderr);assert.equal(f.state().state,'ROLLBACK_PENDING');
  const restored=f.launch();assert.equal(restored.status,0,restored.stderr);
  assert.equal(restored.record.version,'7.0.301');assert.equal(restored.record.updater,'1.2.0');
  assert.equal(fs.readFileSync(f.db,'utf8'),'acknowledged business data');assert.equal(fs.readFileSync(f.db+'.wal','utf8'),'acknowledged wal');
  const state=f.state();assert.equal(state.currentVersion,'7.0.301');assert.equal(state.failedVersions['7.0.302'].reason,'main-load-failed');
});

test('updater 1.1.0 full installations migrate through their own fenced activation',t=>{
  const f=fixture(t);f.legacy11Bootstrap();f.stagePending('7.0.301');
  const legacyEntry=fs.readFileSync(path.join(f.base,'electron','launcher.js'));
  const first=f.launch({TEST_SYNC:'1'});assert.equal(first.status,0,first.stderr);
  assert.equal(first.record.updater,'1.1.0');assert.equal(first.record.health,true);assert.equal(first.record.writesAllowed,true);assert.equal(first.record.sync.changed,true);
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher-legacy.js')),legacyEntry);
  const second=f.launch();assert.equal(second.status,0,second.stderr);assert.equal(second.record.updater,'1.2.0');assert.equal(second.record.version,'7.0.301');
});

test('a tampered managed launcher is rejected before load and the preserved launcher still opens the app, then self-heals',t=>{
  const {f}=migrateFromLegacy10(t),id=f.pointer().current.id;
  fs.appendFileSync(path.join(f.portable,'.buyerlog-launcher',id,'electron','update','launcher-state.js'),'\n// tampered\n');
  const fallback=f.launch({TEST_SYNC:'1'});assert.equal(fallback.status,0,fallback.stderr);
  assert.equal(fallback.record.updater,'1.0.0','the preserved legacy launcher keeps Buyer Log usable');
  assert.equal(fallback.record.sync.changed,true,'a verified copy is reinstalled from the running signed core');
  const healed=f.launch();assert.equal(healed.status,0,healed.stderr);assert.equal(healed.record.updater,'1.2.0');
});

test('an unconfirmed launcher that crashes on start is demoted after two attempts to the previous confirmed launcher',t=>{
  const {f}=migrateFromLegacy10(t);assert.equal(f.launch().status,0);
  const good=f.pointer().current,badId='1.2.1-'+'b'.repeat(12),badRoot=path.join(f.portable,'.buyerlog-launcher',badId);
  fs.cpSync(path.join(f.portable,'.buyerlog-launcher',good.id),badRoot,{recursive:true});
  fs.writeFileSync(path.join(badRoot,'electron','launcher-core.js'),"module.exports={start(){null.crash();}};\n");
  const files={...good.files,'electron/launcher-core.js':f.sha(path.join(badRoot,'electron','launcher-core.js'))};
  fs.writeFileSync(f.pointerFile,JSON.stringify({schemaVersion:1,current:{id:badId,version:'1.2.1',sourceVersion:'7.0.302',files,installedAt:'x',confirmedAt:null},previous:good,failed:{}}));
  for(let i=0;i<2;i++){const crashed=f.launch();assert.notEqual(crashed.status,0);assert.equal(crashed.record,null);}
  const recovered=f.launch();assert.equal(recovered.status,0,recovered.stderr);assert.equal(recovered.record.updater,'1.2.0');
  const pointer=f.pointer();assert.equal(pointer.current.id,good.id);assert.ok(pointer.failed[badId]);
  // Aynı başarısız launcher otomatik olarak yeniden kurulmaz.
  assert.throws(()=>createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.2.0'}).install({sourceCore:badRoot,sourceVersion:'7.0.302',force:true}),{code:/UPDATE_/});
});

test('a launcher that fails to load is skipped in the same start without user impact',t=>{
  const {f}=migrateFromLegacy10(t),good=f.pointer().current;
  const badId='1.2.1-'+'c'.repeat(12),badRoot=path.join(f.portable,'.buyerlog-launcher',badId);
  fs.cpSync(path.join(f.portable,'.buyerlog-launcher',good.id),badRoot,{recursive:true});
  fs.writeFileSync(path.join(badRoot,'electron','launcher-core.js'),'this is not javascript (');
  fs.writeFileSync(f.pointerFile,JSON.stringify({schemaVersion:1,current:{...good,id:badId,files:{...good.files,'electron/launcher-core.js':f.sha(path.join(badRoot,'electron','launcher-core.js'))}},previous:{...good,confirmedAt:'x'},failed:{}}));
  const result=f.launch();assert.equal(result.status,0,result.stderr);assert.equal(result.record.updater,'1.2.0');assert.ok(f.pointer().failed[badId]);
});

test('modified installation files block the automatic migration instead of risking an unopenable rollback target',t=>{
  const f=fixture(t);f.legacy10Bootstrap();fs.writeFileSync(path.join(f.base,'public','index.html'),'legacy unsigned script mutation');f.stagePending('7.0.301');
  const before=fs.readFileSync(path.join(f.base,'electron','launcher.js'));
  const first=f.launch({TEST_SYNC:'1'});assert.equal(first.status,0,first.stderr);
  assert.equal(first.record.syncError,'UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED');
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher.js')),before);assert.equal(fs.existsSync(f.pointerFile),false);
  const again=f.launch();assert.equal(again.status,0,again.stderr);assert.equal(again.record.updater,'1.0.0');assert.equal(again.record.version,'7.0.301');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.local,'updater','launcher-upgrade.json'),'utf8')).lastError.code,'UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED');
});

test('a read-only installation folder leaves the working launcher untouched and reports the reason',t=>{
  const f=fixture(t);f.legacy10Bootstrap();const core=f.releaseCore(path.join(f.portable,'.buyerlog-versions','7.0.301','app'),'7.0.301');
  const writeBuffer=(file,buffer)=>{if(file.startsWith(f.base+path.sep))throw Object.assign(new Error('denied'),{code:'EPERM'});require('../electron/update/json-store').atomicWriteBuffer(file,buffer);};
  const before=fs.readFileSync(path.join(f.base,'electron','launcher.js'));
  assert.throws(()=>createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0',writeBuffer}).install({sourceCore:core,sourceVersion:'7.0.301'}),{code:'UPDATE_LAUNCHER_BOOTSTRAP_READONLY'});
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher.js')),before);assert.equal(fs.existsSync(f.pointerFile),false);
  assert.equal(fs.existsSync(path.join(f.base,'electron','launcher-legacy.js')),false);
});

test('an interruption between the migration receipt and the entry replacement stays openable and completes on retry',t=>{
  const f=fixture(t);f.legacy10Bootstrap();const core=f.releaseCore(path.join(f.portable,'.buyerlog-versions','7.0.301','app'),'7.0.301');
  const entry=path.join(f.base,'electron','launcher.js');
  const writeBuffer=(file,buffer)=>{if(file===entry)throw Object.assign(new Error('power loss'),{code:'EIO'});require('../electron/update/json-store').atomicWriteBuffer(file,buffer);};
  assert.throws(()=>createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0',writeBuffer}).install({sourceCore:core,sourceVersion:'7.0.301'}));
  assert.equal(fs.existsSync(path.join(f.base,'electron','launcher-host.json')),true);
  assert.equal(verifyPackagedCore(f.base,'7.0.294').verified,true,'interrupted host migration remains a verifiable installation');
  createLauncherState({bootstrapCore:f.base,portableRoot:f.portable}).writePointer({version:'7.0.301',appCoreRoot:core});
  const legacy=f.launch();assert.equal(legacy.status,0,legacy.stderr);assert.equal(legacy.record.updater,'1.0.0');
  const host=createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0'});
  assert.equal(host.install({sourceCore:core,sourceVersion:'7.0.301'}).skipped,'recent-failure','automatic retries are throttled');
  const done=host.install({sourceCore:core,sourceVersion:'7.0.301',ignoreRecentFailure:true});
  assert.equal(done.changed,true);const next=f.launch();assert.equal(next.status,0,next.stderr);assert.equal(next.record.updater,'1.2.0');
});

test('the new launcher defers a pending core that requires a newer activation protocol',t=>{
  const {f}=migrateFromLegacy10(t);assert.equal(f.launch().status,0);
  f.stagePending('7.0.310',{launcherVersion:'1.4.0',minimumActivationLauncher:'1.4.0'});
  const result=f.launch();assert.equal(result.status,0,result.stderr);
  assert.equal(result.record.version,'7.0.301');assert.equal(result.record.trial,false);
  const state=f.state();assert.equal(state.pending,null);assert.equal(state.lastError.code,'UPDATE_UPDATER_TOO_OLD');assert.equal(state.lastError.required,'1.4.0');
  assert.equal(fs.readFileSync(f.db,'utf8'),'acknowledged business data');
});

test('a fresh full installation runs its bundled launcher through stage-0 and does not copy it again',t=>{
  const f=fixture(t);f.releaseCore(f.base,'7.0.301');
  const result=f.launch({TEST_SYNC:'1'});assert.equal(result.status,0,result.stderr);
  assert.equal(result.record.updater,'1.2.0');assert.equal(result.record.launcherId,'bundled');assert.equal(result.record.sync.changed,false);
  assert.equal(fs.existsSync(f.pointerFile),false);assert.equal(fs.existsSync(path.join(f.base,'electron','launcher-legacy.js')),false);
});

test('an application core crash never demotes a launcher that already completed its own work',t=>{
  const {f}=migrateFromLegacy10(t),id=f.pointer().current.id;
  for(let i=0;i<3;i++){const crashed=f.launch({TEST_MAIN_THROW:'7.0.301'});assert.notEqual(crashed.status,0);}
  assert.equal(f.pointer().current.id,id);assert.deepEqual(f.pointer().failed,{});assert.ok(f.pointer().current.confirmedAt);
  const ok=f.launch();assert.equal(ok.status,0,ok.stderr);assert.equal(ok.record.updater,'1.2.0');
});
