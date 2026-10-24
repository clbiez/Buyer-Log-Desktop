'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Engine=require('../public/collection-pricing-engine'),Fx=require('../public/fx-calculation-engine'),Business=require('../public/business-rules'),Groups=require('../public/collection-model-groups'),parse=require('../server/lib/parse'),{createPricingCalculation}=require('../server/lib/collection-pricing-service');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),patch=fs.readFileSync(path.join(__dirname,'../public/license-royalty-commissions.js'),'utf8');
const norm=v=>String(v??'').trim();
function nativeFunction(name){const start=app.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=app.indexOf('\n}',start);assert.ok(end>start,name);return app.slice(start,end+2);}
function nativeUi(overrides,fx,cpRows=[]){
 const context={window:{BLBusinessRules:Business,BLCollectionPricingEngine:Engine},state:{overrides,cp:{rows:cpRows}},norm,turknorm:Business.turkNorm,dateOrdinal:parse.dateOrdinal,coerceDateLoose:parse.parseDateOnly,sameOrderCode:(a,b)=>parse.orderCodeKey(a)===parse.orderCodeKey(b),kolParseMoneyNum:Groups.kolParseMoneyNum,kolConfirmedPricing:r=>Groups.confirmedPricing(r,r.pricing,Groups.kolParseMoneyNum),kolBestPricing:r=>Groups.bestPricing(r.pricing,Groups.kolParseMoneyNum),editableValuesEqual:(a,b)=>a===b,api:Business,effectiveRoyalty:Business.pricingRuleEffectiveRoyalty,hologramFor:Business.pricingRuleHologramForCountry};
 context.BLFX={monthKey:date=>{const d=date||new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');},snapshotForMonth:month=>({base:fx.base,dir:'per_base',rates:Fx.resolveMonth(month,fx).rates}),convert:Fx.convert};
 vm.createContext(context);vm.runInContext('const KOL_TR_LANDED_MULT=1.05,KOL_YD_LANDED_MULT=1.11;',context);
 for(const name of ['normalizeKolLandedMultipliers','kolDefaultLandedMultipliers','kolSourceCpRow','kolPricingRuleContext','normalizePricingRuleSeasons','pricingRuleSeasonMatches','kolPricingRuleFreshness','kolLandedIsNonDtr','licensorStatusUnresolved','kolAutoLicensorState','kolLicensorUnresolvedState','kolLicenseRuleMissing','kolTrLicenseRuleMissing','kolSuppFob','kolAutoFx','kolFormatPercentDisplay','kolFormatHologramDisplay','kolFormatMoneyDisplay','kolComputeFobFromConfirmed'])vm.runInContext(nativeFunction(name),context);
 const start=patch.indexOf('  kolPricingRuleDimensionMatches='),end=patch.indexOf('  endeksmatikRoyaltyRule=',start);assert.ok(end>start);vm.runInContext(patch.slice(start,end),context);return context;
}
const contract={id:'demo',opdStart:'2026-01-01',opdEnd:'2026-12-31',seasons:['W26'],licensor:'DEMO',license:'DEMO-LICENSE',royalty:18,trCommission:3,ydCommission:2,hologramCost:0.057};
const fx={base:'USD',months:{'2026-01':{TRY:40},'2026-03':{TRY:50}},currencies:['TRY'],_revision:1};
const row={id:1,modelKod:'DEMO',country:'China',season:'W26',licensor:'DEMO',lisans:'DEMO-LICENSE',pricing:{SupplierA:'4'},confirmedManufacturer:'SupplierA',trPrice:400,exFactory:'2026-02-20',quantity:10};

test('actual installed UI helpers and server produce the same native landed values and warnings',()=>{
 for(const candidate of [row,{...row,licensor:'DTR'},{...row,trFx:20,trLandedMult:1.2,ydLandedMult:1.3},{...row,lisans:'MISSING'},{...row,pricing:{SupplierA:'invalid'},targetPrice:6},{...row,trPrice:''}]){
  for(const pricingRules of [[contract],[{...contract,trCommission:null}],[{...contract,royalty:-1}],[{...contract,royalty:100}],[{...contract,hologramCost:-1}],[{...contract,hologramCost:'invalid'}]]){
   const overrides={pricingRules,landedMultipliers:{tr:1.05,overseas:1.11}},ui=nativeUi(overrides,fx),nativeRow={...candidate};ui.kolApplyRulePricing(nativeRow);const actual=ui.kolLandedCalc(nativeRow),server=createPricingCalculation({rows:[candidate],overrides,fx}).calculate(candidate);
   for(const key of Object.keys(actual))assert.deepEqual(JSON.parse(JSON.stringify(server[key]??null)),JSON.parse(JSON.stringify(actual[key]??null)),key+' '+JSON.stringify(candidate));
   assert.equal(server.finalFob,nativeRow.fob===''?null:Groups.kolParseMoneyNum(nativeRow.fob),'actual native FOB cell parity');
   assert.equal(candidate.royalty,undefined,'server must not persist UI projection');
  }
 }
});

test('FX uses nearest previous month, earliest fallback, manual override and native base direction',()=>{
 const calc=createPricingCalculation({rows:[row],overrides:{pricingRules:[contract]},fx});assert.equal(calc.calculate(row).fx,40);assert.equal(calc.calculate(row).fxMonth,'2026-01');assert.equal(calc.calculate(row).fxRequestedMonth,'2026-02');assert.equal(calc.calculate(row).fxExact,false);assert.equal(calc.calculate({...row,exFactory:'2025-01-01'}).fx,40);assert.equal(calc.calculate(row,{trFx:25}).fx,25);
 assert.equal(Fx.convert(1,'USD','TRY',{base:'EUR',dir:'per_base',rates:{USD:1.1,TRY:44}}),40);assert.equal(Fx.convert(1,'USD','TRY',{base:'USD',rates:{TRY:0.025}}),40);assert.equal(Fx.convert(1,'USD','TRY',{base:'USD',dir:'per_base',rates:{TRY:0}}),null);
});

test('latest native contract ignores Collection OPD and respects season, side, legacy hologram and unresolved licensor',()=>{
 const overrides={pricingRules:Business.migrateLicenseRoyaltyRules([{id:'old',countryGroup:'Non-TR',licensor:'DEMO',license:'DEMO-LICENSE',seasons:['W26'],opdStart:'2025-01-01',royalty:10,hologramCost:0.057},{...contract,id:'latest',opdStart:'2027-01-01',opdEnd:'2027-12-31'}])},calc=createPricingCalculation({rows:[row],overrides,fx});assert.equal(calc.calculate({...row,opd:'2020-01-01'}).ruleId,'latest');assert.equal(calc.calculate({...row,season:'S26'}).ruleMissing,true);
 const onlyYd=createPricingCalculation({rows:[row],overrides:{pricingRules:overrides.pricingRules.filter(rule=>rule.id==='old')},fx}).calculate(row);assert.equal(onlyYd.trLanded,null);assert.equal(onlyYd.ruleMissing,false);assert.equal(onlyYd.ydCostedFob,4/0.9+0.057);
 const unresolved=createPricingCalculation({rows:[row],overrides:{pricingRules:[contract,{...contract,id:'rival',licensor:'OTHER'}]},fx}).calculate({...row,licensor:''});assert.equal(unresolved.ydLanded,null);assert.equal(unresolved.trLanded,null);
});

test('CP fallback consumes only the passed authorized canonical snapshot and records unavailable scope',()=>{
 const candidate={...row,_sourceOrderCode:'123',season:'',lisans:''},cpRows=[{'Order Code':'123','Season':'W26','License':'DEMO-LICENSE','Licensor':'DEMO','Country':'China'}],overrides={pricingRules:[contract]};
 const denied=createPricingCalculation({rows:[candidate],overrides,fx}).calculate(candidate);assert.equal(denied.ruleMissing,true);assert.ok(denied.issues.includes('CP_CONTEXT_UNAVAILABLE'));
 const allowed=createPricingCalculation({rows:[candidate],overrides,fx,cpRows,cpContextAvailable:true}).calculate(candidate);assert.equal(allowed.ruleId,'demo');assert.equal(allowed.ruleMissing,false);
});



test('native grouped effective values retain child overrides and calculation fingerprint includes FX and royalty changes',()=>{
 const parent={...row,id:1,modelGroupId:'demo',modelGroupRole:'parent',modelSharedValues:{trPrice:400,trFx:40,pricing:{SupplierA:'4'},confirmedManufacturer:'SupplierA'}},child={...row,id:2,modelGroupId:'demo',modelGroupRole:'variant',variantOverrides:{trPrice:800}};
 const rows=[parent,child],overrides={pricingRules:[contract]},a=createPricingCalculation({rows,overrides,fx});assert.equal(a.calculate(child).trPrice,800);assert.equal(a.calculate(child).fx,40);assert.equal(a.calculate(child).ydBaseFob,4);assert.notEqual(a.fingerprint,createPricingCalculation({rows,overrides,fx:{...fx,_revision:2}}).fingerprint);assert.notEqual(a.fingerprint,createPricingCalculation({rows,overrides:{pricingRules:[{...contract,royalty:19}]},fx}).fingerprint);assert.equal(child.royalty,undefined);
});

test('DTR royalty contracts and authorized CP licensor fallback preserve native FOB separately from landed costs',()=>{
 for(const mode of ['dtr-contract','cp-fallback']){const candidate={...row,licensor:mode==='dtr-contract'?'DTR':'',_sourceOrderCode:mode==='cp-fallback'?'123':''},overrides={pricingRules:[{...contract,licensor:mode==='dtr-contract'?'DTR':'DEMO'}]},cpRows=mode==='cp-fallback'?[{'Order Code':'123','Season':'W26','License':row.lisans,'Licensor':'DEMO','Country':'China'}]:[],ui=nativeUi(overrides,fx,cpRows),nativeRow={...candidate};ui.kolApplyRulePricing(nativeRow);const result=createPricingCalculation({rows:[candidate],overrides,fx,cpRows,cpContextAvailable:!!cpRows.length}).calculate(candidate);assert.equal(result.finalFob,5.06);assert.equal(result.finalFob,Groups.kolParseMoneyNum(nativeRow.fob));assert.equal(result.ydLanded,ui.kolLandedCalc(nativeRow).ydLanded);assert.notEqual(result.finalFob,result.ydCostedFob);assert.equal(result.contractFinalFob,5.06);assert.equal(result.contractSuppFob,4);}
});

test('an invalid DTR Final FOB contract stays invalid without changing its intentional landed treatment',()=>{
 for(const invalid of [{royalty:-1},{royalty:100},{hologramCost:-1},{hologramCost:'invalid'}]){
  const candidate={...row,licensor:'DTR'},overrides={pricingRules:[{...contract,licensor:'DTR',...invalid}]},ui=nativeUi(overrides,fx),nativeRow={...candidate};ui.kolApplyRulePricing(nativeRow);const result=createPricingCalculation({rows:[candidate],overrides,fx}).calculate(candidate);assert.equal(nativeRow.fob,'');assert.equal(result.finalFob,null);assert.equal(result.ydLanded,ui.kolLandedCalc(nativeRow).ydLanded);assert.ok(result.issues.includes('FINAL_FOB_RULE_INVALID'));
 }
});

test('fractional contract royalty keeps full precision and Collection FOB matches the exact CP Final FOB',()=>{
 const fractional={...contract,royalty:12.125,ydCommission:0.2,hologramCost:0};
 const overrides={pricingRules:[fractional],landedMultipliers:{tr:1.05,overseas:1.11}},ui=nativeUi(overrides,fx),nativeRow={...row,pricing:{SupplierA:'3.5'}};
 ui.kolApplyRulePricing(nativeRow);
 assert.equal(nativeRow.royalty,'12,325%');
 assert.equal(Groups.kolParseMoneyNum(nativeRow.fob),Business.calculateFinalFobWithRule(3.5,fractional,'China'));
 const server=createPricingCalculation({rows:[nativeRow],overrides,fx}).calculate({...row,pricing:{SupplierA:'3.5'}});
 assert.equal(server.finalFob,Groups.kolParseMoneyNum(nativeRow.fob));
 assert.equal(server.finalFob,server.contractFinalFob);
 // Half-cent boundary: 3.99 / 0.95 = 4.2 exactly; 0.4975 / 0.995 = 0.5 → float toFixed could drift.
 const helpers={kolParseMoneyNum:Groups.kolParseMoneyNum,kolFormatMoneyDisplay:v=>Number(v).toFixed(2).replace('.',',')};
 assert.equal(Engine.computeFobFromConfirmed('1.005','0','0',helpers),'1,01');
 assert.equal(Engine.computeFobFromConfirmed('24.925','0,3%','0',helpers),'25,00');
 assert.equal(Engine.computeFobFromConfirmed('4','100','0',helpers),'');
 assert.equal(Engine.formatRatePercent(21),'21,00%');
 assert.equal(Engine.formatRatePercent(0.1+0.2),'0,30%');
 assert.equal(Engine.formatRatePercent(''),'');
});
