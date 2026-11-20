(function(){
'use strict';

/* Backlog Genel Bakış (V3) paneli.
   Backlog'un AYNI aktif filtresiyle (/api/backlog-export?format=json) satır
   detayını alır; toplulaştırma BLBacklogV3Report'tadır. Görsel dil
   Planlanan & Gerçekleşen paneliyle ortaktır (bpa* sınıfları).
   Satır isteği BLBacklogRows ile paylaşılır: Teslimat Riski paneli aynı
   imzalı isteği tekrar göndermez. */
const STORAGE_KEY='lcw.backlog.overview.v1';
const ROW_LIMIT=500;
const $=id=>document.getElementById(id);
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const lang=()=>document.documentElement.lang==='en'?'en':'tr';
const L=(tr,en)=>lang()==='en'?en:tr;
const nf=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:0});
const pf=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:1});
/* Kategorik grafik paleti tema token'larından okunur (app.css --chart-1…8); tema değişince yeniden çizimde güncellenir. */
const CHART_FALLBACK=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6','#e34948'];
function chartColors(){try{const cs=getComputedStyle(document.documentElement);const out=[];for(let i=1;i<=8;i++){const v=cs.getPropertyValue('--ui-chart-'+i).trim();if(v)out.push(v);}return out.length===8?out:CHART_FALLBACK;}catch(_){return CHART_FALLBACK;}}
const n=v=>nf.format(Number(v)||0);
const pct=v=>v==null||!Number.isFinite(v)?'—':'%'+pf.format(v*100);
const R=()=>window.BLBacklogV3Report;
let state=loadState();
let baseItems=null,model=null,remote=null,loading=false,error='',signature='',tips=new Map(),openers=new Map(),seq=0,bound=false;
let filterCatalog=null,filterCatalogPromise=null,filterCatalogError='',filterOpen=false,filterSource='cp',filterSearch='',filterEditorId='',filterValueSearch='';
const filterFacets=new Map();
let refreshGeneration=0,sourceRevision='',catalogGeneration=0,overviewRequest=null;
function cancelOverviewRequest(){++refreshGeneration;overviewRequest?.abort();overviewRequest=null;loading=false;}
function requestAborted(){return new DOMException('Aborted','AbortError');}
function assertRequest(signal){if(signal?.aborted)throw requestAborted();}
function cancelFilterValues(keepKey){for(const [key,entry] of filterFacets)if(key!==keepKey&&entry.loading){entry.controller.abort();filterFacets.delete(key);}}

function loadState(){
  const defaults={open:true,groupBy:'buyer',barScale:'pct',timeField:'exFactory',granularity:'week',timelineChart:'stacked',timelineDimension:'buyingGroup',showAll:false,exportPlanActual:true,exportLegacy:true,filters:[],importanceScope:'all'};
  try{
    const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'null');
    if(raw&&typeof raw==='object'){
      const merged={...defaults,...raw};
      merged.filters=normalizeFilters(raw.filters);
      return merged;
    }
  }catch(_){}
  return defaults;
}
function normalizeFilters(list){
  return Array.isArray(list)?list.filter(f=>f&&f.id&&f.rowKey).map(f=>({
    id:String(f.id),source:String(f.source||'cp'),header:String(f.header||f.rowKey),rowKey:String(f.rowKey),
    label:String(f.label||f.header||f.rowKey),values:Array.isArray(f.values)?f.values.map(v=>String(v)):[],
    from:String(f.from||''),to:String(f.to||'')
  })):[];
}
function saveState(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
function fmtDay(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:'—'}

/* ------------------------------------------------ Favori filtre setleri */
/* Kullanıcının adlandırdığı analiz filtresi kombinasyonları. Anahtar
   lcw.backlog.overview. önekinde olduğu için BLStorage ile kullanıcıya özeldir.
   Favori yalnız kriteri olan filtreleri saklar; uygulamak aktif filtreleri değiştirir. */
const FAVORITES_KEY='lcw.backlog.overview.favorites.v1';
const FAVORITES_MAX=40;
let favorites=loadFavorites(),favoriteNaming=false,favoriteDraft='';
function loadFavorites(){
  try{
    const raw=JSON.parse((window.BLStorage||localStorage).getItem(FAVORITES_KEY)||'[]');
    return (Array.isArray(raw)?raw:[]).filter(f=>f&&f.id&&String(f.name||'').trim()).map(f=>({
      id:String(f.id),name:String(f.name).trim().slice(0,60),filters:normalizeFilters(f.filters),savedAt:String(f.savedAt||'')
    })).filter(f=>f.filters.length).slice(0,FAVORITES_MAX);
  }catch(_){return [];}
}
function saveFavorites(){try{(window.BLStorage||localStorage).setItem(FAVORITES_KEY,JSON.stringify(favorites));}catch(_){}}
function favoriteSignature(filters){
  return JSON.stringify(normalizeFilters(filters).filter(filterHasCriteria).map(f=>[f.id,[...f.values].sort(),f.from,f.to]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0));
}
function currentFavoriteId(){
  if(!activeFilterCount())return '';
  const sig=favoriteSignature(overviewFilters());
  return favorites.find(f=>favoriteSignature(f.filters)===sig)?.id||'';
}
function saveCurrentFavorite(name){
  name=String(name||'').trim().slice(0,60);
  const filters=normalizeFilters(overviewFilters()).filter(filterHasCriteria);
  if(!name||!filters.length)return false;
  const existing=favorites.find(f=>f.name.toLocaleLowerCase('tr')===name.toLocaleLowerCase('tr'));
  if(existing){
    if(!window.confirm(L(`"${existing.name}" favorisi mevcut filtrelerle güncellensin mi?`,`Update the "${existing.name}" favourite with the current filters?`)))return false;
    existing.filters=filters;existing.savedAt=new Date().toISOString();
  }else{
    if(favorites.length>=FAVORITES_MAX){window.alert(L(`En fazla ${FAVORITES_MAX} favori kaydedilebilir. Önce birini silin.`,`You can save up to ${FAVORITES_MAX} favourites. Delete one first.`));return false;}
    favorites=[...favorites,{id:'fav_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,filters,savedAt:new Date().toISOString()}];
  }
  saveFavorites();return true;
}
function applyFavorite(id){
  const fav=favorites.find(f=>f.id===id);if(!fav)return;
  state.filters=normalizeFilters(fav.filters);
  filterEditorId='';filterValueSearch='';signature='';
  cancelFilterValues();
  reapplyOverviewFilters();
}
function deleteFavorite(id){
  const fav=favorites.find(f=>f.id===id);if(!fav)return;
  if(!window.confirm(L(`"${fav.name}" favorisi silinsin mi? Aktif filtreler değişmez.`,`Delete the "${fav.name}" favourite? Active filters stay unchanged.`)))return;
  favorites=favorites.filter(f=>f.id!==id);saveFavorites();renderFilterPanel();
}
function favoriteTitle(fav){
  return fav.filters.map(f=>`${filterSourceLabel(f.source)} · ${f.label}: ${filterCriterionText(f)}`).join('\n');
}
function renderFavoriteBar(){
  const current=currentFavoriteId(),canSave=activeFilterCount()>0;
  const chips=favorites.map(fav=>`<span class="blvFavChip${fav.id===current?' is-current':''}"><button type="button" data-blvf-fav-apply="${esc(encodeURIComponent(fav.id))}" title="${esc(favoriteTitle(fav))}"><svg class="ic"><use href="#${fav.id===current?'i-check':'i-filter'}"/></svg><b>${esc(fav.name)}</b><small>${esc(L(`${fav.filters.length} filtre`,fav.filters.length===1?'1 filter':`${fav.filters.length} filters`))}</small></button><button type="button" class="blvFavDelete" data-blvf-fav-delete="${esc(encodeURIComponent(fav.id))}" title="${esc(L('Favoriyi sil','Delete favourite'))}"><svg class="ic"><use href="#i-x"/></svg></button></span>`).join('');
  const naming=favoriteNaming&&canSave
    ?`<form class="blvFavForm" data-blvf-fav-form><input type="text" data-blvf-fav-name maxlength="60" value="${esc(favoriteDraft)}" placeholder="${esc(L('Favori adı (ör. SS27 Bangladeş)','Favourite name (e.g. SS27 Bangladesh)'))}" aria-label="${esc(L('Favori adı','Favourite name'))}"><button type="submit" data-blvf-fav-confirm>${esc(L('Kaydet','Save'))}</button><button type="button" data-blvf-fav-cancel>${esc(L('Vazgeç','Cancel'))}</button></form>`
    :`<button type="button" class="blvFavSave" data-blvf-fav-new${canSave?'':' disabled'} title="${esc(canSave?L('Aktif filtreleri adlandırıp favori olarak saklayın','Name the active filters and keep them as a favourite'):L('Kaydetmek için önce filtre seçin','Select filters first to save'))}"><svg class="ic"><use href="#i-plus"/></svg>${esc(current?L('Yeni favori','New favourite'):L('Favori olarak kaydet','Save as favourite'))}</button>`;
  return `<div class="blvFilterFavs"><span class="blvFavLabel">${esc(L('Favoriler','Favourites'))}</span><div class="blvFavList">${chips||`<span class="blvFavEmpty">${esc(L('Sık kullandığınız filtre setlerini kaydedip tek tıkla uygulayın.','Save filter sets you use often and apply them in one click.'))}</span>`}</div>${naming}</div>`;
}

/* ------------------------------------------------ Ortak Backlog analiz filtreleri */
function overviewFilters(){return Array.isArray(state.filters)?state.filters:[]}
// Filtre kuralı panel ve okuma modeli işçisinde aynıdır: BLBacklogV3Report (#1079 WS6c).
function filterValueKey(value){return R().filterValueKey(value)}
function filterHasCriteria(filter){return R().filterHasCriteria(filter)}
function activeFilterCount(){return overviewFilters().filter(filterHasCriteria).length}
function updateFilterButton(){
  const btn=$('backlogOverviewFilter'),badge=$('backlogOverviewFilterCount'),count=activeFilterCount();
  if(btn){btn.classList.toggle('is-active',count>0);btn.setAttribute('aria-expanded',filterOpen?'true':'false');}
  if(badge){badge.hidden=count===0;badge.textContent=String(count);}
}
function filterSourceColumnIds(){
  return [...new Set(overviewFilters().filter(f=>f.source==='asas'||f.source==='antrepo').map(f=>f.id).filter(Boolean))];
}
function overviewQueryParams(){
  const base=queryParams();if(!base)return null;
  const params={...base},extra=filterSourceColumnIds();
  if(extra.length){
    const existing=String(params.sourceColumns||'').split(',').map(v=>v.trim()).filter(Boolean);
    params.sourceColumns=[...new Set([...existing,...extra])].join(',');
  }
  return params;
}
function filterFacetParams(filter){
  const params={...(queryParams()||{}),field:filter.id};
  for(const key of ['analysisFilters','sourceColumns','format','groupBy','antrepoDateLevels','lazyDimensions'])delete params[key];
  return params;
}
function filterFacet(filter){return filterFacets.get(JSON.stringify(filterFacetParams(filter)));}
async function ensureFilterValues(filter){
  if(!filter)return;
  const params=filterFacetParams(filter),key=JSON.stringify(params),known=filterFacets.get(key);
  cancelFilterValues(key);
  if(known&&!known.error)return known.promise;
  const entry={loading:true,data:null,error:'',controller:new AbortController()};filterFacets.set(key,entry);
  while(filterFacets.size>12)filterFacets.delete(filterFacets.keys().next().value);
  entry.promise=fetch('/api/backlog-filter-values?'+new URLSearchParams(params),{credentials:'same-origin',signal:entry.controller.signal}).then(async response=>{
    const body=await response.json();if(!response.ok)throw new Error(body.error||`HTTP ${response.status}`);
    assertRequest(entry.controller.signal);if(filterFacets.get(key)===entry)entry.data=body;
  }).catch(error=>{if(!entry.controller.signal.aborted)entry.error=String(error.message||error);}).finally(()=>{entry.loading=false;if(filterOpen&&filterFacets.get(key)===entry)renderFilterPanel();});
  renderFilterPanel();return entry.promise;
}
function filterRawValue(item,filter){return item&&item.row?item.row[filter.rowKey]:null}
// Faset türü (sunucu) > okuma modelinin çıkardığı tür > yerel satırlardan çıkarım.
function knownFilterKinds(){
  const out={};
  for(const filter of overviewFilters()){const facet=filterFacet(filter);if(facet?.data?.kind)out[filter.id]=facet.data.kind;}
  return out;
}
function filterKind(filter){
  const facet=filterFacet(filter);if(facet?.data)return facet.data.kind;
  if(Array.isArray(baseItems))return R().inferFilterKind(baseItems,filter);
  const inferred=model&&model.filterKinds&&model.filterKinds[filter.id];
  return inferred||R().inferFilterKind([],filter);
}
function distinctFilterValues(filter){
  const facet=filterFacet(filter);
  if(facet?.data)return facet.data.values.map(entry=>({...entry,label:entry.value===''?L('(boş)','(blank)'):entry.value}));
  const counts=new Map();
  for(const item of (baseItems||[])){
    const key=filterValueKey(filterRawValue(item,filter));
    counts.set(key,(counts.get(key)||0)+1);
  }
  return [...counts.entries()].map(([value,count])=>({value,count,label:value===''?L('(boş)','(blank)'):value}))
    .sort((a,b)=>BLBusinessRules.compareChronologicalValues(a.value,b.value));
}
/* Özel sipariş kapsamı: Tümü · yalnız özel (BTS, Bayram …) · yalnız Regular. */
function importanceScope(){return ['special','regular'].includes(state.importanceScope)?state.importanceScope:'all'}
let sharedFilterTimer=0;
function reapplyOverviewFilters(){
  cancelOverviewRequest();saveState();loading=true;signature='';render();
  clearTimeout(sharedFilterTimer);
  sharedFilterTimer=setTimeout(()=>{if(typeof fetchCurrentBacklog==='function')fetchCurrentBacklog();},140);
}


/* ------------------------------------------------ ortak satır önbelleği */
/* Aynı satır sorgusu için tüm paneller tek promise/dizi paylaşır. Gruplama
   satır kümesini değiştirmez; kaynak revizyonu değişince bütün girişler düşer. */
const rowsCache=new Map();
const rowsRevisions=new Map();
const rowsQueryKey=params=>JSON.stringify(Object.keys(params||{}).sort().filter(key=>!['groupBy','antrepoDateLevels','lazyDimensions'].includes(key)).map(key=>[key,params[key]]));
function loadData(params,{signal}={}){
  assertRequest(signal);
  const sig=rowsQueryKey(params),known=rowsCache.get(sig);
  if(known)return consumeRows(known,sig,signal);
  const entry={controller:new AbortController(),consumers:new Set(),settled:false};rowsCache.set(sig,entry);
  while(rowsCache.size>4)rowsCache.delete(rowsCache.keys().next().value);
  const qs=new URLSearchParams(params||{}).toString();
  entry.promise=fetch('/api/backlog-export?'+qs,{credentials:'same-origin',signal:entry.controller.signal}).then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body&&body.error?body.error:`HTTP ${res.status}`);
    await window.BLMerchCalendarReady;
    assertRequest(entry.controller.signal);
    if(rowsCache.get(sig)===entry&&body.merchCalendar)window.BLMerchCalendarRuntime?.apply?.(body.merchCalendar);
    let rows=Array.isArray(body.rows)?body.rows:[];
    const revision=typeof body.rowsRevision==='string'?body.rowsRevision:'',previous=rowsRevisions.get(sig);
    if(revision&&previous?.revision===revision)rows=previous.rows;
    else if(revision&&rowsCache.get(sig)===entry){
      rowsRevisions.set(sig,{revision,rows});
      while(rowsRevisions.size>4)rowsRevisions.delete(rowsRevisions.keys().next().value);
    }
    return {...body,rows};
  }).catch(err=>{if(rowsCache.get(sig)===entry)rowsCache.delete(sig);throw err;}).finally(()=>{entry.settled=true;});
  return consumeRows(entry,sig,signal);
}
function consumeRows(entry,sig,signal){
  return new Promise((resolve,reject)=>{
    const consumer={};entry.consumers.add(consumer);let done=false;
    const finish=(error,value)=>{
      if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.consumers.delete(consumer);
      if(!entry.settled&&!entry.consumers.size){
        if(rowsCache.get(sig)===entry)rowsCache.delete(sig);
        entry.controller.abort();
      }
      if(error)reject(error);else resolve(value);
    };
    const abort=()=>finish(requestAborted());signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    entry.promise.then(value=>finish(null,value),error=>finish(error));
  });
}
async function loadRows(params,options={}){
  // Teslimat paneli lazy init sırasında pivot yanıtından önce çalışabilir.
  // Bütün tam satır tüketicileri aynı revizyon kapısından geçip tek isteği paylaşır.
  if(window.BLBacklogChartContext?.whenRowsReady)await window.BLBacklogChartContext.whenRowsReady();
  assertRequest(options.signal);return loadData(params,options).then(body=>body.rows);
}
window.BLBacklogRows={load:loadRows,loadData,invalidate:()=>rowsCache.clear()};

