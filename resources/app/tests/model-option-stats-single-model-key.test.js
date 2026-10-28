'use strict';
// CP render profile: getModelOptionStats derived each row's model key twice
// (once directly, once inside optionKey). The default path now reuses it.
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../public/model-option-stats.js');

test('default keys give the same counts as explicit callbacks that recompute the model', () => {
  const rows=[];
  for(let i=0;i<3000;i++)rows.push({'PLM ID':i%250,'Model Name':['Kazak','kazak ','Hırka','HIRKA'][i%4]+' '+(i%90),'C.Code':i%5?'0'+(i%7):'','Order Code':1000+i,_id:i});
  rows.push({},{'Style ID':'S1','Model Name':'ı i'},{id:'r-9'});
  const fast=M.getModelOptionStats(rows,{optionMode:'unique'});
  const slow=M.getModelOptionStats(rows,{optionMode:'unique',modelKey:(row,index)=>M.modelKey(row,index),optionKey:(row,index)=>M.optionKey(row,index)});
  assert.deepEqual(fast,slow);
  assert.equal(M.optionKey(rows[0],0),M.optionKey(rows[0],0,M.modelKey(rows[0],0)));
  assert.deepEqual(rows.slice(0,3).map(M.optionKey),rows.slice(0,3).map((row,index)=>M.optionKey(row,index)),'array callback third argument is ignored');
});
