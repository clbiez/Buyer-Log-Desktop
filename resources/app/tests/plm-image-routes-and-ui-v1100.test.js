'use strict';

/* v11.00 — UÇLAR VE ARAYÜZ BAĞLANTISI.
 *
 * Kaynak-sözleşme testi: DOM'a sıkı bağlı büyük dosyalar için Buyer Log'un
 * mevcut deseni. Korunan şey, kanonik borunun gerçekten BAĞLI olmasıdır —
 * rota yeniden yazıldığında sessizce eski yola dönülmesin.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* YORUMLARI AT. doesNotMatch YORUMLARI DA EŞLEŞTİRİR: "Bearer saklanmaz"
   diye yazılmış bir açıklama, "Bearer geçmesin" kuralını sahte biçimde
   düşürür. Kod sözleşmesi sınanacaksa yalnız KOD okunmalıdır. */
const codeOnly = source => String(source)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
const SERVER = require('./helpers/server-source')();
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const PERF = read('public/perf-runtime.js');
const PACKAGE_UI = read('public/plm-image-package-import.js');

const IMPORT_ROUTE = SERVER.slice(
  SERVER.indexOf("app.post('/api/model-images/import-plm'"),
  SERVER.indexOf("app.post('/api/model-images/import-asas'"),
);

test('canlı PLM görsel rotası kanonik boruyu kullanır, ikinci bir yol açmaz', () => {
  assert.ok(IMPORT_ROUTE.length > 500);
  assert.match(IMPORT_ROUTE, /plmImageSyncService\.runPlmImageSync/);
  assert.match(IMPORT_ROUTE, /canonicalPlmImageIngest\(plmImageOwnership\.OWNER_PLM\)/);
  assert.match(IMPORT_ROUTE, /openCoreNectumStyleApiSession/);
  assert.match(IMPORT_ROUTE, /downloadCoreNectumAttachment/);
  // Eski DOM/Style List sürme yolu bu rotadan ÇIKTI.
  assert.doesNotMatch(IMPORT_ROUTE, /collectCoreNectumStyleLinks/);
  assert.doesNotMatch(IMPORT_ROUTE, /coreNectumBulkApiScan|coreNectumStyleListRowImage/);
});

test('rota sınırlı eşzamanlılık varsayılanlarını kanonik sabitlerden alır', () => {
  assert.match(IMPORT_ROUTE, /styleImagesConcurrency: coreNectumStyleApi\.STYLE_IMAGES_CONCURRENCY/);
  assert.match(IMPORT_ROUTE, /downloadConcurrency: coreNectumStyleApi\.IMAGE_DOWNLOAD_CONCURRENCY/);
});

test('Style ID istemciden DEĞİL kalıcı PLM link deposundan gelir', () => {
  assert.match(IMPORT_ROUTE, /loadPlmStyleLinks\(\)\.links/);
  assert.match(IMPORT_ROUTE, /styleId:String\(styleLink&&styleLink\.styleId\|\|''\)/);
  assert.doesNotMatch(IMPORT_ROUTE, /item&&item\.styleId/);
});

test('istekler API çağrısından ÖNCE tekilleştirilir', () => {
  assert.match(IMPORT_ROUTE, /const seen=new Set\(\),requests=\[\]/);
  assert.match(IMPORT_ROUTE, /if\(seen\.has\(key\)\)continue;seen\.add\(key\)/);
});

