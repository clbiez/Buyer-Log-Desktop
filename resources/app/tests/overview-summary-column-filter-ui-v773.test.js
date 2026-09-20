'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('v7.73 Overview Collection Summary Column filter alanı gösterilmez',()=>{
  assert.doesNotMatch(INDEX,/ovCollectionSummaryColumnFilterBar|ovCollectionSummaryFilterColumn|ovCollectionSummaryAddFilterBtn/);
});
