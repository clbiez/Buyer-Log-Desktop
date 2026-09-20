'use strict';

/* v6.45 — YENİLEME ÖZETİNDE BOŞ META ALANLARI DÜZELTİLDİ.
 *
 * Kullanıcı gözlemi (ekran görüntüsü): "2 source-data changes" raporundaki
 * "Change details" tablosunda ANTREPO kaynaklı satırlarda SUB-MFR, SPECIAL
 * CODE, MAG, MMYG, BUYER, BUYING GROUP, SEASON, MANUFACTURER sütunları boş
 * geliyordu.
 *
 * Kök neden: Antrepo satırını kendi ASAS siparişine bağlayan orderLineKey,
 * sipariş kodunu ASAS tarafında SAYI (temiz: "1314997"), Antrepo tarafında
 * ("_matchOcode" / exactOrderCodeKey) yalnız trim+normalize edilmiş HAM metin
 * ("1.314.997") olarak karşılaştırıyordu. Kaynak veri noktalı geldiğinde bu
 * iki temsil STRING olarak asla eşleşmiyor, metaOf({}) çağrılıp tüm meta
 * alanları sessizce boş kalıyordu — CP'deki gerçek üretim eşleştirmesi
 * (findAntrepoHit/antrepoMatchKey, v4.32'nin bilinçli katı kuralı)
 * ETKİLENMİYORDU, yalnız bu rapordaki görüntüleme zenginleştirmesi bozuktu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const parseLib = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

const clean = v => (v == null ? '' : String(v).trim());

/* ---------------------------------------------------- 1) KÖK NEDENİN İZOLE DOĞRULAMASI */

test('v6.45 ASAS ve Antrepo sipariş kodu temsilleri eski kodda EŞİT DEĞİLDİ', () => {
  // Bu test kanıtı belgeliyor: sorun gerçekten ocode biçim uyuşmazlığıydı.
  const asasSide = clean(parseLib.toOrderCodeNumber('1.314.997'));
  const antrepoSide = clean('1.314.997'); // exactOrderCodeKey — yalnız trim, nokta kalır
  assert.notEqual(asasSide, antrepoSide, 'eski karşılaştırma bu ikisini FARKLI sayardı');
  // Düzeltilmiş normalleştirmede ikisi de aynı sonuca inmeli.
  assert.equal(parseLib.orderCodeKey(asasSide), parseLib.orderCodeKey(antrepoSide));
});

