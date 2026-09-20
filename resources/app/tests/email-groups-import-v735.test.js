'use strict';

/*
 * v7.35 — PREPARE E-MAIL KAYITLARININ ORTAK ALANA TAŞINMASI
 *
 * Kullanıcı talebi (birebir):
 *   "Manufacturer Email Groups alanına, Prepare E-Mail alanındaki kayıtları
 *    taşı."
 *
 * Kullanıcının seçtiği iki karar (soruldu, cevaplandı):
 *   · Taşındıktan sonra Prepare E-Mail adresi ORTAK ALANDAN okur.
 *   · E-postası girilmemiş üreticiler de taşınır.
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *   1) TAŞIMA ÜZERİNE YAZMAZ (§142/§152). Ortak alandaki farklı bir adres
 *      sessizce değiştirilmez; çakışma adıyla bildirilir.
 *   2) BOŞ ALAN DOLDURULUR. Ortak kayıtta adres yoksa ve adayda varsa yazılır;
 *      bu kazançtır, kayıp değil.
 *   3) BAŞKASININ DÜZENLEDİĞİ KAYDA DOKUNULMAZ (§32).
 *   4) TEK YAZMA İŞLEMİ. 20 kayıt 20 istek olsaydı ortadaki bir hata yarım
 *      taşınmış liste bırakırdı.
 *   5) SONUÇ SAYILARLA BİLDİRİLİR. "Taşındı" demek, neyin taşınmadığını
 *      gizlemek olurdu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SERVER = read('server/server.js');
const APP = read('public/app-main.js');
const EG = read('public/email-groups.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-egimport-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const store = require(path.join(ROOT, 'server', 'lib', 'email-groups-store.js'));

const ACTOR = { id: 'moderator', name: 'GÖKBERK ÇELEBİ' };
const OTHER = { id: 'user-2', name: 'AYŞE ERCAN' };
function resetStore(records = []) {
  const base = store.defaultStore();
  store.saveStore({ ...base, records: records.map(store.normalizeRecord) }, undefined);
}

/* ------------------------------------------------------------------ */
/* 1) TAŞIMA                                                           */
/* ------------------------------------------------------------------ */

test('v7.35 · ortak alanda olmayan üreticiler yeni kayıt olarak taşınır', () => {
  resetStore();
  const result = store.importRecords([
    { manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' },
    { manufacturer: 'TAHA GİYİM', email: 'satis@taha.example' },
  ], ACTOR);
  assert.equal(result.summary.added.length, 2);
  const saved = store.loadStore().records;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(r => r.manufacturer === 'ELSIWA APPAREL').email, 'info@elsiwa.example');
  assert.equal(saved[0].createdByName, 'GÖKBERK ÇELEBİ', 'kaydı kimin taşıdığı yazılmalı');
});

test('v7.35 · e-postası olmayan üretici de taşınır (kullanıcının seçimi)', () => {
  resetStore();
  const result = store.importRecords([{ manufacturer: 'ADRESSİZ ÜRETİCİ', email: '' }], ACTOR);
  assert.equal(result.summary.added.length, 1);
  const saved = store.loadStore().records;
  assert.equal(saved[0].manufacturer, 'ADRESSİZ ÜRETİCİ');
  assert.equal(saved[0].email, '', 'eksik adres uydurulmaz — ekranda eksik görünür ve oradan tamamlanır');
});

test('v7.35 · adı ve adresi boş olan aday kayıt üretmez', () => {
  resetStore();
  const result = store.importRecords([{ manufacturer: '   ', email: '' }, null, 'metin'], ACTOR);
  assert.equal(result.summary.added.length, 0);
  assert.equal(store.loadStore().records.length, 0);
});

/* ------------------------------------------------------------------ */
/* 2) ÜZERİNE YAZILMAZ                                                 */
/* ------------------------------------------------------------------ */

test('v7.35 · ortak alandaki FARKLI adresin üzerine yazılmaz, çakışma bildirilir', () => {
  resetStore([{ id: 'em-1', manufacturer: 'ELSIWA APPAREL', email: 'sales@elsiwa.example' }]);
  const result = store.importRecords([{ manufacturer: 'elsiwa apparel', email: 'eski@elsiwa.example' }], ACTOR);
  assert.equal(result.summary.added.length, 0);
  assert.equal(result.summary.filled.length, 0);
  assert.deepEqual(result.summary.conflicts, [
    { manufacturer: 'ELSIWA APPAREL', current: 'sales@elsiwa.example', incoming: 'eski@elsiwa.example' },
  ], 'hangi adresin doğru olduğuna program karar veremez');
  assert.equal(store.loadStore().records[0].email, 'sales@elsiwa.example', 'kayıt değişmemeli');
});

