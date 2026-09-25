'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../public/vendor/jszip.min.js');
const guards = require('../public/excel-workbook-guards');
const formulas = require('../public/backlog-excel-formulas');

const ROOT = path.join(__dirname, '..');

const WORKSHEET_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<dimension ref="A1:D3"/><sheetData>'
  + '<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Direct</t></is></c><c r="B1" s="1" t="inlineStr"><is><t>Formula</t></is></c><c r="C1" s="1" t="inlineStr"><is><t>Helper</t></is></c><c r="D1" s="1" t="inlineStr"><is><t>Risk</t></is></c></row>'
  + '<row r="2"><c r="A2" s="1"><v>1</v></c><c r="B2" s="1"><f>A2+1</f><v>2</v></c><c r="C2"><f>A2*2</f><v>2</v></c><c r="D2" s="1" t="inlineStr"><is><t>VAR</t></is></c></row>'
  + '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f>A3+1</f><v>4</v></c><c r="C3" s="1"><v>70</v></c><c r="D3" t="inlineStr"><is><t>YOK</t></is></c></row>'
  + '</sheetData><autoFilter ref="A1:D3"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
  + '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf></cellXfs>'
  + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium9"/></styleSheet>';

test('Backlog sheet protection unlocks only direct visible cells and keeps formulas/helpers locked', async () => {
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', WORKSHEET_XML);
  zip.file('xl/styles.xml', STYLES_XML);
  zip.file('[Content_Types].xml', '<Types/>');
  const raw = await zip.generateAsync({ type: 'nodebuffer' });
  const patched = await guards.applyWorkbookGuards(raw, {
    validations: [{
      sheetPath: 'xl/worksheets/sheet1.xml', sqref: 'D2:D3', values: ['VAR', 'YOK'], allowBlank: false,
    }],
    protections: [{
      sheetPath: 'xl/worksheets/sheet1.xml', unlockedSqrefs: ['A2:A3', 'D2:D3'], allowAutoFilter: true, allowSort: true,
    }],
  }, JSZip, 'nodebuffer');
  const reopened = await JSZip.loadAsync(patched);
  const sheet = await reopened.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await reopened.file('xl/styles.xml').async('string');

  assert.match(sheet, /<sheetProtection\b[^>]*sheet="1"[^>]*formatColumns="1"[^>]*autoFilter="0"[^>]*\/>/);
  assert.ok(sheet.indexOf('<sheetProtection') < sheet.indexOf('<autoFilter'));
  assert.match(sheet, /<dataValidation\b[^>]*allowBlank="0"[^>]*sqref="D2:D3"/);
  assert.match(sheet, /<formula1>&quot;VAR,YOK&quot;<\/formula1>/);

  assert.match(styles, /<cellXfs count="4">/);
  assert.equal((styles.match(/<protection locked="0" hidden="0"\/>/g) || []).length, 2);
  assert.match(sheet, /<c r="A2" s="3">/);
  assert.match(sheet, /<c s="2" r="A3">/);
  assert.match(sheet, /<c r="D2" s="3"/);
  assert.match(sheet, /<c s="2" r="D3"/);
  assert.match(sheet, /<c r="B2" s="1"><f>/, 'formula cell keeps its locked original style');
  assert.match(sheet, /<c r="B3"><f>/, 'formula cell with default style remains locked');
  assert.match(sheet, /<c r="C2"><f>/, 'hidden helper formula remains locked');
  assert.match(sheet, /<c r="C3" s="1">/, 'hidden helper value remains locked');
});

test('Backlog risk is reduced to the required VAR/YOK business values', () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'xlsx') return { SSF: {}, utils: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  let parse;
  try {
    const resolved = require.resolve('../server/lib/parse');
    delete require.cache[resolved];
    parse = require('../server/lib/parse');
  } finally { Module._load = originalLoad; }
  assert.equal(parse.backlogRiskFromSignals([], false), 'YOK');
  assert.equal(parse.backlogRiskFromSignals([{code:'DELIVERY_DELAY'}], false), 'VAR');
  assert.equal(parse.backlogRiskFromSignals([], true), 'VAR');
  assert.equal(typeof parse.backlogRiskValue, 'undefined');
});

// Tarayıcı tarafı Backlog Excel dışa aktarım kodu index.html'den app-main.js'e taşındı;
// saveWorkbookWithValidations çağrısı da rules.* nesnesi + {freezePanes} alan 6 argümana
// genişledi. 'Üretici Tükleme Tipi Teyidi' FORMULA_HEADERS'a eklendi (version-history v-753).
test('browser and worker exports remove sheet protection for sorting while keeping strict validations and hidden helpers', () => {
  const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'server/workers/excel-worker.js'), 'utf8');
  assert.deepEqual([...formulas.FORMULA_HEADERS], [
    'Net Gelen Alım Sipariş Miktarı', 'ANTREPO GİRİŞ TARİHİ', 'ANTREPO-RETAIL', 'Üretici Tükleme Tipi Teyidi', 'RİSK\n(PRIORITY)',
  ]);
  assert.match(appMain, /values:\['VAR','YOK'\]/);
  assert.match(appMain, /allowBlank:false/);
  assert.match(appMain, /removeProtection:true/);
  assert.match(appMain, /saveWorkbookWithValidations\([\s\S]*?Backlog_Report_\$\{stamp\}\.xlsx[\s\S]*?rules\.validations[\s\S]*?rules\.conditionalFormats[\s\S]*?rules\.protections[\s\S]*?freezePanes:rules\.freezePanes[\s\S]*?charts:chartExport/);
  assert.doesNotMatch(appMain, /const formulaHeaders=new Set\(BLBacklogExcel\.FORMULA_HEADERS/);
  assert.match(worker, /values: \['VAR', 'YOK'\]/);
  assert.match(worker, /removeProtection: true/);
  assert.doesNotMatch(worker, /const formulaHeaders = new Set\(BLBacklogExcel\.FORMULA_HEADERS/);
  assert.match(worker, /helperHeaders\.map\(header => BLBacklogExcel\.columnSpec\(header, \{ helper: true \}\)\)/);
});
