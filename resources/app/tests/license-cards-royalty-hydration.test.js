'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const APP = fs.readFileSync(require('node:path').join(__dirname, '../public/app-main.js'), 'utf8');
function block(start, end) { return APP.slice(APP.indexOf(start), APP.indexOf(end, APP.indexOf(start))); }

test('ASAS matrix parsing retains the licensor through canonical header bindings', () => {
  const parse=require('../server/lib/parse');
  for(const header of ['Lisansör','Licensor','License Owner']){
    const parsed=parse.parseASASRows([{'Sipariş Kod':100,'Model Adı':'Model','Renk Kod':'RED','Net Alım Sipariş Miktarı':100,'Lisans':'Example',[header]:'Explicit Owner'}]);
    assert.equal(parsed.orders[0].licensor,'Explicit Owner');
  }
});

test('a rule-derived persisted FOB is recalculated but a manual FOB is preserved', () => {
  const context = { state:{overrides:{suppfobmap:{'100|model|red':8},suppfobmetamap:{'100|model|red':{source:'rule',ruleId:'old'}}}},
    normalizeSuppFobMeta: value=>value, lineKeyOfRow:()=> '100|model|red' };
  vm.createContext(context);
  vm.runInContext(block('function suppFobMetaForRow', '/* v7.81'), context);
  vm.runInContext(block('function hasManualSuppFob', 'function sameOrderCode'), context);
  assert.equal(context.hasManualSuppFob({'Order Code':100,_suppFobOverride:true,_suppFobManual:false,_suppFobMeta:{source:'rule'}}), false);
  assert.equal(context.hasManualSuppFob({'Order Code':100,_suppFobOverride:true,_suppFobMeta:{source:'manual'}}), true);
  assert.equal(context.hasManualSuppFob({'Order Code':100,_suppFobOverride:true}), false, 'line-level rule metadata wins over generic override marker');
  context.state.overrides.suppfobmetamap['100|model|red']={source:'manual'};
  assert.equal(context.hasManualSuppFob({'Order Code':100}), true);
});

test('deferred CP load applies royalty before constructing filters and rendering', () => {
  const fn = block('async function ensureCpLoaded', 'async function ensureCollectionCatalogLoaded');
  assert.ok(fn.indexOf('applyPricingRulesToLoadedRows({render:false})') > fn.indexOf('state.cp={'));
  assert.ok(fn.indexOf('applyPricingRulesToLoadedRows({render:false})') < fn.indexOf('buildCPFilters()'));
});

test('identical royalty revisions do not trigger another whole-view recalculation', async () => {
  let recalculations=0;
  const context = {window:{SERVER_BACKED:true},state:{storeRevisions:{pricingRules:9}},
    fetch:async()=>({ok:true,json:async()=>({revision:9,rules:[]})}),applyIncomingPricingRules:()=>false,
    syncPricingRulesToAllLoadedViews:()=>{recalculations++;return {};}};
  vm.createContext(context);
  vm.runInContext(block('async function refreshPricingRulesFromServer', 'function pricingRuleMatchCount'),context);
  await context.refreshPricingRulesFromServer();
  assert.equal(recalculations,0);
});

test('server CP and Orders projections apply temporal TR/YD commissions and refresh applied rule values', () => {
  const parse=require('../server/lib/parse'),business=require('../public/business-rules');
  const old={id:'old',license:'Example',licensor:'OWNER',opdStart:'2025-01-01',opdEnd:'2025-12-31',seasons:[],royalty:10,trCommission:2,ydCommission:3,hologramCost:0.1};
  const current={...old,id:'current',opdStart:'2026-01-01',opdEnd:'2026-12-31',trCommission:4,ydCommission:6};
  const orders=[{ocode:100,model:'Model',ccode:'RED',license:'Example',manufacturer:'Factory',countryRaw:'TURKIYE',season:'AW26',qty:100,kalan:100,fob:10,opd:new Date(2026,5,1),ex:new Date(2026,11,1),mb:new Date(2027,0,1)},
    {ocode:101,model:'Model',ccode:'RED',license:'Example',manufacturer:'Factory',countryRaw:'BANGLADES',season:'AW26',qty:100,kalan:100,fob:10,opd:new Date(2025,5,1),ex:new Date(2026,11,1),mb:new Date(2027,0,1)}];
  const ov={pricingRules:[old,current],suppfobmap:{'100':1},suppfobmetamap:{'100':{source:'rule',ruleId:'stale'}}};
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
    const rows=build(orders,{},ov);
    assert.equal(rows[0]['Supp. FOB'],business.calculateSuppFobWithRule(10,current,'TR'));
    assert.equal(rows[1]['Supp. FOB'],business.calculateSuppFobWithRule(10,old,'YD'));
    const manual=build(orders,{}, {...ov,suppfobmetamap:{'100':{source:'manual'}}});
    assert.equal(manual[0]['Supp. FOB'],1);
  }
});
