/* Shared, pure set-part identity and aggregation for CP and Collection. */
(function(root,factory){
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?require('./canonical-fields'):root.BLCanonicalFields);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLChecklistComponents=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Fields){
  'use strict';
  const CONFIG_ITEM='@set-components',SUFFIX='~part~';
  function validCount(value){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=26?n:0;}
  function description(row,moduleId){
    return ['category','productDescription','productMainDefinition'].map(id=>String(Fields.value(row||{},moduleId||'cp',id)||'')).join(' ');
  }
  function isSet(row,moduleId){return /tak[ıi]m|\bsets?\b/i.test(description(row,moduleId));}
  function count(row,moduleId){
    const explicit=validCount(Fields.value(row||{},moduleId||'cp','setPieceCount'));
    if(explicit)return explicit>1?explicit:0;
    const raw=description(row,moduleId);
    if(!isSet(row,moduleId))return 0;
    const match=raw.match(/(\d+)\s*[-'’]?\s*(?:l[ıiuü]|pieces?|pcs|par[çc]a)/i)||raw.match(/(?:sets?|tak[ıi]m)\s*(?:of\s*)?(\d+)/i);
    const n=validCount(match&&match[1]);return n>1?n:0;
  }
  function labels(n){return Array.from({length:validCount(n)>1?n:0},(_,i)=>String.fromCharCode(65+i));}
  function itemId(base,part){
    if(!/^[A-Z]$/.test(part)||!base||parseItem(base)||String(base).length>180)throw new Error('Invalid checklist part identity.');
    return base+SUFFIX+part;
  }
  function parseItem(id){const match=String(id||'').match(/^(.*)~part~([A-Z])$/);return match?{baseId:match[1],partId:match[2]}:null;}
  function configKey(analysis){return String(analysis.orderKey)+'::'+CONFIG_ITEM;}
  function partsFor(analysis,answers){
    if(!analysis)return [];
    const saved=answers&&answers[configKey(analysis)];
    const n=validCount(saved&&saved.componentCount)||count(analysis.sourceRow||analysis,'cp');
    return labels(n).map(id=>({id,label:id}));
  }
  function aggregate(states,resolved){
    const list=states||[],done=resolved||((s)=>s==='approved'||s==='notRequired');
    if(list.includes('rejected'))return 'rejected';
    if(!list.length||list.some(s=>!done(s)))return 'open';
    if(list.every(s=>s==='notRequired'))return 'notRequired';
    return 'approved';
  }
  function valueParts(value,n){
    if(value&&typeof value==='object'&&Array.isArray(value.parts))return value.parts.map(p=>({...p}));
    return labels(n).map(id=>({id,label:id,state:'open'}));
  }
  function updateValue(value,n,part,state){
    const parts=valueParts(value,n);
    if(!parts.some(p=>p.id===part))throw new Error('Unknown checklist part.');
    return {schemaVersion:1,legacyStatus:value&&typeof value==='object'?value.legacyStatus||'':String(value||''),parts:parts.map(p=>p.id===part?{...p,state}:p)};
  }
  /* v7.0.290 — BİLEŞEN (element) sonuçları. Set parçasından farklıdır: tek
     ürünün birden çok kumaşı/aksesuarı olabilir (Main Fabric, Neck RIB …).
     Aynı checklist cevabı içinde, adı kullanıcı tarafından düzenlenebilen
     bileşen satırları olarak tutulur; hücre tek kalır, genel durum bileşen
     durumlarından türetilir (biri Reddedildi ise Reddedildi). Bileşen yoksa
     cevap eskisi gibi tek bileşenlidir. */
  const MAX_ELEMENTS=12;
  const ELEMENT_SUGGESTIONS=Object.freeze([
    Object.freeze({tr:'Ana Kumaş',en:'Main Fabric'}),Object.freeze({tr:'Yaka Ribanası',en:'Neck RIB'}),
    Object.freeze({tr:'Manşet / Etek Ribanası',en:'Cuff / Hem RIB'}),Object.freeze({tr:'Astar',en:'Lining'}),
    Object.freeze({tr:'Garni Kumaş',en:'Contrast Fabric'}),Object.freeze({tr:'Cep Astarı',en:'Pocketing'}),
    Object.freeze({tr:'Baskı',en:'Print'}),Object.freeze({tr:'Nakış',en:'Embroidery'}),
    Object.freeze({tr:'Aksesuar',en:'Trim'}),
  ]);
  function elementName(value){return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,60);}
  // Büyük/küçük harf ve TR/EN "I/İ/ı" farkı aynı bileşeni ikiye bölmez.
  function elementKey(value){return elementName(value).replace(/[İIı]/g,'i').toLowerCase();}
  function normalizeElements(list,normalizeStatus){
    const norm=typeof normalizeStatus==='function'?normalizeStatus:(v=>String(v||''));
    const out=[],seen=new Set();
    for(const raw of Array.isArray(list)?list:[]){
      if(!raw||typeof raw!=='object')continue;
      const name=elementName(raw.name),key=elementKey(name);
      if(!name||seen.has(key))continue;
      seen.add(key);
      const item={id:String(raw.id||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,24)||'e'+(out.length+1),name,state:norm(raw.state)||'open'};
      if(raw.reportNumber!=null&&String(raw.reportNumber).trim())item.reportNumber=String(raw.reportNumber).slice(0,300);
      if(raw.note!=null&&String(raw.note).trim())item.note=String(raw.note).slice(0,500);
      if(raw.at)item.at=String(raw.at).slice(0,40);
      out.push(item);
      if(out.length>=MAX_ELEMENTS)break;
    }
    const ids=new Set();
    for(const item of out){while(ids.has(item.id))item.id=item.id+'x';ids.add(item.id);}
    return out;
  }
  /* Aynı adlı bileşeni günceller, yoksa ekler (test raporu aktarımı). */
  function upsertElement(list,entry,normalizeStatus){
    const current=normalizeElements(list,normalizeStatus),key=elementKey(entry&&entry.name);
    if(!key)return current;
    const index=current.findIndex(item=>elementKey(item.name)===key);
    const next={...(index>=0?current[index]:{}),...entry,name:elementName(entry.name)};
    if(index>=0)current[index]=next;else current.push(next);
    return normalizeElements(current,normalizeStatus);
  }
  function elementsState(list,resolved){
    const items=Array.isArray(list)?list:[];
    return items.length?aggregate(items.map(item=>item.state),resolved):'';
  }
  function elementsLabel(list,statusLabel){
    const label=typeof statusLabel==='function'?statusLabel:(v=>v);
    return (Array.isArray(list)?list:[]).map(item=>item.name+' · '+label(item.state)).join(' | ');
  }
  return {CONFIG_ITEM,validCount,isSet,count,labels,itemId,parseItem,configKey,partsFor,aggregate,valueParts,updateValue,
    MAX_ELEMENTS,ELEMENT_SUGGESTIONS,elementName,elementKey,normalizeElements,upsertElement,elementsState,elementsLabel};
});
