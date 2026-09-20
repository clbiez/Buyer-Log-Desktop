'use strict';
const fs=require('fs');
const path=require('path');
const childProcess=require('child_process');
const { bumpSemver, compareSemver, parseSemver }=require('../electron/update/semver');
const { createZipFromDirectory, extractZipSafe }=require('../electron/update/zip');
const { sha256File }=require('../electron/update/crypto');
const { parseReleaseManifest }=require('../electron/update/manifest');
const { readJson, atomicWriteJson, ensureDir }=require('../electron/update/json-store');

const APP_ROOT=path.resolve(__dirname,'..');
const PORTABLE_ROOT=path.resolve(APP_ROOT,'..','..');
const DIST_ROOT=path.join(APP_ROOT,'dist-updates');
const PENDING_FILE=path.join(APP_ROOT,'.release-pending.json');
const UPDATER_VERSION='1.0.0';

function fail(message,code='RELEASE_FAILED'){const e=new Error(message);e.code=code;throw e;}
function readPackage(){const pkg=readJson(path.join(APP_ROOT,'package.json'),null);if(!pkg||!parseSemver(pkg.version))fail('package.json version geçerli SemVer değil.','RELEASE_VERSION_INVALID');return pkg;}
function writePackageVersion(version){
  if(!parseSemver(version))fail('Yeni version geçersiz.','RELEASE_VERSION_INVALID');
  const pkgPath=path.join(APP_ROOT,'package.json'),pkg=readJson(pkgPath,null);pkg.version=version;atomicWriteJson(pkgPath,pkg);
  const lock=path.join(APP_ROOT,'node_modules','.package-lock.json');
  if(fs.existsSync(lock)){const value=readJson(lock,null);if(value&&typeof value==='object'){value.name=pkg.name||value.name;value.version=version;atomicWriteJson(lock,value);}}
}
function gitRoot(){try{return childProcess.execFileSync('git',['rev-parse','--show-toplevel'],{cwd:APP_ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch(_){return '';}}
function assertGitClean(){const root=gitRoot();if(!root)return;const status=childProcess.execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();if(status)fail('Git çalışma alanı temiz değil. Release başlamadan değişiklikleri commit/stash edin.','RELEASE_GIT_DIRTY');}
function baseConfig(){const outer=readJson(path.join(PORTABLE_ROOT,'config.json'),{})||{};return outer.updates&&typeof outer.updates==='object'?outer.updates:{};}
function releaseSource(cli=''){return String(cli||process.env.BUYER_LOG_RELEASE_SOURCE||baseConfig().releaseSource||'').trim();}
function excludeRuntime(rel,entry){
  const r=String(rel||'').replace(/\\/g,'/');
  if(r==='.release-pending.json'||r.startsWith('dist-updates/'))return true;
  if(r.startsWith('tests/'))return true;
  if(r==='server/data'||r.startsWith('server/data/'))return true;
  if(r.startsWith('.desktop-dev/'))return true;
  return false;
}
async function buildArtifact(version,notes=''){
  if(readPackage().version!==version)fail('Build version package.json ile eşleşmiyor.','RELEASE_VERSION_MISMATCH');
  ensureDir(DIST_ROOT);
  const artifactName=`BuyerLog-${version}.zip`,artifactFile=path.join(DIST_ROOT,artifactName);
  const githubRepo=String(process.env.BUYER_LOG_GITHUB_RELEASE_REPO||'').trim();
  const sourceFile=path.join(APP_ROOT,'electron','update','release-source.json');
  const originalSource=fs.existsSync(sourceFile)?fs.readFileSync(sourceFile):null;
  if(githubRepo){
    const {parseGitHubSource}=require('../electron/update/github-provider');
    parseGitHubSource(`github:${githubRepo}`);
    fs.writeFileSync(sourceFile,JSON.stringify({githubSource:`github:${githubRepo}`})+'\n');
  }
  try{fs.rmSync(artifactFile,{force:true});}catch(_){}
  try{createZipFromDirectory(APP_ROOT,artifactFile,{rootPrefix:'app',exclude:excludeRuntime});}
  finally{if(githubRepo){if(originalSource)fs.writeFileSync(sourceFile,originalSource);else fs.rmSync(sourceFile,{force:true});}}
  const sha256=await sha256File(artifactFile),size=fs.statSync(artifactFile).size;
  const manifest={schemaVersion:1,channel:'test',version,publishedAt:new Date().toISOString(),artifact:`releases/${artifactName}`,sha256,size,mandatory:false,releaseNotes:String(notes||'').slice(0,8000),minimumUpdaterVersion:UPDATER_VERSION};
  parseReleaseManifest(manifest,'test');
  const verifyRoot=path.join(DIST_ROOT,`.verify-${process.pid}-${Date.now()}`);
  try{extractZipSafe(artifactFile,verifyRoot,{maxFiles:30000,maxBytes:1024*1024*1024});const packed=readJson(path.join(verifyRoot,'app','package.json'),null);if(!packed||packed.version!==version)fail('Artifact içindeki package.json version yanlış.','RELEASE_ARTIFACT_ASSERT');for(const required of ['electron/launcher.js','electron/main.js','server/server.js','public/index.html'])if(!fs.existsSync(path.join(verifyRoot,'app',...required.split('/'))))fail('Artifact eksik: '+required,'RELEASE_ARTIFACT_ASSERT');if(fs.existsSync(path.join(verifyRoot,'app','server','data')))fail('Artifact server/data runtime verisi içeremez.','RELEASE_ARTIFACT_DATA_LEAK');}finally{try{fs.rmSync(verifyRoot,{recursive:true,force:true});}catch(_){}}
  atomicWriteJson(path.join(DIST_ROOT,'latest.test.json'),manifest);
  fs.writeFileSync(path.join(DIST_ROOT,artifactName+'.sha256'),`${sha256}  ${artifactName}\n`,'utf8');
  return {artifactName,artifactFile,sha256,size,manifest};
}
function copyImmutable(source,target,expectedHash){
  ensureDir(path.dirname(target));
  if(fs.existsSync(target))return sha256File(target).then(actual=>{if(actual!==expectedHash)fail('Aynı version için farklı binary hedefte zaten mevcut: '+target,'RELEASE_VERSION_IMMUTABLE');return false;});
  const partial=target+'.partial-'+process.pid;try{fs.rmSync(partial,{force:true});}catch(_){}
  fs.copyFileSync(source,partial,fs.constants.COPYFILE_EXCL);fs.renameSync(partial,target);return Promise.resolve(true);
}
async function publishManifest(sourceRoot,channel,built){
  if(!['test','stable'].includes(channel))fail('Geçersiz channel.','RELEASE_CHANNEL_INVALID');
  const root=path.resolve(sourceRoot),channelRoot=path.join(root,channel),releases=path.join(channelRoot,'releases');ensureDir(releases);
  const artifactTarget=path.join(releases,built.artifactName);await copyImmutable(built.artifactFile,artifactTarget,built.sha256);
  const actual=await sha256File(artifactTarget);if(actual!==built.sha256)fail('Published artifact SHA-256 doğrulanamadı.','RELEASE_PUBLISH_VERIFY');
  const manifest={...built.manifest,channel,publishedAt:new Date().toISOString()};parseReleaseManifest(manifest,channel);
  const perVersion=path.join(releases,`BuyerLog-${manifest.version}.json`),existingVersion=readJson(perVersion,null);
  if(existingVersion&&existingVersion.sha256!==manifest.sha256)fail('Aynı semantic version farklı SHA ile zaten yayınlanmış.','RELEASE_VERSION_IMMUTABLE');
  const latestFile=path.join(channelRoot,'latest.json'),latest=readJson(latestFile,null);
  if(latest&&parseSemver(latest.version)&&compareSemver(latest.version,manifest.version)>0)fail(`Channel latest (${latest.version}) hedef version'dan (${manifest.version}) daha yeni; downgrade publish reddedildi.`,'RELEASE_DOWNGRADE_BLOCKED');
  atomicWriteJson(perVersion,manifest);fs.writeFileSync(artifactTarget+'.sha256',`${manifest.sha256}  ${built.artifactName}\n`,'utf8');atomicWriteJson(latestFile,manifest);
  const published=parseReleaseManifest(readJson(latestFile,null),channel);if(published.version!==manifest.version||published.sha256!==manifest.sha256)fail('Published manifest doğrulaması başarısız.','RELEASE_PUBLISH_VERIFY');
  return {channelRoot,artifactTarget,manifest};
}
function runSmokeTests(){
  const candidates=['tests/updater-core-v7082.test.js','tests/updater-failure-matrix-v7082.test.js','tests/version-runtime-source-v7082.test.js','tests/update-release-workflow-v7082.test.js'].filter(f=>fs.existsSync(path.join(APP_ROOT,f)));
  if(!candidates.length)return;
  childProcess.execFileSync(process.execPath,['--test',...candidates],{cwd:APP_ROOT,stdio:'inherit',env:{...process.env,BUYER_LOG_RELEASE_SMOKE:'1'}});
}
function nextVersion(kind){const current=readPackage().version;return bumpSemver(current,kind);}
module.exports={APP_ROOT,PORTABLE_ROOT,DIST_ROOT,PENDING_FILE,UPDATER_VERSION,fail,readPackage,writePackageVersion,assertGitClean,releaseSource,buildArtifact,publishManifest,runSmokeTests,nextVersion,readJson,atomicWriteJson,ensureDir,sha256File,compareSemver,parseSemver,copyImmutable};