function queryParams(){try{return typeof backlogExportQueryParams==='function'?backlogExportQueryParams():null;}catch(_){return null;}}
function visible(){const c=$('backlogContent');return !!c&&c.style.display!=='none'&&!!c.offsetParent;}
/* #1079 WS6c — BL_READ_MODEL_BACKLOG_V3 (varsayılan AÇIK). Açıkken panel satır listesi
   indirmez: görünüm modeli yerel arka ucun okuma modeli işçisinde AYNI BLBacklogV3Report
   koduyla hesaplanır, tarayıcıya yalnız sonuç gelir; drill-down satırları tıklanınca yüklenir.
   Kapalıyken (geri dönüş) satırlar /api/backlog-export'tan alınır ve model burada kurulur.
   Geri dönüş: window.BL_READ_MODEL_BACKLOG_V3=false ya da yerel tercih buyerlog.readModel.backlogV3.v1='0'. */
function backendModelEnabled(){
  if(typeof window.BL_READ_MODEL_BACKLOG_V3==='boolean')return window.BL_READ_MODEL_BACKLOG_V3;
  try{return localStorage.getItem('buyerlog.readModel.backlogV3.v1')!=='0';}catch(_){return true;}
}
const V3_MODEL_URL='/api/read-model/backlog/v3';
function viewState(){
  return {lang:lang(),groupBy:state.groupBy,timeField:state.timeField,granularity:state.granularity,timelineDimension:state.timelineDimension,
    importanceScope:importanceScope(),filters:overviewFilters().map(f=>({...f,values:[...(f.values||[])]})),filterKinds:knownFilterKinds(),today:R().dayIso(new Date())};
}
function priorityStampKey(){const api=priorityIndex();return priorityStatus()+':'+(api&&typeof api.revision==='function'?String(api.revision()):'');}
function currentViewKey(){return JSON.stringify([viewState(),priorityStampKey()]);}
async function refresh(force){
  if(backendModelEnabled())return refreshRemote(force);
  const host=$('backlogOverviewBody');if(!host||!state.open)return;
  const params=overviewQueryParams();if(!params){return;}
  const sig=JSON.stringify(params);
  cancelOverviewRequest();const generation=refreshGeneration;
  if(!force&&sig===signature&&baseItems){loading=false;error='';return render();}
  const request=new AbortController();overviewRequest=request;
  loading=true;error='';render();
  try{
    if(window.BLPerf?.ensureFeature)await window.BLPerf.ensureFeature('backlogAnalysis').catch(()=>null);
    assertRequest(request.signal);if(force)window.BLBacklogRows.invalidate();
    const rows=await loadRows(params,{signal:request.signal});
    if(generation!==refreshGeneration||JSON.stringify(overviewQueryParams()||{})!==sig)return;
    if(!R())throw new Error(L('Backlog V3 rapor motoru yüklenemedi.','Backlog V3 report engine could not be loaded.'));
    // Aynı satır dizisi (aynı sunucu revizyonu) zaten normalleştirildiyse tekrarlanmaz.
    if(!(rows===normalizedRows&&baseItems))baseItems=R().normalizeRows(rows);
    normalizedRows=rows;signature=sig;
  }catch(err){if(generation!==refreshGeneration)return;error=String(err&&err.message||err);baseItems=null;model=null;}
  finally{if(overviewRequest===request)overviewRequest=null;if(generation===refreshGeneration){loading=false;render();}}
}
async function postModel(body,signal){
  const res=await fetch(V3_MODEL_URL,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(lang()==='en'&&data.errorEn?data.errorEn:(data.error||`HTTP ${res.status}`));
  return data;
}
/* Öncelik: CP öncelik dizini yalnız tarayıcıdadır. Sunucu, kayıtların öncelik anahtarlarını
   (sipariş · model · renk) bir kez gönderir; isabetler burada aynı priorityAnnotation ile
   hesaplanır ve sözlük + anahtar başına indeks olarak geri gider. Dizin ya da veri kümesi
   değişince tablo yeniden kurulur. */
let priorityTable=null;
function resolveTags(code,tags,tracking){return window.BLOrderDecisionEngine.resolvePriorityTags(code,tags,tracking);}
function priorityRanks(codes){
  for(const entry of priorityIndex()?.catalog?.()||[])if(entry&&entry.id)codes.add(entry.id);
  return Object.fromEntries([...codes].filter(Boolean).map(code=>[code,priorityRank(code)]));
}
function priorityRequest(){
  const ready=priorityStatus()==='ready',out={ready,empty:R().priorityAnnotation(null,resolveTags)};
  const table=ready&&priorityTable&&remote&&priorityTable.dataset===remote.dataset&&priorityTable.stamp===priorityStampKey()?priorityTable:null;
  if(table)Object.assign(out,{keysToken:table.dataset,table:table.table,index:table.index});
  out.ranks=priorityRanks(new Set(table?table.codes:[]));
  return out;
}
async function buildPriorityTable(keys,dataset,signal){
  const api=priorityIndex(),stamp=priorityStampKey(),table=[],seen=new Map(),index=new Array(keys.length),codes=new Set();
  for(let i=0;i<keys.length;i++){
    // Uzun görev oluşturmamak için parçalara bölünür.
    if(i&&i%2500===0){await new Promise(resolve=>setTimeout(resolve,0));assertRequest(signal);}
    const [orderCode,modelName,colourCode]=String(keys[i]).split('\u001f');
    const annotation=R().priorityAnnotation(api.lookup(orderCode,modelName,colourCode),resolveTags),sig=JSON.stringify(annotation);
    let at=seen.get(sig);
    if(at===undefined){at=table.length;table.push(annotation);seen.set(sig,at);[annotation.priorityCode,...annotation.priorityTags,...annotation.trackingTags].forEach(code=>code&&codes.add(code));}
    index[i]=at;
  }
  return {dataset,stamp,table,index:index.join(','),codes:[...codes]};
}
/* Teslimat Riski paneli aynı Backlog satırlarını kullanır: hesap işçisi satırları bir kez
   üretir (satır belleği). Genel Bakış isteği önce kuyruğa girer, panel ilk yanıtı bekler. */
let modelGate=null;
function openModelGate(){const gate={};gate.promise=new Promise(resolve=>{gate.resolve=resolve;});modelGate=gate;return gate;}
function closeModelGate(gate){gate.resolve();if(modelGate===gate)modelGate=null;}
async function refreshRemote(force){
  const host=$('backlogOverviewBody');if(!host||!state.open)return;
  const params=overviewQueryParams();if(!params){return;}
  const sig=JSON.stringify(params),viewKey=currentViewKey();
  cancelOverviewRequest();const generation=refreshGeneration;
  if(!force&&remote&&remote.sig===sig&&remote.viewKey===viewKey){loading=false;error='';model=remote.model;return render();}
  const request=new AbortController();overviewRequest=request;
  // Görünüm değişiminde (gruplama, zaman alanı, dil …) mevcut model yanıt gelene kadar görünür kalır.
  if(!(remote&&remote.sig===sig)||force){loading=true;error='';render();}
  const gate=openModelGate();
  try{
    // Model sunucuda hesaplanır: analiz özelliklerinin yüklenmesi beklenmez (paralel başlar).
    if(window.BLPerf?.ensureFeature)void window.BLPerf.ensureFeature('backlogAnalysis').catch(()=>null);
    if(force)window.BLBacklogRows.invalidate();
    const body=()=>({version:1,query:params,view:viewState(),priority:priorityRequest()});
    let data=await postModel(body(),request.signal).finally(()=>closeModelGate(gate));
    if(generation!==refreshGeneration)return;
    remote={sig,viewKey,model:data.model,dataset:data.dataset};model=data.model;signature=sig;
    if(data.priority&&data.priority.needKeys&&Array.isArray(data.keys)){
      // Model öncelik etiketleri hazırlanırken çizilir; etiketler ikinci yanıtla gelir.
      loading=false;error='';render();
      priorityTable=await buildPriorityTable(data.keys,data.dataset,request.signal);
      if(generation!==refreshGeneration)return;
      data=await postModel(body(),request.signal);
      if(generation!==refreshGeneration)return;
      remote={sig,viewKey,model:data.model,dataset:data.dataset};model=data.model;
    }
  }catch(err){if(generation!==refreshGeneration)return;error=String(err&&err.message||err);remote=null;model=null;}
  finally{closeModelGate(gate);if(overviewRequest===request)overviewRequest=null;if(generation===refreshGeneration){loading=false;render();}}
}
// Görünüm seçimi değişti: yerel modelde yeniden çizim, arka uç modelinde yeni sonuç.
function updateView(){if(backendModelEnabled())void refresh(false);else render();}
let pendingTimer=0,lastData=null,normalizedRows=null;
function onBacklogRendered(data){
  $('backlogContent')?.classList.add('has-blv');
  // Her yeni Backlog yanıtı (filtre değişimi veya veri yenileme) taze satır
  // demektir: ortak önbellek ve imza burada, Teslimat Riski panelinden ÖNCE sıfırlanır.
  if(data!==lastData){
    cancelOverviewRequest();cancelFilterValues();
    lastData=data;
    if(!data?.rowsInputRevision || sourceRevision!==data.rowsInputRevision){
      if(sourceRevision){++catalogGeneration;filterCatalog=null;filterCatalogPromise=null;}
      sourceRevision=data?.rowsInputRevision||'';window.BLBacklogRows.invalidate();filterFacets.clear();
    }
    signature='';remote=null;
    if(filterOpen){void ensureFilterCatalog().then(()=>ensureFilterValues(overviewFilters().find(f=>f.id===filterEditorId))).catch(()=>{});renderFilterPanel();}
  }
  clearTimeout(pendingTimer);
  // Okuma modeli: istek hemen gider (sunucu hesabı Teslimat Riski panelinden önce kuyruğa girer).
  if(backendModelEnabled()){if(visible())void refresh(false);return;}
  pendingTimer=setTimeout(()=>{if(visible())void refresh(false);},60);
}

/* --------------------------------------------------------------- çizim */
function tip(html){const id='t'+(++seq);tips.set(id,html);return id}
function opener(spec){const id='o'+(++seq);openers.set(id,spec);return id}
function tipHtml(title,lines,hint){return `<div class="bpaTipTitle">${esc(title)}</div>${lines.map(([k,v,stage])=>`<div class="bpaTipLine"><span>${esc(k)}</span><b${stage?` data-stage="${stage}" class="blvTipVal"`:''}>${esc(v)}</b></div>`).join('')}${hint?`<div class="bpaTipHint">${esc(hint)}</div>`:''}`}
function stageLabel(key){return R().stageLabel(key,lang())}
function ring(value){
  const raw=Number(value),v=Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):0;
  return `<svg class="blvLoadChart" viewBox="0 0 160 160" aria-hidden="true" focusable="false"><circle class="bpaRingTrack" cx="80" cy="80" r="66"/><circle class="bpaRingValue" cx="80" cy="80" r="66" pathLength="100" stroke-dasharray="${v*100} 100" transform="rotate(-90 80 80)"/></svg>`;
}
/* ------------------------------------------------ Öncelik etiketleri */
/* Öncelik Kuralları CP'de kişisel karar katmanıyla hesaplanır. Backlog satırı
   aynı sipariş/model/renk kimliğiyle ortak dizinden (app-main.js →
   BLCpPriorityIndex) okunur; kurallar burada ikinci kez değerlendirilmez. */
