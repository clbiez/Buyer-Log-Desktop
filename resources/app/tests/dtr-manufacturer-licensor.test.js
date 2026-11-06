'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const business = require('../public/business-rules');
const parse = require('../server/lib/parse');
const db = require('../server/db');
const rules = ['DTR', 'Agency'].map(licensor => ({license:'Demo License',licensor,opdStart:'2026-01-01'}));
const order = {ocode:7409,model:'Demo model',ccode:'RED',colour:'Red',license:'Demo License',manufacturer:'Demo Factory',season:'W7',countryRaw:'TURKIYE',buyerGrup:'LISANS',merch:'CU4E',qty:10,kalan:10,fob:5,opd:new Date(2026,5,1),ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1)};

test('DTR manufacturer resolves order Licensor without a royalty rule or despite multiple licensors', () => {
  for (const pricingRules of [[], rules, [{...rules[1],license:'Other License'}]]) {
    const result = business.resolveOrderLicensor(order.license, pricingRules, {manufacturer:order.manufacturer,nonDtrManufacturers:['Agency Factory']});
    assert.equal(result.displayValue,'DTR');
    assert.equal(result.status,'resolved');
    assert.equal(result.ambiguous,false);
  }
});

test('empty license/manufacturer and Non-DTR manufacturers retain rule-based selection', () => {
  assert.equal(business.resolveOrderLicensor('',[],{manufacturer:'Demo Factory'}).displayValue,'');
  assert.equal(business.resolveOrderLicensor('Demo License',[],{manufacturer:''}).displayValue,'');
  const options={manufacturer:' agency factory ',nonDtrManufacturers:['Agency Factory']};
  assert.equal(business.resolveOrderLicensor('Demo License',rules,options).status,'ambiguous');
  assert.equal(business.resolveOrderLicensor('Demo License',[rules[1]],options).displayValue,'Agency');
  assert.equal(business.resolveOrderLicensor('Demo License',[rules[0]],options).status,'manufacturer-conflict');
});

test('server CP, Orders and summary use DTR classification while preserving explicit choices', () => {
  for (const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS,parse.buildOrderSummaryRowsFromASAS]) {
    const overrides={...db.defaultOverrides(),pricingRules:rules};
    const row=build([order],{},overrides)[0];
    assert.equal(row.Licensor,'DTR');
    assert.equal(row['Sub-Manufacturer'],'Demo Factory');
    const priced=build([order],{},{...overrides,suppfobmap:{7409:9.99},suppfobmetamap:{7409:{source:'manual'}}})[0];
    assert.equal(priced['Supp. FOB'],9.99);
    const manual=build([order],{},{...overrides,licensormap:{7409:'Agency'}})[0];
    assert.equal(manual.Licensor,'Agency');
    assert.equal(build([{...order,licensor:'Source Agency'}],{},overrides)[0].Licensor,'Source Agency');
    assert.equal(build([{...order,license:''}],{},overrides)[0].Licensor,'');
  }
  const backlog=parse.buildBacklogGrouped([order],{},{...db.defaultOverrides(),pricingRules:rules},{groupBy:['subManufacturer']});
  assert.deepEqual(backlog.dimValues.subManufacturer,['Demo Factory']);
});

test('loaded browser rows and cell state agree with manufacturer-derived DTR', () => {
  const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const rows=[{License:'Demo License',Manufacturer:'Demo Factory',Licensor:''},{License:'Demo License',Manufacturer:'Demo Factory',Licensor:'Agency',_licensorManual:true},{License:'',Manufacturer:'Demo Factory',Licensor:'Old'}];
  const context={window:{BLBusinessRules:business},state:{overrides:{pricingRules:rules,nonDtrManufacturers:[]},cp:{rows}},norm:v=>String(v??'').trim(),editableValuesEqual:(a,b)=>a===b};
  vm.createContext(context);
  vm.runInContext(block('function licenseLicensorStateForRow(', 'function licenseLicensorWarningText('),context);
  vm.runInContext(block('function applyLicensorRulesToLoadedRows(', 'function applyPricingRulesToLoadedRows('),context);
  context.applyLicensorRulesToLoadedRows();
  assert.equal(rows[0].Licensor,'DTR');
  assert.equal(rows[1].Licensor,'Agency');
  assert.equal(rows[2].Licensor,'');
  assert.equal(context.licenseLicensorStateForRow(rows[0]).status,'resolved');
});

// v7.0.340 — Lisansın bütün License Royalty sözleşmeleri DTR dışı bir lisansörle
// tanımlıysa (Formula 1 → FASHION UK) sipariş lisansör üzerinden verilmiştir:
// üretici NON-DTR listesinde olmasa da DTR sayılmaz ve royalty düşülür.
test('license whose contracts are all non-DTR overrides the unlisted-manufacturer DTR default', () => {
  const f1={id:'f1',license:'Formula 1',licensor:'FASHION UK',royalty:24.5,trCommission:0,ydCommission:0,hologramCost:0.16,seasons:[],categories:[]};
  const opts={manufacturer:'FASHION UK TURKEY',nonDtrManufacturers:[]};
  assert.equal(business.resolveOrderLicensor('Formula 1',[f1],opts).displayValue,'FASHION UK');
  assert.equal(business.resolveOrderLicensor(' formula 1 ',[f1],opts).displayValue,'FASHION UK');
  assert.equal(business.licenseHasOnlyNonDtrContracts('Formula 1',[f1]),true);
  // A DTR contract for the same license keeps the manufacturer classification.
  const dtr={...f1,id:'f1-dtr',licensor:'DTR',royalty:0,hologramCost:0};
  assert.equal(business.resolveOrderLicensor('Formula 1',[f1,dtr],opts).displayValue,'DTR');
  assert.equal(business.licenseHasOnlyNonDtrContracts('Formula 1',[f1,dtr]),false);
  // No contract (catalogue only) or a contract without a licensor: unchanged DTR default.
  assert.equal(business.resolveOrderLicensor('Formula 1',[],opts).displayValue,'DTR');
  assert.equal(business.resolveOrderLicensor('Formula 1',[{...f1,licensor:''}],opts).displayValue,'DTR');
  // Two non-DTR licensors in the latest group stay unresolved instead of guessing.
  const other={...f1,id:'f1-b',licensor:'OTHER AGENCY'};
  assert.equal(business.resolveOrderLicensor('Formula 1',[f1,other],opts).status,'ambiguous');

  for (const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS,parse.buildOrderSummaryRowsFromASAS]) {
    const base={...order,ocode:1395078,license:'Formula 1',manufacturer:'FASHION UK TURKEY',fob:384.98};
    const overrides={...db.defaultOverrides(),pricingRules:[f1]};
    const [tr,yd]=build([base,{...base,ocode:1395079,countryRaw:'INGILTERE'}],{},overrides);
    assert.equal(tr.Licensor,'FASHION UK');
    assert.equal(tr['Supp. FOB'],290.54); // (384,98 − 0,16) × (1 − %24,5)
    assert.equal(yd['Supp. FOB'],290.54);
    assert.equal(tr['Sub-Manufacturer'],'');
    const dtrRow=build([base],{},{...overrides,pricingRules:[f1,dtr]})[0];
    assert.equal(dtrRow.Licensor,'DTR');
    assert.equal(dtrRow['Supp. FOB'],384.98);
    assert.equal(build([base],{},{...overrides,licensormap:{1395078:'DTR'}})[0]['Supp. FOB'],384.98);
  }
});
