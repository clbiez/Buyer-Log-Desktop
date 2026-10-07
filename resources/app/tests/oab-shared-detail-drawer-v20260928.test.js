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
  assert.match(body,/storageKey: `oab\.pivot\.detail\.\$\{/);
  assert.match(body,/pageScope: 'overview\.oab'/);
  assert.match(body,/defaultVisible: summaryFields/);
  assert.match(body,/exactDefaultVisible: true/);
  assert.match(body,/requiredVisible: descriptor && descriptor\.sourceField/);
  assert.match(body,/flatColumns: true/);
  assert.match(body,/columns,/);
  assert.match(body,/images: true/);
});

test('OAB drawer tüm kaynak alanlarını sütun kataloğuna taşır ve Option Adı PLM linkini korur',()=>{
  const body=OAB.slice(OAB.indexOf('function oabOpenPivotDetail'),OAB.indexOf('function oabRenderPivotTable'));
  assert.match(body,/const columns = allFields\.map\(field => \(\{/);
  assert.match(body,/group: oabDrillFieldGroup\(field\)/);
  assert.match(body,/type: oabDrillDateKind\(field\)/);
  assert.match(body,/format: value => oabDrillCellText\(field, value\)/);
  assert.match(body,/exportValue: value => oabDrillExportCell\(field, value\)/);
  assert.match(body,/html: oabIsOptionNameField\(field\) \? source => oabOptionPlmLinkHtml/);
});

test('ortak drawer kesin başlangıç seti, zorunlu metrik ve flat kolon modunu destekler',()=>{
  assert.match(DRAWER,/function loadVisible\(scope,page,columns,defaults\)/);
  assert.match(DRAWER,/const preferred=Array\.isArray\(defaults\)\?defaults\.filter/);
  assert.match(DRAWER,/input\.exactDefaultVisible===true/);
  assert.match(DRAWER,/requiredVisible:new Set\(requiredVisible\)/);
  assert.match(DRAWER,/flatColumns:input\.flatColumns===true/);
  assert.match(DRAWER,/if\(active\.flatColumns\)return current\.map/);
  assert.match(DRAWER,/groupHeaderHtml\(columns,showImages\)/);
});

test('ortak drawer OAB model kimliklerini görsel ve PLM SYNC için tanır',()=>{
  assert.match(DRAWER,/'Option Adı','Option Name'/);
  assert.match(DRAWER,/'Plm Kod','PLM Kod','PLM Code'/);
  assert.match(DRAWER,/BLDetailImages\?\.resolvePlmId/);
  assert.match(DRAWER,/'Renk Adı'/);
});


test('OAB drill-down seçili sayısal metriğin sıfır satırlarını eler ve metriği en sağa taşır',()=>{
  assert.match(OAB,/function oabDrillMetricRows\(rows, descriptor\)/);
  assert.match(OAB,/return value != null && value !== 0/);
  assert.match(OAB,/oabDrillMetricRows\(oabPivotCellSourceRows/);
  assert.match(OAB,/function oabDrillOrderedFields\(fields, selectedField\)/);
  assert.match(OAB,/if \(selected && availableSet\.has\(selected\)\) ordered\.push\(selected\)/);
  const summary=OAB.slice(OAB.indexOf('function oabDrillSummaryFields'),OAB.indexOf('function oabDrillSortRows'));
  assert.doesNotMatch(summary,/\['Plan Sipariş Miktarı', 'Onaylı Sipariş Miktarı', 'PO Miktarı'\]/);
  assert.match(summary,/OAB_DRILL_METRIC_DEPENDENCIES\[sourceField\]/);
});

test('OAB drill-down Excel rehberindeki üst başlıkları ve tarih/kod biçimlerini kullanır',()=>{
  assert.match(OAB,/const OAB_DRILL_LAYOUT = Object\.freeze\(\[/);
  for(const heading of ['Satın Alma','Model Özellikleri','Model Bütçe','Planlama','Asorti & Fiyat','Mark-Up','Tedarik Sepeti Adet','Plan Sipariş','Alım Dönem Sipariş','Onaylı Sipariş','Onaysız Sipariş','Yedek Bütçe','Hızlı Sipariş','WSSI','PO','PO Geçilmemiş Adet'])assert.ok(OAB.includes(heading),heading);
  assert.match(OAB,/\['baslangic yil hafta','bitis yil hafta','start year week','end year week'\]/);
  assert.match(OAB,/\['siparis onaylama ayi','order approval month'\]/);
  assert.match(OAB,/\['retail depo tarihi','retail warehouse date'\]/);
  assert.match(OAB,/mondayFromBusinessWeek/);
  assert.match(OAB,/period\.weekLabelTr/);
  assert.match(OAB,/week < 1 \|\| week > 52/);
  assert.match(OAB,/return `\$\{oabDrillMonthName\(month\)\} \$\{year\}`/);
  assert.match(OAB,/return `\$\{pad\(date\.getDate\(\)\)\}\.\$\{pad\(date\.getMonth\(\) \+ 1\)\}\.\$\{String\(date\.getFullYear\(\)\)\.slice\(-2\)\}`/);
  assert.match(OAB,/if \(isLikelyCodeField\(field\)\) return String\(value\)/);
});
