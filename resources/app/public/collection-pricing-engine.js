/* Buyer Log — existing Collection pricing calculation shared by UI and server. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BLCollectionPricingEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const KOL_TR_LANDED_MULT=1.05,KOL_YD_LANDED_MULT=1.11;
function normalizeLandedMultipliers(value){
  const raw=value&&typeof value==='object'?value:{},tr=Number(raw.tr),overseas=Number(raw.overseas);
  return {tr:Number.isFinite(tr)&&tr>0?tr:KOL_TR_LANDED_MULT,overseas:Number.isFinite(overseas)&&overseas>0?overseas:KOL_YD_LANDED_MULT};
}
function findRule(ctx,countryGroup,helpers){
  const {api,rules,matches,freshness}=helpers,group=api.pricingRuleCountryGroup(countryGroup);
  if(!group||!ctx.licensor||!ctx.license)return null;
  const candidates=(rules||[]).filter(rule=>matches(rule,ctx)&&api.pricingRuleCommissionForCountry(rule,group)!=null);
  if(!candidates.length)return null;
  return [...candidates].sort((a,b)=>{const af=freshness(a),bf=freshness(b);return bf.start-af.start||bf.end-af.end||String(b.id||'').localeCompare(String(a.id||''),'tr');})[0]||null;
}
function priceWithCosts(basePrice,row,helpers){
  const {kolLicenseRuleMissing,kolLandedIsNonDtr,kolParseMoneyNum}=helpers;
  const base=Number(basePrice);
  if(!Number.isFinite(base)||base<=0)return null;
  /* v7.81 — Non-DTR + eşleşen License Royalty hesabı yok: royaltyyi 0
     sayıp devam etmek royaltysiz (sessizce düşük) bir landed maliyeti
     üretirdi — FOB'daki aynı kusur (bkz. kolApplyRulePricing). Hesap
     durur; hücre kolLandedCalc.ruleMissing ile uyarır. Belirsiz Licensor da
     aynı kapıdan geçer: boş Licensor DTR gibi sayılmaz. */
  if(kolLicenseRuleMissing(row))return null;
  if(!kolLandedIsNonDtr(row))return base;
  const royaltyRaw=kolParseMoneyNum(row&&row.royalty);
  const hologramRaw=kolParseMoneyNum(row&&row.hologramCost);
  if(!Number.isFinite(royaltyRaw)||royaltyRaw<0||royaltyRaw>=100||!Number.isFinite(hologramRaw)||hologramRaw<0)return null;
  const royalty=Number.isFinite(royaltyRaw)&&royaltyRaw>0?royaltyRaw/100:0;
  const hologram=Number.isFinite(hologramRaw)&&hologramRaw>0?hologramRaw:0;
  const denom=1-royalty;
  if(denom<=0)return null;
  return base/denom+hologram;
}
function businessRules(){
  if(typeof module==='object'&&module.exports)return require('./business-rules');
  return typeof globalThis!=='undefined'?globalThis.BLBusinessRules:null;
}
// Collection FOB, CP Final FOB ile aynı kesin ondalık hesabı kullanır:
// (Confirmed ÷ (1 − Royalty%)) + Hologram, yarım kuruş yukarı yuvarlanır.
// Kayan nokta + toFixed yarım kuruş sınırında bir kuruş aşağı kayabiliyordu.
function computeFobFromConfirmed(confFob,royaltyPct,hologram,helpers){
  const {kolParseMoneyNum,kolFormatMoneyDisplay}=helpers;
  const confirmed = kolParseMoneyNum(confFob);
  if(!Number.isFinite(confirmed)) return '';
  const r = kolParseMoneyNum(royaltyPct); const rPct = Number.isFinite(r) ? r : 0;
  const h = kolParseMoneyNum(hologram); const hNum = Number.isFinite(h) ? h : 0;
  if(rPct<0||rPct>=100||hNum<0)return '';
  if(String(royaltyPct??'').trim()&&!Number.isFinite(r))return '';
  if(String(hologram??'').trim()&&!Number.isFinite(h))return '';
  const rules = businessRules();
  if(rules&&rPct>=0&&hNum>=0){
    const exact = rules.calculateFinalFobWithRule(confirmed,{royalty:rPct,hologramCost:hNum},'');
    return exact==null?'':kolFormatMoneyDisplay(String(exact));
  }
  const denom = 1 - rPct/100;
  if(Math.abs(denom) < 1e-9) return '';
  return kolFormatMoneyDisplay(String(confirmed/denom + hNum));
}
// Sözleşme oranı 2 ondalıktan hassas olabilir (ör. %12,125). Görünen Royalty
// alanı Landed hesabına da girdiği için hassasiyet kırpılmaz; en az 2 basamak.
function formatRatePercent(value){
  const n=Number(value);
  if(value==null||value===''||!Number.isFinite(n))return '';
  const [whole,fraction='']=String(Number(n.toFixed(4))).split('.');
  return whole+','+fraction.padEnd(2,'0')+'%';
}
function calculateLanded(row,helpers){
    const {kolParseMoneyNum,kolDefaultLandedMultipliers,kolAutoFx,kolFindPricingRuleForCountryGroup,kolTrLicenseRuleMissing,kolLandedPriceWithRule,kolSuppFob,kolLandedPriceWithCosts,kolLandedIsNonDtr,kolLicenseRuleMissing,effectiveRoyalty,hologramFor}=helpers;
    const trPrice=kolParseMoneyNum(row&&row.trPrice),defaults=typeof kolDefaultLandedMultipliers==='function'?kolDefaultLandedMultipliers():{tr:KOL_TR_LANDED_MULT,overseas:KOL_YD_LANDED_MULT};
    const trMultRaw=kolParseMoneyNum(row&&row.trLandedMult),trMultIsManual=Number.isFinite(trMultRaw)&&trMultRaw>0,trMult=trMultIsManual?trMultRaw:defaults.tr;
    const fxManual=kolParseMoneyNum(row&&row.trFx),fxAuto=kolAutoFx(row),fx=Number.isFinite(fxManual)&&fxManual>0?fxManual:fxAuto,trBaseUsd=(Number.isFinite(trPrice)&&trPrice>0&&Number.isFinite(fx)&&fx>0)?trPrice/fx:null;
    const trRule=kolFindPricingRuleForCountryGroup(row,'TR'),trRuleMissing=kolTrLicenseRuleMissing(row),trCostedUsd=(trBaseUsd==null||trRuleMissing)?null:kolLandedPriceWithRule(trBaseUsd,row,trRule,'TR'),trLanded=trCostedUsd==null?null:trCostedUsd*trMult;
    const supp=kolSuppFob(row),ydBaseFob=supp?supp.price:null,ydCostedFob=ydBaseFob==null?null:kolLandedPriceWithCosts(ydBaseFob,row);
    const ydMultRaw=kolParseMoneyNum(row&&row.ydLandedMult),ydMultIsManual=Number.isFinite(ydMultRaw)&&ydMultRaw>0,ydMult=ydMultIsManual?ydMultRaw:defaults.overseas,ydLanded=ydCostedFob==null?null:ydCostedFob*ydMult;
    const nonDtr=kolLandedIsNonDtr(row),ruleMissing=kolLicenseRuleMissing(row),royaltyRaw=kolParseMoneyNum(row&&row.royalty),hologramRaw=kolParseMoneyNum(row&&row.hologramCost);
    const royaltyPct=Number.isFinite(royaltyRaw)&&royaltyRaw>0?royaltyRaw:0,hologramCost=Number.isFinite(hologramRaw)&&hologramRaw>0?hologramRaw:0;
    const trRoyaltyRaw=effectiveRoyalty(trRule,'TR'),trHologramRaw=hologramFor(trRule,'TR'),trRoyaltyPct=Number.isFinite(trRoyaltyRaw)&&trRoyaltyRaw>0?trRoyaltyRaw:0,trHologramCost=Number.isFinite(trHologramRaw)&&trHologramRaw>0?trHologramRaw:0;
    const ruleInvalid=nonDtr&&!ruleMissing&&(!Number.isFinite(royaltyRaw)||royaltyRaw<0||royaltyRaw>=100||!Number.isFinite(hologramRaw)||hologramRaw<0);
    const trRuleInvalid=nonDtr&&!trRuleMissing&&(!Number.isFinite(trRoyaltyRaw)||trRoyaltyRaw<0||trRoyaltyRaw>=100||!Number.isFinite(trHologramRaw)||trHologramRaw<0);
    const profitPct=(trLanded!=null&&ydLanded!=null&&trLanded>0)?((trLanded-ydLanded)/trLanded)*100:null;
    return {trPrice,trMult,trMultIsManual,defaultTrMult:defaults.tr,fx,fxAuto,fxIsManual:Number.isFinite(fxManual)&&fxManual>0,trBaseUsd,trRule,trRuleMissing,trRuleInvalid,trCostedUsd,trLanded,trRoyaltyPct,trHologramCost,supp,ydBaseFob,ydCostedFob,ydMult,ydMultIsManual,defaultYdMult:defaults.overseas,ydLanded,nonDtr,royaltyPct,hologramCost,profitPct,ruleMissing,ruleInvalid};
  }
return {normalizeLandedMultipliers,findRule,priceWithCosts,computeFobFromConfirmed,formatRatePercent,calculateLanded};
});
