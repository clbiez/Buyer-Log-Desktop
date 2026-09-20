'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const Q=fs.readFileSync(path.join(ROOT,'public','quotations.js'),'utf8');

test('v5.68 Quotations resolves current Collection imgRef images',()=>{
  assert.match(Q,/function qCollectionImageSrc\(row,item=null\)/);
  assert.match(Q,/const ref=qNorm\(row\.imgRef\);/);
  assert.match(Q,/return `\/api\/collection-images\/\$\{encodeURIComponent\(ref\)\}`/);
  assert.match(Q,/const modelImage=qCollectionImageSrc\(collectionRow,item\)/);
});

test('v5.68 new quotation records persist the resolved Collection image source',()=>{
  assert.match(Q,/picture:qCollectionImageSrc\(row\),inStoreMonth:/);
});

test('v5.68 quotation history uses the same Collection image resolver',()=>{
  assert.match(Q,/picture:qNorm\(row\?\.img[\s\S]*?row\?\.imgRef[\s\S]*?\/api\/collection-images\//);
  assert.match(Q,/picture:meta\.picture\|\|qNorm\(item\.picture\)\|\|''/);
});
