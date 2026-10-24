'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),cp=require('node:child_process');
const fixture=require('./helpers/manual-patch-v3-fixture.cjs');
test('the producer CLI signs only a clean exact source commit and never prints its ephemeral private key',t=>{
 const f=fixture(t),git=args=>cp.execFileSync('git',args,{cwd:f.source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-q']);git(['-c','core.autocrlf=false','add','-A']);git(['-c','user.name=Synthetic fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-qm','synthetic reviewed app']);
 const sha=git(['rev-parse','HEAD']),notes=path.join(f.root,'notes.json');fs.writeFileSync(notes,JSON.stringify({tr:'Sentetik üretici kabulü',en:'Synthetic producer acceptance'}));
 const script=path.resolve(__dirname,'../scripts/signed-manual-patch.js'),args=[script,'--base-app',f.base,'--source-app',f.source,'--out',f.out,'--sequence','1','--source-commit',sha,'--notes',notes];
 const run=()=>cp.spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,BUYER_LOG_RELEASE_SIGNING_KEY:f.privateKey}});
 const result=run();assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.includes('PRIVATE KEY'),false);
 const built=JSON.parse(result.stdout);assert.equal(built.sourceCommit,sha);f.manager().verifyStaged(f.manager().apply(JSON.parse(fs.readFileSync(built.manifest,'utf8')),built.archive).pending);
 f.write(f.source,'public/index.html','unreviewed working change');const dirty=run();assert.equal(dirty.status,1);assert.match(dirty.stderr,/PATCH_SOURCE_INVALID/);
});
