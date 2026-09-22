'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');
const {Readable}=require('stream');
const {createZipFromDirectory}=require('../electron/update/zip');
const {BuyerLogUpdater}=require('../electron/update/updater');
const {createLauncherState}=require('../electron/update/launcher-state');
const {GitHubReleaseProvider,parseGitHubSource,githubAssetUrl}=require('../electron/update/github-provider');

function core(root,version){const app=path.join(root,'app');for(const d of ['electron/update','server','public'])fs.mkdirSync(path.join(app,d),{recursive:true});fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version}));fs.writeFileSync(path.join(app,'electron/main.js'),'module.exports=true');fs.writeFileSync(path.join(app,'server/server.js'),'module.exports=true');fs.writeFileSync(path.join(app,'public/index.html'),'<html></html>');return app;}
function response(url,bytes){return {ok:true,url,status:200,text:async()=>bytes.toString('utf8'),body:Readable.toWeb(Readable.from(bytes))};}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}


test('shipped app keeps the canonical public GitHub release source',()=>{
  const source=JSON.parse(fs.readFileSync(path.join(__dirname,'..','electron','update','release-source.json'),'utf8'));
  assert.equal(source.githubSource,'github:clbiez/Buyer-Log-Releases');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-source-default-'));
  try{
    const app=core(path.join(root,'bootstrap'),'7.0.95');
    fs.copyFileSync(path.join(__dirname,'..','electron','update','release-source.json'),path.join(app,'electron','update','release-source.json'));
    const updater=new BuyerLogUpdater({currentVersion:'7.0.95',appCoreRoot:app,portableRoot:root,localDataRoot:path.join(root,'data/local'),packaged:true});
    fs.writeFileSync(updater.configFile,JSON.stringify({releaseSource:path.join(root,'legacy-folder'),channel:'test'}));
    assert.equal(updater.config().provider,'github');
    assert.equal(updater.config().releaseSource,'github:clbiez/Buyer-Log-Releases');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('public GitHub source and artifact are narrowly constrained',()=>{
  assert.deepEqual(parseGitHubSource('github:buyer/release-only'),{owner:'buyer',repo:'release-only'});
  assert.throws(()=>parseGitHubSource('https://github.com/buyer/release-only'));
  assert.equal(githubAssetUrl('github:buyer/release-only','stable','7.0.85','releases/BuyerLog-7.0.85.zip'),'https://github.com/buyer/release-only/releases/download/stable-v7.0.85/BuyerLog-7.0.85.zip');
  assert.throws(()=>githubAssetUrl('github:buyer/release-only','stable','7.0.85','releases/other.zip'));
});

test('GitHub bridge stages through original updater; stable never reads TEST; activation and data survive',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-github-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'bootstrap'),'7.0.84'),candidate=core(path.join(root,'candidate'),'7.0.85');
  fs.writeFileSync(path.join(bootstrap,'electron/update/release-source.json'),JSON.stringify({githubSource:'github:buyer/release-only'}));
  const zip=path.join(root,'candidate.zip');createZipFromDirectory(candidate,zip,{rootPrefix:'app'});const bytes=fs.readFileSync(zip);
  const manifest={schemaVersion:1,channel:'stable',version:'7.0.85',publishedAt:new Date().toISOString(),artifact:'releases/BuyerLog-7.0.85.zip',sha256:sha(bytes),size:bytes.length,minimumUpdaterVersion:'1.0.0'};
  const local=path.join(root,'data/local');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'BuyerLogLocal.db'),'BUSINESS DATA');
  const seen=[],original=global.fetch;t.after(()=>{global.fetch=original;});
  global.fetch=async url=>{seen.push(String(url));return response(String(url),String(url).includes('latest.json')?Buffer.from(JSON.stringify(manifest)):bytes);};
  const updater=new BuyerLogUpdater({currentVersion:'7.0.84',appCoreRoot:bootstrap,portableRoot:root,localDataRoot:local,packaged:true});
  fs.writeFileSync(updater.configFile,JSON.stringify({releaseSource:path.join(root,'old-folder'),channel:'test'}));
  assert.equal(updater.config().releaseSource,'github:buyer/release-only');
  const result=await updater.checkAndStage({channel:'stable'});
  assert.equal(result.pendingReady,true);assert.equal(result.pendingVersion,'7.0.85');
  assert.ok(seen.every(url=>!url.includes('/test/')));assert.ok(seen.some(url=>url.includes('/stable/latest.json')));
  assert.ok(seen.some(url=>url.includes('/stable-v7.0.85/BuyerLog-7.0.85.zip')));
  const life=createLauncherState({bootstrapCore:bootstrap,portableRoot:root});
  const active=life.activatePending();assert.equal(active.selected.version,'7.0.85');
  assert.equal(life.confirmHealth(active.activation.token,{version:'7.0.85',backendReady:true,rendererReady:true,localDbReady:true}),true);
  assert.equal(fs.readFileSync(path.join(local,'BuyerLogLocal.db'),'utf8'),'BUSINESS DATA');
});

