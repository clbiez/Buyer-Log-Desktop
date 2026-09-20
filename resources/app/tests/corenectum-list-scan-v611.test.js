const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONNECTOR_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('v6.11 extracts PLM Code and internal styleId directly from GetStyleList payload', () => {
  const payload = { data:{ coreNectumResultData:{ styleListResult:[
    { styleId:2468230, plmCode:2108736, styleName:'LIVERPOOL-4-YI', specialCode:'S7OT04Z4' },
    { styleId:2468225, plmCode:2108731, styleName:'LIVERPOOL-3-YD' },
  ] } } };
  assert.deepEqual(connector.coreNectumStyleListRows(payload), [
    { plmId:'2108736', styleId:'2468230', styleName:'LIVERPOOL-4-YI', specialCode:'S7OT04Z4' },
    { plmId:'2108731', styleId:'2468225', styleName:'LIVERPOOL-3-YD', specialCode:'' },
  ]);
});

test('v6.21 reads only the GetStyleList API and never pages the visible PLM table', () => {
  const collector = CONNECTOR_SOURCE.slice(CONNECTOR_SOURCE.indexOf('async function collectCoreNectumStyleLinks'), CONNECTOR_SOURCE.indexOf('async function startRecording'));
  assert.match(collector, /coreNectumWaitListBatch/);
  assert.match(collector, /coreNectumBulkApiScan/);
  assert.doesNotMatch(collector, /coreNectumNextListPage/);
  assert.match(collector, /scannedPages/);
  assert.doesNotMatch(collector, /FillAndSearch|OpenResult|\.click\(.*plmId/);
  assert.doesNotMatch(CONNECTOR_SOURCE, /function coreNectumFillAndSearch|function coreNectumOpenResult/);
});

test('CoreNectum scans unfiltered background API pages with the captured page size', () => {
  const scan = CONNECTOR_SOURCE.slice(CONNECTOR_SOURCE.indexOf('function coreNectumScanExpression'), CONNECTOR_SOURCE.indexOf('function coreNectumReplayHeaders'));
  assert.match(scan, /coreNectumUnfilteredRequestBody/);
  /* v9.13: tarama parçalı hâle gelince sayfa boyutu, çağrılar arasında
     korunan durumun içinde tutuluyor (st.pageSize). Sınanan kural aynı:
     boyut YAKALANAN istekten alınır, tahmin edilmez. */
  assert.match(scan, /pageSize:sizes\.map\(field=>Number\(get\(cfg\.body,field\.path\)\)\)\.find\(value=>value>0\)\|\|100/);
  assert.doesNotMatch(scan, /pageSize\s*=\s*(?:200|250|500|1000)/);
  assert.match(scan, /st\.found\.size===st\.wanted\.size/);
  assert.match(scan, /mode:'direct-api'/);
  assert.doesNotMatch(scan, /preferredPageSize|overrideSize|firstPayload/);
  assert.doesNotMatch(scan, /coreNectumNextListPage|\.click\(/);
  assert.match(APP, /\/api\/plm-style-links\/sync-links/);
  assert.match(APP, /Model Linklerini PLM'den Al|Getting .* model links/);
});

test('v6.11 collects the highlighted Image cell before moving to the next page', () => {
  assert.match(CONNECTOR_SOURCE, /async function coreNectumStyleListRowImage/);
  // v10.72: satır anchor'ından bulunur ama birden fazla eşleşme varsa keyfi
  // satır seçilmez (belirsiz eşleşmede görsel döndürülmez).
  assert.match(CONNECTOR_SOURCE, /el\.closest\('tr'\)/);
  assert.match(CONNECTOR_SOURCE, /row\.querySelectorAll\('img'\)/);
  assert.match(CONNECTOR_SOURCE, /mouseenter/);
  assert.match(CONNECTOR_SOURCE, /cdk-overlay-container img/);
});

test('v6.11 link scan sends the current screen models in one API scan and returns page totals', () => {
  assert.match(APP, /function plmToolRows\(source,scope='filtered'\)/);
  assert.match(APP, /function missingPlmLinkItems\(source\)/);
  assert.match(APP, /body:JSON\.stringify\(\{items\}\)/);
  assert.doesNotMatch(APP.slice(APP.indexOf('async function syncMissingPlmLinks'), APP.indexOf("document.getElementById('cpPlmLinksBtn')")), /offset\+=200/);
  assert.doesNotMatch(SERVER.slice(SERVER.indexOf("app.post('/api/plm-style-links/sync-links'"), SERVER.indexOf("app.post('/api/model-images/import-plm'")), /raw\.length>5000|slice\(0,\s*5000\)/);
  assert.match(SERVER, /scannedPages:collected\.scannedPages/);
  assert.match(SERVER, /scannedRows:collected\.scannedRows/);
});
