'use strict';

/* GÜNCEL GÖRÜNÜM KAPSAMI — v11.10
 *
 * Korunan regresyonlar:
 *  · "Tümü" hiçbir zaman veritabanının tamamı değildir; o anki görünümdür.
 *  · "Seçilenler" boşken sessizce "tümü"ne DÜŞMEZ.
 *  · Aynı model 20 satırda geçse de TEK kimliktir; renk kimliği korunur.
 *  · İş başlarken kapsam DONDURULUR (filtre değişse de küme değişmez).
 *  · Uzak iş dönerken görünüm değiştiyse YENİDEN ÇİZİM yapılmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const scope = require(path.join(ROOT, 'public', 'model-asset-scope.js'));

function freshScope() {
  // Modül kayıt defteri paylaşımlıdır; her test kendi sağlayıcısını kurar ve
  // sonunda kaldırır, böylece testler birbirini etkilemez.
  return scope;
}

/* İstemci ve sunucu anahtarı AYNI algoritmadan üretmek ZORUNDA.
   Yakalanan gerçek hata: `toLocaleUpperCase('tr-TR')` "Kirmizi" için "KİRMİZİ",
   sunucudaki turknorm ise "KIRMIZI" üretiyordu. İki taraf ayrışınca istemci
   "görsel var" der, sunucu "yok" der ve hiçbir hata mesajı çıkmaz. */
test('kanonik görsel anahtarı sunucudaki biçimin AYNISIDIR (Türkçe büyütme dâhil)', () => {
  const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
  const cases = [
    ['0002120176', 'RED', 'Kırmızı'], ['100', 'RED', 'Kirmizi'], ['0000100', 'red', 'KIRMIZI'],
    ['100', 'BLUE', 'Mavi'], ['100', 'x', 'ıI'], ['_002100968', 'Şç', 'Ğüö'], ['2100968.0', 'a b  c', ''],
  ];
  for (const [plmId, colourCode, colour] of cases) {
    assert.equal(
      scope.canonicalImageKey(plmId, colourCode, colour),
      parse.plmColourImageNameKey(plmId, colourCode, colour),
      `anahtar ayrıştı: ${JSON.stringify([plmId, colourCode, colour])}`,
    );
  }
  assert.equal(scope.canonicalImageKey('0002120176', ''), parse.plmImageKey('0002120176'));
  assert.equal(scope.canonicalImageKey('', 'RED', ''), '');
});

test('aynı model birden çok satırda geçse TEK kimliktir; renk kimliği KORUNUR', () => {
  const list = scope.dedupe([
    { plmId: '100', colourCode: 'RED', colour: 'Kirmizi', rowId: 'r1' },
    { plmId: '100', colourCode: 'RED', colour: 'Kirmizi', rowId: 'r2' },
    // Aynı kimliğin farklı yazımı (baştaki sıfırlar, küçük harf) tek çözümdür.
    { plmId: '0000100', colourCode: 'red', colour: 'Kirmizi', rowId: 'r3' },
    { plmId: '100', colourCode: 'BLUE', colour: 'Mavi', rowId: 'r4' },
    { plmId: '', colourCode: 'BLUE', rowId: 'r5' },
  ]);
  assert.equal(list.length, 2, '20 satır tek çözüm; farklı renk ayrı kimlik');
  assert.deepEqual(list.map(item => item.colourCode).sort(), ['BLUE', 'RED']);
  // Yanlış rengin görseli ötekine SIZMAMALI.
  assert.notEqual(list[0].canonicalImageKey, list[1].canonicalImageKey);
});

test('etkin görünüm kapsamı verir; drilldown ana tabloyu YENER', () => {
  const api = freshScope();
  const off1 = api.registerProvider('test-table', {
    priority: 1, isActive: () => true,
    resolve: () => ({ contextType: 'orders', viewToken: 'orders#5000', identities: Array.from({ length: 5000 }, (_, i) => ({ plmId: String(i + 1), colourCode: 'X' })), selectedIdentities: [] }),
  });
  const off2 = api.registerProvider('test-drill', {
    priority: 10, isActive: () => true,
    resolve: () => ({ contextType: 'lfl-drilldown', viewToken: 'lfl#d7', identities: [{ plmId: '900', colourCode: 'A' }], selectedIdentities: [] }),
  });
  try {
    const current = api.currentScope();
    assert.equal(current.providerId, 'test-drill');
    assert.equal(current.identities.length, 1, 'drilldown kapsamı tablonun tamamına GENİŞLEMEZ');
  } finally { off1(); off2(); }
});

