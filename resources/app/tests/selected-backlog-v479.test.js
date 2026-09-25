'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const DESIGN = fs.readFileSync(path.join(ROOT, 'public', 'design.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function asas(colourCode, overrides = {}) {
  return {
    'Sipariş Kod': '7001001',
    'Model Adı': 'MODEL-A',
    'Renk Kod': colourCode,
    'Renk': colourCode === 'C01' ? 'SİYAH' : 'BEYAZ',
    'Net Alım Sipariş Miktarı': 1000,
    'Kalan Alım Sipariş Miktarı': 0,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Buyer Grup (TR)': 'BG',
    'Siparişin Üretildiği Ülke': 'CIN',
    'Orijinal Exfactory Merch Tarih': '2026-01-01',
    'Retail Depo Tarih Yıl Ay Gün': '2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15',
    ...overrides,
  };
}

function ias(colourCode, qty, overrides = {}) {
  return {
    'Sipariş Kod': '7001001',
    'Ürün Ad': 'MODEL-A',
    'Renk Kod': colourCode,
    'Renk Tanım': colourCode === 'C01' ? 'SİYAH' : 'BEYAZ',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
    'HANDOVER Tarihi': '2026-02-20',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': qty,
    'Net Alım Sipariş Miktarı': 1000,
    ...overrides,
  };
}

test('v4.79 selected Backlog detail uses exact Order Code + Model Name + Colour Code identity', () => {
  const config = parse.defaultAntrepoMatchConfig();
  const orders = parse.parseASASRows([asas('C01'), asas('C02')], config).orders;
  const antrepo = parse.parseAntrepoRows([
    ias('C01', 400),
    ias('C01', 600, {'Tahmini Antrepo Giriş Tarihi': '2026-03-08'}),
    ias('C02', 1000),
  ], config);
  const rows = parse.buildBacklogDetailRows(orders, antrepo, {
    antrepoMatchConfig: config,
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
  }, {
    identities: [{orderCode: '7001001', modelName: 'MODEL-A', colourCode: 'C01'}],
  });

  assert.equal(rows.length, 2, 'selected order line must retain all of its IAS partials');
  assert.deepEqual(new Set(rows.map(row => row['Renk Kod'])), new Set(['C01']));
  // v5.83: satır miktarı Backlog başlığındaki 'Adet' anahtarıyla taşınıyor.
  assert.deepEqual(rows.map(row => row['Adet']).sort((a,b)=>a-b), [400, 600]);
});

test('v4.80 CP and Orders expose one selection-based Backlog Report action without leaving the active page', () => {
  assert.match(INDEX, /id="selectedBacklogBtn"[\s\S]*data-i18n-en="Backlog Report"/);
  assert.match(INDEX, /function selectedBacklogRowsForActivePage\(\)/);
  assert.match(INDEX, /showBacklogReportForRows\(picked\.tab,picked\.rows,\{selectedMode:true\}\)/);
  assert.match(INDEX, /body:JSON\.stringify\(\{sourceTarget:tab,identities\}\)/);
  assert.match(INDEX, /row\['Order Code'\][\s\S]*row\['Model Name'\][\s\S]*row\['C\.Code'\]/);
  assert.match(INDEX, /if\(modal\.parentElement!==document\.body\)document\.body\.appendChild\(modal\)/);
  const selectedBlock = INDEX.slice(INDEX.indexOf('async function showSelectedBacklogReport'), INDEX.indexOf("document.getElementById('selectedBacklogBtn')"));
  assert.doesNotMatch(selectedBlock, /switchTab\(['"]backlog['"]\)/);
  assert.match(CSS, /body\[data-active-tab="cp"\] #selectedBacklogBtn/);
  assert.match(CSS, /body\[data-active-tab="orders"\] #selectedBacklogBtn/);
  assert.match(DESIGN, /body\[data-active-tab="orders"\] #vfSelLabel/);
  assert.match(INDEX, /hasBacklogSelection[\s\S]*selectedBacklogBtn/);
});

test('v4.80 STATUS double click opens all partials in the same Backlog detail modal', () => {
  assert.match(INDEX, /function bindStatusBacklogDrilldown\(tableId,tableKey\)/);
  assert.match(INDEX, /tbody\.addEventListener\('dblclick'/);
  assert.match(INDEX, /closest\('td\[data-key="STATUS"\]'\)/);
  assert.match(INDEX, /showBacklogReportForRows\(tableKey,\[row\],\{selectedMode:false\}\)/);
  assert.match(INDEX, /bindStatusBacklogDrilldown\('cpTable','cp'\)/);
  assert.match(INDEX, /bindStatusBacklogDrilldown\('ordersTable','orders'\)/);
});

test('v5.13 Backlog detail modal exports with the same report headers, formulas and guards as the full Backlog report', () => {
  assert.match(CSS, /\.backlogDetailCard\{width:min\(98vw,1880px\);height:min\(94vh,1040px\)/);
  assert.match(INDEX, /id="backlogDetailExportBtn"/);
  assert.match(INDEX, /function exportCurrentBacklogDetail\(\)/);
  assert.match(INDEX, /backlogExpandDateDimensions\(headers,currentBacklogDetailRows\)/);
  assert.match(INDEX, /buildBacklogDetailSheet\(expanded\.headers,expanded\.rows,null,\{includeImages,dateDimensionSources:expanded\.derivedHeaderSources\}\)/);
  assert.match(INDEX, /backlogWorkbookGuardConfig\(workbookHeaders,expanded\.rows\)/);
  assert.match(INDEX, /saveWorkbookWithValidations\(wb,filename,rules\.validations,rules\.conditionalFormats,rules\.protections/);
  assert.match(INDEX, /currentBacklogDetailHeaders=Array\.isArray\(headers\)/);
  assert.match(SERVER, /headers: BACKLOG_TEMPLATE_HEADERS/);
});

test('v4.79 Backlog detail API resolves selected rows from the active CP or Orders horizon', () => {
  assert.match(SERVER, /app\.post\('\/api\/backlog-detail', userAccess\.requireAnyArea\('backlog','cp','orders'\)/);
  assert.match(SERVER, /sourceTarget = selectionRequest && body\.sourceTarget === 'orders' \? 'orders'/);
  assert.match(SERVER, /ordersForTarget\(active, sourceTarget, overrides\)/);
  assert.match(SERVER, /antrepoForTarget\(active, sourceTarget\)/);
  assert.match(SERVER, /selector=\{identities\}/);
});
