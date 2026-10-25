'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
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
  require('./helpers/manifest-css').assertReset();
  assert.match(CSS,/\.ovCollectionSummaryScopePopover\{/);
  assert.match(DASH,/input type="checkbox"/);
  assert.match(DASH,/scopeValues:Array\.isArray\(values\)/);
});


test('Collection Summary value picker is portaled to the viewport so widget overflow cannot clip it',()=>{
  assert.match(DASH,/document\.body\.appendChild\(pop\)/);
  assert.match(DASH,/trigger\.getBoundingClientRect\(\)/);
  assert.match(DASH,/pop\.style\.position='fixed'/);
  assert.match(DASH,/pop\.style\.zIndex='var\(--ui-z-popover\)'/);
  assert.match(DASH,/window\.addEventListener\('scroll',viewportHandler,true\)/);
  assert.match(DASH,/restoreValuePopover\(pop\)/);
});
