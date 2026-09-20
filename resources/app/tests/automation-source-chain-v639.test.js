'use strict';

/* v6.39 — ASAS/IAS ZİNCİRLEME.
 *
 * Kullanıcı isteği: "Otomasyonlar ASAS ve IAS databaselerinden tablo
 * başlıklarıyla yönlendirilebilsin. Birden fazla tablo başlığını zincirleyerek
 * komplike otomasyonlar oluşturabileyim."
 *
 * Eskiden bir tarif TEK kaynak görebiliyordu: ya ASAS başlıkları ya IAS
 * başlıkları. "ASAS'ta RFID=1 VE Antrepo'da statü Depoda" gibi bir kural
 * kurulamıyordu. Artık ikinci bir kaynak Sipariş Kod üzerinden bağlanıyor ve
 * iki tablonun alanları tek satırda birleşiyor.
 *
 * Eşleşme anahtarı orderCodeKey'den geçer. Bu şart değil zorunluluk: model CSV
 * metin döndürür ve "1.234.569" Number() ile NaN olur — v4.09 Antrepo eşleşme
 * sagasının kök nedeni tam olarak buydu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'automations.js'), 'utf8');
const parseLib = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const recipeStore = require(path.join(ROOT, 'server', 'lib', 'automation-recipe-store.js'));

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

const joinApi = new Function('parseLib', 'AUTOMATION_JOIN_ORDER_HEADERS', `
  function automationJoinKeyOf(row){${bodyOf(SERVER, 'automationJoinKeyOf')}}
  function automationJoinPrefix(recipe){${bodyOf(SERVER, 'automationJoinPrefix')}}
  function automationJoinRows(primaryRows,joinRows,recipe){${bodyOf(SERVER, 'automationJoinRows')}}
  return {automationJoinRows, automationJoinKeyOf, automationJoinPrefix};
`)(parseLib, ['Sipariş Kod', 'Siparis Kod', 'Order Code', 'ocode']);

const ASAS = [
  { 'Sipariş Kod': '1.234.569', RFID: '1', RFPO: '0' },
  { 'Sipariş Kod': '1.234.570', RFID: '1', RFPO: '1' },
];
const IAS = [{ 'Sipariş Kod': 1234569, 'Supplier Portal Statü': 'Depoda' }];

/* -------------------------------------------------------- 1) ŞEMA ve ANAHTAR */

test('v6.39 zincir şeması geçersiz değerleri güvenli tarafa düşürüyor', () => {
  assert.deepEqual(recipeStore.normalizeJoin({ source: 'ias', mode: 'missing' }), { source: 'ias', mode: 'missing', prefix: '' });
  assert.deepEqual(recipeStore.normalizeJoin({ source: 'sacma', mode: 'sacma' }), { source: '', mode: 'match', prefix: '' });
  assert.deepEqual(recipeStore.normalizeJoin(null), { source: '', mode: 'match', prefix: '' });
  // Tarifte alan olarak durmalı, yoksa kayıtta kaybolurdu.
  const recipe = recipeStore.normalizeRecipe({ source: 'asas', join: { source: 'ias' } }, 'owner');
  assert.equal(recipe.join.source, 'ias');
});

test('v6.39 sipariş kodu metin ve sayı olarak aynı anahtara indirgeniyor', () => {
  // v4.09 dersi: "1.234.569" Number() ile NaN olur. İki taraf aynı
  // normalleştirmeden geçmezse eşleşme SESSİZCE tutmaz.
  assert.equal(joinApi.automationJoinKeyOf({ 'Sipariş Kod': '1.234.569' }),
               joinApi.automationJoinKeyOf({ 'Sipariş Kod': 1234569 }));
  // Kod okunamayan satır boş anahtar vermeli, uydurmamalı.
  assert.equal(joinApi.automationJoinKeyOf({ 'Model Adı': 'ALFA' }), '');
  assert.equal(joinApi.automationJoinKeyOf(null), '');
});

/* ------------------------------------------------------------ 2) ÜÇ EŞLEŞME KİPİ */

test('v6.39 match kipi yalnız karşılığı olan satırları bırakıyor', () => {
  const out = joinApi.automationJoinRows(ASAS, IAS, { join: { source: 'ias', mode: 'match' } });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]['IAS · Supplier Portal Statü'], 'Depoda');
  assert.equal(out.meta.matched, 1);
  assert.equal(out.meta.unmatched, 1);
});

test('v6.39 optional kipi eşleşmeyen satırları koruyor', () => {
  const out = joinApi.automationJoinRows(ASAS, IAS, { join: { source: 'ias', mode: 'optional' } });
  assert.equal(out.rows.length, 2);
  // Eşleşmeyen satırda ikinci kaynağın alanı hiç bulunmamalı (uydurulmuş boş değil).
  assert.equal(Object.prototype.hasOwnProperty.call(out.rows[1], 'IAS · Supplier Portal Statü'), false);
});

test('v6.39 missing kipi yalnız karşılığı OLMAYAN satırları veriyor', () => {
  // "ASAS'ta var ama Antrepo'ya hiç girmemiş siparişler" yalnız bu kiple ifade edilir.
  const out = joinApi.automationJoinRows(ASAS, IAS, { join: { source: 'ias', mode: 'missing' } });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0]['Sipariş Kod'], '1.234.570');
  // Eşleşmeyen satıra ikinci kaynağın alanları eklenmemeli.
  assert.equal(Object.keys(out.rows[0]).some(k => k.startsWith('IAS · ')), false);
});

