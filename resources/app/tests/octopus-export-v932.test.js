'use strict';

/* v9.32 — OCTOPUS ÇIKTISI: CEVAP ARTIK DOSYA OLABİLİYOR
 *
 * Mockup'taki "Excel report" kartı bugüne kadar yoktu. Yapılabilir olmasının
 * sebebi, satırların ZATEN sunucuda olması: araç sonuçlarının `result` alanı
 * istemciye kasıtlı olarak gönderilmiyor (copilot-agent.js). Çıktıyı istemcide
 * üretmek, o kararı yalnız bir dosya yazabilmek için geri almak olurdu.
 *
 * Bu testlerin koruduğu üç şey:
 *
 *   1) UYDURMA YOK. Yalnız araçların gerçekten döndürdüğü satırlar ihraç
 *      edilir. Tablo yoksa çıktı da yoktur — boş bir Excel sunmak, olmayan
 *      bir dayanağı varmış gibi göstermektir.
 *   2) DOSYA KENDİNİ AÇIKLAR. Excel e-postayla tedarikçiye gider ve altı ay
 *      sonra klasörde bulunur. Hangi soruya cevap olduğu, hangi veriye
 *      dayandığı ve ne zaman üretildiği dosyanın İÇİNDE olmak zorunda.
 *   3) BAŞKASININ ÇIKTISI İNDİRİLEMEZ. Kimlik tahmin edilemez olsa bile tek
 *      başına yeterli sayılmaz; her okuma sahipliği ayrıca doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const exporter = require('../server/lib/octopus-export.js');
const { createExportStore } = require('../server/lib/octopus-export-store.js');

const CALL = (id, result, extra = {}) => ({ id, args: {}, result, ...extra });

const BASE = {
  question: 'Nova’nın açık siparişleri',
  answer: 'Nova için 12 açık sipariş var.',
  model: 'qwen3:8b',
  actor: 'Gökberk',
  at: '2026-09-04T20:15:00.000Z',
  evidence: [{ source: 'cp', matched: 12, refreshedAt: '2026-09-04T08:00:00.000Z', scope: { outsideHorizon: false } }],
};

/* =============================================== 1) YALNIZ GERÇEK VERİ */

test('v9.32 tablo yoksa çıktı da yok', () => {
  /* Yalnız rapor sayfasından oluşan bir Excel, kullanıcıya "verin burada"
     deyip boş bir dosya vermek olurdu. */
  assert.equal(exporter.buildExportModel({ ...BASE, toolCalls: [] }), null);
  assert.equal(exporter.buildExportModel({ ...BASE, toolCalls: [CALL('system.calculate', { value: 42 })] }), null);
  assert.equal(exporter.buildExportModel({ ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows: [] })] }), null);
  assert.equal(exporter.buildExportModel(null), null);
});

test('v9.32 hatalı araç çağrısı ihraç edilmez', () => {
  /* Hata veren bir çağrının kısmi sonucu, cevabın dayanağı DEĞİLDİR. */
  const model = exporter.buildExportModel({
    ...BASE,
    toolCalls: [CALL('dataset.query', { source: 'cp', rows: [{ a: 1 }] }, { error: { code: 'X' } })],
  });
  assert.equal(model, null);
});

test('v9.32 yalnız araçtan gelen satırlar sayfaya girer', () => {
  const rows = [{ 'Order Code': 1001, Manufacturer: 'Nova', Qty: 500 },
    { 'Order Code': 1002, Manufacturer: 'Nova', Qty: 250 }];
  const model = exporter.buildExportModel({ ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows })] });
  const sheet = model.sheets.find(s => s.name !== 'Rapor');
  assert.deepEqual(sheet.aoa[0], ['Order Code', 'Manufacturer', 'Qty']);
  assert.deepEqual(sheet.aoa[1], [1001, 'Nova', 500]);
  assert.equal(sheet.aoa.length, 3, 'başlık + iki satır');
  assert.equal(model.rowCount, 2);
});

