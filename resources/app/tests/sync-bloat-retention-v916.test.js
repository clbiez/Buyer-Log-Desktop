'use strict';

/* v9.16 — SENKRONU ŞİŞİREN ÜÇ AYRI ARIZA.
 *
 * Sahadaki ölçüm: ortak klasör 222 MB / 465 paket, sync süresi 9,5 sn,
 * durum dosyasında uploadedEvents:464 (başarılı) ama pendingUpload:464.
 *
 * 1) source-refresh-history.json 53 MB'a çıkmıştı: kayıt SAYISI sınırlı
 *    (10) ama kayıt BOYUTU sınırsızdı — tek yenileme 8.603 satırlık bir
 *    "details" listesi üretiyordu.
 * 2) O dosya delta aynasından geçiyordu. Delta yaması üst düzey anahtar
 *    başına üretilir; "items" tek bir dizi anahtarı olduğu için her
 *    yenilemede 53 MB'ın TAMAMI yeni bir paket olarak ağa yazılıyordu.
 *    Karşılığında hiçbir cihaza yeni bilgi taşımıyordu: geçmiş, cihazın
 *    kendi denetim günlüğüdür; asıl veri zaten ayrı senkron oluyor.
 * 3) pendingUpload "onaylanmamış olay" sayıyordu. Onay ancak BAŞKA bir
 *    cihaz paketi okuyup ACK yazınca gelir; tek cihazlı kurulumda hiç
 *    gelmez, sayaç sonsuza dek şişer ve yükleme döngüsü her turda aynı
 *    paketleri yeniden tarar.
 *
 * Ayrıca: hub bir arşiv değil taşıma bandıdır; hiçbir budama olmadığı için
 * klasör süresiz büyüyordu. Saklama penceresi artık kullanıcı ayarıdır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings, normalizeRetentionDays, PACKAGE_RETENTION_CHOICES } = require('../server/lib/sync-settings');
const { SYNC_PACKAGE_DIR, isBundleFile } = require('../server/lib/sync-package');
const DB_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

/* ------------------------------------------------ 1) DETAY SATIRI SINIRI */

test('v9.16 yenileme geçmişi detayları sınırlanıyor ve toplam korunuyor', () => {
  const db = require('../server/db.js');
  // Sınır dışa açık olmalı ki istemci "…ve N satır daha" diyebilsin.
  assert.equal(typeof db.REFRESH_HISTORY_DETAIL_LIMIT, 'number');
  assert.ok(db.REFRESH_HISTORY_DETAIL_LIMIT > 0);
});

test('v9.16 kırpma DEĞİŞMEZ: tekrar normalize edilince toplam küçülmüyor', () => {
  // Kaynak metin üzerinden: detailsTotal ilk ölçülen değerde kalmalı, yoksa
  // her kaydetmede bir öncekinin kırpılmış hâli "toplam" sanılırdı.
  const start = DB_SOURCE.indexOf('function trimRefreshHistoryDetails');
  const end = DB_SOURCE.indexOf('function normalizeRefreshHistoryItems', start);
  assert.ok(start >= 0 && end > start, 'trimRefreshHistoryDetails bulunmalı');
  const block = DB_SOURCE.slice(start, end);
  assert.match(block, /Number\(item\.detailsTotal\) >= details\.length/);
  assert.match(block, /REFRESH_HISTORY_DETAIL_LIMIT/);
});

