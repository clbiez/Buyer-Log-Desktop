'use strict';
/* CI-only distribution. The installed client uses github-provider.js without credentials. */
const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');
const C=require('./release-common');
const {parseReleaseManifest}=require('../electron/update/manifest');
const {parseGitHubSource,GitHubReleaseProvider}=require('../electron/update/github-provider');

function run(command,args,options={}){return cp.execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options}).trim();}
function gh(args){return run('gh',args,{env:{...process.env,GH_REPO:process.env.BUYER_LOG_GITHUB_RELEASE_REPO}});}
function assertCi(){
  const repo=String(process.env.BUYER_LOG_GITHUB_RELEASE_REPO||'');parseGitHubSource(`github:${repo}`);
  if(!process.env.GH_TOKEN)C.fail('GH_TOKEN yalnız CI secret olarak gerekli.','RELEASE_TOKEN_REQUIRED');
  return repo;
}
function tag(channel,version){if(!['test','stable'].includes(channel)||!C.parseSemver(version))C.fail('Release tag geçersiz.','RELEASE_TAG_INVALID');return `${channel}-v${version}`;}
function releaseExists(channel,version){try{gh(['release','view',tag(channel,version),'--json','tagName']);return true;}catch(_){return false;}}
function releaseAssetNames(channel,version){
  const raw=JSON.parse(gh(['release','view',tag(channel,version),'--json','assets'])||'{}');
  return new Set((Array.isArray(raw.assets)?raw.assets:[]).map(asset=>String(asset&&asset.name||'')).filter(Boolean));
}
function verifyExistingManifest(channel,version,expected,dir){
  const name=`BuyerLog-${version}.json`;
  gh(['release','download',tag(channel,version),'--pattern',name,'--dir',dir,'--clobber']);
  const existing=parseReleaseManifest(C.readJson(path.join(dir,name),null),channel);
  if(existing.version!==version||existing.sha256!==expected.sha256||existing.size!==expected.size)
    C.fail('Mevcut release aynı version için farklı artifact içeriyor.','RELEASE_VERSION_IMMUTABLE');
}
function ensureReleaseAssets(channel,version,manifest,files,dir){
  const names=releaseAssetNames(channel,version);
  const manifestName=`BuyerLog-${version}.json`;
  if(names.has(manifestName))verifyExistingManifest(channel,version,manifest,dir);
  const missing=(Array.isArray(files)?files:[]).filter(file=>!names.has(path.basename(file)));
  if(missing.length)gh(['release','upload',tag(channel,version),...missing]);
}
async function verifyDownloaded(channel,version,manifest,dir){
  const name=path.posix.basename(manifest.artifact),file=path.join(dir,name);
  gh(['release','download',tag(channel,version),'--pattern',name,'--dir',dir,'--clobber']);
  const actual=await C.sha256File(file);
  if(actual!==manifest.sha256||fs.statSync(file).size!==manifest.size)C.fail('Remote release artifact SHA/boyut doğrulaması başarısız.','RELEASE_REMOTE_VERIFY');
  return file;
}
async function verifyPublicArtifact(channel,manifest,dir){
  const provider=new GitHubReleaseProvider(`github:${process.env.BUYER_LOG_GITHUB_RELEASE_REPO}`,{artifactTimeoutMs:15*60*1000});
  const file=path.join(dir,`public-${channel}-${manifest.version}.zip`);
  await provider.copyArtifact(channel,manifest.artifact,file,manifest.version);
  if(await C.sha256File(file)!==manifest.sha256||fs.statSync(file).size!==manifest.size)
    C.fail('Kimlik bilgisi olmadan public artifact doğrulanamadı. Release repo public olmalı.','RELEASE_PUBLIC_VERIFY');
}
function currentLatest(repoDir,channel){
  const file=path.join(repoDir,channel,'latest.json');
  if(!fs.existsSync(file))return null;
  return parseReleaseManifest(C.readJson(file,null),channel);
}
async function downloadMirrorArtifact(channel,manifest,dir){
  const channelDir=path.join(dir,channel);fs.mkdirSync(channelDir,{recursive:true});
  const name=path.posix.basename(manifest.artifact),file=path.join(channelDir,name);
  gh(['release','download',tag(channel,manifest.version),'--pattern',name,'--dir',channelDir,'--clobber']);
  if(await C.sha256File(file)!==manifest.sha256||fs.statSync(file).size!==manifest.size)
    C.fail(`${channel.toUpperCase()} raw mirror kaynağı SHA/boyut doğrulamasını geçemedi.`,'RELEASE_RAW_MIRROR_VERIFY');
  return file;
}
async function publishRawMirror(repoDir,overrides={}){
  const manifests={};
  for(const channel of ['test','stable']){
    const manifest=overrides[channel]||currentLatest(repoDir,channel);
    if(manifest)manifests[channel]=manifest;
  }
  if(!Object.keys(manifests).length)return;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-raw-mirror-'));
  const payload=path.join(temp,'payload'),worktree=path.join(temp,'worktree');
  fs.mkdirSync(payload,{recursive:true});
  try{
    const index={schemaVersion:1,publishedAt:new Date().toISOString(),channels:{}};
    for(const [channel,manifest] of Object.entries(manifests)){
      await downloadMirrorArtifact(channel,manifest,payload);
      index.channels[channel]={version:manifest.version,sha256:manifest.sha256,size:manifest.size,file:path.posix.basename(manifest.artifact)};
    }
    C.atomicWriteJson(path.join(payload,'index.json'),index);
    run('git',['-C',repoDir,'worktree','add','--detach',worktree,'HEAD']);
    const orphan=`raw-dist-build-${process.pid}-${Date.now()}`;
    run('git',['-C',worktree,'switch','--orphan',orphan]);
    for(const entry of fs.readdirSync(worktree))if(entry!=='.git')fs.rmSync(path.join(worktree,entry),{recursive:true,force:true});
    fs.cpSync(payload,worktree,{recursive:true});
    run('git',['-C',worktree,'add','-A']);
    run('git',['-C',worktree,'-c','user.name=Buyer Log Release Bot','-c','user.email=buyer-log-release-bot@users.noreply.github.com','commit','-m',`Publish raw update mirror ${Object.values(manifests).map(x=>x.version).join(' / ')}`]);
    run('git',['-C',worktree,'push','--force','origin','HEAD:raw-dist']);
  }finally{
    try{run('git',['-C',repoDir,'worktree','remove','--force',worktree]);}catch(_){}
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

function updateLatest(repoDir,channel,manifest){
  const target=path.join(repoDir,channel,'latest.json'),existing=C.readJson(target,null);
  if(existing){
    const current=parseReleaseManifest(existing,channel);
    if(C.compareSemver(current.version,manifest.version)>0)C.fail('Channel latest downgrade yapılamaz.','RELEASE_DOWNGRADE_BLOCKED');
    if(current.version===manifest.version&&current.sha256!==manifest.sha256)C.fail('Aynı version farklı binary içeremez.','RELEASE_VERSION_IMMUTABLE');
  }
  C.atomicWriteJson(target,manifest);
  run('git',['-C',repoDir,'add',`${channel}/latest.json`]);
  const changed=cp.spawnSync('git',['-C',repoDir,'diff','--cached','--quiet','--',`${channel}/latest.json`],{stdio:'ignore'}).status;
  if(changed===0)return;
  if(changed!==1)C.fail('Release repo staged diff doğrulanamadı.','RELEASE_GIT_VERIFY');
  run('git',['-C',repoDir,'-c','user.name=Buyer Log Release Bot','-c','user.email=buyer-log-release-bot@users.noreply.github.com','commit','-m',`Publish ${channel} latest ${manifest.version}`]);
  run('git',['-C',repoDir,'push','origin','HEAD:main']);
}
function updateRawMirror(repoDir,channel,manifest,artifact){
  if(!['test','stable'].includes(channel))C.fail('Raw mirror channel geçersiz.','RELEASE_CHANNEL_INVALID');
  if(!fs.existsSync(artifact))C.fail('Raw mirror artifact bulunamadı.','RELEASE_ARTIFACT_MISSING');
  const worktree=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-raw-mirror-'));
  try{
    run('git',['-C',repoDir,'fetch','origin','raw-dist']);
    run('git',['-C',repoDir,'worktree','add','--detach',worktree,'origin/raw-dist']);
    const channelDir=path.join(worktree,channel);fs.mkdirSync(channelDir,{recursive:true});
    for(const name of fs.readdirSync(channelDir)){if(/^BuyerLog-.*\.zip$/i.test(name))fs.rmSync(path.join(channelDir,name),{force:true});}
    const target=path.join(channelDir,path.basename(artifact));fs.copyFileSync(artifact,target);
    if(fs.statSync(target).size!==manifest.size)C.fail('Raw mirror boyutu manifest ile eşleşmiyor.','RELEASE_RAW_MIRROR_SIZE');
    run('git',['-C',worktree,'add',channel]);
    const changed=cp.spawnSync('git',['-C',worktree,'diff','--cached','--quiet','--',channel],{stdio:'ignore'}).status;
    if(changed===1){
      run('git',['-C',worktree,'-c','user.name=Buyer Log Release Bot','-c','user.email=buyer-log-release-bot@users.noreply.github.com','commit','-m',`Mirror ${channel} ${manifest.version}`]);
      run('git',['-C',worktree,'push','origin','HEAD:raw-dist']);
    }else if(changed!==0)C.fail('Raw mirror staged diff doğrulanamadı.','RELEASE_GIT_VERIFY');
  }finally{
    try{run('git',['-C',repoDir,'worktree','remove','--force',worktree]);}catch(_){fs.rmSync(worktree,{recursive:true,force:true});}
  }
}
async function publishTest(repoDir){
  assertCi();const manifest=parseReleaseManifest(C.readJson(path.join(C.DIST_ROOT,'latest.test.json'),null),'test');
  if(manifest.version!==C.readPackage().version)C.fail('Canonical package version manifest ile eşleşmiyor.','RELEASE_VERSION_MISMATCH');
  const artifact=path.join(C.DIST_ROOT,path.posix.basename(manifest.artifact));
  if(await C.sha256File(artifact)!==manifest.sha256||fs.statSync(artifact).size!==manifest.size)C.fail('Local artifact SHA/boyut yanlış.','RELEASE_SHA_MISMATCH');
  const per=path.join(C.DIST_ROOT,`BuyerLog-${manifest.version}.json`);C.atomicWriteJson(per,manifest);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-remote-'));
  try{
    if(!releaseExists('test',manifest.version))gh(['release','create',tag('test',manifest.version),'--title',`Buyer Log TEST ${manifest.version}`,'--notes',`TEST release for ${manifest.version}`]);
    ensureReleaseAssets('test',manifest.version,manifest,[artifact,per],temp);
    await verifyDownloaded('test',manifest.version,manifest,temp);
    await verifyPublicArtifact('test',manifest,temp);
    await publishRawMirror(repoDir,{test:manifest});
    updateLatest(repoDir,'test',manifest);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function promoteStable(repoDir,version){
  assertCi();tag('stable',version);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-promote-'));
  try{
    const name=`BuyerLog-${version}.json`;
    /* TEST latest is already committed to the public release-only repo after
       publish verification. Read that canonical manifest instead of asking
       gh release download for the JSON asset; GitHub CLI can transiently
       report "no assets to download" even while the public release assets are
       already available. The ZIP itself is then fetched anonymously through
       the same provider used by installed clients and hash/size verified. */
    const test=parseReleaseManifest(C.readJson(path.join(repoDir,'test','latest.json'),null),'test');
    if(test.version!==version)C.fail('TEST latest istenen version ile eşleşmiyor.','RELEASE_VERSION_MISMATCH');
    const artifact=path.join(temp,path.posix.basename(test.artifact));
    const provider=new GitHubReleaseProvider(`github:${process.env.BUYER_LOG_GITHUB_RELEASE_REPO}`,{artifactTimeoutMs:15*60*1000});
    await provider.copyArtifact('test',test.artifact,artifact,version);
    if(await C.sha256File(artifact)!==test.sha256||fs.statSync(artifact).size!==test.size)
      C.fail('TEST public artifact SHA/boyut doğrulaması başarısız.','RELEASE_REMOTE_VERIFY');
    const stable=parseReleaseManifest({...test,channel:'stable',publishedAt:new Date().toISOString()},'stable');
    const stableManifestDir=path.join(temp,'stable');fs.mkdirSync(stableManifestDir);
    const stableManifestFile=path.join(stableManifestDir,name);C.atomicWriteJson(stableManifestFile,stable);
    if(!releaseExists('stable',version))gh(['release','create',tag('stable',version),'--title',`Buyer Log STABLE ${version}`,'--notes',`Promoted from TEST ${version}; SHA-256 ${test.sha256}`]);
    ensureReleaseAssets('stable',version,stable,[artifact,stableManifestFile],temp);
    const remoteDir=path.join(temp,'remote');fs.mkdirSync(remoteDir);
    await verifyDownloaded('stable',version,stable,remoteDir);
    updateRawMirror(repoDir,'stable',stable,artifact);
    await verifyPublicArtifact('stable',stable,remoteDir);
    if(await C.sha256File(path.join(remoteDir,path.basename(artifact)))!==await C.sha256File(artifact))C.fail('TEST ve STABLE SHA farklı.','RELEASE_PROMOTE_HASH_MISMATCH');
    await publishRawMirror(repoDir,{stable});
    updateLatest(repoDir,'stable',stable);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function main(){
  const [action,arg,...rest]=process.argv.slice(2);if(rest.length)C.fail('Fazla argüman.','RELEASE_ARG_INVALID');
  const repoDir=path.resolve(process.env.BUYER_LOG_RELEASE_REPO_DIR||'');
  if(!fs.existsSync(path.join(repoDir,'.git')))C.fail('Release-only repo checkout bulunamadı.','RELEASE_REPO_REQUIRED');
  if(action==='publish-test'&&!arg)return publishTest(repoDir);
  if(action==='promote-stable'&&arg)return promoteStable(repoDir,arg);
  C.fail('Kullanım: github-release.js publish-test | promote-stable VERSION','RELEASE_ARG_INVALID');
}
if(require.main===module)main().catch(error=>{console.error(`[${error.code||'RELEASE_FAILED'}] ${error.message}`);process.exitCode=1;});
module.exports={tag,releaseAssetNames,ensureReleaseAssets,currentLatest,downloadMirrorArtifact,publishRawMirror,updateLatest,publishTest,promoteStable};
