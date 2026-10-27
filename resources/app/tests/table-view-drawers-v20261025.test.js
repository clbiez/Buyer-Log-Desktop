'use strict';
/* Compact table/price view picker regression contract.
   Buttons retain their old data attributes so app-main's preset, price
   persistence and Fields drawer listeners continue to work unchanged. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync('public/'+name,'utf8');
const html=read('index.html');
const script=read('table-view-drawers.js');
const css=read('table-view-drawers.css');
const ui=read('ui-components.css');
const guide=read('buyerlog-guide-data.js');

function block(id,next){
  const from=html.indexOf('id="'+id+'"');
  const to=html.indexOf('id="'+next+'"',from);
  assert.ok(from>=0&&to>from,'Missing view region: '+id);
  return html.slice(from,to);
}
test('CP, Orders and Collection offer one selected view menu with Fields as final option',()=>{
  const keys={cp:'cp',orders:'orders',koleksiyon:'kol'};
  for(const [key,prefix] of Object.entries(keys)){
    const region=block(prefix+'TableViewActions',key==='cp'?'cpActiveFilters':key==='orders'?'ordersActiveFilters':'kolPriceViewActions');
    assert.match(region,new RegExp('data-bl-view-picker="'+key+'"'));
    assert.match(region,new RegExp('aria-controls="'+prefix+'ViewPickerMenu"'));
    assert.match(region,/data-bl-view-current/);
    assert.doesNotMatch(region,/class="tableViewLabel"/);
    const focus=region.indexOf('data-table-view-preset="focus"');
    const extended=region.indexOf('data-table-view-preset="extended"');
    const all=region.indexOf('data-table-view-preset="all"');
    const fields=region.indexOf('data-table-fields="'+key+'"');
    const closing=region.indexOf('</div>',fields);
    assert.ok(focus>0&&extended>focus&&all>extended&&fields>all&&closing>fields);
    assert.ok(fields<closing,'Fields must be inside picker menu');
  }
});
test('Collection price views remain independent, marked by coins and preserve options',()=>{
  const region=block('kolPriceViewActions','kolSaveState');
  assert.match(region,/data-bl-price-picker="1"/);
  assert.match(region,/<use href="#i-coins"\/>/);
  assert.match(region,/data-bl-view-current>Kompakt<\/span>/);
  assert.doesNotMatch(region,/class="tableViewLabel"/);
  const modes=['compact','detail','cost'];
  for(const mode of modes)assert.match(region,new RegExp('data-kol-price-view="'+mode+'"'));
  assert.match(region,/data-kol-price-view="compact" aria-pressed="true"/);
});
test('Collection variants are labelled dynamically with TR and EN text',()=>{
  assert.match(html,/id="kolAllVariantsToggle"[^>]*>[\s\S]*?data-bl-variant-label/);
  assert.doesNotMatch(html,/id="kolAllVariantsToggle"[^>]*><svg/);
  for(const phrase of ['Opsiyonları daralt','Opsiyonları genişlet','Collapse options','Expand options'])
    assert.ok(script.includes(phrase),phrase);
  assert.match(script,/getAttribute\('aria-pressed'\)/);
});
test('Menu tracks existing aria states and keeps keyboard/outside-close behavior',()=>{
  assert.match(script,/data-table-view-preset.*aria-pressed="true"/);
  assert.match(script,/new MutationObserver/);
  assert.match(script,/key==='Escape'/);
  assert.match(script,/key==='ArrowDown'/);
  assert.match(script,/addEventListener\('pointerdown'/);
  assert.match(script,/\.focus\(\{preventScroll:true\}\)/);
  assert.match(css,/\.blViewPickerMenu\[hidden\]\{display:none!important;/);
  assert.match(ui,/\.blViewPickerMenu\{[\s\S]*?z-index:var\(--ui-z-popover\)/);
  assert.doesNotMatch(css,/z-index\s*:/);
  assert.doesNotMatch(css,/#[0-9a-f]{3,8}/i);
});
test('Guide anchors visible picker triggers and resources load at app startup',()=>{
  assert.match(html,/table-view-drawers\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(html,/table-view-drawers\.js\?v=__BL_ASSET_VERSION__/);
  assert.ok((guide.match(/#cpTableViewActions \[data-bl-view-trigger\]/g)||[]).length>=4);
});
