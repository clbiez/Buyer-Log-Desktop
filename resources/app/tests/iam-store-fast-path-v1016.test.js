'use strict';

/* v10.16 — IAM DEPOSU OKUMA YOLU.
 *
 * Canlı veride ölçülen kusur: her izin kontrolü, önbellek sıcak olsa bile
 * 1 MB'lik user-access.json'ı yeniden okuyup ayrıştırıyordu.
 *
 *   depo 1.095 KB · 47 kullanıcı · 6.248 sipariş yetkisi
 *   readStore()                    12,8 ms  →  0,011 ms
 *   hasPermission() store'suz      11,8 ms  →  0,109 ms
 *
 * İki ayrı sebep vardı ve ikisi de burada kilitleniyor:
 *
 *   1) migrateLegacyAuthStoreIfNeeded() ÖNBELLEK KONTROLÜNDEN ÖNCE çalışıyordu.
 *      Bu bir açılış/geçiş kararıdır; dosya değişmediyse karar da değişmez.
 *   2) Önbellek isabet etse bile tüm depo derin kopyalanıyordu. Okuyucular
 *      store'u değiştirmiyor; kopya yalnız yazan yollar için gerekli.
 *
 * Kilitlenen asıl güvence HIZ DEĞİL, DOĞRULUKTUR: hızlı yol devreye girdiğinde
 * bile dosya değişikliği görülmeli ve yazan yolların yalıtımı bozulmamalıdır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-access.js'), 'utf8');

/* Gerçek depo yerine kendi kurduğumuz izole bir depo: test üretim verisine
   dokunmaz ve her koşumda aynı sonucu verir. */
function makeStore(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-iam-'));
  const store = {
    schemaVersion: 8,
    _revision: 3,
    moderator: {
      id: 'moderator', role: 'moderator', systemRole: 'moderator',
      username: 'Test Moderatörü', displayName: 'Test Moderatörü',
      passwordHash: 'x'.repeat(64), enabled: true, status: 'ACTIVE',
    },
    users: Array.from({ length: 12 }, (_, index) => ({
      id: 'u' + index, role: 'buyer', systemRole: 'buyer',
      username: 'Kullanıcı ' + index, displayName: 'Kullanıcı ' + index,
      enabled: true, status: 'ACTIVE', mags: ['MAG' + (index % 3)],
    })),
    orderAccess: {}, scopeCatalog: {},
    ...extra,
  };
  fs.writeFileSync(path.join(root, 'user-access.json'), JSON.stringify(store), 'utf8');
  return root;
}

/*
 * TAM İZOLASYON — ikisi de canlıda öğrenildi:
 *
 * 1) AUTH ve SERVER kökü AYNI olmalı. Aksi hâlde
 *    migrateLegacyAuthStoreIfNeeded gerçek kurulumdaki user-access.json'ı
 *    "daha zengin eski depo" sayıp testin deposunun ÜSTÜNE kopyalar; test
 *    sessizce gerçek veriyi okur (ilk denemede tam olarak bu oldu).
 *
 * 2) server/ altındaki TÜM modüller require önbelleğinden düşürülmeli.
 *    user-data.js veri köklerini kendi yüklenme anında hesaplıyor; yalnız
 *    user-access.js'i tazelemek eski kökü yerinde bırakır.
 */
function freshModule(authRoot) {
  process.env.BUYER_LOG_AUTH_DATA_ROOT = authRoot;
  process.env.BUYER_LOG_SERVER_DATA_ROOT = authRoot;
  const serverRoot = path.join(ROOT, 'server') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(serverRoot)) delete require.cache[key];
  }
  return require(path.join(ROOT, 'server', 'lib', 'user-access.js'));
}

test('v10.16 readStore() önbellek nesnesini döndürür — izin kontrolü başına klon yok', () => {
  const root = makeStore();
  const ua = freshModule(root);
  const first = ua.readStore();
  const second = ua.readStore();
  assert.equal(first, second, 'sıcak önbellekte aynı nesne dönmeli (klon değil)');
  fs.rmSync(root, { recursive: true, force: true });
});

