'use strict';

/*
 * v7.15 — Yenileme "Comparison" aşaması için koruma testleri.
 *
 * Saha bulgusu: kullanıcının ekranında ASAS sorgusu 169 saniyede bitiyor, ardından
 * Comparison aşaması 288 saniyeden uzun sürüyordu. Kök neden pairAntrepoRows
 * içinde İKİ ayrı maliyetti:
 *
 *   1) signature()/comparable() aynı satır için defalarca üretiliyordu ve her
 *      üretim 33 alanı `localeCompare(x, 'tr', {...})` ile sıralıyordu.
 *      localeCompare her çağrıda yeni karşılaştırıcı kurar; gerçek Antrepo
 *      verisinde imza üretimi satır başına 763 µs sürüyordu.
 *   2) Aynı kimlikteki kalan satırları eşleyen açgözlü döngü, her seçim turunda
 *      similarity() matrisini baştan hesaplıyordu — kova başına O(k³).
 *      Tek kovada 240 satır 43 saniye sürüyordu.
 *
 * Bu testler davranışın korunduğunu ve maliyetin geri gelmediğini çivilerler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const diff = require('../server/lib/refresh-history-diff');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'refresh-history-diff.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

// Aynı iş kimliğinde (sipariş/model/renk, boş dosya ve konteyner) N satır üretir.
// Bu satırların tamamı tek kovaya düşer — açgözlü eşleştirmenin en kötü hâli.
function bucketOf(count, seed) {
  const map = {};
  for (let i = 0; i < count; i += 1) {
    map[`__ias_row_${i}`] = {
      ocode: '1000000', _matchOcode: '1000000', model: 'MODEL', ccode: 'RNK', colour: 'RENK',
      importFile: '', containerNo: '',
      statu: `Statü ${(i * 7 + seed) % 13}`,
      arr: `2026-01-0${i % 9}`, handover: `2026-02-0${i % 9}`,
      vasita: 'Gemi', loadedQty: 100 + i, iasOrderQty: 200 + ((i + seed) % 5),
    };
  }
  return map;
}
function kindCounts(pairs) {
  const out = {};
  for (const pair of pairs) out[pair.kind] = (out[pair.kind] || 0) + 1;
  return out;
}

test('v7.15 sıra değişikliği sahte fark üretmez ve değişmemiş satırlar eşleşir', () => {
  const rows = bucketOf(12, 0);
  const shuffled = {};
  Object.keys(rows).reverse().forEach((key, index) => { shuffled[`__ias_row_${index}`] = { ...rows[key] }; });
  const pairs = diff.pairAntrepoRows(rows, shuffled);
  assert.deepEqual(kindCounts(pairs), { same: 12 }, 'yalnız sıra değiştiyse hepsi "same" olmalı');
});

test('v7.15 içerik değişen satır "changed", sayı farkı "removed"/"added" olur', () => {
  // Aynı kovada iki taraf da eşit sayıdaysa fark, silme/ekleme değil eşleşmiş
  // "changed" üretir — çoklu parsiyel davranışının bilinçli sonucu.
  const before = bucketOf(6, 0), after = bucketOf(6, 0);
  after.__ias_row_0 = { ...after.__ias_row_0, statu: 'Depoda DEGISTI' };
  const balanced = kindCounts(diff.pairAntrepoRows(before, after));
  assert.equal(balanced.changed, 1, 'yalnız içeriği değişen satır "changed" olmalı');
  assert.equal(balanced.same, 5);

  // Yeni tarafta satır eksikse fark "removed" olarak raporlanır.
  const fewer = bucketOf(6, 0);
  delete fewer.__ias_row_5;
  const shrunk = kindCounts(diff.pairAntrepoRows(before, fewer));
  assert.equal(shrunk.removed, 1);
  assert.equal(shrunk.same, 5);

  // Yeni tarafta fazladan satır varsa "added" olur.
  const more = bucketOf(7, 0);
  const grown = kindCounts(diff.pairAntrepoRows(before, more));
  assert.equal(grown.added, 1);
  assert.equal(grown.same, 6);
});

test('v7.15 fieldChanges yalnız gerçekten değişen alanları döndürür', () => {
  const before = bucketOf(1, 0).__ias_row_0;
  const after = { ...before, statu: 'Depoda' };
  const changes = diff.fieldChanges(before, after);
  assert.equal(changes.length, 1, 'tek alan değişti');
  assert.equal(changes[0].after, 'Depoda');
});

test('v7.15 tek kovadaki yüzlerce parsiyel saniyeler değil milisaniyeler sürer', () => {
  // Eski açgözlü döngü bu boyutta 43 saniyenin üzerindeydi (O(k³)).
  const started = process.hrtime.bigint();
  const pairs = diff.pairAntrepoRows(bucketOf(240, 0), bucketOf(240, 1));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(pairs.length, 240);
  assert.ok(ms < 4000, `tek kovada 240 satır ${ms.toFixed(0)} ms sürdü; O(k³) davranışı geri gelmiş olabilir`);
});

test('v7.15 kova iki katına çıkınca maliyet küp değil kare mertebesinde artar', () => {
  const measure = size => {
    const started = process.hrtime.bigint();
    diff.pairAntrepoRows(bucketOf(size, 0), bucketOf(size, 1));
    return Math.max(1, Number(process.hrtime.bigint() - started) / 1e6);
  };
  const median = values => values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
  measure(60); // ısınma — ilk koşu JIT maliyetini taşımasın
  // Test suite concurrency'si tek bir kısa ölçümü scheduler gürültüsüyle bozmasın.
  // Eşik aynı kalır; yalnız temsilî süre median ile alınır.
  const small = median([measure(60),measure(60),measure(60)]);
  const large = median([measure(120),measure(120),measure(120)]);
  // Küpsel büyüme 8×'tir. Ölçüm gürültüsüne yer bırakıp 6× sınırını çiviliyoruz.
  assert.ok(large / small < 6, `60→120 satırda süre ${(large / small).toFixed(1)}× arttı; küpsel büyüme geri dönmüş olabilir`);
});

test('v7.15 sıralama karşılaştırıcıları bir kez kurulur', () => {
  assert.match(SOURCE, /new Intl\.Collator\('tr', \{ sensitivity: 'base' \}\)/);
  assert.match(SOURCE, /new Intl\.Collator\('tr', \{ numeric: true, sensitivity: 'base' \}\)/);
  // Sıcak yolda çağrı başına karşılaştırıcı kuran biçim kalmamalı.
  assert.doesNotMatch(SOURCE, /localeCompare\([^)]*,\s*'tr'/);
});

test('v7.15 imza ve alan değerleri satır başına bir kez türetilir', () => {
  assert.match(SOURCE, /const comparableCache = new WeakMap\(\);/);
  assert.match(SOURCE, /const signatureCache = new WeakMap\(\);/);
});

test('v7.15 değişmemiş çiftler için pahalı detay nesnesi kurulmaz', () => {
  // "same" erken çıkışı, identity/base hesabından ÖNCE gelmelidir.
  const block = SERVER.slice(SERVER.indexOf('const antrepoPairs = refreshHistoryDiff.pairAntrepoRows'));
  const skipAt = block.indexOf("if (pair.kind === 'same') continue;");
  const baseAt = block.indexOf('antrepoDetailBase(preferred)');
  assert.ok(skipAt > 0 && baseAt > 0, 'her iki satır da bulunmalı');
  assert.ok(skipAt < baseAt, '"same" atlaması antrepoDetailBase çağrısından önce gelmeli');
});
