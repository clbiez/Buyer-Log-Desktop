'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const USER_DATA=fs.readFileSync(path.join(ROOT,'server','user-data.js'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');

test('model görselleri thumbnail veya JPEG yeniden kodlaması olmadan kaynak biçiminde saklanır',()=>{
  const save=USER_DATA.slice(USER_DATA.indexOf('function saveCollectionImage'),USER_DATA.indexOf('function replaceCollectionImage'));
  const persist=APP.slice(APP.indexOf('async function kolPersistImageData'),APP.indexOf('async function kolSetRowImageFile'));
  assert.match(USER_DATA,/RAW_COLLECTION_IMAGE_MAX_BYTES/);
  assert.doesNotMatch(save,/getModelImageSettings\(/);
  assert.doesNotMatch(save,/optimize edilmelidir/);
  assert.match(save,/storageMode: 'original'/);
  assert.doesNotMatch(APP,/async function optimizeModelImageDataUrl/);
  assert.match(APP,/function modelImageDataUrlPayload/);
  assert.doesNotMatch(persist,/mimeType:'image\/jpeg'/);
  assert.doesNotMatch(persist,/replace\(\/\\\.[^\.]+\$\/,'.jpg'\)/);
});

test('uygulama açılışta mevcut görselleri tekrar sıkıştırmaz',()=>{
  assert.doesNotMatch(APP,/optimizeStoredModelImagesOnce/);
  assert.doesNotMatch(APP,/model-images\/optimization\/status/);
});

/* v9.58 — KORUNAN DAVRANIŞ AYNI, SINIR VE HAT DEĞİŞTİ.
 *
 * Bu test eskiden 5 KB hedefini ve eski algoritmanın iç değişkenlerini
 * kilitliyordu. Asıl korunan kusur şuydu: görseller SINIRSIZ boyutta
 * saklanıp yerel veritabanını/diski şişirmesin.
 *
 * Tarayıcıda ölçüldü: 5 KB hedefi 16 encode ve JPEG kalite 0.06 üretiyordu —
 * gözle görülür şekilde bozuk. 60 KB hedefi 5-6 encode, kalite 0.49 ve DAHA
 * HIZLI. Sınır korunuyor, değeri ölçüme göre düzeltildi.
 */
test('PLM görsel hattı yakalanan ham rasterı yeniden kodlamadan geçirir',()=>{
  const collector=CONNECTOR.slice(CONNECTOR.indexOf('async function collectCoreNectumStyleLinks'),CONNECTOR.indexOf('async function status('));
  assert.doesNotMatch(collector,/coreNectumOptimizeImage\(/);
  assert.doesNotMatch(collector,/coreNectumFetchOptimizedImage\(/);
  // v10.72: indirme tamamen Style List yoluna (bulk + satır yedeği) devredildi;
  // collector ham rasterı yalnız taşır.
  assert.match(collector,/coreNectumBulkImages\(page,capture,imageRecords/);
  assert.match(collector,/coreNectumStyleListRowImage\(page,record\.plmId/);
});