test('v9.32 sütun sırası İLK GÖRÜLDÜĞÜ sıradır', () => {
  /* Araçlar alanları anlamlı sırayla döndürüyor (kimlik önce, ölçü sonra);
     alfabetik sıralamak o bilgiyi yok ederdi. Eksik alan taşıyan satırlar da
     sütunu düşürmemeli. */
  const rows = [{ kod: 1, uretici: 'Nova' }, { kod: 2, adet: 5 }];
  const model = exporter.buildExportModel({ ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows })] });
  const sheet = model.sheets[1];
  assert.deepEqual(sheet.aoa[0], ['kod', 'uretici', 'adet']);
  assert.deepEqual(sheet.aoa[2], [2, '', 5], 'eksik hücre boş kalır, uydurulmaz');
});

/* ================================================ 2) DOSYA KENDİNİ AÇIKLAR */

test('v9.32 rapor sayfası soruyu, cevabı ve dayanağı taşır', () => {
  const model = exporter.buildExportModel({
    ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows: [{ a: 1 }] })],
  });
  const report = model.sheets[0];
  assert.equal(report.name, 'Rapor');
  const flat = report.aoa.map(row => row.join(' | ')).join('\n');
  assert.match(flat, /Nova’nın açık siparişleri/);
  assert.match(flat, /Nova için 12 açık sipariş var\./);
  assert.match(flat, /qwen3:8b/);
  assert.match(flat, /Gökberk/);
  assert.match(flat, /2026-09-04T20:15:00\.000Z/);
  assert.match(flat, /DAYANAK/);
  assert.match(flat, /cp \| 12 \| 2026-09-04T08:00:00\.000Z/);
});

test('v9.32 Horizon dışı veri raporda SÖYLENİR', () => {
  /* Kapsam dışı veriyle üretilmiş bir sayıyı kapsam içiymiş gibi göstermek,
     dosyayı sessizce yanlış yapar. */
  const model = exporter.buildExportModel({
    ...BASE,
    evidence: [{ source: 'cp', matched: 3, scope: { outsideHorizon: true } }],
    toolCalls: [CALL('dataset.query', { source: 'cp', rows: [{ a: 1 }] })],
  });
  assert.match(model.sheets[0].aoa.map(r => r.join(' ')).join('\n'), /Horizon dışı veriler dahil/);
});

test('v9.32 kırpma GİZLENMEZ', () => {
  /* Eksik olduğunu bilmeyen biri toplamı yanlış okur. */
  const rows = Array.from({ length: exporter.MAX_ROWS_PER_SHEET + 25 }, (_, i) => ({ i }));
  const model = exporter.buildExportModel({ ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows })] });
  assert.equal(model.sheets[1].aoa.length, exporter.MAX_ROWS_PER_SHEET + 1);
  assert.match(model.sheets[0].aoa.map(r => r.join(' ')).join('\n'), new RegExp(`İlk ${exporter.MAX_ROWS_PER_SHEET} satır`));
});

test('v9.32 dosya adı sorudan türer', () => {
  /* İndirilenler klasöründe on tane "Octopus_Rapor.xlsx" işe yaramaz. */
  const name = exporter.fileNameFor({ question: 'AW27 riskli siparişler / özet', at: '2026-09-04T20:15:00Z' });
  assert.match(name, /^Octopus_aw27-riskli-siparisler-ozet_20260904\.xlsx$/);
  // Soru boşsa da geçerli bir ad üretilmeli.
  assert.match(exporter.fileNameFor({ question: '   ', at: '2026-09-04T00:00:00Z' }), /^Octopus_rapor_20260904\.xlsx$/);
});

/* ====================================================== 3) BİÇİM SAĞLAMLIĞI */

test('v9.32 sayfa adları Excel kurallarına uyar ve çakışmaz', () => {
  /* : \\ / ? * [ ] yasak ve 31 karakter sınırı var; çakışan ad dosyayı bozar. */
  const used = new Set();
  assert.equal(exporter.sheetName('cp/orders:2024', used), 'cp orders 2024');
  assert.equal(exporter.sheetName('cp/orders:2024', used), 'cp orders 2024 (2)');
  assert.ok(exporter.sheetName('x'.repeat(80), used).length <= 31);
  assert.equal(exporter.sheetName('   ', used), 'Veri');

  // Aynı kaynaktan iki sorgu iki ayrı sayfa olmalı, biri diğerini ezmemeli.
  const call = () => CALL('dataset.query', { source: 'cp', rows: [{ a: 1 }] });
  const model = exporter.buildExportModel({ ...BASE, toolCalls: [call(), call()] });
  const names = model.sheets.map(s => s.name);
  assert.equal(new Set(names).size, names.length, 'sayfa adları benzersiz olmalı');
});

