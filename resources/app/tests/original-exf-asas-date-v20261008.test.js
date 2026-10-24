'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fields = require('../server/lib/model-fields');
const parse = require('../server/lib/parse');
const names = require('../public/column-display-names');
const target = 'Initial Inspection Geçme Tarih Gün Ay Yıl';
const merch = 'Orijinal Exfactory Merch Tarih';
const calendarDay = value => {
  assert.ok(value instanceof Date && !Number.isNaN(value.getTime()));
  return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
};

test('Original Ex-F. auto-maps exact date in Dates, while Ex-factory retains its merch date', () => {
  const schema = { columns: [
    { table:'ASAS', name:merch, kind:'column' },
    { table:'ASAS', name:target, kind:'column' },
    { table:'Dates', name:target, kind:'column' },
    { table:'ASAS', name:'Initial Inspection Geçme Tarih', kind:'column' }
  ], measures:[] };
  const mapping = fields.autoMapSchema('asas', schema).mapping;
  assert.equal(mapping[target].table, 'Dates');
  assert.equal(mapping[target].name, target);
  assert.equal(mapping[merch].name, merch);
  assert.equal(mapping['Initial Inspection Geçme Tarih'].name, 'Initial Inspection Geçme Tarih');
  assert.equal(names.sourceFor('cp',{k:'Original Ex-factory'}).field, target);
  assert.equal(names.sourceFor('cp',{k:'Ex-factory'}).field, merch);
});

test('ASAS date parses separately and does not alter Ex-factory', () => {
  const result = parse.parseASASRows([{
    'Sipariş Kod':1000101, 'Renk':'Blue', 'Renk Kod':'01', 'Model Adı':'MODEL', 'Üretici':'SUPPLIER',
    'Sezon':'W6', 'Buyer Grup (TR)':'LISANS', 'Merch Alt Grup Kod':'CU4E',
    'Net Alım Sipariş Miktarı':10, 'Kalan Alım Sipariş Miktarı':10,
    [merch]:'2026-09-11', [target]:'2026-09-03', 'Initial Inspection Geçme Tarih':'2026-09-05'
  }]);
  assert.equal(result.orders.length,1);
  const order = result.orders[0];
  assert.equal(calendarDay(order.ex),'2026-09-11');
  assert.equal(calendarDay(order.originalExFactoryDate),'2026-09-03');
  const rows = parse.buildOrdersRowsFromASAS(result.orders,{}, {});
  assert.equal(calendarDay(rows[0]['Original Ex-factory']),'2026-09-03');
  assert.equal(calendarDay(rows[0]['Ex-factory']),'2026-09-11');
});

test('missing full date remains null instead of matching month/week or merch date',()=>{
  const { orders } = parse.parseASASRows([{
    'Sipariş Kod':1000102,'Renk':'Blue','Renk Kod':'02','Model Adı':'MODEL',
    'Net Alım Sipariş Miktarı':10, [merch]:'2026-09-11','Initial Inspection Geçme Merch Ay':'2026-09'
  }]);
  assert.equal(orders[0].originalExFactoryDate,null);
  assert.equal(calendarDay(orders[0].ex),'2026-09-11');
});

test('offline CP/Orders row builders and source parser use separate source date',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const expected="'Original Ex-factory':o.originalExFactoryDate||null, 'Ex-factory':o.ex";
  assert.equal(app.split(expected).length-1,2);
  assert.ok(app.includes("originalExFactoryDate: yyyymmdd(g(row,'Initial Inspection Geçme Tarih Gün Ay Yıl'))"));
});
