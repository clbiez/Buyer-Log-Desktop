(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLExceptionInbox=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const TYPES=Object.freeze(['EX_FACTORY_OVERDUE','DATE_SYNC_MISMATCH']),IDENTITY=Object.freeze(['orderCode','modelName','colourCode']);
 const empty=()=>({items:[],counts:Object.fromEntries(TYPES.map(type=>[type,0])),total:0});
 /* Okuma modeli (#1074): öğeler yerel arka uçta aynı project ile hesaplanır.
    Önceden hesaplanmış sonuç project'e satır yerine verilir; yetki/kapsam
    kapısı (allowed) aynen uygulanır. */
 const PRECOMPUTED=Symbol('exception-inbox-precomputed');
 function precomputed(result){
  const source=result&&typeof result==='object'?result:{};
  const counts=Object.fromEntries(TYPES.map(type=>[type,Number(source.counts&&source.counts[type])||0]));
  return {[PRECOMPUTED]:true,items:Array.isArray(source.items)?source.items.slice():[],counts,total:Number(source.total)||0};
 }
 async function project(rows,{fields,analyze,allowed=()=>true,filter=()=>true,limit=200,yield:pause=()=>new Promise(resolve=>setTimeout(resolve,0))}){
  if(rows&&rows[PRECOMPUTED]===true)return allowed()?{items:rows.items,counts:rows.counts,total:rows.total}:{...empty(),cancelled:true};
  const out=empty(),seen=new Set(),cap=Math.max(1,Math.min(1000,Number(limit)||200)),listed=Object.fromEntries(TYPES.map(type=>[type,0]));
  for(let i=0;i<rows.length;i++){
   if(!allowed())return {...empty(),cancelled:true};
   const row=rows[i],orderCode=fields.canonicalValue(row,'cp','orderCode');
   if(orderCode&&filter(row)){
    const key=fields.keyFor(row,'cp',IDENTITY),analysis=analyze(row),reasons=new Set(analysis?.riskReasons||[]);
    for(const type of TYPES){const id=JSON.stringify([type,key]);if(!reasons.has(type)||seen.has(id))continue;seen.add(id);out.counts[type]++;out.total++;
     if(listed[type]<cap){listed[type]++;out.items.push({id,key,type,orderCode:String(fields.value(row,'cp','orderCode')??orderCode),modelName:String(fields.value(row,'cp','modelName')||''),colourCode:String(fields.value(row,'cp','colourCode')||'')});}
    }
   }
   if(i%150===149)await pause();
  }
  return allowed()?out:{...empty(),cancelled:true};
 }
 function createGate(){let serial=0,value=null;
  return {begin(user,scope){return {serial:++serial,user,scope};},accept(token,data,user,scope){if(token.serial!==serial||token.user!==user||token.scope!==scope||data?.cancelled)return false;value={...data,user,scope};return true;},snapshot(user,scope){return value?.user===user&&value?.scope===scope?value:null;},invalidate(){++serial;},clear(){++serial;value=null;}};
 }
 return {TYPES,IDENTITY,project,precomputed,createGate};
});
