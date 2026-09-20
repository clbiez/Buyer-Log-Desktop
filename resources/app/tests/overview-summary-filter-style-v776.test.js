'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');

test('v7.76 Collection Summary hızlı filtreleri CP ölçülerini kullanır',()=>{
  assert.match(CSS,/\.ovCollectionSummaryFilter>summary\{[^}]*height:30px/);
  assert.match(CSS,/\.ovCollectionSummaryConfirmationButtons button\{[^}]*height:30px/);
  assert.match(CSS,/\.ovCollectionSummaryConfirmationButtons button:hover,\.ovCollectionSummaryConfirmationButtons button\.isActive\{[^}]*background:var\(--acc-bg\)/);
});