test('v9.32 nesne hücreler JSON olur, "[object Object]" olmaz', () => {
  assert.equal(exporter.cellValue({ a: 1 }), '{"a":1}');
  assert.equal(exporter.cellValue([1, 2]), '[1,2]');
  assert.equal(exporter.cellValue(null), '');
  assert.equal(exporter.cellValue(undefined), '');
  assert.equal(exporter.cellValue(NaN), '', 'NaN Excel’de #SAYI/0! üretir');
  assert.equal(exporter.cellValue(Infinity), '');
  assert.equal(exporter.cellValue(0), 0, 'sıfır boş DEĞİLDİR');
  assert.equal(exporter.cellValue(false), false);
  // Excel hücre sınırının altında kalıp kırpıldığını belli et.
  const long = exporter.cellValue('x'.repeat(exporter.MAX_CELL + 500));
  assert.equal(long.length, exporter.MAX_CELL + 1);
  assert.match(long, /…$/);
});

test('v9.32 sayfa ve sütun sayısı sınırlı', () => {
  const calls = Array.from({ length: exporter.MAX_SHEETS + 5 },
    (_, i) => CALL('dataset.query', { source: 'k' + i, rows: [{ a: 1 }] }));
  const model = exporter.buildExportModel({ ...BASE, toolCalls: calls });
  assert.equal(model.tableCount, exporter.MAX_SHEETS);
  assert.equal(model.sheets.length, exporter.MAX_SHEETS + 1, 'rapor sayfası + tablolar');

  const wide = {};
  for (let i = 0; i < exporter.MAX_COLUMNS + 30; i += 1) wide['c' + i] = i;
  const wideModel = exporter.buildExportModel({ ...BASE, toolCalls: [CALL('dataset.query', { source: 'cp', rows: [wide] })] });
  assert.equal(wideModel.sheets[1].aoa[0].length, exporter.MAX_COLUMNS);
});

/* ================================================== 4) ÇIKTI SAKLAMA */

test('v9.32 başkasının çıktısı indirilemez', () => {
  /* Kimlik tahmin edilemez olsa bile TEK BAŞINA yeterli sayılmaz: kimliği
     ele geçiren biri, yetki katmanına hiç uğramadan başkasının kapsamındaki
     veriyi indirebilirdi. */
  const store = createExportStore();
  const id = store.put('u1', { sheets: [] });
  assert.ok(store.get('u1', id));
  assert.equal(store.get('u2', id), null, 'sahip olmayan okuyamaz');
  /* Sahiplik uyuşmazlığı, olmayan bir kayıttan AYIRT EDİLMEZ: "bu var ama
     senin değil" demek, başkasının çıktısının varlığını sızdırırdı. */
  assert.equal(store.get('u2', id), store.get('u2', 'olmayan-kimlik'));
});

test('v9.32 sahipsiz çıktı saklanmaz', () => {
  const store = createExportStore();
  assert.equal(store.put('', { sheets: [] }), null);
  assert.equal(store.put(null, { sheets: [] }), null);
  assert.equal(store.put('u1', null), null);
  assert.equal(store.size, 0);
});

test('v9.32 çıktı zaman aşımına uğrar', () => {
  let clock = 0;
  const store = createExportStore({ ttlMs: 1000, now: () => clock });
  const id = store.put('u1', { sheets: [] });
  clock = 999;
  assert.ok(store.get('u1', id));
  clock = 1001;
  assert.equal(store.get('u1', id), null, 'süresi geçen kayıt okunamaz');
  assert.equal(store.size, 0, 've depodan da düşer');
});

test('v9.32 depo sınırsız büyümez', () => {
  /* Kapaksız bir bellek deposu, uzun süre açık kalan bir sunucuda sessizce
     büyür ve bir gün süreci öldürür. */
  let n = 0;
  const store = createExportStore({ maxPerUser: 3, maxTotal: 5, newId: () => 'id' + (n += 1) });
  const mine = [];
  for (let i = 0; i < 6; i += 1) mine.push(store.put('u1', { sheets: [], i }));
  assert.equal(store.get('u1', mine[0]), null, 'en eski düşmeli');
  assert.ok(store.get('u1', mine[5]), 'en yeni durmalı');
  assert.ok(store.size <= 5);

  // Bir kullanıcının kapağı diğerinin kaydını düşürmemeli.
  const other = store.put('u2', { sheets: [] });
  assert.ok(store.get('u2', other));
});

