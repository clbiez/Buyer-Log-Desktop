'use strict';

/*
 * ORTAK STORE'LARIN (saveRevisioned) DELTA MOTORUNA AYNALANMASI
 *
 * saveRevisioned dokuz store'un ortak yazma yoludur. Bu dosya, ölçülen sıcak
 * yol olan overrides.json üzerinden şunları çiviler:
 *   · shadow fazında davranış hiç değişmez,
 *   · delta fazında okuma delta'dan gelir ama eski dosya geri dönüş için yazılır,
 *   · delta-only fazında yalnız TAM TAŞINMIŞ store'un eski yazması bırakılır,
 *   · delta tarafında bir sorun asla veriyi görünmez yapmaz,
 *   · revizyon çakışma kontrolü (409) her fazda çalışmaya devam eder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/* Modül grafiğini tamamen tazeler. Bu store'lar SERVER_DATA_ROOT'u modül
   yüklenirken okuyor; başka bir test dosyası onları farklı bir kökle yüklemiş
   olabilir. Yalnız birkaç dosyayı önbellekten düşürmek yetmiyor, çünkü
   aralarındaki bağımlılıklar eski kökü tutmaya devam ediyor. */
function resetServerModules() {
  const root = path.join(__dirname, '..', 'server') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root)) delete require.cache[key];
  }
}

/* Bu store'lar veri köklerini modül YÜKLENİRKEN okuyor, dolayısıyla test etmek
   için process.env'i değiştirmek ve modül grafiğini tazelemek gerekiyor. İkisi
   de süreç genelinde etkili: temizlenmezse, sonradan çalışan başka bir test
   dosyası bu testin silinmiş geçici klasörünü kök sanır. Bu yüzden hem ortam
   hem modül grafiği testin sonunda eski hâline döndürülür. */
const DATA_ROOT_VARS = ['BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT'];
function useDataRoots(t, roots) {
  const previous = DATA_ROOT_VARS.map(name => [name, process.env[name]]);
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetServerModules();
  });
  Object.assign(process.env, roots);
  resetServerModules();
}

async function sandbox(t, mode) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-ov-'));
  t.after(async () => {
    // Windows may keep the local DB write-lease directory alive for a few
    // milliseconds after the fire-and-forget mirror settles. Teardown is not
    // testing deletion semantics, so wait for the queue and use Node's native
    // EPERM retry instead of making the suite flaky under CI load.
    await settle();
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
  });
  const dataDir = path.join(root, 'server-data');
  await fsp.mkdir(dataDir, { recursive: true });

  useDataRoots(t, {
    BUYER_LOG_SERVER_DATA_ROOT: dataDir,
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  });
  const db = require('../server/db');
  const { createLocalDb } = require('../server/lib/local-db');
  const { createDeltaStore } = require('../server/lib/delta-store');

  const localDb = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await localDb.ensure();
  const errors = [];
  const store = createDeltaStore({ localDb, mode, onError: (stage, error) => errors.push({ stage, error }) });
  db.attachDeltaStore(store);
  t.after(() => db.attachDeltaStore(null));

  return { root, dataDir, db, store, localDb, errors, file: path.join(dataDir, 'overrides.json') };
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setTimeout(resolve, 30)); }

/* Ayna ateşle-unut çalışıyor, yani yazma çağrısı döndüğünde disk yazması henüz
   bitmemiş olabilir. Sabit bir uyku bunu tek başına çalışırken gizler ama tam
   test paketinin yükü altında düşer. Koşul sağlanana kadar hydrate edip
   yeniden bakmak, testi makinenin hızından bağımsız kılar. */
