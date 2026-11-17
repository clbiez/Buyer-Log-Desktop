'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');

function harness(loader,apply=()=>{}){
  const failures=[];
  const context={window:{BLPerf:{ensureFeature:loader},applyUserAccessUI:apply,BLBootGuard:{fail:reason=>failures.push(reason)}},console:{warn(){}}};
  const start=app.indexOf('async function ensureStartupUserAccess()');
  assert.ok(start>=0,'startup access must have an independently handled readiness promise');
  vm.runInNewContext(app.slice(start,app.indexOf('function signalStartupReady()',start)),context);
  return {run:()=>context.ensureStartupUserAccess(),failures};
}

test('startup access uses the retrying feature loader and applies the loaded profile',async()=>{
  let applied=0;
  const h=harness(async name=>assert.equal(name,'userAccess'),()=>applied++);
  assert.equal(await h.run(),true);
  assert.equal(applied,1);
  assert.deepEqual(h.failures,[]);
});

test('unavailable access script reports a bounded startup failure without waiting for a page projection',async()=>{
  const h=harness(async()=>{throw new Error('503');});
  assert.equal(await h.run(),false);
  assert.deepEqual(h.failures,['user-access-failed']);
});

test('a script load event without the access API cannot silently leave startup pending',async()=>{
  const h=harness(async()=>{},null);
  assert.equal(await h.run(),false);
  assert.deepEqual(h.failures,['user-access-failed']);
});
