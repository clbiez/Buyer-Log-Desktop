'use strict';
// NOT (v7.00): sürüm etiketi iddiaları belirli bir sürüm numarasını değil,
// önbellek etiketinin VARLIĞINI çivilemelidir; her sürüm yükseltmesinde
// kırılmasınlar diye kalıp \d+\.\d+ olarak gevşetildi.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const perf=fs.readFileSync(path.join(ROOT,'public','perf-runtime.js'),'utf8');

test('v6.66 LFL analiz modülü genel section görünürlük kuralına takılmaz',()=>{
  assert.match(css,/section\{display:none;\}\s*section\.active\{display:block;\}/);
  assert.match(html,/<div class="lflCard lflOrderAnalytics" id="lflOrderAnalytics" role="region"/);
  assert.doesNotMatch(html,/<section[^>]+id="lflOrderAnalytics"/);
});

test('v7.64 fiyat ve üretici analizi bağımsız ana navigasyon modülüdür',()=>{
  assert.match(html,/data-tab="priceanalysis"/);
  assert.match(html,/<section id="view-priceanalysis">/);
  assert.doesNotMatch(html,/id="collectionAnalytics"/);
});

test('v6.66 analiz betikleri Overview açılışını bloklamadan lazy feature kaydından yüklenir',()=>{
  assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*lfl-order-analytics\.js/);
  assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*collection-analytics\.js/);
  assert.match(perf,/lfl:\[[^\]]*'lfl-order-analytics\.js'/);
  assert.match(perf,/collectionTools:\[[^\]]*'collection-analytics\.js'/);
});
