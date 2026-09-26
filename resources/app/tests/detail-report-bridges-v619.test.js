'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = require('./helpers/server-source')();

test('v6.19 drill-down image column is enabled by default and shares every screen image pool', () => {
  assert.match(APP, /DETAIL_IMAGE_PREF_KEY='bl\.detailTables\.showImages\.v2'/);
  assert.match(APP, /saved==null\?true:saved==='1'/);
  assert.match(APP, /const byPlm=new Map\(\),byPlmOnly=new Map\(\),byModel=new Map\(\)/);
  assert.match(APP, /for\(const source of \[state\.cp,state\.orders\]\)/);
  assert.match(APP, /if\(typeof kolRows!=='undefined'\)/);
  assert.match(APP, /index\.byPlmOnly/);
  assert.match(APP, /const overrideImages=state\?\.overrides\?\.imagemap\|\|\{\}/);
  assert.match(APP, /\(state\?\.asasOrders\|\|\[\]\)\.forEach/);
  assert.match(APP, /plmStyleLinksByModel\.forEach/);
  assert.match(APP, /modelToPlm\.get\(model\)/);
  assert.match(CSS, /\.detailImgCell img\{/);
});

test('v6.20 stored images are readable from every drill-down area', () => {
  assert.match(SERVER, /app\.get\('\/api\/collection-images\/:id', userAccess\.requireAnyArea\('source','koleksiyon','cp','orders','backlog','lfl','overview','priceanalysis','opencosting','shipping'\)/);
  assert.match(SERVER, /app\.get\('\/api\/cp-images\/:id', userAccess\.requireAnyArea\('cp','orders','backlog','koleksiyon','lfl','overview','priceanalysis','opencosting','shipping'\)/);
});

test('v6.20 Backlog model name resolves a persisted PLM-only image without loaded CP rows', () => {
  const start = APP.indexOf('function buildDetailImageIndex(){');
  const end = APP.indexOf('// Detay tablosunun başlıkları', start);
  assert.ok(start >= 0 && end > start);
  const source = APP.slice(start, end);
  const factory = new Function(
    'state', 'plmStyleLinksByModel', 'cpImageOverrideKey', 'cpNormalizePlmImageId',
    'turknorm', 'norm', 'CP_IMAGE_API', 'modelAssetCanonicalPlmId', 'canonicalModelImageSource',
    `${source}; return { buildDetailImageIndex, detailImageUrlFrom };`
  );
  const clean = value => String(value == null ? '' : value).trim();
  const upper = value => clean(value).toLocaleUpperCase('tr-TR');
  const normalizePlm = value => clean(value).replace(/^0+(?=\d)/, '');
  const key = (plmId, colourCode) => {
    const id = normalizePlm(plmId), colour = upper(colourCode);
    return id && colour ? `plm:${id}|colour:${colour}` : '';
  };
  const { buildDetailImageIndex, detailImageUrlFrom } = factory(
    { overrides: { imagemap: { 'plm:2108736': 'stored-image-id' } }, asasOrders: [{ plm: '2108736', model: 'KK.BDY,MINECRAFT-9-YD', ccode: 'QXM' }], cp: null, orders: null },
    new Map(),
    key, normalizePlm, upper, clean, '/api/cp-images', () => '', () => ''
  );
  const index = buildDetailImageIndex();
  assert.equal(
    detailImageUrlFrom(index, { modelName: 'KK.BDY,MINECRAFT-9-YD', colourCode: 'QXM', plmId: '' }),
    '/api/cp-images/stored-image-id'
  );
});

test('v6.26 Backlog detail and Excel keep model/order cells plain', () => {
  assert.match(APP, /window\.BLDetailLinks=\{roleFor:detailBridgeColumnRole,urlFor:detailReportLinkUrl,cellHtml:detailReportCellHtml\}/);
  assert.match(APP, /if\(role==='order'\)return detailOrderLinkHtml/);
  assert.match(APP, /if\(role==='model'\)return plmModelLinkHtml/);
  assert.match(APP, /if\(role==='plm'\)return escapeHtml\(display\)/);
  const detail=APP.slice(APP.indexOf('function renderBacklogDetailTable'),APP.indexOf('// Gruplama/hiyerarşi paneli',APP.indexOf('function renderBacklogDetailTable')));
  const excel=APP.slice(APP.indexOf('function buildBacklogDetailSheet'),APP.indexOf('function backlogRowImageUrl'));
  assert.doesNotMatch(detail,/detailReportCellHtml|plmModelLinkCell|class="lnk"/);
  assert.doesNotMatch(excel,/detailReportLinkUrl|cell\.l=/);
  assert.match(APP,/if\(table\.matches\('\.backlogDetailTable'\)\)return/);
});

test('v6.19 global table enhancement adds order and model bridges without touching PLM ID', () => {
  assert.match(APP, /const orderAliases=new Set/);
  assert.match(APP, /const plmAliases=new Set/);
  assert.match(APP, /detailOrderLinkHtml\(orderCode,orderCode\)/);
  assert.match(APP, /plmModelLinkHtml\(modelName,\{plmId\}\)/);
});

test('v6.19 LFL detail variants show images and preserve links on screen and in Excel', () => {
  assert.match(LFL, /lflDetailAccessImages/);
  assert.match(LFL, /key:'__modelImage'/);
  assert.match(LFL, /window\.BLDetailImages\.buildIndex\(\)/);
  assert.match(LFL, /window\.BLDetailLinks\?\.cellHtml\?\./);
  assert.match(LFL, /window\.BLDetailLinks\?\.urlFor\?\./);
  assert.match(LFL, /cell\.l=\{Target:bridge/);
});
