'use strict';
/* Açılış snapshot yüklemesi ana thread'i tek blokta tutmaz.
 *
 * Saha: 321 MiB'lık (çözülmüş) moderatör snapshot'ı açılışta tek JSON.parse +
 * v3 çözme + tarih dönüşümüyle okunuyor, olay döngüsü 7-22 sn duruyordu
 * ([RUNTIME] event-loop-stall). server.js'teki GERÇEK ensureDataLoaded →
 * loadInitialDataAndLfl → hydrateModelSnapshotAsync zinciri vm ile çalıştırılır;
 * snapshot gerçek model-snapshot.js ile ~60k satırlık v3 dosyasından okunur.
 * Sözleşme: (1) yükleme boyunca olay döngüsü 200 ms'den uzun bloklanmaz,
 * (2) sonuç senkron yüklemeyle birebir aynıdır (Date tipleri ve hedef takma ad
 * paylaşımı dahil), (3) eşzamanlı istekler tek yüklemeyi bekler, (4) yükleme
 * sırasında reset/yenileme olursa eski yükleme sonucu önbelleğe yazılmaz.
 * Kapsam: snapshot okuma/çözme ve hydrate bağlantısı. hydrateSnapshotPayload'un
 * senkron son adımları (withFabricDimensions, userAccess.syncProfiles) burada
 * taklittir; gerçek sunucudaki payları L2 ölçümünde ayrıca raporlanır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-startup-coop-'));
for (const [name, folder] of Object.entries({ BUYER_LOG_DATA_ROOT:'app', BUYER_LOG_LOCAL_DATA_ROOT:'local', BUYER_LOG_SERVER_DATA_ROOT:'server', BUYER_LOG_TEMP_ROOT:'temp' })) process.env[name] = path.join(root, folder);
delete process.env.BUYER_LOG_AUTH_DATA_ROOT;
test.after(() => fs.rmSync(root, { recursive:true, force:true }));

const snapshots = require('../server/lib/model-snapshot');
const SERVER = fs.readFileSync(require.resolve('../server/server.js'), 'utf8');
const ROWS = Number(process.env.BL_COOP_LOAD_ROWS) || 60000;
const MAX_BLOCK_MS = 200;

function slice(startMarker, endMarker) {
  const start = SERVER.indexOf(startMarker), end = SERVER.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `server.js bölümü bulunamadı: ${startMarker}`);
  return SERVER.slice(start, end);
}
const SOURCE = [
  slice('function emptySourceCache() {', '\n}\n') + '\n}\n',
  slice('function sourceUserId(value) {', '\n/* Yalnız test/sonda içindir'),
  slice('function resetUserCache(value) {', '\nfunction sourceFolderForUser('),
  slice('function hydrateSnapshotPayload(', '\n\nasync function saveRuntimeModelSnapshot('),
  slice('async function loadInitialDataAndLfl(value){', '\n/* Backlog uçları'),
].join('\n');

function serverRuntime({ loadAsync = snapshots.loadModelSnapshotAsync } = {}) {
  const calls = { async:0 };
  const context = {
    setImmediate, Promise, Date, Object, Array, Map, Set, Error, JSON, console,
    sourceCaches:new Map(), initialDataLoadPromises:new Map(), sourceCacheLastAccess:new Map(),
    retireUserComputeSource() {}, withFabricDimensions:meta => meta, userAccess:{ syncProfiles() {} },
    collectionLflSourceVersion:require('../server/lib/collection-lfl-source-version').collectionLflSourceVersion,
    loadModelSnapshot:snapshots.loadModelSnapshot,
    loadModelSnapshotAsync:(...args) => { calls.async += 1; return loadAsync(...args); },
  };
  vm.createContext(context);
  vm.runInContext(`${SOURCE}\nthis.api={ensureDataLoaded,hydrateModelSnapshot,resetUserCache,replaceUserCache,cacheForUser};`, context);
  return { ...context.api, context, calls };
}

const SOURCE_COLUMNS = Array.from({ length:36 }, (_, i) => `Kaynak Sütun ${i}`); // i18n-ignore
function fixture(rowCount) {
  const orders = Array.from({ length:rowCount }, (_, i) => ({
    ocode:`ORD-${i}`, model:`MODEL ${i % 97}`, season:'6S27', qty:i * 3, fob:4.5 + (i % 11), // i18n-ignore
    opd:new Date(Date.UTC(2026, 2, 9 + (i % 20), 21)), exf:new Date(Date.UTC(2026, 5, 1 + (i % 25))),
    _sourceFields:Object.fromEntries(SOURCE_COLUMNS.map((name, c) => [name, c % 5 ? `${name.slice(-2)}-${i % (c + 7)}` : i * c])),
    _cpExtra:{ '__CPX_Tedarikçi Grup':`GRUP ${i % 13}` }, // i18n-ignore
    _matchValues:{ 'Sipariş Kod':`ORD-${i}`, Renk:i % 2 ? 'BLUE' : 'RED' }, // i18n-ignore
  }));
  const antrepoMap = Object.fromEntries(orders.slice(0, rowCount >> 2).map((row, i) => [row.ocode, { qty:i, eta:'2026-04-01T00:00:00.000Z', _sourceFields:{ 'Konteyner No':`MSKU${i}` } }])); // i18n-ignore
  const lflRows = orders.map((row, i) => ({ id:`Model:${i + 2}`, season:'6S27', fob:row.fob, quantity:i + 1, _asas:{ ...row._sourceFields } }));
  return {
    loadedAt:'2026-11-05T08:00:00.000Z', sources:{ asas:'Model: ASAS' },
    asasOrders:orders, asasOrdersByTarget:{ cp:orders, orders, backlog:orders.slice(0, rowCount >> 1), priceanalysis:orders },
    antrepoMap, antrepoMapByTarget:{ cp:antrepoMap, orders:antrepoMap, backlog:antrepoMap },
    lflRows, lflMeta:{ rowCount:lflRows.length, warnings:[], dimensions:{} }, lflLoadedAt:'2026-11-05T08:00:00.000Z',
  };
}
// Date tipini koruyan kanonik özet: JSON.stringify Date'i metne çevirir, burada
// tutucu nesneden (this[key]) gerçek tip okunur.
function digest(value) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(value, function replacer(key, item) { return this[key] instanceof Date ? { $date:this[key].toISOString() } : item; }) ?? 'undefined');
  return hash.digest('hex');
}
function cacheDigest(cache) {
  const out = {};
  for (const [key, value] of Object.entries(cache)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && /ByTarget$/.test(key)) {
      for (const [target, rows] of Object.entries(value)) out[`${key}.${target}`] = digest(rows);
    } else out[key] = digest(value);
  }
  return out;
}
function aliasShape(cache) {
  return Object.fromEntries(Object.entries(cache.asasOrdersByTarget || {}).map(([target, rows]) => [target, rows === cache.asasOrders]));
}
function maxEventLoopBlock() {
  let last = performance.now(), max = 0;
  const timer = setInterval(() => { const now = performance.now(); max = Math.max(max, now - last - 5); last = now; }, 5);
  return () => { clearInterval(timer); const now = performance.now(); return Math.max(max, now - last - 5); };
}

test('startup snapshot load yields to the event loop and hydrates exactly what the synchronous load does', { timeout:240000 }, async () => {
  await snapshots.saveModelSnapshotAsync('moderator', fixture(ROWS));
  // Isınma: modül/JIT ilk çağrı maliyeti ölçümü kirletmesin.
  serverRuntime().hydrateModelSnapshot('moderator');

  /* Beklenen sonuç ölçümden ÖNCE Date tipini koruyan sha256 özetlerine indirgenir
     ve referans önbellek bırakılır. Kök neden ([Doğrulandı], perf_hooks 'gc'
     gözlemcisi): referans kopya canlıyken ölçülen en uzun blok her koşuda
     yükleme penceresine düşen bir major GC (mark-compact) duraklamasıydı
     (117-298 ms, heap ~430 MB). Referans, sahada açılışta hiç olmayan ikinci
     tam snapshot kopyasıdır; bırakılınca pencereye düşen GC'ler 21-60 ms, heap
     ~216 MB ve en uzun blok GC dışı ~60-90 ms oldu. Eşdeğerlik sözleşmesi aynı
     özetlerle aynen denetlenir; 200 ms sınırı değişmez. */
  let expected = serverRuntime().hydrateModelSnapshot('moderator');
  const want = { alias:aliasShape(expected), loadedAt:expected.loadedAt, lflLoadedAt:expected.lflLoadedAt, digest:cacheDigest(expected) };
  expected = null;

  const runtime = serverRuntime();
  await new Promise(resolve => setTimeout(resolve, 20));
  const stop = maxEventLoopBlock(), started = performance.now();
  const loaded = await runtime.ensureDataLoaded('moderator');
  const blockedMs = stop(), totalMs = performance.now() - started;

  assert.ok(blockedMs < MAX_BLOCK_MS, `event loop ${Math.round(blockedMs)} ms bloklandı (sınır ${MAX_BLOCK_MS} ms, toplam ${Math.round(totalMs)} ms)`);
  assert.ok(loaded === runtime.cacheForUser('moderator'), 'yüklenen önbellek aktif önbellektir');
  assert.equal(loaded.asasOrders.length, ROWS);
  assert.ok(loaded.asasOrders[0].opd instanceof Date, 'tarih alanları Date olarak geri gelir');
  assert.deepEqual(aliasShape(loaded), want.alias);
  assert.equal(loaded.loadedAt, want.loadedAt);
  assert.equal(loaded.lflLoadedAt, want.lflLoadedAt);
  assert.deepEqual(cacheDigest(loaded), want.digest);
});

