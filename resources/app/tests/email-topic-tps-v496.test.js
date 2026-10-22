'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function extractFunction(name, nextName) {
  const start = INDEX.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const end = INDEX.indexOf(`\n${nextName}`, start);
  assert.ok(end > start, `${name} bitişi bulunmalı`);
  return INDEX.slice(start, end);
}

test('e-posta başlığı düzenleyicisinde Add TPs seçeneği vardır ve kalıcı ayara yazılır', () => {
  assert.match(INDEX, /id="mailTopicIncludeTps"/);
  assert.match(INDEX, /en\?'Add TPs':'TP’leri ekle'/);
  assert.match(INDEX, /tps:typeof stored\?\.tps==='boolean'\?stored\.tps:defaults\.tps/);
  assert.match(INDEX, /mailTopicSetContentOptions\(kind,id,sourceKind,\{excel:includeExcel,table:includeTable,tps:includeTps\}\)/);
});

test('Send to Pricing eski davranışı korur, genel başlıklarda TPs varsayılan kapalıdır', () => {
  assert.match(INDEX, /kind==='pricing'\?\{excel:true,table:true,tps:true\}:\{excel:true,table:true,tps:false\}/);
  assert.match(INDEX, /contentOptions:\{cp:\{excel:false,table:false,tps:false\},collection:\{excel:false,table:false,tps:false\}\}/);
});

test('Add TPs açıkken kayıtlı model dosyaları seçili satırlardan yüklenir ve 9,5 MB planlayıcısına girer', () => {
  assert.match(INDEX, /kolListStoredModelFiles\(prepareEmailStoredModelRows\(getRows\(\)\)\)/);
  assert.match(INDEX, /pricingModelFiles\.filter\(entry=>!entry\.stored\|\|topicContent\.tps\)/);
  assert.match(INDEX, /pricingPrepareAttachmentPlans\(tableWorkbook,pricingFilesForManufacturer\(m\.name\),rowsFor\)/);
  assert.match(INDEX, /const PRICING_ATTACHMENT_LIMIT_BYTES = Math\.floor\(9\.5 \* 1024 \* 1024\)/);
});

test('CP satırları PLM ID ve model adıyla Koleksiyon TPs kayıtlarına eşlenebilir', () => {
  const source = extractFunction('prepareEmailStoredModelRows', 'async function kolListStoredModelFiles');
  const factory = new Function('kolRows', `return (${source.replace(/^function\s+prepareEmailStoredModelRows/, 'function')});`);
  const kolRows = [
    {id: 11, plmId: '9001', modelKod: 'MODEL-A'},
    {id: 12, plmId: '9002', modelKod: 'MODEL-B'},
    {id: 13, plmId: '', modelKod: 'MODEL-C'},
  ];
  const fn = factory(kolRows);
  const result = fn([
    {id: -1, plmId: '9001', modelKod: 'MODEL-A'},
    {id: -2, 'PLM ID': '9002', 'Model Name': 'MODEL-B'},
    {id: -3, modelKod: 'MODEL-C'},
  ]);
  assert.deepEqual(result.map(row => row.id), [11, 12, 13]);
});

test('üç e-posta içerik seçeneği geniş ekranda yan yana gösterilir', () => {
  assert.match(CSS, /\.mailTopicOptionGrid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:10px;\}/);
});
