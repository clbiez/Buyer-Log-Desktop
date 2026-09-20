'use strict';

// v5.85 — üç düzeltme:
//   1) Koleksiyon'da sütun dondurma yarım çalışıyordu,
//   2) sütun seçici listesi her sayfada A→Z sıralanıyor,
//   3) Koleksiyon görsel boyutunda en küçük kademe kaldırıldı.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');

function bodyOf(name, source = APP) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* ---------------------------------------------------------------- 1) FREEZE */

test('v5.85 dondurma sticky’si kimlik seçicili ezmelerden sonra geri veriliyor', () => {
  // Kök neden: sticky, kimlik seçicisi OLMAYAN `.tablewrap table td.frzL` ile
  // veriliyor; Koleksiyon'da ise `#kolTable tbody td.editTd{position:relative}`
  // var ve kimlik seçicisi özgüllükte kazanıyordu. Sonuç: dondurulan aralıktaki
  // düzenlenebilir sütunlar yapışmıyordu.
  assert.match(CSS, /#kolTable tbody td\.editTd\{padding:0;position:relative;\}/,
    'relative kuralı hâlâ duruyor olmalı — mutlak konumlu çocuklar ona bağlı');
  // Yalnız v5.85 bloğuna bak: dosya sonuna kadar dilimlemek sonradan eklenen
  // ilgisiz kuralları bu teste dahil ediyordu.
  const fixStart = CSS.indexOf('v5.85 — Freeze: kimlik seçicili ezmeler');
  const fix = CSS.slice(fixStart, CSS.indexOf('#kolTable tbody td.editTd.frzL{z-index:4;}', fixStart) + 60);
  assert.match(fix, /#kolTable tbody td\.editTd\.frzL/);
  assert.match(fix, /#kolTable tbody td\.kolPictureCell\.frzL/);
  assert.match(fix, /position:sticky/);
  // Düzeltme !important ile değil, özgüllükle yapılmalı.
  assert.doesNotMatch(fix, /!important/);
});

test('v5.85 yapışan düzenlenebilir hücre kayan hücrelerin üstünde kalıyor', () => {
  // Yalnız v5.85 bloğuna bak: dosya sonuna kadar dilimlemek sonradan eklenen
  // ilgisiz kuralları bu teste dahil ediyordu.
  const fixStart = CSS.indexOf('v5.85 — Freeze: kimlik seçicili ezmeler');
  const fix = CSS.slice(fixStart, CSS.indexOf('#kolTable tbody td.editTd.frzL{z-index:4;}', fixStart) + 60);
  assert.match(fix, /#kolTable tbody td\.editTd\.frzL\{z-index:4;\}/);
});

test('v5.85 CP ve Siparişler de aynı korumayı alıyor', () => {
  // Aynı sınıf hata ileride o tablolarda da çıkabilir; kural şimdiden kapsıyor.
  // Yalnız v5.85 bloğuna bak: dosya sonuna kadar dilimlemek sonradan eklenen
  // ilgisiz kuralları bu teste dahil ediyordu.
  const fixStart = CSS.indexOf('v5.85 — Freeze: kimlik seçicili ezmeler');
  const fix = CSS.slice(fixStart, CSS.indexOf('#kolTable tbody td.editTd.frzL{z-index:4;}', fixStart) + 60);
  assert.match(fix, /#cpTable tbody td\.editTd\.frzL/);
  assert.match(fix, /#ordersTable tbody td\.editTd\.frzL/);
});

/* ------------------------------------------------------- 2) SÜTUN SEÇİCİ A→Z */

// sortColumnPanelEntries appLang'i kapatarak okur; testte dili dışarıdan veriyoruz.
function sortEntries(labels, lang = 'tr') {
  const sort = new Function('appLang', `return function sortColumnPanelEntries(entries){${bodyOf('sortColumnPanelEntries')}};`)(lang);
  return sort(labels.map(label => ({ label }))).map(item => item.label);
}

test('v5.85 sütun seçici girdileri A→Z sıralanıyor', () => {
  assert.deepEqual(sortEntries(['Renk', 'Buyer', 'Adet']), ['Adet', 'Buyer', 'Renk']);
  // Büyük/küçük harf sıralamayı bozmamalı.
  assert.deepEqual(sortEntries(['zebra', 'Adet']), ['Adet', 'zebra']);
});

test('v5.85 sıralama Türkçe harf sırasını kullanıyor', () => {
  // Türkçe'de "İ" I'dan sonra değil, kendi yerinde gelir; İngilizce sıralama
  // "Ürün"ü listenin sonuna atardı.
  const out = sortEntries(['Ürün Klasman', 'Sipariş Kod', 'İl', 'Adet']);
  assert.equal(out[0], 'Adet');
  assert.ok(out.indexOf('İl') < out.indexOf('Sipariş Kod'), 'İ, S’den önce gelmeli');
  assert.ok(out.indexOf('Sipariş Kod') < out.indexOf('Ürün Klasman'), 'S, Ü’den önce gelmeli');
});

test('v5.85 sayılı sütun adları doğal sırada', () => {
  assert.deepEqual(sortEntries(['Fiyat 10', 'Fiyat 2']), ['Fiyat 2', 'Fiyat 10']);
});

test('v5.85 genel panel de Koleksiyon paneli de sıralı çiziliyor', () => {
  const generic = bodyOf('renderColPanel');
  assert.match(generic, /sortColumnPanelEntries\(cs\.order/);
  // Sıra artık cs.order değil; panel yalnız görünürlük içindir.
  assert.doesNotMatch(generic, /panelEl\.innerHTML = cs\.order\.map/);
  // Koleksiyon paneli: Picture sabit sütun olarak en üstte kalır.
  // v6.34: iddia artık ÇAĞRININ KENDİSİNE bakıyor, argümanın birebir metnine değil.
  // Sentetik sütunlar (Best Price / Conf. Manufacturer / Conf. FOB) listeye
  // eklendiği için argüman cols.map yerine cols.concat(...).map oldu; testin niyeti
  // "panel sortColumnPanelEntries ile sıralanıyor" idi, o korunuyor.
  const kol = bodyOf('renderKolColumnPanel');
  assert.match(kol, /sortColumnPanelEntries\(cols\b/);
});

/* ------------------------------------------------- 3) GÖRSEL BOYUTU SLIDER */

test('v5.85 görsel boyutu ortak ve sürekli aralığa sahip', () => {
  assert.match(APP, /koleksiyon:\{preferenceKey:'lcw\.koleksiyon\.imageSize\.v2'/);
  assert.match(APP, /function tableImageSizeDimensions\(tableKey,value\)/);
  assert.match(APP, /max:cfg\.max\.w\*3/);
});

test('v5.85 eski görsel boyutu kayıtları slider sınırlarına taşınıyor', () => {
  assert.match(APP, /function kolNormalizeImgSize\(value\)\{return normalizeTableImageSizeValue\('koleksiyon',value\);\}/);
  assert.match(APP, /if\(key==='medium'\|\|key==='small'\)return cfg\.min\.w/);
  assert.match(APP, /if\(key==='large'\)return cfg\.max\.w/);
});

test('v5.85 başlık tıklaması ortak slider popoverını açıyor', () => {
  assert.match(APP, /openTableImageSizePopover\(kolPicTh,'koleksiyon'\)/);
  assert.doesNotMatch(APP, /kolImgSize=kolImgSize==='medium'\?'large':'medium'/);
  assert.doesNotMatch(APP, /const nextImgSize=/);
});

test('v5.85 kayıtlı tercih iki okuma yolunda da normalize ediliyor', () => {
  const hits = APP.match(/kolNormalizeImgSize\((?:v|obj)\.imgSize\)/g) || [];
  assert.equal(hits.length, 2, 'hem görünüm profili hem yerel sütun durumu');
});
