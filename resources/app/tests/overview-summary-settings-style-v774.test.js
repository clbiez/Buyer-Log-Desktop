'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');
const DASH=fs.readFileSync(path.join(__dirname,'..','public','overview-collection-dashboard.js'),'utf8');

test('Collection Summary generic scope uses right drawer for column and value selection',()=>{
  assert.match(CSS,/\.ovCollectionScopeDrawerOverlay\{/);
  assert.match(CSS,/\.ovCollectionScopeDrawer\{/);
  assert.match(DASH,/openScopeDrawer/);
  assert.match(DASH,/mode==='column'/);
  assert.match(DASH,/data-scope-values/);
  assert.match(DASH,/scopeSelections/);
  assert.match(DASH,/scopeColumn\|\|'inStoreMonth'/);
});

test('Collection Summary cards use squared card geometry',()=>{
  assert.match(CSS,/\.ovCollectionKpiCard\{[^}]*border-radius:0/);
  assert.match(CSS,/\.ovCollectionStatusSection\{[^}]*border-radius:0/);
  assert.match(CSS,/\.ovCollectionStatusCard\{[^}]*border-radius:0/);
});