test('wrong GitHub SHA fails before pending activation; unavailable GitHub is nonfatal',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-github-bad-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bootstrap=core(path.join(root,'bootstrap'),'7.0.84');
  const updater=new BuyerLogUpdater({currentVersion:'7.0.84',appCoreRoot:bootstrap,portableRoot:root,localDataRoot:path.join(root,'data/local'),packaged:true});
  const manifest={schemaVersion:1,channel:'stable',version:'7.0.85',publishedAt:new Date().toISOString(),artifact:'releases/BuyerLog-7.0.85.zip',sha256:'a'.repeat(64),size:3,minimumUpdaterVersion:'1.0.0'};
  const original=global.fetch;t.after(()=>{global.fetch=original;});
  global.fetch=async url=>response(String(url),String(url).includes('latest.json')?Buffer.from(JSON.stringify(manifest)):Buffer.from('bad'));
  let result=await updater.checkAndStage({baseConfig:{releaseSource:'github:buyer/release-only'},channel:'stable'});
  assert.equal(result.lastError.code,'UPDATE_SHA256_MISMATCH');assert.equal(updater.state().pending,null);
  global.fetch=async()=>{throw new Error('offline');};
  result=await updater.checkAndStage({baseConfig:{releaseSource:'github:buyer/release-only'},channel:'stable'});
  assert.equal(result.offline,true);assert.equal(updater.state().pending,null);
});

test('old folder client receives bridge, restarts, then uses public GitHub provider',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-bridge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old=core(path.join(root,'old'),'7.0.84'),bridge=core(path.join(root,'bridge'),'7.0.85'),next=core(path.join(root,'next'),'7.0.86');
  fs.writeFileSync(path.join(bridge,'electron/update/release-source.json'),JSON.stringify({githubSource:'github:buyer/release-only'}));
  const bundle=path.join(root,'bundle');fs.mkdirSync(bundle);const bridgeZip=path.join(bundle,'BuyerLog-7.0.85.zip');createZipFromDirectory(bridge,bridgeZip,{rootPrefix:'app'});
  const bridgeBytes=fs.readFileSync(bridgeZip),bridgeManifest={schemaVersion:1,channel:'test',version:'7.0.85',publishedAt:new Date().toISOString(),artifact:'releases/BuyerLog-7.0.85.zip',sha256:sha(bridgeBytes),size:bridgeBytes.length,minimumUpdaterVersion:'1.0.0'};
  fs.writeFileSync(path.join(bundle,'latest.test.json'),JSON.stringify(bridgeManifest));
  const legacy=path.join(root,'old-release-folder');
  const publish=cp.spawnSync(process.execPath,[path.join(__dirname,'../scripts/bridge-publish.js'),bundle,legacy],{encoding:'utf8'});
  assert.equal(publish.status,0,publish.stderr);
  const local=path.join(root,'data/local');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'BuyerLogLocal.db'),'KEEP');
  const oldUpdater=new BuyerLogUpdater({currentVersion:'7.0.84',appCoreRoot:old,portableRoot:root,localDataRoot:local,packaged:true});
  let result=await oldUpdater.checkAndStage({baseConfig:{releaseSource:legacy},channel:'test'});
  assert.equal(result.pendingVersion,'7.0.85');
  const life=createLauncherState({bootstrapCore:old,portableRoot:root});const trial=life.activatePending();
  assert.equal(life.confirmHealth(trial.activation.token,{version:'7.0.85',backendReady:true,rendererReady:true,localDbReady:true}),true);
  const active=life.currentPointer().appCoreRoot;
  const nextZip=path.join(root,'next.zip');createZipFromDirectory(next,nextZip,{rootPrefix:'app'});const nextBytes=fs.readFileSync(nextZip);
  const nextManifest={...bridgeManifest,channel:'stable',version:'7.0.86',artifact:'releases/BuyerLog-7.0.86.zip',sha256:sha(nextBytes),size:nextBytes.length};
  const original=global.fetch;t.after(()=>{global.fetch=original;});const seen=[];
  global.fetch=async url=>{seen.push(String(url));return response(String(url),String(url).includes('latest.json')?Buffer.from(JSON.stringify(nextManifest)):nextBytes);};
  const bridged=new BuyerLogUpdater({currentVersion:'7.0.85',appCoreRoot:active,portableRoot:root,localDataRoot:local,packaged:true});
  fs.writeFileSync(bridged.configFile,JSON.stringify({releaseSource:legacy,channel:'stable'}));
  result=await bridged.checkAndStage({channel:'stable'});
  assert.equal(bridged.config().provider,'github');assert.equal(result.pendingVersion,'7.0.86');
  assert.ok(seen.some(url=>url.includes('raw.githubusercontent.com/buyer/release-only/main/stable/latest.json')));
  assert.equal(fs.readFileSync(path.join(local,'BuyerLogLocal.db'),'utf8'),'KEEP');
});
