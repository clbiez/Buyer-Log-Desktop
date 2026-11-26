'use strict';

/* SİPARİŞLER AÇILIŞI — SATIR BEKLEYİCİSİ YARIŞI (ADR-0003 §6A bulgusu)
 *
 * waitForOrdersReadModelRows yalnız 'bl:orders-rows-visible' ölçüm olayını
 * bekliyordu. Olay yalnız sorgu yanıtında ve eski yolda gönderilir; önbellekten
 * çizim, sekme etkin değilken ertelenen çizim ve hata yolu onu göndermez. Bu
 * yollarda satırlar ~0,8 sn'de görünse de açılış 15 sn zaman aşımını bekliyordu
 * (ölçüm: 17,2 sn → 2,15 sn, tek koşu). Artık her çizim bekleyiciyi bilgilendirir;
 * bekleyici dinleyiciyi kurduktan SONRA durumu da kontrol eder; bitiş tek seferliktir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppMainFunctions, extractFunction } = require('./helpers/app-main-functions');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function harness({ renderOrders = () => {}, rows = null, paintCount = 0 } = {}) {
  const listeners = new Map();
  const window = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  const timers = [];
  const ordersRM = { rows, paintWaiters: new Set(), paintCount };
  const globals = {
    window, ordersRM, state: { orders: null },
    renderOrders: () => renderOrders(api),
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  };
  const fns = loadAppMainFunctions(['waitForOrdersReadModelRows', 'ordersNotifyPainted'], globals);
  const api = { ...fns, ordersRM, window, timers, listeners, fireTimeout: () => { for (const t of timers) if (!t.cleared) t.fn(); } };
  return api;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('önbellekten/ertelenmiş çizim ölçüm olayı göndermese de bekleyici zaman aşımı beklemeden çözülür', async () => {
  const h = harness({ renderOrders: api => queueMicrotask(() => { api.ordersRM.rows = [{ id: 1 }]; api.ordersNotifyPainted(); }) });
  let resolved = null;
  h.waitForOrdersReadModelRows().then(value => { resolved = value; });
  await settle();
  assert.equal(resolved, true, 'paint notification resolves the wait');
  assert.ok(h.timers.every(t => t.cleared), 'timeout is cleared');
  assert.equal(h.ordersRM.paintWaiters.size, 0);
  assert.equal(h.listeners.get('bl:orders-rows-visible').size, 0);
});

test('ölçüm olayı ile çizim de çözülmeye devam eder', async () => {
  const h = harness({ renderOrders: api => queueMicrotask(() => api.window.dispatchEvent({ type: 'bl:orders-rows-visible' })) });
  let resolved = null;
  h.waitForOrdersReadModelRows().then(value => { resolved = value; });
  await settle();
  assert.equal(resolved, true);
});

test('dinleyici kurulmadan önce yapılmış çizim kaçırılmaz', async () => {
  const h = harness({ rows: [{ id: 1 }], paintCount: 1 });
  let resolved = null;
  h.waitForOrdersReadModelRows().then(value => { resolved = value; });
  await settle();
  assert.equal(resolved, true, 'already painted rows resolve immediately');
});

test('tekrarlı bildirim ve olay tek kez çözer, artık dinleyici bırakmaz', async () => {
  const h = harness({ renderOrders: api => queueMicrotask(() => { api.ordersRM.rows = [{}]; api.ordersNotifyPainted(); api.ordersNotifyPainted(); api.window.dispatchEvent({ type: 'bl:orders-rows-visible' }); }) });
  let calls = 0;
  h.waitForOrdersReadModelRows().then(() => { calls += 1; });
  await settle();
  h.ordersNotifyPainted(); h.fireTimeout();
  await settle();
  assert.equal(calls, 1);
  assert.equal(h.ordersRM.paintWaiters.size, 0);
});

test('hiç çizim/olay gelmezse 15 sn zaman aşımı yedek olarak kalır', async () => {
  const h = harness();
  let resolved = null;
  h.waitForOrdersReadModelRows().then(value => { resolved = value; });
  await settle();
  assert.equal(resolved, null, 'still waiting');
  assert.equal(h.timers[0].ms, 15000);
  h.fireTimeout(); await settle();
  assert.equal(resolved, false, 'no rows: resolves false after the fallback timeout');
});

test('sorgu hatası bekleyiciyi zaman aşımı beklemeden false ile çözer', async () => {
  const h = harness({ renderOrders: api => queueMicrotask(() => api.ordersNotifyPainted(false)) });
  let resolved = null;
  h.waitForOrdersReadModelRows().then(value => { resolved = value; });
  await settle();
  assert.equal(resolved, false);
});

test('kaynak sözleşmesi: her çizim yolu ve hata yolu bekleyiciyi bilgilendirir', () => {
  assert.match(extractFunction(SOURCE, 'ordersRMPaintTable'), /ordersNotifyPainted\(\)/, 'read-model paint (cached, deferred, query) notifies');
  assert.match(extractFunction(SOURCE, 'ordersRecordRowsVisible'), /ordersNotifyPainted\(\)/, 'legacy and query visibility notify');
  assert.match(extractFunction(SOURCE, 'renderOrdersFromReadModel'), /ordersNotifyPainted\(false\)/, 'query failure notifies');
});
