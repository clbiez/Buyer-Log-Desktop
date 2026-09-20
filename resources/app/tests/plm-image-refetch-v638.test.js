'use strict';

/* v6.38 — SİLİNEN PLM GÖRSELİ YENİDEN YÜKLENEBİLİYOR.
 *
 * Kök neden zinciri (üç ayrı yerde aynı yanlış varsayım):
 *   Silme, RENK düzeyindeki anahtara boş değer (mezar taşı) yazar:
 *     plm:123|colour:RED = ''
 *   Gösterim (plmImageRef) önce renk anahtarına bakar, mezar taşını görür ve
 *   eski PLM-only anahtara HİÇ düşmez — silme böylece kalıcı olur. Doğru.
 *   Ama:
 *     (1) istemcideki "eksikleri tamamla" listesi yalnız eski PLM-only anahtara
 *         bakıyordu; orada eski bir referans durduğu için modeli "görseli var"
 *         sayıp listeye HİÇ eklemiyordu,
 *     (2) sunucudaki senkron da aynı yere bakıyordu,
 *     (3) çekilen görsel renk kodu bilinmediği için eski anahtara yazılıyor ve
 *         mezar taşı tarafından gölgeleniyordu.
 *   Sonuç: görsel indiriliyor, diske yazılıyor, ekranda asla görünmüyordu.
 *
 * KULLANICI KARARI: silinmiş görsel EKSİK sayılır ve yeniden yüklenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');

/* ------------------------------------------------- 1) "GÖRSEL VAR MI" KURALI */

test('v6.38 silinmiş görsel eksik sayılıyor', () => {
  // Kritik durum: eski PLM-only anahtar DOLU ama renk anahtarında mezar taşı var.
  // Eski kod buna "görseli var" diyordu.
  const deleted = { 'plm:123': 'eski-img', 'plm:123|colour:RED': '' };
  assert.equal(parse.plmImageDeleted(deleted, '123'), true);
  assert.equal(parse.plmImageUsable(deleted, '123'), false, 'silinmiş görsel kullanılabilir sayılmamalı');
});

test('v6.38 gerçekten var olan görsel eksik sayılmıyor', () => {
  assert.equal(parse.plmImageUsable({ 'plm:123': 'img' }, '123'), true);
  assert.equal(parse.plmImageUsable({ 'plm:123|colour:RED': 'img' }, '123'), true);
  assert.equal(parse.plmImageUsable({}, '123'), false, 'hiç kayıt yoksa eksiktir');
  // Başka bir PLM'nin kayıtları bu PLM'yi etkilememeli.
  assert.equal(parse.plmImageUsable({ 'plm:999': 'img' }, '123'), false);
  assert.equal(parse.plmImageDeleted({ 'plm:999|colour:RED': '' }, '123'), false);
});

test('v6.38 anahtar toplama yalnız o PLM ile sınırlı', () => {
  const map = { 'plm:12': 'a', 'plm:123': 'b', 'plm:123|colour:RED': 'c', 'plm:1234': 'd' };
  const keys = parse.plmImageKeysFor(map, '123').sort();
  // 'plm:12' ve 'plm:1234' önek benzerliğine rağmen GİRMEMELİ.
  assert.deepEqual(keys, ['plm:123', 'plm:123|colour:RED']);
});

/* ------------------------------------------- 2) SİL → YENİDEN YÜKLE ZİNCİRİ */

test('v6.38 yeniden yüklenen görsel ekranda görünüyor', () => {
  // Bu testin çivilediği şey asıl hatadır: eskiden görsel yazılıyor ama mezar
  // taşı onu gölgelediği için plmImageRef boş dönmeye devam ediyordu.
  const map = { 'plm:123': 'eski-img', 'plm:123|colour:RED': '' };
  const order = { plm: '123', ccode: 'RED' };
  assert.equal(parse.plmImageRef(map, order), '', 'silme etkili olmalı');

  // patchPlmImageLinks'in yaptığı mezar taşı temizliği:
  for (const key of parse.plmImageKeysFor(map, '123')) {
    if (key !== 'plm:123' && String(map[key]).trim() === '') delete map[key];
  }
  map['plm:123'] = 'yeni-img';

  assert.equal(parse.plmImageRef(map, order), 'yeni-img', 'yeniden yüklenen görsel görünmeli');
  assert.equal(parse.plmImageUsable(map, '123'), true);
});

