'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');

test('buyer annotations persist per owner and only layout decisions are editable',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-layout-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const script=`
    const assert=require('node:assert/strict');
    const store=require('./server/lib/layout-control-store');
    const saved=store.add('buyer-a',{fileName:'label.pdf',fileHash:'a'.repeat(64),templateVersion:'LCW-004.4-003.5',checks:[{rule:'STD_CARE_FIRE',ruleId:'CARE_FIRE',category:'STANDARD',source:'LCW AI',status:'REVIEW',page:1,bbox:[.1,.2,.3,.1],decision:'PENDING'},{rule:'COUNTRY_MATCH',status:'MISMATCH',category:'COUNTRY'}]}).run;
    assert.equal(saved.fileHash,'a'.repeat(64));
    assert.throws(()=>store.review('buyer-b',saved.id,{check:{rule:'STD_CARE_FIRE',decision:'APPROVED'}}),/LAYOUT_RUN_NOT_FOUND/);
    assert.throws(()=>store.review('buyer-a',saved.id,{check:{rule:'COUNTRY_MATCH',decision:'APPROVED'}}),/LAYOUT_CHECK_READ_ONLY/);
    store.review('buyer-a',saved.id,{check:{rule:'STD_CARE_FIRE',decision:'REJECTED',comment:'Use red'}});
    let record=store.listRuns('buyer-a').runs[0];assert.equal(record.checks[0].decision,'REJECTED');assert.equal(record.checks[0].comment,'Use red');assert.equal(record.reviewStatus,'REJECTED');
    store.review('buyer-a',saved.id,{check:{rule:'STD_CARE_FIRE',comment:'Retest'}});
    record=store.listRuns('buyer-a').runs[0];assert.equal(record.checks[0].decision,'REJECTED');assert.equal(record.checks[0].comment,'Retest');
    store.review('buyer-a',saved.id,{check:{rule:'MANUAL_test',page:2,bbox:[.2,.3,.1,.1],comment:'Buyer note',decision:'PENDING'}});
    record=store.listRuns('buyer-a').runs[0];assert.equal(record.checks.length,3);assert.equal(record.checks[2].category,'ANNOTATION');assert.equal(record.checks[2].comment,'Buyer note');assert.equal(record.checks[2].source,'Buyer');
    assert.equal(store.listRuns('buyer-b').runs.length,0);
    assert.ok(require('node:fs').readdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT).every(name=>['layout-control-history','.buyerlog-write-recovery'].includes(name)));
  `;
  const result=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:root},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