/* ============================================ 5) BAĞLANTI (KAYNAK) */

const fsNode = require('node:fs');
const pathNode = require('node:path');
const readSource = rel => fsNode.readFileSync(pathNode.join(__dirname, '..', rel), 'utf8');
const SERVER = readSource('server/server.js');
const AGENT = readSource('server/lib/copilot-agent.js');
const CLIENT = readSource('public/copilot.js');

test('v9.32 çıktı modeli İSTEMCİYE GİTMEZ', () => {
  /* Araç satırlarının istemciye gönderilmemesi KASITLI bir karar
     (copilot-agent: toolCalls.map(({result, ...call}) => call)). Çıktı modeli
     o satırları taşıyor; cevaba iliştirmek kararı sessizce geri almak olurdu.
     Bu, daha önce 'origin' alanında yaşanan sızıntının aynı sınıfı. */
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/copilot/ask'"));
  const body = route.slice(0, route.indexOf("app.get('/api/status'"));
  assert.match(body, /const \{ exportModel, \.\.\.payload \} = result;/);
  assert.equal(/json\(result\)/.test(body), false, 'ham sonuç gönderilmemeli');
  assert.match(body, /octopusExports\.put\(req\.currentUser\.id, exportModel\)/);
  // İstemciye yalnız kimlik ve sayaçlar gider.
  assert.match(body, /export: \{ id: exportId, fileName: exportModel\.fileName, tableCount: exportModel\.tableCount, rowCount: exportModel\.rowCount \}/);
});

test('v9.32 model, sonuç ayıklanmadan ÖNCE üretilir', () => {
  /* Sonradan üretmek, satırları istemciye göndermek ya da soruyu yeniden
     koşturmak demekti. Sıra bozulursa toolCalls artık result taşımaz ve
     çıktı sessizce boşalır. */
  const at = AGENT.indexOf('const exportModel = octopusExport.buildExportModel(');
  const strip = AGENT.indexOf('toolCalls: toolCalls.map(({ result, ...call }) => call)');
  assert.ok(at > 0, 'çıktı modeli üretilmeli');
  assert.ok(at < strip, 'model, result ayıklanmadan önce üretilmeli');
  assert.match(AGENT.slice(at, at + 400), /toolCalls,/, 'ham toolCalls verilmeli');
});

test('v9.32 indirme ucu yetki ve sahiplik ARIYOR', () => {
  const at = SERVER.indexOf("app.get('/api/copilot/export/:exportId'");
  assert.ok(at > 0, 'indirme ucu yok');
  const route = SERVER.slice(at, SERVER.indexOf("app.post('/api/copilot/ask'", at));
  // Katman 1: alan yetkisi, diğer Copilot uçlarıyla aynı.
  assert.match(route, /userAccess\.requireAnyArea\('source', 'koleksiyon', 'cp', 'orders', 'overview'\)/);
  // Katman 2: depo, isteyenin SAHİBİ olduğunu doğrular.
  assert.match(route, /octopusExports\.get\(req\.currentUser\.id, req\.params\.exportId\)/);
  // Sahibi olmayan ile var olmayan aynı cevabı alır.
  assert.match(route, /404/);
  assert.match(route, /OCTOPUS_EXPORT_NOT_FOUND/);
  // İndirme kayda geçer: dosya kurumdan çıkabilir.
  assert.match(route, /'OCTOPUS_EXPORT'/);
  // Türkçe karakterli dosya adı başlığı bozmamalı.
  assert.match(route, /filename\*=UTF-8''/);
});

test('v9.32 istemci çıktıyı KENDİ BAŞINA uydurmaz', () => {
  /* Sunucu 'export' göndermediyse ortada araçtan gelmiş tablo yok demektir.
     Yine de bir indirme düğmesi çizmek, olmayan bir dayanağı varmış gibi
     göstermek olurdu. */
  const at = CLIENT.indexOf('function renderAssistantResponse(');
  const fn = CLIENT.slice(at, CLIENT.indexOf('\n  }', at));
  assert.match(fn, /const exportInfo=result&&result\.export;/);
  assert.match(fn, /exportInfo&&exportInfo\.id/);
  assert.match(fn, /\/api\/copilot\/export\/\$\{encodeURIComponent\(exportInfo\.id\)\}/);
});