test('hiçbir sağlayıcı etkin değilse kapsam null döner — tüm veritabanına GENİŞLEMEZ', () => {
  const api = freshScope();
  const off = api.registerProvider('test-inactive', { priority: 1, isActive: () => false, resolve: () => ({ identities: [{ plmId: '1' }] }) });
  try { assert.equal(api.currentScope(), null); } finally { off(); }
});

test('"seçilenler" gerçek seçimi kullanır ve boşken "tümü"ne DÜŞMEZ', () => {
  const api = freshScope();
  const identities = [{ plmId: '1', colourCode: 'A' }, { plmId: '2', colourCode: 'B' }, { plmId: '3', colourCode: 'C' }];
  let selected = [{ plmId: '2', colourCode: 'B' }];
  const off = api.registerProvider('test-sel', {
    priority: 1, isActive: () => true,
    resolve: () => ({ contextType: 'cp', viewToken: 'cp#1', identities, selectedIdentities: selected }),
  });
  try {
    const withSelection = api.snapshot(api.currentScope(), { mode: 'selected' });
    assert.equal(withSelection.identities.length, 1);
    assert.equal(withSelection.identities[0].plmId, '2');
    selected = [];
    const empty = api.snapshot(api.currentScope(), { mode: 'selected' });
    assert.equal(empty.identities.length, 0, 'boş seçim boş kalmalı — çağıran işlemi reddeder');
    const all = api.snapshot(api.currentScope(), { mode: 'all' });
    assert.equal(all.identities.length, 3);
  } finally { off(); }
});

test('iş kapsamı DONDURULUR: filtre değişse de küme değişmez', () => {
  const api = freshScope();
  let identities = Array.from({ length: 18 }, (_, i) => ({ plmId: String(i + 1), colourCode: 'A' }));
  const off = api.registerProvider('test-frozen', {
    priority: 1, isActive: () => true,
    resolve: () => ({ contextType: 'lfl', viewToken: 'lfl#f1', identities, selectedIdentities: [] }),
  });
  try {
    const operation = api.snapshot(api.currentScope(), { mode: 'all' });
    assert.equal(operation.identities.length, 18);
    // Kullanıcı iş sürerken filtreyi değiştirir.
    identities = Array.from({ length: 4000 }, (_, i) => ({ plmId: String(i + 1), colourCode: 'A' }));
    assert.equal(operation.identities.length, 18, 'iş ilk 18 kimlikle sürmeli');
    assert.throws(() => { operation.identities.push({ plmId: 'x' }); }, 'anlık görüntü değiştirilemez olmalı');
  } finally { off(); }
});

test('görünüm değiştiyse yeniden çizim yapılmaz (kapanan rapor geri AÇILMAZ)', () => {
  const api = freshScope();
  let token = 'drill#1';
  const off = api.registerProvider('test-token', {
    priority: 1, isActive: () => true,
    resolve: () => ({ contextType: 'lfl-drilldown', viewToken: token, identities: [{ plmId: '1', colourCode: 'A' }], selectedIdentities: [] }),
  });
  try {
    const operation = api.snapshot(api.currentScope(), { mode: 'missing' });
    assert.equal(api.isViewCurrent(operation), true);
    token = 'drill#2';
    assert.equal(api.isViewCurrent(operation), false, 'başka bir görünüm açıkken eski iş repaint ETMEMELİ');
  } finally { off(); }
});

test('"eksik" tanımı kanonik kayda bakar — hidratlanmamış DOM eksik SAYILMAZ', () => {
  const known = new Set(['plm:1|colour:A']);
  const identities = [
    { plmId: '1', colourCode: 'A', canonicalImageKey: 'plm:1|colour:A' },
    { plmId: '2', colourCode: 'B', canonicalImageKey: 'plm:2|colour:B' },
  ];
  const missing = scope.missingIdentities({ identities }, item => known.has(item.canonicalImageKey));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].plmId, '2');
});

test('kapsam çözümleyicisi tarayıcıda yükleniyor ve istemci onu kullanıyor', () => {
  const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(INDEX, /src="model-asset-scope\.js/);
  assert.match(APP, /window\.BLModelAssetScope/);
  assert.match(APP, /registerModelAssetProviders\(\);/);
  assert.match(APP, /registerCurrentViewModelAssetProvider\(\);/);
  // Kimlik ekrandaki metinden DEĞİL kanonik özniteliklerden okunur.
  assert.match(APP, /img\[data-bl-thumb="1"\]\[data-model-id\]/);
});
