'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'public','user-access-ui.js'),'utf8');

test('v5.21 MB List screen and its note API are removed while Collection MB Excel remains',()=>{
  assert.doesNotMatch(INDEX,/data-tab="mb"/);
  assert.doesNotMatch(INDEX,/id="view-mb"/);
  assert.doesNotMatch(APP,/function mbLoad\(/);
  assert.doesNotMatch(APP,/function renderMbList\(/);
  assert.doesNotMatch(SERVER,/app\.get\('\/api\/mb-list'/);
  assert.doesNotMatch(SERVER,/app\.patch\('\/api\/mb-list\/note'/);
  assert.doesNotMatch(ACCESS,/key==='mb'/);
  // v6.30 araç çubuğu sadeleştirmesi: "Seçilenler" grubu (kolSelectedGroupLabel) ve ayrı
  // ikincil araç çubuğu (kolSecondaryToolbar) kaldırıldı.
  // v7.81 — "İçe / Dışa Aktar" sekmesi kullanıcı talebiyle KALDIRILDI; MB Listesi
  // dışa aktarımı Araçlar (kolToolsMenu) menüsüne taşındı. Sınanan şey aynı kalıyor:
  // düğme Koleksiyon araç çubuğunda duruyor ve tek bir yerde bulunuyor (çoklanmıyor).
  const tableActions=INDEX.slice(INDEX.indexOf('id="kolTableActions"'),INDEX.indexOf('id="kolCount"'));
  assert.match(tableActions,/id="kolToolsMenu"[\s\S]*?id="kolMbExportBtn"/);
  assert.doesNotMatch(INDEX,/id="kolIoMenu"/, 'İçe / Dışa Aktar menüsü kaldırılmış olmalı');
  assert.equal((INDEX.match(/id="kolMbExportBtn"/g)||[]).length,1,'MB dışa aktarım düğmesi tek olmalı');
  assert.match(APP,/function kolExportSelectedMb\(/);
});

test('v5.21 Collection keeps MB source fields and fixes Assortment as a permanent editable column',()=>{
  /* v7.81 — Fabric Supplier/Price S6-S7 ve Previous Season FOB Koleksiyon
     TABLOSUNDAN kaldırıldı (kullanıcı talebi). Alanların kendisi duruyor:
     migrateKolRow onları her satırda kurmaya devam ediyor ve mbDerived MB
     hesaplarında (fabricLfl, önceki sezon LFL) okuyor. Bu testin koruduğu
     şey zaten alanın YAŞAMASI; sütun olarak görünmesi ayrı bir karardı. */
  for(const key of ['mbOrderType','colourCode','assortment']){
    assert.match(APP,new RegExp(`k:'${key}'`));
  }
  const migrate=APP.slice(APP.indexOf('function migrateKolRow'),APP.indexOf('if(r.buyingSampleApproved===undefined'));
  assert.ok(migrate.length>0,'migrateKolRow bulunamadı');
  for(const key of ['previousFob','fabricSupplierS6','fabricPriceS6','fabricSupplierS7','fabricPriceS7']){
    assert.ok(migrate.includes(`'${key}'`),`${key} satırda kurulmuyor — MB hesapları sessizce boşalır`);
  }
  assert.match(APP,/legacyAssortment/);
  assert.match(APP,/turknorm\(norm\(col&&col\.label\)\)==='ASSORTMENT'/);
});

test('v5.21 MB Excel uses confirmed supplier/FOB only and price history is best-first with manufacturer in same cell',()=>{
  assert.match(APP,/const supplier=confirmed\?confirmed\.name:''/);
  assert.match(APP,/confirmedFob=confirmed\?Number\(confirmed\.price\):null/);
  assert.match(APP,/\.sort\(\(a,b\)=>a\.price-b\.price/);
  assert.match(APP,/return item\?`\$\$\{kolFormatMoneyDisplay\(String\(item\.price\)\)\} · \$\{item\.name\}`:''/);
  assert.match(APP,/ci===24[\s\S]*?cell\.numFmt='₺#,##0\.00'/);
});

test('v5.21 MB Excel keeps the uploaded 41-column MB layout',()=>{
  const headers=['PBL NAME','BUYER','STATU / ORDER TYPE','Supplier Name','Buyer Group','CATEGORY','LINE','SPECIAL CODE','PLM ID','STYLE NAME','COLOR CODE','COLOR','EXFACTORY DATE','RETAIL DATE (Retail Date)','MB DATE (In Store Date)','MB MONTH (In Store Month)','VESSEL / LEAD TIME (Ex->Retail)','7S QTY (Quantity)','MEVCUT DURUM (Status)','PBL NOT','6S FOB','7S Confirmed FOB','7S Confirmed LANDED','LFL DEGISIM 6S&7S','TR TARGET (TR FOB)','KUR','TR USD LANDED + %5','Advantage FROM TR PRICE','FABRIC SUPPLIER S6','FABRIC PRICE S6','FABRIC SUPPLIER S7','FABRIC PRICE S7','FABRIC LFL DEGISIM','FABRIC','FIT','Pricing History 1.','Pricing History 2.','Pricing History 3.','Pricing History 4.','Pricing History 5.','Buying Sample'];
  for(const header of headers) assert.ok(APP.includes(`'${header.replace(/'/g,"\\'")}'`)||APP.includes(`\`${header}\``),`missing ${header}`);
  assert.match(APP,/MB_LIST_HEADERS/);
  assert.match(APP,/mbExportExcel/);
});