/* --------------------------------------------------------- 3) ÖNEK ve ÇAKIŞMA */

test('v6.39 önek aynı adlı başlıkların birbirini ezmesini engelliyor', () => {
  // İki tabloda da "Sipariş Kod" var. Öneksiz birleştirme birini SESSİZCE ezerdi.
  const out = joinApi.automationJoinRows(ASAS, IAS, { join: { source: 'ias', mode: 'match' } });
  assert.equal(out.rows[0]['Sipariş Kod'], '1.234.569', 'birincil değer korunmalı');
  assert.equal(out.rows[0]['IAS · Sipariş Kod'], 1234569, 'ikincil değer önekle durmalı');
});

test('v6.39 iç alanlar birleştirmeye sızmıyor', () => {
  const out = joinApi.automationJoinRows(
    [{ 'Sipariş Kod': '1', A: 1 }],
    [{ 'Sipariş Kod': '1', __internal: 'gizli', B: 2 }],
    { join: { source: 'ias', mode: 'match' } });
  assert.equal(out.rows[0]['IAS · B'], 2);
  assert.equal(Object.prototype.hasOwnProperty.call(out.rows[0], 'IAS · __internal'), false);
});

/* ------------------------------------------------ 4) SESSİZ HATA OLMAMASI */

test('v6.39 çoklanan ve kodsuz satırlar raporlanıyor', () => {
  // Bir sipariş kodunun ikinci kaynakta birden çok satırı olabilir (parsiyeller).
  // İlkini sessizce seçip susmak bu zincirdeki klasik hatadır.
  const out = joinApi.automationJoinRows(
    [{ 'Sipariş Kod': '1' }, { 'Model Adı': 'kodsuz' }],
    [{ 'Sipariş Kod': '1', S: 'a' }, { 'Sipariş Kod': '1', S: 'b' }],
    { join: { source: 'ias', mode: 'optional' } });
  assert.equal(out.meta.duplicates, 1, 'çoklanan satır sayılmalı');
  assert.equal(out.meta.keyless, 1, 'sipariş kodu okunamayan satır sayılmalı');
  assert.equal(out.rows[0]['IAS · S'], 'a', 'ilk satır bağlanmalı');
});

test('v6.39 zincir istatistiği sonuca ve önizlemeye taşınıyor', () => {
  // Taşınmazsa kullanıcı kaç satırın eşleşmediğini hiç göremez.
  assert.match(SERVER, /if\(data\.join\)result\.join=data\.join;/);
  assert.match(SERVER, /join:joinMeta/);
  assert.match(UI, /preview\.join\?/);
  assert.match(UI, /satır eşleşti/);
});

test('v6.39 zincir yoksa davranış değişmiyor', () => {
  const out = joinApi.automationJoinRows(ASAS, IAS, { join: { source: '', mode: 'match' } });
  assert.equal(out.rows, ASAS, 'zincir kurulmamışsa satırlar aynen geçmeli');
  assert.equal(out.meta, null);
});

/* --------------------------------------------------------------- 5) ARAYÜZ */

test('v6.39 zincir kaynağı ve eşleşme kipi arayüzden seçiliyor', () => {
  assert.match(UI, /data-auto-join-source/);
  assert.match(UI, /data-auto-join-mode/);
  // Kaynak veya zincir değişince koşullar temizlenmeli: eski koşullar artık var
  // olmayan önekli alanlara bakıyor olabilir ve sessizce hiçbir satır eşleşmezdi.
  const block = UI.slice(UI.indexOf("on('[data-auto-join-source]'"), UI.indexOf("on('[data-auto-join-mode]'"));
  assert.match(block, /draft\.filters=\[\]/);
});

test('v6.39 alan listesi zincire göre önbelleğe alınıyor', () => {
  const key = new Function(`function fieldCacheKey(source,joinSource){${bodyOf(UI, 'fieldCacheKey')}} return fieldCacheKey;`)();
  // Zincir değişince eski liste gösterilmemeli.
  assert.notEqual(key('asas', ''), key('asas', 'ias'));
  assert.equal(key('asas', ''), 'asas');
  assert.equal(key('asas', 'ias'), 'asas+ias');
  // Sunucu ucu da zincir parametresini kabul etmeli.
  assert.match(SERVER, /req\.query&&req\.query\.join/);
});

test('v6.39 zincirlenen kaynak da yetki kontrolünden geçiyor', () => {
  // Birleştirme, kullanıcının göremediği bir veri alanına arka kapı olmamalı.
  // v9.47: iki kaynak da automationSourceRows'tan geçiyor; yetki kontrolü o
  // fonksiyonun içindeki agentPlatformDataset çağrısında duruyor — yani hâlâ
  // TEK yolda ve join için atlanamıyor.
  const block = bodyOf(SERVER, 'automationDataset');
  assert.match(block, /await automationSourceRows\(ownerId, profile, joinSource, recipe\)/);
  assert.match(bodyOf(SERVER, 'automationSourceRows'), /await agentPlatformDataset\(ownerId, profile, source\)/);
});
