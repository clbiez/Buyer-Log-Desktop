'use strict';

/* v9.26 — EKRAN AKSİYONU GÜVENİLİRLİĞİ.
 *
 * Senaryo 3 ("Mart In Store olan, Confirmed olmayan modelleri CP ekranında
 * göster") üç ayrı sebeple çalışmıyordu ve üçü de gerçek kusurdu:
 *
 *   1) Ajan veriyi bulup güzel bir cevap yazıyor, ui.filter'ı HİÇ çağırmıyordu.
 *      Prompt'a "göster dendiğinde çağır" yazmak garanti değil — modelin uyup
 *      uymadığını ölçmüyor. Grounding'de işe yarayan mekanizma kullanıldı:
 *      talebi deterministic tanı, cevap anında kontrol et, eksikse onarım turu.
 *
 *   2) ui.filter DOĞRULAMADAN "uygulandı" sayıyordu. Ajan module:'cp' ile
 *      source:'orders' (boş) gönderip STATUS'ü ["Mart In Store","Confirmed"]
 *      diye filtreledi — o alanda böyle bir değer yok. Kullanıcı boş tablo
 *      görecekti, ajan "filtreledim" diyecekti (§26 ihlali).
 *
 *   3) ui.filter YETENEK OLARAK eksikti: yalnız tek alan, yalnız değer içerme.
 *      "Confirmed OLMAYAN" ifade edilemiyordu, iki koşul kurulamıyordu.
 *      Buyer Log tablosunun filtresi bir DEĞER KÜMESİ olduğu için "olmayan"
 *      orada "diğer bütün değerler" demektir; tümleyen sunucuda hesaplanıyor.
 *
 * Kalan sınır dürüstçe: altyapı artık bu isteği ifade edebiliyor ama qwen3:8b
 * hangi alanı hangi koşulla eşleştireceğini güvenilir biçimde çözemiyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const copilot = require('../server/lib/copilot-agent');
const bus = require('../public/copilot-ui-commands.js');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const canonicalFields = require('../public/canonical-fields.js');
require('../public/canonical-module-bindings.js')(canonicalFields);

const CP = [
  { 'STATUS': 'Confirmed', 'In Store (Model Budget)': 'March', 'Season': 'AW27' },
  { 'STATUS': 'Pending', 'In Store (Model Budget)': 'March', 'Season': 'AW27' },
  { 'STATUS': 'In Production', 'In Store (Model Budget)': 'April', 'Season': 'SS27' },
];
const profile = { areas: ['cp', 'orders'] };
const tools = () => createToolRegistry({
  userAccess: { hasArea: (p, area) => (p.areas || []).includes(area) },
  getDataset: async () => CP,
});

/* --------------------------------- 1) EKRAN TALEBİ DETERMINISTIC TANINIYOR */

test('v9.26 ekran talebi model uyumuna bırakılmıyor', () => {
  const yes = [
    'Mart In Store olan, Confirmed olmayan modelleri CP ekranında göster.',
    'Koleksiyon ekranında AW27 modellerini göster',
    'CP tablosunda geciken siparişleri işaretle',
    'Bunları tabloda filtrele',
    'CP sayfasını aç',
    'show these on the screen',
    'open the cp screen',
  ];
  yes.forEach(ask => assert.equal(copilot.likelyDisplayRequest(ask), true, ask));
  /* Tanıma DAR olmalı: metin cevabının yeterli olduğu isteklerde ekran
     aksiyonu zorlamak kullanıcıyı gereksiz yere ekran değiştirtir. */
  const no = ['En pahalı üreticiyi bul', 'Bana rakamları göster', 'AW27 durumu nasıl?', 'Bugün neye odaklanmalıyım?'];
  no.forEach(ask => assert.equal(copilot.likelyDisplayRequest(ask), false, ask));
});

test('v9.26 ekran işi yapılmazsa bir onarım turu veriliyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(source, /const displayRequested = likelyDisplayRequest\(question\);/);
  assert.match(source, /if \(displayRequested && !uiActionUsed && uiRepairs < 1\)/);
  assert.match(source, /UI_ACTION_REQUIRED/);
  /* Israr edilmez: filtrelenemeyen ekranlar var (agentFilter) ve sonsuz
     döngüye girmektense metin cevabı vermek yeğdir. */
  assert.match(source, /uiRepairs \+= 1;/);
  // Onarım, grounding kontrolünden ÖNCE olmalı: eksik iş varken cevabı
  // doğrulamanın anlamı yok.
  assert.ok(source.indexOf('UI_ACTION_REQUIRED') < source.indexOf('const needsBusinessGrounding'));
});

/* ------------------------------------------- 2) FİLTRE DOĞRULANMADAN GEÇMİYOR */

test('v9.26 modülün taşımadığı dataset reddediliyor', async () => {
  /* module:'cp' + source:'orders' o ekranın sütunlarıyla ilgisiz alanlar
     üretir; filtre sessizce boş kalırdı. */
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'cp', source: 'orders', field: 'STATUS', values: ['Confirmed'] }, { profile, ownerId: 'u' }),
    error => error && error.code === 'DATASET_INVALID' && /cp ekranının veri kümesi değil/.test(error.message));
});

test('v9.26 var olmayan filtre değeri boş tablo göstermiyor', async () => {
  /* Ajan "Mart In Store" diye bir STATUS değeri uydurdu. Doğrulanmasaydı
     kullanıcı boş tablo görür, ajan "filtreledim" derdi. */
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'cp', field: 'STATUS', values: ['Mart In Store'] }, { profile, ownerId: 'u' }),
    error => error && error.code === 'FILTER_VALUE_NOT_FOUND'
      && /Gerçek değerler: .*Confirmed/.test(error.message)
      && Array.isArray(error.details.actualValues));
});

