'use strict';

/*
 * v10.90 — "TÜM GÖRSELLERİ SİL" GERÇEK BİR SIFIRLAMADIR
 *
 * Saha bulgusu: komut çalıştırıldıktan sonra hücrelerde KIRIK GÖRSEL simgesi
 * kalıyordu. Sebep tek katmanlı silmeydi — yalnız fiziksel dosyalar ve
 * index.json siliniyor, görsel SAHİPLİĞİ üç yerde yaşamaya devam ediyordu:
 *
 *   1) overrides.imagemap  → canonicalModelImageKnown() hâlâ "görsel var" der,
 *      çözümlenen /api/collection-images/ci_xxx 404 döner, <img> kırılır.
 *   2) Koleksiyon satırlarının img / imgRef alanları → aynı 404.
 *   3) Sayfa projeksiyonu önbelleği → _imageRef/_imageUrl gömülü tutulduğu için
 *      yeniden başlatmadan sonra silinmiş referanslar geri gelirdi.
 *
 * Bu testler dört şeyi çivilerler:
 *   A) Depo sıfırlaması yetim dosyaları da alır ve idempotenttir.
 *   B) Kayıt (imagemap) boşalır, boş kayıtta yeniden çalıştırmak revizyonu
 *      boşuna artırmaz.
 *   C) Koleksiyon satırlarının görsel alanları temizlenir, İŞ ALANLARI kalır.
 *   D) Uç nokta aşamalı/doğrulamalı çalışır ve istemci ortak durumu düşürür.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-image-reset-v1090-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const userData = require('../server/user-data');
const db = require('../server/db');
const workspaces = require('../server/lib/collection-workspaces');
const { createModelImageCache } = require('../public/model-image-cache');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const PIXEL = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64').toString('base64');

function storeImage(rowId) {
  return userData.saveCollectionImage({ rowId, filename: `${rowId}.jpg`, mimeType: 'image/jpeg', base64: PIXEL });
}

test('A · depo sıfırlaması indeksli görselleri, yetim dosyaları ve optimizasyon işaretini alır', () => {
  const first = storeImage('plm:plm:1202929|colour:Q6K');
  const second = storeImage('cp:plm:1202930|colour:001');
  // Index'e hiç yazılamamış (yazma yarıda kalmış) bir yetim dosya.
  const orphan = path.join(userData.COLLECTION_IMAGES_ROOT, 'ci_orphan_deadbeef.jpg');
  fs.writeFileSync(orphan, Buffer.from(PIXEL, 'base64'));
  userData.completeCollectionImageOptimization();

  assert.equal(userData.readCollectionImageIndex().length, 2);
  assert.ok(userData.getCollectionImage(first.id));

  const result = userData.deleteAllCollectionImages();
  assert.equal(result.requested, 2);
  assert.equal(result.deleted, 2);
  assert.equal(result.orphansRemoved, 1);
  assert.equal(result.remainingIndexed, 0);
  assert.equal(result.remainingFiles, 0);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(userData.getCollectionImage(first.id), null);
  assert.equal(userData.getCollectionImage(second.id), null);
  assert.equal(userData.listStoredCollectionImageFiles().length, 0);

  // G · temiz sistemde yeniden çalıştırmak güvenlidir.
  const again = userData.deleteAllCollectionImages();
  assert.deepEqual(
    { requested: again.requested, deleted: again.deleted, orphansRemoved: again.orphansRemoved, remainingFiles: again.remainingFiles },
    { requested: 0, deleted: 0, orphansRemoved: 0, remainingFiles: 0 },
  );

  // D · sıfırlamadan HEMEN SONRA aynı kimlik yeni görsel alabilir: mezar taşı,
  // negatif kayıt ya da geçersiz indeks kalmaz.
  const reimported = storeImage('plm:plm:1202929|colour:Q6K');
  assert.ok(userData.getCollectionImage(reimported.id), 'sıfırlama sonrası yeni görsel kaydedilebilmeli');
  userData.deleteAllCollectionImages();
});

test('A · görsel boyut ayarı sıfırlamadan etkilenmez', () => {
  userData.saveModelImageSettings({ maxKb: 23 });
  storeImage('plm:plm:9|colour:X');
  userData.deleteAllCollectionImages();
  assert.equal(userData.getModelImageSettings().maxKb, 23, 'maxKb görsel İÇERİĞİ değil AYARIDIR; sıfırlama onu korur');
});

test('B · genel model görseli kaydı boşalır ve boş kayıtta idempotenttir', () => {
  db.patchPlmImageLinks([
    { plmId: '1202929', colourCode: 'Q6K', imageRef: 'ci_a' },
    { plmId: '1202930', colourCode: '001', imageRef: 'ci_b' },
  ]);
  const before = db.loadOverrides();
  assert.equal(Object.keys(before.imagemap).length, 2);
  const businessRevision = Number(before._revisions.orders) || 0;

  const cleared = db.clearAllModelImageLinks();
  assert.equal(cleared.cleared, 2);
  assert.equal(Object.keys(db.loadOverrides().imagemap).length, 0);
  assert.equal(cleared.revision, businessRevision + 1);

  const repeat = db.clearAllModelImageLinks();
  assert.equal(repeat.cleared, 0);
  assert.equal(repeat.revision, cleared.revision, 'boş kayıtta revizyon boşuna artmaz');

  // Sıfırlamadan sonra AYNI kimlik yeniden bağlanabilir.
  db.patchPlmImageLinks([{ plmId: '1202929', colourCode: 'Q6K', imageRef: 'ci_new' }]);
  assert.equal(db.loadOverrides().imagemap['plm:1202929|colour:Q6K'], 'ci_new');
  db.clearAllModelImageLinks();
});

test('C · Koleksiyon satırlarının görsel alanları temizlenir, iş verisi korunur', () => {
  workspaces.saveWorkspace('buyer-a', {
    rows: [
      { id: 1, plmId: '1202929', colourCode: 'Q6K', modelKod: 'TRIKO A', img: '/api/collection-images/ci_a', imgRef: 'ci_a', fob: '4.20', notlar: 'kalsın' },
      { id: 2, plmId: '1202930', colourCode: '001', modelKod: 'TRIKO B', img: '', imgRef: '' },
    ],
    manufacturers: [], customColumns: [], nextId: 3,
  });
  workspaces.saveWorkspace('buyer-b', {
    rows: [{ id: 1, plmId: '77', colourCode: 'Z1', img: 'data:image/jpeg;base64,AAAA', imgRef: '' }],
    manufacturers: [], customColumns: [], nextId: 2,
  });

  assert.deepEqual(workspaces.countRowImages(), { rows: 2, refs: 3 });

  const result = workspaces.clearAllRowImages();
  assert.deepEqual(result, { workspaces: 2, rows: 2, refs: 3 });
  assert.deepEqual(workspaces.countRowImages(), { rows: 0, refs: 0 });

  const a = workspaces.loadWorkspace('buyer-a');
  assert.equal(a.rows[0].img, '');
  assert.equal(a.rows[0].imgRef, '');
  // I · PLM ID, Colour Code, model adı, fiyat ve not GÖRSEL VERİSİ DEĞİLDİR.
  assert.equal(a.rows[0].plmId, '1202929');
  assert.equal(a.rows[0].colourCode, 'Q6K');
  assert.equal(a.rows[0].modelKod, 'TRIKO A');
  assert.equal(a.rows[0].fob, '4.20');
  assert.equal(a.rows[0].notlar, 'kalsın');

  const revisionAfter = workspaces.loadWorkspace('buyer-a')._revision;
  assert.deepEqual(workspaces.clearAllRowImages(), { workspaces: 0, rows: 0, refs: 0 });
  assert.equal(workspaces.loadWorkspace('buyer-a')._revision, revisionAfter, 'temiz çalışma alanı yeniden yazılmaz');
});

test('D · istemci görsel önbelleği tam sıfırlanabilir ve kayıt haritasını bırakır', async () => {
  const deleted = [];
  const fakeCaches = { delete: async name => { deleted.push(name); return true; } };
  const cache = createModelImageCache({ caches: fakeCaches }, { thumbnailer: async blob => blob });
  cache.setRegistryMap({ 'plm:1202929|colour:Q6K': 'ci_a' });
  assert.equal(cache.resolveRegistrySource('1202929', 'Q6K'), '/api/collection-images/ci_a');

  await cache.clearAll();
  assert.deepEqual(deleted, [cache.CACHE_NAME], 'Buyer Log\'a ait disk önbelleği bütünüyle bırakılır');
  assert.equal(cache.resolveRegistrySource('1202929', 'Q6K'), '', 'sıfırlamadan sonra kayıt hiçbir görsel çözmez');
  assert.equal(cache.hasRegistryKey('1202929', 'Q6K'), false);
});

test('B · sıfırlamadan sonra hücre BOŞ duruma düşer, kırık <img> kaynağına değil', () => {
  // cpImageCellHtml / ordersImageCellHtml / kol hücresinin kaynak seçim kuralı.
  // Kırık görsel tam olarak burada doğuyordu: kayıt "var" diyor ya da satırda
  // eski _imageRef duruyorsa hücreye silinmiş bir URL yazılıyordu.
  const cache = createModelImageCache(globalThis, { thumbnailer: async blob => blob });
  const cell = (registryMap, row) => {
    cache.setRegistryMap(registryMap);
    const modelId = row['PLM ID'], colourCode = row['C.Code'];
    const canonicalKnown = cache.hasImageKey(registryMap, modelId, colourCode);
    const canonical = cache.resolveRegistrySource(modelId, colourCode, '/api/collection-images');
    const has = Boolean(canonicalKnown ? canonical : row._imageRef && row._imageUrl);
    return { has, source: canonicalKnown ? canonical : (has ? row._imageUrl : '') };
  };

  const populated = { 'plm:1202929|colour:Q6K': 'ci_a' };
  const row = { 'PLM ID': '1202929', 'C.Code': 'Q6K', _imageRef: 'ci_a', _imageUrl: '/api/cp-images/ci_a' };
  assert.deepEqual(cell(populated, row), { has: true, source: '/api/collection-images/ci_a' });

  // ESKİ DAVRANIŞ: yalnız dosyalar silindi, kayıt ve satır referansı kaldı.
  // Hücre hâlâ silinmiş bir URL çözer → tarayıcı kırık görsel simgesi çizer.
  assert.equal(cell(populated, row).source, '/api/collection-images/ci_a');
  const rowRefOnly = { ...row };
  assert.equal(cell({}, rowRefOnly).source, '/api/cp-images/ci_a', 'satır referansı tek başına da kırık görsel üretir');

  // YENİ DAVRANIŞ: kayıt VE satır referansı birlikte temizlenir.
  assert.deepEqual(cell({}, { 'PLM ID': '1202929', 'C.Code': 'Q6K', _imageRef: '', _imageUrl: '' }), { has: false, source: '' });
});

test('D · sunucu ucu aşamalı çalışır, sıfırlamayı doğrular ve yarışmayı engeller', () => {
  const route = SERVER.slice(SERVER.indexOf("app.delete('/api/model-images/all'"));
  const body = route.slice(0, route.indexOf('\napp.'));
  // Aşamalar: varlık → kayıt → koleksiyon satırları → sayfa önbelleği → doğrulama.
  for (const stage of ['deleteAllCollectionImages()', 'clearAllModelImageLinks()', 'collectionWorkspaces.clearAllRowImages()', 'pageProjectionCache.invalidateAll()']) {
    assert.ok(body.includes(stage), `sıfırlama ${stage} aşamasını içermeli`);
  }
  assert.match(body, /MODEL_IMAGE_RESET_INCOMPLETE/);
  assert.match(body, /stage: failedStage/);
  assert.match(body, /modelImageResetInProgress = false;/);
  // Eşzamanlılık: sıfırlama sürerken görsel YAZMA yolları reddedilir.
  assert.match(SERVER, /function assertModelImageMutable\(\)/);
  assert.match(SERVER, /MODEL_IMAGE_RESET_BUSY/);
  const guarded = SERVER.split('assertModelImageMutable();').length - 1;
  assert.ok(guarded >= 5, `görsel yazma yolları korunmalı (bulunan: ${guarded})`);
});

test('D · istemci sıfırlaması ortak görsel durumunun tamamını düşürür', () => {
  assert.match(APP, /await applyModelImageReset\(data\);/);
  // Kayıt + satır referansları + yerel aynalar + çalışma zamanı önbelleği.
  assert.match(APP, /state\.overrides\.imagemap=\{\};/);
  assert.match(APP, /row\._imageKey='';row\._imageRef='';row\._imageUrl='';/);
  assert.match(APP, /kolRows\.forEach\(row=>\{if\(row\)\{row\.img='';row\.imgRef='';\}\}\);/);
  assert.match(APP, /function clearLocalModelImageMirrors\(\)/);
  assert.match(APP, /await BLImageRuntime\.clearAll\(\);/);
  // Negatif önbellek temizlenmezse sıfırlamadan sonra yeni yüklenen görsel
  // aynı URL'de görünmezdi.
  assert.match(APP, /loaded\.clear\(\);failed\.clear\(\);/);
  // Tek yetkili sıfırlama → paylaşılan durum geçersiz → normal render.
  assert.match(APP, /try\{renderCP\(\);\}catch\(_\)\{\}/);
  assert.match(APP, /try\{renderOrders\(\);\}catch\(_\)\{\}/);
  // Başarı taklit edilmez: hata aşamasıyla birlikte gösterilir.
  assert.match(APP, /data\.stage\?` \(\$\{data\.stage\}\)`:''/);
});
