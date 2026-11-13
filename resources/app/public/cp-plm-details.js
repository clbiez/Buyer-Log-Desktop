/* Buyer Log — CP / Orders PLM Artwork + Fabric projection.
 * Source of truth is the same persisted PLM BOM snapshot Collection uses.
 * No ASAS/order overrides, second storage, remote PLM call, or AI in rendering.
 */
(function(global){
  'use strict';
  if(global.BLCPPlmDetails)return;
  const BATCH=500,FRESH_MS=60000;
  const state={cache:new Map(),fetchedAt:0,revision:0,inflight:null,cpRows:[],ordersRows:[],repaint:null,patch:null};
  function numericId(value){
    let text=String(value==null?'':value).trim().replace(/^_+/,'');
    if(/^\d+\.0+$/.test(text))text=text.slice(0,text.indexOf('.'));
    text=text.replace(/^0+(?=\d)/,'');
    return /^\d+$/.test(text)&&Number(text)>0?text:'';
  }
  function rows(){return [...state.cpRows,...state.ordersRows];}
  function ids(){return [...new Set(rows().map(row=>numericId(row&&row['PLM ID'])).filter(Boolean))];}
  function summaryFor(entry){
    if(!entry)return '';
    const canonical=global.BLCollectionArtworkDetail;
    if(canonical&&typeof canonical.summaryFor==='function')return canonical.summaryFor(entry);
    if(entry.isSetStyle)return entry.artworkSummary||entry.summary||'';
    if(!entry.hasPrint)return global.document?.documentElement?.lang==='en'?'No print':'Baskı yok';
    return entry.summary||'';
  }
  function fabricFor(entry){return entry?(entry.fabricSummary||entry.fabric||''):'';}
  function project(){
    let changes=0;
    for(const row of rows()){
      const id=numericId(row&&row['PLM ID']);
      if(!id||!state.cache.has(id))continue;
      const entry=state.cache.get(id),artwork=summaryFor(entry),fabric=fabricFor(entry);
      if(row['Artwork Detail']!==artwork){row['Artwork Detail']=artwork;changes++;}
      if(row['Fabric (PLM)']!==fabric){row['Fabric (PLM)']=fabric;changes++;}
    }
    return changes;
  }
  async function postBatch(body){
    const response=await fetch('/api/plm-sync/bom/batch',{
      method:'POST',headers:{'Content-Type':'application/json'},
      cache:'no-store',body:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.ok)throw new Error(payload.error||response.statusText);
    return payload;
  }
  /* Sessiz arka plan BOM tazelemesinden (cp-plm-silent-bom.js) sonra yalnız
     değişen modeller okunur ve yalnız değişen hücreler yamanır: tablo bütünüyle
     yeniden çizilmez (30k satır), kaydırma/seçim/odak ve Motion+ satır
     animasyonu etkilenmez. Yama işlevi yoksa satır verisi yine güncellenir;
     sonraki doğal çizim güncel değeri gösterir. */
  // 30k satırlık taramayı ana iş parçacığını uzun süre tutmadan dilimler.
  const SCAN_SLICE=2000;
  const yieldToMain=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function applyIds(changedIds){
    const wanted=new Set((Array.isArray(changedIds)?changedIds:[]).map(numericId).filter(Boolean));
    if(!wanted.size)return 0;
    const targets=[...wanted],data={};
    try{
      for(let i=0;i<targets.length;i+=BATCH)Object.assign(data,(await postBatch({plmIds:targets.slice(i,i+BATCH)})).entries||{});
    }catch(_){return 0;} // okunamazsa eldeki kanıt korunur
    const fresh=new Map();
    for(const id of targets)if(data[id]){state.cache.set(id,data[id]);fresh.set(id,{artwork:summaryFor(data[id]),fabric:fabricFor(data[id])});}
    if(!fresh.size)return 0;
    let total=0;
    for(const [table,list] of [['cp',state.cpRows],['orders',state.ordersRows]]){
      for(let start=0;start<list.length;start+=SCAN_SLICE){
        const changes=[],end=Math.min(list.length,start+SCAN_SLICE);
        for(let i=start;i<end;i++){
          const row=list[i],raw=row&&row['PLM ID'];
          if(raw==null||raw==='')continue;
          const next=fresh.get(numericId(raw));
          if(!next)continue;
          const keys=[],previous={};
          if(row['Artwork Detail']!==next.artwork){previous['Artwork Detail']=row['Artwork Detail'];row['Artwork Detail']=next.artwork;keys.push('Artwork Detail');}
          if(row['Fabric (PLM)']!==next.fabric){previous['Fabric (PLM)']=row['Fabric (PLM)'];row['Fabric (PLM)']=next.fabric;keys.push('Fabric (PLM)');}
          if(keys.length)changes.push({table,row,keys,previous});
        }
        if(changes.length){total+=changes.length;if(typeof state.patch==='function'){try{state.patch(changes);}catch(_){}}}
        if(end<list.length)await yieldToMain();
      }
    }
    return total;
  }
  async function ensureFresh(force=false){
    if(state.inflight)return force?state.inflight.then(()=>ensureFresh(true)):state.inflight;
    const wanted=ids();
    if(!wanted.length)return 0;
    const stale=force||Date.now()-state.fetchedAt>FRESH_MS;
    const missing=wanted.filter(id=>!state.cache.has(id));
    if(!stale&&!missing.length)return project();
    const targets=stale?wanted:missing;
    const post=postBatch;
    const promise=(async()=>{
      const data={};
      let revision=0;
      try{
        // Depo son okumadan beri yazılmadıysa bütün ID'ler yeniden taşınmaz.
        if(stale&&!force&&!missing.length&&state.revision&&(await post({plmIds:[],ifRevision:state.revision})).notModified){
          state.fetchedAt=Date.now();
          return project();
        }
        for(let i=0;i<targets.length;i+=BATCH){
          const payload=await post({plmIds:targets.slice(i,i+BATCH)});
          const current=Number(payload.revision)||0;
          revision=i===0?current:Math.min(revision,current);
          Object.assign(data,payload.entries||{});
        }
      }catch(_){return 0;} // failed read does not erase cached evidence
      for(const id of targets)state.cache.set(id,data[id]||null);
      if(stale){
        /* revision yalnız bu turda okunan ID'leri temsil eder; görünür kümenin
           dışında kalan eski kayıtlar atılır ki geri döndüklerinde yeniden
           okunsunlar (aksi hâlde notModified onları süresiz bayat tutardı). */
        const fresh=new Set(targets);
        for(const id of [...state.cache.keys()])if(!fresh.has(id))state.cache.delete(id);
        state.fetchedAt=Date.now();state.revision=revision;
      }
      const changed=project();
      if(changed&&typeof state.repaint==='function')state.repaint();
      return changed;
    })();
    state.inflight=promise;
    try{return await promise;}finally{if(state.inflight===promise)state.inflight=null;}
  }
  function sync({cpRows=[],ordersRows=[],repaint=null,patch=null}={}){
    state.cpRows=Array.isArray(cpRows)?cpRows:[];
    state.ordersRows=Array.isArray(ordersRows)?ordersRows:[];
    if(typeof repaint==='function')state.repaint=repaint;
    if(typeof patch==='function')state.patch=patch;
    project(); // resolve before sort/filter/export on the current render
    return ensureFresh();
  }
  function hasValue(id,kind){
    const normalized=numericId(id),entry=state.cache.get(normalized);
    if(!entry)return false;
    return kind==='fabric'?Boolean(fabricFor(entry).trim()):Boolean(entry.styleId);
  }
  global.BLCPPlmDetails={sync,refresh:()=>ensureFresh(true),project,summaryFor,fabricFor,hasValue,ids,applyIds};
})(window);
