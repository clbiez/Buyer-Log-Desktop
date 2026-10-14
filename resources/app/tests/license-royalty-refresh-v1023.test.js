const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function between(start, end) {
  const from = APP.indexOf(start);
  const to = APP.indexOf(end, from + start.length);
  assert.ok(from >= 0, `başlangıç bulunamadı: ${start}`);
  assert.ok(to > from, `bitiş bulunamadı: ${end}`);
  return APP.slice(from, to);
}

test('Yenileme sonrası lisans royalty kuralları yüklenen CP, Siparişler ve özet satırlarına uygulanır', () => {
  const load = between('async function loadFromServer(', 'let sharedRevisionSnapshot');
  const ordersLoad = between('async function ensureOrdersLoaded(options={})', 'window.BLEnsureOrdersLoaded=ensureOrdersLoaded');

  assert.match(load, /state\.orderSummary\s*=\s*\{\s*fname:\s*`Sunucu:/);
  assert.match(load, /applyPricingRulesToLoadedRows\(\{render:false\}\)/);
  assert.match(ordersLoad, /state\.orders\s*=\s*\{fname:`Sunucu:/);
  assert.match(ordersLoad, /applyPricingRulesToLoadedRows\(\{render:false\}\)/);
});

test('Kural uygulama yardımcı fonksiyonu yeniden hesaplamayı çizimden ayırır', () => {
  const helper = between('function applyPricingRulesToLoadedRows', 'function syncPricingRulesToAllLoadedViews');
  assert.match(helper, /function applyPricingRulesToLoadedRows\(\{render=true\}=\{\}\)/);
  assert.match(helper, /if\(render\)\{\s*if\(state\.orders\)renderOrders\(\);/);
});

/* v10.24 — Kural seti hidrasyonu sürüm korumalıdır.
   Sunucu overrides.json'u okuyamadığında boş + revizyon 0 yanıt dönebiliyor;
   bu yanıt ekrandaki geçerli kuralları silmemeli. */
test('Kural hidrasyonu tek bir sürüm korumalı yardımcıdan geçer', () => {
  const helper = between('function applyIncomingPricingRules', 'async function refreshPricingRulesFromServer');
  assert.match(helper, /const stale=Number\.isFinite\(incomingRevision\)&&current>0&&incomingRevision<current;/);
  assert.match(helper, /if\(stale&&\(hasCurrent\|\|!next\.length\)\)\{/);
  assert.match(helper, /state\.storeRevisions\.pricingRules=current;\s*return false;/);
});

test('Açılış yüklemesi ve canlı senkron kuralları doğrudan değil yardımcı üzerinden yazar', () => {
  const load = between('async function loadFromServer(', 'let sharedRevisionSnapshot');
  const refresh = between('async function refreshPricingRulesFromServer()', 'function pricingRuleMatchCount');

  // Açılış yanıtı, storeRevisions birleştirilmeden önceki revizyonla kıyaslanır.
  assert.match(load, /const knownPricingRulesRevision=Number\(state\.storeRevisions\.pricingRules\)\|\|0;/);
  assert.match(load, /applyIncomingPricingRules\(incomingPricingRules,data\.storeRevisions&&data\.storeRevisions\.pricingRules,\{knownRevision:knownPricingRulesRevision\}\)/);
  assert.match(refresh, /applyIncomingPricingRules\(data\.rules\|\|\[\],data\.revision\);/);

  // Hidrasyon yollarında ham atama kalmamalı.
  const rawAssign = /state\.overrides\.pricingRules\s*=\s*normalizePricingRules\(/;
  assert.equal(rawAssign.test(load), false, 'loadFromServer kuralları hâlâ doğrudan yazıyor');
  assert.equal(rawAssign.test(refresh), false, 'refreshPricingRulesFromServer kuralları hâlâ doğrudan yazıyor');
});
