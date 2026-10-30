'use strict';

/* Fiyat Masası — alternatif fiyatlar + tablodan üretici ekleme (v2026-10-30).

   1) Üretici aynı model için koşula bağlı birden çok fiyat verebilir (ör. kumaş
      gramajı / işçilik değişirse opsiyon 1, değişmezse opsiyon 2). Alternatifler
      satırda saklanır; en iyi teklif / onay / Koleksiyon yalnız ana fiyatı
      kullanır. Alternatif ana fiyat yapılınca önceki ana fiyat kaybolmaz.
   2) Send to Pricing kullanmadan fiyat veren üretici, quotation matrisinden
      eklenebilir; talepteki her model için boş fiyat satırı açılır.
   3) Alternatif alanlarını tanımayan eski istemcinin tam kaydı (PUT) mevcut
      alternatifleri silmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-quote-options-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const ledger = require(path.join(ROOT, 'server', 'lib', 'quotation-ledger.js'));
const E = require(path.join(ROOT, 'public', 'pricing-desk-engine.js'));
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const DESK = fs.readFileSync(path.join(ROOT, 'public', 'pricing-desk.js'), 'utf8');

const owner = { id: 'owner-1', role: 'user', displayName: 'Owner' };

function functionSource(source, name) {
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
    else if (source[j] === '}' && --depth === 0) return source.slice(start, j + 1);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* quotations.js içindeki gerçek fonksiyonlar, DOM/sunucu bağımlılıkları
   saplanarak çalıştırılır. */
function clientHarness(requests, { directory = [] } = {}) {
  const calls = { saves: [], prices: [] };
  const mfrKey = QUOTES.match(/const qMfrKey=.*;/)[0];
  const body = [
    "const qNorm=v=>String(v==null?'':v).trim();",
    "let seq=0;const qId=prefix=>`${prefix}-${++seq}`;",
    "const qNow=()=>'2026-10-30T10:00:00.000Z';",
    'const qMoneyNumber=v=>{const n=Number(qNorm(v).replace(",","."));return Number.isFinite(n)?n:NaN;};',
    'const qValidPrice=v=>{const n=qMoneyNumber(v);return Number.isFinite(n)&&n>0;};',
    'const qMoneyDisplay=v=>qMoneyNumber(v).toFixed(2);',
    'const qLoad=()=>({requests});',
    'const qCanEditRequest=()=>true,qCanEditLine=()=>true,qViewOnlyNotice=()=>{},qTrackOwners=r=>r;',
    'const qSave=req=>{calls.saves.push(JSON.parse(JSON.stringify(req)));return true;};',
    'const qWithLineSource=(source,work)=>work();',
    'const qApplyPrice=(req,line,value)=>{calls.prices.push({lineId:line.id,value});line.price=value;return value;};',
    mfrKey,
    functionSource(QUOTES, 'qNormalizeOptions'),
    functionSource(QUOTES, 'qManufacturerSuggestions'),
    functionSource(QUOTES, 'qAddManufacturerLines'),
    functionSource(QUOTES, 'qSaveLineOptions'),
    functionSource(QUOTES, 'qPromoteLineOption'),
    'return {qAddManufacturerLines,qSaveLineOptions,qPromoteLineOption,qManufacturerSuggestions};',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('requests', 'calls', 'kolManufacturers', body)(requests, calls, directory);
  return { api, calls };
}

const baseLine = (id, modelKey, manufacturer, price = '') => ({ id, modelKey, rowId: Number(modelKey.split(':')[1]), modelCode: `M-${modelKey}`, plmId: `P-${modelKey}`, manufacturer, manufacturerEmail: '', price, approved: false, dropped: false, rev: 2, history: [{ type: 'offer' }], options: [] });

test('sunucu alternatifleri normalize eder ve sınırlar', () => {
  const request = store.normalizeRequest({ id: 'q-norm', ownerId: 'o', manufacturers: [{ name: 'A' }], items: [{
    id: 'l1', modelKey: 'kol:1', manufacturer: 'A', price: '4.15', priceLabel: '  Standart ', priceNote: 'mevcut gramaj',
    options: [{ id: 'o1', label: 'Opsiyon 1', price: '3.90', note: '160 gr' }, { label: '', price: '', note: '' }, ...Array.from({ length: 12 }, (_, i) => ({ label: `x${i}`, price: '1' }))],
  }] });
  const line = request.items[0];
  assert.equal(line.priceLabel, 'Standart');
  assert.equal(line.priceNote, 'mevcut gramaj');
  assert.deepEqual(line.options[0], { id: 'o1', label: 'Opsiyon 1', price: '3.90', note: '160 gr' });
  assert.ok(line.options.length <= 10, 'en fazla 10 alternatif');
  assert.ok(line.options.every(option => option.id && (option.label || option.price || option.note)), 'boş alternatif atılır, kimlik verilir');
});

test('eski istemcinin tam kaydı alternatifleri silmez; yeni istemci boş liste ile siler', () => {
  const created = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [
    { id: 'l1', modelKey: 'kol:1', manufacturer: 'A', price: '4.15', priceLabel: 'Standart', options: [{ id: 'o1', label: 'Opsiyon 1', price: '3.90', note: '160 gr' }] },
  ] });
  assert.equal(created.items[0].options.length, 1);
  const legacyItem = { ...created.items[0] };
  delete legacyItem.options; delete legacyItem.priceLabel; delete legacyItem.priceNote;
  const afterLegacy = store.updateRequest(owner, created.id, { ...created, note: 'not', items: [legacyItem] });
  assert.equal(afterLegacy.items[0].options.length, 1, 'alternatif korunmalı');
  assert.equal(afterLegacy.items[0].priceLabel, 'Standart');
  assert.equal(afterLegacy.note, 'not');
  const cleared = store.updateRequest(owner, created.id, { ...afterLegacy, items: [{ ...afterLegacy.items[0], options: [], priceLabel: '' }] });
  assert.equal(cleared.items[0].options.length, 0, 'bilinçli silme uygulanmalı');
  assert.equal(cleared.items[0].priceLabel, '');
});

