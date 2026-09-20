'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const MAIN=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

test('v7.79 Collection Summary filtrelerinde aynı anda yalnızca bir açılır pencere açık kalır',()=>{
  assert.match(MAIN,/function overviewCollectionSummaryBindExclusiveFilters\(\)\{[\s\S]*?addEventListener\('toggle'/);
  assert.match(MAIN,/other\.open=false/);
  assert.match(MAIN,/overviewCollectionSummaryBindExclusiveFilters\(\);\s*overviewCollectionSummaryRenderFilter/);
});
