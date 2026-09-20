'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CONNECTOR = read('server/lib/agent-browser-connector.js');
const SERVER = read('server/server.js');
const USER_DATA = read('server/user-data.js');
const APP = read('public/app-main.js');
const connector = require('../server/lib/agent-browser-connector');

test('force PLM refresh uses a per-run cache-busted image request', () => {
  assert.match(CONNECTOR, /function coreNectumRefreshImageUrl\(/);
  assert.match(CONNECTOR, /cache:'no-store'/);
  assert.match(CONNECTOR, /forceRefreshImages/);
  assert.match(CONNECTOR, /refreshToken/);
  assert.match(CONNECTOR, /async function coreNectumBulkImages\(/);
  assert.match(CONNECTOR, /const forceRefresh=options&&options\.forceRefresh===true/);
  const source = 'https://corenectum.lcwaikiki.com/Attachment/GetAttachment/STYLE123';
  const refreshed = connector.coreNectumRefreshImageUrl(source, 'run-1');
  assert.match(refreshed, /[?&]bl_refresh=run-1/);
  assert.equal(connector.coreNectumRefreshImageUrl(source, ''), source);
});

/* v11.00 — "Tümü" kipi artık tarayıcıya cache-bust parametresi geçirmiyor;
   görseller doğrudan Node'da indiriliyor. KORUNAN DAVRANIŞ aynı: "Tümü"
   kipi mevcut otomatik görselleri gerçekten tazeler ("eksikleri tamamla"
   gibi atlamaz) ve eski dosyayı ancak yeni görsel yazıldıktan sonra bırakır. */
test('manual all-image refresh reaches the canonical pipeline as a full refresh', () => {
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/model-images/import-plm'"), SERVER.indexOf("app.post('/api/model-images/import-asas'"));
  assert.match(route, /modelImageMode\(req\.body&&req\.body\.mode\)/);
  assert.match(route, /mode, overwriteManual/);
  // "Tümü" kipi eski dosyanın bırakılmasına izin verir; kısmi kiplerde hayır.
  assert.match(route, /dropOldFiles: mode==='all'/);
  const ingest = read('server/lib/plm-image-ingest.js');
  // mode 'missing' yalnız KULLANILABİLİR görseli olanı atlar; 'all' atlamaz.
  assert.match(ingest, /mode === 'missing' && usable/);
});

/* v11.00 — aynı güvenlik sözleşmesi, kanonik alım yolunda:
   kayıt yazımı başarısız olursa YALNIZ bu turda OLUŞTURULAN dosyalar
   silinir; eski/paylaşılan referanslara dokunulmaz. */
test('failed PLM link patch cleans only newly staged assets', () => {
  const ingest = read('server/lib/plm-image-ingest.js');
  // Bu turda oluşturulan dosyalar ayrı tutulur.
  assert.match(ingest, /const created = \[\];/);
  assert.match(ingest, /created\.push\(stored\.id\);/);
  // Kayıt yazımı patlarsa yalnız onlar silinir ve hata yukarı taşınır.
  assert.match(ingest, /catch \(error\) \{[\s\S]{0,400}for \(const id of created\) \{ try \{ deleteImage\(id\); \}[\s\S]{0,200}throw error;/);
  // Eski dosya yalnız BAŞKA hiçbir kimlik onu kullanmıyorsa silinir.
  assert.match(ingest, /const activeRefs = new Set\(Object\.values\(/);
  assert.match(ingest, /if \(activeRefs\.has\(outcome\.currentRef\)\) continue;/);
  // Geçersiz raster içerik depoya hiç girmez.
  assert.match(ingest, /const mimeType = sniffImageMime\(buffer, entry\.mimeType\);/);
  assert.match(ingest, /code: 'PLM_IMAGE_INVALID'/);
});

test('stored image writes remain temporary-file atomic and index failure-safe', () => {
  const block = USER_DATA.slice(USER_DATA.indexOf('function saveCollectionImage'), USER_DATA.indexOf('function replaceCollectionImage'));
  assert.match(block, /atomicWriteBuffer\(/);
  assert.match(block, /writeCollectionImageIndex/);
  assert.match(block, /catch[^{]*\{[\s\S]*unlinkSync/);
});

test('changed PLM assets expose a stable versioned URL while unchanged assets keep their ref', () => {
  assert.match(SERVER, /imageVersion/);
  const block = APP.slice(APP.indexOf('function applySyncedPlmImages'), APP.indexOf('async function plmJsonRequest'));
  assert.match(block, /imageVersion/);
  /* v9.58: karşılaştırma `oldUrl!==newUrl` yerine erken çıkışlı
     `oldUrl===newUrl` guard'ına dönüştü. Korunan davranış aynı: URL
     DEĞİŞMEDİYSE hiçbir şey yapılmaz, değiştiyse önbellek geçersizlenir. */
  assert.match(block, /oldUrl\s*===\s*newUrl\)\s*return/);
  assert.match(block, /BLImageRuntime\.invalidate/);
});

/* v11.00 — sayaçlar artık kanonik iş kaydından gelir ve UYDURULMAZ.
   Korunan şey aynı: kullanıcı kaç görselin değiştiğini, kaçının aynı
   kaldığını, kaçının eksik ve kaçının başarısız olduğunu GÖREBİLMELİDİR. */
test('refresh result and logs expose replacement, unchanged, missing and failed counts', () => {
  for (const marker of [
    'PLM_IMAGE_REFRESH_START',
    'PLM_IMAGE_CACHE_INVALIDATED',
    'PLM_IMAGE_REFRESH_COMPLETE',
  ]) assert.match(SERVER, new RegExp(marker));
  assert.match(SERVER, /imagesReplaced/);
  assert.match(SERVER, /imagesUnchanged/);
  assert.match(SERVER, /imagesMissing/);
  assert.match(SERVER, /imagesFailed/);
  // Sayaçların her biri gerçekten sayılan bir iştir.
  const jobStore = require('../server/lib/plm-image-job-store');
  for (const key of ['requested', 'resolved', 'stylesProcessed', 'optionImagesFound',
    'downloadsCompleted', 'cacheHits', 'fallbacksUsed', 'manualPreserved', 'missing', 'failed']) {
    assert.ok(key in jobStore.emptyCounts(), `iş sayacı eksik: ${key}`);
  }
  assert.match(SERVER, /function plmImageJobCounts\(counts\)/);
});
