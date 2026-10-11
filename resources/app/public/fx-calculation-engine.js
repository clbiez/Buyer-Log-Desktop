/* Native FX month resolution and conversion; no data loading or UI. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BLFxCalculationEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function num(v){const n=typeof v==='number'?v:parseFloat(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null;}
function resolveMonth(mk,src){
  const months=src.months||{};
  if(months[mk]&&Object.keys(months[mk]).length)return {month:mk,rates:months[mk],exact:true};
  const keys=Object.keys(months).filter(k=>months[k]&&Object.keys(months[k]).length).sort();
  if(!keys.length)return {month:null,rates:{},exact:false};
  const prev=keys.filter(k=>k<=mk).pop();
  return {month:prev||keys[0],rates:months[prev||keys[0]],exact:false};
}
function convert(value,from,to,snap,source){
  if(!Number.isFinite(value))return null;
  if(!from||!to||from===to)return value;
  const s=snap;
  const base=s.base||source?.base||'USD';const rates=s.rates||{};
  const perBase=s.dir==='per_base'; // canlı tablo her zaman yeni yön
  const unit=cur=>{
    if(cur===base)return 1;
    const r=num(rates[cur]);if(r==null||r<=0)return null;
    return perBase?1/r:r;
  };
  const uf=unit(from),ut=unit(to);
  if(uf==null||ut==null)return null;
  return value*uf/ut;
}
return {resolveMonth,convert};
});
