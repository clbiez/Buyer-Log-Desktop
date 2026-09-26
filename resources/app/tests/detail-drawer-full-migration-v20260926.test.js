'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');

test('Collection Analytics detayları ortak sağ çekmeceyi kullanır',()=>{
  assert.ok(APP.includes("storageKey:'collection.analytics.detail'"));
});
test('Price & Supplier Analysis detayları ortak sağ çekmeceyi kullanır',()=>{
  assert.ok(APP.includes("storageKey:'priceSupplier."));
  assert.ok(APP.includes("source:'price-supplier'"));
});
test('Backlog pivot ve CP Orders raporları ortak sağ çekmeceyi kullanır',()=>{
  assert.ok(APP.split("storageKey:'backlog.report.detail'").length-1>=2);
});
test('Uyarı satır detayları ortak sağ çekmeceyi kullanır',()=>{
  assert.ok(APP.includes("storageKey:'warning.detail'"));
});
test('Ortak çekmece görselli Excel export yapar',()=>{
  assert.ok(DRAWER.includes('prepareForExcel'));
  assert.ok(DRAWER.includes('moveAndSizeWithCells:true'));
  assert.ok(DRAWER.includes('seçili sütunlar Excel'));
});
test('Collection modelKod kimliği görsel eşleştirmesinde desteklenir',()=>{
  assert.ok(DRAWER.includes('modelKod'));
  assert.ok(DRAWER.includes('helper.sourceFor'));
});
