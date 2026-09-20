'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PowerBiImportDashboardConnector,
  decodePowerBiResponse,
  normalizeDashboardRows,
  validateDashboardSchema,
  buildDashboardBatches,
  createDashboardRefreshManifest,
  applyDashboardBatchResult,
  assertDashboardManifestComplete,
  buildPowerBiOrderQueryPayload,
  dashboardAntrepoMatchRule,
} = require('../server/lib/power-bi-import-dashboard');
const fs = require('node:fs');
const path = require('node:path');
const agentBrowserConnector = require('../server/lib/agent-browser-connector');
const parseLib = require('../server/lib/parse');

function responseWithRows(rows, columns = [
  { Name: 'Order Code' },
  { Name: 'Product Name' },
  { Name: 'Colour Code' },
  { Name: 'Supplier Portal Status' },
  { Name: 'Estimated Warehouse Entry' },
  { Name: 'Loaded Quantity' },
]) {
  const valueDicts = {
    '0': rows.map(row => row[0]),
    '1': rows.map(row => row[1]),
    '2': rows.map(row => row[2]),
    '3': rows.map(row => row[3]),
  };
  return {
    results: [{ result: { data: {
      ds: [{
        valueDicts,
        PH: [{ DM0: rows.map(row => ({ C: row.map((value, index) => index < 4 ? { D: valueDicts[String(index)].indexOf(value) } : value) })) }],
      }],
      descriptor: { Select: columns },
    } } }],
  };
}

test('Power BI decoder resolves descriptor columns, dictionaries and null bitmap', () => {
  const payload = {
    results: [{ result: { data: {
      descriptor: { Select: [
        { Name: 'Sipariş Bilgileri.Sipariş Kod' },
        { Name: 'Ithalat.Model Adı' },
        { Name: 'Ithalat.Renk Kod' },
        { Name: 'Ithalat.Yükleme Toplam Adet' },
      ] },
      ds: [{ valueDicts: { '0': ['1001'], '1': ['MODEL-A'], '2': ['C01'] }, PH: [{ DM0: [
        { C: [0, 0, 0, 12] },
        { 'Ø': 4, C: [0, 0, 25] },
      ] }] }],
    } } }],
  };
  const rows = decodePowerBiResponse(payload);
  assert.deepEqual(rows, [
    { 'Sipariş Bilgileri.Sipariş Kod': '1001', 'Ithalat.Model Adı': 'MODEL-A', 'Ithalat.Renk Kod': 'C01', 'Ithalat.Yükleme Toplam Adet': 12 },
    { 'Sipariş Bilgileri.Sipariş Kod': '1001', 'Ithalat.Model Adı': 'MODEL-A', 'Ithalat.Renk Kod': null, 'Ithalat.Yükleme Toplam Adet': 25 },
  ]);
});

test('Dashboard rows normalize to the existing IAS field names and preserve nulls', () => {
  const rows = normalizeDashboardRows([{
    'Order Code': '1001', 'Product Name': 'MODEL-A', 'Colour Code': 'C01',
    'Supplier Portal Status': 'Yolda', 'Estimated Warehouse Entry': '2026-09-01',
    'Loaded Quantity': 10, 'Warehouse Company': null,
  }]);
  assert.equal(rows[0]['Sipariş Kod'], '1001');
  assert.equal(rows[0]['Model Adı'], 'MODEL-A');
  assert.equal(rows[0]['Renk Kod'], 'C01');
  assert.equal(rows[0]['Supplier Portal Statü'], 'Yolda');
  assert.equal(rows[0]['Antrepo Firma'], null);
  assert.equal(rows[0]._sourceFields['Loaded Quantity'], 10);
});

test('Dashboard schema discovery also reads fields from the semantic query request', () => {
  const columns = require('../server/lib/power-bi-import-dashboard').descriptorColumns({
    queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: {
      Query: { Select: [
        { Column: { Property: 'Sipariş Kod' }, Name: 'Ithalat.Sipariş Kod' },
        { Column: { Property: 'Model Adı' }, Name: 'Ithalat.Model Adı' },
        { Column: { Property: 'Renk Kod' }, Name: 'Ithalat.Renk Kod' },
      ] },
    } }] } }],
  });
  assert.ok(columns.includes('Ithalat.Sipariş Kod'));
  assert.ok(columns.includes('Ithalat.Model Adı'));
  assert.ok(columns.includes('Ithalat.Renk Kod'));
  assert.ok(columns.includes('Sipariş Kod'));
  assert.ok(columns.includes('Model Adı'));
  assert.ok(columns.includes('Renk Kod'));
});

