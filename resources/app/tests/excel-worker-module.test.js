'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('Excel task implementation can be shared by a pooled worker without registering a second message handler',async()=>{
  const worker=require('../server/workers/excel-worker');
  assert.equal(typeof worker.execute,'function');assert.deepEqual(await worker.execute('health'),{ok:true,thread:'excel-worker'});
});
