(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLayout=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDGETS=Object.freeze(['notes','collectionSummary','oab','intake','overviewContent']);
  const DETAIL_WIDGETS=Object.freeze(['productionFocus','attention','dataCoverage','country','subManufacturer','season','buyingGroup']);
  const WIDTHS=Object.freeze(['full','threeQuarter','twoThirds','half','third','quarter']);
  const DETAIL_DEFAULT_WIDTHS=Object.freeze({
    productionFocus:'full', attention:'full', dataCoverage:'full',
    country:'half', subManufacturer:'half', season:'full', buyingGroup:'full',
  });
  const DEFAULT=Object.freeze({
    order:WIDGETS.slice(), hidden:[],
    widths:{notes:'full',collectionSummary:'full',oab:'full',intake:'full',overviewContent:'full'},
    heights:{},collapsed:{},
    details:{order:DETAIL_WIDGETS.slice(),hidden:[],widths:{...DETAIL_DEFAULT_WIDTHS},heights:{},collapsed:{}},
  });
  function normalizeBucket(input,widgets,defaultWidths){
    const source=input&&typeof input==='object'?input:{};
    const order=[];const seen=new Set();
    (Array.isArray(source.order)?source.order:[]).forEach(key=>{if(widgets.includes(key)&&!seen.has(key)){seen.add(key);order.push(key);}});
    widgets.forEach(key=>{if(!seen.has(key))order.push(key);});
    const hidden=[...new Set((Array.isArray(source.hidden)?source.hidden:[]).filter(key=>widgets.includes(key)))];
    const widths={...defaultWidths};Object.entries(source.widths&&typeof source.widths==='object'?source.widths:{}).forEach(([key,value])=>{if(widgets.includes(key)&&WIDTHS.includes(value))widths[key]=value;});
    const heights={};Object.entries(source.heights&&typeof source.heights==='object'?source.heights:{}).forEach(([key,value])=>{const height=Math.round(Number(value)||0);if(widgets.includes(key)&&height>=120&&height<=1600)heights[key]=height;});
    const collapsed={};Object.entries(source.collapsed&&typeof source.collapsed==='object'?source.collapsed:{}).forEach(([key,value])=>{if(widgets.includes(key))collapsed[key]=Boolean(value);});
    return {order,hidden,widths,heights,collapsed};
  }
  function normalize(value){
    const input=value&&typeof value==='object'?value:{};
    const page=normalizeBucket(input,WIDGETS,DEFAULT.widths);
    const details=normalizeBucket(input.details,DETAIL_WIDGETS,DETAIL_DEFAULT_WIDTHS);
    return {...page,details};
  }
  function move(order,key,delta){
    const next=Array.isArray(order)?order.slice():[];const from=next.indexOf(key);if(from<0)return next;
    const to=Math.max(0,Math.min(next.length-1,from+Number(delta||0)));if(to===from)return next;
    next.splice(from,1);next.splice(to,0,key);return next;
  }
  return {widgets:WIDGETS,detailWidgets:DETAIL_WIDGETS,widths:WIDTHS,defaults:()=>normalize(DEFAULT),normalize,move};
});
