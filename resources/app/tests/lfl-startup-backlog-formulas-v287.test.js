'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const formulas = require('../public/backlog-excel-formulas');

// 'Adet' (Net Alım Sipariş Miktarı'nın sağı) ve ANTREPO-RETAIL'in sağındaki sütun
// sonradan eklenen üretim sütunlarıdır. O sütun eskiden üretici yükleme teyidiydi;
// v20261021'de aynı konumda ÖNEM ETİKETİ'ne dönüştü (sütun indeksleri değişmedi).
const HEADERS = [
  'Sezon','Sipariş Yerleştirme MerchTarih','Siparişin Üretildiği Ülke','Buyer','Buyer Grup (TR)','Lisans','Üretici','Alt Üretici','Line','Ürün Klasman','Sipariş Kod','Özel Kod 1','Model Adı','Renk Kod','Renk','Orijinal Exfactory Merch Ay','Orijinal Exfactory Merch Tarih','Retail Depo Merch Yil Ay','Retail Depo Tarih Yıl Ay Gün','Model Bütçe Merch Yil Ay','Model Bütçe Tarih Yıl Ay Gün','Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta','Net Alım Sipariş Miktarı','Adet','Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo','Kalan Alım Sipariş Miktarı','FOB Fiyatı','Net Gelen Alım Sipariş Miktarı','Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo','GÜNCEL DURUM\n(STATUS)','REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)','ANTREPO GİRİŞ TARİHİ','YÜKLEME TİPİ','ANTREPO-RETAIL','ÖNEM ETİKETİ\n(IMPORTANCE)','RİSK\n(PRIORITY)','buying note',
];

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

function baseOrder() {
  return {
    ocode: 1001, colour: 'Siyah', kalan: 10, qty: 20, antrepo: 0,
    license: '', manufacturer: 'Factory', season: 'W6', countryRaw: 'TURKIYE',
    buyerGrup: 'ÖRME', merch: 'CU4E', category: 'T-Shirt', ozel: '', plm: 1,
    model: 'MODEL', ccode: '001', fob: 5, opd: new Date(2026, 5, 1),
    ex: new Date(2026, 6, 10), retail: new Date(2026, 8, 30), mb: new Date(2026, 9, 15),
    shipConf: new Date(2026, 6, 11), ageGroup: '', buyer: '', line: '',
    merkezSevkeHazirKalan: 0, karisim: '', iplikNo: '', kumasTipi: '', fabricWeight: '',
  };
}
function overrides() {
  return { apprmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, pricingRules: [], transitRules: [], nonDtrManufacturers: [] };
}