test('v9.16 kırpma kullanıcıdan GİZLENMİYOR', () => {
  /* 8.603 değişiklik diyen bir başlığın altında 1.000 satır görmek, gerisi
     kaybolmuş izlenimi verir. Kaç satırın gösterildiği ve gerçek toplam
     açıkça yazılmalı; sayaçlar da kırpılmış diziden değil detailsTotal'dan
     okunmalı, yoksa geçmişteki değişiklik sayısı kırpma yüzünden küçülürdü. */
  assert.match(APP, /const shown=\(rec\.details\|\|\[\]\)\.length,total=Number\(rec\.detailsTotal\)\|\|shown;/);
  assert.match(APP, /satırın ilk \$\{shown/);
  assert.match(APP, /Showing the first \$\{shown/);
  // Her iki sayaç da detailsTotal'a düşmeli.
  assert.equal((APP.match(/s\.totalChanges\|\|rec\.detailsTotal\|\|\(rec\.details\|\|\[\]\)\.length/g) || []).length, 2);
});

/* ------------------------------------------- 2) DELTA AYNASI KAPSAM DIŞI */

test('v9.16 yenileme geçmişi delta aynasına GİRMİYOR', () => {
  assert.match(DB_SOURCE, /const DELTA_MIRROR_EXCLUDED = new Set\(\[REFRESH_HISTORY_FILE\]\);/);
  assert.match(DB_SOURCE, /if \(!deltaStore \|\| deltaMirrorExcluded\(file\)\) return;/);
  // Tohumlama listesinden de çıkmalı; aksi hâlde açılışta yine aynalanırdı.
  assert.doesNotMatch(DB_SOURCE, /LEGACY_FX_FILE, REFRESH_HISTORY_FILE\]/);
});

test('v9.16 kapsam dışı dosya ESKİ JSON yolunu her zaman kullanır', () => {
  // delta-only fazında writesLegacy false olur. Kapsam dışı dosya delta'ya da
  // yazılmadığı için, bu kural olmasa veri HİÇBİR YERE yazılmazdı.
  assert.match(DB_SOURCE, /function deltaWritesLegacy\(file\) \{ return deltaMirrorExcluded\(file\) \|\| documents\(\)\.writesLegacy; \}/);
  // Ve delta'da kalmış bayat bir kayıt diskteki güncel dosyayı gölgelememeli.
  assert.match(DB_SOURCE, /function readFromDelta\(file\) \{\r?\n  if \(deltaMirrorExcluded\(file\)\) return null;/);
});

test('v9.16 kullanıcıya özel kopya da kapsam dışı', () => {
  // …/user/<id>/source-refresh-history.json ortak dosyayla aynı kurala tabi.
  const start = DB_SOURCE.indexOf('function deltaMirrorExcluded');
  const block = DB_SOURCE.slice(start, DB_SOURCE.indexOf('function mirrorToDelta', start));
  assert.match(block, /path\.basename\(resolved\) === path\.basename\(excluded\)/);
});

/* ------------------------------------------------- 3) SAYAÇ AYRIŞTIRMASI */

test('v9.16 pendingUpload yüklemeyi, pendingAck onayı sayar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-v916-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  await db.ensure();
  await db.queuePatch({ id: 'r1', patch: { name: 'A' } });

  assert.equal((await db.pending()).length, 1, 'yeni olay yüklenmeyi bekler');
  assert.equal((await db.unacknowledged()).length, 1);

  await db.markSynced([(await db.read()).journal[0].eventId]);
  // ASIL DÜZELTME: yükleme bittiğinde pendingUpload düşer, onay beklese bile.
  assert.equal((await db.pending()).length, 0, 'yüklenen olay bir daha yüklenmez');
  assert.equal((await db.unacknowledged()).length, 1, 'onay hâlâ bekleniyor');

  await db.markAcknowledged([(await db.read()).journal[0].eventId]);
  assert.equal((await db.unacknowledged()).length, 0);
});

test('v9.16 tek cihazlı kurulumda sayaç sıfırlanıyor', async t => {
  // Sahadaki durum: eş yok, dolayısıyla ACK hiç gelmiyor. Eskiden sayaç
  // burada 1'de takılı kalıyordu.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-v916-solo-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await db.queuePatch({ id: 'r1', patch: { name: 'A' } });
  await sync.save(shared);

  const first = await sync.syncOnce();
  assert.equal(first.online, true);
  assert.equal(first.pendingUpload, 0, 'başarılı sync sonrası bekleyen kalmamalı');
  assert.equal(first.pendingAck, 1, 'onaylayacak eş yok — bu bilgi kaybolmamalı');

  const second = await sync.syncOnce();
  assert.equal(second.pendingUpload, 0, 'sayaç turdan tura şişmemeli');
  assert.equal(second.uploadedEvents, 0, 'aynı paket yeniden taranmamalı');
});

/* ------------------------------------------------------ 4) PAKET BUDAMA */

test('v9.16 saklama süresi doğrulanıyor', () => {
  assert.equal(normalizeRetentionDays(30), 30);
  assert.equal(normalizeRetentionDays(0), 0, '0 = süresiz, geçerli bir seçim');
  assert.equal(normalizeRetentionDays('90'), 90);
  assert.equal(normalizeRetentionDays(7.9), 7, 'ondalık kırpılır');
  // Listede olmayan her değer varsayılana düşer; keyfi sayı kabul edilmez.
  assert.equal(normalizeRetentionDays(3), 30);
  assert.equal(normalizeRetentionDays(-5), 30);
  assert.equal(normalizeRetentionDays('abc'), 30);
  assert.equal(normalizeRetentionDays(null), 30);
  assert.ok(PACKAGE_RETENTION_CHOICES.includes(0) && PACKAGE_RETENTION_CHOICES.includes(365));
});

test('v9.16 saklama penceresinden eski paketler siliniyor, yenileri duruyor', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-v916-prune-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await db.queuePatch({ id: 'r1', patch: { name: 'A' } });
  await sync.save(shared);
  await sync.saveRetentionDays(30);
  await sync.syncOnce();

  const deviceRoot = path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(db.getDeviceId()));
  const bundleRoot = path.join(deviceRoot, SYNC_PACKAGE_DIR);
  const before = (await fsp.readdir(bundleRoot)).filter(name => isBundleFile(name));
  assert.equal(before.length, 1);

  // v2 bundle paketini 40 gün geriye yaşlandır; _head.json güncel bırakılır.
  const old = new Date(Date.now() - 40 * 86400000);
  await fsp.utimes(path.join(bundleRoot, before[0]), old, old);

  await sync.syncOnce();
  const after = await fsp.readdir(bundleRoot);
  assert.equal(after.filter(name => isBundleFile(name)).length, 0, 'eski v2 bundle silinmeli');
  assert.ok((await fsp.readdir(deviceRoot)).includes('_head.json'), '_head.json ASLA silinmemeli — uzak checkpoint ona bakar');
});