test('başka kullanıcı ana fiyatı değiştirdiyse eski revizyonlu kayıt etiket ve alternatifleri ezmez', () => {
  const created = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [
    { id: 's1', modelKey: 'kol:5', manufacturer: 'A', price: '4.15', priceLabel: 'Standart', options: [{ id: 'o1', label: 'Opsiyon 1', price: '3.85' }] },
  ] });
  const staleRev = created.items[0].rev;
  // Kullanıcı 1 alternatifi ana fiyat yaptı: yapı kaydı + fiyat satır olayı.
  const swapped = store.updateRequest(owner, created.id, { ...created, items: [{ ...created.items[0], priceLabel: 'Opsiyon 1', options: [{ id: 'o1', label: 'Standart', price: '4.15' }] }] });
  store.patchLine(owner, created.id, 's1', { price: '3.85', baseRev: swapped.items[0].rev });
  // Kullanıcı 2 eski kopyasıyla yalnız notu değiştirdi.
  const stale = store.updateRequest(owner, created.id, { ...created, note: 'kapasite teyit', items: [{ ...created.items[0], rev: staleRev }] });
  const line = stale.items[0];
  assert.equal(stale.note, 'kapasite teyit');
  assert.equal(line.price, '3.85');
  assert.equal(line.priceLabel, 'Opsiyon 1');
  assert.deepEqual(line.options.map(option => [option.label, option.price]), [['Standart', '4.15']], 'yer değiştiren fiyat kaybolmaz');
});

test('yeni satır PUT ile eklenir ve deftere işlenir; alternatif değişikliği fiyat defterine olay yazmaz', () => {
  const created = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'kol:7', manufacturer: 'A', price: '5' }] });
  const before = created.items[0].history.length;
  const added = { ...created.items[0], id: 'l2', manufacturer: 'B', price: '4.80', history: [], rev: 0, options: [] };
  const updated = store.updateRequest(owner, created.id, { ...created, manufacturers: [{ name: 'A' }, { name: 'B' }], items: [{ ...created.items[0], options: [{ id: 'x', label: 'Opsiyon 1', price: '4.50' }] }, added] });
  const lineB = updated.items.find(item => item.id === 'l2');
  assert.equal(lineB.manufacturer, 'B');
  assert.equal(lineB.history.filter(event => event.type === 'offer').length, 1, 'yeni satırın ilk fiyatı deftere yazılır');
  assert.equal(updated.items[0].history.length, before, 'alternatif eklemek fiyat olayı üretmez');
  assert.equal(updated.items[0].options[0].price, '4.50');
});

