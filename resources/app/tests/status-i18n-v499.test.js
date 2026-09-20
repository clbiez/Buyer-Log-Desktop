'use strict';

// v4.99 — Kaynak sistemden gelen statü değerlerinin ÇEVİRİSİ yalnız gösterim
// katmanındadır. Bu testler, çevirinin koşullarda/kurallarda tanımsızlık veya
// uyumsuzluk yaratmadığını kanıtlar:
//   1) statusDisplay hiçbir girdi için undefined/null döndürmez
//   2) renk tonu (statusTone) HAM değerle çalışır, çeviriyle değil
//   3) filtre karşılaştırması HAM değerle yapılır
//   4) çevrilmiş metin hiçbir yerde veriye geri yazılmaz
//   5) TR ↔ EN gidiş-dönüş kayıpsızdır

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const rules = require(path.join(ROOT, 'public', 'business-rules.js'));

function grab(name) {
  const m = src.match(new RegExp(`const ${name} = \\{[\\s\\S]*?\\n\\};`));
  assert.ok(m, `${name} tanımı bulunmalı`);
  return Function(`return (${m[0].replace(/^const \w+ = /, '').replace(/;$/, '')});`)();
}
const STATUS_EN = grab('STATUS_EN');
const STATUS_TR = grab('STATUS_TR');
const KOL_DURUM_EN = grab('KOL_DURUM_EN');

// statusDisplay'i kaynaktan çıkarıp gerçek yardımcılarla çalıştır
function makeStatusDisplay(lang) {
  const body = src.match(/function statusDisplay\(v\)\{[\s\S]*?\n\}/)[0];
  const turknorm = v => rules.turkNorm ? rules.turkNorm(v) : String(v || '').toLocaleUpperCase('tr');
  const STATUS_EN_TN={},STATUS_TR_TN={};
  Object.entries(STATUS_EN).forEach(([k,v])=>{STATUS_EN_TN[turknorm(k)]=v;STATUS_TR_TN[turknorm(v)]=k;});
  Object.entries(STATUS_TR).forEach(([k,v])=>STATUS_TR_TN[turknorm(k)]=v);
  const scope = {
    appLang: lang,
    norm: v => (v == null ? '' : String(v).trim()),
    turknorm,
    isShortageStatus: rules.isShortageStatus,
    isWarehouseShortageStatus: rules.isWarehouseShortageStatus,
    STATUS_EN, STATUS_TR, STATUS_EN_TN, STATUS_TR_TN,
  };
  const keys = Object.keys(scope);
  return Function(...keys, `${body}; return statusDisplay;`)(...keys.map(k => scope[k]));
}
const showEn = makeStatusDisplay('en');
const showTr = makeStatusDisplay('tr');

const SOURCE_VALUES = [
  'Üretimde', 'Depoda', 'Retaile Aktarım Bekleniyor',
  'Eksik Yükleme', 'Depoda - Eksik Yükleme',
  'Shortage', 'In Warehouse - Shortage',
  'Bilinmeyen Yeni Statü', 'Üretimde - Kısmi', '', '   ',
];

test('v4.99 statusDisplay hiçbir girdi için undefined/null dönmez', () => {
  for (const v of [...SOURCE_VALUES, null, undefined, 0, false]) {
    for (const fn of [showEn, showTr]) {
      const out = fn(v);
      assert.equal(typeof out, 'string', `girdi ${JSON.stringify(v)} için dize dönmeli`);
      assert.notEqual(out, 'undefined');
    }
  }
});

test('v4.99 sözlükte olmayan statü HAM hâliyle gösterilir (veri kaybolmaz)', () => {
  assert.equal(showEn('Bilinmeyen Yeni Statü'), 'Bilinmeyen Yeni Statü');
  assert.equal(showTr('Bilinmeyen Yeni Statü'), 'Bilinmeyen Yeni Statü');
  // Kaynak yeni bir statü uydurursa ekran boş kalmaz.
  assert.ok(showEn('Yeni Bir Durum').length > 0);
});

