'use strict';

/* Koleksiyon kumaş hücresi: kayıtlı kumaş kartlarından seçim ve takım (set)
 * modellerde A/B… parçalarını ayrı ayrı ekleme.
 * Kullanıcı: "Kumaş sütununda kumaş eklerken kayıtlı kartlardan kumaş
 * çağırabilmek istiyorum. Set modeller için A ve B manuel giriş yapabilmek,
 * set parçalarını ayrı ayrı ekleyebilmek isterim."
 *
 * - Saf motor (searchCards/composeParts) canlı test edilir.
 * - app-main.js seçici entegrasyonu kaynak sözleşmesiyle denetlenir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../public/fabric-cards-engine.js');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

const TERRY = '161238-Örme,Üç İplik,70 D,260 gsm,%65 Pamuk, %35 Polyester,Reaktif'; // i18n-ignore
const SUPREM = '3859-Örme,Süprem,30/1 Ne,Compact Penye,150 gsm,100% Pamuk,Reaktif'; // i18n-ignore
const cards = new Map([
  ['161238', { code: '161238', summary: 'Üç İplik · 70 D · 260 gsm · 65% Pamuk 35% Polyester', summaryEn: 'Three Thread Terry · 70 D · 260 gsm · 65% Cotton 35% Polyester', raw: TERRY }], // i18n-ignore
  ['3859', { code: '3859', summary: 'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk', summaryEn: 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton', raw: SUPREM }], // i18n-ignore
]);

test('searchCards kayıtlı kartları kod ya da özet ile bulur', () => {
  assert.deepEqual(engine.searchCards(cards, '1612', 'tr').map(card => card.code), ['161238']);
  assert.deepEqual(engine.searchCards(cards, 'jersey', 'en').map(card => card.code), ['3859']);
  assert.deepEqual(engine.searchCards(cards, 'süprem', 'en').map(card => card.code), ['3859']); // i18n-ignore
  assert.equal(engine.searchCards(cards, '', 'tr').length, 2);
  assert.equal(engine.searchCards(cards, '', 'tr', 1).length, 1);
});

test('composeParts tek kumaşta kartın PLM metnini etiketsiz yazar', () => {
  const result = engine.composeParts([{ label: 'A', code: '3859' }], cards);
  assert.equal(result.ok, true);
  assert.equal(result.value, SUPREM);
});

test('composeParts takım modelde A/B parçalarını kanonik biçimde birleştirir ve geri okunur', () => {
  const result = engine.composeParts([{ label: 'a', code: '161238' }, { label: '', code: '3859' }], cards);
  assert.equal(result.ok, true);
  assert.equal(result.value, `A - ${TERRY} / B - ${SUPREM}`);
  assert.deepEqual(engine.parts(result.value).map(part => [part.label, part.code, part.raw]), [['A', '161238', TERRY], ['B', '3859', SUPREM]]);
});

test('composeParts aynı kumaşı iki set parçasında kullanabilir ve manuel harfleri korur', () => {
  const result = engine.composeParts([{ label: 'C', code: '161238' }, { label: 'D', code: '161238' }], cards);
  assert.equal(result.ok, true);
  assert.deepEqual(engine.parts(result.value).map(part => [part.label, part.code]), [['C', '161238'], ['D', '161238']]);
});

test('composeParts kartı olmayan kodda hücredeki PLM metnini korur, metin yoksa reddeder', () => {
  const RAW = '900001-Örme,Ribana,180 gsm'; // i18n-ignore
  const kept = engine.composeParts([{ label: 'A', code: '3859' }, { label: 'B', code: '900001', raw: RAW }], cards);
  assert.equal(kept.ok, true);
  assert.equal(kept.value, `A - ${SUPREM} / B - ${RAW}`);
  const missing = engine.composeParts([{ code: '900001' }], cards);
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'missing-card');
  assert.equal(missing.index, 0);
});

test('composeParts geçersiz ya da tekrarlanan set harfini reddeder, boş seçim hücreyi temizler', () => {
  assert.equal(engine.composeParts([{ label: 'A', code: '3859' }, { label: 'A', code: '161238' }], cards).error, 'duplicate-label');
  assert.equal(engine.composeParts([{ label: '1', code: '3859' }, { label: 'B', code: '161238' }], cards).error, 'invalid-label');
  assert.deepEqual(engine.composeParts([{ label: 'A', code: '' }], cards), { ok: true, value: '' });
  assert.equal(engine.composeParts([{ code: '12' }], cards).error, 'invalid-code');
});

test('Koleksiyon kumaş hücresi seçiciyi açar ve hücreye tek geri alınabilir yazımla yazar', () => {
  const start = APP.indexOf('function openKolFabricPicker(');
  assert.ok(start > 0, 'openKolFabricPicker tanımlı olmalı');
  const block = APP.slice(start, APP.indexOf('\n}\n', start));
  assert.match(block, /api\.searchCards\(/);
  assert.match(block, /api\.composeParts\(/);
  assert.match(block, /kolFabricLinkRowText\(/);
  assert.match(block, /openFabricCardDialog\(/, 'seçili kart düzenlenebilmeli');
  assert.match(block, /data-pick="add"/, 'set parçası eklenebilmeli');
  assert.match(block, /data-pick-label/, 'set harfi elle girilebilmeli');
  // Boş hücre çift tıkla seçiciyi açar; kart penceresi "kumaşı değiştir" ile seçiciye geçer.
  assert.match(APP, /if\(!norm\(el\.value\)\)\{[^}]*openKolFabricPicker\(/);
  assert.match(APP, /data-fabric="pick"/);
  assert.match(APP, /kind==='pick'[\s\S]{0,200}openKolFabricPicker\(/);
});
