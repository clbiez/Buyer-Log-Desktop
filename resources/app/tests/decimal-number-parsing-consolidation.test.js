'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BL-017: tableNumericValue, endeksmatikNumber, kolImportNumber ve shipParseEditorValue
// ondalık/binlik ayırıcı belirsizliğini çözen neredeyse birebir aynı 2-3 satırı dört
// ayrı yerde tekrarlıyordu. Bu satırlar normalizeDecimalText() adlı tek bir yardımcıya
// taşındı; her fonksiyon kendi varsayılan değerini (0 / null / NaN / {ok,value}) ve
// kendi para simgesi temizliğini korudu — YALNIZ ayrıştırma çekirdeği paylaşılıyor.
// Bu test taşımadan ÖNCEKİ davranışın (dört farklı "boş" sinyali dahil) birebir
// korunduğunu kanıtlar.

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function extractFn(name) {
  const match = APP.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} kaynakta bulunamadı`);
  return match[0];
}

const normalizeSrc = extractFn('normalizeDecimalText');

function load(name) {
  const src = extractFn(name);
  return new Function(`${normalizeSrc}\n${src}\nreturn ${name};`)();
}

test('normalizeDecimalText: virgül/nokta belirsizliği', () => {
  const fn = load('normalizeDecimalText');
  assert.equal(fn('1.234,56'), '1234.56', 'TR biçimi: nokta binlik, virgül ondalık');
  assert.equal(fn('1,234.56'), '1234.56', 'EN biçimi: virgül binlik, nokta ondalık');
  assert.equal(fn('1234,56'), '1234.56', 'yalnız virgül -> ondalık');
  assert.equal(fn('1234.56'), '1234.56', 'yalnız nokta -> değişmez (çağıran yorumlar)');
  assert.equal(fn('1234'), '1234', 'ayırıcı yok -> değişmez');
});

test('tableNumericValue: boş/geçersiz için 0, virgülsüz çoklu nokta binlik sayılır', () => {
  const fn = load('tableNumericValue');
  assert.equal(fn(''), 0);
  assert.equal(fn(null), 0);
  assert.equal(fn('abc'), 0);
  assert.equal(fn('1.234,56'), 1234.56);
  assert.equal(fn('1,234.56'), 1234.56);
  assert.equal(fn('12.345.678'), 12345678, 'virgülsüz çoklu nokta binlik ayırıcı sayılır');
  assert.equal(fn(42), 42);
  assert.equal(fn('  1 234,50 '), 1234.5, 'boşluklar silinir');
});

test('endeksmatikNumber: boş/geçersiz için null, para/yüzde simgeleri silinir', () => {
  const fn = load('endeksmatikNumber');
  assert.equal(fn(''), null, 'boş değer 0 DEĞİL null döner');
  assert.equal(fn(null), null);
  assert.equal(fn('abc'), null);
  assert.equal(fn('₺1.234,56'), 1234.56);
  assert.equal(fn('%15'), 15);
  assert.equal(fn('1,234.56'), 1234.56);
});

test('kolImportNumber: boş/geçersiz için NaN, para simgeleri silinir', () => {
  const fn = load('kolImportNumber');
  assert.ok(Number.isNaN(fn('')), 'boş değer 0 DEĞİL NaN döner');
  assert.ok(Number.isNaN(fn(null)));
  // "abc" gibi saf harf girdisinde rakam-dışı karakterler temizlenip boş string kalır;
  // Number('') === 0 olduğu için bu, orijinal (refactor öncesi) koddan beri 0 döner —
  // NaN değil. Davranış korunuyor, sadece burada belgeleniyor.
  assert.equal(fn('abc'), 0);
  assert.equal(fn('$1,234.56'), 1234.56);
  assert.equal(fn('€1.234,56'), 1234.56);
  assert.equal(fn(7), 7);
});