const PRIORITY_DIMENSION='priority';
const PRIORITY_TILE_LIMIT=8;
const OD=()=>window.BLOrderDecisionEngine||null;
const priorityIndex=()=>window.BLCpPriorityIndex||null;
let priorityStamp='',priorityEnsureFailed=false;
function priorityLabel(code){const od=OD();return (od&&typeof od.priorityLabel==='function'&&od.priorityLabel(code,lang()))||code||'';}
function priorityMeta(code){const od=OD();return od&&typeof od.priorityMeta==='function'?od.priorityMeta(code):null;}
function priorityRank(code){const od=OD(),rank=od&&typeof od.priorityRank==='function'?Number(od.priorityRank(code)):NaN;return Number.isFinite(rank)?rank:99;}
function priorityStatus(){
  const api=priorityIndex();
  if(!api||typeof api.lookup!=='function')return 'unavailable';
  return api.ready()?'ready':(priorityEnsureFailed?'unavailable':'pending');
}
/* Normalleştirilmiş Backlog kayıtlarına ana öncelik + takip etiketlerini işler.
   Dizin revizyonu aynı kaldıkça tekrar eşleştirilmez. */
function annotatePriorities(list){
  const api=priorityIndex();
  if(!Array.isArray(list)||!list.length)return;
  const stamp=api&&typeof api.revision==='function'?String(api.revision()):'';
  if(list[0]&&list[0]._priorityStamp===stamp&&stamp===priorityStamp)return;
  const ready=!!(api&&api.ready&&api.ready());
  for(const item of list){
    // 'cp' = CP (checklist dahil) · 'orders' = Siparişler (aynı kurallar, checklist hariç)
    R().applyPriorityAnnotation(item,R().priorityAnnotation(ready?api.lookup(item.orderCode,item.modelName,item.colourCode):null,resolveTags));
    item._priorityStamp=stamp;
  }
  priorityStamp=stamp;
}
/* Geri dönüş yolu: tarayıcıdaki satırlardan aynı görünüm modeli. */
function localModel(){
  annotatePriorities(baseItems);
  const codes=new Set();
  for(const item of baseItems)[item.priorityCode,...(item.priorityTags||[]),...(item.trackingTags||[])].forEach(code=>code&&codes.add(code));
  return R().panelModel(baseItems,{...viewState(),priorityReady:priorityStatus()==='ready',ranks:priorityRanks(codes)});
}
function ensurePriorityIndex(){
  const api=priorityIndex();
  if(!api||typeof api.ensure!=='function'||api.ready()||priorityEnsureFailed)return;
  void Promise.resolve(api.ensure()).then(ok=>{
    if(!ok){priorityEnsureFailed=true;if(visible())render();}
  }).catch(()=>{priorityEnsureFailed=true;if(visible())render();});
}
/* Kutucuk ipucu: adedin hangi kaynaktan geldiği. Siparişler kaynağı checklist'e
   bağlı kuralları içermez; bu fark kullanıcıya açıkça söylenir. Etiket gruplaması
   (Yolunda hariç, katalog sırası) BLBacklogV3Report.panelModel'dedir. */
function prioritySourceTitle(tag){
  const cp=tag.cpQty,orders=tag.ordersQty;
  const lines=[L(`CP: ${n(cp)} adet`,`CP: ${n(cp)} pcs`)];
  if(orders)lines.push(L(`Siparişler (checklist hariç): ${n(orders)} adet`,`Orders (excluding checklist): ${n(orders)} pcs`));
  return lines.join('\n');
}
// Model öncelik taşımıyorsa: dizin hazırsa etiketler hazırlanıyor, değilse dizinin durumu.
function modelPriorityStatus(m){const status=priorityStatus();return m&&m.priority?'ready':status==='ready'?'pending':status;}
function priorityTone(code){const meta=priorityMeta(code);return meta&&meta.tone?String(meta.tone):'gray';}
function priorityTiles(m,tile,by){
  const s=m.total,status=modelPriorityStatus(m);
  if(status!=='ready'){
    const sub=status==='pending'?L('CP öncelikleri hazırlanıyor…','Preparing CP priorities…'):L('Öncelik etiketleri için CP verisi gerekli','CP data is required for priority tags');
    return `<div class="bpaTile blvTile blvPriorityTile is-muted" data-priority-tone="gray" role="status"><span class="bpaTileValue">—</span><span class="bpaTileLabel">${esc(L('Öncelik etiketleri','Priority tags'))}</span><span class="bpaTileSub">${esc(sub)}</span></div>`;
  }
  const groups=m.priority.tags;
  if(!groups.length)return `<div class="bpaTile blvTile blvPriorityTile is-muted" data-priority-tone="green" role="status"><span class="bpaTileValue">0</span><span class="bpaTileLabel">${esc(L('Öncelik etiketli adet','Priority-tagged qty'))}</span><span class="bpaTileSub">${esc(L('Bu kapsamda etiketli sipariş yok','No tagged orders in this scope'))}</span></div>`;
  const shown=groups.length>PRIORITY_TILE_LIMIT?groups.slice(0,PRIORITY_TILE_LIMIT-1):groups;
  const rest=groups.slice(shown.length);
  const share=v=>pct(s.qty?v/s.qty:null);
  const html=shown.map(g=>{
    const label=priorityLabel(g.code),tracking=priorityMeta(g.code)?.usage==='tracking';
    const sub=L(`${n(g.orders)} sipariş · ${share(g.qty)}${tracking?' · takip':''}`,`${n(g.orders)} orders · ${share(g.qty)}${tracking?' · tracking':''}`);
    return tile(n(g.qty),label,sub,'',by(label,{k:'tags',codes:[g.code]}),g.code,prioritySourceTitle(g));
  });
  if(rest.length){
    const label=L(`Diğer ${rest.length} etiket`,`${rest.length} more tags`);
    html.push(tile(n(m.priority.rest.qty),label,rest.map(g=>priorityLabel(g.code)).join(' · '),'',by(label,{k:'tags',codes:rest.map(g=>g.code)}),'__rest'));
  }
  return html.join('');
}
function hero(m){
  const s=m.total,st=s.stages;
  const tile=(value,label,sub,stage,open,priority,title)=>`<button type="button" class="bpaTile blvTile${priority?' blvPriorityTile':''}"${title?` title="${esc(title)}"`:''}${stage?` data-stage="${stage}"`:''}${priority?` data-priority-tone="${esc(priority==='__rest'?'gray':priorityTone(priority))}" data-priority-code="${esc(priority)}"`:''}${open?` data-blv-open="${open}"`:''}><span class="bpaTileValue">${esc(value)}</span><span class="bpaTileLabel">${esc(label)}</span>${sub?`<span class="bpaTileSub">${esc(sub)}</span>`:''}</button>`;
  const by=(title,spec)=>opener({title,subtitle:L('Backlog genel bakış','Backlog overview'),spec});
  const share=v=>pct(s.qty?v/s.qty:null);
  return `<div class="bpaHero">
    <div class="bpaRing blvLoadRing blMotionEnter">${ring(s.loadedPct)}<div class="bpaRingText"><b>${esc(pct(s.loadedPct))}</b><span>${esc(L('yüklendi','loaded'))}</span></div><div class="bpaRingSub">${esc(L(`${n(s.orders)} sipariş · ${n(s.lines)} satır`,`${n(s.orders)} orders · ${n(s.lines)} lines`))}</div></div>
    <div class="bpaTiles">
      ${tile(n(s.qty),L('Toplam adet','Total qty'),L(`${n(s.rows)} operasyon satırı`,`${n(s.rows)} operational rows`),'',by(L('Tüm Backlog','Entire Backlog'),{k:'all'}))}
      ${tile(n(st.PRODUCTION),stageLabel('PRODUCTION'),share(st.PRODUCTION),'PRODUCTION',by(stageLabel('PRODUCTION'),{k:'stages',stages:['PRODUCTION']}))}
      ${tile(n(st.LOADING),stageLabel('LOADING'),share(st.LOADING),'LOADING',by(stageLabel('LOADING'),{k:'stages',stages:['LOADING']}))}
      ${tile(n(st.IN_TRANSIT+st.CUSTOMS),L('Yolda + Gümrük','In transit + customs'),share(st.IN_TRANSIT+st.CUSTOMS),'IN_TRANSIT',by(L('Yolda + Gümrük','In transit + customs'),{k:'stages',stages:['IN_TRANSIT','CUSTOMS']}))}
      ${tile(n(st.IN_WAREHOUSE+st.AWAITING_RETAIL_TRANSFER),L('Depoda + Retail bekleyen','Warehouse + awaiting retail'),share(st.IN_WAREHOUSE+st.AWAITING_RETAIL_TRANSFER),'IN_WAREHOUSE',by(L('Depoda + Retail bekleyen','Warehouse + awaiting retail'),{k:'stages',stages:['IN_WAREHOUSE','AWAITING_RETAIL_TRANSFER']}))}
      ${tile(n(s.overdueQty),L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'),L(`${n(s.overdueLines)} satır`,`${n(s.overdueLines)} lines`),'SHORTAGE',by(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'),{k:'overdue'}))}
      ${tile(n(s.specialQty),L('Özel siparişler','Special orders'),L(`${n(s.specialOrders)} sipariş · ${n(s.specialRiskOrders)} riskli`,`${n(s.specialOrders)} orders · ${n(s.specialRiskOrders)} at risk`),s.specialRiskOrders?'SHORTAGE':'',by(L('Özel siparişler','Special orders'),{k:'special'}))}
      ${priorityTiles(m,tile,by)}
    </div>
  </div>`;
}
/* Veri kalitesi şeridi: hatalı/eksik kaynak verisi rapora sessizce girmesin. */
function qualityStrip(m){
  const issues=m.quality||[];
  if(!issues.length)return '';
  const chips=issues.map(issue=>{
    const o=opener({title:lang()==='en'?issue.en:issue.tr,subtitle:L('Veri kalitesi','Data quality'),spec:{k:'quality',key:issue.key}});
    return `<button type="button" class="blvQualityChip" data-blv-open="${o}"><b>${n(issue.count)}</b> ${esc(L('satır','lines'))} · ${esc(lang()==='en'?issue.en:issue.tr)}</button>`;
  }).join('');
  return `<div class="blvQuality" role="status"><span class="blvQualityTitle">${esc(L('Veri kalitesi uyarısı','Data quality warning'))}</span>${chips}<span class="blvQualityHint">${esc(L('Satırlar Excel Backlog V3 › Veri Kalitesi sayfasında da listelenir.','Rows are also listed in Excel Backlog V3 › Data Quality.'))}</span></div>`;
}
/* Özel sipariş uyarısı: riskli siparişlerin içindeki özel siparişler ayrıca
   gösterilir ("riskli 100 siparişin 30'u özel"). Etiket bazında çip tıklanınca
   o etiketin riskli satırları sağdaki çekmecede açılır. */
