'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../public/vendor/jszip.min.js');
const guards = require('../public/excel-workbook-guards.js');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// Backlog/Koleksiyon dışa aktarım ve Drop mantığı index.html'den app-main.js'e taşındı.
const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'server/workers/excel-worker.js'), 'utf8');

test('explicit protection removal strips an existing worksheet guard without changing validations', async () => {
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><sheetProtection sheet="1" sort="0" autoFilter="0"/><dataValidations count="1"><dataValidation type="list" sqref="A1"><formula1>&quot;A,B&quot;</formula1></dataValidation></dataValidations></worksheet>');
  zip.file('xl/styles.xml', '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>');
  const raw = await zip.generateAsync({ type: 'nodebuffer' });
  const patched = await guards.applyWorkbookGuards(raw, { protections: [{ sheetPath: 'xl/worksheets/sheet1.xml', removeProtection: true }] }, JSZip, 'nodebuffer');
  const reopened = await JSZip.loadAsync(patched);
  const sheet = await reopened.file('xl/worksheets/sheet1.xml').async('string');
  assert.doesNotMatch(sheet, /<sheetProtection\b/);
  assert.match(sheet, /<dataValidations count="1">/);
});

test('Backlog exports are sorting-friendly while dropdown guards remain', () => {
  assert.match(appMain, /protections:\[\{sheetPath:'xl\/worksheets\/sheet1\.xml',removeProtection:true\}\]/);
  assert.match(worker, /protections: \[\{ sheetPath: 'xl\/worksheets\/sheet1\.xml', removeProtection: true \}\]/);
});

test('Collection Drop button is directly before Delete Selected and marks selected models without deleting them', () => {
  // Buton DOM sırası/etiketi index.html'de kalıyor; tıklama davranışı app-main.js'te.
  const dropIndex = html.indexOf('id="kolDropSelectedBtn"');
  const deleteIndex = html.indexOf('id="kolDelRowBtn"');
  assert.ok(dropIndex >= 0 && deleteIndex > dropIndex);
  assert.match(html.slice(dropIndex, deleteIndex), /data-i18n-tr="İptal Et" data-i18n-en="Drop"/);
  assert.match(appMain, /function dropKolSelectedRows\(\)/);
  assert.match(appMain, /const active=selected\.filter\(r=>!r\.dropped\)/);
  assert.match(appMain, /active\.forEach\(row=>\{row\.dropped=true;\}\)/);
  assert.match(appMain, /kolPushUndo\(\);[\s\S]*saveKolRows\(\); renderKol\(\)/);
  assert.match(appMain, /document\.getElementById\('kolDropSelectedBtn'\)\?\.addEventListener\('click',dropKolSelectedRows\)/);
});
