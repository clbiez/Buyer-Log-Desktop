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
    fetch:async()=>({ok:true,json:async()=>({revision:9,rules:[]})}),applyLicensorMerges:()=>false,applyIncomingPricingRules:()=>false,
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
  const ov={pricingRules:[old,current],nonDtrManufacturers:['Factory'],suppfobmap:{'100':1},suppfobmetamap:{'100':{source:'rule',ruleId:'stale'}}};
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
    const rows=build(orders,{},ov);
    assert.equal(rows[0]['Supp. FOB'],business.calculateSuppFobWithRule(10,current,'TR'));
    assert.equal(rows[1]['Supp. FOB'],business.calculateSuppFobWithRule(10,old,'YD'));
    const manual=build(orders,{}, {...ov,suppfobmetamap:{'100':{source:'manual'}}});
    assert.equal(manual[0]['Supp. FOB'],1);
  }
});

test('a complete card response hydrates the same canonical royalty rules even when a revision hint is already known', async () => {
  const context={window:{},state:{storeRevisions:{pricingRules:9}},applyLicensorMerges:()=>false,applyIncomingPricingRules:(rules,revision)=>{context.rules=rules;context.revision=revision;return true;},syncPricingRulesToAllLoadedViews:()=>{context.synced=true;},refreshPricingRulesFromServer:async()=>{throw new Error('Canonical response must not refetch');}};
  vm.createContext(context);
  vm.runInContext(block('window.BLLicenseDataBridge={', 'window.BLPriceSupplierAnalysisBridge='),context);
  await context.window.BLLicenseDataBridge.rulesChanged({pricingRevision:9,pricingRules:[{id:'one',royalty:16}]});
  assert.equal(context.rules[0].royalty,16);assert.equal(context.revision,9);assert.equal(context.synced,true);
});

test('royalty saves use the editor revision and notify card caches only after a successful commit', async () => {
  const requests=[],invalidations=[];
  const context={window:{SERVER_BACKED:true,BL_CLIENT_ID:'royalty-tab',BLLicenseCardsPage:{invalidate:()=>invalidations.push('saved')}},state:{storeRevisions:{pricingRules:9},overrides:{pricingRules:[{royalty:16}]}},normalizePricingRules:r=>r,saveLocalPricingRules:()=>{},syncPricingRulesToAllLoadedViews:()=>({}),fetch:async(url,options)=>{requests.push(options);return {ok:false,status:409,json:async()=>({code:'REVISION_CONFLICT'})};},appLang:'en',applyLicensorMerges:()=>false,applyIncomingPricingRules:(rules,revision)=>{context.state.overrides.pricingRules=rules;context.state.storeRevisions.pricingRules=revision;}};
  vm.createContext(context);vm.runInContext(block('async function persistPricingRules(', '/* v10.24'),context);
  await assert.rejects(context.persistPricingRules([{royalty:13}],{expectedRevision:8}));
  assert.equal(requests[0].headers['If-Match'],'8');assert.equal(requests[0].headers['X-Client-Id'],'royalty-tab');
  assert.equal(context.state.overrides.pricingRules[0].royalty,16);assert.equal(invalidations.length,0);
  context.fetch=async()=>({ok:true,json:async()=>({revision:10,rules:[{royalty:17}]})});
  await context.persistPricingRules([{royalty:17}],{expectedRevision:9});assert.equal(invalidations.length,1);
});


test('a delayed failed royalty write cannot roll back a newer canonical response received meanwhile', async () => {
  const fresh=[{royalty:19}];
  const context={window:{SERVER_BACKED:true},state:{storeRevisions:{pricingRules:9},overrides:{pricingRules:[{royalty:13}]}},normalizePricingRules:r=>r,saveLocalPricingRules:()=>{},syncPricingRulesToAllLoadedViews:()=>({}),fetch:async()=>{context.state.overrides.pricingRules=fresh;context.state.storeRevisions.pricingRules=10;return {ok:false,status:409,json:async()=>({code:'REVISION_CONFLICT'})};},appLang:'en'};
  vm.createContext(context);vm.runInContext(block('async function persistPricingRules(', '/* v10.24'),context);
  await assert.rejects(context.persistPricingRules([{royalty:16}],{expectedRevision:9}));
  assert.equal(context.state.overrides.pricingRules,fresh);assert.equal(context.state.storeRevisions.pricingRules,10);
});
