'use strict';

/*
 * AÇILIŞ TOHUMLAMASI TEMBEL OLMALI (stall-profile: norm / readSnapshotFile /
 * cloneFallback / readFileUtf8)
 *
 * Gerçek kullanıcı açılış profilinde ana iş parçacığını kilitleyen maliyetin
 * kaynağı, delta motorunda ZATEN bulunan belgelerin her açılışta yeniden
 * okunup ayrıştırılması, indekslenmesi ve derin kopyalanmasıydı:
 *   · endeksmatik.seedMissing her set dosyasını gunzip+parse+buildIndex
 *     (endeksmatik-model norm) ediyordu; sonuç seedMissing'de atılıyordu;
 *   · db.deltaSeedPayload her store'u (büyük overrides dahil) okuyordu;
 *   · db.storeExists yalnız "var mı?" için kaydın derin kopyasını alıyordu.
 * Bu dosya, veri anlamı değişmeden bu işlerin YALNIZ gerektiğinde yapıldığını çiviler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

function resetServerModules() {
  const root = path.join(__dirname, '..', 'server') + path.sep;
  for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
}
const DATA_ROOT_VARS = ['BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT'];
async function sandbox(t, mode) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-seed-lazy-'));
  const previous = DATA_ROOT_VARS.map(name => [name, process.env[name]]);
  const dataDir = path.join(root, 'server-data');
  await fsp.mkdir(dataDir, { recursive: true });
  Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: dataDir, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local') });
  resetServerModules();
  const { createLocalDb } = require('../server/lib/local-db');
  const { createDeltaStore } = require('../server/lib/delta-store');
  const localDb = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await localDb.ensure();
  const errors = [];
  const store = createDeltaStore({ localDb, mode, onError: (stage, error) => errors.push({ stage, error }) });
  t.after(async () => {
    if (typeof store.flush === 'function') await store.flush();
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetServerModules();
    await new Promise(resolve => setTimeout(resolve, 30));
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
  });
  return { root, dataDir, store, localDb, errors };
}

test('delta-store.seedMissing: işlev değer yalnız eksik kayıt için çağrılır; düz değer eskisi gibi', async t => {
  const box = await sandbox(t, 'delta');
  const calls = [];
  const lazy = (id, value) => () => { calls.push(id); return value; };
  const first = await box.store.seedMissing('store', { a: lazy('a', { v: 1 }), b: { v: 2 } });
  assert.deepEqual(first.ids.sort(), ['a', 'b']);
  assert.deepEqual(calls, ['a']);
  await box.store.flush(); await box.store.hydrate();
  calls.length = 0;
  const second = await box.store.seedMissing('store', { a: lazy('a', { v: 9 }), b: lazy('b', { v: 9 }) });
  assert.equal(second.seeded, 0);
  assert.deepEqual(calls, [], 'var olan kayıt için işlev hiç çağrılmamalı (okuma/parse yok)');
  assert.equal(box.store.readAllSync('store').a.v, 1, 'var olan kayıt ezilmemeli');
});

test('delta-store.seedMissing: fırlatan ya da null dönen işlev o kaydı atlar, diğerlerini tohumlar', async t => {
  const box = await sandbox(t, 'delta');
  const result = await box.store.seedMissing('store', { bad: () => { throw new Error('corrupt'); }, empty: () => null, ok: () => ({ v: 3 }) });
  assert.deepEqual(result.ids, ['ok']);
  assert.ok(box.errors.some(entry => /seedMissing:store:bad/.test(entry.stage)), 'hata raporlanmalı');
});

function usdSet() {
  const months = ['202501', '202502'];
  const rec = dims => [5, ...dims, 0.4, 0.3, 0.2, 0.1, [100, 101], [100, 101], [100, 101], [100, 101]];
  return { schemaVersion: 2, model: 'endeksmatik-usd-v1', months, records: [rec(['MMYG Çağ', 'MAG', 'Tedarik', 'Buying', 'Kategori'])], label: 'Sentetik' };
}

test('endeksmatik.seedMissing: delta\'da zaten bulunan set dosyası açılışta yeniden okunup indekslenmez', async t => {
  const box = await sandbox(t, 'delta');
  const setsDir = path.join(box.dataDir, 'endeksmatik-sets');
  fs.mkdirSync(setsDir, { recursive: true });
  const setPath = path.join(setsDir, 'em-0123456789abcdef.json.gz');
  fs.writeFileSync(setPath, zlib.gzipSync(JSON.stringify(usdSet())));
  const endeksmatik = require('../server/lib/endeksmatik');
  const first = await endeksmatik.seedMissing(box.store);
  assert.deepEqual(first.ids, ['set:em-0123456789abcdef'], 'eksik set ilk açılışta tohumlanmalı');
  await box.store.flush(); await box.store.hydrate();

  const original = fs.readFileSync;
  let setReads = 0;
  fs.readFileSync = function (file, ...rest) { if (String(file) === setPath) setReads += 1; return original.call(this, file, ...rest); };
  t.after(() => { fs.readFileSync = original; });
  const second = await endeksmatik.seedMissing(box.store);
  fs.readFileSync = original;
  assert.equal(second.seeded, 0);
  assert.equal(setReads, 0, 'tohumlanmış set her açılışta gunzip+parse+buildIndex edilmemeli');
});

test('endeksmatik.seedMissing: geçersiz set dosyası eskisi gibi tohumlanmaz', async t => {
  const box = await sandbox(t, 'delta');
  const setsDir = path.join(box.dataDir, 'endeksmatik-sets');
  fs.mkdirSync(setsDir, { recursive: true });
  fs.writeFileSync(path.join(setsDir, 'em-fedcba9876543210.json.gz'), zlib.gzipSync(JSON.stringify({ schemaVersion: 2, model: 'x', months: [], records: [] })));
  const endeksmatik = require('../server/lib/endeksmatik');
  const result = await endeksmatik.seedMissing(box.store);
  assert.equal(result.seeded, 0);
});

test('db.deltaSeedPayload: tohumlanmış store dosyası açılışta yeniden okunmaz', async t => {
  const box = await sandbox(t, 'delta');
  const db = require('../server/db');
  db.attachDeltaStore(box.store);
  t.after(() => db.attachDeltaStore(null));
  const file = path.join(box.dataDir, 'overrides.json');
  fs.writeFileSync(file, JSON.stringify({ ...db.defaultOverrides(), notesmap: { 'ORD-1': { Notes: 'x' } }, _revision: 3 }));
  const first = await box.store.seedMissing(db.DELTA_STORE_COLLECTION, db.deltaSeedPayload());
  assert.ok(first.ids.includes('overrides.json'));
  await box.store.flush(); await box.store.hydrate();
  assert.equal(db.loadOverrides().notesmap['ORD-1'].Notes, 'x', 'tohumlanan içerik delta\'dan okunmalı');
  assert.equal(db.loadOverrides()._revision, 3);

  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (target, ...rest) { if (String(target) === file) reads += 1; return original.call(this, target, ...rest); };
  t.after(() => { fs.readFileSync = original; });
  // Gerçek açılış sırası: yeni süreç, delta henüz hydrate EDİLMEDEN tohumlanır.
  const { createDeltaStore } = require('../server/lib/delta-store');
  const restarted = createDeltaStore({ localDb: box.localDb, mode: 'delta' });
  db.attachDeltaStore(restarted);
  // Önbelleğin isabet etmemesi için dosya imzası değişsin.
  fs.appendFileSync(file, ' ');
  const second = await restarted.seedMissing(db.DELTA_STORE_COLLECTION, db.deltaSeedPayload());
  fs.readFileSync = original;
  assert.equal(second.seeded, 0);
  assert.equal(reads, 0, 'delta\'da bulunan store için eski dosya okunup ayrıştırılmamalı');
});

test('db.loadOverrides (delta): varlık kontrolü kaydı ikinci kez derin kopyalamaz; dönen nesne bağımsız kalır', async t => {
  const box = await sandbox(t, 'delta');
  const db = require('../server/db');
  db.attachDeltaStore(box.store);
  t.after(() => db.attachDeltaStore(null));
  db.saveOverrides({ ...db.defaultOverrides(), notesmap: { 'ORD-1': { Notes: 'delta' } } });
  await box.store.flush(); await box.store.hydrate();

  const original = JSON.stringify;
  let deepCopies = 0;
  JSON.stringify = function (value, ...rest) { if (value && typeof value === 'object' && value.notesmap && value.notesmap['ORD-1']) deepCopies += 1; return original.call(this, value, ...rest); };
  let first;
  try { first = db.loadOverrides(); } finally { JSON.stringify = original; }
  assert.equal(deepCopies, 1, 'loadOverrides tek derin kopya almalı (storeExists kopya almamalı)');
  first.notesmap['ORD-1'].Notes = 'mutated';
  assert.equal(db.loadOverrides().notesmap['ORD-1'].Notes, 'delta', 'çağırana dönen nesne bellekteki kaydı paylaşmamalı');
});
