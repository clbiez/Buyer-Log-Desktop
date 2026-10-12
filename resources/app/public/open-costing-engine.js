/* Shared native Open Costing arithmetic; no UI, network or persistence. */
(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./business-rules'),require('./fx-calculation-engine')):factory(root.BLBusinessRules,root.BLFxCalculationEngine);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BLOpenCostingEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Business,Fx){
'use strict';
const SECTION_KEYS=Object.freeze(['fabric','labor','accessories','printEmbroidery','specialProcess','washing','packaging','testing','other']);
function normalizeFxMonth(value,now=new Date()){
  return /^\d{4}-\d{2}$/.test(String(value||''))?String(value):now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
}
function parseLocalizedNumber(value){
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  let s=String(value==null?'':value).trim();
  if(!s)return 0;
  s=s.replace(/\s+/g,'').replace(/[^0-9,\.\-+]/g,'');
  if(!s||s==='-'||s==='+')return 0;
  const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
  if(comma>=0&&dot>=0){
    const decimalPos=Math.max(comma,dot),decimal=s[decimalPos];
    s=s.slice(0,decimalPos).replace(/[,.]/g,'')+'.'+s.slice(decimalPos+1).replace(/[,.]/g,'');
    if(decimal!==','&&decimal!=='.')s=s.replace(decimal,'.');
  }else if(comma>=0){
    const parts=s.split(',');s=parts.length>2?parts.slice(0,-1).join('')+'.'+parts.at(-1):s.replace(',','.');
  }else if((s.match(/\./g)||[]).length>1){
    const parts=s.split('.');s=parts.slice(0,-1).join('')+'.'+parts.at(-1);
  }
  const out=Number(s);return Number.isFinite(out)?out:0;
}
const n=parseLocalizedNumber,pct=v=>Math.max(0,n(v)),roundHalfUp=(value,decimals=2)=>Business.roundHalfUp(value,decimals);
function lineTotal(row,record,missing,snapshot){
  const raw=n(row?.qty)*n(row?.unitPrice)*(1+pct(row?.wastePct)/100);
  if(!record)return raw;
  const from=String(row?.currency||record.meta?.currency||'USD'),to=String(record.meta?.currency||'USD');
  if(from===to)return raw;
  const converted=Fx.convert(raw,from,to,snapshot);
  if(converted==null){if(Array.isArray(missing)&&!missing.includes(from))missing.push(from);return raw;}
  return converted;
}
function calculateRecord(record,snapshot){
  const missingCurrencies=[],sectionTotals={};
  SECTION_KEYS.forEach(key=>sectionTotals[key]=(record?.sections?.[key]||[]).reduce((sum,row)=>sum+lineTotal(row,record,missingCurrencies,snapshot),0));
  const direct=Object.values(sectionTotals).reduce((a,b)=>a+b,0);
  const productionWaste=direct*pct(record?.rates?.productionWastePct)/100;
  const afterWaste=direct+productionWaste;
  const overhead=afterWaste*pct(record?.rates?.overheadPct)/100;
  const afterOverhead=afterWaste+overhead;
  const finance=afterOverhead*pct(record?.rates?.financePct)/100;
  const afterFinance=afterOverhead+finance;
  const profit=afterFinance*pct(record?.rates?.profitPct)/100;
  const finalFobRaw=afterFinance+profit;
  const finalFob=roundHalfUp(finalFobRaw,2);
  const target=n(record?.meta?.targetFob),gap=roundHalfUp(target?finalFob-target:0,2),qty=n(record?.meta?.quantity);
  return {sectionTotals,direct,productionWaste,afterWaste,overhead,afterOverhead,finance,afterFinance,profit,finalFobRaw,finalFob,target,gap,quantity:qty,orderTotal:roundHalfUp(finalFob*qty,2),missingCurrencies};
}
return {SECTION_KEYS,normalizeFxMonth,parseLocalizedNumber,lineTotal,calculateRecord};
});
