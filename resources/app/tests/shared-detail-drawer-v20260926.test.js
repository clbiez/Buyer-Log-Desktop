'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const drawer=require('../public/detail-drawer.js');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const LFL=fs.readFileSync(path.join(ROOT,'public','lfl.js'),'utf8');
const BACKLOG=fs.readFileSync(path.join(ROOT,'public','backlog-delivery-analysis.js'),'utf8');
const CP=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.js'),'utf8');

test('ortak detay çekmecesi sütun kataloğunu özel alanlardan arındırır',()=>{
  const cols=drawer.inferColumns([{A:1,_internal:2,B:3},{C:4}]);
  assert.deepEqual(cols.map(c=>c.key),['A','B','C']);
});
test('ortak detay çekmecesi index üzerinde CSS ve JS ile yüklenir',()=>{
  assert.match(INDEX,/detail-drawer\.css/);
  assert.match(INDEX,/detail-drawer\.js/);
});
test('LFL ve Supplier drilldown ortak sağ detay çekmecesini kullanır',()=>{
  assert.match(LFL,/BLDetailDrawer\.open\(\{storageKey:'lfl\./);
  assert.match(LFL,/storageKey:'lfl\.portfolio\.detail'/);
});
test('Backlog analiz drilldown ortak sağ detay çekmecesini kullanır',()=>{
  assert.match(BACKLOG,/storageKey:'backlog\.analysis\.detail'/);
  assert.match(BACKLOG,/images:true/);
});
test('CP Attention satırı navigasyon yerine ortak detay çekmecesini açar',()=>{
  assert.match(CP,/function openAttentionDetail\(/);
  assert.match(CP,/storageKey:'cp\.attention\.detail'/);
  assert.match(CP,/openAttentionDetail\(el\.dataset\.cpaOrderKey\)/);
});
test('Ortak drawer Excel export için tüm veya görünen sütun seçimi sunar',()=>{
  const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
  assert.ok(DRAWER.includes('data-bl-export-mode="all"'));
  assert.ok(DRAWER.includes('data-bl-export-mode="visible"'));
  assert.ok(DRAWER.includes("mode==='all'?active.columns:currentColumns()"));
  assert.ok(DRAWER.includes('moveAndSizeWithCells:true'));
});
test('Ortak drawer sütun tercihlerini aktif sayfa ile scope eder',()=>{
  const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
  assert.ok(DRAWER.includes('document.body.dataset.activeTab'));
  assert.ok(DRAWER.includes('prefKey(scope,page)'));
  assert.ok(DRAWER.includes('saveVisible(active.scope,active.pageScope,keys)'));
});
test('Ortak drawer boş hücrelerde canonical ve nested kaynak fallback uygular',()=>{
  const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
  assert.ok(DRAWER.includes('BLCanonicalFields'));
  assert.ok(DRAWER.includes('canonical.canonicalValue'));
  assert.ok(DRAWER.includes('source.raw'));
  assert.ok(DRAWER.includes('source.row'));
});
test('Ortak drawer sol kenardan yeniden boyutlandırılabilir',()=>{
  const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
  const CSS=fs.readFileSync(path.join(ROOT,'public','detail-drawer.css'),'utf8');
  assert.ok(DRAWER.includes('data-bl-detail-resize'));
  assert.ok(DRAWER.includes('startWidth+(startX-ev.clientX)'));
  assert.ok(CSS.includes('cursor:ew-resize'));
});
