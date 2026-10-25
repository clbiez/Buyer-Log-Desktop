'use strict';
/* UPDATE_UPDATER_TOO_OLD bir daha kalıcı engel olmamalı: yeni release daha yeni
 * launcher protokolü isterse updater, aynı imzalı + SHA-256 doğrulanmış release'in
 * launcher'ını pending yazmadan önce kurar. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fixture=require('./helpers/launcher-migration-fixture.cjs');
const {BuyerLogUpdater}=require('../electron/update/updater');
const {createLauncherHost}=require('../electron/update/launcher-host');
const {createZipFromDirectory}=require('../electron/update/zip');
const {sha256File}=require('../electron/update/crypto');
const {signManifest}=require('../electron/update/signature');
const {createTrialWritePolicy}=require('../electron/update/trial-backend');
const S=require('../electron/manual-patch/signature');

async function setup(t,{candidateLauncher='1.3.0',required='1.3.0',host=true}={}){
  const f=fixture(t),pair=crypto.generateKeyPairSync('ed25519');
  f.releaseCore(f.base,'7.0.301');
  f.write(f.base,'electron/update/release-signing-keys.json',JSON.stringify({keys:[{publicKey:pair.publicKey.export({type:'spki',format:'pem'})}]}));f.seal(f.base,'7.0.301');
  const candidate=f.releaseCore(path.join(f.root,'candidate','app'),'7.0.310',{launcherVersion:candidateLauncher,minimumActivationLauncher:required});
  const source=path.join(f.root,'releases'),artifact='releases/BuyerLog-7.0.310.zip',zip=path.join(source,'stable',artifact);
  fs.mkdirSync(path.dirname(zip),{recursive:true});createZipFromDirectory(candidate,zip,{rootPrefix:'app'});
  const manifest={schemaVersion:1,channel:'stable',version:'7.0.310',publishedAt:new Date().toISOString(),artifact,sha256:await sha256File(zip),size:fs.statSync(zip).size,mandatory:false,releaseNotes:'fixture',minimumUpdaterVersion:required};
  fs.writeFileSync(path.join(source,'stable','latest.json'),JSON.stringify({...manifest,signature:signManifest(manifest,pair.privateKey.export({type:'pkcs8',format:'pem'}))}));
  const launcherHost=host?createLauncherHost({bootstrapCore:f.base,portableRoot:f.portable,runningVersion:'1.2.0',runningHost:'1',runningId:'bundled'}):null;
  const updater=new BuyerLogUpdater({currentVersion:'7.0.301',updaterVersion:'1.2.0',appCoreRoot:f.base,portableRoot:f.portable,localDataRoot:f.local,packaged:true,launcherHost});
  return {f,updater,source};
}

test('a release that needs a newer launcher installs it from the verified artifact and then activates normally',async t=>{
  const {f,updater,source}=await setup(t);
  const result=await updater.checkAndStage({baseConfig:{releaseSource:source},channel:'stable'});
  assert.equal(result.ok,true,JSON.stringify(result.lastError));assert.equal(result.pendingReady,true);assert.equal(result.launcher.installed,'1.3.0');assert.equal(result.launcher.restartRequired,true);
  assert.equal(f.pointer().current.sourceVersion,'7.0.310');
  const launched=f.launch();assert.equal(launched.status,0,launched.stderr);
  assert.equal(launched.record.version,'7.0.310');assert.equal(launched.record.updater,'1.3.0');assert.equal(launched.record.health,true);
  assert.equal(f.state().currentVersion,'7.0.310');assert.equal(fs.readFileSync(f.db,'utf8'),'acknowledged business data');
});

test('the gate still stops when the artifact cannot provide the required launcher, without staging anything',async t=>{
  const {f,updater,source}=await setup(t,{candidateLauncher:'1.2.0',required:'1.3.0'});
  const result=await updater.checkAndStage({baseConfig:{releaseSource:source},channel:'stable'});
  assert.equal(result.ok,false);assert.equal(result.error.code,'UPDATE_UPDATER_TOO_OLD');assert.equal(result.pendingReady,false);
  assert.equal(fs.existsSync(f.pointerFile),false);
});

test('without the launcher installer the historic UPDATE_UPDATER_TOO_OLD protection is unchanged',async t=>{
  const {f,updater,source}=await setup(t,{host:false});
  const result=await updater.checkAndStage({baseConfig:{releaseSource:source},channel:'stable'});
  assert.equal(result.error.code,'UPDATE_UPDATER_TOO_OLD');assert.match(result.error.message,/update infrastructure/);assert.equal(fs.existsSync(f.pointerFile),false);
});

test('normal releases do not touch the launcher during staging',async t=>{
  const {f,updater,source}=await setup(t,{candidateLauncher:'1.2.0',required:'1.0.0'});
  const result=await updater.checkAndStage({baseConfig:{releaseSource:source},channel:'stable'});
  assert.equal(result.pendingReady,true);assert.equal(fs.existsSync(f.pointerFile),false);
});

test('legacy 1.0 health confirmation releases trial writes only after that launcher closed the exact trial',()=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bl-legacy-policy-'));
  try{
    const file=path.join(root,'updater','state.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    const env=updater=>({BUYER_LOG_UPDATE_HEALTH_TOKEN:'t',BUYER_LOG_LOCAL_DATA_ROOT:root,BUYER_LOG_ACTIVE_VERSION:'7.0.301',BUYER_LOG_ACTIVE_APP_CORE:root,BUYER_LOG_UPDATER_VERSION:updater});
    const write=state=>fs.writeFileSync(file,JSON.stringify({schemaVersion:1,...state}));
    write({state:'INSTALLING',activation:{status:'trial',token:'t',version:'7.0.301'},currentVersion:'7.0.301',lastKnownGoodVersion:'7.0.294'});
    assert.equal(createTrialWritePolicy({env:env('1.0.0')}).isConfirmed(),false);
    write({state:'ROLLBACK',activation:null,currentVersion:'7.0.294',lastKnownGoodVersion:'7.0.294',lastHealthAt:'x'});
    assert.equal(createTrialWritePolicy({env:env('1.0.0')}).isConfirmed(),false);
    const confirmed={state:'SUCCESS',activation:null,currentVersion:'7.0.301',lastKnownGoodVersion:'7.0.301',lastHealthAt:'x'};write(confirmed);
    assert.equal(createTrialWritePolicy({env:env('1.0.0')}).isConfirmed(),true);
    // Onay kaydı yazan launcher'larda eski biçim kabul edilmez.
    assert.equal(createTrialWritePolicy({env:env('1.1.0')}).isConfirmed(),false);
    assert.equal(createTrialWritePolicy({env:env('1.2.0')}).isConfirmed(),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('release manifests keep the activation floor reachable by legacy self-update-incapable clients',()=>{
  const info=require('../electron/update/launcher-version.json'),C=require('../scripts/release-common');
  assert.equal(info.minimumActivationLauncher,'1.0.0','raising the floor strands <=7.0.300 clients; publish a reachable bridge first');
  assert.equal(C.UPDATER_VERSION,info.minimumActivationLauncher);
  assert.equal(require('../electron/launcher-core').UPDATER_VERSION,info.launcherVersion);
  assert.equal(S.BOOTSTRAP_VERSION,'1.1.0','manual patch trust domain is versioned separately from the launcher');
  const files=require('../electron/manual-patch/files').BOOTSTRAP_FILES;
  for(const required of ['electron/launcher.js','electron/launcher-core.js','electron/update/launcher-version.json'])assert.ok(files.includes(required),required);
});

test('stage-0 stays dependency-free and the launcher core has no load-time side effects',()=>{
  const host=fs.readFileSync(path.join(__dirname,'..','electron','launcher.js'),'utf8');
  const requires=[...host.matchAll(/require\('([^']+)'\)/g)].map(match=>match[1]).sort();
  assert.deepEqual(requires,['crypto','electron','fs','path']);
  const core=fs.readFileSync(path.join(__dirname,'..','electron','launcher-core.js'),'utf8');
  assert.ok(core.indexOf("require('electron')")>core.indexOf('function start('),'electron APIs are touched only inside start()');
});

test('the desktop main process wires the launcher installer into the updater and syncs only outside a trial',()=>{
  const main=fs.readFileSync(path.join(__dirname,'..','electron','main.js'),'utf8');
  assert.match(main,/updater = new BuyerLogUpdater\(\{\s*launcherHost,/);
  assert.match(main,/if \(updater && updater\.state\(\)\.activation\) return;\s*const result = launcherHost\.install\(\{ sourceCore: APP_CORE_ROOT, sourceVersion: appVersion\(\) \}\);/);
  assert.match(main,/if \(ok\) \{ launcherHealthConfirmed = true;[^\n]*scheduleLauncherInfrastructureSync\(\);/);
});
