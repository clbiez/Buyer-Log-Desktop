'use strict';

/*
 * YENİLEME SONRASI SUNUCU KİLİDİ (8.0.12 saha profili: 11,5 sn + 3,3 sn)
 *
 * Profilde ana iş parçacığını kilitleyen üç kaynak vardı:
 *   1) captureBacklogPlanActualSnapshot: üç hedefin tam girdi hash'i
 *      (derived-input-keys), arşivin İKİ kez okunması, Backlog şablon
 *      satırları + projectSnapshot + delta + arşiv JSON/gzip — hepsi ana
 *      iş parçacığında;
 *   2) compute-read damgası (stamp/assertBuild/assertResponse): her damgada
 *      iki loadOverrides → overrides kaydının tam derin kopyası (cloneFallback);
 *   3) aynı damga sayfa önbelleği yazımında (assertCurrent) da tekrarlanıyordu.
 * Bu dosya, veri anlamı değişmeden bu işlerin ana iş parçacığından
 * çıkarıldığını ve gereksiz kopyanın kalktığını çiviler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
// Eski appendSnapshot yolu arşivi LOCAL_DATA_ROOT altına yazar: geçici köke yönlendir.
const LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-post-refresh-local-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = LOCAL_ROOT;
test.after(() => fs.rmSync(LOCAL_ROOT, { recursive: true, force: true }));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function order(i, overrides = {}) {
  return {
    ocode: String(1000 + i), model: `MODEL-${i}`, ccode: '01', colour: 'Siyah', buyer: 'Ayşe', buyerGrup: 'WOMEN',
    manufacturer: 'SUPPLIER A', season: 'W26', merch: 'M1', ageGroup: 'A1', countryRaw: 'TR', license: '', line: 'LINE A',
    ozel: 'X', qty: 100 + i, kalan: 100 + i, ex: new Date(2026, 9, 5), _asasEx: new Date(2026, 9, 5),
    retail: new Date(2026, 10, 1), mb: new Date(2026, 10, 10), ...overrides,
  };
}
function runtime(count = 6, patch = () => ({})) {
  const rows = Array.from({ length: count }, (_, i) => order(i, patch(i)));
  return { loadedAt: '2026-11-20T08:00:00.000Z', asasOrders: rows, asasOrdersByTarget: { cp: rows, orders: rows, backlog: rows },
    antrepoMap: {}, antrepoMapByTarget: { cp: {}, orders: {}, backlog: {} }, lflRows: [], modelRefresh: { sourceGenerationId: 'gen-1' } };
}

// ---------------------------------------------------------------- 1) anahtar
test('derived-input-keys.inputKey: tek hedef anahtarı keys() ile birebir aynı; yerinde mutasyon anahtarı değiştirir', () => {
  const { keys, inputKey } = require('../server/lib/derived-input-keys');
  assert.equal(typeof inputKey, 'function');
  const opts = { version: '8.0.12', day: '2026-11-20' };
  const rows = { cp: [{ qty: 1 }], orders: [{ qty: 2 }], backlog: [{ qty: 3 }] };
  const active = { asasOrders: [{ qty: 0 }], asasOrdersByTarget: rows, antrepoMap: { A: 1 }, antrepoMapByTarget: { backlog: { B: 2 } },
    modelRefresh: { appliedHorizons: { backlog: { season: 'W26' } } }, cpupdateOverrides: { submap: { X: 'Y' } } };
  const overrides = { datemap: { 1: { ex: '2026-10-01' } } };
  const all = keys(active, 'ctx', overrides, opts);
  for (const target of ['cp', 'orders', 'backlog']) assert.equal(inputKey(active, 'ctx', overrides, target, opts), all[target], target);
  // Sözleşme: kimlik önbelleği yok — aynı dizi yerinde değişince anahtar değişir.
  const before = inputKey(active, 'ctx', overrides, 'backlog', opts);
  rows.backlog[0].qty = 4;
  assert.notEqual(inputKey(active, 'ctx', overrides, 'backlog', opts), before);
  // Yalnız istenen hedefin verisi okunur: cp verisini bozmak backlog anahtarını etkilemez.
  rows.cp[0].qty = 99;
  assert.equal(inputKey(active, 'ctx', overrides, 'backlog', opts), keys(active, 'ctx', overrides, opts).backlog);
});

// ---------------------------------------------------------------- 2) arşiv
async function tempDir(t, prefix) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}
const Engine = require('../server/lib/backlog-plan-actual');
function readGz(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }

test('prepareCapture: arşiv bir kez okunur; aynı girdi anahtarı satır üretmeden boş işaret yazar', async t => {
  const dir = await tempDir(t, 'buyerlog-bpa-capture-');
  const file = path.join(dir, 'u.json.gz');
  const rowsA = [{ id: 'a', orderQty: 1 }, { id: 'b', orderQty: 2 }];
  let builds = 0;
  const build = rows => () => { builds += 1; return rows; };
  const reads = [];
  const original = fs.promises.readFile;
  fs.promises.readFile = function (target, ...rest) { reads.push(String(target)); return original.call(this, target, ...rest); };
  t.after(() => { fs.promises.readFile = original; });

  const first = await Engine.prepareCapture(file, { capturedAt: '2026-11-20T08:00:00.000Z', sourceGenerationId: 'g1', inputKey: 'k1' }, build(rowsA));
  assert.equal(builds, 1);
  assert.equal(first.reused, false);
  assert.ok(Buffer.isBuffer(first.compressed) || first.compressed instanceof Uint8Array, 'sıkıştırılmış arşiv döner; yazma çağıranındır');
  assert.equal(fs.existsSync(file), false, 'prepareCapture dosyaya yazmaz (yazma ana iş parçacığında atomik)');
  await fsp.writeFile(file, first.compressed);

  reads.length = 0;
  const second = await Engine.prepareCapture(file, { capturedAt: '2026-11-20T09:00:00.000Z', sourceGenerationId: 'g2', inputKey: 'k1' }, build(rowsA));
  assert.equal(builds, 1, 'aynı anahtar: Backlog satırları yeniden üretilmez');
  assert.equal(second.reused, true);
  assert.equal(reads.filter(target => target === file).length, 1, 'arşiv tek kez okunur');
  await fsp.writeFile(file, second.compressed);

  const rowsB = [{ id: 'a', orderQty: 5 }, { id: 'c', orderQty: 3 }];
  reads.length = 0;
  const third = await Engine.prepareCapture(file, { capturedAt: '2026-11-20T10:00:00.000Z', sourceGenerationId: 'g3', inputKey: 'k2' }, build(rowsB));
  assert.equal(builds, 2);
  assert.equal(third.reused, false);
  assert.equal(third.snapshots, 3);
  assert.equal(reads.filter(target => target === file).length, 1, 'farklı anahtarda da arşiv tek kez okunur');
  await fsp.writeFile(file, third.compressed);
  const archive = readGz(file);
  assert.equal(archive.inputKey, 'k2');
  assert.deepEqual(archive.deltas[0], { capturedAt: '2026-11-20T09:00:00.000Z', sourceGenerationId: 'g2', upserts: [], removed: [] });
  assert.deepEqual(archive.deltas[1].upserts, [{ id: 'a', orderQty: 5 }, { id: 'c', orderQty: 3 }]);
  assert.deepEqual(archive.deltas[1].removed, ['b']);
});

test('prepareCapture arşivi eski iki adımlı appendSnapshot ile bayt bayt aynı içeriği üretir', async t => {
  const dir = await tempDir(t, 'buyerlog-bpa-parity-');
  const steps = [
    { capturedAt: '2026-11-20T08:00:00.000Z', sourceGenerationId: 'g1', inputKey: 'k1', rows: [{ id: 'a', q: 1 }, { id: 'b', q: 2 }] },
    { capturedAt: '2026-11-20T09:00:00.000Z', sourceGenerationId: 'g2', inputKey: 'k1', rows: [{ id: 'a', q: 1 }, { id: 'b', q: 2 }] },
    { capturedAt: '2026-11-20T10:00:00.000Z', sourceGenerationId: 'g3', inputKey: 'k2', rows: [{ id: 'b', q: 7 }, { id: 'd', q: 1 }] },
  ];
  const user = `parity-${process.pid}-${Date.now()}`;
  const file = path.join(dir, 'new.json.gz');
  for (const step of steps) {
    // Eski yol: önce yeniden kullanım denemesi, olmazsa tam snapshot.
    const reused = await Engine.appendSnapshot(user, { capturedAt: step.capturedAt, sourceGenerationId: step.sourceGenerationId, reuseInputKey: step.inputKey });
    if (!reused) await Engine.appendSnapshot(user, { capturedAt: step.capturedAt, sourceGenerationId: step.sourceGenerationId, inputKey: step.inputKey, rows: step.rows });
    const next = await Engine.prepareCapture(file, step, () => step.rows);
    await fsp.writeFile(file, next.compressed);
  }
  assert.deepEqual(readGz(file), await Engine.readArchive(user));
});

// ---------------------------------------------------------------- 3) işçi
test('plan-actual-capture işçi görevi ana iş parçacığı yoluyla aynı arşivi üretir ve dosyaya yazmaz', async t => {
  const dir = await tempDir(t, 'buyerlog-bpa-worker-');
  const capture = require('../server/lib/backlog-plan-actual-capture');
  const worker = require('../server/workers/compute-worker');
  const source = runtime(8, i => (i === 3 ? { qty: 0 } : {}));
  const overrides = { datemap: { 1001: { ex: '2026-12-01' } }, notesmap: {} };
  const params = { archiveFile: path.join(dir, 'w.json.gz'), contextHash: 'moderator', appVersion: '8.0.12', overrides,
    capturedAt: '2026-11-20T08:00:00.000Z', sourceGenerationId: 'gen-1' };
  const local = await capture.captureFromSource(source, params);
  const transfer = [];
  const remote = await worker.execute('plan-actual-capture', { ownerId: 'moderator', source: {}, params: { ...params } }, transfer, source);
  assert.equal(fs.existsSync(params.archiveFile), false, 'işçi arşivi yazmaz');
  assert.ok(transfer.length === 1 && transfer[0] === remote.buffer, 'arşiv baytları kopyasız aktarılır');
  const decode = value => JSON.parse(zlib.gunzipSync(Buffer.from(value.buffer || value.compressed)).toString('utf8'));
  assert.deepEqual(decode(remote), decode(local));
  assert.equal(remote.reused, false);
  const archive = decode(remote);
  assert.ok(archive.base.rows.length > 0);
  // Satırlar sunucunun eski capture formülüyle aynı (Backlog şablon satırları → projectSnapshot).
  const parse = require('../server/lib/parse');
  const orders = parse.applyDateOverrides(source.asasOrdersByTarget.backlog, overrides);
  const expected = Engine.projectSnapshot(orders, parse.buildBacklogTemplateRows(orders, {}, overrides, {}, [], {}), { capturedAt: params.capturedAt, sourceGenerationId: 'gen-1' });
  assert.deepEqual(archive.base.rows, expected.rows);
  const { inputKey } = require('../server/lib/derived-input-keys');
  assert.equal(archive.inputKey, inputKey(source, 'moderator', overrides, 'backlog', { version: '8.0.12' }));
});

// ---------------------------------------------------------------- 4) overrides
const DATA_ROOT_VARS = ['BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT'];
function resetServerModules() {
  const root = path.join(ROOT, 'server') + path.sep;
  for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
}
async function sandbox(t, mode) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-ov-stamp-'));
  const previous = DATA_ROOT_VARS.map(name => [name, process.env[name]]);
  const dataDir = path.join(root, 'server-data');
  await fsp.mkdir(dataDir, { recursive: true });
  Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: dataDir, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local') });
  resetServerModules();
  let store = null;
  if (mode) {
    const { createLocalDb } = require('../server/lib/local-db');
    const { createDeltaStore } = require('../server/lib/delta-store');
    const localDb = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
    await localDb.ensure();
    store = createDeltaStore({ localDb, mode });
  }
  t.after(async () => {
    if (store && typeof store.flush === 'function') await store.flush();
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetServerModules();
    await new Promise(resolve => setTimeout(resolve, 30));
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
  });
  return { dataDir, store };
}
const STAMP_FIELDS = ['_revision', '_revisions', 'nonDtrManufacturers', 'asasSourceMode', 'antrepoSourceMode', 'lflSourceMode'];
function bigOverrides(db) {
  const notesmap = {};
  for (let i = 0; i < 2000; i++) notesmap[`ORD-${i}`] = { Notes: `not ${i}`, NotesBy: 'u', NotesByName: 'U' };
  return { ...db.defaultOverrides(), notesmap, nonDtrManufacturers: ['ZETA', 'alpha'], asasSourceMode: 'DATABASE', antrepoSourceMode: 'dashboard',
    _revision: 7, _revisions: { ...db.defaultOverrides()._revisions, orders: 4, pricingRules: 2, custom: 9 } };
}
function assertStampMatches(db) {
  const full = db.loadOverrides(), stamp = db.loadOverridesStamp();
  for (const field of STAMP_FIELDS) assert.deepEqual(stamp[field], full[field], field);
}
function countLargeClones(run) {
  const original = JSON.stringify;
  let large = 0;
  JSON.stringify = function (value, ...rest) { const out = original.call(this, value, ...rest); if (typeof out === 'string' && out.length > 50000) large += 1; return out; };
  try { run(); } finally { JSON.stringify = original; }
  return large;
}

for (const mode of [null, 'delta']) {
  test(`db.loadOverridesStamp (${mode || 'dosya'}): bağlam alanları loadOverrides ile aynı, kayıt derin kopyalanmaz ve bozulmaz`, async t => {
    const box = await sandbox(t, mode);
    const db = require('../server/db');
    if (mode) { db.attachDeltaStore(box.store); t.after(() => db.attachDeltaStore(null)); }
    assert.equal(typeof db.loadOverridesStamp, 'function');
    assertStampMatches(db); // store yokken varsayılanlar
    db.saveOverrides(bigOverrides(db));
    if (mode) { await box.store.flush(); await box.store.hydrate(); }
    assertStampMatches(db);
    db.loadOverrides(); // dosya yolunda önbelleği ısıtır
    assert.equal(countLargeClones(() => db.loadOverridesStamp()), 0, 'damga büyük overrides kaydını kopyalamamalı');
    const stamp = db.loadOverridesStamp();
    stamp._revisions.orders = 999; // çağıran nesneyi değiştirse de kaynak kayıt bozulmaz
    assert.notEqual(db.loadOverrides()._revisions.orders, 999);
    assert.equal(db.loadOverrides().notesmap['ORD-5'].Notes, 'not 5');
  });
}

// ---------------------------------------------------------------- 5) bağlantı
test('sunucu: bağlam damgaları klonsuz overrides görünümünü, capture compute işçisini kullanır', () => {
  const body = name => { const at = SERVER.indexOf(name); assert.ok(at > 0, name); return SERVER.slice(at, SERVER.indexOf('\n}', at)); };
  assert.match(body('function pageProjectionContext('), /loadOverridesStamp\(\)/);
  assert.doesNotMatch(body('function pageProjectionContext('), /loadOverrides\(\)/);
  assert.match(body('function computeReadContext('), /loadOverridesStamp\(\)/);
  assert.doesNotMatch(body('function computeReadContext('), /loadOverrides\(\)/);
  const capture = body('async function captureBacklogPlanActualSnapshot(');
  assert.match(capture, /serverCompute\(\)\.run\('plan-actual-capture'/);
  assert.match(capture, /withArchiveLock\(/);
  assert.match(capture, /atomicWriteBufferAsync\(/);
  assert.doesNotMatch(capture, /derivedInputKeys\.keys\(/, 'capture ana iş parçacığında tam girdi hash\'i almaz');
  assert.doesNotMatch(capture, /buildBacklogTemplateRows\(/, 'Backlog satırları işçide üretilir');
});
