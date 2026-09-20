'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createJobRegistry}=require('../server/lib/job-registry');
test('Retry Failed returns only failed PLM ids and failure metadata stays bounded',()=>{
  let now=1000; const jobs=createJobRegistry({failureLimit:3,now:()=>++now}); const job=jobs.create('u',{kind:'plm',total:10});
  jobs.addFailure('u',job.id,{plmId:'A',model:'A',error:'x'.repeat(1000)}); jobs.addFailure('u',job.id,{plmId:'B'}); jobs.addFailure('u',job.id,{plmId:'C'}); jobs.addFailure('u',job.id,{plmId:'D'});
  assert.deepEqual(jobs.failedIds('u',job.id),['A','B','C']); assert.equal(jobs.failures('u',job.id).length,3); assert.ok(jobs.failures('u',job.id)[0].error.length<=400);
});
