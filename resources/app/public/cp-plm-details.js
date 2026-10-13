/* Buyer Log — CP / Orders PLM Artwork + Fabric projection.
 * Source of truth is the same persisted PLM BOM snapshot Collection uses.
 * No ASAS/order overrides, second storage, remote PLM call, or AI in rendering.
 */
(function(global){
  'use strict';
  if(global.BLCPPlmDetails)return;
  const BATCH=500,FRESH_MS=60000;
  const state={cache:new Map(),fetchedAt:0,inflight:null,cpRows:[],ordersRows:[],repaint:null};
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
  async function ensureFresh(force=false){
    if(state.inflight)return force?state.inflight.then(()=>ensureFresh(true)):state.inflight;
    const wanted=ids();
    if(!wanted.length)return 0;
    const stale=force||Date.now()-state.fetchedAt>FRESH_MS;
    const missing=wanted.filter(id=>!state.cache.has(id));
    if(!stale&&!missing.length)return project();
    const targets=stale?wanted:missing;
    const promise=(async()=>{
      const data={};
      try{
        for(let i=0;i<targets.length;i+=BATCH){
          const batch=targets.slice(i,i+BATCH);
          const response=await fetch('/api/plm-sync/bom/batch',{
            method:'POST',headers:{'Content-Type':'application/json'},
            cache:'no-store',body:JSON.stringify({plmIds:batch})
          });
          const payload=await response.json().catch(()=>({}));
          if(!response.ok||!payload.ok)throw new Error(payload.error||response.statusText);
          Object.assign(data,payload.entries||{});
        }
      }catch(_){return 0;} // failed read does not erase cached evidence
      for(const id of targets)state.cache.set(id,data[id]||null);
      if(stale)state.fetchedAt=Date.now();
      const changed=project();
      if(changed&&typeof state.repaint==='function')state.repaint();
      return changed;
    })();
    state.inflight=promise;
    try{return await promise;}finally{if(state.inflight===promise)state.inflight=null;}
  }
  function sync({cpRows=[],ordersRows=[],repaint=null}={}){
    state.cpRows=Array.isArray(cpRows)?cpRows:[];
    state.ordersRows=Array.isArray(ordersRows)?ordersRows:[];
    if(typeof repaint==='function')state.repaint=repaint;
    project(); // resolve before sort/filter/export on the current render
    return ensureFresh();
  }
  function hasValue(id,kind){
    const normalized=numericId(id),entry=state.cache.get(normalized);
    if(!entry)return false;
    return kind==='fabric'?Boolean(fabricFor(entry).trim()):Boolean(entry.styleId);
  }
  global.BLCPPlmDetails={sync,refresh:()=>ensureFresh(true),project,summaryFor,fabricFor,hasValue};
})(window);