function importanceSelector(){
  const scope=importanceScope();
  return `<div class="bpaSeg2 blvImportanceScope" role="group" aria-label="${esc(L('Özel sipariş kapsamı','Special order scope'))}">${[['all',L('Tümü','All')],['special',L('Özel','Special')],['regular','Regular']].map(([key,label])=>`<button type="button" class="${scope===key?'is-active':''}" aria-pressed="${scope===key}" data-blv-importance="${key}">${esc(label)}</button>`).join('')}</div>`;
}
function recoveryControls(){
  return `<div class="blvQuality">${importanceSelector()}<span class="bpaSectionSpacer"></span><button type="button" class="tbtn" data-blv-action="filters">${esc(L('Analiz filtrelerini düzenle','Edit analysis filters'))}</button>${activeFilterCount()?`<button type="button" class="tbtn" data-blv-action="clearFilters">${esc(L('Analiz filtrelerini temizle','Clear analysis filters'))}</button>`:''}</div>`;
}
function specialStrip(m){
  const total=m.total;
  const seg=importanceSelector();
  const risky=m.special||[];
  const chips=risky.map(g=>{
    const o=opener({title:`${g.name} · ${L('riskli','at risk')}`,subtitle:L('Özel sipariş riski','Special order risk'),spec:{k:'risk',name:g.name}});
    return `<button type="button" class="blvQualityChip blvSpecialChip" data-blv-open="${o}"><b>${n(g.riskOrders)}</b> ${esc(L('sipariş','orders'))} · ${esc(g.name)} · ${n(g.riskQty)} ${esc(L('adet','pcs'))}</button>`;
  }).join('');
  const message=total.specialRiskOrders
    ? L(`Riskli ${n(total.riskOrders)} siparişin ${n(total.specialRiskOrders)} tanesi özel sipariş`,`${n(total.specialRiskOrders)} of ${n(total.riskOrders)} at-risk orders are special orders`)
    : (total.specialOrders?L(`${n(total.specialOrders)} özel siparişte risk yok`,`No risk on ${n(total.specialOrders)} special orders`):L('Bu kapsamda önem etiketli sipariş yok','No tagged orders in this scope'));
  return `<div class="blvQuality blvSpecial${total.specialRiskOrders?' is-alert':''}" role="status"><span class="blvQualityTitle">${esc(message)}</span>${chips}<span class="bpaSectionSpacer"></span>${seg}</div>`;
}
function legend(){return `<div class="bpaLegend">${R().STAGES.map(s=>`<span><i class="bpaDot" data-stage="${s.key}"></i>${esc(stageLabel(s.key))}</span>`).join('')}</div>`}
function bar(name,g,scaleMax,subtitle,specFor){
  const width=state.barScale==='qty'&&scaleMax>0?Math.max(2,g.qty/scaleMax*100):100;
  const segs=R().STAGES.filter(s=>g.stages[s.key]>0).map(s=>{
    const qty=g.stages[s.key];
    const t=tip(tipHtml(name,[[subtitle,name],[stageLabel(s.key),n(qty)+' '+L('adet','pcs'),s.key],[L('Grup içindeki payı','Share of group'),pct(g.qty?qty/g.qty:null)],[L('Satır','Lines'),n(g.stageLines[s.key])]],L('Detay için tıklayın','Click for details')));
    const o=opener({title:name,subtitle:`${subtitle} · ${stageLabel(s.key)}`,spec:specFor(s.key),stage:s.key});
    return `<span class="bpaSeg" data-stage="${s.key}" style="flex-grow:${qty}" data-blv-tip="${t}" data-blv-open="${o}"></span>`;
  }).join('');
  return `<div class="bpaBarTrack"><div class="bpaBar" style="width:${width.toFixed(2)}%">${segs||'<span class="bpaSeg is-empty"></span>'}</div></div>`;
}
function dimensionLabel(key){return key===PRIORITY_DIMENSION?L('Öncelik','Priority'):R().dimLabel(key,lang());}
/* Operasyon dağılımında her satır yalnız ANA önceliğiyle sayılır (toplam =
   Backlog adedi). Takip etiketleri üst kutucuklarda ayrıca görünür. */
