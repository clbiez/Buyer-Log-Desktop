'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');

function historyCellBlock() {
  const start = SOURCE.indexOf('function qHistoryCellHtml');
  const end = SOURCE.indexOf('function qHistoryColumnsPanelHtml', start);
  assert.ok(start >= 0 && end > start, 'Pricing History hücre renderer bulunamadı');
  return SOURCE.slice(start, end);
}

test('v10.51 Pricing History picture hücresi güncel Collection görsel resolverını kullanır', () => {
  const block = historyCellBlock();
  assert.match(block, /record\.collectionRow\?qCollectionImageSrc\(record\.collectionRow\):record\.picture/);
  assert.doesNotMatch(block, /qCollectionImageSrc\(record\.collectionRow\)\|\|record\.picture/);
  assert.match(block, /qCachedModelThumb\(image/);
  // Renk adı da verilir: kanonik kayıt plm:X|colour:Y|name:Z anahtarını tutar ve
  // ana Koleksiyon görünümü (canonicalModelImageSource) rengi zaten geçiyor.
  assert.match(SOURCE, /resolveRegistrySource\?\.\(plmId,colourCode,'\/api\/collection-images',colourName\)/);
  assert.match(SOURCE, /hasRegistryKey\?\.\(plmId,colourCode,colourName\)/);
});

test('v10.51 boş kayıt defteri eşleşmesi legacy quotation görselini geri getirmez', () => {
  const match = SOURCE.match(/function qCollectionImageSrc\(row,item=null\)\{[\s\S]*?\n  \}/);
  assert.ok(match, 'Collection görsel resolver bulunamadı');
  const resolve = new Function('qNorm', 'window', `${match[0]}\nreturn qCollectionImageSrc;`)(
    value => String(value == null ? '' : value).trim(),
    { BLModelImageCache: { hasRegistryKey: () => true, resolveRegistrySource: () => '' } },
  );
  assert.equal(resolve({ plmId: '215013', colourCode: '0012', picture: '/legacy.jpg' }), '',
    'tombstone eşleşmesi eski picture değerine düşmemeli');
});

test('v10.51 Pricing History görsel düzeltmesi yeni ağ/cache katmanı oluşturmaz', () => {
  const block = historyCellBlock();
  assert.doesNotMatch(block, /fetch\s*\(/);
  assert.doesNotMatch(block, /new\s+(Map|WeakMap|Promise)/);
  assert.match(block, /qCachedModelThumb/);
});
