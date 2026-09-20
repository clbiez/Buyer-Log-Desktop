'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {assertEventAmplification}=require('../server/lib/plm-sync-v2');
test('PLM event amplification guard rejects dataset-sized event explosions',()=>{
  assert.equal(assertEventAmplification({changedCount:100,generatedEventCount:120}).ok,true);
  assert.throws(()=>assertEventAmplification({changedCount:1,generatedEventCount:11444}),e=>e&&e.code==='PLM_SYNC_EVENT_AMPLIFICATION_DETECTED');
  assert.throws(()=>assertEventAmplification({changedCount:0,generatedEventCount:1}),/PLM_SYNC_EVENT_AMPLIFICATION_DETECTED/);
});