/* Öncelik grubu adı: etiket kataloğu tarayıcıdadır. Kod yoksa: öncelik hazırlanıyor ya da eşleşme yok. */
function priorityGroupName(code,m){
  return code?priorityLabel(code):modelPriorityStatus(m)!=='ready'?L('(öncelik hazırlanıyor)','(priority pending)'):L('(öncelik eşleşmesi yok)','(no priority match)');
}
// Model grubu → çizim adı: öncelikte kod, diğer boyutlarda modelin adı.
function groupName(g,m){return g.code!==undefined?priorityGroupName(g.code,m):g.name;}
const groupSpecRef=(dim,g)=>dim===PRIORITY_DIMENSION?{code:g.code}:{name:g.name};
/* Katalog tonu → tasarım token'ı (ui-components.css .blvPriorityTile eşlemesiyle aynı). */
const PRIORITY_TONE_TOKEN={red:'--ui-danger',copper:'--ui-chart-4',orange:'--ui-warning',yellow:'--ui-warning',blue:'--ui-accent',teal:'--ui-chart-3',green:'--ui-success',gray:'--ui-text-secondary'};
function priorityToneVar(code){return `var(${code?(PRIORITY_TONE_TOKEN[priorityTone(code)]||'--ui-text-secondary'):'--ui-text-muted'})`;}
function groupCard(m){
  const total=m.total;
  const dims=[...R().DIMENSIONS,PRIORITY_DIMENSION],key=m.group.key,label=dimensionLabel(key);
  const groups=m.group.groups.map(g=>({...g,name:groupName(g,m)})),list=state.showAll?groups:groups.slice(0,15),max=groups.reduce((m,g)=>Math.max(m,g.qty),0);
  const row=(name,g,isTotal)=>{
    const ref=isTotal?null:{k:'group',dim:key,...groupSpecRef(key,g)};
    const o=opener({title:name,subtitle:label,spec:ref||{k:'all'}});
    return `<div class="bpaGRow${isTotal?' is-total':''}"><button type="button" class="bpaGName" data-blv-open="${o}" title="${esc(name)}">${esc(name)}</button>${bar(name,g,isTotal?0:max,label,stage=>ref?{...ref,stage}:{k:'stages',stages:[stage]})}<div class="bpaGStats"><b>${esc(pct(g.loadedPct))}</b><span>${n(g.qty)} ${esc(L('adet','pcs'))}${g.overdueQty?` · <i class="blvOver">${n(g.overdueQty)} ${esc(L('gecikmiş','overdue'))}</i>`:''}</span></div></div>`;
  };
  return `<div class="bpaCardBox"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Operasyon dağılımı','Operational distribution'))}</span><span class="bpaSectionSub">${esc(L('Segmentin üzerine gelin; tıklayınca siparişler sağda açılır. Sağdaki yüzde yüklenen oranıdır.','Hover a segment; click to open its orders. The percentage is the loaded share.'))}</span><span class="bpaSectionSpacer"></span>
    <div class="bpaSeg2" role="group">${dims.map(d=>`<button type="button" class="${d===key?'is-active':''}" data-blv-group="${d}">${esc(dimensionLabel(d))}</button>`).join('')}</div>
    <div class="bpaSeg2" role="group"><button type="button" class="${state.barScale!=='qty'?'is-active':''}" data-blv-scale="pct">%</button><button type="button" class="${state.barScale==='qty'?'is-active':''}" data-blv-scale="qty">${esc(L('Adet','Qty'))}</button></div></div>
    ${legend()}
    <div class="bpaGroups">${row(L('Tümü','All'),total,true)}${list.map(g=>row(g.name,g,false)).join('')}</div>
    ${groups.length>15?`<button type="button" class="bpaMore" data-blv-action="toggleAll">${esc(state.showAll?L('Daha az göster','Show less'):L(`Tümünü göster (${groups.length})`,`Show all (${groups.length})`))}</button>`:''}
  </div>`;
}
function timelineTipHtml(title,bucket){
  const rows=R().STAGES.filter(s=>(Number(bucket&&bucket.stages&&bucket.stages[s.key])||0)>0).map(s=>{
    const qty=Number(bucket.stages[s.key])||0;
    return `<span><i data-stage="${s.key}"></i><b>${esc(stageLabel(s.key))}</b><em>${esc(n(qty))}</em></span>`;
  }).join('');
  const total=Number(bucket&&bucket.qty)||0,overdue=Number(bucket&&bucket.overdueQty)||0;
  return `<strong>${esc(title)}</strong>${rows}<span class="backlogChartTooltipTotal"><i></i><b>${esc(L('Dönem toplamı','Period total'))}</b><em>${esc(n(total))}</em></span>${overdue?`<span class="blvTimelineTooltipOverdue"><i></i><b>${esc(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'))}</b><em>${esc(n(overdue))}</em></span>`:''}`;
}
function timelineGroupColor(index){const colors=chartColors();return colors[Math.max(0,Number(index)||0)%colors.length]}
/* Zaman Akışı alt kırılımı: Buyer Grup, Buyer veya Öncelik. Öncelikte her satır
   yalnız ANA önceliğiyle sayılır (dönem toplamı = Backlog adedi); sıra ve renk
   kullanıcının etiket kataloğundandır, takip etiketleri ipucunda listelenir. */
const TIMELINE_DIMENSIONS=['buyingGroup','buyer',PRIORITY_DIMENSION];
function timelineDimensionKey(value){return TIMELINE_DIMENSIONS.includes(value)?value:'buyingGroup';}
function timelineDimensionLabel(dimension){return dimension===PRIORITY_DIMENSION?L('Öncelik','Priority'):R().dimLabel(dimension,lang());}
/* names: [{name,color,ref}] — renk Buyer kırılımlarında grafik paletinden, Öncelikte etiket tonundan. */
function timelineDimensionNames(m){
  const dimension=m.timeline.dimension;
  return m.timeline.names.map((g,index)=>({name:groupName(g,m),color:dimension===PRIORITY_DIMENSION?priorityToneVar(g.code):timelineGroupColor(index),ref:groupSpecRef(dimension,g)}));
}
function timelineTrackingTipRows(tracking){
  return (tracking||[]).map(e=>`<span><i style="--ui-series-color:${priorityToneVar(e.code)}"></i><b>${esc(L('Takip: ','Tracking: ')+priorityLabel(e.code))}</b><em>${esc(n(e.qty))}</em></span>`).join('');
}
function timelineDimensionTipHtml(title,bucket,grouped,dimension,names){
  const byName=new Map(grouped.map(g=>[g.name,g]));
  const rows=(names||[]).map(entry=>{
    const g=byName.get(entry.name);if(!g||!g.qty)return '';
    return `<span><i style="--ui-series-color:${entry.color}"></i><b>${esc(entry.name)}</b><em>${esc(n(g.qty))}</em></span>`;
  }).join('');
  const tracking=dimension===PRIORITY_DIMENSION?timelineTrackingTipRows(bucket&&bucket.tracking):'';
  return `<strong>${esc(title)}</strong>${rows}<span class="backlogChartTooltipTotal"><i></i><b>${esc(L('Dönem toplamı','Period total'))}</b><em>${esc(n(bucket&&bucket.qty||0))}</em></span>${tracking}`;
}
function timelineDimensionLegend(names,label){
  return `<div class="blvTimelineLegend blvTimelineLegend--dimension"><span class="blvTimelineLegendLabel">${esc(label)}</span><div class="bpaLegend blvBuyerLegend">${(names||[]).map(entry=>`<span title="${esc(entry.name)}"><i class="bpaDot" style="--ui-series-color:${entry.color}"></i>${esc(entry.name)}</span>`).join('')}</div></div>`;
}
function flowCard(m){
  const fields=R().TIMELINE_FIELDS,field=fields.find(f=>f.key===m.timeline.field)||fields[0];
  const series=m.timeline.buckets,max=series.reduce((m,b)=>Math.max(m,b.qty),0);
  const stageMax=series.reduce((m,b)=>Math.max(m,...R().STAGES.map(s=>Number(b.stages[s.key])||0)),0);
  const chartMode=state.timelineChart==='grouped'?'grouped':'stacked';
  const dimension=m.timeline.dimension,dimensionLabel=timelineDimensionLabel(dimension);
  const dimensionNames=timelineDimensionNames(m);
  const dimensionByBucket=new Map(series.map(b=>[b.key,b.dims.map(g=>({...g,name:groupName(g,m)}))]));
  const bucketSpec=(b,extra)=>({k:'bucket',field:m.timeline.field,granularity:m.timeline.granularity,key:b.key,...extra});
  const dimensionMax=series.reduce((m,b)=>Math.max(m,...((dimensionByBucket.get(b.key)||[]).map(g=>Number(g.qty)||0)),0),0);
  const fLabel=lang()==='en'?field.en:field.tr;
  const today=R().dayIso(new Date()),todayMs=Date.parse(today+'T00:00:00Z');
  const bucketIsToday=b=>{
    if(!b||!b.start)return false;
    const startMs=Date.parse(b.start+'T00:00:00Z');
    const endMs=Date.parse((b.end||b.start)+'T00:00:00Z');
    if(Number.isFinite(startMs)&&Number.isFinite(endMs)&&Number.isFinite(todayMs))return todayMs>=startMs&&todayMs<=endMs;
    if(state.granularity==='month')return b.start.slice(0,7)===today.slice(0,7);
    return Number.isFinite(startMs)&&Number.isFinite(todayMs)&&todayMs>=startMs&&todayMs<startMs+7*86400000;
  };
  const cols=series.map(b=>{
    const isToday=bucketIsToday(b);
    const bucketTip=tip(timelineTipHtml(`${fLabel} · ${b.label}`,b));
    const value=`<span class="blvColTotal">${n(b.qty)}</span>${b.overdueQty?`<small class="blvColOverdue">${n(b.overdueQty)} ${esc(L('gecikmiş','overdue'))}</small>`:''}`;
    const todayMarker=isToday?`<span class="blvTodayLine blvUnifiedTodayLine" aria-hidden="true"><b>${esc(L('Bugün','Today'))}</b></span>`:'';
    const columnClass=`bpaCol blvUnifiedCol${b.past?' is-past':''}${isToday?' is-today':''}`;
    const commonAttrs=`data-blv-start="${esc(b.start||'')}" data-blv-tip="${bucketTip}" data-blv-tip-style="chart"${isToday?' data-blv-today="1"':''}`;
    let logistics='';
    if(chartMode==='grouped'){
      const bars=R().STAGES.filter(s=>b.stages[s.key]>0).map(s=>{
        const qty=b.stages[s.key];
        const o=opener({title:`${fLabel} · ${b.label}`,subtitle:stageLabel(s.key),spec:bucketSpec(b,{stage:s.key}),stage:s.key});
        const height=stageMax?Math.max(2,qty/stageMax*100):0;
        return `<span class="blvGroupBar" data-stage="${s.key}" style="height:${height.toFixed(1)}%" data-blv-open="${o}" title="${esc(stageLabel(s.key)+': '+n(qty))}"></span>`;
      }).join('');
      logistics=`<div class="blvGroupBars">${bars}</div>`;
    }else{
      const segs=R().STAGES.filter(s=>b.stages[s.key]>0).map(s=>{
        const qty=b.stages[s.key];
        const o=opener({title:`${fLabel} · ${b.label}`,subtitle:stageLabel(s.key),spec:bucketSpec(b,{stage:s.key}),stage:s.key});
        return `<span class="bpaSeg" data-stage="${s.key}" style="flex-grow:${qty}" data-blv-open="${o}"></span>`;
      }).join('');
      logistics=`<div class="bpaColBar" style="height:${max?Math.max(3,b.qty/max*100).toFixed(1):0}%">${segs}</div>`;
    }
    const bucketGroups=dimensionByBucket.get(b.key)||[],byName=new Map(bucketGroups.map(g=>[g.name,g]));
    const groupTip=tip(timelineDimensionTipHtml(`${dimensionLabel} · ${b.label}`,b,bucketGroups,dimension,dimensionNames));
    const dimensionEntries=dimensionNames.map(({name,color})=>{
      const g=byName.get(name);if(!g||!g.qty)return null;
      return {name,color,g,o:opener({title:name,subtitle:`${dimensionLabel} · ${fLabel} · ${b.label}`,spec:bucketSpec(b,{dim:dimension,...groupSpecRef(dimension,g)})})};
    }).filter(Boolean);
    let dimensionChart='';
    if(chartMode==='grouped'){
      const bars=dimensionEntries.map(({name,color,g,o})=>{
        const height=dimensionMax?Math.max(2,g.qty/dimensionMax*100):0;
        return `<span class="blvBuyerBar" style="height:${height.toFixed(1)}%;--ui-series-color:${color}" data-blv-open="${o}" title="${esc(name+': '+n(g.qty))}"></span>`;
      }).join('');
      dimensionChart=`<div class="blvBuyerBars is-grouped">${bars}</div>`;
    }else{
      const stackHeight=max?Math.max(3,b.qty/max*100):0;
      const segs=dimensionEntries.map(({name,color,g,o})=>`<span class="blvBuyerStackSeg" style="flex-grow:${g.qty};--ui-series-color:${color}" data-blv-open="${o}" title="${esc(name+': '+n(g.qty))}"></span>`).join('');
      dimensionChart=`<div class="blvBuyerBars is-stacked"><div class="blvBuyerStack" style="height:${stackHeight.toFixed(1)}%">${segs}</div></div>`;
    }
    return `<div class="${columnClass} ${chartMode==='grouped'?'blvGroupedCol':''}" ${commonAttrs}>${todayMarker}<div class="bpaColValue">${value}</div><div class="bpaColTrack blvLogisticsTrack ${chartMode==='grouped'?'blvGroupTrack':''}">${logistics}</div><div class="blvBandDivider"></div><div class="blvBuyerTrack" data-blv-tip="${groupTip}" data-blv-tip-style="chart">${dimensionChart}</div><div class="bpaColLabel">${esc(b.label)}</div></div>`;
  }).join('');
  return `<div class="bpaCardBox blvUnifiedTimelineCard"><div class="bpaSectionHead"><button type="button" class="bpaTodayBtn" data-blv-action="today" title="${esc(L('Bugünün dönemine git','Go to the current period'))}">${esc(L('Bugün','Today'))}</button><span class="bpaSectionTitle">${esc(L('Zaman akışı','Timeline'))}</span><span class="bpaSectionSub">${esc(L(`Tek zaman ekseninde üstte lojistik durum, altta ${dimensionLabel} kırılımı gösterilir. Kırmızı sayı: Ex-F tarihi geçmiş ama yüklenmemiş adet.`,`One shared time axis: logistics status above, ${dimensionLabel} breakdown below. Red figure: Ex-F passed but not loaded.`))}</span><span class="bpaSectionSpacer"></span>
    <div class="bpaSeg2" role="group">${fields.map(f=>`<button type="button" class="${f.key===field.key?'is-active':''}" data-blv-time="${f.key}">${esc(lang()==='en'?f.en:f.tr)}</button>`).join('')}</div>
    <div class="bpaSeg2 blvChartMode" role="group" aria-label="${esc(L('Lojistik grafik tipi','Logistics chart type'))}"><button type="button" class="${chartMode==='stacked'?'is-active':''}" data-blv-chart="stacked" title="${esc(L('Durumları aynı sütunda yığılmış göster','Show statuses stacked in one column'))}">${esc(L('Yığılmış','Stacked'))}</button><button type="button" class="${chartMode==='grouped'?'is-active':''}" data-blv-chart="grouped" title="${esc(L('Durumları yan yana ayrı sütunlarda göster','Show statuses as separate side-by-side columns'))}">${esc(L('Yan yana','Side by side'))}</button></div>
    <div class="bpaSeg2 blvTimelineDimension" role="group" aria-label="${esc(L('Alt grafik kırılımı','Lower chart breakdown'))}"><button type="button" class="${dimension==='buyingGroup'?'is-active':''}" data-blv-timeline-dim="buyingGroup">${esc(L('Buyer Grup','Buying Group'))}</button><button type="button" class="${dimension==='buyer'?'is-active':''}" data-blv-timeline-dim="buyer">Buyer</button><button type="button" class="${dimension===PRIORITY_DIMENSION?'is-active':''}" data-blv-timeline-dim="${PRIORITY_DIMENSION}" title="${esc(L('Her satır ana önceliğiyle sayılır; takip etiketleri ipucunda','Each line counts under its main priority; tracking tags in the tooltip'))}">${esc(L('Öncelik','Priority'))}</button></div>
    <div class="bpaSeg2" role="group"><button type="button" class="${state.granularity!=='month'?'is-active':''}" data-blv-gran="week">${esc(L('Hafta','Week'))}</button><button type="button" class="${state.granularity==='month'?'is-active':''}" data-blv-gran="month">${esc(L('Ay','Month'))}</button></div></div>
    <div class="blvTimelineLegend blvTimelineLegend--status"><span class="blvTimelineLegendLabel">${esc(L('Lojistik Durum','Logistic Status'))}</span>${legend()}</div>
    ${timelineDimensionLegend(dimensionNames,dimensionLabel)}
    ${series.length?`<div class="bpaCols blvCols blvUnifiedCols ${chartMode==='grouped'?'is-grouped':'is-stacked'}">${cols}</div>`:`<div class="bpaEmpty">${esc(L('Bu tarih alanında veri yok.','No data for this date field.'))}</div>`}</div>`;
}
function scrollTimelineToToday(behavior){
  const host=$('backlogOverviewBody'),scroller=host&&host.querySelector('.blvCols');
  if(!scroller)return;
  const scrollBehavior=behavior==='auto'?'auto':'smooth';
  const cols=[...scroller.querySelectorAll('.bpaCol[data-blv-start]')];
  let target=scroller.querySelector('[data-blv-today="1"]');
  if(!target&&cols.length){
    const today=R().dayIso(new Date()),todayMs=Date.parse(today+'T00:00:00Z');
    target=cols.reduce((best,col)=>{
      const ms=Date.parse((col.dataset.blvStart||'')+'T00:00:00Z');
      if(!Number.isFinite(ms))return best;
      const dist=Math.abs(ms-todayMs);
      return !best||dist<best.dist?{col,dist}:best;
    },null)?.col||null;
  }
  if(!target){scroller.scrollTo({left:0,behavior:scrollBehavior});return;}
  const sRect=scroller.getBoundingClientRect(),tRect=target.getBoundingClientRect();
  const left=scroller.scrollLeft+(tRect.left-sRect.left)-(scroller.clientWidth-target.offsetWidth)/2;
  scroller.scrollTo({left:Math.max(0,left),behavior:scrollBehavior});
}

/* ----------------------------------------------------- filtre çekmecesi */
function filterSourceLabel(source){return source==='asas'?'ASAS':source==='antrepo'?'IAS':'CP'}
async function ensureFilterCatalog(){
  if(filterCatalog)return filterCatalog;
  if(filterCatalogPromise)return filterCatalogPromise;
  filterCatalogError='';
  const generation=catalogGeneration;
  const promise=fetch('/api/backlog-source-columns',{credentials:'same-origin'}).then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body&&body.error?body.error:`HTTP ${res.status}`);
    const cp=(Array.isArray(body.defaultHeaders)?body.defaultHeaders:[]).map(header=>({
      id:'cp:'+header,source:'cp',header:String(header),rowKey:String(header),label:String(header)
    }));
    const raw=(Array.isArray(body.columns)?body.columns:[]).filter(column=>column&&column.id&&column.header&&column.label).map(column=>({
      id:String(column.id),source:column.source==='antrepo'?'antrepo':'asas',header:String(column.header),
      rowKey:String(column.label),label:String(column.header)
    }));
    if(generation!==catalogGeneration)return filterCatalog;
    filterCatalog=[...cp,...raw];
    return filterCatalog;
  }).catch(err=>{if(generation===catalogGeneration)filterCatalogError=String(err&&err.message||err);throw err;}).finally(()=>{if(filterCatalogPromise===promise)filterCatalogPromise=null;});
  filterCatalogPromise=promise;return promise;
}
function filterRoot(){
  let root=$('blvFilterRoot');
  if(root)return root;
  root=document.createElement('div');root.id='blvFilterRoot';root.className='blvFilterRoot';root.dataset.uiMigrated='plan-execute';root.hidden=true;
  root.innerHTML='<div class="blvFilterScrim" data-blvf-close></div><aside class="blvFilterDrawer" role="dialog" aria-modal="true" aria-labelledby="blvFilterTitle"><div class="blvFilterMount"></div></aside>';
  document.body.appendChild(root);
  root.addEventListener('click',e=>{
    const close=e.target.closest('[data-blvf-close]');if(close){closeFilterPanel();return;}
    const favApply=e.target.closest('[data-blvf-fav-apply]');if(favApply){favoriteNaming=false;applyFavorite(decodeURIComponent(favApply.dataset.blvfFavApply||''));return;}
    const favDelete=e.target.closest('[data-blvf-fav-delete]');if(favDelete){deleteFavorite(decodeURIComponent(favDelete.dataset.blvfFavDelete||''));return;}
    const favNew=e.target.closest('[data-blvf-fav-new]');if(favNew){
      favoriteNaming=true;favoriteDraft='';renderFilterPanel();
      requestAnimationFrame(()=>root.querySelector('[data-blvf-fav-name]')?.focus({preventScroll:true}));return;
    }
    const favCancel=e.target.closest('[data-blvf-fav-cancel]');if(favCancel){favoriteNaming=false;favoriteDraft='';renderFilterPanel();return;}
    const source=e.target.closest('[data-blvf-source]');if(source){filterSource=source.dataset.blvfSource||'cp';filterSearch='';renderFilterPanel();return;}
    const reset=e.target.closest('[data-blvf-reset]');if(reset){state.filters=[];filterEditorId='';filterValueSearch='';signature='';reapplyOverviewFilters();return;}
    const add=e.target.closest('[data-blvf-add]');if(add){void addOverviewFilter(decodeURIComponent(add.dataset.blvfAdd||''));return;}
    const edit=e.target.closest('[data-blvf-edit]');if(edit){filterEditorId=decodeURIComponent(edit.dataset.blvfEdit||'');filterValueSearch='';void ensureFilterValues(overviewFilters().find(f=>f.id===filterEditorId));renderFilterPanel();return;}
    const remove=e.target.closest('[data-blvf-remove]');if(remove){
      const id=decodeURIComponent(remove.dataset.blvfRemove||'');
      state.filters=overviewFilters().filter(filter=>filter.id!==id);
      if(filterEditorId===id)filterEditorId='';
      signature='';reapplyOverviewFilters();return;
    }
    const clear=e.target.closest('[data-blvf-clear-current]');if(clear){
      const filter=overviewFilters().find(f=>f.id===filterEditorId);
      if(filter){filter.values=[];filter.from='';filter.to='';reapplyOverviewFilters();}
      return;
    }
    const allVisible=e.target.closest('[data-blvf-all-visible]');if(allVisible){
      const filter=overviewFilters().find(f=>f.id===filterEditorId);if(!filter)return;
      const q=filterValueSearch.trim().toLocaleLowerCase(lang()==='en'?'en':'tr');
      const values=distinctFilterValues(filter).filter(entry=>!q||entry.label.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)).slice(0,300).map(entry=>entry.value);
      filter.values=[...new Set([...(filter.values||[]),...values])];filter.from='';filter.to='';reapplyOverviewFilters();return;
    }
    const none=e.target.closest('[data-blvf-none]');if(none){
      const filter=overviewFilters().find(f=>f.id===filterEditorId);if(filter){filter.values=[];reapplyOverviewFilters();}return;
    }
  });
  root.addEventListener('submit',e=>{
    if(!e.target.matches('[data-blvf-fav-form]'))return;
    e.preventDefault();
    const input=e.target.querySelector('[data-blvf-fav-name]');
    if(!String(input?.value||'').trim()){input?.focus();return;}
    if(saveCurrentFavorite(input.value)){favoriteNaming=false;favoriteDraft='';}
    renderFilterPanel();
  });
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&e.target.matches('[data-blvf-fav-name]')){e.preventDefault();e.stopPropagation();favoriteNaming=false;favoriteDraft='';renderFilterPanel();}
  });
  root.addEventListener('input',e=>{
    if(e.target.matches('[data-blvf-fav-name]')){favoriteDraft=e.target.value||'';return;}
    if(e.target.matches('[data-blvf-search]')){
      filterSearch=e.target.value||'';const pos=e.target.selectionStart;renderFilterPanel();
      requestAnimationFrame(()=>{const input=root.querySelector('[data-blvf-search]');if(input){input.focus({preventScroll:true});try{input.setSelectionRange(pos,pos)}catch(_){}}});return;
    }
    if(e.target.matches('[data-blvf-value-search]')){
      filterValueSearch=e.target.value||'';const pos=e.target.selectionStart;renderFilterPanel();
      requestAnimationFrame(()=>{const input=root.querySelector('[data-blvf-value-search]');if(input){input.focus({preventScroll:true});try{input.setSelectionRange(pos,pos)}catch(_){}}});return;
    }
  });
  root.addEventListener('change',e=>{
    const filter=overviewFilters().find(f=>f.id===filterEditorId);if(!filter)return;
    if(e.target.matches('[data-blvf-from]')){filter.from=e.target.value||'';filter.values=[];reapplyOverviewFilters();return;}
    if(e.target.matches('[data-blvf-to]')){filter.to=e.target.value||'';filter.values=[];reapplyOverviewFilters();return;}
    if(e.target.matches('[data-blvf-value]')){
      const value=decodeURIComponent(e.target.dataset.blvfValue||''),set=new Set(filter.values||[]);
      if(e.target.checked)set.add(value);else set.delete(value);
      filter.values=[...set];filter.from='';filter.to='';reapplyOverviewFilters();
    }
  });
  return root;
}
async function openFilterPanel(){
  favorites=loadFavorites();favoriteNaming=false;favoriteDraft='';
  filterOpen=true;const root=filterRoot();root.hidden=false;window.BLMotionPlus?.play?.('overlay',root.querySelector('.blvFilterDrawer'));requestAnimationFrame(()=>root.classList.add('is-open'));updateFilterButton();renderFilterPanel();
  try{await ensureFilterCatalog();if(!filterOpen)return;await ensureFilterValues(overviewFilters().find(f=>f.id===filterEditorId));renderFilterPanel();}catch(_){renderFilterPanel();}
}
function closeFilterPanel(){
  filterOpen=false;cancelFilterValues();const root=$('blvFilterRoot');if(root){root.classList.remove('is-open');setTimeout(()=>{if(!filterOpen)root.hidden=true;},160);}updateFilterButton();
}
function filterCriterionText(filter){
  const kind=filterKind(filter);
  if(kind==='date'&&(filter.from||filter.to))return [filter.from||'…',filter.to||'…'].join(' → ');
  const count=Array.isArray(filter.values)?filter.values.length:0;
  return count?L(`${count} değer`,`${count} values`):L('Filtre seçilmedi','No criteria');
}
async function addOverviewFilter(id){
  if(!filterCatalog)try{await ensureFilterCatalog();}catch(_){return;}
  const field=(filterCatalog||[]).find(item=>item.id===id);if(!field)return;
  let filter=overviewFilters().find(item=>item.id===id);
  if(!filter){
    filter={id:field.id,source:field.source,header:field.header,rowKey:field.rowKey,label:field.label,values:[],from:'',to:''};
    state.filters=[...overviewFilters(),filter];saveState();
  }
  filterEditorId=id;filterValueSearch='';
  await ensureFilterValues(filter);renderFilterPanel();
}
function renderFilterEditor(filter){
  if(!filter)return `<div class="blvFilterEditorEmpty"><svg class="ic"><use href="#i-filter"/></svg><b>${esc(L('Bir sütun seçin','Select a column'))}</b><span>${esc(L('Soldaki CP, ASAS veya IAS sütunlarından birini seçerek filtre ekleyin.','Choose a CP, ASAS or IAS column on the left to add a filter.'))}</span></div>`;
  const facet=filterFacet(filter);
  if(!facet?.data)return `<div class="blvFilterLoading">${esc(facet?.error||L('Filtre değerleri yükleniyor…','Loading filter values…'))}</div>`;
  const kind=filterKind(filter);
  let controls='';
  if(kind==='date'){
    const min=facet.data.min||'',max=facet.data.max||'';
    controls=`<div class="blvFilterDateGrid"><label><span>${esc(L('Başlangıç','From'))}</span><input type="date" data-blvf-from value="${esc(filter.from||'')}"${min?` min="${esc(min)}"`:''}${max?` max="${esc(max)}"`:''}></label><label><span>${esc(L('Bitiş','To'))}</span><input type="date" data-blvf-to value="${esc(filter.to||'')}"${min?` min="${esc(min)}"`:''}${max?` max="${esc(max)}"`:''}></label></div>
      <div class="blvFilterRangeHint">${esc(min&&max?L(`Veri aralığı: ${fmtDay(min)} – ${fmtDay(max)}`,`Data range: ${fmtDay(min)} – ${fmtDay(max)}`):L('Bu sütunda tarih değeri bulunamadı.','No date values found in this column.'))}</div>`;
  }else{
    const q=filterValueSearch.trim().toLocaleLowerCase(lang()==='en'?'en':'tr'),all=distinctFilterValues(filter);
    const selected=new Set(filter.values||[]),matched=all.filter(entry=>!q||entry.label.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)).sort((a,b)=>Number(selected.has(b.value))-Number(selected.has(a.value))),visible=matched.slice(0,300);
    controls=`<div class="blvFilterValueTools"><input type="search" data-blvf-value-search value="${esc(filterValueSearch)}" placeholder="${esc(L('Değer ara…','Search values…'))}"><button type="button" data-blvf-all-visible>${esc(L('Görünenleri seç','Select visible'))}</button><button type="button" data-blvf-none>${esc(L('Seçimi kaldır','Clear selection'))}</button></div>
      <div class="blvFilterValues">${visible.map(entry=>`<label class="blvFilterValue"><input type="checkbox" data-blvf-value="${esc(encodeURIComponent(entry.value))}"${selected.has(entry.value)?' checked':''}><span title="${esc(entry.label)}">${esc(entry.label)}</span><b>${n(entry.count)}</b></label>`).join('')||`<div class="blvFilterNoValue">${esc(L('Eşleşen değer yok.','No matching values.'))}</div>`}</div>
      ${matched.length>visible.length?`<div class="blvFilterRangeHint">${esc(L(`${matched.length} değerin ilk 300'ü gösteriliyor. Aramayı daraltın.`,`Showing the first 300 of ${matched.length} values. Refine the search.`))}</div>`:''}`;
  }
  return `<div class="blvFilterEditorHead"><div><span>${esc(filterSourceLabel(filter.source))}</span><h4>${esc(filter.label)}</h4></div><button type="button" data-blvf-clear-current>${esc(L('Temizle','Clear'))}</button></div>${controls}`;
}
function renderFilterPanel(){
  const root=$('blvFilterRoot');if(!root||root.hidden)return;
  const mount=root.querySelector('.blvFilterMount');if(!mount)return;
  const previous={columns:root.querySelector('.blvFilterColumns')?.scrollTop||0,values:root.querySelector('.blvFilterValues')?.scrollTop||0,editor:root.querySelector('.blvFilterEditor')?.scrollTop||0};
  if(!filterCatalog){
    mount.innerHTML=`<div class="blvFilterLoading"><span class="bpaSpinner"></span><span>${esc(filterCatalogError||L('Sütun kataloğu yükleniyor…','Loading column catalogue…'))}</span><button type="button" data-blvf-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div>`;
    return;
  }
  const q=filterSearch.trim().toLocaleLowerCase(lang()==='en'?'en':'tr'),activeIds=new Set(overviewFilters().map(f=>f.id));
  const sourceItems=filterCatalog.filter(field=>field.source===filterSource).filter(field=>!q||field.label.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)||field.header.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)).sort((a,b)=>Number(activeIds.has(b.id))-Number(activeIds.has(a.id)));
  const visibleFields=sourceItems.slice(0,300),editor=overviewFilters().find(f=>f.id===filterEditorId)||null;
  const sourceCount=source=>filterCatalog.filter(field=>field.source===source).length;
  const active=overviewFilters();
  mount.innerHTML=`<header class="blvFilterHead"><div><span class="blvFilterKicker">${esc(L('BACKLOG ORTAK FİLTRELER','SHARED BACKLOG FILTERS'))}</span><h3 id="blvFilterTitle">${esc(L('Analiz Filtreleri','Analysis Filters'))}</h3><p>${esc(L('Bu filtreler tüm Backlog görünümlerini, Legacy Excel ve Backlog Report çıktılarını etkiler.','These filters apply to all Backlog views, Legacy Excel and Backlog Report exports.'))}</p></div><div class="blvFilterHeadActions"><button type="button" data-blvf-reset${active.length?'':' disabled'}>${esc(L('Tümünü sıfırla','Reset all'))}</button><button type="button" data-blvf-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
    <div class="blvFilterSummary"><div><b>${n(lastData?.totalRows||0)}</b><span>${esc(L('satır','rows'))}</span></div><span>${esc(L(`${activeFilterCount()} aktif filtre`,`${activeFilterCount()} active filters`))}</span></div>
    ${renderFavoriteBar()}
    <div class="blvFilterActive">${active.map(filter=>`<button type="button" class="${filter.id===filterEditorId?'is-active':''}" data-blvf-edit="${esc(encodeURIComponent(filter.id))}"><span>${esc(filterSourceLabel(filter.source))}</span><b>${esc(filter.label)}</b><small>${esc(filterCriterionText(filter))}</small></button><button type="button" class="blvFilterRemove" data-blvf-remove="${esc(encodeURIComponent(filter.id))}" title="${esc(L('Filtreyi kaldır','Remove filter'))}"><svg class="ic"><use href="#i-x"/></svg></button>`).join('')||`<span class="blvFilterNoActive">${esc(L('Henüz analiz filtresi eklenmedi.','No analysis filters added yet.'))}</span>`}</div>
    <div class="blvFilterWorkspace"><div class="blvFilterCatalogue"><div class="blvFilterSourceTabs">${['cp','asas','antrepo'].map(source=>`<button type="button" class="${source===filterSource?'is-active':''}" data-blvf-source="${source}">${filterSourceLabel(source)} <b>${n(sourceCount(source))}</b></button>`).join('')}</div><input class="blvFilterSearch" type="search" data-blvf-search value="${esc(filterSearch)}" placeholder="${esc(L('Sütun ara…','Search columns…'))}"><div class="blvFilterColumns">${visibleFields.map(field=>`<button type="button" class="${activeIds.has(field.id)?'is-added':''}" data-blvf-add="${esc(encodeURIComponent(field.id))}" title="${esc(field.header)}"><span>${esc(field.header)}</span><svg class="ic"><use href="#${activeIds.has(field.id)?'i-check':'i-plus'}"/></svg></button>`).join('')||`<div class="blvFilterNoValue">${esc(L('Eşleşen sütun yok.','No matching columns.'))}</div>`}</div>${sourceItems.length>visibleFields.length?`<div class="blvFilterRangeHint">${esc(L(`${sourceItems.length} sütunun ilk 300'ü gösteriliyor. Aramayı kullanın.`,`Showing the first 300 of ${sourceItems.length} columns. Use search.`))}</div>`:''}</div><div class="blvFilterEditor">${renderFilterEditor(editor)}</div></div>`;
  requestAnimationFrame(()=>{
    const columns=root.querySelector('.blvFilterColumns'),values=root.querySelector('.blvFilterValues'),editorEl=root.querySelector('.blvFilterEditor');
    if(columns)columns.scrollTop=previous.columns;if(values)values.scrollTop=previous.values;if(editorEl)editorEl.scrollTop=previous.editor;
  });
}
function render(){
  const host=$('backlogOverviewBody');if(!host)return;
  updateFilterButton();if(filterOpen)renderFilterPanel();
  tips=new Map();openers=new Map();hideTip();
  if(!state.open)return;
  if(loading){host.innerHTML=recoveryControls()+`<div class="bpaLoading"><span class="bpaSpinner"></span>${esc(L('Backlog satırları toplanıyor…','Collecting Backlog rows…'))}</div>`;return;}
  if(error){host.innerHTML=recoveryControls()+`<div class="bpaError">${esc(error)}</div>`;return;}
  const backend=backendModelEnabled();
  // Yerel model (geri dönüş yolu) her çizimde aynı panelModel ile kurulur.
  if(!backend)model=baseItems&&R()?localModel():null;
  if(!model||!R()){host.innerHTML=recoveryControls()+`<div class="bpaEmpty">${esc(L('Backlog yüklendiğinde genel bakış burada görünür.','The overview appears once Backlog loads.'))}</div>`;return;}
  // Arka uç modeli eski bir görünüm için hesaplandıysa (dil, öncelik dizini …) yenisi istenir; yanıt gelene kadar mevcut çizim kalır.
  if(backend&&remote&&!overviewRequest&&remote.viewKey!==currentViewKey())void refresh(false);
  if(!model.count){host.innerHTML=recoveryControls()+`<div class="bpaEmpty">${esc(L('Aktif filtrede Backlog satırı yok.','No Backlog rows for the active filter.'))}</div>`;return;}
  ensurePriorityIndex();
  host.innerHTML=hero(model)+specialStrip(model)+qualityStrip(model)+groupCard(model)+`<div class="blvGap"></div>`+flowCard(model);
  // Yeni DOM sıfır scrollLeft ile başlar; zaman eksenini mevcut döneme otomatik geri odakla.
  requestAnimationFrame(()=>scrollTimelineToToday('auto'));
}

