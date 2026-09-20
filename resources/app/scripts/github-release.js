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
function verifyExistingManifest(channel,version,expected,dir){
  const name=`BuyerLog-${version}.json`;
  gh(['release','download',tag(channel,version),'--pattern',name,'--dir',dir,'--clobber']);
  const existing=parseReleaseManifest(C.readJson(path.join(dir,name),null),channel);
  if(existing.version!==version||existing.sha256!==expected.sha256||existing.size!==expected.size)
    C.fail('Mevcut release aynı version için farklı artifact içeriyor.','RELEASE_VERSION_IMMUTABLE');
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
async function publishTest(repoDir){
  assertCi();const manifest=parseReleaseManifest(C.readJson(path.join(C.DIST_ROOT,'latest.test.json'),null),'test');
  if(manifest.version!==C.readPackage().version)C.fail('Canonical package version manifest ile eşleşmiyor.','RELEASE_VERSION_MISMATCH');
  const artifact=path.join(C.DIST_ROOT,path.posix.basename(manifest.artifact));
  if(await C.sha256File(artifact)!==manifest.sha256||fs.statSync(artifact).size!==manifest.size)C.fail('Local artifact SHA/boyut yanlış.','RELEASE_SHA_MISMATCH');
  const per=path.join(C.DIST_ROOT,`BuyerLog-${manifest.version}.json`);C.atomicWriteJson(per,manifest);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-remote-'));
  try{
    if(releaseExists('test',manifest.version))verifyExistingManifest('test',manifest.version,manifest,temp);
    else gh(['release','create',tag('test',manifest.version),artifact,per,'--title',`Buyer Log TEST ${manifest.version}`,'--notes',`TEST release for ${manifest.version}`]);
    await verifyDownloaded('test',manifest.version,manifest,temp);await verifyPublicArtifact('test',manifest,temp);updateLatest(repoDir,'test',manifest);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function promoteStable(repoDir,version){
  assertCi();tag('stable',version);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-promote-'));
  try{
    const name=`BuyerLog-${version}.json`;
    gh(['release','download',tag('test',version),'--pattern',name,'--dir',temp,'--clobber']);
    const test=parseReleaseManifest(C.readJson(path.join(temp,name),null),'test');
    if(test.version!==version)C.fail('TEST manifest version yanlış.','RELEASE_VERSION_MISMATCH');
    const artifact=await verifyDownloaded('test',version,test,temp);
    const stable=parseReleaseManifest({...test,channel:'stable',publishedAt:new Date().toISOString()},'stable');
    const stableManifestDir=path.join(temp,'stable');fs.mkdirSync(stableManifestDir);
    const stableManifestFile=path.join(stableManifestDir,name);C.atomicWriteJson(stableManifestFile,stable);
    if(releaseExists('stable',version))verifyExistingManifest('stable',version,stable,temp);
    else gh(['release','create',tag('stable',version),artifact,stableManifestFile,'--title',`Buyer Log STABLE ${version}`,'--notes',`Promoted from TEST ${version}; SHA-256 ${test.sha256}`]);
    const remoteDir=path.join(temp,'remote');fs.mkdirSync(remoteDir);
    await verifyDownloaded('stable',version,stable,remoteDir);
    await verifyPublicArtifact('stable',stable,remoteDir);
    if(await C.sha256File(path.join(remoteDir,path.basename(artifact)))!==await C.sha256File(artifact))C.fail('TEST ve STABLE SHA farklı.','RELEASE_PROMOTE_HASH_MISMATCH');
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
module.exports={tag,updateLatest,publishTest,promoteStable};
