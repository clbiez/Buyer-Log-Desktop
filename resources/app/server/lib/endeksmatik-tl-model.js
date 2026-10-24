'use strict';

// Known TL workbook contracts, separate from both the USD model and historical
// cached legacy snapshots. Only formulas are compared; Excel is never executed.
const XLSX=require('xlsx');
const CONTRACT='endeksmatik-tl-workbook/v1';
const PIVOTS=['KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT'];
const FAIL='MODEL_SIGNATURE_MISMATCH';
function fail(code=FAIL,details){
 const messages=code===FAIL?{tr:'TL/USD model yapısı tanınmadı; mevcut setler korundu.',en:'Unrecognized TL/USD model structure; existing sets were preserved.'}
  :{tr:'TL Excel sonucu hesapla uyuşmuyor; mevcut setler korundu.',en:'TL Excel results do not reconcile; existing sets were preserved.'};
 return Object.assign(new Error(messages.tr+' / '+messages.en),{code,statusCode:422,details:{...details,messages}});
}
function canonical(formula){
 let out=String(formula||'').normalize('NFC').toUpperCase().replace(/^=/,'').replace(/"(?:[^"]|"")*"|[^\"]+/g,part=>part.startsWith('"')?part:part.replace(/[$'\s]/g,''));
 PIVOTS.forEach((name,i)=>{out=out.replaceAll(new RegExp(name.toUpperCase().replace(/\s/g,'')+'!A:[A-Z]{1,3}(?![A-Z0-9])','g'),'PIVOT'+i);});
 return out.replace(/KLASMANLİSTESİÖZET!A:J(?![A-Z0-9])/g,'SUMMARY')
  .replace(/SEÇIMLER!(?:AR1:AS|AT1:AU)\d+(?![A-Z0-9])/g,'MONTHS')
  .replace(/DEĞIŞIMLER!V[3-7]:W150(?![A-Z0-9])/g,'FX');
}
function layoutFor(id){
 const shift=id==='w6'?1:0;
 return {id,season:'C'+(1+shift),updatedAt:'C'+(2+shift),selection:[3,4,5,6,7].map(r=>'C'+(r+shift)),oldOrder:'C'+(8+shift),oldStore:'C'+(9+shift),order:'C'+(10+shift),store:'C'+(11+shift),adjust:'B'+(22+shift),first:16+shift,target:23+shift,total:20+shift,targetTotal:27+shift};
}
function expectedFormulas(L){
 const out={},key=L.selection.join('&"_"&'),look=(i,month)=>`VLOOKUP(${key},PIVOT${i},VLOOKUP("Toplam "&${month},MONTHS,2,FALSE),FALSE)`;
 const fx=`VLOOKUP(${L.store},FX,2,FALSE)/VLOOKUP(${L.oldStore},FX,2,FALSE)`;
 PIVOTS.forEach((_,i)=>{
  const r=L.first+i,t=L.target+i,current=i%2?L.store:L.order,previous=i%2?L.oldStore:L.oldOrder;
  out['C'+r]=`IFERROR(${look(i,current)}/${look(i,previous)}-1,"-")`;
  out['D'+r]=`IFERROR((1+C${r})/(${fx})-1,"-")`;
  out['F'+r]=`VLOOKUP(${key},SUMMARY,${7+i},FALSE)`;
  for(const c of ['C','D'])out[c+t]=`(1+${c}${r})*(1-${L.adjust})-1`;
 });
 const sum=start=>PIVOTS.map((_,i)=>`C${start+i}*F${L.first+i}`).join('+');
 out['C'+L.total]=`IFERROR(${sum(L.first)},"-")`;
 out['D'+L.total]=`IFERROR((1+C${L.total})/(${fx})-1,"-")`;
 out['C'+L.targetTotal]=`IFERROR(${sum(L.target)},"-")`;
 out['D'+L.targetTotal]=`(1+D${L.total})*(1-${L.adjust})-1`;
 return out;
}
function dateOnly(value,date1904=false){
 if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<80000)return new Date((date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30))+Math.round(value)*86400000).toISOString().slice(0,10);
 const text=String(value||'').trim(),iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text),local=/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
 if(!iso&&!local)return '';
 const [y,m,d]=iso?iso.slice(1).map(Number):[Number(local[3]),Number(local[2]),Number(local[1])],date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):'';
}
function inspect(buffer){
 const workbook=XLSX.read(buffer,{type:'buffer',sheets:['ENDEKSMATİK'],cellDates:false,cellFormula:true}),screen=workbook.Sheets['ENDEKSMATİK'];
 const rawDateSystem=workbook.Workbook?.WBProps?.date1904,date1904=rawDateSystem===true||rawDateSystem===1||rawDateSystem==='1';
 if(!screen)throw fail();
 const failures={};
 for(const id of ['s7','w6']){
  const L=layoutFor(id),expected=expectedFormulas(L),mismatches=Object.entries(expected).filter(([a,f])=>canonical(screen[a]?.f)!==canonical(f)).map(([a])=>a);
  const season=screen[L.season],updatedAt=dateOnly(screen[L.updatedAt]?.v,date1904),adjustment=screen[L.adjust];
  if(mismatches.length||typeof season?.v!=='string'||!season.v.trim()||adjustment?.t!=='n'||!Number.isFinite(adjustment.v)||adjustment.v<=-1||adjustment.v>=1){failures[id]=mismatches;continue;}
  // Metadata freshness is not a formula identity. In the supplied W6 workbook
  // the source date contains a doubled dot; retain it as unknown, never invent
  // a corrected date or silently certify freshness from a malformed value.
  return {layout:L,screen,season:season.v.trim(),sourceUpdatedAt:updatedAt,targetAdjustmentPct:adjustment.v*100,metadataWarnings:updatedAt?[]:['Kaynak güncelleme tarihi geçersiz; güncellik doğrulanmadı. / The source update date is invalid; freshness was not verified.'],signature:{ok:true,model:CONTRACT,layout:id,checkedCells:Object.keys(expected)}};
 }
 throw fail(FAIL,{layouts:failures});
}
function reconcile(inspected,calculate){
 const {layout:L,screen}=inspected,raw=a=>screen[a]?.v,input=Object.fromEntries(['mmyg','mag','supplyGroup','buyingGroup','category'].map((key,i)=>[key,raw(L.selection[i])]));
 Object.assign(input,{previousOrderMonth:String(raw(L.oldOrder)||''),previousInStoreMonth:String(raw(L.oldStore)||''),newOrderMonth:String(raw(L.order)||''),newInStoreMonth:String(raw(L.store)||''),adjustmentPct:inspected.targetAdjustmentPct});
 let result;
 try{result=calculate(input);}catch(error){
  if(!['CLASS_NOT_FOUND','SUPPLY_GROUP_AMBIGUOUS','MONTH_INVALID','MONTH_OUT_OF_RANGE','MONTH_ORDER_INVALID','COMPONENT_VALUE_MISSING','FX_MISSING'].includes(error.code))throw error;
  if(Object.keys(expectedFormulas(L)).some(a=>screen[a]?.t==='n'&&Number.isFinite(raw(a))))throw fail('MODEL_RECONCILIATION_FAILED',{reason:error.code});
  return {ok:null,checks:[],reason:'SCREEN_REFERENCE_UNAVAILABLE',warnings:['Excel ekranındaki örnek seçim hesaplanabilir değil; formül sözleşmesi doğrulandı. / The sample screen selection cannot be calculated; the formula contract was verified.']};
 }
 const expected={};
 result.components.forEach((item,i)=>{const r=L.first+i,t=L.target+i;expected['C'+r]=item.index;expected['D'+r]=(1+item.index)/(result.fx.new/result.fx.previous)-1;expected['F'+r]=item.weight;expected['C'+t]=item.targetIndex;expected['D'+t]=(1+expected['D'+r])*(1-inspected.targetAdjustmentPct/100)-1;});
 Object.assign(expected,{['C'+L.total]:result.indexes.tl,['D'+L.total]:result.indexes.usd,['C'+L.targetTotal]:result.indexes.targetTl,['D'+L.targetTotal]:result.indexes.targetUsd});
 const checks=Object.entries(expected).filter(([a])=>screen[a]?.t==='n'&&Number.isFinite(raw(a))).map(([cell,value])=>({cell,ok:Math.abs(raw(cell)-value)<=1e-6}));
 if(checks.some(check=>!check.ok))throw fail('MODEL_RECONCILIATION_FAILED',{checks});
 return {ok:checks.length===Object.keys(expected).length?true:null,checks,reason:checks.length===Object.keys(expected).length?null:'SCREEN_CACHE_INCOMPLETE',warnings:checks.length===Object.keys(expected).length?[]:['Excel ekranının sayısal önbelleği eksik; mevcut sayısal sonuçlar doğrulandı. / The screen numeric cache is incomplete; available numeric results were verified.']};
}
module.exports={CONTRACT,inspect,reconcile};