/* --------------------------------------------------------- tooltip/panel */
function tipEl(){let el=$('blvTip');if(!el){el=document.createElement('div');el.id='blvTip';el.className='bpaTip blvTipBox';el.dataset.uiMigrated='plan-execute';el.hidden=true;el.setAttribute('role','tooltip');document.body.appendChild(el);}return el}
function hideTip(){const el=$('blvTip');if(el)el.hidden=true}
function moveTip(e){
  const target=e.target&&e.target.closest?e.target.closest('[data-blv-tip]'):null;
  if(!target||!tips.has(target.dataset.blvTip)){hideTip();return;}
  const el=tipEl();
  el.classList.toggle('is-chart-style',target.dataset.blvTipStyle==='chart');
  if(el.dataset.key!==target.dataset.blvTip){el.innerHTML=tips.get(target.dataset.blvTip);el.dataset.key=target.dataset.blvTip;}
  el.hidden=false;
  const pad=14,w=el.offsetWidth,h=el.offsetHeight;let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>window.innerWidth-8)x=e.clientX-w-pad;if(y+h>window.innerHeight-8)y=e.clientY-h-pad;
  el.style.left=Math.max(8,x)+'px';el.style.top=Math.max(8,y)+'px';
}

function drawerModelIdentity(it){
  const row=it&&it.row&&typeof it.row==='object'?it.row:{};
  const take=(...values)=>{for(const value of values){const text=String(value==null?'':value).trim();if(text)return text;}return '';};
  const modelName=take(it&&it.modelName,row._modelName,row['Model Adı'],row['Model Name'],row['Style Name']);
  const plmId=take(it&&it.plmId,row._plmId,row.plmId,row.plm,row['PLM ID'],row['PLM Id'],row['Plm Kod'],row['PLM Kod'],row['PLM Code']);

  const canonical=window.BLDetailImages?.identityFromRow?.(row,'backlog');
  return {
    ...canonical,
    plmId,
    modelName,
    season:it?.season||canonical?.season,
    specialCode:it?.specialCode||canonical?.specialCode,
    colourCode:take(it&&it.colourCode,row._colourCode,row.colourCode,row.ccode,row['C.Code'],row['Renk Kod'],row['Renk Kodu'],row['Colour Code'],row['Color Code']),
    colour:take(it&&it.colour,row.colour,row.color,row.Colour,row.Color,row.Renk,row['Renk Adı']),
    orderCode:take(it&&it.orderCode,row.orderCode,row.ocode,row['Sipariş Kod'],row['Sipariş Kodu'],row['Order Code'])
  };
}
function drawerModelImageHtml(it,imageIndex){
  const api=window.BLDetailImages;
  if(!api?.thumbHtml)return '<span class="bpaSub">—</span>';
  const id=api.resolve(imageIndex,drawerModelIdentity(it));
  return api.thumbHtml(id.source,{...id,modelId:id.plmId||id.modelName},{
    classes:'detailModelThumb blvModelThumb',
    title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),
    allowEmpty:true
  });
}
function registerDrawerModelImages(aside,identities,spec,imageIndex,payload){
  const api=window.BLDetailImages;if(!api)return;
  api.registerScope?.(aside,{
    contextType:'backlog-overview-detail',
    label:String(spec&&spec.title||L('Backlog detay','Backlog detail')),
    imageIndex,
    identities:identities.map(([index,it])=>({...drawerModelIdentity(it),rowId:String(index)})),
    repaint:()=>showDrawer(spec,payload)
  });
  api.bindThumbs?.(aside);
  api.bindModelImagesButton?.('blvDrawerPlmSync');
}
function drawerEl(){
  let el=$('blvDrawer');
  if(!el){
    el=document.createElement('div');el.id='blvDrawer';el.className='bpaDrawerRoot blvDrawerRoot';el.dataset.uiMigrated='plan-execute';el.hidden=true;
    el.innerHTML='<div class="bpaDrawerScrim" data-blv-close></div><aside class="bpaDrawer" role="dialog" aria-modal="true" aria-labelledby="blvDrawerTitle"></aside>';
    document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target.closest('[data-blv-close]'))closeDrawer();});
  }
  return el;
}
function closeDrawer(){const el=$('blvDrawer');if(el&&!el.hidden){el.hidden=true;el.classList.remove('is-open');}}
/* Çekmece içeriği: { summary, count, rows (ilk ROW_LIMIT, sıralı), identities:[[sıra,kayıt]] }.
   Dış liste ve geri dönüş yolu yerelde, arka uç modelinde drill-down tıklanınca yüklenir. */
