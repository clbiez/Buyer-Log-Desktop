'use strict';
/* Güncellemeden sonraki ilk açılışta launcher altyapı eşitlemesi (her sürüm yeni
 * launcher kimliği taşır) kurulum + etkin çekirdeğin tam SHA-256 taramasını ana
 * süreçte senkron yapıyor ve giriş ekranı açılırken pencereyi donduruyordu.
 * Bu test; eşzamansız kurulumun aynı ön kontrolleri verilen (işçi) doğrulayıcıyla
 * yaptığını, aynı klasörü iki kez taramadığını, bütünlük hatalarında aynı güvenlik
 * kodlarıyla durduğunu ve işçi doğrulayıcının taramayı hiçbir koşulda atlamadığını
 * kilitler. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const fixture=require('./helpers/launcher-migration-fixture.cjs');
const {verifyPackagedCore}=require('../electron/manual-patch/core-verification');
const {createLauncherHost}=require('../electron/update/launcher-host');
const {verifyPackagedCoreAsync}=require('../electron/update/core-verify-async');
const {createLauncherState}=require('../electron/update/launcher-state');

function setup(t){
  const f=fixture(t);f.legacy10Bootstrap();
  const core=f.releaseCore(path.join(f.portable,'.buyerlog-versions','7.0.301','app'),'7.0.301');
  return {f,core};
}

test('installAsync runs every preflight scan through the supplied verifier and installs the launcher',async t=>{
  const {f,core}=setup(t),seen=[];
  const host=createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0'});
  const result=await host.installAsync({sourceCore:core,sourceVersion:'7.0.301'},{verifyCore:async(root,version)=>{seen.push([path.resolve(root),version]);return verifyPackagedCore(root,version);}});
  assert.equal(result.changed,true);assert.equal(result.version,'1.2.0');
  assert.deepEqual(seen.map(item=>item[0]),[path.resolve(core),path.resolve(f.base)],'source and installation are both verified');
  assert.equal(f.pointer().current.sourceVersion,'7.0.301');
  const next=f.launch();assert.equal(next.status,0,next.stderr);assert.equal(next.record.updater,'1.2.0');
});

test('a sync from the running core does not scan the same folder twice',async t=>{
  const {f,core}=setup(t),seen=[];
  // Etkin çekirdek = kaynak çekirdek (main.js eşitlemesi): o klasör bir kez taranır.
  createLauncherState({bootstrapCore:f.base,portableRoot:f.portable}).writePointer({version:'7.0.301',appCoreRoot:core});
  const host=createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0'});
  const result=await host.installAsync({sourceCore:core,sourceVersion:'7.0.301'},{verifyCore:async(root,version)=>{seen.push(path.resolve(root));return verifyPackagedCore(root,version);}});
  assert.equal(result.changed,true);
  assert.deepEqual(seen,[path.resolve(core),path.resolve(f.base)],'running core is not re-scanned as the "current" rollback target');
});

test('an integrity failure in the async verifier keeps the security code and changes nothing',async t=>{
  const {f,core}=setup(t);
  const before=fs.readFileSync(path.join(f.base,'electron','launcher.js'));
  const host=createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.0.0'});
  await assert.rejects(host.installAsync({sourceCore:core,sourceVersion:'7.0.301'},{verifyCore:async root=>{if(path.resolve(root)===path.resolve(f.base))throw Object.assign(new Error('changed'),{code:'UPDATE_CORE_INTEGRITY'});}}),{code:'UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED'});
  assert.deepEqual(fs.readFileSync(path.join(f.base,'electron','launcher.js')),before);assert.equal(fs.existsSync(f.pointerFile),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.local,'updater','launcher-upgrade.json'),'utf8')).lastError.code,'UPDATE_LAUNCHER_BOOTSTRAP_UNVERIFIED');
});

test('the worker verifier detects a changed file with the same security code as the synchronous scan',async t=>{
  const {core}=setup(t);
  assert.equal((await verifyPackagedCoreAsync(core,'7.0.301')).verified,true);
  fs.appendFileSync(path.join(core,'electron','main.js'),'\n// changed\n');
  assert.throws(()=>verifyPackagedCore(core,'7.0.301'),{code:'UPDATE_CORE_INTEGRITY'});
  await assert.rejects(verifyPackagedCoreAsync(core,'7.0.301'),{code:'UPDATE_CORE_INTEGRITY'});
});

test('a worker that cannot run falls back to the synchronous verifier instead of skipping it',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-verify-fallback-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const module=path.join(root,'verifier.js');let calls=0;
  fs.writeFileSync(module,"if(require('worker_threads').isMainThread===false)throw new Error('broken in worker');exports.verifyPackagedCore=(core)=>{global.__calls=(global.__calls||0)+1;if(core==='bad')throw Object.assign(new Error('x'),{code:'UPDATE_CORE_INTEGRITY'});return {verified:true};};");
  assert.equal((await verifyPackagedCoreAsync('good','1',{module})).verified,true);calls=global.__calls;
  assert.equal(calls,1,'the synchronous fallback ran');
  await assert.rejects(verifyPackagedCoreAsync('bad','1',{module}),{code:'UPDATE_CORE_INTEGRITY'});
  class Throwing{constructor(){throw new Error('no workers');}}
  assert.equal((await verifyPackagedCoreAsync('good','1',{module,Worker:Throwing})).verified,true);
});
