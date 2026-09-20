'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}

test('v5.28 In Store Month invalid/full-date values render blank instead of Date.toString text',()=>{
  const block=between(APP,'function kolMonthDisplay','function kolCurrentUserProfile');
  assert.match(block,/if\(!code\) return '';/);
  assert.doesNotMatch(block,/return norm\(value\)/);
});

test('v5.28 In Store Month suggestion catalog does not read CP/Orders Model Budget full dates',()=>{
  const block=between(APP,'function kolCatalogValues','function kolCatalogMatch');
  const branch=block.slice(block.indexOf("else if(kind==='inStoreMonth')"));
  assert.match(branch,/kolRows\|\|\[\]/);
  assert.doesNotMatch(branch,/In-Store \(Model Budget\)/);
  assert.doesNotMatch(branch,/state\.orders/);
  assert.doesNotMatch(branch,/state\.cp/);
});
