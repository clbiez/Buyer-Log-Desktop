'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ExcelJS = require('../public/vendor/exceljs.min.js');
const JSZip = require('../public/vendor/jszip.min.js');
const XLSX = require('xlsx');
const DATES = require('../public/excel-date-utils.js');
const Engine = require('../public/excel-template-engine.js');

test('saved custom Capacity template recalculates mapped cells after column reordering', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Custom');
  ws.addRow(['Garments', 'Quantity', 'Ex-factory', 'PO', 'Retail', 'PO to Ex', 'Ex to Retail']);
  ws.getRow(2).getCell(1).value = 0;
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const mapping = [
    'garmentQty', 'units', 'exFactoryDate', 'poIssuingDate',
    'retailStockDate', 'poIssueToExFactory', 'exFactoryToRetail'
  ];
  const config = {
    sheetName: 'Custom', headerRow: 1, dataRow: 2,
    columns: mapping.map((field, i) => ({column: i+1, field: 'capacity:'+field, header: field}))
  };
  const key = 'bl.excelTemplates.capacity.v1';
  const preference = {value: JSON.stringify({config, name:'custom.xlsx', bytes:bytes.toString('base64')})};
  const root = {
    BLExcelTemplateEngine: Engine, BLExcelDates: DATES, JSZip,
    BLPerf: {ensureLibrary: async () => {}}
  };
  const sandbox = {
    window: root,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    fetch: async () => ({ok:true, json:async () => ({entries:{[key]:preference}})})
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/excel-templates.js'), 'utf8'), sandbox);
  const output = await root.BLExcelTemplates.build('capacity', [{
    'capacity:garmentQty':240, 'capacity:units':120, garmentMultiplier:2,
    'capacity:exFactoryDate':new Date(2026,9,20),
    'capacity:poIssuingDate':new Date(2026,9,2),
    'capacity:retailStockDate':new Date(2026,10,1),
    'capacity:poIssueToExFactory':18,
    'capacity:exFactoryToRetail':12
  }], null);
  const read = XLSX.read(Buffer.from(output), {type:'buffer'});
  const sheet = read.Sheets.Custom;
  assert.equal(sheet.A2.f, 'IF(B2="","",B2*2)');
  assert.equal(sheet.F2.f, 'IF(OR(D2="",C2=""),"",C2-D2)');
  assert.equal(sheet.G2.f, 'IF(OR(C2="",E2=""),"",E2-C2)');
  assert.equal(sheet.A2.v, 240);
  assert.equal(sheet.F2.v, 18);
  const zip = await JSZip.loadAsync(output);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  assert.match(workbookXml, /<calcPr\b[^>]*fullCalcOnLoad="1"/);
});

test('saved template formulas do not reference unavailable columns', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Simple');
  ws.addRow(['Garments']);ws.addRow([0]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const cfg={sheetName:'Simple',headerRow:1,dataRow:2,columns:[{column:1,field:'capacity:garmentQty'}]};
  const output=await Engine.fill(bytes,cfg,[{'capacity:garmentQty':240}],JSZip,DATES);
  const sheet=XLSX.read(Buffer.from(output),{type:'buffer'}).Sheets.Simple;
  assert.equal(sheet.A2.v,240);
  assert.equal(sheet.A2.f,undefined);
});