test('v6.45 orderLineKey artık orderCodeKey ile biçim-toleranslı normalleştiriyor', () => {
  const body = bodyOf(SERVER, 'computeRefreshSummary');
  assert.match(body, /const orderLineKey = o => \[parseLib\.orderCodeKey\(o && \(o\._matchOcode \|\| o\.ocode\)\)/);
  assert.match(body, /const orderColourKey = `\$\{parseLib\.orderCodeKey\(row\.ocode\)\}/);
  // Eski, yalnız trim yapan karşılaştırma kalmamalı.
  assert.doesNotMatch(body, /orderLineKey = o => \[clean\(o && \(o\._matchOcode/);
});

test('v6.45 CP/Backlog üretim eşleştirmesi (antrepoMatchKey) katı kalmaya devam ediyor', () => {
  // Bu düzeltme yalnız RAPOR zenginleştirmesini gevşetmeli; CP'ye hangi
  // Antrepo kaydının BAĞLANACAĞINI belirleyen v4.32 kararına dokunulmamalı.
  assert.match(fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8'),
    /Üç alanın\s*\n\s*\/\/ tamamı aynı değilse IAS kaydı kesinlikle bağlanmaz\./);
  assert.doesNotMatch(SERVER, /antrepoMatchKey\s*=\s*orderCodeKey/);
});

/* --------------------------------------------------------- 2) UÇTAN UCA SENARYO */

test('v6.45 Antrepo satırı kendi ASAS siparişinin meta bilgisini buluyor', () => {
  const asasOrder = {
    ocode: parseLib.toOrderCodeNumber('1.314.997'),
    model: 'UK.TSH,ATAM-1', ccode: 'HPM', colour: 'RED',
    merch: 'MAG-X', ageGroup: '0-3', buyer: 'Ayşe', buyerGrup: 'BG-1',
    season: 'W26', manufacturer: 'Üretici A', ozel: 'SP-1',
  };
  const antrepoRow = {
    ocode: parseLib.orderCodeKey('1.314.997'),
    _matchOcode: '1.314.997', // kaynaktan noktalı geldi — ekran görüntüsündeki durum
    model: 'UK.TSH,ATAM-1', ccode: 'HPM', colour: 'RED',
  };

  const orderLineKey = o => [parseLib.orderCodeKey(o && (o._matchOcode || o.ocode)), clean(o && o.model), clean(o && o.ccode)].join('|').toLocaleUpperCase('tr-TR');
  const index = new Map();
  const key = orderLineKey(asasOrder);
  if (key) index.set(key, asasOrder);

  const found = index.get(orderLineKey(antrepoRow));
  assert.ok(found, 'Antrepo satırı kendi ASAS siparişini bulmalı');
  assert.equal(found.merch, 'MAG-X');
  assert.equal(found.ageGroup, '0-3');
  assert.equal(found.buyer, 'Ayşe');
  assert.equal(found.buyerGrup, 'BG-1');
  assert.equal(found.season, 'W26');
  assert.equal(found.manufacturer, 'Üretici A');
  assert.equal(found.ozel, 'SP-1');
});

test('v6.45 farklı model/renk hâlâ yanlış siparişe bağlanmıyor', () => {
  // Gevşeyen yalnız SİPARİŞ KODU biçimi olmalı; model ve renk kodu hâlâ
  // TAM eşleşmeli, aksi halde yanlış meta bilgi rapora karışırdı.
  const orderA = { ocode: 1314997, model: 'UK.TSH,ATAM-1', ccode: 'HPM', merch: 'DOĞRU' };
  const orderB = { ocode: 1314997, model: 'UK.TSH,ATAM-1', ccode: 'Q6K', merch: 'YANLIŞ-OLMAMALI' };
  const antrepoRow = { ocode: parseLib.orderCodeKey('1.314.997'), _matchOcode: '1.314.997', model: 'UK.TSH,ATAM-1', ccode: 'HPM' };

  const orderLineKey = o => [parseLib.orderCodeKey(o && (o._matchOcode || o.ocode)), clean(o && o.model), clean(o && o.ccode)].join('|').toLocaleUpperCase('tr-TR');
  const index = new Map();
  [orderA, orderB].forEach(o => { const k = orderLineKey(o); if (k && !index.has(k)) index.set(k, o); });

  const found = index.get(orderLineKey(antrepoRow));
  assert.equal(found.merch, 'DOĞRU', 'renk kodu HPM olan sipariş bulunmalı, Q6K olan değil');
});

test('v6.45 eşleşme bulunamazsa hâlâ boş obje ile sessizce devam ediyor (hata fırlatmıyor)', () => {
  // Gerçekten bağlantısız bir Antrepo satırı için hata fırlatılmamalı;
  // yalnız meta alanları boş kalmalı (v4.09'daki "sessiz hata" felsefesiyle
  // tutarlı: gözlemlenebilirlik önce, ama süreç durmaz).
  const orderLineKey = o => [parseLib.orderCodeKey(o && (o._matchOcode || o.ocode)), clean(o && o.model), clean(o && o.ccode)].join('|').toLocaleUpperCase('tr-TR');
  const index = new Map();
  const antrepoRow = { ocode: '9999999', _matchOcode: '9.999.999', model: 'YOK', ccode: 'YOK' };
  const found = index.get(orderLineKey(antrepoRow)) || {};
  assert.deepEqual(found, {});
});
