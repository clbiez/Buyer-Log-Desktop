'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');

test('Collection Analytics detayları ortak sağ çekmeceyi kullanır',()=>{assert.match(APP,/storageKey:'collection\\.analytics\\.detail'/);});
test('Price & Supplier Analysis detayları ortak sağ çekmeceyi kullanır',()=>{assert.match(APP,/storageKey:'priceSupplier\\.'/);assert.match(APP,/source:'price-supplier'/);});
test('Backlog pivot ve CP Orders raporları ortak sağ çekmeceyi kullanır',()=>{const hits=APP.match(/storageKey:'backlog\\.report\\.detail'/g)||[];assert.ok(hits.length>=2);});
test('Uyarı satır detayları ortak sağ çekmeceyi kullanır',()=>{assert.match(APP,/storageKey:'warning\\.detail'/);});
test('Ortak çekmece görselli Excel export yapar',()=>{assert.match(DRAWER,/prepareForExcel/);assert.match(DRAWER,/moveAndSizeWithCells:true/);assert.match(DRAWER,/seçili sütunlar Excel/);});
test('Collection modelKod kimliği görsel eşleştirmesinde desteklenir',()=>{assert.match(DRAWER,/modelKod/);assert.match(DRAWER,/helper\\.sourceFor/);});
