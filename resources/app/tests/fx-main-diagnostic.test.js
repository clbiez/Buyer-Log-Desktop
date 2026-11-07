'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const probe=require('../scripts/diagnose-fx-main');
function run(kind){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-fx-main-test-'));
  const child=spawnSync(process.execPath,['-e',`require(${JSON.stringify(require.resolve('../scripts/diagnose-fx-main'))}).runCase({root:process.argv[1],kind:process.argv[2],pin:false}).catch(e=>{console.error(e);process.exitCode=1});`,root,kind],{encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,child.stderr+'; retained fixture: '+root);
  const data=JSON.parse(fs.readFileSync(path.join(root,'result.json')));return {root,data};
}
test('the current FX route reads missing KUR through native Excel without entering compute',()=>{
  const {root,data}=run('missing-empty');try{
    const marker=JSON.parse(fs.readFileSync(path.join(root,'fx-diagnostic.json')));
    assert.equal(marker.scope,'runtime-contract-only');assert.equal(marker.historicalEvidence,false);assert.equal(Object.hasOwn(marker,'reviewSha'),false);
    assert.equal(data.scope,'runtime-contract-only');assert.equal(data.response.reason,'KUR Excel bulunamadı');
    assert.equal(data.computeCalls,0);assert.equal(data.excelCalls.length,1);
    assert.deepEqual(data.excelCalls[0].options,{timeoutMs:5000,serializationKey:'shared-fx'});
    assert.deepEqual(data.before,data.after);assert.equal(data.fxMetrics.resultTransport,'message-port');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native valid KUR keeps sparse values and revision semantics in the current FX route',()=>{
  const {root,data}=run('valid-empty');try{
    assert.equal(data.computeCalls,0);assert.equal(data.response.updated,true);assert.equal(data.after._revision,data.before._revision+1);
    assert.equal(data.after.months['2026-09'].TRY,38);assert.equal(data.after.months['2026-10'].CHF,.88);
    assert.deepEqual(data.after.months['2026-11'],{USD:1,TRY:40,EUR:.95});assert.equal(data.after.folderSync,null);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('probe gates distinguish valid waiting from admission failure without changing FX policy',()=>{
  assert.doesNotThrow(()=>probe.verifyCase({kind:'valid-queued',computeCalls:0,excelCalls:[{options:{timeoutMs:5000,serializationKey:'shared-fx'}}],
    response:{updated:true},before:{_revision:1},after:{_revision:2,folderSync:null},fxMetrics:{queueWaitMs:6000},errors:[]}));
  assert.throws(()=>probe.verifyCase({kind:'valid-queued',computeCalls:0,excelCalls:[{options:{timeoutMs:5000,serializationKey:'shared-fx'}}],
    response:{updated:false},before:{_revision:1},after:{_revision:1,folderSync:null},fxMetrics:{queueWaitMs:6000},errors:[]}),/updated|true|revision/i);
});
