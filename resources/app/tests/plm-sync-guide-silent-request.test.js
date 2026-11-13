'use strict';
/* Sessiz (arka plan) PLM isteği bildirim AÇMAZ.
 * plm-sync-guide.js tüm PLM senkron POST'larını sarıp "Senkronizasyon
 * tamamlandı" bildirimi gösterir. Sessiz eksik görsel tamamlama aynı
 * /api/model-images/import-plm ucunu `X-BuyerLog-Auth-Mode: silent` ile
 * çağırır; bu istek kullanıcıya hissettirilmemelidir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'plm-sync-guide.js'), 'utf8');

function load() {
  const toasts = [];
  const fetchCalls = [];
  const window = {
    appLang: 'tr',
    location: { href: 'http://127.0.0.1:6194/' },
    fetch: async (input, init) => { fetchCalls.push({ input, init }); return { ok: true, status: 200, json: async () => ({}) }; },
    showToast: (message) => { toasts.push(message); const close = () => {}; close.update = () => {}; return close; },
    addEventListener: () => {},
  };
  const document = { documentElement: { lang: 'tr' }, addEventListener: () => {}, querySelector: () => null, getElementById: () => null, body: { appendChild: () => {} } };
  const context = { window, document, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, URL, Headers, setTimeout: () => 0, clearTimeout: () => {}, console };
  vm.runInNewContext(SOURCE, context);
  return { window, toasts, fetchCalls };
}

test('sessiz başlıklı import-plm isteği bildirim açmaz', async () => {
  const { window, toasts, fetchCalls } = load();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('X-BuyerLog-Auth-Mode', 'silent');
  await window.fetch('/api/model-images/import-plm', { method: 'POST', headers, body: '{}' });
  await window.fetch('/api/model-images/import-plm', { method: 'POST', headers: { 'x-buyerlog-auth-mode': 'silent' }, body: '{}' });
  assert.equal(fetchCalls.length, 2);
  assert.equal(toasts.length, 0);
});

test('kullanıcının başlattığı import-plm isteği bildirimi eskisi gibi gösterir', async () => {
  const { window, toasts } = load();
  await window.fetch('/api/model-images/import-plm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(toasts.length, 1);
});
