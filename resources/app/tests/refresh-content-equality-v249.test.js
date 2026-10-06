'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {unchangedRefreshSummary}=require('../server/lib/refresh-content-equality');
test('identical source data skips detailed matching while keeping canonical distinct PO/colour counts',()=>{
  const orders=[{ocode:1,colour:'Red',qty:10},{ocode:1,colour:'RED',qty:10}],ant={1:{qty:10}};
  const result=unchangedRefreshSummary(orders,ant,JSON.parse(JSON.stringify(orders)),JSON.parse(JSON.stringify(ant)));
  assert.equal(result.oldOrderCount,1);assert.equal(result.newOrderCount,1);assert.equal(result.hasChanges,false);assert.deepEqual(result.details,[]);
});
test('any source field or warehouse difference requires the complete comparison',()=>{
  const orders=[{ocode:1,colour:'Red',qty:10,status:'A'}],ant={1:{qty:10}};
  for(const patch of [{qty:11},{status:'B'},{newColumn:'new'}])assert.equal(unchangedRefreshSummary(orders,ant,[{...orders[0],...patch}],ant),null);
  assert.equal(unchangedRefreshSummary(orders,ant,orders,{1:{qty:11}}),null);
});
