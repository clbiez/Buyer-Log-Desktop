'use strict';
const Engine=require('../../public/collection-pricing-engine'),Fx=require('../../public/fx-calculation-engine'),Business=require('../../public/business-rules'),Groups=require('../../public/collection-model-groups');
const canonical=require('./canonical-fields'),parse=require('./parse');
const {hash}=require('./operation-utils');
const norm=value=>String(value??'').trim();



// Fixed native inputs only. This service calculates; it never persists a price.
function createPricingCalculation({rows,overrides,fx,cpRows=[],cpContextAvailable=false,now=new Date()}){
 const reader=Groups.createValueReader(rows),rules=Business.migrateLicenseRoyaltyRules(overrides.pricingRules||[]),defaults=Engine.normalizeLandedMultipliers(overrides.landedMultipliers);
 const cpByOrder=new Map();for(const row of cpRows){const key=parse.orderCodeKey(canonical.value(row,'cp','orderCode'));if(key&&!cpByOrder.has(key))cpByOrder.set(key,row);}
 const project=row=>{const effective={...row};for(const key of new Set([...Object.keys(row),'pricing','confirmedManufacturer','trPrice','trFx','trLandedMult','ydLandedMult','targetPrice','royalty','hologramCost','licensor','lisans','season','country','exFactory',...canonical.moduleFields('collection').map(id=>canonical.bindingFor('collection',id).keys[0])]))effective[key]=reader(row,key);return effective;};
 const context=row=>{const cp=cpByOrder.get(parse.orderCodeKey(row._sourceOrderCode));return {country:norm(row.country)||norm(cp&&canonical.value(cp,'cp','country')),season:norm(row.season)||norm(cp&&canonical.value(cp,'cp','season')),licensor:norm(row.licensor)||norm(cp&&canonical.value(cp,'cp','licensor')),license:norm(row.lisans)||norm(cp&&canonical.value(cp,'cp','license'))};};
 // Exact licensor first; a merged licensor name (ERMODA UK LTD → ERMODA) is the fallback.
 const ruleMatcher=licensorMatches=>(rule,ctx)=>Business.transitRuleSeasonMatches({...rule,seasons:rule.seasons??(rule.season==null?[]:[rule.season])},ctx.season)&&licensorMatches(ctx.licensor,rule.licensor)&&Business.turkNorm(ctx.license)===Business.turkNorm(rule.license);
 const freshness=rule=>({start:parse.dateOrdinal(rule.opdStart)??-Infinity,end:parse.dateOrdinal(rule.opdEnd)??-Infinity});
 const findRule=(row,group)=>Engine.findRule(context(row),group,{api:Business,rules,matches:ruleMatcher((a,b)=>Business.turkNorm(a)===Business.turkNorm(b)),freshness})||Engine.findRule(context(row),group,{api:Business,rules,matches:ruleMatcher((a,b)=>Business.licensorsMerged(a,b,overrides.licensorMerges)),freshness});
 const nonDtr=row=>Boolean(Business.turkNorm(row?.licensor)&&Business.turkNorm(row.licensor)!=='DTR');
 const unresolved=row=>!norm(row?.licensor)&&Business.isUnresolvedLicensorStatus(Business.resolveAutoLicensor(norm(row?.lisans),rules,{manufacturer:norm(row?.confirmedManufacturer),nonDtrManufacturers:overrides.nonDtrManufacturers}).status);
 const ruleMissing=row=>unresolved(row)||(nonDtr(row)&&!findRule(row,context(row).country));
 const trRuleMissing=row=>unresolved(row)||(nonDtr(row)&&!findRule(row,'TR'));
 function supplierFob(row){const confirmed=Groups.confirmedPricing(row,row.pricing,Groups.kolParseMoneyNum),best=Groups.bestPricing(row.pricing,Groups.kolParseMoneyNum),target=Groups.kolParseMoneyNum(row.targetPrice);return confirmed?{...confirmed,source:'confirmed'}:best?{...best,source:'best'}:Number.isFinite(target)&&target>0?{price:target,source:'target',name:''}:null;}
 function autoFx(row){const date=row.exFactory?parse.parseDateOnly(row.exFactory):now,actual=date||now,requestedMonth=actual.getFullYear()+'-'+String(actual.getMonth()+1).padStart(2,'0'),resolved=Fx.resolveMonth(requestedMonth,fx),snapshot={base:fx.base||'USD',dir:'per_base',rates:resolved.rates};return {...resolved,requestedMonth,rate:Fx.convert(1,'USD','TRY',snapshot,fx)};}
 function calculate(sourceRow,scenario={}){
  const row={...project(sourceRow)},ctx=context(row),rule=findRule(row,ctx.country),total=Business.pricingRuleEffectiveRoyalty(rule,ctx.country),hologram=Business.pricingRuleHologramForCountry(rule,ctx.country);
  // Match kolApplyRulePricing's visible effective fields, not stale saved derivations.
  row.royalty=total==null?'':Engine.formatRatePercent(total);row.hologramCost=hologram==null?'':String(hologram);
  for(const key of ['trPrice','trFx','trLandedMult','ydLandedMult'])if(scenario[key]!=null)row[key]=scenario[key];
  const fxInfo=autoFx(row),helpers={kolParseMoneyNum:Groups.kolParseMoneyNum,kolDefaultLandedMultipliers:()=>defaults,kolAutoFx:()=>fxInfo.rate,kolFindPricingRuleForCountryGroup:findRule,kolTrLicenseRuleMissing:trRuleMissing,kolLandedPriceWithRule:(base,r,contract,group)=>!Number.isFinite(Number(base))||Number(base)<=0?null:!nonDtr(r)?Number(base):contract?Business.calculateFinalFobWithRule(base,contract,group):null,kolSuppFob:r=>scenario.suppFob!=null?{price:scenario.suppFob,source:'scenario',name:''}:supplierFob(r),kolLandedIsNonDtr:nonDtr,kolLicenseRuleMissing:ruleMissing,effectiveRoyalty:Business.pricingRuleEffectiveRoyalty,hologramFor:Business.pricingRuleHologramForCountry};
  helpers.kolLandedPriceWithCosts=(base,r)=>Engine.priceWithCosts(base,r,helpers);
  const value=Engine.calculateLanded(row,helpers),fob=value.supp&&!value.ruleMissing?Engine.computeFobFromConfirmed(value.supp.price,row.royalty,row.hologramCost,{kolParseMoneyNum:Groups.kolParseMoneyNum,kolFormatMoneyDisplay:v=>{const n=Groups.kolParseMoneyNum(v);return Number.isFinite(n)?n.toFixed(2).replace('.',','):String(v??'');}}):'',finalFob=fob===''?null:Groups.kolParseMoneyNum(fob),contractFinalFob=value.supp&&!value.ruleMissing?(rule?Business.calculateFinalFobWithRule(value.supp.price,rule,ctx.country):finalFob):null;
  const issues=[];if(value.ruleMissing)issues.push('ROYALTY_RULE_MISSING');if(value.trRuleMissing)issues.push('TR_ROYALTY_RULE_MISSING');if(!(value.fx>0))issues.push('FX_MISSING');if(!(value.trPrice>0))issues.push('TR_PRICE_MISSING');if(!value.supp)issues.push('SUPPLIER_PRICE_MISSING');
  if(row._sourceOrderCode&&!cpContextAvailable&&['country','season','licensor','lisans'].some(key=>!norm(row[key])))issues.push('CP_CONTEXT_UNAVAILABLE');
  return {...value,recordId:String(row.id),modelName:norm(row.modelKod),currency:'USD',scenario:scenario.label||'baseline',finalFob,contractFinalFob,contractSuppFob:contractFinalFob==null?null:rule?Business.calculateSuppFobWithRule(contractFinalFob,rule,ctx.country):contractFinalFob,ruleId:rule?.id||null,trRuleId:value.trRule?.id||null,fxMonth:fxInfo.month,fxRequestedMonth:fxInfo.requestedMonth,fxExact:fxInfo.exact,issues};
 }
 return {project,calculate,cpContextAvailable,fingerprint:hash(JSON.stringify({rules,landedMultipliers:defaults,nonDtrManufacturers:overrides.nonDtrManufacturers||[],fx,cpRows,month:now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')}))};
}
module.exports={createPricingCalculation};
