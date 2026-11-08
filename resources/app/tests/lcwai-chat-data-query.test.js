'use strict';
/* Sohbet akışı: veri isteğinde LCW AI yalnız plan yazar (source: data-query),
   Buyer Log tüm kayıtlar üzerinde hesaplar. 37 bin satırlık CSV LCW AI'a
   yüklenmez; rakamlar modelden gelmez; belirsizlikte soru sorulur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const SOURCES = ['canonical-fields.js', 'date-dimension.js', 'lcwai-data-query.js', 'lcwai-chat.js'].map(read);
const fixture = require('./helpers/merch-calendar-fixture');
const { extractFunction } = require('./helpers/app-main-functions');
const { installLifecycle } = require('./helpers/orders-retirement-source');
const fullGateSource = ['ordersProjectionIsThin', 'ordersFullActionError', 'ensureOrdersFullForAction']
  .map(name => extractFunction(read('app-main.js'), name)).join('\n');

function ordersTable() {
  const rows = [
    { _id: 1, Season: 'W6', 'Merch Alt Grup Kod': 'CU4E', Country: 'TÜRKİYE', 'Buyer Grup (TR)': 'Kids', 'Order Quantity': 100, 'In-Store (Model Budget)': new Date(2026, 7, 5), OPD: new Date(2026, 0, 10), 'Order Code': 'PO1' },
    { _id: 2, Season: 'W6', 'Merch Alt Grup Kod': 'CU4E', Country: 'BANGLADEŞ', 'Buyer Grup (TR)': 'Kids', 'Order Quantity': 250, 'In-Store (Model Budget)': new Date(2026, 7, 20), OPD: new Date(2026, 0, 20), 'Order Code': 'PO2' },
    { _id: 3, Season: 'W6', 'Merch Alt Grup Kod': 'CU4E', Country: 'ÇİN', 'Buyer Grup (TR)': 'Woman', 'Order Quantity': 400, 'In-Store (Model Budget)': new Date(2026, 8, 12), OPD: new Date(2026, 1, 14), 'Order Code': 'PO3' },
    { _id: 4, Season: 'S7', 'Merch Alt Grup Kod': 'CU4E', Country: 'ÇİN', 'Buyer Grup (TR)': 'Man', 'Order Quantity': 800, 'In-Store (Model Budget)': new Date(2027, 1, 1), OPD: new Date(2026, 5, 1), 'Order Code': 'PO4' },
  ];
  const col = (key, label, type) => ({ key, label, type, readValue: row => (row[key] instanceof Date ? row[key].toISOString().slice(0, 10) : String(row[key] ?? '')), rawValue: row => row[key] });
  const columns = [col('Season', 'Season', 'ro'), col('Merch Alt Grup Kod', 'Merch Alt Grup', 'ro'), col('Country', 'Country', 'ro'), col('Buyer Grup (TR)', 'Buying Group', 'ro'), col('Order Quantity', 'Order Qty', 'int'), col('In-Store (Model Budget)', 'In-Store', 'instoreEdit'), col('OPD', 'OPD', 'date'), col('Order Code', 'Order Code', 'ordercode')];
  return { rows, columns };
}

function load({ plans = [], storage = new Map(), ordersLoaded = true } = {}) {
  const calls = { ask: [], chat: [], uploads: [], tables: [], ensure: 0 };
  const queue = plans.slice();
  let loaded = ordersLoaded;
  const orders = ordersTable();
  const gateState = { orders: ordersLoaded ? { rows: orders.rows } : null };
  const api = {
    registerContextProvider() {}, getAvailableContext() { return [{ screen: 'orders', label: 'Siparişler', options: [{ id: 'orders:all', label: 'Tüm kayıtlar' }] }]; },
    async buildContext(id) { return { id, screen: 'orders', label: 'Siparişler — tüm kayıtlar', summary: '4 kayıt', columns: orders.columns.map(c => c.label), rows: orders.rows.map(r => orders.columns.map(c => c.readValue(r))), totalRows: 4 }; },
    async uploadFile(file) { calls.uploads.push(file.name); return { blobName: `b/${file.name}`, contentType: 'text/csv', fileName: file.name, size: file.size, url: '' }; },
    async ask(options) { calls.ask.push(JSON.parse(JSON.stringify({ source: options.source, task: options.task, context: options.context, guide: options.guide }))); const next = queue.shift(); return { data: next || null, structured: { ok: Boolean(next) }, model: { label: 'GPT-6 Sol' } }; },
    async chat(options) { calls.chat.push(JSON.parse(JSON.stringify({ message: options.message, contexts: options.contexts, attachments: options.attachments }))); return { chatId: 'c1', text: 'sohbet cevabı', output: options.output ? { id: 'o1', fileName: 'x.pdf' } : null }; },
    async createTableOutput(data, lang) { calls.tables.push({ data: JSON.parse(JSON.stringify(data)), lang }); return { id: 'xl1', fileName: 'sorgu.xlsx', format: 'xlsx', bytes: 10 }; },
    errorText(error) { return String(error && error.code || error); }, needsLogin() { return false; },
  };
  const window = {
    appLang: 'tr', BuyerLogAI: api, addEventListener() {},
    BLStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
    async BLEnsureOrdersLoaded(options) { calls.ensure++; assert.equal(options.deferRender, true, 'görünmeyen modül çizilmez'); loaded = true; gateState.orders = { rows: orders.rows }; return true; },
    BLAIScreenData: {
      lastTab: () => 'overview', pageTitle: tab => ({ orders: 'Siparişler', cp: 'CP Tracker' }[tab] || tab),
      table(tab, opts = {}) { if (tab !== 'orders' || !loaded) return null; return { tableKey: 'orders', rows: orders.rows, columns: orders.columns, selectedIds: [], filters: {}, rowId: row => row._id, all: Boolean(opts.all) }; },
      overviewCpRows: () => [], cpColumns: () => [],
    },
  };
  window.window = window;
  const context = vm.createContext({ window, globalThis: window, state: gateState, appLang: 'tr', ensureOrdersLoaded: options => window.BLEnsureOrdersLoaded(options), document: { documentElement: { lang: 'tr' }, getElementById() { return null; } }, File, console, Date, JSON, Map, Set, WeakMap, Intl, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0) });
  installLifecycle(context);
  vm.runInContext(fullGateSource + '\nwindow.BLEnsureOrdersFullForAction=ensureOrdersFullForAction;', context);
  SOURCES.forEach((source, index) => {
    vm.runInContext(source, context);
    // Tarayıcıdaki gibi: LCW Merch Calendar ortak tarih boyutuna yüklenmiş olur.
    if (index === 1) { window.BLDateDimension = window.BLDateDimension || context.BLDateDimension; window.BLDateDimension.setMerchCalendar(fixture.build()); }
  });
  return { chat: window.BLLcwAiChat, calls, storage, window };
}
const PIVOT = { mode: 'query', dataset: 'orders', specJson: JSON.stringify({ dataset: 'orders', filters: [{ field: 'MAG', values: ['CU4E'] }, { field: 'Season', values: ['w6'] }, { field: 'Country', op: 'not_in', values: ['Türkiye'] }], rows: [{ field: 'In-Store (Model Budget)', bucket: 'month' }], columns: [{ field: 'Buying Group' }], measures: [{ agg: 'sum', field: 'Order Quantity' }], title: 'MAG CU4E W6 — MB ayı × Buying Group' }), assumptions: ['MB = In-Store (Model Budget)'] };
const lastAnswer = chat => chat._state.conversations[0].messages.at(-1);

test('veri isteği: plan LCW AI’dan, rakam Buyer Log’dan; CSV yüklenmez, LCW AI sohbetine tablo gitmez', async () => {
  const { chat, calls } = load({ plans: [PIVOT] });
  chat._state.contexts = [{ id: 'orders:all', label: 'Siparişler — Tüm kayıtlar (4)' }];
  await chat.send('siparişlerden MAG CU4E’nin MB ayına göre W6 sezonunda Buying Group bazlı tablo, Türkiye hariç');
  assert.equal(calls.ask.length, 1);
  assert.equal(calls.ask[0].source, 'data-query');
  assert.match(calls.ask[0].guide, /"In-Store \(Model Budget\)" \| date/, 'planlayıcı alan şemasını görür');
  assert.match(calls.ask[0].guide, /"Order Code" \| text \| orderCode \| aka: [^\n]*\| examples: "PO1", "PO2", "PO3" … \(4 distinct\)/, 'kimlik alanında yalnız biçim örneği');
  assert.doesNotMatch(calls.ask[0].guide, /PO4/, 'kayıt satırları LCW AI’a gitmez');
  assert.equal(calls.chat.length, 0);
  assert.equal(calls.uploads.length, 0, '37 bin satırlık CSV yüklenmez');
  const answer = lastAnswer(chat);
  assert.equal(answer.error, undefined);
  assert.match(answer.text, /\| Ağustos 2026 \| 250 \|  \| 250 \|/, 'LCW ay adı');
  assert.match(answer.text, /\| Eylül 2026 \|  \| 400 \| 400 \|/);
  assert.ok(answer.query.lines.some(line => /Dönem: LCW Merch Calendar/.test(line)), 'hangi takvimle hesaplandığı görünür');
  assert.match(answer.text, /\*\*Toplam\*\* \| 250 \| 400 \| 650/);
  assert.ok(answer.query.lines.some(line => /Eşleşen: 2 \/ 4 kayıt/.test(line)));
  assert.ok(answer.query.notes.includes('MB = In-Store (Model Budget)'));
});

test('dağınık yazım, bağlam eklenmeden: Siparişler bulunur, veri çizilmeden yüklenir ve sorgu çalışır', async () => {
  const { chat, calls } = load({ plans: [PIVOT], ordersLoaded: false });
  await chat.send('günaydın bana ay bazlı sıparıs gecme tarıhlerını / model butce ayına göre w6 da cıkarabılır mısın');
  assert.equal(calls.ensure, 1);
  assert.equal(calls.ask.length, 1);
  assert.equal(calls.ask[0].context.today.length, 10);
  assert.ok(lastAnswer(chat).query, 'hesaplanmış cevap');
});

test('güncel gerçek tam-veri kapısı erişim iptalinde planlayıcıya veya sohbete veri göndermez', async () => {
  const { chat, calls, window } = load({ plans: [PIVOT] });
  window.BLCanAccessArea = () => false;
  await chat.send('sipariş W6 MB ayı tablo');
  assert.equal(calls.ask.length, 0);
  assert.equal(calls.chat.length, 0);
  assert.equal(calls.uploads.length, 0);
  assert.match(lastAnswer(chat).error, /ORDERS_FULL_FORBIDDEN/);
});

test('belirsizlikte tahmin edilmez: LCW AI sorusu seçeneklerle gösterilir, cevap önceki istekle birleştirilir', async () => {
  const clarify = { mode: 'clarify', question: 'Değer olarak sipariş adedi mi, PO sayısı mı?', options: ['Sipariş adedi', 'PO sayısı'] };
  const { chat, calls } = load({ plans: [clarify, PIVOT] });
  await chat.send('sıparıslerde w6 mb ayı bazlı tablo');
  const asked = lastAnswer(chat);
  assert.deepEqual([...asked.options], ['Sipariş adedi', 'PO sayısı']);
  assert.equal(asked.query, undefined);
  await chat.send(asked.options[0]);
  assert.equal(calls.ask.length, 2);
  assert.equal(calls.ask[1].context.previous.question, 'Değer olarak sipariş adedi mi, PO sayısı mı?');
  assert.equal(calls.ask[1].context.previous.request, 'sıparıslerde w6 mb ayı bazlı tablo');
  assert.ok(lastAnswer(chat).query);
});

test('veride olmayan değer: Buyer Log kendisi sorar, benzer değerleri seçenek yapar', async () => {
  const plan = { mode: 'query', specJson: JSON.stringify({ dataset: 'orders', filters: [{ field: 'MAG', values: ['CU4F'] }], rows: ['Season'], measures: [{ agg: 'sum', field: 'Order Quantity' }] }) };
  const { chat } = load({ plans: [plan] });
  await chat.send('sipariş CU4F toplam adet sezon bazlı');
  const answer = lastAnswer(chat);
  assert.equal(answer.query, undefined);
  assert.match(answer.text, /“CU4F”.*Merch Alt Grup/);
  assert.deepEqual([...answer.options], ['CU4E'], 'kod tek harf farkla otomatik düzeltilmez; aday sorulur');
});

test('sohbet sorusu ve geçersiz plan: sohbet yoluna düşer; plan bir kez düzeltilemezse tahmin gösterilmez', async () => {
  const one = load({ plans: [{ mode: 'chat' }] });
  one.chat._state.contexts = [{ id: 'orders:all', label: 'Siparişler' }];
  await one.chat.send('siparişlerden yönetici özeti yaz');
  assert.equal(one.calls.chat.length, 1, 'chat modu → mevcut sohbet yolu');
  const bad = { mode: 'query', specJson: JSON.stringify({ dataset: 'orders', measures: [{ agg: 'sum', field: 'Uydurma' }] }) };
  const two = load({ plans: [bad, bad] });
  await two.chat.send('sipariş toplam adet');
  assert.equal(two.calls.ask.length, 2, 'bir düzeltme turu');
  assert.ok(two.calls.ask[1].context.errors.includes('unknown-field:measure:Uydurma'), 'hata kodu düzeltme isteğine gider');
  assert.match(lastAnswer(two.chat).error, /tahmini bir rakam göstermemek için durdum/);
  assert.equal(two.calls.chat.length, 0);
});

test('Excel istenirse dosya Buyer Log hesabından oluşur (LCW AI’a gitmez); PDF için hesaplanmış tablo bağlam olur', async () => {
  const xl = load({ plans: [PIVOT] });
  xl.chat._state.output.format = 'xlsx';
  await xl.chat.send('sipariş MB ayı Buying Group tablosu excel');
  assert.equal(xl.calls.chat.length, 0);
  assert.equal(xl.calls.tables.length, 1);
  const sheet = xl.calls.tables[0].data.sheets[0];
  assert.deepEqual(sheet.rows.at(-1), ['Toplam', 250, 400, 650]);
  assert.equal(lastAnswer(xl.chat).file.fileName, 'sorgu.xlsx');
  const pdf = load({ plans: [PIVOT] });
  pdf.chat._state.output.format = 'pdf';
  await pdf.chat.send('sipariş MB ayı Buying Group tablosu pdf');
  assert.equal(pdf.calls.chat.length, 1);
  assert.equal(pdf.calls.chat[0].attachments.length, 0);
  assert.match(pdf.calls.chat[0].contexts[0].text, /Rakamları aynen kullan/);
  assert.equal(pdf.calls.uploads.length, 0);
});

test('takip sorusu: önceki plan planlayıcıya, hesaplanmış tablo sonraki sohbet mesajına bir kez gider', async () => {
  const { chat, calls } = load({ plans: [PIVOT, { mode: 'chat' }, { mode: 'chat' }] });
  await chat.send('sipariş W6 MB ayı tablo');
  await chat.send('bunu yorumla');
  assert.ok(calls.ask[1].context.previous.specJson.includes('"dataset":"orders"'), 'düzeltme için önceki plan');
  assert.equal(calls.chat.length, 1);
  assert.match(calls.chat[0].contexts.at(-1).text, /\| Ağustos 2026 \|/);
  await chat.send('kısaca özetle');
  assert.equal(calls.chat[1].contexts.length, 0, 'aynı tablo ikinci kez eklenmez');
});

test('geçmiş: yorum ve plan saklanır (veri satırı değil); yeniden açılınca Excel planı güncel veride yeniden çalıştırır', async () => {
  const storage = new Map();
  const first = load({ plans: [PIVOT], storage });
  await first.chat.send('sipariş W6 MB ayı tablo');
  const raw = storage.get('bl.lcwai.history.v1');
  assert.match(raw, /"query":\{"title":"MAG CU4E W6/);
  assert.match(raw, /"queryState":\{/);
  const second = load({ storage });
  assert.equal(second.chat.restoreConversations(), true);
  const index = second.chat._state.conversations[0].messages.length - 1;
  await second.chat.exportQuery(index);
  assert.equal(second.calls.tables.length, 1);
  assert.deepEqual(second.calls.tables[0].data.sheets[0].rows.at(-1), ['Toplam', 250, 400, 650]);
});

test('büyük bağlam dosyası: boş sütun atılır, sınır aşılırsa satırlar kısaltılır ve bu açıkça yazılır', async () => {
  const { chat } = load();
  const columns = ['A', 'Boş', 'B'];
  const rows = Array.from({ length: 2000 }, (_, i) => [`satır-${i}-${'x'.repeat(40)}`, '', i]);
  const whole = chat.contextAsFile({ label: 'Siparişler — tüm kayıtlar', columns, rows });
  assert.equal(whole.truncated, null);
  assert.match(whole.context.text, /2000 satır, 2 sütun \(A, B\)/, 'tamamen boş sütun atılır');
  const capped = chat.contextAsFile({ label: 'Siparişler — tüm kayıtlar', columns, rows }, { maxBytes: 20000 });
  assert.ok(capped.file.size <= 20000, `dosya sınırın altında: ${capped.file.size}`);
  assert.ok(capped.truncated.sent < 2000 && capped.truncated.total === 2000);
  assert.match(capped.context.text, /yalnız ilk \d+ \/ 2000 satırı/);
});
