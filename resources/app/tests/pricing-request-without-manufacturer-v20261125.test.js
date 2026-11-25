'use strict';

/* Send to Pricing — üretici seçmeden Fiyat Masası talebi (v2026-11-25).

   1) "Yalnız Fiyat Masası'na Gönder" üretici seçilmeden de talep açar. Satırlar
      model × üretici olduğundan modeller talebin `models` listesinde taşınır.
   2) Fiyat Masası'nda sonradan elle (ASAS listesinde olmayan ad dahil) eklenen
      üretici her model için boş fiyat satırı açar; model bekleyen listeden düşer.
   3) `models` alanını tanımayan eski istemcinin tam kaydı bekleyen modelleri silmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-no-mfr-request-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const { createQuotationVisibility } = require(path.join(ROOT, 'server', 'lib', 'quotation-visibility.js'));
const E = require(path.join(ROOT, 'public', 'pricing-desk-engine.js'));
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const DESK = fs.readFileSync(path.join(ROOT, 'public', 'pricing-desk.js'), 'utf8');

const owner = { id: 'owner-1', role: 'user', displayName: 'Owner' };
const seed = (n, extra = {}) => ({ modelKey: `kol:${n}`, rowId: n, modelCode: `M-${n}`, plmId: `P-${n}`, orderCode: '', targetPrice: '4.00', ...extra });

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

function clientHarness(requests, directory = []) {
  const calls = { saves: [] };
  const body = [
    "const qNorm=v=>String(v==null?'':v).trim();",
    "let seq=0;const qId=prefix=>`${prefix}-${++seq}`;",
    "const qNow=()=>'2026-11-25T10:00:00.000Z';",
    'const qLoad=()=>({requests});',
    'const qCanEditRequest=()=>true,qViewOnlyNotice=()=>{},qTrackOwners=r=>r;',
    'const qSave=req=>{calls.saves.push(JSON.parse(JSON.stringify(req)));return true;};',
    QUOTES.match(/const qMfrKey=.*;/)[0],
    QUOTES.match(/const Q_MODEL_FIELDS=.*;/)[0],
    functionSource(QUOTES, 'qNumOrNull'),
    functionSource(QUOTES, 'qModelSeed'),
    functionSource(QUOTES, 'qNormalizeModels'),
    functionSource(QUOTES, 'qPruneModels'),
    functionSource(QUOTES, 'qManufacturerSuggestions'),
    functionSource(QUOTES, 'qAddManufacturerLines'),
    'return {qAddManufacturerLines,qNormalizeModels};',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return { api: new Function('requests', 'calls', 'kolManufacturers', body)(requests, calls, directory), calls };
}

test('sunucu üreticisiz talebi modelleriyle saklar; eski istemci kaydı modelleri silmez', () => {
  const created = store.createRequest(owner, { source: 'collection', manufacturers: [], items: [], models: [seed(1), seed(2), seed(1)] });
  assert.deepEqual(created.models.map(m => m.modelKey), ['kol:1', 'kol:2'], 'yinelenen model tekilleşir');
  assert.equal(created.items.length, 0);
  assert.equal(created.models[0].modelCode, 'M-1');
  assert.ok(!('manufacturer' in created.models[0]), 'bekleyen model üretici/fiyat alanı taşımaz');

  const legacy = { ...created, note: 'eski istemci' }; delete legacy.models;
  const afterLegacy = store.updateRequest(owner, created.id, legacy);
  assert.equal(afterLegacy.note, 'eski istemci');
  assert.deepEqual(afterLegacy.models.map(m => m.modelKey), ['kol:1', 'kol:2'], 'models alanı olmayan PUT bekleyen modelleri korur');

  const line = { id: 'l1', modelKey: 'kol:1', rowId: 1, manufacturer: 'Yeni Atölye', price: '' };
  const withLine = store.updateRequest(owner, created.id, { ...afterLegacy, manufacturers: [{ name: 'Yeni Atölye' }], items: [line] });
  assert.deepEqual(withLine.models.map(m => m.modelKey), ['kol:2'], 'satırı açılan model bekleyen listeden düşer');
  assert.equal(withLine.items[0].manufacturer, 'Yeni Atölye');

  const reloaded = store.loadStore().requests.find(r => r.id === created.id);
  assert.deepEqual(reloaded.models.map(m => m.modelKey), ['kol:2'], 'diske yazılır');
});

test('birleştirme bekleyen modelleri korur, satırı olanları tekrarlamaz', () => {
  const a = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }], items: [{ id: 'a1', modelKey: 'kol:10', manufacturer: 'A' }] });
  const b = store.createRequest(owner, { source: 'collection', manufacturers: [], items: [], models: [seed(10), seed(11)] });
  const merged = store.mergeRequests(owner, b.id, a.id).request;
  assert.deepEqual(merged.models.map(m => m.modelKey), ['kol:11']);
  assert.equal(merged.items.length, 1);
});

test('CP görünürlüğü bekleyen modellerin siparişlerini de okur', () => {
  const visibility = createQuotationVisibility({ canEdit: () => false, hasPermission: () => false, authoritativeOrderRows: code => (code === 123 ? [{ code }] : []), canEditOrder: () => true });
  assert.equal(visibility.visibleTo({ id: 'x' }, { source: 'cp', items: [], models: [{ modelKey: 'cp:1', orderCode: '123' }] }), true);
  assert.equal(visibility.visibleTo({ id: 'x' }, { source: 'cp', items: [], models: [] }), false);
});

test('matris motoru bekleyen modelleri boş hücreli satır olarak gösterir', () => {
  const request = { manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'kol:1', manufacturer: 'A', price: '4' }], models: [seed(1), seed(2)] };
  const matrix = E.requestMatrix(request);
  assert.deepEqual(matrix.models.map(m => m.modelKey), ['kol:1', 'kol:2'], 'satırlı model önce, bekleyen model tekrarsız sonra');
  assert.equal(matrix.models[1].cell('A'), null);
  assert.equal(matrix.models[1].lines.length, 0);
  assert.equal(E.rowStats(matrix.models[1].lines).best, null);
  const empty = E.requestMatrix({ manufacturers: [], items: [], models: [seed(3)] });
  assert.deepEqual(empty.manufacturers, []);
  assert.equal(empty.models[0].first.modelCode, 'M-3');
});

test('masadan eklenen yeni (listede olmayan) üretici her bekleyen model için satır açar', () => {
  const req = { id: 'q1', manufacturers: [], items: [], models: [seed(1), seed(2)] };
  const { api, calls } = clientHarness([req], [{ name: 'ASAS Üretici', email: 'asas@example.com' }]);
  const result = api.qAddManufacturerLines(req, { name: '  Anlık Atölye  ' });
  assert.equal(result.manufacturer.name, 'Anlık Atölye', 'ASAS listesinde olmayan ad olduğu gibi kabul edilir');
  assert.deepEqual(result.added.map(line => line.modelKey), ['kol:1', 'kol:2']);
  assert.ok(result.added.every(line => line.price === '' && line.approved === false && line.modelCode), 'satır model bilgisiyle ve boş fiyatla açılır');
  assert.deepEqual(req.models, [], 'bekleyen modeller satıra dönüşünce listeden düşer');
  assert.deepEqual(req.manufacturers.map(m => m.name), ['Anlık Atölye']);
  assert.equal(calls.saves.length, 1);
  assert.deepEqual(calls.saves[0].models, [], 'tam kayıt boş models listesiyle gider');

  // Tek hücre ekleme yalnız istenen modeli açar.
  const req2 = { id: 'q2', manufacturers: [], items: [], models: [seed(5), seed(6)] };
  const h2 = clientHarness([req2]);
  const one = h2.api.qAddManufacturerLines(req2, { name: 'B' }, { modelKeys: ['kol:6'] });
  assert.deepEqual(one.added.map(line => line.modelKey), ['kol:6']);
  assert.deepEqual(req2.models.map(m => m.modelKey), ['kol:5']);
});

test('istemci sözleşmesi: üreticisiz talep, model sayısı ve matris varsayılanı', () => {
  const record = functionSource(QUOTES, 'recordRequest');
  assert.match(record, /if\(!safeRows\.length\)return null;/, 'üretici zorunlu değil');
  assert.match(record, /if\(!safeMfrs\.length\)\{req\.models\.push\(qModelSeed\(base\)\);return;\}/);
  assert.match(QUOTES, /models:qNormalizeModels\(req\?\.models\)/, 'istemci normalizasyonu models alanını korur');
  assert.match(QUOTES, /manufacturers:req\.manufacturers,models:req\.models\|\|\[\]/, 'models değişikliği tam kayıt tetikler');
  assert.match(functionSource(QUOTES, 'qModelCount'), /req\.models/);
  assert.match(functionSource(DESK, 'detailView'), /req\.models/, 'satırsız talep matriste açılır');
  assert.match(DESK, /listede olmayan yeni bir üretici adı yaz/);
  assert.match(DESK, /type a new manufacturer name that is not listed/);
});