test('v6.38 mezar taşı temizliği yalnız BOŞ kayıtları siliyor', () => {
  // Başka bir rengin GERÇEK görseli, yeniden yükleme sırasında silinmemeli.
  const map = { 'plm:123|colour:RED': '', 'plm:123|colour:BLUE': 'mavi-img' };
  for (const key of parse.plmImageKeysFor(map, '123')) {
    if (key !== 'plm:123' && String(map[key]).trim() === '') delete map[key];
  }
  map['plm:123'] = 'yeni-img';
  assert.equal(map['plm:123|colour:BLUE'], 'mavi-img', 'dolu renk kaydı korunmalı');
  assert.equal(Object.prototype.hasOwnProperty.call(map, 'plm:123|colour:RED'), false);
  // BLUE hâlâ kendi görselini göstermeli, RED yeni ortak görsele düşmeli.
  assert.equal(parse.plmImageRef(map, { plm: '123', ccode: 'BLUE' }), 'mavi-img');
  assert.equal(parse.plmImageRef(map, { plm: '123', ccode: 'RED' }), 'yeni-img');
});

/* ------------------------------------------------- 3) ÜÇ TARAF AYNI KURALDA */

test('v6.38 sunucu senkronu gösterimle aynı çözümlemeyi kullanıyor', () => {
  assert.match(SERVER, /parseLib\.plmImageUsable\(map, link && link\.plmId\)/);
  // Eski, yalnız PLM-only anahtara bakan kontrol kalmamalı.
  assert.doesNotMatch(SERVER, /const existingRef = String\(beforeImages\.imagemap/);
});

test('v6.38 yazma yolu mezar taşını temizliyor', () => {
  assert.match(DB, /plmImageKeysFor\(ov\.imagemap, plmId\)/);
  assert.match(DB, /if \(ref\) \{/, 'temizlik yalnız gerçek bir görsel yazılırken yapılmalı');
  // Silme işleminin kendisi (ref boş) mezar taşı yazmaya devam etmeli.
  assert.match(DB, /ov\.imagemap\[key\] = ref;/);
});

test('görsel güncelleme listesi PLM için renk bazlı, ASAS için model bazlı tekilleşiyor', () => {
  const start = APP.indexOf("function modelImageItems(source,imageSource,scope='filtered')");
  const end = APP.indexOf('function applySyncedPlmImages', start);
  const block = APP.slice(start, end);
  assert.match(block, /imageSource==='plm'&&colourCode/);
  assert.match(block, /turknorm\(colourCode\)/);
  assert.match(block, /:plmId/);
  assert.match(SERVER, /function modelImageItemKey\(item\)\{ return parseLib\.plmImageKey\(item && item\.plmId\); \}/);
  // Eksik/tümü kararı server endpointinde uygulanır.
  // v9.15: gövdeye iş kaydı için "scope" eklendi (işin hangi ekrana ait
  // olduğunu sunucu bilmeli). Sınanan kural aynı: items + mode gönderilir.
  assert.match(APP, /body:JSON\.stringify\(\{items,mode:requestMode,scope:source\}\)/);
});

test('v6.38 istemci ve sunucu kuralı aynı sonucu veriyor', () => {
  // İki taraf ayrışırsa istemci modeli göndermez, sunucu da hiç bakmaz —
  // hata yine sessiz olur. Bu yüzden aynı senaryolar iki tarafta da sınanır.
  const clientUsable = new Function('norm', 'cpNormalizePlmImageId', `
    function cpPlmImageKeysFor(map,plmId){${bodyOf(APP, 'cpPlmImageKeysFor')}}
    function cpPlmImageDeleted(map,plmId){${bodyOf(APP, 'cpPlmImageDeleted')}}
    function cpPlmImageUsable(map,plmId){${bodyOf(APP, 'cpPlmImageUsable')}}
    return cpPlmImageUsable;
  `)(v => String(v == null ? '' : v).trim(), v => String(v == null ? '' : v).trim());

  const cases = [
    {},
    { 'plm:123': 'img' },
    { 'plm:123|colour:RED': 'img' },
    { 'plm:123|colour:RED': '' },
    { 'plm:123': 'eski', 'plm:123|colour:RED': '' },
    { 'plm:999': 'img' },
  ];
  for (const map of cases) {
    assert.equal(clientUsable(map, '123'), parse.plmImageUsable(map, '123'),
      `istemci ve sunucu ayrışıyor: ${JSON.stringify(map)}`);
  }
});

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