test('v9.26 kısmi eşleşme sessiz kalmıyor', async () => {
  const result = await tools().execute('ui.filter',
    { module: 'cp', field: 'STATUS', values: ['Pending', 'Yok Böyle Bir Durum'] }, { profile, ownerId: 'u' });
  assert.deepEqual(result.uiCommand.columns[0].values, ['Pending']);
  assert.deepEqual(result.uiCommand.columns[0].ignoredValues, ['Yok Böyle Bir Durum']);
});

/* ----------------------------------------- 3) ÇOK ALAN VE "OLMAYAN" */

test('v9.26 "olmayan" tümleyene çevriliyor', async () => {
  /* Buyer Log tablosunun filtresi bir DEĞER KÜMESİDİR; olumsuzlama kipi yok.
     Sunucuda veri olduğu için tümleyen burada hesaplanır — istemciye yeni
     filtre türü eklemeye, modele küme mantığı kurdurmaya gerek kalmaz. */
  const result = await tools().execute('ui.filter',
    { module: 'cp', filters: [{ field: 'STATUS', values: ['Confirmed'], exclude: true }] }, { profile, ownerId: 'u' });
  const column = result.uiCommand.columns[0];
  assert.equal(column.exclude, true);
  assert.deepEqual(column.values.sort(), ['In Production', 'Pending']);
  assert.ok(!column.values.includes('Confirmed'));
});

test('v9.26 iki koşul tek komutta taşınıyor', async () => {
  const result = await tools().execute('ui.filter', {
    module: 'cp',
    filters: [
      { field: 'In Store (Model Budget)', values: ['March'] },
      { field: 'STATUS', values: ['Confirmed'], exclude: true },
    ],
  }, { profile, ownerId: 'u' });
  assert.equal(result.appliedColumns, 2);
  /* Alan adı KANONİK kayıttan çözülür: kullanıcı/model "In Store" yazsa da
     uygulamanın gerçek sütunu "In-Store (Model Budget)". Semantic layer'ın
     işi tam olarak bu — istemci tahmin etmek zorunda kalmasın. */
  assert.deepEqual(result.uiCommand.columns.map(c => c.field), ['In-Store (Model Budget)', 'STATUS']);
  // Tek sütunlu kısayol alanları geriye dönük uyum için korunmalı.
  assert.equal(result.uiCommand.field, 'In-Store (Model Budget)');
});

test('v9.26 dışlama her şeyi süpürürse reddediliyor', async () => {
  // Tek değerli bir alanda o değeri dışlamak boş tablo demektir.
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'cp', filters: [{ field: 'Season', values: ['AW27', 'SS27'], exclude: true }] }, { profile, ownerId: 'u' }),
    error => error && error.code === 'FILTER_VALUE_NOT_FOUND');
});

/* ------------------------------------------- 4) İSTEMCİ ATOMİK UYGULUYOR */

function runner(state, columns) {
  return bus.createRunner({
    canonicalFields, state, switchTab: () => true,
    colsByTable: { cp: columns }, rerender: () => {},
  });
}

test('v9.26 çok sütunlu filtre istemcide uygulanıyor', () => {
  const state = { colFilters: {} };
  const out = runner(state, [{ k: 'STATUS' }, { k: 'In Store (Model Budget)' }]).run([{
    command: 'filter', module: 'cp', tableKey: 'cp', route: 'cp', source: 'cp',
    columns: [
      { field: 'In Store (Model Budget)', canonicalId: 'inStore', values: ['March'] },
      { field: 'STATUS', canonicalId: 'orderStatus', values: ['Pending', 'In Production'] },
    ],
  }]);
  assert.equal(out[0].ok, true);
  assert.deepEqual(out[0].columns, ['In Store (Model Budget)', 'STATUS']);
  assert.deepEqual([...state.colFilters.cp['STATUS'].values], ['Pending', 'In Production']);
  assert.deepEqual([...state.colFilters.cp['In Store (Model Budget)'].values], ['March']);
  assert.match(bus.describe(out, true), /In Store \(Model Budget\), STATUS/);
});

test('v9.26 bir sütun çözülemezse HİÇBİRİ uygulanmıyor', () => {
  /* Yarısı uygulanmış filtre yanlış tablodur ve kullanıcı bunu fark etmez;
     yanlış tabloya bakarak karar vermek hiç bakmamaktan kötüdür. */
  const state = { colFilters: {} };
  const out = runner(state, [{ k: 'STATUS' }]).run([{
    command: 'filter', module: 'cp', tableKey: 'cp', source: 'cp',
    columns: [
      { field: 'STATUS', canonicalId: 'orderStatus', values: ['Pending'] },
      { field: 'uydurma_alan', canonicalId: null, values: ['x'] },
    ],
  }]);
  assert.equal(out[0].ok, false);
  assert.equal(out[0].reason, 'field-unknown');
  assert.equal(Object.keys(state.colFilters.cp || {}).length, 0, 'hiçbir sütun yazılmamalı');
});

test('v9.26 eski tek sütunlu zarf hâlâ çalışıyor', () => {
  const state = { colFilters: {} };
  const out = runner(state, [{ k: 'STATUS' }]).run([{
    command: 'filter', module: 'cp', tableKey: 'cp', source: 'cp',
    field: 'STATUS', canonicalId: 'orderStatus', values: ['Confirmed'],
  }]);
  assert.equal(out[0].ok, true);
  assert.deepEqual([...state.colFilters.cp['STATUS'].values], ['Confirmed']);
});
