'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');

test('v7.74 Collection Summary ayar modali geniş ve taşma kontrollü tasarlanır',()=>{
  assert.match(CSS,/\.ovCollectionSummaryPivotModal\{[^}]*max-height:min\(/);
  assert.match(CSS,/\.ovCollectionSummaryPivotModal\{[^}]*display:flex/);
  assert.match(CSS,/\.ovCollectionSummaryPivotGrid\{[^}]*grid-template-columns:1fr 1fr 1\.2fr/);
});
