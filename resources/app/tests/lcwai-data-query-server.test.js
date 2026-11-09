'use strict';
/* Sunucu: data-query sözleşmesi (planlayıcı istemi), LCW AI bilgisindeki MB
   tanımı ve Buyer Log'un hesapladığı tablonun LCW AI'sız Excel'e dönüşmesi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const prompts = require(path.join(ROOT, 'server', 'lib', 'lcwai', 'lcwai-prompt'));
const knowledge = require(path.join(ROOT, 'server', 'lib', 'lcwai', 'lcwai-knowledge'));
const { createOutputService } = require(path.join(ROOT, 'server', 'lib', 'lcwai-output', 'output-service'));
const Q = require(path.join(ROOT, 'public', 'lcwai-data-query.js'));

test('planlayıcı istemi: dağınık Türkçe, Buyer Log sözlüğü, netleştirme izni ve şema rehberi', () => {
  const built = prompts.buildPrompt({ source: 'data-query', task: 'günaydın bana ay bazlı sıparıs gecme tarıhlerını / model butce ayına göre w6 da cıkarabılır mısın', guide: 'DATASET "orders" — Siparişler', context: { today: '2026-11-06' }, lang: 'tr' });
  assert.equal(built.contract, 'data-query');
  assert.match(built.prompt, /MB = Model Bütçe = the In-Store \(Model Budget\) date/);
  assert.match(built.prompt, /sıparıs = sipariş, gecme = geçme, butce = bütçe/);
  assert.match(built.prompt, /mode="clarify" ONLY when/);
  assert.match(built.prompt, /never compute, estimate or invent numbers/);
  assert.match(built.prompt, /include EVERY requested measure/);
  assert.match(built.prompt, /weighted_avg.*weightField/);
  assert.match(built.prompt, /MUST NOT replace weighted_avg/);
  assert.match(built.prompt, /=== MODÜL REHBERİ ===\nDATASET "orders"/);
  assert.doesNotMatch(built.prompt, /Soru sorma; en iyi cevabını ver/, 'veri sorgusu gerçekten belirsizse sorabilir');
  // Diğer sözleşmeler soru sormamaya devam eder.
  assert.match(prompts.buildPrompt({ source: 'rules', task: 'x', lang: 'tr' }).prompt, /Soru sorma; en iyi cevabını ver/);
});

test('plan nesne ya da metin olarak gelebilir; sözleşme dışı tür reddedilir', () => {
  const asObject = prompts.parseStructured(JSON.stringify({ mode: 'query', dataset: 'orders', specJson: { dataset: 'orders', measures: [{ agg: 'count' }] }, assumptions: ['x'] }), 'data-query');
  assert.equal(asObject.ok, true);
  assert.equal(JSON.parse(asObject.data.specJson).dataset, 'orders');
  const clarify = prompts.parseStructured('{"mode":"clarify","question":"Adet mi PO sayısı mı?","options":["Adet","PO sayısı"]}', 'data-query');
  assert.deepEqual(clarify.data.options, ['Adet', 'PO sayısı']);
  assert.equal(prompts.parseStructured('{"question":"?"}', 'data-query').ok, false, 'mode zorunlu');
});

test('LCW AI bilgisi: MB, Ex-Factory ile karıştırılmaz', () => {
  for (const lang of ['tr', 'en']) {
    const text = knowledge.globalKnowledge(lang);
    assert.doesNotMatch(text, /MB \/ Ex-Factory/);
    assert.match(text, /MB = Model (Bütçe|Budget) = (the )?In-Store \(Model Budget\)/);
  }
});

test('hesaplanmış tablo → Excel: LCW AI çağrılmaz, değerler birebir, satır kırpılması reddedilir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-dq-'));
  const engine = { chat() { throw new Error('LCW AI çağrılmamalı'); } };
  const service = createOutputService({ engine, storeOptions: { root: path.join(dir, 'ai-outputs') } });
  const result = { columns: [{ label: 'MB (ay)', kind: 'text' }, { label: 'Kids', kind: 'number' }], rows: [['2026-08', 250], ['2026-09', null]], total: ['Toplam', 250] };
  const workbook = Q.toWorkbook(result, { title: 'MAG CU4E W6', lines: ['Veri: Siparişler — tüm kayıtlar'], lang: 'tr' });
  const output = (await service.createTable('u1', { data: workbook, lang: 'tr' }));
  assert.equal(output.format, 'xlsx');
  assert.match(output.draftId, /^[a-f0-9]{24}$/, 'düzenlenebilir taslak');
  const file = fs.readdirSync(path.join(dir, 'ai-outputs'), { recursive: true }).map(String).find(name => name.endsWith('.xlsx'));
  const book = XLSX.readFile(path.join(dir, 'ai-outputs', file));
  const sheet = book.Sheets[book.SheetNames.find(name => /Sonuç/.test(name))];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.deepEqual(rows.at(-1), ['Toplam', 250]);
  assert.ok(rows.some(row => row[0] === '2026-08' && row[1] === 250));
  const tooMany = { title: 'x', sheets: [{ name: 'a', columns: [{ header: 'n', type: 'number' }], rows: Array.from({ length: 5001 }, (_, i) => [i]) }] };
  assert.throws(() => service.createTable('u1', { data: tooMany }), error => error.code === 'LCWAI_OUTPUT_EDIT_INVALID');
});

test('rota: /api/lcwai/outputs/table yalnız Buyer Log tablosunu kabul eder', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'lcwai-routes.js'), 'utf8');
  assert.match(routes, /app\.post\('\/api\/lcwai\/outputs\/table', express\.json\(\{ limit: '24mb' \}\)/);
  assert.match(routes, /await outputsOf\(\)\.createTable\(ownerOf\(req\), \{ data: body\.data, lang: body\.lang,assertCurrent \}\)/);
});

test('LCW AI bilgisi: Merch Calendar gerçek takvimden türetilir; bugünkü LCW dönemi ve ay aralıkları verilir', () => {
  const DD = require(path.join(ROOT, 'public', 'date-dimension.js'));
  const fixture = require('./helpers/merch-calendar-fixture');
  DD.setMerchCalendar(fixture.build());
  try {
    const tr = knowledge.merchCalendarKnowledge('tr', { now: new Date(2026, 8, 30) });
    assert.match(tr, /Bugün \(2026-09-30\) LCW 2026 yılı, Ekim ayı \(LCW ay 2026-10\), LCW 40\. hafta \(2026-09-28 … 2026-10-04\)/, '30 Eylül LCW Ekim’dir');
    assert.match(tr, /LCW 2026: Ocak 2025-12-29…2026-01-25 \(hf 1–4\);/);
    assert.match(tr, /LCW 2027: Ocak 2026-12-28…/);
    assert.match(tr, /miladi ayına bakarak eşleme/);
    const en = knowledge.merchCalendarKnowledge('en', { now: new Date(2026, 8, 30) });
    assert.match(en, /Today \(2026-09-30\) is LCW 2026, October \(LCW month 2026-10\), LCW week 40/);
    // Hem planlayıcıya hem genel sohbete gider.
    assert.match(prompts.buildPrompt({ source: 'data-query', task: 'bu ay sipariş adedi', lang: 'tr' }).prompt, /=== BUYER LOG BİLGİSİ ===[\s\S]*LCW Merch Calendar:[\s\S]*LCW 2026: Ocak/);
    assert.match(prompts.buildChatPrompt({ message: 'bu ayın siparişlerini yorumla', lang: 'tr' }).prompt, /LCW Merch Calendar:[\s\S]*Bugün \(/);
    assert.match(prompts.buildPrompt({ source: 'data-query', task: 'x', lang: 'en' }).prompt, /"YYYY-MM" = LCW month[\s\S]*"calendar":"gregorian" in specJson ONLY when the user explicitly asks/);
  } finally { DD.clearMerchCalendar(); }
  assert.match(knowledge.merchCalendarKnowledge('tr'), /Merch Calendar Buyer Log'a YÜKLENMEMİŞ; kesin LCW dönemleri bilinmiyor: LCW ay veya haftası tahmin etme/);
});
