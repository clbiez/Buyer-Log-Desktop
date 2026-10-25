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
const css=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const perf=fs.readFileSync(path.join(ROOT,'public','perf-runtime.js'),'utf8');

test('v6.66 LFL analiz modülü genel section görünürlük kuralına takılmaz',()=>{
  assert.match(css,/section\{display:none;\}\s*section\.active\{display:block;\}/);
  // Fiyat & Üretici Analizi v3: Üretici & Ülke Sipariş Analizi LFL'den ayrılıp Fiyat & Üretici
  // Analizi'ne taşındı; LFL görünümünde artık o panel yok.
  assert.doesNotMatch(html,/id="lflOrderAnalytics"/);
});

test('v7.64 fiyat ve üretici analizi bağımsız ana navigasyon modülüdür',()=>{
  assert.match(html,/data-tab="priceanalysis"/);
  assert.match(html,/<section id="view-priceanalysis"[^>]*>/);
  assert.doesNotMatch(html,/id="collectionAnalytics"/);
});

test('v6.66 analiz betikleri Overview açılışını bloklamadan lazy feature kaydından yüklenir',()=>{
  assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*lfl\.js/);
  assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*price-supplier-analysis\.js/);
  assert.match(perf,/lfl:\[[^\]]*'lfl\.js/);
  assert.match(perf,/collectionTools:\[[^\]]*'price-supplier-insights-engine\.js','price-supplier-analysis\.js'/);
});