test('v7.35 · ortak kayıtta adres BOŞSA doldurulur (kazanç, kayıp değil)', () => {
  resetStore([{ id: 'em-1', manufacturer: 'ELSIWA APPAREL', email: '' }]);
  const result = store.importRecords([{ manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' }], ACTOR);
  assert.deepEqual(result.summary.filled, ['ELSIWA APPAREL']);
  assert.equal(result.summary.added.length, 0, 'ikinci bir kopya oluşturulmamalı');
  const saved = store.loadStore().records;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, 'info@elsiwa.example');
  assert.equal(saved[0].updatedByName, 'GÖKBERK ÇELEBİ');
});

test('v7.35 · aynı adres zaten varsa hiçbir şey değişmez', () => {
  resetStore([{ id: 'em-1', manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' }]);
  const before = store.loadStore()._revision;
  const result = store.importRecords([{ manufacturer: 'ELSIWA APPAREL', email: 'INFO@elsiwa.example' }], ACTOR);
  assert.deepEqual(result.summary.unchanged, ['ELSIWA APPAREL']);
  assert.equal(store.loadStore()._revision, before, 'boşuna revizyon artırmak diğer ekranları gereksiz tazelerdi');
});

test('v7.35 · üretici adı Türkçe büyük/küçük harf farkıyla eşleşir', () => {
  resetStore([{ id: 'em-1', manufacturer: 'IŞIK TEKSTİL', email: '' }]);
  const result = store.importRecords([{ manufacturer: 'ışık tekstil', email: 'info@isik.example' }], ACTOR);
  assert.deepEqual(result.summary.filled, ['IŞIK TEKSTİL'], 'aynı üretici iki kez kaydedilmemeli');
  assert.equal(store.loadStore().records.length, 1);
});

/* ------------------------------------------------------------------ */
/* 3) KİLİT VE BÜTÜNLÜK                                                */
/* ------------------------------------------------------------------ */

test('v7.35 · başkasının düzenlediği kayda dokunulmaz, atlandığı bildirilir (§32)', () => {
  resetStore([{ id: 'em-1', manufacturer: 'ELSIWA APPAREL', email: '' }]);
  store.acquireLock('em-1', OTHER);
  const result = store.importRecords([{ manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' }], ACTOR);
  assert.deepEqual(result.summary.locked, ['ELSIWA APPAREL']);
  assert.equal(store.loadStore().records[0].email, '', 'düzenlenen kayıt değiştirilmemeli');
});

test('v7.35 · kendi kilidini tutan kullanıcı için taşıma engellenmez', () => {
  resetStore([{ id: 'em-1', manufacturer: 'ELSIWA APPAREL', email: '' }]);
  store.acquireLock('em-1', ACTOR);
  const result = store.importRecords([{ manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' }], ACTOR);
  assert.deepEqual(result.summary.filled, ['ELSIWA APPAREL']);
});

test('v7.35 · aday listesindeki tekrarlar tek kayıt olur, adresi olan kazanır', () => {
  resetStore();
  const result = store.importRecords([
    { manufacturer: 'ELSIWA APPAREL', email: '' },
    { manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example' },
  ], ACTOR);
  assert.equal(store.loadStore().records.length, 1, 'aynı üretici iki kayıt üretmemeli');
  assert.equal(result.summary.added.length, 1);
});

test('v7.35 · taşıma TEK yazma işlemidir, yarım liste bırakmaz', () => {
  resetStore();
  const candidates = Array.from({ length: 25 }, (_, i) => ({ manufacturer: `ÜRETİCİ ${i}`, email: `u${i}@example.com` }));
  const before = store.loadStore()._revision;
  store.importRecords(candidates, ACTOR);
  const after = store.loadStore();
  assert.equal(after.records.length, 25);
  assert.equal(after._revision, before + 1, '25 kayıt tek revizyonla yazılmalı');
});

test('v7.35 · eşzamanlı yazma sessizce kaybolmaz: revizyon çakışması bildirilir', () => {
  resetStore();
  const stale = store.loadStore()._revision;
  store.createRecord({ manufacturer: 'ARADAN GİREN', email: 'a@example.com' }, OTHER);
  assert.throws(() => store.importRecords([{ manufacturer: 'YENİ', email: 'y@example.com' }], ACTOR, stale),
    /revizyon|revision|değiş/i);
});

test('v7.35 · taşıma hiçbir kaydı SİLMEZ (§142)', () => {
  resetStore([
    { id: 'em-1', manufacturer: 'KALSIN A', email: 'a@example.com' },
    { id: 'em-2', manufacturer: 'KALSIN B', email: 'b@example.com' },
  ]);
  store.importRecords([{ manufacturer: 'YENİ ÜRETİCİ', email: 'y@example.com' }], ACTOR);
  const names = store.loadStore().records.map(r => r.manufacturer);
  assert.ok(names.includes('KALSIN A') && names.includes('KALSIN B'), 'var olan kayıtlar korunmalı');
  assert.equal(names.length, 3);
});

/* ------------------------------------------------------------------ */
/* 4) UÇ VE ARAYÜZ                                                     */
/* ------------------------------------------------------------------ */

test('v7.35 · taşıma ucu var ve denetim kaydı yazılır', () => {
  assert.match(SERVER, /app\.post\('\/api\/email-groups\/import'/);
  assert.match(SERVER, /EMAIL_GROUP_RECORDS_IMPORTED/, 'kim ne taşıdı denetimde durmalı');
  assert.match(SERVER, /emailGroupsStore\.importRecords\(body\.records, emailGroupsActor\(req\), body\.expectedRevision\)/);
});

test('central directory · migration endpoint remains but the old workflow migration button is removed', () => {
  assert.doesNotMatch(EG, /data-eg-import/);
  assert.doesNotMatch(EG, /Prepare E-Mail\\'den taşı/);
  assert.match(EG, /migrateLegacyDirectoryOnce\(\)/);
});

test('central directory · legacy candidates are still collected for one-time non-destructive migration', () => {
  assert.match(EG, /window\.BLPrepareEmailManufacturers\(\)/);
  assert.match(EG, /lcw\.prodstatus\.mails\.v1/);
  assert.match(EG, /\/api\/email-groups\/import/);
});

test('central directory · Prepare E-Mail resolves recipients only from BLEmailDirectory', () => {
  const block = APP.slice(APP.indexOf('function prepareEmailLookupEmail'), APP.indexOf('/* --- Konu bazlı'));
  assert.match(block, /BLEmailDirectory\?\.emailFor\(name\)/);
  assert.doesNotMatch(block, /PREPARE_EMAIL_MAIL_KEY/);
  assert.doesNotMatch(block, /kolManufacturers.*email/);
});

test('central directory · workflow refresh overwrites transient addresses but never persists them', () => {
  const block = APP.slice(APP.indexOf('function prepareEmailFillFromShared()'), APP.indexOf('function prepareEmailFillFromSharedAsync'));
  assert.match(block, /item\.email=canonical/);
  assert.doesNotMatch(block, /saveKolManufacturers\(\)/);
  assert.match(APP, /function kolManufacturersForPersistence\(\)/);
  assert.match(APP, /email:''/);
});

test('central directory · Send to Pricing force-refreshes the shared directory without blocking the initial shell', () => {
  assert.match(APP, /function renderKolMfrModal\(ctx\)\{\s*prepareEmailFillFromShared\(\);\s*prepareEmailFillFromSharedAsync\(\);/);
  const block = APP.slice(APP.indexOf('function prepareEmailFillFromSharedAsync'), APP.indexOf('function renderKolMfrModal'));
  assert.match(block, /ensureDirectory\(true\)/);
  assert.match(block, /__refreshCanonicalRecipients/);
});

test('central directory · directory exposes canonical record and recipient accessors', () => {
  assert.match(EG, /function recordFor\(name\)/);
  assert.match(EG, /function recipientsFor\(name\)/);
  assert.match(EG, /window\.BLEmailDirectory = \{ emailFor, recordFor, recipientsFor, ensureDirectory/);
  assert.match(EG, /const DIRECTORY_TTL_MS = 120000;/);
});

test('central directory · network failure returns an empty canonical lookup instead of inventing a workflow-local address', () => {
  const block = EG.slice(EG.indexOf('function ensureDirectory'), EG.indexOf('function recordFor'));
  assert.match(block, /\.catch\(\(\) => \{/);
  assert.match(EG, /function emailFor\(name\) \{ return formatRecipients\(recipientsFor\(name\)\); \}/);
});

/* v7.36 — GÜNCELLENDİ (§156). Amaç aynı: sürüm etiketi TÜM dosyalarda birlikte
   ilerlesin, tek bir eski etiket kalmasın. Sabit "7.35" beklemek, bu testi her
   yeni sürümde ilerlemeyi engelleyen bir engele çevirirdi; v7.35 kaydının
   geçmişte durduğu ayrıca doğrulanır. */
test('v7.35/v7.36 sürüm tüm dosyalarda canonical runtime kaynaktan birlikte ilerliyor', () => {
  const pkgVersion = JSON.parse(read('package.json')).version;
  assert.match(pkgVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const displayVersion = pkgVersion.replace(/^7\.0\./, '7.');
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(index.includes(`Version ${displayVersion}`), false, 'static HTML sürüm hard-code etmemeli');
  assert.equal(index.includes(`?v=${displayVersion}`), false, 'asset cache sürümü hard-code edilmemeli');
  assert.match(read('server/server.js'), /replace\(\/__BL_CANONICAL_VERSION__\/g, APP_VERSION\)/);
  assert.match(read('server/server.js'), /replace\(\/__BL_ASSET_VERSION__\/g, APP_VERSION\)/);
  assert.match(read('server/server.js'), /replace\(\/__BL_DISPLAY_VERSION__\/g, DISPLAY_VERSION\)/);
  assert.match(read('public/version-history.js'), /v: '7\.35'/, 'v7.35 kaydı geçmişte durmalı');
});
