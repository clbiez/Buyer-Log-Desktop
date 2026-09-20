'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function block(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  assert.ok(start >= 0, `Blok başlangıcı bulunamadı: ${startMarker}`);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Blok sonu bulunamadı: ${endMarker}`);
  return SOURCE.slice(start, end);
}

test('Koleksiyon görseli kanonik kayda TEK çıkıştan bağlanır', () => {
  const persist = block('async function kolPersistImageData', 'async function kolSetRowImageFile');
  // Bağlama artık kaydetme noktasının kendisindedir; böylece tarayıcıda kalmış
  // görselleri sunucuya taşıyan geçiş akışı da kanonik kayda girer.
  assert.match(persist, /await kolLinkImageToCanonicalRegistry\(row,data\.image\.id\)/);

  const migrate = block('async function kolMigrateInlineImagesToServer', 'async function kolDeleteUnusedImageRefs');
  assert.match(migrate, /kolPersistImageData\(row,row\.img/);

  // Çağrı noktalarında ikinci (kopya) bağlama kalmamalı — aksi hâlde aynı
  // bağlantı iki kez yazılır ve sahiplik/revizyon yarışı doğar.
  const setFile = block('async function kolSetRowImageFile', 'async function kolMigrateInlineImagesToServer');
  assert.doesNotMatch(setFile, /kolPlmLinkImageEverywhere/);
  const imported = block('async function kolPlmPersistImportedImage', 'async function importKolPlmExcelFile');
  assert.doesNotMatch(imported, /kolPlmLinkImageEverywhere/);

  // Renk kodu olmayan satırın kanonik anahtarı yoktur; mevcut anahtar
  // semantiği (PLM ID + Colour Code) değişmeden korunur.
  const linker = block('async function kolLinkImageToCanonicalRegistry', '\nasync function importKolPlmExcelFile');
  assert.match(linker, /if\(!norm\(row&&row\.plmId\)\|\|!norm\(row&&row\.colourCode\)\)return false;/);
});

test('Detay görsel dizini Koleksiyon satırlarını türetilmiş projeksiyonlardan ÖNCE indeksler', () => {
  const index = block('function buildDetailImageIndex', 'function detailImageUrlFrom');
  const registryAt = index.indexOf('const overrideImages=');
  const collectionAt = index.indexOf("if(typeof kolRows!=='undefined')");
  const asasAt = index.indexOf('(state?.asasOrders||[]).forEach');
  const projectionAt = index.indexOf('for(const source of [state.cp,state.orders])');
  assert.ok(registryAt >= 0, 'Kanonik kayıt döngüsü bulunamadı');
  assert.ok(collectionAt >= 0, 'Koleksiyon satırı döngüsü bulunamadı');
  assert.ok(asasAt >= 0, 'ASAS döngüsü bulunamadı');
  assert.ok(projectionAt >= 0, 'CP/Orders projeksiyon döngüsü bulunamadı');
  // `add` ilk yazanı korur: kullanıcının manuel Koleksiyon görseli, aynı model
  // adına ait eski otomatik/projeksiyon kaydına yenilmemelidir.
  assert.ok(registryAt < collectionAt, 'Kanonik kayıt Koleksiyon satırlarından önce gelmeli');
  assert.ok(collectionAt < asasAt, 'Koleksiyon satırları ASAS kayıtlarından önce gelmeli');
  assert.ok(collectionAt < projectionAt, 'Koleksiyon satırları CP/Orders projeksiyonundan önce gelmeli');

  // Model adı → PLM ID köprüsü Koleksiyon satırından da beslenir; OAB alt
  // detayı yalnız model adı taşır ve kanonik anahtara ancak böyle ulaşır.
  const collectionBlock = index.slice(collectionAt, asasAt);
  assert.match(collectionBlock, /modelToPlm\.set\(rowModel,rowPlm\)/);
});

test('Bağ kaldırıldığında CP/Orders satırındaki görsel projeksiyonu da düşer', () => {
  const linker = block('async function kolPlmLinkImageEverywhere', 'async function kolPlmPersistImportedImage');
  assert.match(linker, /target\._imageRef='';target\._imageUrl='';/);
  // Yalnız bağı kaldırılan RENK temizlenir; aynı PLM'in diğer renkleri korunur.
  assert.match(linker, /cpNormalizeImageColourCode\(target&&target\['C\.Code'\]\)!==cpNormalizeImageColourCode\(colourCode\)/);
});