async function hydrateUntil(store, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // v20260926: hydrate yoldaki (diske henüz inmemiş) yazımları da belleğe
    // yeniden uygular; "aynaya yazıldı" kanıtı için önce bekleyen yazımlar biter.
    if (typeof store.flush === 'function') await store.flush();
    await store.hydrate();
    if (predicate(store)) return true;
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('shadow: eski dosya yetkili kalır, delta yalnız ayna alır', async t => {
  const box = await sandbox(t, 'shadow');
  box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-1': { note: 'shadow' } } });
  await settle();

  assert.ok(fs.existsSync(box.file), 'eski dosya yazılmalı');
  assert.equal(JSON.parse(fs.readFileSync(box.file, 'utf8')).notesmap['ORD-1'].note, 'shadow');

  await box.store.hydrate();
  const mirrored = box.store.readAllSync(box.db.DELTA_STORE_COLLECTION);
  assert.ok(mirrored && mirrored['overrides.json'], 'ayna kaydı oluşmalı');
  assert.equal(mirrored['overrides.json'].notesmap['ORD-1'].note, 'shadow');
  assert.deepEqual(box.errors, []);
});

test('delta: okuma delta’dan gelir, eski dosya geri dönüş için yazılmaya devam eder', async t => {
  const box = await sandbox(t, 'delta');
  box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-1': { note: 'delta yazdı' } } });
  await settle();
  await hydrateUntil(box.store, () => true);

  assert.ok(fs.existsSync(box.file), 'delta fazında eski dosya hâlâ yazılmalı (geri dönüş)');

  // Eski dosyayı kasten farklılaştır: okuma delta'dan geliyorsa bu görülmez.
  const legacy = JSON.parse(fs.readFileSync(box.file, 'utf8'));
  legacy.notesmap['ORD-1'].note = 'ESKİ DOSYADAN';
  fs.writeFileSync(box.file, JSON.stringify(legacy));

  assert.equal(box.db.loadOverrides().notesmap['ORD-1'].note, 'delta yazdı',
    'delta fazında yetkili kaynak delta olmalı');
});

test('delta-only: taşınmış store’un eski dosyası artık yazılmaz', async t => {
  const box = await sandbox(t, 'delta-only');
  box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-9': { note: 'yalnız delta' } } });
  await settle();
  await hydrateUntil(box.store, () => true);

  assert.equal(fs.existsSync(box.file), false, 'ağ yazması bırakılmalı — donma burada gider');
  assert.equal(box.db.loadOverrides().notesmap['ORD-9'].note, 'yalnız delta', 'veri delta’dan okunmalı');
});

test('saveRevisioned ailesinin tamamı taşındı: ayarlar da delta’dan okunur', async t => {
  // Okuma yolu artık readJsonWithBackup üzerinden bütün aileyi kapsıyor.
  const box = await sandbox(t, 'delta-only');
  box.db.saveSettings({ sourceFolder: 'C:/kaynak' });
  await settle();
  await hydrateUntil(box.store, () => true);

  assert.equal(fs.existsSync(path.join(box.dataDir, 'settings.json')), false,
    'delta-only fazında eski dosya yazılmamalı');
  assert.equal(box.db.loadSettings().sourceFolder, 'C:/kaynak', 'ayar delta’dan okunmalı');
});

test('revizyon üstverisi delta-only fazında da korunur', async t => {
  // Delta kayıtları alt çizgili alanları taşımaz; revizyon sarmalanmasaydı
  // sayaç her okumada sıfırlanır ve iyimser kilitleme çökerdi.
  const box = await sandbox(t, 'delta-only');
  const first = box.db.saveSettings({ sourceFolder: 'A' });
  await settle();
  await hydrateUntil(box.store, () => true);
  assert.equal(box.db.loadSettings()._revision, first._revision, 'revizyon korunmalı');

  const second = box.db.saveSettings({ sourceFolder: 'B' }, first._revision);
  await settle();
  await hydrateUntil(box.store, () => true);
  assert.equal(second._revision, first._revision + 1, 'sayaç ilerlemeli');
  assert.equal(box.db.loadSettings()._revision, second._revision);
});

test('kullanıcıya özel dosyalar ayrı kök önekiyle kimliklenir', async t => {
  const box = await sandbox(t, 'shadow');
  const shared = box.db.deltaStoreId(box.file);
  const scoped = box.db.deltaStoreId(path.join(box.root, 'app', 'fx-rates.json'));
  assert.equal(shared, 'overrides.json');
  assert.equal(scoped, 'user/fx-rates.json', 'iki kökteki aynı adlı dosya karışmamalı');
  assert.ok(!shared.includes('..') && !scoped.includes('..'), 'kimlik üst klasöre çıkmamalı');
});

test('delta okunamadığında eski dosyaya düşer — veri görünmez olmaz', async t => {
  const box = await sandbox(t, 'delta');
  box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-1': { note: 'diskteki değer' } } });
  await settle();
  // hydrate HİÇ çağrılmadı: readAllSync null döner.
  assert.equal(box.store.isHydrated, false, 'ön koşul');
  assert.equal(box.db.loadOverrides().notesmap['ORD-1'].note, 'diskteki değer',
    'hydrate edilmemişken eski dosya okunmalı');
});

test('ayna hatası kaydı düşürmez; eski dosya yine yazılır', async t => {
  const box = await sandbox(t, 'shadow');
  const broken = Object.create(box.store);
  Object.defineProperty(broken, 'mirror', { value: async () => { throw new Error('ayna bozuk'); } });
  box.db.attachDeltaStore(broken);

  // Fırlatan bir ayna bile kullanıcının kaydını engellememeli.
  assert.doesNotThrow(() => box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-2': { note: 'yine de kaydedildi' } } }));
  await settle();
  assert.equal(JSON.parse(fs.readFileSync(box.file, 'utf8')).notesmap['ORD-2'].note, 'yine de kaydedildi');
});

test('revizyon çakışması delta fazında da 409 üretir', async t => {
  const box = await sandbox(t, 'delta');
  const saved = box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: {} });
  await settle();
  assert.throws(
    () => box.db.saveOverrides({ ...box.db.defaultOverrides() }, saved._revision - 1),
    error => error && error.code === 'REVISION_CONFLICT' && error.statusCode === 409,
  );
});

