'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(root,'public','app-main.js'),'utf8');

test('v7.77 Collection Summary confirmation filtresi tek kompakt çip olarak sunulur',()=>{
  assert.match(INDEX,/class="ovCollectionSummaryFilter ovCollectionSummaryConfirmationFilter"/);
  assert.doesNotMatch(INDEX,/class="ovCollectionSummaryConfirmationButtons"/);
  assert.match(APP,/ovCollectionSummaryConfirmationLabel/);
  assert.doesNotMatch(APP,/querySelectorAll\('#ovCollectionSummary \[data-summary-confirmation\]'\)/);
});
