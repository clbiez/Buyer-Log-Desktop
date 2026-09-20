'use strict';

/* MODEL VARLIK MİMARİSİ — v11.10 kaynak sözleşmesi
 *
 * Korunan regresyonlar:
 *  · Üç varlık işlemi (link / görsel / dosya) BAĞIMSIZDIR; biri ötekini
 *    tetiklemez.
 *  · Tablo/hover/drilldown görselleri YEREL depodan gelir; ağ yolu hiçbir
 *    zaman çalışma zamanı kaynağı olmaz.
 *  · Açılış görsel senkronunu BEKLEMEZ.
 *  · İkinci bir görsel kaydı / ASAS'a özel kayıt / modül başına indirici
 *    açılmaz.
 *  · Üst kaynağa çıkmadan önce LOCAL → SHARED geçişi ve dağıtık kira vardır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const SERVER = read('server/server.js');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');

/* Çocuk süreç kira tanılamasını (forced [LEASE] satırları) da basar; sonuç
   son satırdır. */
function lastLine(output) {
  const lines = String(output).split(String.fromCharCode(10)).map(line => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || '';
}

test('PLM/ASAS işlemleri her tabloda tek PLM SYNC menüsü altında, sayfa kapsamına göre sunulur', () => {
  for (const prefix of ['cp', 'orders', 'kol']) {
    assert.match(INDEX, new RegExp(`id="${prefix}PlmSyncBtn"`));
    assert.match(INDEX, new RegExp(`id="${prefix}PlmSyncMenu"`));
    assert.match(INDEX, new RegExp(`data-plm-sync-category="plm" data-plm-sync-page="${prefix}"`));
    assert.match(INDEX, new RegExp(`data-plm-sync-category="asas" data-plm-sync-page="${prefix}"`));
  }
  assert.doesNotMatch(INDEX, /id="(?:cp|orders|kol)ModelLinks(?:Missing|Selected|All)Btn"/);
  assert.doesNotMatch(INDEX, /id="(?:cp|orders|kol)ModelImagesBtn"/);
  assert.match(APP, /function showPlmSyncPropertyChooser/);
  assert.match(APP, /data-plmprop="details"/);
  assert.match(APP, /data-plmprop="image"/);
  assert.match(APP, /data-plmprop="file"/);
  assert.match(APP, /async function runCollectionPlmUpdateFlow/);
  assert.doesNotMatch(APP, /function plmAssetsSync\(/);
});

test('dosya işlemi görsel işi, görsel işlemi dosya işi BAŞLATMAZ', () => {
  const filesStart = APP.indexOf('async function updateModelFiles(mode,button)');
  assert.ok(filesStart >= 0);
  const filesBlock = APP.slice(filesStart, APP.indexOf('/* --- GÜNCEL GÖRÜNÜM EYLEMİ', filesStart));
  assert.match(filesBlock, /kolPlmSyncModelFilesRun\(button,rows\)/);
  assert.doesNotMatch(filesBlock, /import-plm|import-asas|updateModelImages/);

  const imagesStart = APP.indexOf('async function updateModelImages({source=MODEL_ASSET_SOURCE_PLM');
  const imagesBlock = APP.slice(imagesStart, APP.indexOf('function openModelAssetProgress', imagesStart));
  assert.doesNotMatch(imagesBlock, /model-files|updateModelFiles|sync-links/);
});

test('link değişimi görsel/dosya kayıtlarına DOKUNMAZ', () => {
  const start = APP.indexOf('async function updateModelLinks(mode,button');
  const block = APP.slice(start, APP.indexOf('/* --- 2) MODEL GÖRSELİ', start) >= 0
    ? APP.indexOf('/* --- 2) MODEL GÖRSELİ', start) : APP.indexOf('/* --- 2) MODEL GÖRSELLERİ', start));
  assert.match(block, /applyPlmStyleLinksPayload\(data\)/);
  assert.doesNotMatch(block, /applySyncedPlmImages|patchPlmImageLinks|imagemap/);
});

test('çalışma zamanı görsel kaynağı YEREL depodur — ağ yolu hiçbir yerde çizime girmez', () => {
  /* Çizim yolları: kanonik kaynak üreticisi, ortak küçük resim katmanı ve
     istemci önbelleği. Üçü de yalnız yerel HTTP ucunu bilir. (sharedSyncRoot
     yalnız Sync Ayarları ekranında geçer; o bir çizim yolu değildir.) */
  // Kanonik kaynak üreticisi YEREL uç noktayı kullanır.
  assert.match(APP, /const COLLECTION_IMAGE_API='\/api\/collection-images';/);
  const sourceStart = APP.indexOf('function canonicalModelImageSource(');
  const sourceBlock = APP.slice(sourceStart, sourceStart + 400);
  assert.match(sourceBlock, /COLLECTION_IMAGE_API/);
  assert.doesNotMatch(sourceBlock, /sharedSyncRoot|model-images\/objects/);

  const thumbStart = APP.indexOf('function detailImageThumbHtml(');
  const thumbBlock = APP.slice(thumbStart, thumbStart + 1200);
  assert.doesNotMatch(thumbBlock, /sharedSyncRoot|model-images\/objects/);

  for (const file of ['public/model-image-cache.js', 'public/model-asset-scope.js', 'public/lfl.js']) {
    assert.doesNotMatch(read(file), /sharedSyncRoot|model-images\/objects/, `${file} ağ yolundan çizim yapmamalı`);
  }
  // Sunucu tarafında da paylaşılan depo yalnız dağıtım katmanında kullanılır;
  // görsel SUNUMU yerel dosyadan yapılır.
  const serveStart = SERVER.indexOf("app.get('/api/collection-images/:id'");
  assert.ok(serveStart > 0);
  const serveBlock = SERVER.slice(serveStart, serveStart + 900);
  assert.match(serveBlock, /getCollectionImage/);
  assert.doesNotMatch(serveBlock, /sharedModelImageStore|modelImageDistribution/);
});

test('açılış görsel senkronunu BEKLEMEZ; tur UI-ready sonrası arka planda ve tek uçuşludur', () => {
  const timerStart = SERVER.indexOf('setInterval(() => {', SERVER.indexOf('PAYLAŞILAN MODEL GÖRSELİ DAĞITIMI'));
  const timerBlock = SERVER.slice(timerStart, timerStart + 1200);
  assert.match(timerBlock, /if \(!uiReadySignaled\) return;/);
  assert.match(timerBlock, /void syncSharedModelImagesOnce\(\{ hydrate: false \}\)\.catch/);
  assert.match(SERVER, /let sharedModelImageSyncInFlight = null;/);
  assert.match(SERVER, /if \(sharedModelImageSyncInFlight\) return sharedModelImageSyncInFlight;/);
  assert.match(SERVER, /void modelImageDistribution\.flushPublish\(\)\.catch/);
});

test('üst kaynağa çıkmadan önce LOCAL → SHARED geçişi ve dağıtık kira uygulanır', () => {
  for (const route of ["'/api/model-images/import-plm'", "'/api/model-images/import-asas'"]) {
    const start = SERVER.indexOf(`app.post(${route}`);
    assert.ok(start > 0, `${route} bulunamadı`);
    const block = SERVER.slice(start, start + 6000);
    const first = block.indexOf('resolveModelImagesLocalFirst');
    const lease = block.indexOf('leaseUpstreamImageIdentities');
    assert.ok(first > 0, `${route}: yerel/paylaşılan ön geçiş yok`);
    assert.ok(lease > first, `${route}: kira ön geçişten SONRA alınmalı`);
    assert.match(block, /queueModelImagePublish|first\.installed/);
  }
  // Sıra modülün kendisinde de yazılıdır.
  const distribution = read('server/lib/model-image-distribution.js');
  const localIndex = distribution.indexOf("mode === 'missing' && hasLocalFile(currentRef)");
  const sharedIndex = distribution.indexOf('await shared.lookup(item.key, { source })');
  const upstreamIndex = distribution.indexOf('upstream.push(');
  assert.ok(localIndex > 0 && sharedIndex > localIndex && upstreamIndex > sharedIndex, 'LOCAL → SHARED → UPSTREAM sırası bozulmuş');
});

/* ASAS Teknik Görsel alanı RENK taşımaz; depo da renksiz (PLM-only) anahtarla
   yazar. Planlamayı renk düzeyinde yapmak, var olan görseli "yok" sayıp her
   renk için ASAS'a yeniden gitmek demekti. */
test('ASAS kimliği MODEL düzeyindedir, PLM kimliği RENK düzeyinde kalır', () => {
  const ingest = require(path.join(ROOT, 'server/lib/plm-image-ingest.js'));
  const parse = require(path.join(ROOT, 'server/lib/parse.js'));
  assert.equal(ingest.normalizeRequest({ plmId: '2120176', colourCode: '', colour: '' }).key, parse.plmImageKey('2120176'));
  assert.equal(
    ingest.normalizeRequest({ plmId: '2120176', colourCode: 'RED', colour: 'Kirmizi' }).key,
    parse.plmColourImageNameKey('2120176', 'RED', 'Kirmizi'),
  );
  const start = SERVER.indexOf('async function resolveModelImagesLocalFirst');
  const block = SERVER.slice(start, start + 2000);
  assert.match(block, /SOURCE_ASAS[\s\S]{0,400}colourCode: '', colour: ''/);
});

test('ikinci bir görsel kaydı / ASAS’a özel kayıt / modül başına indirici açılmadı', () => {
  // Kanonik kayıt tek: overrides.imagemap + plm-image-ownership.
  const distribution = read('server/lib/model-image-distribution.js');
  assert.match(distribution, /require\('\.\/plm-image-ownership'\)/);
  assert.match(distribution, /require\('\.\/plm-image-ingest'\)/);
  assert.doesNotMatch(distribution, /asas-image-registry|second-registry|imagemapAsas/);
  // Paylaşılan depo BÜYÜK BİNARY'leri normal JSON paketine koymaz.
  const syncPackage = read('server/lib/sync-package.js');
  assert.doesNotMatch(syncPackage, /base64|imageRef|collection-images/);
  // Güncel görünüm kimlikleri TEK bir sağlayıcıdan gelir.
  assert.match(APP, /registerCurrentViewModelAssetProvider/);
  assert.equal((APP.match(/img\[data-bl-thumb="1"\]\[data-model-id\]/g) || []).length >= 1, true);
});

test('kanonik yazma her hâlükârda tamamlanır; YENİDEN ÇİZİM görünüm jetonuna bağlıdır', () => {
  const start = APP.indexOf('function modelAssetRepaint(operation)');
  assert.ok(start > 0);
  const block = APP.slice(start, start + 500);
  assert.match(block, /api\.isViewCurrent\(operation\)/);
  // Kapanan rapor geri açılmaz, sayfa yeniden yüklenmez.
  assert.doesNotMatch(block, /location\.reload|window\.open|showModal/);
  const imagesStart = APP.indexOf('async function updateModelImages({source=MODEL_ASSET_SOURCE_PLM');
  const imagesBlock = APP.slice(imagesStart, APP.indexOf('function openModelAssetProgress', imagesStart));
  const persist = imagesBlock.indexOf('applySyncedPlmImages(data)');
  // Erken dönüş dalında da bir repaint var; başarı yolundaki repaint
  // kalıcılıktan SONRA gelmeli.
  const repaint = imagesBlock.indexOf('modelAssetRepaint(operation)', persist);
  assert.ok(persist > 0 && repaint > persist, 'kalıcılık repaint’ten ÖNCE olmalı');
});

/* Süreçler ARASI kira. Aynı süreçte withFileLeaseAsync kaynağı zaten sıraya
   dizdiği için gerçek yarış ancak ayrı bir süreçle sınanabilir. */
test('kira örnekler ARASINDA da tutar (ayrı süreç)', () => {
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-xproc-'));
  try {
    const script = `
      const store = require(${JSON.stringify(path.join(ROOT, 'server/lib/shared-image-store.js'))});
      const s = store.createSharedImageStore({ getSharedSyncRoot: async () => ${JSON.stringify(sharedRoot)}, getDeviceId: () => 'child' });
      s.acquireRefreshLease('plm:1|colour:RED', 'ASAS', { timeoutMs: 300 })
        .then(lease => { console.log(lease.acquired ? 'ACQUIRED' : 'BUSY'); return lease.release(); })
        .catch(error => { console.log('ERROR ' + error.message); process.exit(1); });
    `;
    const free = lastLine(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 }));
    assert.equal(free, 'ACQUIRED', 'kira boşken alınabilmeli');

    // Kirayı bu süreçte tut, çocuk süreç MEŞGUL görmeli.
    const sharedImageStore = require(path.join(ROOT, 'server/lib/shared-image-store.js'));
    const holder = sharedImageStore.createSharedImageStore({ getSharedSyncRoot: async () => sharedRoot, getDeviceId: () => 'parent' });
    return holder.acquireRefreshLease('plm:1|colour:RED', 'ASAS').then(async lease => {
      assert.equal(lease.acquired, true);
      try {
        const busy = lastLine(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 }));
        assert.equal(busy, 'BUSY', 'başka bir örnek aynı varlığı aynı anda tazelememeli');
      } finally { await lease.release(); }
      const after = lastLine(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 }));
      assert.equal(after, 'ACQUIRED', 'kira KALICI olmamalı');
    });
  } finally { fs.rmSync(sharedRoot, { recursive: true, force: true }); }
});