test('v9.16 "süresiz" seçilince hiçbir paket silinmiyor', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-v916-keep-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await db.queuePatch({ id: 'r1', patch: { name: 'A' } });
  await sync.save(shared);
  await sync.saveRetentionDays(0);
  await sync.syncOnce();

  const deviceRoot = path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(db.getDeviceId()));
  const bundleRoot = path.join(deviceRoot, SYNC_PACKAGE_DIR);
  const name = (await fsp.readdir(bundleRoot)).find(item => isBundleFile(item));
  const old = new Date(Date.now() - 400 * 86400000);
  await fsp.utimes(path.join(bundleRoot, name), old, old);

  const status = await sync.syncOnce();
  assert.equal(status.prunedPackages, 0);
  assert.ok((await fsp.readdir(bundleRoot)).includes(name), 'süresiz seçiliyken v2 bundle silinmemeli');
});

test('v9.16 budama YALNIZ kendi cihaz klasörünü hedefler', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'sync-settings.js'), 'utf8');
  const start = source.indexOf('async function prunePackages');
  const block = source.slice(start, source.indexOf('function notifyState', start));
  // Başka cihazın paketini silmek, onu henüz okumamış üçüncü bir cihazdan
  // veriyi kaçırırdı. Çağrı deviceRoot ile yapılmalı, changesRoot ile değil.
  assert.match(source, /prunePackages\(deviceRoot, ackRoot, deviceId, current\.packageRetentionDays\)/);
  assert.doesNotMatch(block, /changesRoot/);
  assert.match(block, /if \(name === NETWORK_HEAD_FILE\) continue;/);
});

test('v9.16 budama hatası senkronu düşürmüyor', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'sync-settings.js'), 'utf8');
  const start = source.indexOf('async function prunePackages');
  const block = source.slice(start, source.indexOf('function notifyState', start));
  // Klasör okunamazsa o format atlanır; tek tek silme hataları da yutulur.
  assert.match(block, /catch \(_\) \{ return; \}/);
  assert.match(block, /catch \(_\) \{ \/\* kilitli veya erişilemeyen paket/);
});

/* ------------------------------------------------------------ 5) ARAYÜZ */

test('v9.16 saklama süresi arayüzden ayarlanabiliyor', () => {
  // Mevcut periyot seçicisiyle AYNI kabuk kullanılır; yeni bileşen uydurulmaz.
  assert.match(APP, /class="syncPeriodControl"><span>\$\{tx\('Paketleri sakla'/);
  assert.match(APP, /<option value="0">\$\{tx\('Süresiz','Never'\)\}<\/option>/);
  // 0 seçilebilmeli: || 30 olsaydı "Süresiz" hiç seçilemezdi.
  assert.match(APP, /retention\.value=String\(q\.packageRetentionDays\?\?30\)/);
  assert.match(APP, /\/api\/sync-package-retention/);
  assert.match(SERVER, /app\.put\('\/api\/sync-package-retention'/);
  assert.match(SERVER, /syncSettings\.saveRetentionDays/);
});

test('v9.16 budama ve onay sayaçları kullanıcıya görünüyor', () => {
  assert.match(APP, /data-sync-pruned/);
  assert.match(APP, /data-sync-pending-ack/);
});

/* ------------------------------------------- 6) BİLDİRİM SELİ (v7.21 kuralı) */

test('v9.16 REGRESYON: uzak Koleksiyon bildirimi epizot başına bir kez', () => {
  const start = APP.indexOf('async function kolHandleRemoteChange');
  // Bitiş çapası fonksiyonun HEMEN sonrası olmalı; 'async function' araması
  // çok ileri gidip komşu bloklardaki toast'ları yanlışlıkla kapsıyordu.
  const end = APP.indexOf('/* ==============', start);
  assert.ok(end > start, 'fonksiyon sınırı bulunmalı');
  const block = APP.slice(start, end);
  /* Kirli workspace dalı her uzak olayda bir toast atıyordu; workspace kirli
     kaldığı sürece bu bir bildirim seline dönüşüyordu. Bildirimi tamamen
     kaldırmak da yanlış: collection-concurrency-v721 ertelenen değişikliğin
     kullanıcıdan GİZLENMEMESİNİ şart koşuyor. Doğru granülerlik epizot. */
  assert.equal((block.match(/showToast\(/g) || []).length, 1, 'tek bildirim çağrısı');
  assert.match(block, /if\(!kolRemoteChangeNoticeShown\)\{/, 'koşulsuz atılmamalı');
  assert.match(block, /kolRemoteChangeNoticeShown=false;/, 'temize dönünce sıfırlanmalı');
  // Yerel giriş yine de korunmalı — bildirim kuralı veri kaybına dönüşmemeli.
  assert.match(block, /kolPersistPendingWorkspace\('remote-change'\)/);
});
