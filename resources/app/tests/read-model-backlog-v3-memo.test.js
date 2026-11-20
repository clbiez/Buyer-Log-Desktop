'use strict';
/* WS6c (#1079): Backlog satır belleği (compute-tasks, işçi başına tek giriş).
 * Teslimat Riski 'export' ve Genel Bakış 'v3-items' aynı sorgu için aynı satırları
 * paylaşır; farklı kullanıcı bağlamı/yetki/kaynak/sorgu asla paylaşmaz. */
const test = require('node:test'), assert = require('node:assert/strict');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');

const fixture = parity.makeFixture({ rows: 300 });
const orders = parse.parseASASRows(fixture.asas).orders, antrepo = parse.parseAntrepoRows(fixture.antrepo);
const source = () => ({ loadedAt: 'r1', asasOrders: orders, asasOrdersByTarget: { backlog: orders }, antrepoMap: antrepo, antrepoMapByTarget: { backlog: antrepo }, lflRows: [] });
function ctx(all) {
  const buyers = [...new Set(orders.map(order => order.buyer))].sort().slice(0, 2);
  return access.createAccessContext({ userId: all ? 'm' : 'b', systemRole: all ? 'moderator' : 'buyer', manageAll: all, viewScope: { all, mode: all ? 'ALL' : 'CUSTOM', buyers: all ? [] : buyers },
    editScopes: { buyers }, authority: Object.fromEntries(orders.map(order => [order.ocode, [order]])), profiles: [{ id: 'b', username: buyers[0] }] });
}
const data = (extra = {}) => ({ access: ctx(true), overrides: {}, horizons: {}, headers: ['Demo'], sourceRevision: 'rev-1', rowsRevision: 'rows-1', calendar: { configured: false }, options: {}, sourceColumns: [], today: '2026-01-15', ...extra });
function counting(fn) {
  const original = parse.prepareBacklogQuery; let calls = 0;
  parse.prepareBacklogQuery = (...args) => { calls++; return original(...args); };
  try { fn(); } finally { parse.prepareBacklogQuery = original; }
  return calls;
}
const v3 = (src, d) => JSON.parse(tasks.serialize(tasks.buildBacklog('v3-items', src, d), 'api'));
const exp = (src, d) => JSON.parse(tasks.serialize(tasks.buildBacklog('export', src, d), 'api'));

test('aynı sorgu: export ve v3-items satırları bir kez üretir; sonuç belleksizle aynı', () => {
  const src = source();
  tasks._clearRowsMemo();
  const expected = { e: exp(src, data()), v: (tasks._clearRowsMemo(), v3(src, data())) };
  tasks._clearRowsMemo();
  let out;
  const calls = counting(() => { out = { e: exp(src, data()), v: v3(src, data()) }; });
  assert.equal(calls, 1, 'ikinci görev sorgu hazırlığı ve satır üretimini tekrarlamaz');
  assert.deepEqual(out, expected);
  // Teslimat Riski kayıtları ve drill-down satırları da aynı satırları kullanır.
  assert.equal(counting(() => { tasks.buildBacklog('delivery-items', src, data()); tasks.buildBacklog('rows', src, { ...data(), rowIndices: [2, 0] }); }), 0);
  const picked = JSON.parse(tasks.serialize(tasks.buildBacklog('rows', src, { ...data(), rowIndices: [2, 0, -1, 1e9, 'x'] }), 'api'));
  assert.deepEqual(picked.rows, [expected.e.rows[2], expected.e.rows[0]], 'yalnız geçerli sıralar, istenen sırayla');
  tasks._clearRowsMemo();
  // Ters sıra da paylaşır.
  assert.equal(counting(() => { v3(src, data()); exp(src, data()); }), 1);
});

test('farklı bağlam, yetki, kaynak, sorgu ya da gün paylaşmaz; önizleme/ayrıntı/harita belleğe girmez', () => {
  const src = source();
  const variants = [
    ['sourceRevision', data({ sourceRevision: 'rev-2' })],
    ['yetki', data({ access: ctx(false) })],
    ['sorgu', data({ options: { retailFrom: '2026-01-01' } })],
    ['kaynak sütunu', data({ sourceColumns: ['asas:x'] })],
    ['hedef', data({ target: 'cp' })],
  ];
  for (const [name, other] of variants) {
    tasks._clearRowsMemo();
    assert.equal(counting(() => { exp(src, data()); v3(src, other); }), 2, name + ' paylaşılmamalı');
  }
  tasks._clearRowsMemo();
  assert.equal(counting(() => { exp(src, data()); v3(source(), data()); }), 2, 'başka kaynak nesnesi paylaşmaz');
  for (const extra of [{ previewLimit: 5 }, { includeSourceDetails: true }, { mapProjection: true }]) {
    tasks._clearRowsMemo();
    assert.equal(counting(() => { exp(src, data(extra)); v3(src, data()); }), 2, JSON.stringify(extra) + ' belleğe girmez');
  }
  // Kapsam: CUSTOM kullanıcısı ALL kullanıcısının satırlarını almaz.
  tasks._clearRowsMemo();
  const all = exp(src, data()), custom = v3(src, data({ access: ctx(false), sourceRevision: 'rev-1' }));
  assert.ok(custom.count < all.rows.length);
  tasks._clearRowsMemo();
});

test('bellek son kullanımdan 20 sn sonra, en geç 120 sn içinde bırakılır (zamanlayıcı süreci tutmaz)', () => {
  const src = source();
  tasks._clearRowsMemo();
  const timers = [], original = global.setTimeout, now = Date.now;
  let clock = now();
  global.setTimeout = (fn, ms) => { const timer = original(() => {}, 0); timers.push({ fn, ms, timer }); return timer; };
  Date.now = () => clock;
  try {
    exp(src, data());
    assert.equal(timers.at(-1).ms, 20000);
    clock += 15000; assert.equal(counting(() => { v3(src, data()); }), 0, 'kullanım ömrü uzatır');
    assert.equal(timers.at(-1).ms, 20000);
    clock += 100000; assert.equal(counting(() => { v3(src, data()); }), 0);
    assert.equal(timers.at(-1).ms, 5000, 'en uzun ömür 120 sn');
    clock += 6000; assert.equal(counting(() => { v3(src, data()); }), 1, '120 sn dolunca yeniden üretilir');
    timers.at(-1).fn();
    assert.equal(counting(() => { v3(src, data()); }), 1, 'zamanlayıcı belleği bırakır');
  } finally { global.setTimeout = original; Date.now = now; }
  tasks._clearRowsMemo();
});
