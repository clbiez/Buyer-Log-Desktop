'use strict';

/* PLM senkronu görseli renk adlı anahtara (plm:X|colour:Y|name:Z) yazar.
   Oturum içinde istemci kanonik registry ile bu anahtarı çözdüğü için görsel
   görünüyordu; Buyer Log kapanıp açılınca Orders satırları sunucu
   projeksiyonundan geliyor ve o projeksiyon adlı anahtarı hiç okumadığı için
   _imageRef boş kalıyordu. Kullanıcı aynı PLM senkronunu her açılışta
   yeniden çalıştırmak zorunda kalıyordu. Sunucu projeksiyonu artık kanonik
   plmImageRef ile AYNI kararı verir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');

function order(extra = {}) {
  return { plm: '123456', ccode: 'ABC', colour: 'NAVY', ocode: '9001', model: 'MODEL', kalan: 0, qty: 10, fob: 1, season: 'S', countryRaw: 'TR', ...extra };
}
function overrides(imagemap) {
  return { imagemap, notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, pricingRules: [] };
}
const NAMED = parse.plmColourImageNameKey('123456', 'ABC', 'NAVY');
const CODE = parse.plmColourImageKey('123456', 'ABC');
const LEGACY = parse.plmImageKey('123456');

test('PLM senkronunun adlı anahtarı yeniden açılışta Orders projeksiyonunda çözülür (pasif sipariş dahil)', () => {
  const rows = parse.buildOrdersRowsFromASAS([order()], {}, overrides({ [NAMED]: 'ci_named' }));
  assert.equal(rows[0]._imageRef, 'ci_named');
  assert.match(rows[0]._imageUrl, /ci_named/);
});

test('CP projeksiyonu da adlı anahtarı çözer', () => {
  const rows = parse.buildCPRowsFromASAS([order({ kalan: 5 })], {}, overrides({ [NAMED]: 'ci_named' }));
  assert.equal(rows[0]._imageRef, 'ci_named');
});

test('adlı kayıt eski PLM-only kaydı gölgeler; kod düzeyindeki mezar taşı yine kesin uygulanır', () => {
  let rows = parse.buildOrdersRowsFromASAS([order()], {}, overrides({ [LEGACY]: 'ci_old', [NAMED]: 'ci_new' }));
  assert.equal(rows[0]._imageRef, 'ci_new');
  rows = parse.buildOrdersRowsFromASAS([order({ colour: '' })], {}, overrides({ [CODE]: '', [LEGACY]: 'ci_old' }));
  assert.equal(rows[0]._imageRef, '', 'mezar taşı eski PLM-only görsele düşmez');
});

test('aynı kod altında farklı adlı görseller varken renk adı bilinmeyen satıra tahmini görsel bağlanmaz', () => {
  const map = { [NAMED]: 'ci_navy', [parse.plmColourImageNameKey('123456', 'ABC', 'RED')]: 'ci_red', [LEGACY]: 'ci_old' };
  const rows = parse.buildOrdersRowsFromASAS([order({ colour: '' })], {}, overrides(map));
  assert.equal(rows[0]._imageRef, '');
});

test('indeksli çözücü kanonik plmImageRef ile her durumda aynı kararı verir', () => {
  const maps = [
    {},
    { [NAMED]: 'a' },
    { [NAMED]: '' , [LEGACY]: 'b' },
    { [CODE]: 'c', [NAMED]: 'a' },
    { [CODE]: '', [LEGACY]: 'b' },
    { [LEGACY]: 'b' },
    { [parse.plmColourImageNameKey('123456', 'ABC', 'RED')]: 'r', [LEGACY]: 'b' },
    { [parse.plmColourImageNameKey('123456', 'ABC', 'RED')]: 'r', [parse.plmColourImageNameKey('123456', 'ABC', 'BLUE')]: 'u' },
    { '9001': 'line-legacy' },
  ];
  const orders = [order(), order({ colour: '' }), order({ colour: 'RED' }), order({ ccode: '' }), order({ plm: '' })];
  for (const map of maps) {
    const resolve = parse.createPlmImageRefResolver(map);
    for (const item of orders) {
      assert.equal(resolve(item) || '', parse.plmImageRef(map, item) || '', JSON.stringify({ map, item }));
    }
  }
});
