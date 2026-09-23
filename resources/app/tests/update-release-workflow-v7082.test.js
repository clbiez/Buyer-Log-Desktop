'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const childProcess=require('child_process');
const C=require('../scripts/release-common');
const { parseReleaseManifest }=require('../electron/update/manifest');
function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-release-test-'));}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

test('publish channel is immutable for a semantic version',async t=>{const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const artifact=path.join(root,'fixture.zip');fs.writeFileSync(artifact,'binary-one');const sha=hash(artifact),built={artifactName:'BuyerLog-7.0.82.zip',artifactFile:artifact,sha256:sha,size:fs.statSync(artifact).size,manifest:{schemaVersion:1,channel:'test',version:'7.0.82',publishedAt:new Date().toISOString(),artifact:'releases/BuyerLog-7.0.82.zip',sha256:sha,size:fs.statSync(artifact).size,mandatory:false,releaseNotes:'x',minimumUpdaterVersion:'1.0.0'}};await C.publishManifest(path.join(root,'source'),'test',built);await C.publishManifest(path.join(root,'source'),'test',built);fs.writeFileSync(artifact,'binary-two');built.sha256=hash(artifact);built.size=fs.statSync(artifact).size;built.manifest={...built.manifest,sha256:built.sha256,size:built.size};await assert.rejects(()=>C.publishManifest(path.join(root,'source'),'test',built),/farklı binary|different binary|Aynı version/);});

test('TEST artifact promotes to STABLE byte-for-byte without rebuild',t=>{const root=tmp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source'),releases=path.join(source,'test','releases');fs.mkdirSync(releases,{recursive:true});const artifact=path.join(releases,'BuyerLog-7.0.82.zip');fs.writeFileSync(artifact,'verified-test-artifact');const sha=hash(artifact),manifest={schemaVersion:1,channel:'test',version:'7.0.82',publishedAt:new Date().toISOString(),artifact:'releases/BuyerLog-7.0.82.zip',sha256:sha,size:fs.statSync(artifact).size,mandatory:false,releaseNotes:'fixture',minimumUpdaterVersion:'1.0.0'};parseReleaseManifest(manifest,'test');fs.writeFileSync(path.join(releases,'BuyerLog-7.0.82.json'),JSON.stringify(manifest));const script=path.join(C.APP_ROOT,'scripts','release-promote.js');const run=childProcess.spawnSync(process.execPath,[script,'7.0.82','--source',source],{encoding:'utf8'});assert.equal(run.status,0,run.stderr||run.stdout);const stable=path.join(source,'stable','releases','BuyerLog-7.0.82.zip');assert.equal(hash(stable),sha);assert.equal(hash(artifact),sha);const latest=JSON.parse(fs.readFileSync(path.join(source,'stable','latest.json'),'utf8'));assert.equal(latest.sha256,sha);assert.equal(latest.channel,'stable');});

test('release scripts expose deterministic bump/build/promote entry points',()=>{const pkg=require('../package.json');assert.match(pkg.scripts['release:test'],/release-publish/);assert.match(pkg.scripts['release:patch'],/--bump patch/);assert.match(pkg.scripts['release:promote'],/release-promote/);assert.match(pkg.scripts['version:assert'],/version-assert/);});


test('release workflows can be triggered from repository request files without rebuilding STABLE',()=>{
  const root=path.resolve(__dirname,'..','..','..');
  const testWorkflow=fs.readFileSync(path.join(root,'.github','workflows','buyerlog-test-release.yml'),'utf8');
  const stableWorkflow=fs.readFileSync(path.join(root,'.github','workflows','buyerlog-promote-stable.yml'),'utf8');
  const versionWorkflow=fs.readFileSync(path.join(root,'.github','workflows','buyerlog-version-branch.yml'),'utf8');
  assert.match(testWorkflow,/release-requests\/test\.json/);
  assert.match(testWorkflow,/SOURCE_SHA/);
  assert.match(testWorkflow,/--notes "\$RELEASE_NOTES"/);
  assert.match(stableWorkflow,/release-requests\/stable\.json/);
  assert.match(stableWorkflow,/promote-stable "\$PROMOTE_VERSION"/);
  assert.match(versionWorkflow,/paths-ignore:[\s\S]*release-requests\/\*\*/);
});


test('GitHub release publisher creates the release first and uploads missing assets explicitly',()=>{
  const source=fs.readFileSync(path.join(C.APP_ROOT,'scripts','github-release.js'),'utf8');
  assert.match(source,/function releaseAssetNames\(channel,version\)/);
  assert.match(source,/function ensureReleaseAssets\(channel,version,manifest,files,dir\)/);
  assert.match(source,/\['release','upload',tag\(channel,version\),\.\.\.missing\]/);
  assert.doesNotMatch(source,/\['release','create',tag\('test',manifest\.version\),artifact,per/);
  assert.doesNotMatch(source,/\['release','create',tag\('stable',version\),artifact,stableManifestFile/);
});


test('STABLE promotion reads the verified TEST manifest from the release repo and downloads the public ZIP without gh manifest download',()=>{
  const source=fs.readFileSync(path.join(C.APP_ROOT,'scripts','github-release.js'),'utf8');
  const start=source.indexOf('async function promoteStable');
  const end=source.indexOf('async function main()',start);
  const body=source.slice(start,end);
  assert.match(body,/path\.join\(repoDir,'test','latest\.json'\)/);
  assert.match(body,/provider\.copyArtifact\('test',test\.artifact,artifact,version\)/);
  assert.match(body,/TEST public artifact SHA\/boyut doğrulaması başarısız/);
  assert.doesNotMatch(body,/gh\(\['release','download',tag\('test',version\),'--pattern',name/);
});