function localDrawerPayload(list){
  const payload=R().drawerPayload(list,ROW_LIMIT);
  return {summary:payload.summary,count:payload.count,rows:payload.rows,identities:payload.list.map((it,index)=>[index,it])};
}
let drawerRequest=null;
function openDrawer(spec){
  if(!spec)return;hideTip();
  drawerRequest?.abort();drawerRequest=null;
  if(Array.isArray(spec.items))return showDrawer(spec,localDrawerPayload(spec.items));
  if(!backendModelEnabled()){
    if(baseItems)annotatePriorities(baseItems);
    return showDrawer(spec,localDrawerPayload(R().selectItems(baseItems||[],spec.spec,viewState())));
  }
  const params=remote&&remote.sig?JSON.parse(remote.sig):overviewQueryParams();if(!params)return;
  const request=new AbortController();drawerRequest=request;
  showDrawerState(spec,`<div class="bpaLoading"><span class="bpaSpinner"></span>${esc(L('Satırlar yükleniyor…','Loading rows…'))}</div>`);
  void postModel({version:1,query:params,view:viewState(),priority:priorityRequest(),drill:spec.spec},request.signal).then(data=>{
    if(drawerRequest!==request)return;
    showDrawer(spec,{summary:data.summary,count:data.count,rows:data.rows||[],identities:data.identities||[]});
  }).catch(err=>{
    if(drawerRequest!==request||request.signal.aborted)return;
    showDrawerState(spec,`<div class="bpaError">${esc(String(err&&err.message||err))}</div>`);
  }).finally(()=>{if(drawerRequest===request)drawerRequest=null;});
}
function drawerHead(spec){
  const plmSyncButton=window.BLDetailImages?.modelImagesButtonHtml?.('blvDrawerPlmSync')||'';
  return `<header class="bpaDrawerHead"><div><div class="bpaDrawerKicker">${spec.stage?`<i class="bpaDot" data-stage="${spec.stage}"></i>`:''}${esc(spec.subtitle||'')}</div><h3 id="blvDrawerTitle">${esc(spec.title||'')}</h3></div><div class="bpaActions">${plmSyncButton}<button type="button" class="tbtn bpaMoveBtn" data-blv-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>`;
}
function showDrawerState(spec,html){
  const root=drawerEl(),aside=root.querySelector('.bpaDrawer');
  aside.innerHTML=drawerHead(spec)+html;
  root.hidden=false;requestAnimationFrame(()=>root.classList.add('is-open'));
  aside.querySelector('[data-blv-close]')?.focus();
}
function showDrawer(spec,payload){
  const imageIndex=window.BLDetailImages?.buildIndex?.()||null;
  const root=drawerEl(),aside=root.querySelector('.bpaDrawer');
  const s=payload.summary;
  const rows=payload.rows.map(it=>`<tr>
    <td class="detailImgCell">${drawerModelImageHtml(it,imageIndex)}</td>
    <td><span class="bpaBadge blvBadge" data-stage="${it.stage}">${esc(stageLabel(it.stage))}</span>${it.status&&it.status!==stageLabel(it.stage)?`<small class="bpaSub">${esc(it.status)}</small>`:''}</td>
    <td><div class="bpaIdentity">${esc(it.orderCode||'—')}<small>${esc([it.modelName,it.colourCode,it.colour].filter(Boolean).join(' · '))}</small></div></td>
    <td>${esc(it.buyer||'—')}<small class="bpaSub">${esc([it.buyingGroup,it.category].filter(Boolean).join(' · '))}</small></td>
    <td>${esc(it.manufacturer||'—')}<small class="bpaSub">${esc([it.season,it.deliveryType].filter(Boolean).join(' · '))}</small></td>
    <td class="num">${n(it.qty)}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.exFactory))}${it.overdueDays?`<small><span class="bpaDayDelta is-late">${n(it.overdueDays)} ${esc(L('gün geçti','days overdue'))}</span></small>`:''}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.antrepo))}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.retail))}</td>
    <td>${it.special?`<span class="bpaTag">${esc(it.importance)}</span>`:''}${it.risk?`<span class="bpaTag is-alert">${esc(L('risk','risk'))}</span>`:''}${it.transitOverdue?`<span class="bpaTag is-alert">${esc(L('transit gecikti','transit overdue'))}</span>`:''}</td>
  </tr>`).join('');
  aside.innerHTML=`${drawerHead(spec)}
    <div class="bpaDrawerStats">
      <div><b>${n(s.qty)}</b><span>${esc(L('adet','qty'))}</span></div>
      <div><b>${n(s.orders)}</b><span>${esc(L('sipariş','orders'))}</span></div>
      <div><b>${n(s.lines)}</b><span>${esc(L('satır','lines'))}</span></div>
      <div><b>${esc(pct(s.loadedPct))}</b><span>${esc(L('yüklendi','loaded'))}</span></div>
      <div><b class="is-overdue">${n(s.overdueQty)}</b><span>${esc(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'))}</span></div>
    </div>
    <div class="bpaBar bpaDrawerBar">${R().STAGES.filter(x=>s.stages[x.key]>0).map(x=>`<span class="bpaSeg" data-stage="${x.key}" style="flex-grow:${s.stages[x.key]}" title="${esc(stageLabel(x.key)+': '+n(s.stages[x.key]))}"></span>`).join('')}</div>
    <div class="bpaTableWrap bpaDrawerTable"><table class="bpaTable"><thead><tr><th class="detailImgCell">${esc(L('Görsel','Image'))}</th><th>${esc(L('Aşama','Stage'))}</th><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th class="num">${esc(L('Adet','Qty'))}</th><th>Ex-Factory</th><th>${esc(L('Antrepo','Warehouse'))}</th><th>Retail</th><th>${esc(L('Sinyal','Signal'))}</th></tr></thead><tbody>${rows}</tbody></table>${payload.count>ROW_LIMIT?`<div class="bpaNote">${esc(L(`İlk ${ROW_LIMIT} satır gösteriliyor; tamamı Excel Backlog V3'te.`,`Showing first ${ROW_LIMIT} rows; Excel Backlog V3 contains all.`))}</div>`:''}</div>`;
  registerDrawerModelImages(aside,payload.identities,spec,imageIndex,payload);
  root.hidden=false;requestAnimationFrame(()=>root.classList.add('is-open'));
  aside.querySelector('[data-blv-close]')?.focus();
}