test('talep birleştirme ve cihaz birleşimi alternatifleri / ana fiyat etiketini kaybetmez', () => {
  const a = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [{ id: 'm1', modelKey: 'kol:9', manufacturer: 'A', price: '' }] });
  const b = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [{ id: 'm2', modelKey: 'kol:9', manufacturer: 'A', price: '6', priceLabel: 'Standart', options: [{ id: 'o', label: 'Opsiyon 1', price: '5.5' }] }] });
  const merged = store.mergeRequests(owner, b.id, a.id);
  const line = (merged.target || merged.request || merged).items.find(item => item.modelKey === 'kol:9');
  assert.equal(line.price, '6');
  assert.equal(line.priceLabel, 'Standart');
  assert.equal(line.options.length, 1);

  const older = { id: 'r', updatedAt: '2026-10-30T10:00:00.000Z', items: [{ id: 'x', price: '4', priceLabel: 'Eski', updatedAt: '2026-10-30T09:00:00.000Z', history: [], rev: 1 }] };
  const newer = { id: 'r', updatedAt: '2026-10-30T11:00:00.000Z', items: [{ id: 'x', price: '5', priceLabel: 'Yeni', updatedAt: '2026-10-30T08:00:00.000Z', history: [], rev: 1 }] };
  const copy = ledger.mergeRequestCopies(older, newer);
  assert.equal(copy.items[0].price, '4', 'satır fiyatı en yeni satır değişikliğinden gelir');
  assert.equal(copy.items[0].priceLabel, 'Eski', 'etiket fiyatla birlikte taşınır');
});

test('motor alternatifleri okur ama en iyi teklif yalnız ana fiyattan hesaplanır', () => {
  const lines = [
    { id: 'a', manufacturer: 'A', price: '4.15', options: [{ id: 'o1', label: 'Opsiyon 1', price: '3,20', note: '160 gr' }, { label: '', price: '', note: '' }] },
    { id: 'b', manufacturer: 'B', price: '4.22', options: [] },
  ];
  const options = E.lineOptions(lines[0]);
  assert.equal(options.length, 1);
  assert.equal(options[0].value, 3.2);
  assert.deepEqual(E.lineOptions({}), []);
  const stats = E.rowStats(lines);
  assert.equal(stats.best.lineId, 'a');
  assert.equal(stats.best.price, 4.15, 'alternatif (3,20) en iyi teklif sayılmaz');
});

test('tablodan üretici ekleme her model için boş satır açar, tekrar eklemez', () => {
  const req = { id: 'q1', manufacturers: [{ name: 'Studio Stitch' }, { name: 'Sakthi' }], items: [
    baseLine('l1', 'kol:1', 'Studio Stitch', '4.15'), baseLine('l2', 'kol:1', 'Sakthi', '4.22'),
    baseLine('l3', 'kol:2', 'Studio Stitch', '3.10'),
  ] };
  const { api, calls } = clientHarness([req], { directory: [{ name: 'A-ONE POLAR LTD.', email: 'quote@aone.test' }] });
  const result = api.qAddManufacturerLines(req, { name: '  a-one polar ltd. ' });
  assert.equal(result.manufacturer.name, 'A-ONE POLAR LTD.', 'Koleksiyon üretici listesindeki yazım kullanılır');
  assert.equal(result.manufacturer.email, 'quote@aone.test');
  assert.equal(result.added.length, 2);
  assert.deepEqual(result.added.map(line => line.modelKey), ['kol:1', 'kol:2']);
  result.added.forEach(line => {
    assert.equal(line.price, ''); assert.equal(line.approved, false); assert.equal(line.rev, 0);
    assert.deepEqual(line.history, []); assert.deepEqual(line.options, []);
    assert.equal(line.modelCode, `M-${line.modelKey}`, 'model kimliği kopyalanır');
  });
  assert.equal(req.manufacturers.length, 3);
  assert.equal(calls.saves.length, 1, 'tek tam kayıt');

  const again = api.qAddManufacturerLines(req, { name: 'A-ONE POLAR LTD.' });
  assert.equal(again.added.length, 0);
  assert.equal(calls.saves.length, 1, 'değişiklik yoksa kayıt yok');

  const single = api.qAddManufacturerLines(req, { name: 'Sakthi' }, { modelKeys: ['kol:2'] });
  assert.equal(single.added.length, 1, 'boş hücre yalnız o model için satır açar');
  assert.equal(single.added[0].modelKey, 'kol:2');
  assert.equal(req.manufacturers.filter(item => item.name === 'Sakthi').length, 1);
});

