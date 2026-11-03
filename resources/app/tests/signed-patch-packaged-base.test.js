'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const fixture=require('./helpers/manual-patch-v3-fixture.cjs');
const F=require('../electron/manual-patch/files');
const {stageApprovedTarget}=require('../../../.github/scripts/buyerlog-signed-patch-publish');
function setup(t,nested=false){
 const f=fixture(t),git=args=>cp.execFileSync('git',args,{cwd:nested?f.root:f.source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 f.write(f.source,'public/index.html','<h1>Base</h1>');
 f.write(f.source,'public/obsolete.js','old');f.write(f.base,'public/obsolete.js','old');
 f.write(f.source,'public/mirrored.png','source-only historical visual');
 f.write(f.base,'node_modules/packaged-only/index.js','verified dependency');
 f.write(f.base,'electron/update/release-source.json','{"githubSource":"github:example/releases"}');
 git(['init','-q']);
 const commit=()=>{git(['-c','core.autocrlf=false','add','-A']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-qm','reviewed source']);return git(['rev-parse','HEAD']);};
 const baseCommit=commit(),anchor=F.readBootstrap(f.base);f.write(f.base,F.ANCHOR,JSON.stringify({...anchor,sourceCommit:baseCommit}));
 f.write(f.base,'electron/app-integrity.json',F.integrityBytes(F.inventory(f.base),'7.0.294'));
 f.write(f.source,'tests/excluded.test.js','source-only regression test');
 f.write(f.source,'public/index.html','<h1>Patched</h1>');f.write(f.source,'server/new.js','new');fs.unlinkSync(path.join(f.source,'public/obsolete.js'));
 const sourceCommit=commit(),targetRoot=path.join(f.root,'target');
 return {...f,git,commit,sourceCommit,targetRoot,stage:()=>stageApprovedTarget({baseRoot:f.base,sourceRoot:f.source,targetRoot,sourceCommit})};
}
for(const nested of [false,true])test('packaged base preserves immutable dependencies and mirrored visuals while applying committed app delta ('+nested+')',t=>{
 const f=setup(t,nested),paths=f.stage();
 assert.deepEqual(paths.sort(),['public/index.html','public/obsolete.js','server/new.js']);
 assert.equal(fs.readFileSync(path.join(f.targetRoot,'public/index.html'),'utf8'),'<h1>Patched</h1>');
 assert.equal(fs.existsSync(path.join(f.targetRoot,'public/obsolete.js')),false);
 assert.equal(fs.existsSync(path.join(f.targetRoot,'public/mirrored.png')),false);
 assert.equal(fs.readFileSync(path.join(f.targetRoot,'node_modules/packaged-only/index.js'),'utf8'),'verified dependency');
 assert.equal(F.bootstrapHash(f.targetRoot),F.bootstrapHash(f.base));
 const built=f.build({sourceRoot:f.targetRoot,sourceCommit:f.sourceCommit});
 const applied=f.manager().apply(built.manifest,built.archiveFile);f.manager().verifyStaged(applied.pending);
});
test('unreviewed working files and wrong commits fail before staging',t=>{
 const f=setup(t);f.write(f.source,'public/untracked.js','unreviewed');assert.throws(f.stage,/clean and pinned/);assert.equal(fs.existsSync(f.targetRoot),false);
 fs.unlinkSync(path.join(f.source,'public/untracked.js'));
 assert.throws(()=>stageApprovedTarget({baseRoot:f.base,sourceRoot:f.source,targetRoot:f.targetRoot,sourceCommit:'0'.repeat(40)}),/clean and pinned/);
});
test('tracked immutable changes require a full installation and cannot be hidden by staging',t=>{
 const f=setup(t);f.write(f.source,'package.json','{"version":"7.0.999"}');const sourceCommit=f.commit();
 assert.throws(()=>stageApprovedTarget({baseRoot:f.base,sourceRoot:f.source,targetRoot:f.targetRoot,sourceCommit}),{code:'PATCH_BOOTSTRAP_REQUIRED'});
 assert.equal(fs.existsSync(f.targetRoot),false);
});

test('real-sized application files are verified without truncating Git blob output',t=>{
 const f=setup(t),value=Buffer.alloc(1200000,65);f.write(f.source,'public/large.js',value);const sourceCommit=f.commit();
 stageApprovedTarget({baseRoot:f.base,sourceRoot:f.source,targetRoot:f.targetRoot,sourceCommit});
 assert.equal(F.sha(F.bytes(f.targetRoot,'public/large.js')),F.sha(value));
});