test('iş kaydı kalıcıdır: uygulama yeniden başlayınca sıfırdan başlanmaz', () => {
  assert.match(IMPORT_ROUTE, /plmImageJobStore\.createCheckpoint\(/);
  assert.match(SERVER, /app\.get\('\/api\/plm-image-jobs'/);
  assert.match(SERVER, /app\.get\('\/api\/plm-image-jobs\/:id\/pending'/);
  // "Yalnız başarısızlar" ayrı bir yol değil, aynı kayıttan süzülür.
  assert.match(SERVER, /plmImageJobStore\.retryItems\(record\.jobId\)/);
});

test('paket uçları ÖNCE önizler, yalnız açık onayla yazar', () => {
  assert.match(SERVER, /app\.post\('\/api\/model-images\/package\/preview'/);
  assert.match(SERVER, /app\.post\('\/api\/model-images\/package\/import'/);
  const commit = SERVER.slice(SERVER.indexOf("app.post('/api/model-images/package/import'"), SERVER.indexOf("app.get('/api/plm-image-jobs'"));
  assert.match(commit, /req\.body\.confirm !== true/, 'onaysız yazma reddedilmeli');
  assert.match(commit, /PLM_PACKAGE_CONFIRM_REQUIRED/);
  // Paket içe aktarma da AYNI kanonik alım yolunu kullanır.
  assert.match(commit, /canonicalPlmImageIngest\(plmImageOwnership\.OWNER_PACKAGE\)/);
  assert.match(commit, /plmImageSyncService\.runPackageImport/);
  // Önizleme hiçbir şey yazmaz.
  const preview = SERVER.slice(SERVER.indexOf("app.post('/api/model-images/package/preview'"), SERVER.indexOf("app.post('/api/model-images/package/import'"));
  assert.doesNotMatch(preview, /saveCollectionImage|patchPlmImageLinks|deleteCollectionImage/);
});

test('manuel görsel bağlama otomatik sahipliği düşürür', () => {
  const manualRoute = SERVER.slice(SERVER.indexOf("app.post('/api/plm-image-links'"), SERVER.indexOf("app.post('/api/overrides/batch-suppfob'"));
  assert.match(manualRoute, /plmImageOwnership\.forget\(forgotten\)/);
  assert.match(manualRoute, /plmImageIngestLib\.canonicalKeyFor\(item\)/);
});

test('tam sıfırlama sahiplik kaydını da temizler', () => {
  const reset = SERVER.slice(SERVER.indexOf("app.delete('/api/model-images/all'"), SERVER.indexOf("app.delete('/api/model-images/all'") + 3000);
  assert.match(reset, /plmImageOwnership\.saveOwnership\(plmImageOwnership\.emptyStore\(\)\)/);
});

test('PLM Görsel Paketini İçe Aktar mevcut model görsel ayar modalından tek giriş noktasıyla açılır', () => {
  const hits = APP.split('data-plm-image-package-open').length - 1;
  assert.equal(hits, 1, 'aynı komut PLM Sync menülerinde çoğaltılmamalı');
  assert.match(APP, /PLM Görsel Paketini İçe Aktar/);
  assert.match(APP, /Import PLM Image Package/);
});

test('paket arayüzü lazy modül listesinde kayıtlı', () => {
  assert.match(PERF, /plm-image-package-import\.js/);
});

test('paket arayüzü mevcut bileşen dilini kullanır, paralel sistem kurmaz', () => {
  // Buyer Log kabukları: warnOverlay / modalCard / kolPlanStat / plmImportTable.
  assert.match(PACKAGE_UI, /className = 'warnOverlay'/);
  assert.match(PACKAGE_UI, /modalCard verHistCard plmImportCard/);
  assert.match(PACKAGE_UI, /kolPlanStat/);
  assert.match(PACKAGE_UI, /plmImportTable/);
  // Görseller kanonik kayıttan çözülür; istemci önbelleği doğruluk kaynağı değil.
  assert.match(PACKAGE_UI, /applySyncedPlmImages/);
  // Önizleme onaydan önce gelir.
  assert.match(PACKAGE_UI, /confirm: true/);
  assert.match(PACKAGE_UI, /data-package-preview/);
});

test('paket arayüzü ne kadarının üzerine yazılacağını YAZMADAN ÖNCE gösterir', () => {
  assert.match(PACKAGE_UI, /overwritesAutomatic/);
  assert.match(PACKAGE_UI, /manualPreserved/);
  assert.match(PACKAGE_UI, /manualConflicts/);
  assert.match(PACKAGE_UI, /totalReadyBytes/);
});

test('CoreNectum erişim anahtarı hiçbir ayara/iş kaydına/günlüğe yazılmaz', () => {
  for (const file of ['server/lib/plm-image-job-store.js', 'server/lib/plm-image-ownership.js', 'server/lib/plm-image-sync-service.js']) {
    const source = codeOnly(read(file));
    assert.doesNotMatch(source, /access_token|Bearer/i, `${file} erişim anahtarı taşımamalı`);
  }
  assert.doesNotMatch(codeOnly(IMPORT_ROUTE), /access_token|Bearer/i);
});

test('indirme motoru bağlantıyı yeniden kullanır ve tarayıcı iptal başlığı göndermez', () => {
  const queue = codeOnly(read('server/lib/plm-image-download-queue.js'));
  assert.match(queue, /keepAlive: true/);
  assert.match(queue, /let sharedAgent = null;/);
  assert.doesNotMatch(queue, /x-cancel-previous-request/i);
  // Baytlar diske ATOMİK yazılır (kanonik depo katmanı üzerinden).
  const userData = read('server/user-data.js');
  const save = userData.slice(userData.indexOf('function saveCollectionImage'), userData.indexOf('function replaceCollectionImage'));
  assert.match(save, /atomicWriteBuffer\(/);
});