test('Dashboard refresh selects the query template carrying the most IAS fields', () => {
  assert.ok(agentBrowserConnector.dashboardTemplateScore({ columns: ['Sipariş Kod'] })
    < agentBrowserConnector.dashboardTemplateScore({
      columns: ['Sipariş Kod', 'Model Adı', 'Renk Tanım', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'İthalat Dosya No', 'Yükleme Toplam Adet'],
    }));
});

test('Dashboard schema validation reports every missing required IAS field', () => {
  assert.throws(() => validateDashboardSchema(['Order Code', 'Product Name']), error => {
    assert.equal(error.code, 'POWERBI_DASHBOARD_SCHEMA_INVALID');
    assert.deepEqual(error.details.missing, [
      'Renk Tanım', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi',
      'Yükleme Toplam Adet', 'İthalat Dosya No',
    ]);
    return true;
  });
});

test('Dashboard schema requires Renk Tanım and does not require Renk Kod', () => {
  assert.doesNotThrow(() => validateDashboardSchema([
    'Siparis Bilgileri.Sipariş Kod', 'Ithalat.Model Adı', 'Siparis Bilgileri.Renk Tanım',
    'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet', 'İthalat Dosya No',
  ]));
  assert.throws(() => validateDashboardSchema([
    'Siparis Bilgileri.Sipariş Kod', 'Ithalat.Model Adı', 'Ithalat.Renk Kod',
    'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet', 'İthalat Dosya No',
  ]), error => error.details && error.details.missing.includes('Renk Tanım'));
  assert.doesNotThrow(() => validateDashboardSchema([
    'Sipariş Kod', 'Model Adı', 'Renk Kod', 'Supplier Portal Statü',
    'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet', 'İthalat Dosya No',
  ], { sourceMode: 'excel' }));
  assert.throws(() => validateDashboardSchema([
    'Sipariş Kod', 'Model Adı', 'Renk Tanım', 'Supplier Portal Statü',
    'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet', 'İthalat Dosya No',
  ], { sourceMode: 'excel' }), error => error.details && error.details.missing.includes('Renk Kod'));
});

test('Dashboard color adapter matches ASAS Renk without mixing same-order colors', () => {
  const rule = dashboardAntrepoMatchRule();
  const normalized = normalizeDashboardRows([
    { 'Siparis Bilgileri.Sipariş Kod': '1001', 'Ithalat.Model Adı': 'MODEL-A', 'Siparis Bilgileri.Renk Tanım': '  PINK   şeritli  ', 'Supplier Portal Statü': 'Yolda', 'Yükleme Toplam Adet': 10 },
    { 'Siparis Bilgileri.Sipariş Kod': '1001', 'Ithalat.Model Adı': 'MODEL-A', 'Siparis Bilgileri.Renk Tanım': 'RED', 'Supplier Portal Statü': 'Yolda', 'Yükleme Toplam Adet': 20 },
  ]);
  assert.equal(normalized[0]['Renk Tanım'], '  PINK   şeritli  ');
  const parsed = parseLib.parseAntrepoRows(normalized.map(row => {
    const { _sourceFields, ...cleanRow } = row;
    return cleanRow;
  }), rule);
  assert.equal(parseLib.antrepoParseMeta(parsed).ok, true);
  const pinkHits = parseLib.findAntrepoHits(parsed, {
    ocode: '1001', model: 'MODEL-A', colour: 'pink şeritli', ccode: 'NOT-USED',
  }, { rule });
  const redHits = parseLib.findAntrepoHits(parsed, {
    ocode: '1001', model: 'MODEL-A', colour: ' red ', ccode: 'NOT-USED',
  }, { rule });
  const missingHits = parseLib.findAntrepoHits(parsed, {
    ocode: '1001', model: 'MODEL-A', colour: 'BLUE', ccode: 'NOT-USED',
  }, { rule });
  assert.equal(pinkHits.length, 1);
  assert.equal(redHits.length, 1);
  assert.equal(missingHits.length, 0);
  assert.equal(rule.conditions[2].normalization, 'colour');
  assert.equal(rule.conditions[2].asas.canonicalHeader, 'Renk');
  assert.equal(rule.conditions[2].ias.canonicalHeader, 'Renk Tanım');
});

