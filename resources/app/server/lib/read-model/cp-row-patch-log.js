'use strict';
/* CP satır yaması günlüğü (#1078 WS5 satır yaması). Süreç içi, yalnız bellek.
 *
 * Satır kaydı (POST /api/overrides/rows) yazdığı yamaları projeksiyon bağlamı geçişiyle
 * (before.contextHash → after.contextHash) buraya ekler. Okuma modeli (cp-computed-service)
 * işçideki son veri kümesinden güncel bağlama bir zincir bulursa yeni projeksiyon neslini
 * (sayfa önbelleği yeniden yazımı, 30k'da 6–10 sn) BEKLEMEDEN yamalı veri kümesiyle hesaplar.
 *
 * Girdi yalnız artımlı uygulanabilir yamaları taşır (server.js rowPatchIncrementalSafe; projeksiyon
 * yeniden yazımıyla aynı kural). Tek öğe bile uygun değilse geçiş kaydedilmez: zincir kopar, okuma
 * normal yola (gerçek nesil) düşer. Yama bağlamı (notesmap alt kümesi, not sütunu tanımları, transit
 * kuralları) yeniden yazımın kullandığı effectiveOverridesForUser'dan kayıt anında alınır.
 *
 * Doğrulama: projeksiyon yeniden yazımı CP modülünde yamaladığı ham satırları `settle` ile bildirir
 * (gerçek neslin bu satırları). Servis bunları işçideki yamalı satırlarla karşılaştırır.
 * Sınırlar: kullanıcı başına MAX_ENTRIES geçiş, TTL; zincir MAX_CHAIN_ITEMS öğeyi aşarsa yok sayılır. */
const MAX_ENTRIES=64,TTL_MS=15*60*1000,MAX_CHAIN_ITEMS=2000;

function createCpRowPatchLog({now=()=>Date.now(),maxEntries=MAX_ENTRIES,ttlMs=TTL_MS,maxChainItems=MAX_CHAIN_ITEMS}={}){
  const users=new Map();let seq=0;
  const counters={recorded:0,unsafe:0,settledOk:0,settledFailed:0};
  function listFor(userId){
    const key=String(userId),list=users.get(key)||[];
    const cutoff=now()-ttlMs;
    while(list.length&&list[0].at<cutoff)list.shift();
    if(!list.length)users.delete(key);
    return list;
  }
  /* items: [{orderCode,patch}] (yazılan, no-op olmayan). safe: öğe artımlı uygulanabilir mi.
     context: {notesmap,noteColumnDefs,transitRules,cpRowStored?}. Dönen: girdi ya da null (kaydedilmedi). */
  function record({userId,before,after,items,context,safe}){
    if(userId==null||!before||!after||String(before)===String(after)||!Array.isArray(items)||!items.length)return null;
    if(typeof safe!=='function'||items.some(item=>!item||!Number.isFinite(Number(item.orderCode))||!safe(item.patch))){counters.unsafe++;return null;}
    const key=String(userId),list=listFor(userId);
    const entry={seq:++seq,at:now(),before:String(before),after:String(after),
      items:items.map(item=>({orderCode:Number(item.orderCode),patch:item.patch})),
      context:{notesmap:context&&context.notesmap||{},noteColumnDefs:context&&context.noteColumnDefs||[],transitRules:context&&context.transitRules||[],
        ...(context&&context.cpRowStored?{cpRowStored:context.cpRowStored}:{})},
      settled:null};
    list.push(entry);while(list.length>maxEntries)list.shift();
    users.set(key,list);counters.recorded++;
    return entry;
  }
  /* Projeksiyon yeniden yazımı bitti: ok=false (yazılamadı / atlandı) ya da gerçek neslin yamalı CP satırları. */
  function settle(entry,{ok,rowsJson=null}){
    if(!entry||entry.settled)return;
    entry.settled=ok?{ok:true,rowsJson:typeof rowsJson==='string'?rowsJson:'[]'}:{ok:false};
    if(ok)counters.settledOk++;else counters.settledFailed++;
  }
  /* from → to geçiş zinciri (sıralı girdiler) ya da null. Aynı bağlamdan birden çok geçiş varsa en yenisi. */
  function chain(userId,from,to){
    if(from==null||to==null)return null;
    from=String(from);to=String(to);
    if(from===to)return {entries:[],items:0};
    const list=listFor(userId);if(!list.length)return null;
    const entries=[];let current=from,items=0,floor=0;
    for(let guard=0;guard<list.length&&current!==to;guard++){
      let next=null;
      for(let i=list.length-1;i>=floor;i--)if(list[i].before===current){next=i;break;}
      if(next==null)return null;
      const entry=list[next];entries.push(entry);items+=entry.items.length;
      if(items>maxChainItems)return null;
      current=entry.after;floor=next+1;
    }
    return current===to?{entries,items}:null;
  }
  function clear(userId){if(userId==null)users.clear();else users.delete(String(userId));}
  function stats(){let entries=0;for(const list of users.values())entries+=list.length;return {...counters,users:users.size,entries};}
  return {record,settle,chain,clear,stats};
}
module.exports={createCpRowPatchLog,MAX_ENTRIES,TTL_MS,MAX_CHAIN_ITEMS};