test('alternatif ana fiyat yapılınca önceki ana fiyat alternatif olarak kalır', () => {
  const line = { ...baseLine('l1', 'kol:1', 'Studio Stitch', '4.15'), priceLabel: 'Standart', priceNote: 'mevcut gramaj' };
  const req = { id: 'q1', manufacturers: [{ name: 'Studio Stitch' }], items: [line] };
  const { api, calls } = clientHarness([req]);
  assert.equal(api.qSaveLineOptions(req, line, { priceLabel: 'Standart', priceNote: 'mevcut gramaj', options: [{ id: 'o1', label: 'Opsiyon 1', price: '3,9', note: '160 gr' }, { label: '', price: '', note: '' }] }), true);
  assert.equal(line.options.length, 1);
  assert.equal(line.options[0].price, '3.90', 'fiyat ortak para biçimine çevrilir');

  assert.equal(api.qPromoteLineOption(req, line, 'o1'), true);
  assert.deepEqual(calls.prices, [{ lineId: 'l1', value: '3.90' }], 'ana fiyat ortak fiyat yolundan (defter) yazılır');
  assert.equal(line.price, '3.90');
  assert.equal(line.priceLabel, 'Opsiyon 1');
  assert.equal(line.priceNote, '160 gr');
  assert.deepEqual(line.options, [{ id: 'o1', label: 'Standart', price: '4.15', note: 'mevcut gramaj' }], 'önceki ana fiyat saklanır');

  assert.equal(api.qPromoteLineOption(req, line, 'missing'), false);
  line.options.push({ id: 'bad', label: 'Fiyatsız', price: '', note: '' });
  assert.equal(api.qPromoteLineOption(req, line, 'bad'), false, 'fiyatsız alternatif ana fiyat olamaz');
});

test('istemci normalizasyonu ve masa API sözleşmesi', () => {
  assert.match(QUOTES, /priceLabel:qNorm\(item\.priceLabel\)\.slice\(0,120\),priceNote:qNorm\(item\.priceNote\)\.slice\(0,500\),options:qNormalizeOptions\(item\.options\)/);
  for (const name of ['manufacturerSuggestions', 'addManufacturer', 'saveLineOptions', 'promoteOption']) assert.match(QUOTES, new RegExp(`\\b${name}[:(]`), `desk API ${name}`);
  // Matris: başlıkta üretici ekleme, boş hücreden satır, hücreden alternatif paneli ve O kısayolu.
  assert.match(DESK, /data-pd-add-mfr/);
  assert.match(DESK, /data-pd-add-line=/);
  assert.match(DESK, /data-pd-options=/);
  assert.match(DESK, /if\(key==='o'\)/);
  assert.match(DESK, /api\.addManufacturer\(req,\{name:typed,email:clean\(email\.value\)\}\)/);
  assert.match(DESK, /api\.promoteOption\(req,line,id,'matrix'\)/);
  // Ortak Motion+ API'si kullanılır; ayrı animasyon motoru yok.
  assert.match(DESK, /BLMotionPlus\?\.play\?\.\('card',panel\)/);
});