test('Dashboard batches unique order codes without visible-row limits', () => {
  const codes = Array.from({ length: 10000 }, (_, index) => String(index + 1));
  assert.equal(new Set(codes.concat(codes.slice(0, 100))).size, 10000);
  const batches = buildDashboardBatches(codes.concat(codes.slice(0, 100)), 250);
  assert.equal(batches.length, 40);
  assert.equal(batches.flat().length, 10000);
  assert.equal(batches[0].length, 250);
});

test('Dashboard manifest accounts for success, not-found and failed orders exactly once', () => {
  const manifest = createDashboardRefreshManifest(['A', 'B', 'C']);
  applyDashboardBatchResult(manifest, ['A', 'B'], [{ 'Sipariş Kod': 'A' }]);
  applyDashboardBatchResult(manifest, ['C'], null, new Error('timeout'));
  assert.deepEqual({ ...manifest.orderStates }, { A: 'SUCCESS', B: 'NOT_FOUND', C: 'FAILED' });
  assert.equal(manifest.successfulOrders + manifest.notFoundOrders + manifest.failedOrders, manifest.totalOrders);
  assertDashboardManifestComplete(manifest);
});

test('Dashboard connector retries a failed batch and checkpoints terminal states', async () => {
  let calls = 0;
  const checkpoints = [];
  const connector = new PowerBiImportDashboardConnector({
    batchSize: 2,
    maxRetries: 1,
    backoffMs: 0,
    transport: {
      getSchema: async () => ['Order Code', 'Product Name', 'Colour Description', 'Supplier Portal Status', 'Estimated Warehouse Entry', 'Loaded Quantity', 'Import File No'],
      queryBatch: async codes => {
        calls += 1;
        if (calls === 1) throw new Error('temporary network error');
        return codes.map(code => ({ 'Sipariş Kod': code }));
      },
    },
  });
  const result = await connector.refresh({ orderCodes: ['A', 'B', 'C'], checkpoint: value => checkpoints.push(value) });
  assert.equal(result.manifest.processedOrders, 3);
  assert.equal(result.manifest.successfulOrders, 3);
  assert.equal(result.manifest.failedOrders, 0);
  assert.equal(calls, 3);
  assert.ok(checkpoints.length >= 2);
});

test('Dashboard connector adaptively splits a permanently failing batch', async () => {
  const calls = [];
  const connector = new PowerBiImportDashboardConnector({
    batchSize: 4,
    maxRetries: 0,
    backoffMs: 0,
    transport: {
      getSchema: async () => ['Order Code', 'Product Name', 'Colour Description', 'Supplier Portal Status', 'Estimated Warehouse Entry', 'Loaded Quantity', 'Import File No'],
      queryBatch: async codes => {
        calls.push(codes.slice());
        if (codes.length > 1) throw new Error('batch payload too large');
        return [{ 'Sipariş Kod': codes[0] }];
      },
    },
  });
  const result = await connector.refresh({ orderCodes: ['A', 'B', 'C', 'D'] });
  assert.equal(result.manifest.successfulOrders, 4);
  assert.equal(result.manifest.failedOrders, 0);
  assert.ok(calls.some(batch => batch.length === 4));
  assert.equal(calls.filter(batch => batch.length === 1).length, 4);
});

test('Dashboard connector resumes terminal checkpoint rows and queries only remaining orders', async () => {
  const calls = [];
  const manifest = createDashboardRefreshManifest(['A', 'B', 'C']);
  applyDashboardBatchResult(manifest, ['A'], [{ 'Sipariş Kod': 'A' }]);
  manifest.rows = [{ 'Sipariş Kod': 'A', 'Model Adı': 'MODEL-A', 'Renk Kod': 'C01' }];
  const connector = new PowerBiImportDashboardConnector({
    batchSize: 2,
    maxRetries: 0,
    transport: {
      getSchema: async () => ['Order Code', 'Product Name', 'Colour Description', 'Supplier Portal Status', 'Estimated Warehouse Entry', 'Loaded Quantity', 'Import File No'],
      queryBatch: async codes => { calls.push(codes.slice()); return codes.map(code => ({ 'Sipariş Kod': code })); },
    },
  });
  const result = await connector.refresh({ orderCodes: ['A', 'B', 'C'], manifest });
  assert.deepEqual(calls, [['B', 'C']]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.manifest.successfulOrders, 3);
});