test('kayıt kimliği veri köküne göreli yoldur; kullanıcı dosyaları karışmaz', async t => {
  const box = await sandbox(t, 'shadow');
  assert.equal(box.db.deltaStoreId(box.file), 'overrides.json');
  assert.equal(box.db.deltaStoreId(path.join(box.dataDir, 'user-preferences', 'u1.json')), 'user-preferences/u1.json');
  assert.notEqual(box.db.deltaStoreId(path.join(box.dataDir, 'user-preferences', 'u2.json')),
    box.db.deltaStoreId(path.join(box.dataDir, 'user-preferences', 'u1.json')));
});

test('bölüm bazlı merge: iki ayrı bölüme yazmak birbirini ezmez', async t => {
  // Gerçek senaryo: bir kullanıcı CP notu yazarken bir diğeri alt üretici
  // ataması yapıyor. Bugünkü "tüm dosyayı ez" davranışında biri diğerini
  // kaybederdi; alan bazlı merge ikisini de korur.
  const box = await sandbox(t, 'delta');
  box.db.saveOverrides({ ...box.db.defaultOverrides(), notesmap: { 'ORD-1': { note: 'not' } } });
  await settle();
  const current = box.db.loadOverrides();
  box.db.saveOverrides({ ...current, submap: { 'ORD-2': { sub: 'ÜRETİCİ A' } } });
  await settle();
  await hydrateUntil(box.store, () => true);

  const record = box.store.readAllSync(box.db.DELTA_STORE_COLLECTION)['overrides.json'];
  assert.deepEqual(record.submap, { 'ORD-2': { sub: 'ÜRETİCİ A' } }, 'yeni bölüm uygulanmalı');
  assert.deepEqual(record.notesmap, { 'ORD-1': { note: 'not' } }, 'dokunulmayan bölüm korunmalı');

  const back = box.db.loadOverrides();
  assert.equal(back.notesmap['ORD-1'].note, 'not');
  assert.equal(back.submap['ORD-2'].sub, 'ÜRETİCİ A');
});

/* ------------------------------------------- KENDİ YAZMA YOLU OLAN STORE'LAR */

