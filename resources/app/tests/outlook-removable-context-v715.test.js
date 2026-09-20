'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const graph = require('../server/lib/outlook-graph');
const localLib = require('../server/lib/outlook-local');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'outlook-mail.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'outlook-mail.css'), 'utf8');
const LOCAL = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'outlook-local.js'), 'utf8');

const CONTEXT = {
  orderNo:'1355359', poNo:'PO-1355359', plmCode:'1202391', styleId:'S-1202391',
  modelName:'PNT,NEXTY-YD', modelCode:'MODEL-88', colourCode:'311',
  manufacturer:'DRAGONI FASHIONS LTD', supplier:'DRAGONI'
};

test('üstteki otomatik kriter chipleri bağımsız kaldırılabilir ve geri eklenebilir', () => {
  assert.match(UI, /data-outlook-context-remove/);
  assert.match(UI, /data-outlook-context-add/);
  assert.match(UI, /Kaldırılan kriterler/);
  assert.match(UI, /contextFields:new Set/);
  assert.match(UI, /updateContextControls/);
  assert.match(CSS, /outlookContextChip/);
  assert.match(CSS, /outlookContextRestore/);
});

test('kriter grupları alias alanlarıyla birlikte gerçek arama alanlarına genişletilir', () => {
  assert.match(UI, /members:\['orderNo','poNo'\]/);
  assert.match(UI, /members:\['plmCode','styleId'\]/);
  assert.match(UI, /members:\['modelName','modelCode'\]/);
  assert.match(UI, /members:\['manufacturer','supplier'\]/);
  assert.match(UI, /fields: expandedContextFields\(\)/);
});

test('Graph açıkça boş fields aldığında otomatik context alanlarına geri dönmez', () => {
  const none = graph.buildSearchQueries(CONTEXT, { fields:[] });
  assert.deepEqual(none, []);
  const manualOnly = graph.buildSearchQueries(CONTEXT, { fields:[], manual:'RFID' });
  assert.ok(manualOnly.length >= 1);
  assert.ok(manualOnly.every(item => /RFID/i.test(item.queryString)));
  assert.ok(manualOnly.every(item => !/1355359|1202391|NEXTY|311|DRAGONI/i.test(item.queryString)));
});

test('Graph score açıkça kaldırılan alanları relevance hesabına dahil etmez', () => {
  const message = { subject:'1355359 PNT,NEXTY-YD', bodyPreview:'1202391 311 DRAGONI', receivedDateTime:new Date().toISOString() };
  const none = graph.scoreMessage(message, CONTEXT, { fields:[] });
  assert.equal(none.matchedFields.some(item => ['orderNo','poNo','plmCode','styleId','modelName','modelCode','colourCode','manufacturer','supplier'].includes(item.field)), false);
  const onlyModel = graph.scoreMessage(message, CONTEXT, { fields:['modelName','modelCode'] });
  assert.equal(onlyModel.matchedFields.some(item => item.field === 'modelName'), true);
  assert.equal(onlyModel.matchedFields.some(item => item.field === 'orderNo'), false);
});

test('Classic Outlook local araması da explicit boş fields değerini otomatik alanlara geri çevirmiyor', () => {
  assert.match(LOCAL, /Array\.isArray\(searchOptions\.fields\)\?new Set/);
  assert.doesNotMatch(LOCAL, /Array\.isArray\(searchOptions\.fields\)&&searchOptions\.fields\.length/);
  const service = localLib.createOutlookLocalService({ platform:'linux' });
  assert.deepEqual(service.searchTerms(CONTEXT, { fields:[] }), []);
  assert.match(service.bridgeQuery(CONTEXT, { fields:[], manual:'approval' }), /approval/);
  assert.doesNotMatch(service.bridgeQuery(CONTEXT, { fields:[], manual:'approval' }), /1355359|1202391|NEXTY|311|DRAGONI/);
});

test('tüm otomatik kriterler kaldırılırsa manuel kriter yokken frontend boş aramayı engeller', () => {
  assert.match(UI, /Arama kriteri kalmadı\./);
  assert.match(UI, /!options\.fields\.length && !options\.manual/);
});
