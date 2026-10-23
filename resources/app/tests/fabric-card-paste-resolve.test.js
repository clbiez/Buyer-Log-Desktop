'use strict';

/* Koleksiyon: kumaş hücresine yapıştırılan metni akıllıca kart koduna bağla.
 * Kullanıcı: "Kumaş kartlarında CP'den kopyalayıp Koleksiyona yapıştırdım.
 * Buyer Log neyi yapıştırdığımı anlayamadı ve hücre kart formatında değil düz
 * metin formatında kaldı. PLM kumaş detayı yapıştırırsam ve kartı bulunuyorsa
 * otomatik olarak kartın ön izleme görünümüne geçsin. Metin şeklinde kalmışsa
 * çift tıklama ile kart editörüne geçip kart olarak kaydedebileyim."
 *
 * CP/Orders panosu kart özetini taşır ("A - 161238 · Three Thread Terry · …");
 * bu metin "1234-" kalıbına uymadığı için hücre düz metin kalıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../public/fabric-cards-engine.js');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

const TERRY = '161238-Örme,Üç İplik,70 D,260 gsm,%65 Pamuk, %35 Polyester,Reaktif'; // i18n-ignore
const SUPREM = '3859-Örme,Süprem,30/1 Ne,Compact Penye,150 gsm,100% Pamuk,Reaktif'; // i18n-ignore
const cards = new Map([
  ['161238', { code: '161238', summary: 'Üç İplik · 70 D · 260 gsm · 65% Pamuk 35% Polyester', summaryEn: 'Three Thread Terry · 70 D · 260 gsm · 65% Cotton 35% Poliester', raw: TERRY }], // i18n-ignore
  ['3859', { code: '3859', summary: 'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk', summaryEn: 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton', raw: SUPREM }], // i18n-ignore
]);

test('CP panosundaki takım kart özeti kanonik PLM metnine çevrilir ve iki kart da bulunur', () => {
  const pasted = 'A - 161238 · Three Thread Terry · 70 D · 260 gsm · 65% Cotton 35% Poliester / B - 161238 · Three Thread Terry · 70 D · 260 gsm · 65% Cotton 35% Poliester';
  const resolved = engine.resolveInput(pasted, cards);
  assert.equal(resolved, `A - ${TERRY} / B - ${TERRY}`);
  assert.deepEqual(engine.parts(resolved).map(part => [part.label, part.code]), [['A', '161238'], ['B', '161238']]);
  // Buyer Log'un kendi görünen biçimi ("A · 3859 · …") de aynı şekilde çözülür.
  const display = engine.displayText(`A - ${SUPREM}\nB - ${TERRY}`, cards, 'en');
  assert.equal(engine.resolveInput(display, cards), `A - ${SUPREM} / B - ${TERRY}`);
  // Tek satırlı biçimde de her kumaşın PLM metni ayırıcısız okunur.
  assert.deepEqual(engine.parts(`A - ${SUPREM} / B - ${TERRY}`).map(part => part.raw), [SUPREM, TERRY]);
});

test('kartı olmayan kodlu özet "kod-metin" biçimine çevrilir; çift tıkla kart oluşturulabilir', () => {
  const resolved = engine.resolveInput('2832 · Single Jersey · 20/1 · 200 gsm · 100% Cotton', cards);
  assert.equal(resolved, '2832-Single Jersey, 20/1, 200 gsm, 100% Cotton');
  assert.equal(engine.codeOf(resolved), '2832');
});

test('kodsuz yapıştırılan özet ya da PLM ayrıntısı tek karta eşleşirse o karta bağlanır', () => {
  assert.equal(engine.resolveInput('Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton', cards), SUPREM);
  assert.equal(engine.resolveInput('Süprem · 30/1 Ne · 150 gsm · %100 Pamuk', cards), SUPREM); // i18n-ignore
  assert.equal(engine.resolveInput('Örme,Süprem,30/1 Ne,Compact Penye,150 gsm,100% Pamuk,Reaktif', cards), SUPREM); // i18n-ignore
  // Boşlukla ayrılmış kod yalnız kartı varsa kod sayılır.
  assert.equal(engine.resolveInput('3859 Single Jersey', cards), SUPREM);
});

test('PLM metni ve tanınmayan düz metin olduğu gibi kalır', () => {
  assert.equal(engine.resolveInput(SUPREM, cards), SUPREM);
  assert.equal(engine.resolveInput(`A - ${SUPREM}\nB - ${TERRY}`, cards), `A - ${SUPREM}\nB - ${TERRY}`);
  assert.equal(engine.resolveInput('150 gsm Single Jersey', cards), '150 gsm Single Jersey');
  assert.equal(engine.resolveInput('Pamuklu kumaş', cards), 'Pamuklu kumaş'); // i18n-ignore
  assert.equal(engine.resolveInput('', cards), '');
  // Aynı özete sahip iki kart varsa tahmin edilmez.
  const twins = new Map(cards);
  twins.set('9999', { ...cards.get('3859'), code: '9999', raw: '9999-Örme,Süprem' }); // i18n-ignore
  assert.equal(engine.resolveInput('Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton', twins), 'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton');
});

test('Koleksiyon kumaş yazımı (yapıştırma/yazma) çözücüden geçer; düz metin çift tıkla kart editörünü açar', () => {
  assert.match(APP, /if\(k==='fabric'&&norm\(val\)\)\{const resolved=kolFabricResolveInput\(val\);if\(resolved!==val\)\{val=resolved;el\.value=resolved;\}\}/);
  assert.match(APP, /if\(targetKey==='fabric'&&raw\)value=kolFabricResolveInput\(raw\);/);
  assert.match(APP, /textarea\.editCell\[data-k="fabric"\]/);
  assert.match(APP, /openKolFabricTextDialog\(/);
  assert.match(APP, /function kolFabricLinkRowText\(rowId,raw\)/);
});