// Kullanıcı kararı: açılışta ağır model snapshot'ı HTTP startup yolunda eager hydrate
// edilmez. Hazır page-cache varsa doğrudan kullanılır; cache miss olduğunda ilgili
// kullanıcının ilk veri isteği model snapshot'ını on-demand okur. LFL Refresh ise
// halen model katmanından geçer ve başka kullanıcının snapshot'ına düşmez.
test('program startup keeps authentication light and model snapshots remain on-demand; LFL refresh still goes through the model layer', () => {
  const server = require('./helpers/server-source')();
  assert.match(server, /async function loadInitialDataAndLfl\(value\)\{[\s\S]{0,760}?const snapshot = await hydrateModelSnapshotAsync\(id\);/);
  assert.doesNotMatch(server, /const snapshot = hydrateModelSnapshot\(id\) \|\| hydrateSharedModelSnapshot\(id\)/, 'kişiselleştirilmiş moderatör snapshotı başka kullanıcıya verilmemeli');
  assert.match(server, /app\.get\('\/api\/lfl',[\s\S]*await ensureDataLoaded\(id\)/);
  assert.match(server, /app\.post\('\/api\/lfl\/refresh'[\s\S]*loadFromModels\(id, \['lfl'\]\)/);
  const startup = server.slice(server.indexOf('const httpServer = app.listen'), server.indexOf("httpServer.on('error'"));
  assert.doesNotMatch(startup, /ensureDataLoaded\('moderator'\)\.catch\(err=>logRuntimeFailure\('startupModelRead'/);
  assert.doesNotMatch(startup, /setTimeout\(\(\)=>warmPageProjectionCachesFromSnapshots\(/);
});

test('Backlog rows expose the compact inputs required for live Excel formulas', () => {
  const parse = loadParseWithoutXlsx();
  const row = parse.buildBacklogTemplateRows([baseOrder()], {}, overrides(), [1001])[0];
  assert.equal(row._backlogExcel.transitDays, 70);
  assert.equal(row._backlogExcel.originalDelType, 'Gemi');
  assert.equal(row._backlogExcel.actualAntrepoDate, null);
  assert.ok(row._backlogExcel.shipConfirmationDate instanceof Date);
});

test('Backlog formula plan keeps month/week, revised Ex-Factory and Priority as direct values while linking live arrival formulas', () => {
  const row = {
    'Orijinal Exfactory Merch Ay': '2026-07',
    'Retail Depo Merch Yil Ay': '2026-09',
    'Model Bütçe Merch Yil Ay': '2026-10',
    'Model Bütçe Yil Hafta': '2026-42',
    'Retail Depo Merch Yil Hafta': '2026-40',
    'Net Gelen Alım Sipariş Miktarı': 10,
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2026-07-10',
    'ANTREPO GİRİŞ TARİHİ': '2026-09-18',
    'YÜKLEME TİPİ': 'Gemi',
    'ANTREPO-RETAIL': -12,
    'RİSK\n(PRIORITY)': 'YOK',
    _backlogExcel: { transitDays: 70, actualAntrepoDate: null, handoverDate: null, shipConfirmationDate: '2026-07-11', originalDelType: 'Gemi' },
  };
  const plan = formulas.formulaPlan(HEADERS, row, 2);
  // 'Adet' ve ANTREPO-RETAIL sağındaki sütunun eklenmesi sonraki hücre
  // referanslarını kaydırdı (AE/AF/AH -> AF/AG/AI). Risk artık yalnız ANTREPO-RETAIL
  // eşiğine değil canonical gecikme/hand-over/discount/transit-overdue helper bayraklarına bağlıdır.
  assert.equal(plan.refs['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)'], 'AF2');
  assert.equal(plan.refs['ANTREPO GİRİŞ TARİHİ'], 'AG2');
  assert.equal(plan.refs['ANTREPO-RETAIL'], 'AI2');
  for (const header of [
    'Orijinal Exfactory Merch Ay','Retail Depo Merch Yil Ay','Model Bütçe Merch Yil Ay',
    'Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
  ]) assert.equal(plan.formulas[header], undefined, `${header} must be a direct value`);
  assert.equal(plan.formulas['RİSK\n(PRIORITY)'].cached, 'YOK');
  const riskFormula=plan.formulas['RİSK\n(PRIORITY)'].formula;
  assert.match(riskFormula, /IF\(OR\([^)]*\),"VAR","YOK"\)/);
  assert.ok(riskFormula.includes(plan.refs['_BL_TRANSIT_OVERDUE']), 'transit overdue helper risk formülüne bağlı kalmalı');
  assert.match(plan.formulas['ANTREPO GİRİŞ TARİHİ'].formula, /AF2\+AM2/);
  assert.match(plan.formulas['ANTREPO-RETAIL'].formula, /AG2-S2/);
  assert.match(plan.formulas['Net Gelen Alım Sipariş Miktarı'].formula, /MAX\(0,Y2\)/);
});

// Tarayıcı tarafı Backlog dışa aktarım kodu index.html'den app-main.js'e taşındı;
// formulaPlan çağrısı da headers->visibleHeaders + {transit} seçenek nesnesi alacak
// şekilde genişledi.
test('browser and worker exports keep remaining formulas, hidden helpers, dropdown guards and open-time recalculation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const appMain = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../server/workers/excel-worker.js'), 'utf8');
  assert.match(html, /backlog-excel-formulas\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(html, /excel-workbook-guards\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(appMain, /BLBacklogExcel\.formulaPlan\(visibleHeaders,row,ri\+2/);
  assert.match(appMain, /helperHeaders\.map\(h=>BLBacklogExcel\.columnSpec\(h,\{helper:true\}\)\)/);
  assert.match(appMain, /forceWorkbookFormulaCalculation\(wb\)/);
  assert.match(appMain, /saveWorkbookWithValidations\(wb,`Backlog_Report_/);
  assert.match(appMain, /values:DELTYPE_OPTS/);
  assert.match(worker, /BLBacklogExcel\.formulaPlan\(headers, row, excelRow\)/);
  assert.match(worker, /BLBacklogExcel\.columnSpec\(header, \{ helper: true \}\)/);
  assert.match(worker, /fullCalcOnLoad: '1'/);
  assert.match(worker, /BLExcelWorkbookGuards\.applyWorkbookGuards/);
  assert.match(worker, /protections: \[\{/);
  assert.match(worker, /YÜKLEME TİPİ/);
});
