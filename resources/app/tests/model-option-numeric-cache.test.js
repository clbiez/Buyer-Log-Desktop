'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),stats=require('../public/model-option-stats');
test('33k numeric order identities do not evict model/colour text or change counts',()=>{
 const rows=Array.from({length:33000},(_,index)=>({'PLM ID':880000+index%30,'Model Name':`ıslak model ${index%30}`,'C.Code':`S${index%4}`,'Order Code':4100000+index}));
 const original=String.prototype.toLocaleUpperCase;let calls=0;String.prototype.toLocaleUpperCase=function(...args){calls++;return original.apply(this,args);};
 try{
  stats.getModelOptionStats(rows);assert.equal(stats.getOrderCount(rows),33000);
  assert.ok(calls<100,`numeric IDs must not thrash the model text cache (${calls})`);
 }finally{String.prototype.toLocaleUpperCase=original;}
 assert.equal(stats.orderKey({'Order Code':'00123'}),'order:00123');
 assert.equal(stats.orderKey({'Order Code':1e21}),'order:1E+21');
});