test('v10.16 loadStore() ÖZEL KOPYA döndürmeye devam eder — yazan yolların yalıtımı bozulmadı', () => {
  const root = makeStore();
  const ua = freshModule(root);
  const copy = ua.loadStore();
  copy.moderator.displayName = '###BOZULDU###';
  assert.notEqual(ua.loadStore().moderator.displayName, '###BOZULDU###');
  assert.notEqual(ua.readStore().moderator.displayName, '###BOZULDU###');
  fs.rmSync(root, { recursive: true, force: true });
});

/* HIZLI YOLUN EN TEHLİKELİ HATASI: dosya değiştiği hâlde eski veriyi sunmak.
   Bu, kullanıcı yetkisi kaldırıldıktan sonra erişimin sürmesi demek olurdu. */
test('v10.16 dosya değişince hızlı yol devreden çıkar — bayat yetki servis edilmez', () => {
  const root = makeStore();
  const ua = freshModule(root);
  assert.equal(ua.readStore().moderator.displayName, 'Test Moderatörü');

  const file = path.join(root, 'user-access.json');
  const next = JSON.parse(fs.readFileSync(file, 'utf8'));
  next.moderator.displayName = 'Yeni Moderatör Adı';
  next._revision = 9;
  fs.writeFileSync(file, JSON.stringify(next), 'utf8');

  assert.equal(ua.readStore().moderator.displayName, 'Yeni Moderatör Adı');
  assert.equal(ua.readStore()._revision, 9);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v10.16 türetilmiş yetkiler iki yoldan da AYNI — hız çıktıyı değiştirmedi', () => {
  const root = makeStore();
  const ua = freshModule(root);
  const shared = ua.readStore();
  const copied = ua.loadStore();
  for (const profile of [shared.moderator, ...shared.users]) {
    assert.deepEqual(
      ua.effectivePermissions(profile, shared),
      ua.effectivePermissions(profile, copied),
      profile.id + ' için izinler ayrışmamalı');
    assert.deepEqual(ua.effectiveScopes(profile, shared), ua.effectiveScopes(profile, copied));
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/* Kaynak sözleşmesi: eski-depo taşıma kontrolü sıcak yolda ÇALIŞMAMALI.
   Geri alınırsa izin kontrolü başına 12,8 ms geri gelir. */
test('v10.16 eski-depo taşıma kontrolü önbellek ıskasına bağlı', () => {
  const fastPath = SOURCE.indexOf('HIZLI YOL');
  const migrate = SOURCE.indexOf('migrateLegacyAuthStoreIfNeeded();');
  assert.ok(fastPath > 0, 'hızlı yol açıklaması kaybolmuş');
  assert.ok(migrate > fastPath,
    'taşıma kontrolü hızlı yoldan ÖNCE çalışıyor — her izin kontrolünde 1 MB okunur');
  // Taşımadan sonra dosya değişmiş olabilir; imza taşımadan SONRA hesaplanmalı.
  assert.ok(SOURCE.indexOf('const tag = storeTag();') > migrate);
});

test('v10.16 salt-okuma fonksiyonları readStore, yazan yollar loadStore kullanır', () => {
  for (const signature of [
    'function effectivePermissions(profile, store = readStore())',
    'function hasPermission(profile, key, store = readStore())',
    'function effectiveScopes(profile, store = readStore())',
    "function canEditOrder(profile, order, store = readStore(), { sharedOnly = false, recordId = '', orderAccess = store.orderAccess } = {})",
    'function publicProfile(profile, store = readStore())',
    'function collectionAccessLevel(profile, ownerId, store = readStore())',
  ]) assert.ok(SOURCE.includes(signature), 'okuma yolu değişmiş: ' + signature);
  // saveStore gibi yazan yollar klonlu yolda kalmalı.
  assert.match(SOURCE, /function loadStore\(\) \{ return resolveStore\(false\); \}/);
  assert.match(SOURCE, /function readStore\(\) \{ return resolveStore\(true\); \}/);
});
