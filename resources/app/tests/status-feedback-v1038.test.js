'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const DESIGN = read('public/design.css');
const UI_SOURCE = read('public/ui-primitives.js');
const UI = require('../public/ui-primitives.js');

test('v10.38 geri bildirim primitive’i uygulama tüketicilerinden önce yüklenir', () => {
  const primitive = INDEX.indexOf('<script src="ui-primitives.js');
  const app = INDEX.indexOf('<script src="app-main.js');
  assert.ok(primitive >= 0 && primitive < app);
  assert.equal(typeof UI.notify, 'function');
  assert.equal(typeof UI.feedbackView, 'function');
});

test('v10.38 bildirim süreleri öneme göre okunabilir kalır ve yükleme kendiliğinden kaybolmaz', () => {
  assert.equal(UI.feedbackDuration('loading'), 0);
  assert.ok(UI.feedbackDuration('error') > UI.feedbackDuration('success'));
  assert.ok(UI.feedbackDuration('warning') > UI.feedbackDuration('info'));
  assert.equal(UI.feedbackDuration('info', 1234), 1234);
});

test('v10.38 hata ve bilgi bildirimleri güvenli metin, ayrı rol ve görünür kapatma denetimi taşır', () => {
  const error = UI.feedbackView('<img src=x onerror=alert(1)>', { kind: 'error' });
  const info = UI.feedbackView('Bilgi', { kind: 'info' });
  const english = UI.feedbackView('Saved', { kind: 'success', language: 'en' });
  assert.match(error, /class="uiFeedback uiFeedback--error"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /aria-live="assertive"/);
  assert.match(error, /data-ui-feedback-close/);
  assert.doesNotMatch(error, /<img/);
  assert.match(error, /&lt;img/);
  assert.match(info, /role="status"/);
  assert.match(info, /aria-live="polite"/);
  assert.notEqual(error.match(/#i-([^"/]+)/)?.[1], info.match(/#i-([^"/]+)/)?.[1]);
  assert.match(english, />Completed</);
  assert.match(english, /aria-label="Close"/);
});

test('v10.38 ortak durum görünümü yükleme ve hata semantiğini eksiksiz açıklar', () => {
  const loading = UI.stateView({ kind: 'loading', title: 'Yükleniyor' });
  const error = UI.stateView({ kind: 'error', title: 'Yüklenemedi' });
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /aria-atomic="true"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /aria-atomic="true"/);
  assert.match(INDEX, /class="uiState uiState--loading"[^>]*aria-atomic="true"[^>]*aria-busy="true"/);
  assert.match(UI_SOURCE, /element\.setAttribute\('aria-busy'/);
  assert.match(UI_SOURCE, /element\.removeAttribute\('aria-busy'/);
  assert.match(APP, /shell\.setAttribute\('aria-atomic','true'\)/);
  assert.match(APP, /kind==='loading'\)shell\.setAttribute\('aria-busy','true'\)/);
});

test('v10.38 bildirim yığını mesaj kaybetmez, büyümeyi sınırlar ve okuma sırasında süreyi durdurur', () => {
  assert.match(UI_SOURCE, /MAX_FEEDBACK_ITEMS\s*=\s*4/);
  assert.match(UI_SOURCE, /data-ui-feedback-region/);
  assert.match(UI_SOURCE, /pointerenter/);
  assert.match(UI_SOURCE, /pointerleave/);
  assert.match(UI_SOURCE, /focusin/);
  assert.match(UI_SOURCE, /focusout/);
  assert.match(UI_SOURCE, /children\.length\s*>\s*MAX_FEEDBACK_ITEMS/);
  assert.doesNotMatch(UI_SOURCE, /MutationObserver/);
});

test('v10.38 mevcut toast çağrıları ortak bildirime gider ve geçmiş kaydı korunur', () => {
  const toast = APP.slice(APP.indexOf('function showToast'), APP.indexOf('const TABLE_META'));
  assert.match(toast, /notificationHistoryAdd\(msg,'toast'\)/);
  assert.match(toast, /window\.BLUI\?\.notify/);
  assert.match(toast, /placement:'edge'/);
  assert.match(toast, /kind:o\.kind\|\|'info'/);
  assert.match(toast, /language:appLang/);
});

test('v10.38 merkez bildirimi ortak sözleşmeye gider, geçmiş ve kapatma işlevini korur', () => {
  const center = APP.slice(APP.indexOf('function showCenterNotice'), APP.indexOf('function showToast'));
  assert.match(center, /notificationHistoryAdd\(msg,'center'\)/);
  assert.match(center, /window\.BLUI\?\.notify/);
  assert.match(center, /language:appLang/);
  assert.match(center, /return close/);
});

// Regression: a modal/overlay open on screen must not let showCenterNotice's
// center placement land on top of/inside it — it must fall back to the
// standard top-right (edge) stack while a modal is open, and keep the
// deliberate center placement when the screen has no open overlay.
test('v11.xx modal açıkken merkez bildirimi sağ üst şeride yönlendirilir, modal kapalıyken merkezde kalır', () => {
  const center = APP.slice(APP.indexOf('function showCenterNotice'), APP.indexOf('function showToast'));
  assert.match(center, /const overlayOpen=typeof blOverlayOpen==='function'&&blOverlayOpen\(\);/,
    'showCenterNotice modal/overlay durumunu kontrol etmiyor');
  assert.match(center, /placement:overlayOpen\?'edge':'center'/,
    'showCenterNotice modal açıkken edge yerine hâlâ center kullanıyor');
  assert.doesNotMatch(center, /placement:'center'/,
    'showCenterNotice koşulsuz center placement kullanmaya devam ediyor');
});

test('v10.38 geri bildirim yüzeyi token tabanlı, erişilebilir ve küçük ekrana uyumludur', () => {
  const start = DESIGN.indexOf('/* v10.38 — DURUM VE GERİ BİLDİRİM SİSTEMİ */');
  const block = DESIGN.slice(start);
  assert.ok(start >= 0);
  assert.match(block, /\.uiFeedbackRegion--edge/);
  assert.match(block, /\.uiFeedbackRegion--center/);
  assert.match(block, /\.uiFeedback--success/);
  assert.match(block, /\.uiFeedback--warning/);
  assert.match(block, /\.uiFeedback--error/);
  assert.match(block, /\.uiFeedbackClose:focus-visible/);
  assert.match(block, /@media\(max-width:620px\)/);
  assert.match(block, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
});
