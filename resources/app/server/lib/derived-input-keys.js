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

/* KOOPERATİF ANAHTAR (sayfa önbelleği yazımı, ana iş parçacığı).
   keys() tüm kaynağı tek JSON.stringify ile serileştirir; 60k satırda bu 1,5–2,3
   sn'lik tek bir olay döngüsü bloğudur. keysAsync aynı SHA-256 girdisini —
   JSON.stringify'ın ürettiği baytların aynısını — parça parça üretir ve süre
   bütçesi dolunca olay döngüsüne döner (cooperative-steps). Büyük düz dizi ve
   nesnelere (eleman/anahtar sayısı LARGE üstü) inilir; küçük düğümler ve toJSON
   taşıyan ya da düz olmayan değerler doğrudan JSON.stringify ile yazılır.
   Kimlik önbelleği yine yok: içerik her çağrıda baştan hash'lenir. */
const {runStepsAsync}=require('./cooperative-steps');
const LARGE=256,FLUSH_PIECES=2048;
function descend(value){
  if(!value||typeof value!=='object'||typeof value.toJSON==='function')return false;
  if(Array.isArray(value))return value.length>LARGE;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype||proto===null)&&Object.keys(value).length>LARGE;
}
function* stream(value,sink,ancestors){
  if(!descend(value)){sink.push(JSON.stringify(value));return;}
  if(ancestors.has(value))throw new TypeError('Converting circular structure to JSON');
  ancestors.add(value);
  if(Array.isArray(value)){
    sink.push('[');
    for(let index=0;index<value.length;index++){
      if(index)sink.push(',');
      const item=value[index];
      if(descend(item))yield* stream(item,sink,ancestors);
      else{const text=JSON.stringify(item);sink.push(text===undefined?'null':text);}
      yield;
    }
    sink.push(']');
  }else{
    sink.push('{');let first=true;
    for(const key of Object.keys(value)){
      const item=value[key];
      if(descend(item)){sink.push((first?'':',')+JSON.stringify(key)+':');first=false;yield* stream(item,sink,ancestors);}
      else{const text=JSON.stringify(item);if(text!==undefined){sink.push((first?'':',')+JSON.stringify(key)+':'+text);first=false;}}
      yield;
    }
    sink.push('}');
  }
  ancestors.delete(value);
}
function* hashSteps(value,seen){
  if(value&&typeof value==='object'&&seen.has(value))return seen.get(value);
  const digest=crypto.createHash('sha256');let pieces=[];
  const sink={push(text){pieces.push(text);if(pieces.length>=FLUSH_PIECES){digest.update(pieces.join(''));pieces=[];}}};
  yield* stream(value??null,sink,new Set());
  if(pieces.length)digest.update(pieces.join(''));
  const key=digest.digest('hex');
  if(value&&typeof value==='object')seen.set(value,key);return key;
}
function* keysSteps(runtime,contextHash,overrides,{version='',day=new Date()}={}){
  const active=runtime||{},seen=new WeakMap(),hash=value=>hashSteps(value,seen);
  const date=day instanceof Date?`${day.getFullYear()}-${day.getMonth()+1}-${day.getDate()}`:String(day);
  const common=yield* hash({engine:1,version,day:date,contextHash,overrides,cpupdateOverrides:active.cpupdateOverrides||null});
  const source=target=>Array.isArray(active.asasOrdersByTarget?.[target])?active.asasOrdersByTarget[target]:(active.asasOrders||[]);
  const warehouse=target=>active.antrepoMapByTarget?.[target]&&typeof active.antrepoMapByTarget[target]==='object'?active.antrepoMapByTarget[target]:(active.antrepoMap||{});
  const input=function*(target){
    const rows=yield* hash(source(target)),map=yield* hash(warehouse(target));
    return yield* hash([common,rows,map,active.modelRefresh?.appliedHorizons?.[target]??null]);
  };
  const cp=yield* input('cp'),orders=yield* input('orders'),backlog=yield* input('backlog');
  return {cp,overview:cp,orders,'order-summary':cp,'collection-catalog':yield* hash([orders,cp]),backlog};
}
// keys() ile aynı değer; olay döngüsünü budgetMs'den uzun tutmaz.
function keysAsync(runtime,contextHash,overrides,options={},{budgetMs}={}){
  return runStepsAsync(keysSteps(runtime,contextHash,overrides,options),{budgetMs});
}
module.exports={keys,inputKey,keysAsync};
