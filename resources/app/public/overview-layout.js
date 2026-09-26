(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLayout=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const WIDGETS=Object.freeze(['launchpad','globalFlowMap','notes','collectionSummary','oab','intake','overviewContent']);
  /* Sonradan eklenen üst modüller kayıtlı eski düzenlerde de en üstte başlar. */
  const LEADING_WIDGETS=Object.freeze(['launchpad']);
  const DETAIL_WIDGETS=Object.freeze(['productionFocus','priorityRadar','attention','dataCoverage','country','subManufacturer','season','buyingGroup']);
  const WIDTHS=Object.freeze(['full','threeQuarter','twoThirds','half','third','quarter']);
  const DETAIL_DEFAULT_WIDTHS=Object.freeze({
    productionFocus:'full', priorityRadar:'full', attention:'full', dataCoverage:'full',
    country:'half', subManufacturer:'half', season:'full', buyingGroup:'full',
  });
  const DEFAULT=Object.freeze({
    order:WIDGETS.slice(), hidden:[],
    widths:{launchpad:'full',globalFlowMap:'full',notes:'full',collectionSummary:'full',oab:'full',intake:'full',overviewContent:'full'},
    heights:{},collapsed:{},
    details:{order:DETAIL_WIDGETS.slice(),hidden:[],widths:{...DETAIL_DEFAULT_WIDTHS},heights:{},collapsed:{}},
  });
  function normalizeBucket(input,widgets,defaultWidths){
    const source=input&&typeof input==='object'?input:{};
    const order=[];const seen=new Set();
    (Array.isArray(source.order)?source.order:[]).forEach(key=>{if(widgets.includes(key)&&!seen.has(key)){seen.add(key);order.push(key);}});
    const missing=widgets.filter(key=>!seen.has(key));
    const leading=seen.size?missing.filter(key=>LEADING_WIDGETS.includes(key)):[];
    order.unshift(...leading);missing.forEach(key=>{if(!leading.includes(key))order.push(key);});
    const hidden=[...new Set((Array.isArray(source.hidden)?source.hidden:[]).filter(key=>widgets.includes(key)))];
    const widths={...defaultWidths};Object.entries(source.widths&&typeof source.widths==='object'?source.widths:{}).forEach(([key,value])=>{if(widgets.includes(key)&&WIDTHS.includes(value))widths[key]=value;});
    const heights={};Object.entries(source.heights&&typeof source.heights==='object'?source.heights:{}).forEach(([key,value])=>{const height=Math.round(Number(value)||0);if(widgets.includes(key)&&height>=120&&height<=1600)heights[key]=height;});
    const collapsed={};Object.entries(source.collapsed&&typeof source.collapsed==='object'?source.collapsed:{}).forEach(([key,value])=>{if(widgets.includes(key))collapsed[key]=Boolean(value);});
    return {order,hidden,widths,heights,collapsed};
  }
  function normalize(value){
    const input=value&&typeof value==='object'?value:{};
    const page=normalizeBucket(input,WIDGETS,DEFAULT.widths);
    /* Yeni Global Flow Map, kayıtlı eski düzenlerde kaybolmasın veya en alta düşmesin:\n       mevcut launchpad'in hemen arkasına bir kez yerleştirilir. Kullanıcı daha sonra\n       Edit Layout ile istediği yere taşıyabilir. */
    const savedOrder=Array.isArray(input.order)?input.order:[];
    if(savedOrder.length&&!savedOrder.includes('globalFlowMap')){
      const current=page.order.indexOf('globalFlowMap');if(current>=0)page.order.splice(current,1);
      const launch=page.order.indexOf('launchpad');page.order.splice(launch>=0?launch+1:0,0,'globalFlowMap');
    }
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
