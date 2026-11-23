'use strict';
const crypto=require('node:crypto');
// Derived data never trusts loadedAt as content identity. Fresh clocks and LFL
// reads do not alter these inputs; authorization, overrides and local day do.
// Kimlik önbelleği bilerek yok: aynı nesne yerinde değişirse anahtar da değişir.
function hasher(){
  const seen=new WeakMap();
  return value=>{
    if(value&&typeof value==='object'&&seen.has(value))return seen.get(value);
    const key=crypto.createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
    if(value&&typeof value==='object')seen.set(value,key);return key;
  };
}
function context(runtime,contextHash,overrides,{version='',day=new Date()}={},hash=hasher()){
  const active=runtime||{};
  const date=day instanceof Date?`${day.getFullYear()}-${day.getMonth()+1}-${day.getDate()}`:String(day);
  const common=hash({engine:1,version,day:date,contextHash,overrides,cpupdateOverrides:active.cpupdateOverrides||null});
  const source=target=>Array.isArray(active.asasOrdersByTarget?.[target])?active.asasOrdersByTarget[target]:(active.asasOrders||[]);
  const warehouse=target=>active.antrepoMapByTarget?.[target]&&typeof active.antrepoMapByTarget[target]==='object'?active.antrepoMapByTarget[target]:(active.antrepoMap||{});
  return target=>hash([common,hash(source(target)),hash(warehouse(target)),active.modelRefresh?.appliedHorizons?.[target]??null]);
}
function keys(runtime,contextHash,overrides,options={}){
  const hash=hasher(),input=context(runtime,contextHash,overrides,options,hash);
  const cp=input('cp'),orders=input('orders'),backlog=input('backlog');
  return {cp,overview:cp,orders,'order-summary':cp,'collection-catalog':hash([orders,cp]),backlog};
}
// Tek hedefin anahtarı (keys()[target] ile aynı değer). Yalnız o hedefin
// verisini hash'ler; Planlanan & Gerçekleşen capture'ı üç hedefin tamamını
// serileştirmek zorunda kalmaz.
function inputKey(runtime,contextHash,overrides,target,options={}){
  return context(runtime,contextHash,overrides,options)(target);
}
module.exports={keys,inputKey};