test('Dashboard query filter is added to the semantic query by field name, not column index', () => {
  const body = { queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: {
    Query: { Select: [{ Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Bilgileri.Sipariş Kod' } }] },
  } }] } }] };
  const next = buildPowerBiOrderQueryPayload(body, ['1001', '1002']);
  const query = next.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query;
  assert.equal(query.Where[0].Condition.In.Values.length, 2);
  assert.equal(query.Where[0].Condition.In.Values[0][0].Literal.Value, "'1001'");
});

test('Dashboard is a persisted third Antrepo source in the existing source flow', () => {
  const root = path.join(__dirname, '..');
  const db = fs.readFileSync(path.join(root, 'server', 'db.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8') + fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
  assert.match(db, /\['database', 'dashboard'\]/);
  assert.match(server, /antrepoMode === 'dashboard'/);
  assert.match(server, /browserIntegrationManager\.ensureDashboardSession/);
  /* v7.81: Antrepo kaynak modu anahtarları Veri Yönetimi ekranına taşındı;
     üçüncü seçenek (Dashboard) orada üretiliyor. */
  const dmUi = fs.readFileSync(path.join(root, 'public', 'data-management.js'), 'utf8');
  assert.match(dmUi, /\['dashboard', 'Dashboard'\]/);
  assert.match(dmUi, /id: 'antrepoSourceControl', attr: 'data-source-mode'/);
  void ui;
});

test('Dashboard batch and retry limits are configurable and bounded', () => {
  const { normalizeConfig } = require('../server/lib/runtime-config');
  const config = normalizeConfig({ powerBiDashboardBatchSize: 9999, powerBiDashboardMaxRetries: -3, powerBiDashboardBackoffMs: 999999 });
  assert.equal(config.powerBiDashboardBatchSize, 500);
  assert.equal(config.powerBiDashboardMaxRetries, 0);
  assert.equal(config.powerBiDashboardBackoffMs, 30000);
});

test('Power BI navigation abort yalnız güvenli SSO redirectinde recover edilir', () => {
  assert.equal(agentBrowserConnector.isPowerBiNavigationAbort('Sayfa açılamadı: net::ERR_ABORTED'), true);
  assert.equal(agentBrowserConnector.isPowerBiNavigationAbort('Sayfa açılamadı: net::ERR_CONNECTION_RESET'), false);
  assert.equal(agentBrowserConnector.isPowerBiSessionRedirectUrl('https://login.microsoftonline.com/common/oauth2/authorize?client_id=secret'), true);
  assert.equal(agentBrowserConnector.isPowerBiSessionRedirectUrl('https://app.powerbi.com/groups/report'), true);
  assert.equal(agentBrowserConnector.isPowerBiSessionRedirectUrl('https://evil.example/redirect'), false);
  assert.equal(agentBrowserConnector.isPowerBiDashboardUrl('https://app.powerbi.com/groups/report', 'https://app.powerbi.com/groups/report?experience=power-bi'), true);
  assert.equal(agentBrowserConnector.isPowerBiDashboardUrl('https://app.powerbi.com/groups/other', 'https://app.powerbi.com/groups/report'), false);
});

test('Power BI navigation failures are classified instead of flattened to one error', () => {
  assert.equal(agentBrowserConnector.powerBiNavigationFailure(new Error('Navigation timeout'), 'https://app.powerbi.com/report').code, 'POWERBI_NAVIGATION_TIMEOUT');
  assert.equal(agentBrowserConnector.powerBiNavigationFailure(new Error('net::ERR_NAME_NOT_RESOLVED'), 'https://app.powerbi.com/report').code, 'POWERBI_NETWORK_ERROR');
  assert.equal(agentBrowserConnector.powerBiNavigationFailure(new Error('net::ERR_ABORTED'), 'https://app.powerbi.com/report').code, 'POWERBI_NAVIGATION_ABORTED');
});

test('Power BI diagnostik URL query ve token bilgisini loga taşımaz', () => {
  assert.equal(
    agentBrowserConnector.sanitizePowerBiUrl('https://app.powerbi.com/reports/r?token=secret&experience=power-bi'),
    'https://app.powerbi.com/reports/r'
  );
});

test('Power BI bağlantısı güvenli navigation recovery ve tekrar kullanılabilir session cache içerir', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
  assert.match(source, /POWERBI_NAV_ABORT_RECOVERED/);
  assert.match(source, /POWERBI_AUTH_REQUIRED/);
  assert.match(source, /powerBiSessionCache/);
  assert.match(source, /openPowerBiImportDashboardSession[\s\S]*?powerBiSessionCache/);
});
