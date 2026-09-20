'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {diffPlmRecords,plmFingerprint}=require('../server/lib/plm-sync-v2');
test('PLM incremental diff reports only meaningful changed records',()=>{
  const previous={}; const next={}; for(let i=0;i<11000;i++){previous[String(i)]={plmId:String(i),styleId:String(i),styleName:`S${i}`,url:`https://plm/${i}`}; next[String(i)]={...previous[String(i)]};}
  next['5500']={...next['5500'],url:'https://plm/changed'};
  const diff=diffPlmRecords(previous,next);
  assert.equal(diff.changedCount,1); assert.equal(diff.updated.length,1); assert.equal(diff.updated[0].id,'5500'); assert.equal(diff.unchanged.length,10999);
  assert.notEqual(plmFingerprint(previous['5500']),plmFingerprint(next['5500']));
});