test('v4.99 boş statü boş kalır; "—" gibi bir metin uydurulmaz', () => {
  assert.equal(showEn(''), '');
  assert.equal(showTr(''), '');
  assert.equal(showEn(null), '');
});

test('v4.99 TR -> EN -> TR gidiş dönüşü kayıpsız', () => {
  for (const tr of Object.keys(STATUS_EN)) {
    const en = showEn(tr);
    assert.notEqual(en, tr, `${tr} İngilizce kipte çevrilmeli`);
    assert.equal(showTr(en), tr, `${en} Türkçe kipte ${tr} olarak geri dönmeli`);
  }
});

test('v4.99 İngilizce statü metinlerinde Türkçe karakter yok', () => {
  for (const [tr, en] of Object.entries(STATUS_EN)) {
    assert.ok(!/[çğıİöşüÇĞŞÜÖ]/.test(en), `"${tr}" -> "${en}" içinde Türkçe karakter var`);
  }
  for (const [tr, en] of Object.entries(KOL_DURUM_EN)) {
    assert.ok(!/[çğıİöşüÇĞŞÜÖ]/.test(en), `KOL "${tr}" -> "${en}" içinde Türkçe karakter var`);
  }
});

test('v4.99 shortage kuralları çeviriden ETKİLENMEZ (iş mantığı ham değerle çalışır)', () => {
  // İş kuralı hem Türkçe hem İngilizce yazımı tanımaya devam etmeli.
  for (const v of ['Eksik Yükleme', 'Shortage', 'Depoda - Eksik Yükleme', 'In Warehouse - Shortage']) {
    assert.equal(rules.isShortageStatus(v), true, `${v} shortage sayılmalı`);
  }
  for (const v of ['Depoda - Eksik Yükleme', 'In Warehouse - Shortage']) {
    assert.equal(rules.isWarehouseShortageStatus(v), true);
  }
  assert.equal(rules.isShortageStatus('Üretimde'), false);
  assert.equal(rules.isShortageStatus('In Production'), false);
});

test('v4.99 renk tonu HAM değerden okunur, çevrilmiş metinden değil', () => {
  const tone = src.match(/function statusTone\(s\)\{[\s\S]*?\n\}/)[0];
  assert.ok(!tone.includes('statusDisplay'), 'statusTone çeviriye bağlı olmamalı');
  assert.ok(tone.includes("'Depoda'") && tone.includes("'Üretimde'"),
    'statusTone ham Türkçe değerlerle karşılaştırmalı');
  // Rozet çizilirken ton ham değerden, metin çeviriden gelir.
  assert.match(src, /badge\(escapeHtml\(statusDisplay\(v\)\|\|'—'\), statusTone\(v\)\)/);
});

test('v4.99 filtre kutusunun value alanı HAM değerdir; yalnız etiket çevrilir', () => {
  assert.match(src, /key==='STATUS' \? statusDisplay\(v\)/, 'etiket çevrilmeli');
  assert.match(src, /<input type="checkbox" value="\$\{escapeHtml\(v\)\}"/,
    'checkbox value ham değer olmalı');
  // Hazırlanan filtre de ham değerle küme kurar.
  assert.match(src, /kind:'cp-logistic-status',col,set:new Set\(\[\.\.\.entry\.values\]\.map\(norm\)\)/);
});

test('v4.99 çevrilmiş statü hiçbir yerde satır verisine geri yazılmaz', () => {
  const writes = [...src.matchAll(/(\w[\w.\[\]'"]*)\s*=\s*statusDisplay\(/g)].map(m => m[1]);
  for (const target of writes) {
    assert.ok(!/^(row|r|o|order|rec|hit)\b|STATUS/.test(target),
      `statusDisplay sonucu veriye yazılıyor olabilir: ${target}`);
  }
});

test('v4.99 transit kuralı ve varsayılan statü ham Türkçe değeri kullanmaya devam eder', () => {
  assert.match(src, /row\.STATUS=primary\.status\|\|'Üretimde'/);
  assert.match(src, /resolveTransitDaysForValues\([^)]*'Üretimde'/);
});
