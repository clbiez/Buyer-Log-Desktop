'use strict';

/* CP / Orders sessiz PLM BOM tazelemesi — istemci zamanlayıcısı ve hücre yaması. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const silentBom = require('../public/cp-plm-silent-bom.js');

function harness(overrides = {}) {
  let clock = new Date(2026, 10, 13, 9, 0, 0).getTime();
  const timers = [];
  const calls = { plan: [], run: [], applied: [] };
  const opts = {
    enabled: true, online: true, idle: true, ids: ['11', '12', '13'],
    plan: ids => ({ ok: true, due: ids.slice(), completedToday: false }),
    run: ids => ({ ok: true, status: 'done', changedIds: ids.slice(0, 1) }),
    ...overrides,
  };
  const scheduler = silentBom.createScheduler({
    now: () => clock,
    setTimer: (fn, ms) => { const timer = { fn, at: clock + ms, ms }; timers.push(timer); return timer; },
    clearTimer: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    isEnabled: () => opts.enabled,
    isOnline: () => opts.online,
    isIdle: () => opts.idle,
    getIds: () => opts.ids,
    planRequest: async ids => { calls.plan.push(ids); return opts.plan(ids); },
    runRequest: async ids => { calls.run.push(ids); return opts.run(ids); },
    applyChanged: async ids => { calls.applied.push(ids); return ids.length; },
  });
  async function advance() {
    const timer = timers.sort((a, b) => a.at - b.at).shift();
    assert.ok(timer, 'zamanlanmış adım olmalı');
    clock = timer.at;
    await timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    return timer;
  }
  return { scheduler, timers, calls, opts, advance, now: () => clock };
}

test('zamanlayıcı açılışta istek atmaz; ilk adım birkaç dakika sonradır', async () => {
  const h = harness();
  h.scheduler.start();
  assert.equal(h.calls.plan.length, 0);
  assert.equal(h.timers.length, 1);
  assert.ok(h.timers[0].ms >= 3 * 60 * 1000, 'açılıştan birkaç dakika sonra');
  await h.advance();
  assert.equal(h.calls.plan.length, 1);
  assert.deepEqual(h.calls.run[0], ['11', '12', '13']);
  assert.deepEqual(h.calls.applied[0], ['11'], 'yalnız değişen modeller uygulanır');
});

test('kullanıcı etkileşimdeyken, çevrimdışıyken veya ayar kapalıyken hiçbir PLM isteği gitmez', async () => {
  const busy = harness({ idle: false });
  busy.scheduler.start();
  await busy.advance();
  await busy.advance();
  assert.equal(busy.calls.plan.length + busy.calls.run.length, 0);
  assert.equal(busy.scheduler.status().lastStatus, 'busy');

  const offline = harness({ online: false });
  offline.scheduler.start();
  await offline.advance();
  assert.equal(offline.calls.plan.length, 0);

  const disabled = harness({ enabled: false });
  disabled.scheduler.start();
  await disabled.advance();
  assert.equal(disabled.calls.plan.length, 0);
  assert.equal(disabled.timers.length, 0, 'kapalıyken yeniden zamanlanmaz');
  disabled.opts.enabled = true;
  disabled.scheduler.resume();
  await disabled.advance();
  assert.equal(disabled.calls.plan.length, 1, 'yeniden açılınca devam eder');
});

test('partiler 100 modelle sınırlı ve sıralıdır; tur bitince ertesi güne kadar istek yoktur', async () => {
  const ids = Array.from({ length: 230 }, (_, i) => String(5000 + i));
  let scanned = new Set();
  const h = harness({
    ids,
    plan: list => { const due = list.filter(id => !scanned.has(id)); return { ok: true, due, completedToday: !due.length }; },
    run: list => { list.forEach(id => scanned.add(id)); return { ok: true, status: 'done', changedIds: [] }; },
  });
  h.scheduler.start();
  await h.advance();
  await h.advance();
  await h.advance();
  assert.deepEqual(h.calls.run.map(batch => batch.length), [100, 100, 30]);
  assert.equal(h.calls.plan.length, 1, 'kuyruk tek planla ilerler');
  assert.equal(h.calls.applied.length, 0, 'değişiklik yoksa hücrelere dokunulmaz');
  await h.advance();
  assert.equal(h.scheduler.status().lastStatus, 'done-today');
  const next = h.timers[0];
  assert.ok(next.at - h.now() >= 60 * 60 * 1000, 'bugün yeniden denenmez');
  assert.ok(new Date(next.at).getDate() !== new Date(h.now()).getDate(), 'ertesi gün');
  assert.equal(h.calls.run.length, 3);
});

test('kullanıcı PLM işi sürerken ertelenen parti sessizce sonra yeniden planlanır', async () => {
  let attempt = 0;
  const h = harness({ run: ids => (++attempt === 1 ? { ok: true, status: 'deferred', changedIds: [] } : { ok: true, status: 'done', changedIds: ids }) });
  h.scheduler.start();
  await h.advance();
  assert.equal(h.scheduler.status().lastStatus, 'deferred');
  assert.ok(h.timers[0].ms >= 60 * 1000, 'hemen tekrar denenmez');
  assert.equal(h.calls.applied.length, 0);
  await h.advance();
  assert.equal(h.calls.plan.length, 2, 'kuyruk sunucudan yeniden planlanır');
  assert.equal(h.calls.applied.length, 1);
});

test('çevrimdışı/sessiz istek hatası yakalanır; kullanıcıya hiçbir şey gösterilmez', async () => {
  const h = harness({ plan: () => { throw Object.assign(new Error('offline'), { code: 'PLM_OFFLINE', silent: true }); } });
  h.scheduler.start();
  await h.advance();
  assert.equal(h.scheduler.status().lastStatus, 'offline');
  assert.equal(h.timers.length, 1);
  const source = read('public/cp-plm-silent-bom.js');
  assert.doesNotMatch(source, /showToast|alert\(|confirm\(|BLPlmOperations|openCoreNectumApiSettings|ensureCoreNectumAuth|interactive:\s*true/);
});

test('sessiz zamanlayıcı render/modül açılışına bağlanmaz ve sessiz istek sözleşmesini kullanır', () => {
  const source = read('public/cp-plm-silent-bom.js');
  assert.match(source, /BLPlmSilentRequest/);
  assert.match(source, /\/api\/plm-sync\/bom\/silent\/run/);
  assert.doesNotMatch(source, /renderCP|renderOrders|cpPlmDetailsSync|MutationObserver|setInterval/);
  const html = read('public/index.html');
  const details = html.indexOf('src="cp-plm-details.js'), silent = html.indexOf('src="cp-plm-silent-bom.js');
  assert.ok(details > 0 && silent > details, 'zamanlayıcı detay projeksiyonundan sonra yüklenir');
  const app = read('public/app-main.js');
  assert.match(app, /patch:cpPlmPatchCells/);
  const patch = app.slice(app.indexOf('function cpPlmPatchCells('), app.indexOf('/* Grup bantları artık'));
  assert.doesNotMatch(patch, /renderCP\(|renderOrders\(|renderTable|scrollTo|focus\(/, 'hücre yaması tabloyu yeniden çizmez, kaydırmaz, odak taşımaz');
  assert.match(patch, /td\.contains\(document\.activeElement\)/, 'odaklı hücreye dokunulmaz');
});

test('ayar anahtarı PLM giriş penceresinde TR/EN ve varsayılan açık', () => {
  const app = read('public/app-main.js');
  assert.match(app, /data-plm-silent-bom/);
  assert.match(app, /CP \/ Orders Artwork ve Fabric bilgisini arka planda güncel tut/);
  assert.match(app, /Keep CP \/ Orders Artwork and Fabric up to date in the background/);
  assert.equal(silentBom.readEnabled({ getItem: () => null }), true, 'varsayılan açık');
  assert.equal(silentBom.readEnabled({ getItem: () => '0' }), false);
  assert.equal(silentBom.readEnabled({ getItem: () => { throw new Error('blocked'); } }), true);
});

function detailsHarness(entries) {
  const window = { document: { documentElement: { lang: 'tr' } }, BLCollectionArtworkDetail: {
    summaryFor: entry => entry.hasPrint ? entry.summary : 'Baskı yok',
  } };
  const calls = [];
  const context = vm.createContext({ window, Date, Set, Map, Promise, Number, String, JSON, Array, setTimeout, fetch: async (_url, opts) => {
    const batch = JSON.parse(opts.body).plmIds; calls.push(batch);
    return { ok: true, json: async () => ({ ok: true, revision: 1, entries: Object.fromEntries(batch.filter(k => entries[k]).map(k => [k, entries[k]])) }) };
  } });
  vm.runInContext(read('public/cp-plm-details.js'), context);
  return { api: window.BLCPPlmDetails, calls };
}

test('applyIds yalnız değişen hücreleri yamar; tabloyu yeniden çizmez', async () => {
  const cp = [{ _id: 1, 'PLM ID': '201' }, { _id: 2, 'PLM ID': '202' }, { _id: 3, 'PLM ID': '203' }];
  const orders = [{ _id: 9, 'PLM ID': '201' }];
  const entries = {
    201: { styleId: 'S', hasPrint: true, summary: 'Ön: 1', fabric: 'A' },
    202: { styleId: 'S', hasPrint: false, fabric: 'B' },
    203: { styleId: 'S', hasPrint: false, fabric: 'C' },
  };
  const { api, calls } = detailsHarness(entries);
  let repaints = 0; const patches = [];
  await api.sync({ cpRows: cp, ordersRows: orders, repaint: () => { repaints += 1; }, patch: changes => patches.push(changes) });
  assert.deepEqual([...api.ids()].sort(), ['201', '202', '203']);
  repaints = 0; calls.length = 0;

  entries[201] = { styleId: 'S', hasPrint: true, summary: 'Ön: 1 • Arka: 1', fabric: 'A' };
  entries[202] = { styleId: 'S', hasPrint: false, fabric: 'B2' };
  const changed = await api.applyIds(['201', '202', '999']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['201', '202', '999']], 'yalnız değişen modeller okunur (tek toplu yerel okuma)');
  assert.equal(changed, 3);
  assert.equal(repaints, 0, 'tam yeniden çizim yok');
  const flat = JSON.parse(JSON.stringify(patches.splice(0).flat().map(change => [change.table, change.row._id, change.keys.join('+'), JSON.stringify(change.previous)])));
  assert.deepEqual(flat, [
    ['cp', 1, 'Artwork Detail', JSON.stringify({ 'Artwork Detail': 'Ön: 1' })],
    ['cp', 2, 'Fabric (PLM)', JSON.stringify({ 'Fabric (PLM)': 'B' })],
    ['orders', 9, 'Artwork Detail', JSON.stringify({ 'Artwork Detail': 'Ön: 1' })],
  ]);
  assert.equal(cp[2]['Fabric (PLM)'], 'C', 'değişmeyen modele dokunulmaz');
  assert.equal(await api.applyIds([]), 0);
});
