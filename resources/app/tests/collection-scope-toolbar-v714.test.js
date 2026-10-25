'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','collection-analytics.css'] );
const HTML=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('v7.14 Collection View/Scope bar is a compact single-row ERP toolbar',()=>{
  assert.match(CSS,/\.kolScopeBar\{[\s\S]*align-items:center[\s\S]*flex-wrap:nowrap[\s\S]*padding:4px 7px[\s\S]*min-height:32px/);
  assert.match(CSS,/\.kolScopeBar\{[^}]*background:var\(--ui-surface\)/);
  require('./helpers/manifest-css').assertReset();
  assert.doesNotMatch(CSS.slice(0,CSS.indexOf('.collectionAnalytics{')),/linear-gradient/);
});

test('v7.14 Collection preset buttons use the same compact square control language as quick filters',()=>{
  assert.match(CSS,/\.kolScopePresets \.tbtn\{[^}]*height:25px[^}]*padding:3px 9px/);
  require('./helpers/manifest-css').assertReset();
  assert.match(CSS,/\.kolScopePresets \.tbtn\.isActive,[^{]*\{[^}]*background:var\(--ui-selected\)[^}]*color:var\(--ui-selected-ink\)/);
  assert.match(CSS,/content:'✓'/);
});

test('v7.14 Collection scope dimension chips match preset height and active state',()=>{
  assert.match(CSS,/\.kolScopeDim>summary\{[^}]*height:25px[^}]*padding:3px 9px/);
  require('./helpers/manifest-css').assertReset();
  assert.match(CSS,/\.kolScopeDim\[open\]>summary,\.kolScopeDim\.hasSelection>summary\{[^}]*background:var\(--ui-selected\)[^}]*color:var\(--ui-selected-ink\)/);
  require('./helpers/manifest-css').assertFocus();
});

test('v7.14 nested preset card styling is removed and dropdown stays compact',()=>{
  assert.match(CSS,/\.kolScopePresets\{padding:0/); assert.match(CSS,/\.kolScopePresets\{background:transparent/);
  require('./helpers/manifest-css').assertReset();
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
