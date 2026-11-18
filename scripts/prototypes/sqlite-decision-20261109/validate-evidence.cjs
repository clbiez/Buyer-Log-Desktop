'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {oracle}=require('./oracle.cjs');
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(raw.validation,'subset-passed');
assert.equal(raw.environment.versions.electron,'44.3.0');
assert.equal(raw.environment.versions.node,'24.20.0');
assert.deepEqual(raw.config.sizes,[10000,200000]);
assert.equal(raw.config.rounds,3);assert.equal(raw.config.operations,300);
assert.equal(raw.trials.length,12);assert.equal(raw.crashes.length,12);
for(const size of raw.config.sizes){
 const expected=oracle(size,630);
 for(let round=1;round<=3;round++){
  const pair=raw.trials.filter(t=>t.size===size&&t.round===round);
  assert.deepEqual(pair.map(t=>t.engine),round%2?['local','sqlite']:['sqlite','local']);
  for(const t of pair){
   assert.equal(t.finalDigest,expected);assert.equal(t.reopened.digest,expected);
   assert(t.readyMs>=t.startupMs);assert(t.initialHydrateMs>=0);
   assert(t.backup.businessAndEventIdentityRestored);
   assert.equal(t.backup.productionBackupParity,false);
   for(const [kind,n] of Object.entries({get:150,filter:60,pending:30,singleWrite:30,batch20:30}))assert.equal(t.latencies[kind].count,n);
  }
  for(const key of ['finalDigest','eventIds','pending','checksum','addedEvents'])assert.equal(pair[0][key],pair[1][key]);
 }
}
console.log('PASS 12 alternating trials, independent business oracle, restore/reopen and sample counts. This is subset evidence; full contract remains BLOCKED.');
const warnings=raw.trials.filter(t=>/SHARED_LEASE_LOST/.test(t.stdout+t.stderr));
console.log(JSON.stringify({leaseWarningTrials:warnings.map(t=>({engine:t.engine,size:t.size,round:t.round})),leaseControl: warnings.length?'INVALID_FOR_UNQUALIFIED_PERFORMANCE_PASS':'no warning observed; not a general lease proof'}));
