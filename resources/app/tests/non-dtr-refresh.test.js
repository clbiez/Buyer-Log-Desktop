'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const rules = require('../public/business-rules');

function loadParseWithoutInstalledXlsx() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'xlsx') return { SSF: {}, utils: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve('../server/lib/parse');
    delete require.cache[resolved];
    return require('../server/lib/parse');
  } finally {
    Module._load = originalLoad;
  }
}

function sampleOrder(manufacturer = 'Factory One') {
  return {
    ocode: 1001, colour: 'Black', kalan: 10, qty: 10, antrepo: 0,
    license: 'Disney', manufacturer, season: 'W5', countryRaw: 'TURKIYE',
    buyerGrup: 'LISANS', merch: 'CU4E', category: 'T-Shirt', ozel: '',
    plm: 123, model: 'MODEL-1', ccode: '001', fob: 10, opd: null, ex: null,
    retail: null, mb: null, shipConf: null, ageGroup: '', buyer: '', line: '',
    karisim: '', iplikNo: '', kumasTipi: '', fabricWeight: '', merkezSevkeHazirKalan: 0,
  };
}

function overrides(nonDtrManufacturers = []) {
  return {
    apprmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {},
    licensormap: { 1001: 'DTR' }, pricingRules: [], transitRules: [], nonDtrManufacturers,
  };
}

test('manufacturer rule normalises Turkish text and deduplicates Non-DTR entries', () => {
  const list = rules.normalizeManufacturerList(['  Örnek Üretici  ', 'örnek üretici', 'Factory Two']);
  assert.deepEqual(list, ['Factory Two', 'Örnek Üretici']);
  assert.equal(rules.isNonDtrManufacturer('ÖRNEK   ÜRETİCİ', list), true);
  assert.equal(rules.isNonDtrManufacturer('Factory Three', list), false);
});

test('Non-DTR manufacturer maintenance does not overwrite CP or Orders Licensor fields', () => {
  const parse = loadParseWithoutInstalledXlsx();
  const order = sampleOrder();
  const listed = overrides([' factory one ']);
  const cp = parse.buildCPRowsFromASAS([order], {}, listed)[0];
  // v6.53 — buildOARowsFromASAS artık yok; aynı işlev buildOrdersRowsFromASAS
  // adıyla var ("Order Analysis" sekmesi sonradan "Orders"/"Siparişler" olarak
  // yeniden adlandırıldı). Çıktı alanları çalışma zamanında doğrulandı, birebir aynı.
  const orders = parse.buildOrdersRowsFromASAS([order], {}, listed)[0];
  for (const row of [cp, orders]) {
    assert.equal(row.Licensor, 'DTR');
    assert.equal(row._nonDtrManufacturerRule, false);
    assert.equal(row._licensorManual, true);
    assert.equal(row['Sub-Manufacturer'], 'Factory One');
    assert.equal(row['Supp. FOB'], 10);
  }
});

// Buton DOM/etiket kontrolleri index.html'de kalıyor; JS davranışı
// (Refresh Stages paneli vb.) app-main.js'e taşındı.
test('UI exposes Non-DTR management, non-blocking Refresh Stages and non-blocking LFL refresh', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const appMain = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  const lfl = fs.readFileSync(path.join(__dirname, '../public/lfl.js'), 'utf8');
  const dmUi = fs.readFileSync(path.join(__dirname, '../public/data-management.js'), 'utf8');
  assert.doesNotMatch(dmUi, /id: 'nondtr'/);
  const editor = fs.readFileSync(path.join(__dirname, '../public/email-groups.js'), 'utf8');
  assert.match(editor, /data-eg-input="dtrStatus"/);
  // Yenileme başladıktan sonra tek kullanıcı paneli açılır; eski uyarı penceresi
  // artık DOM'a eklenmez.
  assert.match(appMain, /openRefreshStagesModal\(\)/);
  assert.doesNotMatch(appMain, /Data model refresh is running|Veri modeli yenileniyor/);
  assert.doesNotMatch(appMain, /if\(force\) showAppBlockingOperation\('source'\)/);
  // classifyDtrByManufacturer artık business-rules.js'deki tanımlı ama önceden hiç
  // çağrılmayan fonksiyonu kullanıyor (app-main.js'teki window.classifyDtrByManufacturer
  // sarmalayıcısı üzerinden); lfl.js kendi içinde aynı üç satırı tekrar yazmıyor.
  assert.match(lfl, /window\.classifyDtrByManufacturer/);
  assert.match(editor, /CP ve Orders lisansör alanlarını değiştirmez/);
  assert.doesNotMatch(html, /row\.Licensor='NON-DTR'/);
  // v20260928 — LFL düğmesi bağlı ortak yenilemeyi çalıştırır (ayrı LFL yenilemesi yok).
  assert.match(lfl, /refreshButton\.title=linkedRefreshTitle\(\)/);
  assert.match(lfl, /lflRefreshBtn'\)\?\.addEventListener\('click',\(\)=>\{void refreshLinked\(\);\}\)/);
  assert.doesNotMatch(lfl, /showAppBlockingOperation\('lfl'\)/);
  assert.doesNotMatch(lfl, /Processing may take longer depending on the file size and complexity\. Continue\?/);
  const css = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');
  assert.match(css, /#_toast\{z-index:50000/);
  assert.match(css, /\.refreshStagesOverlay\{[^}]*z-index:49000/);
});
