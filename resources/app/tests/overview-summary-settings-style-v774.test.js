'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');
const DASH=fs.readFileSync(path.join(__dirname,'..','public','overview-collection-dashboard.js'),'utf8');

test('Collection Summary detailed breakdown remains secondary inside settings modal',()=>{
  assert.match(CSS,/\.ovCollectionSummaryPivotModal\{/);
  assert.match(CSS,/\.ovCollectionSummaryPivotPreview\{/);
  assert.match(DASH,/Detailed breakdown|Ayrıntılı kırılım/);
  assert.match(DASH,/ovCollectionSummaryPivotPreview/);
});
