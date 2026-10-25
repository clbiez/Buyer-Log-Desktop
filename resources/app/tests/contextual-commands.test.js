'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Commands=require('../public/contextual-commands');
test('context commands describe prerequisites without preparing or loading modules',()=>{
 let prepared=0,context={token:'owner:line-1',rows:[]};const registry=Commands.create({snapshot:()=>context,onUnavailable(){},actions:[{id:'costing',label:()=> 'Create costing',guard:ctx=>ctx.rows.length===1?'':'Select one record',prepare:()=>prepared++,run(){}}]});const item=registry.commands()[0];assert.equal(item.disabled,true);assert.equal(item.reason,'Select one record');assert.equal(prepared,0);
});
test('a displayed command rechecks canonical selection and current permission before any work',async()=>{
 let context={token:'owner:line-1',rows:[{}]},allowed=true,writes=0,prepared=0;const notices=[];
 const registry=Commands.create({snapshot:()=>context,onUnavailable:message=>notices.push(message),changedLabel:()=> 'Selection changed',actions:[{id:'costing',label:()=> 'Create costing',guard:()=>allowed?'':'Access revoked',prepare:()=>prepared++,run:()=>writes++}]});
 const item=registry.commands()[0];context={token:'owner:line-2',rows:[{}]};await item.run();assert.equal(writes,0);assert.equal(prepared,0);assert.equal(notices.at(-1),'Selection changed');context={token:'owner:line-1',rows:[{}]};allowed=false;await item.run();assert.equal(writes,0);assert.equal(prepared,0);assert.equal(notices.at(-1),'Access revoked');
});
test('revocation or owner change during a lazy load prevents the native action',async()=>{
 let context={token:'buyer-a:record-1',rows:[{}]},allowed=true,resume,writes=0;
 const registry=Commands.create({snapshot:()=>context,onUnavailable(){},actions:[{id:'report',label:()=> 'Report',guard:()=>allowed?'':'Access revoked',prepare:()=>new Promise(resolve=>resume=resolve),run:()=>writes++}]});const item=registry.commands()[0],pending=item.run();allowed=false;resume();await pending;assert.equal(writes,0);
 allowed=true;const second=item.run();context={token:'buyer-b:record-1',rows:[{}]};resume();await second;assert.equal(writes,0);
});
test('a stable canonical record can refresh display IDs and invoke exactly one existing action',async()=>{
 let context={token:'buyer-a:canonical-1',rows:[{id:1}]},writes=0;const registry=Commands.create({snapshot:()=>context,onUnavailable(){},actions:[{id:'report',label:()=> 'Report',guard:()=>'',prepare:()=>{context={token:'buyer-a:canonical-1',rows:[{id:99}]};},run:ctx=>{assert.equal(ctx.rows[0].id,99);writes++;}}]});await registry.commands()[0].run();assert.equal(writes,1);
});
