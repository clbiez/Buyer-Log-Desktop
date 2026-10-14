'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const cp=require('child_process');

const ROOT=path.resolve(__dirname,'..','..','..');
const DISTRIBUTION=path.join(ROOT,'.github','scripts','buyerlog-release-distribution.js');
const D=require(DISTRIBUTION);
const git=(cwd,...args)=>cp.execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const ID=['-c','user.name=Test','-c','user.email=test@example.invalid'];

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-push-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const remote=path.join(root,'remote.git'),work=path.join(root,'work');
  cp.execFileSync('git',['init','--bare','-q','-b','main',remote]);
  cp.execFileSync('git',['clone','-q',remote,work],{stdio:'ignore'});
  fs.writeFileSync(path.join(work,'latest.json'),'{"version":"1"}');
  git(work,'add','-A');git(work,...ID,'commit','-q','-m','base');git(work,'push','-q','origin','HEAD:main');
  return {root,remote,work};
}
function commit(work,body){fs.writeFileSync(path.join(work,'latest.json'),body);git(work,'add','-A');git(work,...ID,'commit','-q','-m',body);return git(work,'rev-parse','HEAD');}
function hook(remote,script){const file=path.join(remote,'hooks','pre-receive');fs.writeFileSync(file,`#!/bin/sh\n${script}\n`);fs.chmodSync(file,0o755);}
const skipHooks=process.platform==='win32'?'pre-receive shell hooks need POSIX sh':false;

test('release pointer push retries a reasonless remote rejection and lands the exact commit',{skip:skipHooks},t=>{
  const {remote,work}=fixture(t);
  const counter=path.join(remote,'attempts');
  hook(remote,`n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"; [ $n -ge 2 ]`);
  const parent=git(work,'rev-parse','HEAD'),local=commit(work,'{"version":"2"}');
  const errors=[];const original=console.error;console.error=line=>errors.push(String(line));
  try{assert.deepEqual(D.pushBranch(work,'main',{delayMs:1,expectedRemote:parent}),{attempts:2,commit:local});}
  finally{console.error=original;}
  assert.equal(git(remote,'rev-parse','refs/heads/main'),local);
  assert.equal(errors.length,1);
  assert.match(errors[0],/RELEASE_PUSH_ATTEMPT 1\/3/);
  assert.match(errors[0],/remote rejected|pre-receive/);
});

test('release pointer push never overwrites a release repo branch that another publication moved',t=>{
  const {root,remote,work}=fixture(t);
  const peer=path.join(root,'peer');cp.execFileSync('git',['clone','-q',remote,peer],{stdio:'ignore'});
  const parent=git(work,'rev-parse','HEAD');
  const peerHead=commit(peer,'{"version":"peer"}');git(peer,'push','-q','origin','HEAD:main');
  commit(work,'{"version":"mine"}');
  const original=console.error;console.error=()=>{};
  try{assert.throws(()=>D.pushBranch(work,'main',{delayMs:1,expectedRemote:parent}),error=>error.code==='RELEASE_REMOTE_MOVED');}
  finally{console.error=original;}
  assert.equal(git(remote,'rev-parse','refs/heads/main'),peerHead);
});

test('persistent remote rejection fails with every attempt preserved and no force push',{skip:skipHooks},t=>{
  const {remote,work}=fixture(t);
  hook(remote,'echo "quota-or-policy detail" >&2; exit 1');
  const parent=git(work,'rev-parse','HEAD');commit(work,'{"version":"3"}');
  const errors=[];const original=console.error;console.error=line=>errors.push(String(line));
  try{assert.throws(()=>D.pushBranch(work,'main',{delayMs:1,expectedRemote:parent}),error=>error.code==='RELEASE_PUSH_REJECTED'&&/quota-or-policy detail/.test(error.message));}
  finally{console.error=original;}
  assert.equal(errors.length,3);
  assert.equal(git(remote,'rev-parse','refs/heads/main'),parent);
  const source=fs.readFileSync(DISTRIBUTION,'utf8');
  const start=source.indexOf('function pushBranch'),body=source.slice(start,source.indexOf('\nfunction gh(',start));
  assert.doesNotMatch(body,/--force/);
});

test('TEST resume republishes only verified signed bytes and never rebuilds or re-uploads',()=>{
  const source=fs.readFileSync(DISTRIBUTION,'utf8');
  const start=source.indexOf('async function resumeTest'),body=source.slice(start,source.indexOf('async function promoteStable',start));
  assert.ok(start>0);
  assert.match(body,/C\.readPackage\(\)\.version!==version/);
  assert.match(body,/assertSignedForClients\(manifest\)\.verified/);
  const order=['verifyDownloaded(','verifyPublicArtifact(','publishRawMirror(','updateLatest('].map(token=>body.indexOf(token));
  assert.ok(order.every(index=>index>0));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);
  assert.doesNotMatch(body,/'release','(?:create|upload)'/);
  assert.doesNotMatch(body,/buildArtifact|release:build/);
  assert.match(source,/action==='resume-test'&&arg\)return resumeTest\(repoDir,arg\)/);
  assert.match(source,/pushBranch\(repoDir,'main',\{expectedRemote:parent\}\)/);
});

test('TEST resume workflow requires the gated run, immutable source and no build or regression rerun',()=>{
  const workflow=fs.readFileSync(path.join(ROOT,'.github','workflows','buyerlog-test-publish-resume.yml'),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s+push:/m);
  assert.match(workflow,/git\/ref\/heads\/updates\/v\$\{VERSION\}/);
  assert.match(workflow,/buyerlog-test-release\.yml/);
  assert.match(workflow,/Full regression before TEST release/);
  assert.match(workflow,/\[\[ "\$REGRESSION" == "success" \]\]/);
  assert.match(workflow,/Sign release manifest \(Ed25519\)/);
  assert.match(workflow,/grep -qF "\$SOURCE_SHA"/);
  assert.match(workflow,/curl -fsSL -H "Authorization: Bearer \$\{GH_TOKEN\}"[\s\S]*actions\/jobs\/\$\{JOB\}\/logs/);
  assert.doesNotMatch(workflow,/gh api "repos\/\$\{GITHUB_REPOSITORY\}\/actions\/jobs\/\$\{JOB\}\/logs"/);
  assert.match(workflow,/group: buyerlog-release-publish/);
  assert.match(workflow,/resume-test "\$VERSION"/);
  assert.doesNotMatch(workflow,/npm test|release:build|release-signing|BUYER_LOG_RELEASE_SIGNING_KEY|upload-artifact/);
});
