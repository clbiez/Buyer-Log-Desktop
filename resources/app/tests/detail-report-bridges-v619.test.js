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
  const index=APP.slice(APP.indexOf('function buildDetailImageIndex'),APP.indexOf('// Detay tablosunun başlıkları'));
  assert.match(index, /state\.cp,state\.orders/);
  assert.match(index, /kolRows/);
  assert.match(index, /state\.asasOrders/);
  assert.match(index, /BLModelImageCache\?\.buildDetailIndex/);
  assert.doesNotMatch(index, /byModel|byPlmOnly|modelAssetCanonicalPlmId/);
  assert.match(CSS, /\.detailImgCell img\{/);
});

test('v6.20 stored images are readable from every drill-down area', () => {
  assert.match(SERVER, /app\.get\('\/api\/collection-images\/:id', userAccess\.requireAnyArea\('source','koleksiyon','cp','orders','backlog','lfl','overview','priceanalysis','opencosting','shipping'\)/);
  assert.match(SERVER, /app\.get\('\/api\/cp-images\/:id', userAccess\.requireAnyArea\('cp','orders','backlog','koleksiyon','lfl','overview','priceanalysis','opencosting','shipping'\)/);
});

test('Backlog refuses old PLM-only images for a name-only identity', () => {
  const cache=require('../public/model-image-cache').createModelImageCache(globalThis);
  cache.setRegistryMap({'plm:2108736':'stored-image-id'});
  const index=cache.buildDetailIndex([{plmId:'2108736',modelName:'MINECRAFT-9-YD',colourCode:'QXM',season:'W7'}]);
  assert.equal(cache.resolveDetailSource(index,{modelName:'MINECRAFT-9-YD',colourCode:'QXM'}),'');
  assert.equal(cache.resolveDetailSource(index,{season:'W7',modelName:'MINECRAFT-9-YD',colourCode:'QXM'}),'');
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