test('concurrent requests during the cooperative load share one load promise', async () => {
  await snapshots.saveModelSnapshotAsync('demo', fixture(200));
  const runtime = serverRuntime();
  const [a, b, c] = await Promise.all([runtime.ensureDataLoaded('demo'), runtime.ensureDataLoaded('demo'), runtime.ensureDataLoaded('demo')]);
  assert.equal(runtime.calls.async, 1, 'tek snapshot okuması');
  assert.ok(a === b && b === c && a === runtime.cacheForUser('demo'));
  assert.equal(runtime.context.initialDataLoadPromises.size, 0);
  assert.ok(await runtime.ensureDataLoaded('demo') === a, 'yüklü önbellek yeniden okunmaz');
  assert.equal(runtime.calls.async, 1);
});

test('a reset or refresh during the load wins; the stale load never overwrites the newer cache', async () => {
  await snapshots.saveModelSnapshotAsync('demo', fixture(200));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = serverRuntime({ loadAsync:async (...args) => { await gate; return snapshots.loadModelSnapshotAsync(...args); } });

  // 1) Yükleme sürerken ASAS yenilemesi önbelleği değiştirir.
  const first = runtime.ensureDataLoaded('demo');
  const refreshed = runtime.replaceUserCache('demo', { loadedAt:'2026-11-22T10:00:00.000Z', asasOrders:[{ ocode:'NEW' }], lflLoadedAt:'2026-11-22T10:00:00.000Z' });
  release();
  assert.ok(await first === refreshed, 'bekleyen çağıran güncel önbelleği alır');
  assert.ok(runtime.cacheForUser('demo') === refreshed, 'yenileme sonucu korunur');

  // 2) Reset sonrası başlayan yükleme, eski yüklemenin finally'siyle düşmez (çift yükleme yok).
  const gate2 = { open:null };
  const runtime2 = serverRuntime({ loadAsync:async (...args) => { await new Promise(resolve => { gate2.open = resolve; }); return snapshots.loadModelSnapshotAsync(...args); } });
  const stale = runtime2.ensureDataLoaded('demo');
  await new Promise(setImmediate);
  const openStale = gate2.open;
  runtime2.resetUserCache('demo');
  const fresh = runtime2.ensureDataLoaded('demo'), freshEntry = runtime2.context.initialDataLoadPromises.get('demo');
  await new Promise(setImmediate);
  const openFresh = gate2.open;
  openStale();
  const staleResult = await stale;
  assert.equal(staleResult.loadedAt, null, 'reset edilmiş önbelleğe eski snapshot yazılmaz');
  assert.ok(runtime2.context.initialDataLoadPromises.get('demo') === freshEntry, 'yeni yükleme kaydı korunur');
  const third = runtime2.ensureDataLoaded('demo');
  openFresh();
  const [freshResult, thirdResult] = await Promise.all([fresh, third]);
  assert.ok(thirdResult === freshResult, 'üçüncü çağıran aynı yüklemeyi bekler');
  assert.equal(freshResult.asasOrders.length, 200);
  assert.equal(runtime2.calls.async, 2, 'çift yükleme yok');
});
