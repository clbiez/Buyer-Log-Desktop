'use strict';
/*
 * v4.22 — Fiyat geçmişinde model bazlı en iyi üç fiyatın renklendirilmesi.
 *
 * Bir modelin satırındaki üretici fiyatları arasında en ucuz üç FARKLI fiyat
 * altın / gümüş / bronz olur. Eşit fiyatlar aynı basamağı paylaşır ve bir sonraki
 * farklı fiyat bir alt sıraya geçer: kullanıcı "en iyi ikinci fiyat" derken
 * değeri kastediyor, satır sayısını değil.
 *
 * v4.23: madalya artık hücreyi boyamıyor — fiyatın soluna küçük bir rozet olarak
 * konuyor. Dolgu ve renkli rakam okunurluğu düşürüyordu. Onaylanmış fiyatın yeşil
 * şeridi eskisi gibi duruyor.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf-8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf-8');

function loadRanker() {
  const match = SRC.match(/function qhPriceRanks\(model,mfrs\)\{[\s\S]*?\n  \}/);
  assert.ok(match, 'qhPriceRanks bulunamadı');
  return new Function(`return (${match[0]})`)();
}

// prices: {üretici: fiyat}. Dönen dizi, mfrs sırasında basamakları verir (0 = madalyasız).
function ranksFor(prices, mfrs) {
  const qhPriceRanks = loadRanker();
  const cells = new Map(Object.entries(prices).map(([name, price]) => [name, { price }]));
  const rankOf = qhPriceRanks({ cells }, mfrs);
  return mfrs.map(name => (cells.has(name) ? rankOf(cells.get(name).price) : 0));
}

const MFRS = ['A', 'B', 'C', 'D', 'E'];

test('en ucuz üç fiyat sırayla altın, gümüş, bronz olur', () => {
  // A=12, B=10, C=11 → B en iyi, C ikinci, A üçüncü. D ve E madalyasız.
  assert.deepStrictEqual(ranksFor({ A: 12, B: 10, C: 11, D: 15, E: 13 }, MFRS), [3, 1, 2, 0, 0]);
});

test('eşit fiyatlar aynı basamağı paylaşır, sonraki farklı fiyat bir alt sıraya geçer', () => {
  // İki üretici de 10 verdiyse ikisi de altın; 11 gümüş, 12 bronz olur.
  assert.deepStrictEqual(ranksFor({ A: 10, B: 10, C: 11, D: 12 }, MFRS), [1, 1, 2, 3, 0]);
});

test('bütün fiyatlar eşitse hepsi altındır', () => {
  assert.deepStrictEqual(ranksFor({ A: 10, B: 10, C: 10 }, MFRS), [1, 1, 1, 0, 0]);
});

test('tek fiyat varsa o fiyat en iyisidir', () => {
  assert.deepStrictEqual(ranksFor({ A: 9 }, MFRS), [1, 0, 0, 0, 0]);
});

test('üçten fazla farklı fiyatta yalnız ilk üçü boyanır', () => {
  assert.deepStrictEqual(ranksFor({ A: 10, B: 11, C: 12, D: 13, E: 14 }, MFRS), [1, 2, 3, 0, 0]);
});

test('fiyatı olmayan hücre madalya almaz', () => {
  const qhPriceRanks = loadRanker();
  const cells = new Map([['A', { price: 10 }], ['B', { price: null }], ['C', {}]]);
  const rankOf = qhPriceRanks({ cells }, MFRS);
  assert.strictEqual(rankOf(10), 1);
  assert.strictEqual(rankOf(null), 0);
  assert.strictEqual(rankOf(undefined), 0);
});

test('madalya bir rozet olarak basılıyor', () => {
  assert.ok(/qhMedal qhMedal\$\{rank\}/.test(SRC), 'rozet sınıfı üretilmeli');
  assert.ok(SRC.includes("c.approved?' qhApproved':''"), 'onay sınıfı korunmalı');
});

test('hücre arka planı ve fiyat metni boyanmıyor', () => {
  // v4.22\'deki dolgu ve renkli rakam okunurluğu düşürüyordu; geri gelmemeli.
  assert.ok(!/qhRank/.test(CSS), 'hücre boyayan sınıflar kalmamalı');
  assert.ok(!/qhRank/.test(SRC), 'hücreye boyama sınıfı yazılmamalı');
  assert.ok(!/\.qhPivot td\.qhApproved \.qhPrice\{color/.test(CSS), 'fiyat metni boyanmamalı');
});

test('üç madalya rozeti de tanımlı ve onay şeridi duruyor', () => {
  for (const cls of ['qhMedal1', 'qhMedal2', 'qhMedal3']) {
    assert.ok(CSS.includes(`.${cls}{`), `${cls} tanımlı olmalı`);
  }
  assert.ok(CSS.includes('.qhPivot td.qhApproved{box-shadow:inset'), 'onayın yeşil şeridi korunmalı');
});

test('rozet fiyatın önünde, aynı satırda duruyor', () => {
  assert.ok(SRC.includes('<span class="qhPrice">${medal}${qhCapacityMarkup(c)}${qhEsc(qhMoney(c.price))}</span>'),
    'rozet ve capacity işareti fiyat metninin soluna konmalı');
});

test('Excel aktarımı ekrandaki renklerin aynısını kullanır', () => {
  assert.ok(SRC.includes('RANK_FILLS'), 'Excel tarafında madalya dolguları olmalı');
  assert.ok(SRC.includes('cell.approved?APPROVED_FILL:(rank?RANK_FILLS[rank-1]:null)'),
    'Excel tarafında da onay yeşili madalyanın üstünde olmalı');
});
