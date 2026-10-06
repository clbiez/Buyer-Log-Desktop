'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Rules=require('../public/cp-rules-engine');
test('repeated condition text is converted once, preserving Turkish comparisons',()=>{
 const original=String.prototype.toLocaleLowerCase;let calls=0;
 String.prototype.toLocaleLowerCase=function(...args){calls++;return original.apply(this,args);};
 try{
  for(let i=0;i<200;i++){
   assert.equal(Rules.matchesCondition({field:'state',operator:'eq',value:' ISLAK İPLİK '},{row:{state:'ıslak iplik'}}),true);
   assert.equal(Rules.matchesCondition({field:'state',operator:'eq',value:'Other'},{row:{state:'ıslak iplik'}}),false);
  }
  assert.ok(calls<30,`conversion must not run per row (${calls})`);
 }finally{String.prototype.toLocaleLowerCase=original;}
});
test('unique values beyond the cache bound and mutable non-string values stay correct',()=>{
 for(let i=0;i<1400;i++)assert.equal(Rules.matchesCondition({field:'state',operator:'eq',value:`GÖRSEL ${i}`},{row:{state:`görsel ${i}`}}),true);
 let value='First';const mutable={toString:()=>value};
 const condition={field:'state',operator:'eq',value:'first'};
 assert.equal(Rules.matchesCondition(condition,{row:{state:mutable}}),true);
 value='Other';assert.equal(Rules.matchesCondition(condition,{row:{state:mutable}}),false);
});
