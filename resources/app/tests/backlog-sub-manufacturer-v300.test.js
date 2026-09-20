'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const backlog = require('../public/backlog-excel-formulas.js');

function loadParseWithoutXlsx() {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'xlsx') return { SSF: {}, utils: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve('../server/lib/parse');
    delete require.cache[resolved];
    return require('../server/lib/parse');
  } finally { Module._load = originalLoad; }
}

function order(code, manufacturer, license = '') {
  return {
    ocode: code, colour: 'Siyah', kalan: 10, qty: 20, antrepo: 0,
    license, manufacturer, season: 'W6', countryRaw: 'TURKIYE',
    buyerGrup: 'ÖRME', merch: 'CU4E', category: 'T-Shirt', ozel: '', plm: 1,
    model: 'MODEL', ccode: '001', fob: 5, opd: new Date(2026, 5, 1),
    ex: new Date(2026, 6, 10), retail: new Date(2026, 8, 30), mb: new Date(2026, 9, 15),
    shipConf: null, ageGroup: '', buyer: '', line: '', merkezSevkeHazirKalan: 0,
    karisim: '', iplikNo: '', kumasTipi: '', fabricWeight: '',
  };
}
function overrides(submap) {
  return { apprmap: {}, submap: submap || {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, pricingRules: [], transitRules: [], nonDtrManufacturers: [] };
}

test('Backlog inserts Alt Üretici immediately after Üretici and keeps it visible', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(server, /'Üretici','Alt Üretici','Line'/);
  const visible = [...backlog.DEFAULT_VISIBLE_HEADERS];
  const manufacturerIndex = visible.indexOf('Üretici');
  assert.ok(manufacturerIndex >= 0);
  assert.equal(visible[manufacturerIndex + 1], 'Alt Üretici');
  assert.deepEqual(backlog.columnSpec('Alt Üretici'), { hidden: false });
});

// Kullanıcı kararı (v5.06 kuralı doğru, kod zaten bunu uyguluyor):
// Non-DTR siparişte Alt Üretici yalnız kullanıcının girdiği Sub Mfr değeridir —
// boşsa Manufacturer'a DÜŞMEZ, boş kalır. DTR siparişte ise Alt Üretici = Manufacturer.
test('Backlog Alt Üretici: Non-DTR yalnız kullanıcı girdisini kullanır (Manufacturer\'a düşmez), DTR ise Manufacturer=Sub Mfr', () => {
  const parse = loadParseWithoutXlsx();
  const mapped = parse.buildBacklogTemplateRows([order(1001, 'Ana Fabrika')], {}, overrides({1001:'Alt Fabrika'}), [1001])[0];
  assert.equal(mapped['Alt Üretici'], 'Alt Fabrika');
  // Non-DTR + boş/boşluklu Sub Mfr: Manufacturer'a düşmez, boş kalır.
  const blank = parse.buildBacklogTemplateRows([order(1002, 'Ana Fabrika')], {}, overrides({1002:'   '}), [1002])[0];
  assert.equal(blank['Alt Üretici'], '');
  // DTR (Disney -> LICMAP'te 'DTR'): Alt Üretici her zaman Manufacturer'dır, submap yok sayılır.
  const dtr = parse.buildBacklogTemplateRows([order(1003, 'Ana Fabrika', 'Disney')], {}, overrides({1003:'Görmezden Gelinmeli'}), [1003])[0];
  assert.equal(dtr['Alt Üretici'], 'Ana Fabrika');
  const detail = parse.buildBacklogDetailRows([order(1001, 'Ana Fabrika')], {}, overrides({1001:'Alt Fabrika'}), [1001])[0];
  assert.equal(detail['Alt Üretici'], 'Alt Fabrika');
  // 'Lisans' sütunu araya eklendiği için sabit indeks yerine 'Üretici'ye göre konumlandır.
  const detailKeys = Object.keys(detail);
  const mfrIndex = detailKeys.indexOf('Üretici');
  assert.deepEqual(detailKeys.slice(mfrIndex, mfrIndex + 3), ['Üretici','Alt Üretici','Line']);
});

test('server template worker clones Manufacturer column styling for Alt Üretici', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../server/workers/excel-worker.js'), 'utf8');
  assert.match(worker, /header === 'Alt Üretici'[\s\S]*oldHeaderIndex\.get\('Üretici'\)/);
});
