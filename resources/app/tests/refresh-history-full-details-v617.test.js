'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const diff = require('../server/lib/refresh-history-diff');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function row(status, sourceRow, extra = {}) {
  const source = {
    'Sipariş Kod':'1295688','Ürün Adı':'TKM,REALMADRID-2-TKM-YD','Renk Kod':'BLK','Renk Tanım':'LIGHT GREY',
    'Supplier Portal Statü':status,'Tahmini Antrepo Giriş Tarihi':'2026-08-20','Yükleme Toplam Adet':500,
    ...extra,
  };
  return {
    ocode:'1295688',_matchOcode:'1295688',model:'TKM,REALMADRID-2-TKM-YD',ccode:'BLK',colour:'LIGHT GREY',
    statu:status,loadedQty:500,_sourceRow:sourceRow,_sourceFields:source,
  };
}

test('v6.17 Antrepo row order changes do not create false history details', () => {
  const a = row('Yol Operasyonları', 1, {'Konteyner No':'C-1'});
  const b = row('Depoda', 2, {'Konteyner No':'C-2'});
  const pairs = diff.pairAntrepoRows({__ias_row_1:a,__ias_row_2:b}, {__ias_row_9:{...b,_sourceRow:9},__ias_row_10:{...a,_sourceRow:10}});
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every(pair => pair.kind === 'same'));
  assert.deepEqual(pairs.flatMap(pair => diff.fieldChanges(pair.oldRow,pair.newRow)), []);
});

test('v6.17 compares every real source field with explicit previous and new values', () => {
  const oldRow = row('Yol Operasyonları', 1, {'Konteyner No':'C-1','Özel Kaynak Alanı':'A'});
  const newRow = row('Depoda', 14, {'Konteyner No':'C-1','Özel Kaynak Alanı':'B'});
  const pair = diff.pairAntrepoRows({__ias_row_1:oldRow}, {__ias_row_14:newRow})[0];
  assert.equal(pair.kind, 'changed');
  assert.deepEqual(diff.fieldChanges(pair.oldRow,pair.newRow), [
    {field:'Özel Kaynak Alanı',before:'A',after:'B'},
    {field:'Supplier Portal Statü',before:'Yol Operasyonları',after:'Depoda'},
  ]);
});

test('v6.17 preserves duplicate partial rows while matching unchanged copies first', () => {
  const first = row('Depoda', 1);
  const second = row('Depoda', 2);
  const changed = row('Yol Operasyonları', 20);
  const pairs = diff.pairAntrepoRows({__ias_row_1:first,__ias_row_2:second}, {__ias_row_19:{...first,_sourceRow:19},__ias_row_20:changed});
  assert.equal(pairs.filter(pair => pair.kind === 'same').length, 1);
  assert.equal(pairs.filter(pair => pair.kind === 'changed').length, 1);
});

test('v6.17 history UI is independent of screen CP filters and exposes all subdetails', () => {
  assert.match(APP, /Ekrandaki mevcut CP tablo filtreleri bu kaydı etkilemez/);
  for (const label of ['Renk Kodu','İthalat Dosyası','Konteyner','Alan','Önceki','Yeni']) assert.ok(APP.includes(label), `${label} missing`);
  assert.match(APP, /d\.field,d\.before,d\.after/);
  assert.match(APP, /A1:T/);
  assert.match(SERVER, /refreshHistoryDiff\.pairAntrepoRows/);
  assert.match(SERVER, /sourceScopes/);
});
