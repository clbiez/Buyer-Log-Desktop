'use strict';

/* SİPARİŞLER — GÜNCELLENİYOR GÖSTERGESİ (ADR-0003 §6E UX bulgusu)
 *
 * #1232'den sonra CP yazımı / uzak yama Siparişler penceresini geçersiz kılar; güncel değer yeniden
 * sorgu bitince (ölçüm: 3,8–9 sn) gelir. O sürede tablo eski değeri UYARISIZ gösteriyordu. Gösterge:
 *  - tablo gizlenmez, satırlar/filtreler/seçim korunur; #ordersTable aria-busy, araç çubuğunda
 *    role=status "Güncelleniyor… / Updating…";
 *  - yalnız güncellemeyi başlatan değişiklikten SONRAKİ sürümün (epoch) sorgusu başarıyla gelince kalkar;
 *    yerini alan (eski) sorgu yanıtı kaldırmaz;
 *  - sorgu başarısızsa "Güncellenemedi: gösterilen değerler eski olabilir" + Tekrar dene; eski değer
 *    sessizce güncel sayılmaz;
 *  - okuma modeli kapalıysa gösterge kalmaz (eski yol satırları zaten günceller).
 * Performans çözümü değildir; yalnız güncellik bildirimidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function element() {
  const attrs = new Map();
  return {
    hidden: true, textContent: '', innerHTML: '', dataset: {}, played: 0,
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
  };
}
function harness({ enabled = true } = {}) {
  const status = element(), table = element();
  const ordersRM = { epoch: 4, refreshEpoch: null, refreshFailed: false };
  const env = { enabled };
  const globals = {
    ordersRM, appLang: 'tr',
    ordersReadModelEnabled: () => env.enabled,
    escapeHtml: value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]),
    document: { getElementById: id => (id === 'ordersRefreshState' ? status : id === 'ordersTable' ? table : null) },
    window: { BLMotionPlus: { play: (kind, el) => { assert.equal(kind, 'card'); el.played++; } } },
  };
  const fns = loadAppMainFunctions(['ordersRMMarkRefreshing', 'ordersRMRefreshSettled', 'ordersRMRenderRefreshState'], globals);
  return {
    ...fns, ordersRM, status, table,
    set lang(value) { fns.context.appLang = value; },
    set enabled(value) { env.enabled = value; },
  };
}

test('değişiklik sonrası: tablo görünür kalır, aria-busy ve "Güncelleniyor…" durumu; görünme hareketi bir kez', () => {
  const h = harness();
  h.ordersRM.epoch = 5;
  h.ordersRMMarkRefreshing();
  assert.equal(h.status.hidden, false);
  assert.equal(h.status.dataset.state, 'busy');
  assert.equal(h.status.textContent, 'Güncelleniyor…');
  assert.equal(h.table.getAttribute('aria-busy'), 'true');
  h.ordersRMMarkRefreshing();
  assert.equal(h.status.played, 1, 'motion only when it appears');
  h.lang = 'en'; h.ordersRMRenderRefreshState();
  assert.equal(h.status.textContent, 'Updating…', 'active language read at render time');
});

test('yalnız güncellemeyi başlatan sürümün ya da sonrasının yanıtı göstergeyi kaldırır; eski yanıt kaldırmaz', () => {
  const h = harness();
  h.ordersRM.epoch = 6; h.ordersRMMarkRefreshing();
  h.ordersRMRefreshSettled(5, true);
  assert.equal(h.status.hidden, false, 'response for an older generation does not clear');
  h.ordersRMRefreshSettled(6, true);
  assert.equal(h.status.hidden, true);
  assert.equal(h.table.getAttribute('aria-busy'), null);
  assert.equal(h.ordersRM.refreshEpoch, null);
});

test('sorgu başarısızsa eski değer güncel sayılmaz: hata durumu + Tekrar dene; sonraki başarı temizler', () => {
  const h = harness();
  h.ordersRM.epoch = 7; h.ordersRMMarkRefreshing();
  h.ordersRMRefreshSettled(7, false);
  assert.equal(h.status.hidden, false);
  assert.equal(h.status.dataset.state, 'error');
  assert.match(h.status.innerHTML, /Güncellenemedi: gösterilen değerler eski olabilir\./);
  assert.match(h.status.innerHTML, /data-orders-refresh-retry/);
  assert.equal(h.table.getAttribute('aria-busy'), null, 'not busy any more, but flagged stale');
  h.lang = 'en'; h.ordersRMRenderRefreshState();
  assert.match(h.status.innerHTML, /Could not update: values shown may be out of date\./);
  assert.match(h.status.innerHTML, />Retry</);
  h.ordersRMMarkRefreshing(); h.ordersRMRefreshSettled(7, true);
  assert.equal(h.status.hidden, true);
});

test('bekleyen güncelleme yokken sonuç gelmesi ya da okuma modelinin kapanması göstergeyi açmaz/bırakmaz', () => {
  const h = harness();
  h.ordersRMRefreshSettled(4, false);
  assert.equal(h.status.hidden, true, 'a failure with nothing pending shows nothing');
  h.ordersRM.epoch = 8; h.ordersRMMarkRefreshing();
  h.enabled = false; h.ordersRMRenderRefreshState();
  assert.equal(h.status.hidden, true);
  assert.equal(h.ordersRM.refreshEpoch, null);
  assert.equal(h.table.getAttribute('aria-busy'), null);
});

test('kaynak sözleşmesi: değişiklik işaretler, sorgu sonucu/hatası kapatır, eleman araç çubuğunda', () => {
  const changed = SOURCE.slice(SOURCE.indexOf('function ordersRMSourceChanged('), SOURCE.indexOf("window.addEventListener('buyerlog:cp-write-ack'"));
  assert.match(changed, /ordersRMInvalidate\(reason\);ordersRMMarkRefreshing\(\);/);
  const render = SOURCE.slice(SOURCE.indexOf('function renderOrdersFromReadModel('), SOURCE.indexOf('function renderOrdersNowLegacyOnly('));
  assert.match(render, /const seq=\+\+ordersRM\.seq,started=performance\.now\(\),epoch=ordersRM\.epoch;/);
  assert.match(render, /ordersRMResetStore\(signature,spec,result\);\s*ordersRMRefreshSettled\(epoch,true\);/);
  assert.match(render, /ordersRMRefreshSettled\(epoch,false\);/);
  assert.match(SOURCE, /closest\?\.\('\[data-orders-refresh-retry\]'\)/);
  assert.match(HTML, /<span class="count ordersRefreshState" id="ordersRefreshState" role="status" aria-live="polite" hidden data-tb-overflow="never"><\/span>\s*<span class="count" id="ordersCount"/);
});
