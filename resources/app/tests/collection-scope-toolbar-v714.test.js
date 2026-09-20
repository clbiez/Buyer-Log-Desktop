'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const CSS=fs.readFileSync(path.join(ROOT,'public','collection-analytics.css'),'utf8');
const HTML=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('v7.14 Collection View/Scope bar is a compact single-row ERP toolbar',()=>{
  assert.match(CSS,/\.kolScopeBar\{[\s\S]*align-items:center[\s\S]*flex-wrap:nowrap[\s\S]*padding:4px 7px[\s\S]*min-height:32px/);
  assert.match(CSS,/\.kolScopeBar\{[\s\S]*background:var\(--card\);box-shadow:none/);
  assert.doesNotMatch(CSS.slice(0,CSS.indexOf('.collectionAnalytics{')),/linear-gradient/);
});

test('v7.14 Collection preset buttons use the same compact pill language as quick filters',()=>{
  assert.match(CSS,/\.kolScopePresets \.tbtn\{[\s\S]*height:25px[\s\S]*padding:3px 9px[\s\S]*border:1px solid var\(--hair,var\(--line\)\)[\s\S]*border-radius:var\(--r-full,999px\)/);
  assert.match(CSS,/\.kolScopePresets \.tbtn\.isActive[\s\S]*background:var\(--acc-bg\);border-color:var\(--acc\);color:var\(--acc-ink\)/);
  assert.match(CSS,/content:'✓'/);
});

test('v7.14 Collection scope dimension chips match preset height and active state',()=>{
  assert.match(CSS,/\.kolScopeDim>summary\{[\s\S]*height:25px[\s\S]*border-radius:var\(--r-full,999px\)[\s\S]*padding:3px 9px/);
  assert.match(CSS,/\.kolScopeDim\[open\]>summary,\.kolScopeDim\.hasSelection>summary\{[\s\S]*border-color:var\(--acc\);background:var\(--acc-bg\);color:var\(--acc-ink\)/);
  assert.match(CSS,/\.kolScopeDim>summary:focus-visible\{outline:none;box-shadow:var\(--focus-ring\)\}/);
});

test('v7.14 nested preset card styling is removed and dropdown stays compact',()=>{
  assert.match(CSS,/\.kolScopePresets\{padding:0;border:0;border-radius:0;background:transparent\}/);
  assert.match(CSS,/\.kolScopePanel>input\{[\s\S]*height:28px/);
  assert.match(CSS,/\.kolScopeOptions label\{[\s\S]*padding:5px 4px/);
});

test('v7.14 responsive rules avoid summary-driven wrapping and keep controlled toolbar wrapping',()=>{
  assert.match(CSS,/@media\(max-width:1200px\)\{\.kolScopeSummary\{display:none\}\}/);
  assert.match(CSS,/@media\(max-width:980px\)\{[\s\S]*\.kolScopeBar\{flex-wrap:wrap/);
  assert.match(CSS,/@media\(max-width:650px\)\{[\s\S]*height:24px;min-height:24px/);
});

test('v7.14 Collection toolbar CSS is cache-busted in the app shell',()=>{
  // v7.15: iddia belirli bir sürüm numarasını değil, önbellek etiketinin
  // VARLIĞINI çivilemeli; aksi halde her sürüm yükseltmesinde kırılıyor.
  assert.match(HTML,/collection-analytics\.css\?v=__BL_ASSET_VERSION__&rev=\d+/);
});