/* ------------------------------------------------------------- bağlar */
function setOpen(value){
  state.open=value;saveState();
  const mod=$('backlogOverview'),body=$('backlogOverviewBody'),toggle=$('backlogOverviewToggle');
  mod?.classList.toggle('is-open',value);
  if(window.BLMotionPlus?.disclosure)window.BLMotionPlus.disclosure(body,value,{trigger:toggle});else if(body)body.hidden=!value;
  toggle?.setAttribute('aria-expanded',value?'true':'false');
  if(value)void refresh(false);else{cancelOverviewRequest();closeDrawer();closeFilterPanel();}
}
function bind(){
  if(bound)return;const host=$('backlogOverviewBody');if(!host)return;bound=true;
  $('backlogOverviewToggle')?.addEventListener('click',()=>setOpen(!state.open));
  $('backlogOverviewFilter')?.addEventListener('click',e=>{e.stopPropagation();if(filterOpen)closeFilterPanel();else void openFilterPanel();});
  $('backlogOverviewRefresh')?.addEventListener('click',e=>{e.stopPropagation();void refresh(true);});
  host.addEventListener('click',e=>{
    const t=e.target.closest('[data-blv-open],[data-blv-importance],[data-blv-group],[data-blv-scale],[data-blv-time],[data-blv-chart],[data-blv-timeline-dim],[data-blv-gran],[data-blv-action]');
    if(!t||!host.contains(t))return;
    if(t.dataset.blvAction==='filters'){void openFilterPanel();return;}
    if(t.dataset.blvAction==='clearFilters'){state.filters=[];filterEditorId='';filterValueSearch='';reapplyOverviewFilters();return;}
    if(t.dataset.blvImportance){state.importanceScope=t.dataset.blvImportance;saveState();return updateView();}
    if(t.dataset.blvGroup){state.groupBy=t.dataset.blvGroup;state.showAll=false;saveState();return updateView();}
    if(t.dataset.blvScale){state.barScale=t.dataset.blvScale;saveState();return render();}
    if(t.dataset.blvTime){state.timeField=t.dataset.blvTime;saveState();return updateView();}
    if(t.dataset.blvChart){state.timelineChart=t.dataset.blvChart==='grouped'?'grouped':'stacked';saveState();return render();}
    if(t.dataset.blvTimelineDim){state.timelineDimension=timelineDimensionKey(t.dataset.blvTimelineDim);saveState();return updateView();}
    if(t.dataset.blvGran){state.granularity=t.dataset.blvGran;saveState();return updateView();}
    if(t.dataset.blvAction==='today'){scrollTimelineToToday();return;}
    if(t.dataset.blvAction==='toggleAll'){state.showAll=!state.showAll;saveState();return render();}
    if(t.dataset.blvOpen)openDrawer(openers.get(t.dataset.blvOpen));
  });
  host.addEventListener('mousemove',moveTip);
  host.addEventListener('mouseleave',hideTip);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeFilterPanel();}});
  document.addEventListener('bl:language-changed',()=>{render();if(filterOpen)renderFilterPanel();});
  // CP öncelikleri/kuralları değişince etiket kutucukları yeniden hesaplanır.
  window.addEventListener('bl:cp-priority-index-changed',()=>{priorityEnsureFailed=false;if(visible()&&model)render();});
  window.addEventListener('bl:cp-decision-context-changed',()=>{priorityEnsureFailed=false;if(visible()&&model)render();});
  // applyLanguage bl:language-changed göndermez; kullanıcı etiket adları sözlükte
  // olmadığından dil değişimi <html lang> üzerinden izlenip yeniden çizilir.
  if('MutationObserver' in window){
    let lastLang=lang();
    new MutationObserver(()=>{const next=lang();if(next===lastLang)return;lastLang=next;if(visible()&&model)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
}
function init(){
  bind();
  // The shell hides Backlog without unloading its scripts.
  const content=$('backlogContent');
  if(content&&'MutationObserver' in window)new MutationObserver(()=>{if(!visible()){cancelOverviewRequest();closeFilterPanel();}}).observe(content,{attributes:true,attributeFilter:['style','hidden']});
  if('MutationObserver' in window){
    new MutationObserver(()=>{if(document.body.dataset.activeTab!=='backlog'){cancelOverviewRequest();closeFilterPanel();}}).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
    const range=$('backlogDateRange');if(range)new MutationObserver(()=>{if(range.getAttribute('aria-busy')==='true'){cancelOverviewRequest();cancelFilterValues();}}).observe(range,{attributes:true,attributeFilter:['aria-busy']});
  }
  window.addEventListener('pagehide',()=>{cancelOverviewRequest();cancelFilterValues();});
  const mod=$('backlogOverview');
  if(mod){mod.classList.toggle('is-open',!!state.open);const body=$('backlogOverviewBody');if(body)body.hidden=!state.open;$('backlogOverviewToggle')?.setAttribute('aria-expanded',state.open?'true':'false');}
  updateFilterButton();render();
  // Görünmeyen modül çizilmez (perf-runtime sözleşmesi): Backlog sekmesi
  // görünür olduğunda bekleyen yenileme burada tetiklenir.
  if(mod&&'IntersectionObserver' in window){
    new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&state.open&&!loading&&(!model||signature!==JSON.stringify(overviewQueryParams()||{})))void refresh(false);}).observe(mod);
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

/* Aynı Backlog detay çekmecesi başka özet ekranlarından da açılabilir.
   Dış modül yalnız normalize edilmiş item listesini verir; çizim, PLM SYNC,
   görseller ve tablo davranışı burada tek kaynak olarak kalır. */
function openExternalItems(externalItems,options){
  const opts=options&&typeof options==='object'?options:{};
  const list=Array.isArray(externalItems)?externalItems.filter(Boolean):[];
  if(!list.length)return false;
  openDrawer({
    title:String(opts.title||L('Sipariş detayı','Order detail')),
    subtitle:String(opts.subtitle||''),
    stage:String(opts.stage||''),
    items:list
  });
  return true;
}

/* Excel Backlog V3 seçenekleri ve kırılım tercihi app-main'deki dışa aktarım
   akışına buradan verilir. */
window.BLBacklogOverview={
  sourceColumnIds:filterSourceColumnIds,
  queryFilters:()=>overviewFilters().filter(filterHasCriteria).map(f=>({...f,values:[...(f.values||[])]})),
  onBacklogRendered,refresh:()=>refresh(true),openItems:openExternalItems,
  // Okuma modeli: Genel Bakış isteği sürüyorsa ilk yanıtına kadar bekleyen söz (yoksa null).
  modelGate:()=>modelGate?modelGate.promise:null,
  exportOptions:()=>({includePlanActual:state.exportPlanActual!==false,includeLegacy:state.exportLegacy!==false,groupBy:state.groupBy}),
  setExportOption:(key,value)=>{if(key==='includePlanActual')state.exportPlanActual=!!value;if(key==='includeLegacy')state.exportLegacy=!!value;saveState();},
};
})();
