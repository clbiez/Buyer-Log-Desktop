'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const OAB=fs.readFileSync(path.join(ROOT,'public','oab.js'),'utf8');
const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');

test('OAB pivot alt detayı ortak sağ detay çekmecesini kullanır',()=>{
  const body=OAB.slice(OAB.indexOf('function oabOpenPivotDetail'),OAB.indexOf('function oabRenderPivotTable'));
  assert.match(body,/global\.BLDetailDrawer && typeof global\.BLDetailDrawer\.open === 'function'/);
  assert.match(body,/global\.BLDetailDrawer\.open\(\{/);
  assert.match(body,/storageKey: 'oab\.pivot\.detail'/);
  assert.match(body,/pageScope: 'overview\.oab'/);
  assert.match(body,/defaultVisible: summaryFields/);
  assert.match(body,/columns,/);
  assert.match(body,/images: true/);
});

test('OAB drawer tüm kaynak alanlarını sütun kataloğuna taşır ve Option Adı PLM linkini korur',()=>{
  const body=OAB.slice(OAB.indexOf('function oabOpenPivotDetail'),OAB.indexOf('function oabRenderPivotTable'));
  assert.match(body,/const columns = allFields\.map\(field => \(\{/);
  assert.match(body,/format: value => oabDrillCellText\(field, value\)/);
  assert.match(body,/exportValue: value => oabDrillExportCell\(field, value\)/);
  assert.match(body,/html: oabIsOptionNameField\(field\) \? source => oabOptionPlmLinkHtml/);
});

test('ortak drawer ilk görünür sütun setini destekler ve kullanıcı tercihi varsa onu korur',()=>{
  assert.match(DRAWER,/function loadVisible\(scope,page,columns,defaults\)/);
  assert.match(DRAWER,/const preferred=Array\.isArray\(defaults\)\?defaults\.filter/);
  assert.match(DRAWER,/input\.defaultVisible\|\|input\.initialVisible/);
});

test('ortak drawer OAB model kimliklerini görsel ve PLM SYNC için tanır',()=>{
  assert.match(DRAWER,/'Option Adı','Option Name'/);
  assert.match(DRAWER,/'Plm Kod','PLM Kod','PLM Code'/);
  assert.match(DRAWER,/BLDetailImages\?\.resolvePlmId/);
  assert.match(DRAWER,/'Renk Adı'/);
});
