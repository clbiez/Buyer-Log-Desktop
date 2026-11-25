'use strict';
// Fiyat Masası model görseli Koleksiyon ile aynı kaynak sırasını kullanır
// (kolModelImageSources: paylaşılan → kanonik kayıt → sunucu PLM kaydı → img → imgRef).
// Sunucu satırı _serverPlmImageUrl/_sharedCollectionImageUrl ile çözüyor; istemci
// görsel kaydı (overrides.imagemap) CP verisi yüklenene kadar boştur. Eskiden
// Fiyat Masası bu alanları yok sayıyordu; görüntüleme izinli kullanıcı (ve yeniden
// açılıştan sonra sahip) yalnız satırında img bulunan modellerin görselini görüyordu
// (gerçek tarayıcı kanıtı: scripts/multiuser-collection-pricing-e2e.js).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');
const start = source.indexOf('  function qCollectionImageSrc(');
const end = source.indexOf('\n  function qCachedModelThumb(', start);
function imageSrc(row, item, registry = {}) {
  const ctx = {
    qNorm: v => String(v == null ? '' : v).trim(),
    window: { BLModelImageCache: { hasRegistryKey: (p, c) => Boolean(registry[`${p}|${c}`]), resolveRegistrySource: (p, c) => registry[`${p}|${c}`] || '' } },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.f=qCollectionImageSrc;', ctx);
  return ctx.f(row, item);
}

test('kaynak bloğu bulunur', () => { assert.ok(start > 0 && end > start); });

test('istemci kaydı boşken sunucunun çözdüğü PLM görseli kullanılır', () => {
  assert.equal(imageSrc({ plmId: 'P2', colourCode: 'C2', _serverPlmImageUrl: '/api/collection-images/srv2' }, {}), '/api/collection-images/srv2');
});

test('paylaşılan Koleksiyon replikası görseli önce gelir (Koleksiyon ile aynı)', () => {
  assert.equal(imageSrc({ plmId: 'P1', colourCode: 'C1', img: '/api/collection-images/own', _sharedCollectionImageUrl: '/api/collection-images/shared' }, {}, { 'P1|C1': '/api/collection-images/reg' }), '/api/collection-images/shared');
});

test('kanonik kayıt bilinirse sunucu PLM görselinden ve satır img alanından önce gelir', () => {
  assert.equal(imageSrc({ plmId: 'P1', colourCode: 'C1', img: '/api/collection-images/own', _serverPlmImageUrl: '/api/collection-images/srv' }, {}, { 'P1|C1': '/api/collection-images/reg' }), '/api/collection-images/reg');
});

test('eski davranış: satır img, imgRef ve kalem görseli yedekleri korunur', () => {
  assert.equal(imageSrc({ img: '/api/collection-images/own' }, {}), '/api/collection-images/own');
  assert.equal(imageSrc({ imgRef: 'ref 1' }, {}), '/api/collection-images/ref%201');
  assert.equal(imageSrc(null, { picture: '/p.png' }), '/p.png');
});
