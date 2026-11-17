'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_MAIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} bulunamadı`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} bulunamadı`);
  return source.slice(start, end);
}

/* v10.52 — Pricing History hücreleri ortak thumbHtml'i kendi sınıf adlarıyla
   (pricingHistoryThumb / pricingDecisionThumb) üretiyor. Bağlama seçicisi
   yalnız .detailModelThumb'a baktığı için bu görseller placeholder'da kalıyor,
   data-src hiç yüklenmiyordu. */
test('v10.52 ortak thumbHtml çıktısı sınıf adından bağımsız bir bağlama işareti taşır', () => {
  const thumb = block(APP_MAIN, 'function detailImageThumbHtml', 'function detailImageToggleHtml');
  assert.match(thumb, /data-bl-thumb="1"/, 'thumbHtml ortak bağlama işaretini yazmalı');
  assert.match(thumb, /data-src="/, 'lazy-load sözleşmesi korunmalı');
});

test('v10.52 detay thumbnail bağlayıcısı işaretli tüm görselleri kapsar', () => {
  const binder = block(APP_MAIN, 'const DETAIL_THUMB_SELECTOR', 'new MutationObserver');
  assert.match(binder, /img\[data-bl-thumb="1"\]/, 'seçici ortak işareti içermeli');
  assert.match(binder, /img\.detailModelThumb/, 'varsayılan sınıf desteği korunmalı');
  assert.doesNotMatch(
    binder.replace(/DETAIL_THUMB_SELECTOR/g, ''),
    /querySelectorAll\?\.\('img\.detailModelThumb'\)/,
    'sınıfa sabitlenmiş eski seçici geri gelmemeli',
  );
});

/* Aynı görsel hem ortak katman hem modül içi bağlayıcı tarafından bağlanırsa
   hover önizlemesi iki kez kurulur. Modül bağlayıcıları ortak katmanın
   işaretine saygı göstermeli. */
test('v10.52 quotations bağlayıcıları ortak katmanın bağladığı görseli tekrar bağlamaz', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');
  const matches = source.match(/detailPreviewBound==='1'/g) || [];
  assert.equal(matches.length, 2, 'her iki quotations bağlayıcısı da ortak işareti kontrol etmeli');
});

/* Kanonik kayıt defteri anahtarı renk ADI da taşıyabilir: plm:X|colour:Y|name:Z.
   Eski desen adı renk koduna yapıştırıyor, renk düzeyindeki görsel bozuk bir
   anahtarla indeksleniyordu. */
test('v10.52 detay görsel dizini adlı kanonik anahtarı doğru ayrıştırır', () => {
  const index = block(APP_MAIN, 'function buildDetailImageIndex', 'function detailImageUrlFrom');
  const pattern = index.match(/\/\^plm:\(\[\^\|\]\+\)[^/]*\/i/);
  assert.ok(pattern, 'imagemap anahtar deseni bulunamadı');
  const regex = new Function(`return ${pattern[0]};`)();
  const named = regex.exec('plm:215013|colour:0012|name:LACIVERT');
  assert.ok(named, 'adlı anahtar eşleşmeli');
  assert.equal(named[1], '215013');
  assert.equal(named[2], '0012', 'renk kodu renk adını içermemeli');
  const plain = regex.exec('plm:215013|colour:0012');
  assert.equal(plain[2], '0012');
  const legacy = regex.exec('plm:215013');
  assert.ok(legacy && !legacy[2], 'PLM-only legacy anahtar korunmalı');
});