async function ownLeaseSandbox(t, mode) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-own-'));
  // sandbox() ile aynı: Windows'ta yerel DB write-lock klasörü kısa süre açık
  // kalabilir; kuyruğu bekle ve EPERM'de Node'un yeniden denemesini kullan.
  t.after(async () => {
    await settle();
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
  });
  const dataDir = path.join(root, 'server-data');
  await fsp.mkdir(dataDir, { recursive: true });
  useDataRoots(t, {
    BUYER_LOG_SERVER_DATA_ROOT: dataDir,
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  });
  const modules = {
    emailGroups: require('../server/lib/email-groups-store'),
    workspaces: require('../server/lib/collection-workspaces'),
  };
  const { createLocalDb } = require('../server/lib/local-db');
  const { createDeltaStore } = require('../server/lib/delta-store');
  const localDb = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await localDb.ensure();
  const store = createDeltaStore({ localDb, mode });
  for (const module of Object.values(modules)) module.attachDeltaStore(store);
  t.after(() => { for (const module of Object.values(modules)) module.attachDeltaStore(null); });
  return { root, dataDir, store, ...modules };
}

test('e-posta grupları delta-only fazında eski dosyasız okunur', async t => {
  const box = await ownLeaseSandbox(t, 'delta-only');
  const saved = box.emailGroups.saveStore({ countries: [], types: [], records: [] }, null);
  await settle();
  await hydrateUntil(box.store, () => true);

  assert.equal(fs.existsSync(path.join(box.dataDir, 'email-groups.json')), false,
    'delta-only fazında ağa yazılmamalı');
  assert.equal(box.emailGroups.loadStore()._revision, saved._revision, 'revizyon korunmalı');
});

test('koleksiyon çalışma alanları sahip başına ayrı kayıt olur', async t => {
  const box = await ownLeaseSandbox(t, 'delta');
  box.workspaces.saveWorkspace('ali', { rows: [{ id: 1, model: 'A' }] });
  box.workspaces.saveWorkspace('veli', { rows: [{ id: 1, model: 'B' }] });

  const ready = await hydrateUntil(box.store, store => {
    const records = store.readAllSync('store') || {};
    return records['collection-workspaces/ali.json'] && records['collection-workspaces/veli.json'];
  });
  assert.ok(ready, 'iki çalışma alanı da aynaya yazılmalı');

  const records = box.store.readAllSync('store');
  assert.ok(records['collection-workspaces/ali.json'], 'ali ayrı kayıtta olmalı');
  assert.ok(records['collection-workspaces/veli.json'], 'veli ayrı kayıtta olmalı');
  assert.equal(box.workspaces.loadWorkspace('ali').rows[0].model, 'A');
  assert.equal(box.workspaces.loadWorkspace('veli').rows[0].model, 'B', 'sahipler karışmamalı');
});

test('eski dosya silinse bile delta fazında veri okunmaya devam eder', async t => {
  /* Geçişin kesin sınavı: ağdaki JSON hiç yokken store hâlâ dolu mu?
     shadow fazında yazıp aynayı biriktir, eski dosyayı sil, sonra aynı yerel
     DB'yi delta fazında aç. Veri yalnız delta motorundan gelebilir. */
  const box = await ownLeaseSandbox(t, 'shadow');
  box.workspaces.saveWorkspace('moderator', { rows: [{ id: 1, model: 'KORUNMALI' }] });
  await settle();

  const file = path.join(box.dataDir, 'collection-workspaces', 'moderator.json');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.bak`, { force: true });
  assert.equal(fs.existsSync(file), false, 'eski dosya silinmiş olmalı');

  const { createDeltaStore } = require('../server/lib/delta-store');
  const { createLocalDb } = require('../server/lib/local-db');
  const localDb = createLocalDb(path.join(box.root, 'local', 'BuyerLogLocal.db'));
  await localDb.ensure();
  const authoritative = createDeltaStore({ localDb, mode: 'delta' });
  await authoritative.hydrate();
  box.workspaces.attachDeltaStore(authoritative);

  assert.equal(box.workspaces.loadWorkspace('moderator').rows[0].model, 'KORUNMALI',
    'delta fazında veri eski dosya olmadan da okunmalı');
});
