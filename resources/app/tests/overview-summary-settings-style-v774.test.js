'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const DASH=fs.readFileSync(path.join(ROOT,'public','overview-collection-dashboard.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('Collection Summary obsolete Edit/pivot surface is removed and filter-column drawer replaces it',()=>{
  assert.doesNotMatch(INDEX,/ovCollectionSummarySettingsBtn/);
  assert.doesNotMatch(DASH,/openSettings/);
  assert.match(DASH,/openColumnDrawer/);
  assert.match(CSS,/\.ovCollectionScopeDrawerOverlay\{/);
  assert.match(CSS,/\.ovCollectionScopeColumnList button\{/);
});

test('Collection Summary filter is angular and its value picker supports multiple values',()=>{
  assert.match(CSS,/\.ovCollectionKpiCard,[\s\S]*\.ovCollectionStatusCard\{border-radius:0!important\}/);
  assert.match(CSS,/\.ovCollectionSummaryScopePopover\{/);
  assert.match(DASH,/input type="checkbox"/);
  assert.match(DASH,/scopeValues:Array\.isArray\(values\)/);
});
