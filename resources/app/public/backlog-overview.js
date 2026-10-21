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
function chartColors(){try{const cs=getComputedStyle(document.documentElement);const out=[];for(let i=1;i<=8;i++){const v=cs.getPropertyValue('--chart-'+i).trim();if(v)out.push(v);}return out.length===8?out:CHART_FALLBACK;}catch(_){return CHART_FALLBACK;}}
const n=v=>nf.format(Number(v)||0);
const pct=v=>v==null||!Number.isFinite(v)?'—':'%'+pf.format(v*100);
const R=()=>window.BLBacklogV3Report;
let state=loadState();
let baseItems=null,items=null,loading=false,error='',signature='',tips=new Map(),openers=new Map(),seq=0,bound=false;
let filterCatalog=null,filterCatalogPromise=null,filterCatalogError='',filterOpen=false,filterSource='cp',filterSearch='',filterEditorId='',filterValueSearch='';

function loadState(){
  const defaults={open:true,groupBy:'buyer',barScale:'pct',timeField:'exFactory',granularity:'week',timelineChart:'stacked',timelineDimension:'buyingGroup',showAll:false,exportPlanActual:true,exportLegacy:true,filters:[],importanceScope:'all'};
  try{
    const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'null');
    if(raw&&typeof raw==='object'){
      const merged={...defaults,...raw};
      merged.filters=Array.isArray(raw.filters)?raw.filters.filter(f=>f&&f.id&&f.rowKey).map(f=>({
        id:String(f.id),source:String(f.source||'cp'),header:String(f.header||f.rowKey),rowKey:String(f.rowKey),
        label:String(f.label||f.header||f.rowKey),values:Array.isArray(f.values)?f.values.map(v=>String(v)):[],
        from:String(f.from||''),to:String(f.to||'')
      })):[];
      return merged;
    }
  }catch(_){}
  return defaults;
}
function saveState(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
function fmtDay(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:'—'}

/* ------------------------------------------------ Genel Bakış yerel filtreleri */
function overviewFilters(){return Array.isArray(state.filters)?state.filters:[]}
function filterValueKey(value){
  if(value==null||value==='')return '';
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return R()?.dayIso(value)||String(value);
  if(typeof value==='object'){try{return JSON.stringify(value)}catch(_){return String(value)}}
  return String(value);
}
function filterHasCriteria(filter){
  return !!filter&&(Array.isArray(filter.values)&&filter.values.length>0||!!filter.from||!!filter.to);
}
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
function filterRawValue(item,filter){return item&&item.row?item.row[filter.rowKey]:null}
function filterDay(value){try{return R()?.dayIso(value)||''}catch(_){return ''}}
function filterKind(filter){
  const rows=Array.isArray(baseItems)?baseItems:[],values=[];
  for(const item of rows){
    const value=filterRawValue(item,filter);
    if(value!=null&&value!=='')values.push(value);
    if(values.length>=160)break;
  }
  if(!values.length)return /tarih|date|factory|arrival|depo|store|opd|handover/i.test(String(filter.header||filter.label||''))?'date':'values';
  let dates=0;
  for(const value of values)if(filterDay(value))dates++;
  return dates/values.length>=.8?'date':'values';
}
function distinctFilterValues(filter){
  const counts=new Map();
  for(const item of (baseItems||[])){
    const key=filterValueKey(filterRawValue(item,filter));
    counts.set(key,(counts.get(key)||0)+1);
  }
  return [...counts.entries()].map(([value,count])=>({value,count,label:value===''?L('(boş)','(blank)'):value}))
    .sort((a,b)=>a.label.localeCompare(b.label,lang()==='en'?'en':'tr',{numeric:true,sensitivity:'base'}));
}
/* Özel sipariş kapsamı: Tümü · yalnız özel (BTS, Bayram …) · yalnız Regular. */
function importanceScope(){return ['special','regular'].includes(state.importanceScope)?state.importanceScope:'all'}
function applyOverviewFilters(rows){
  let out=Array.isArray(rows)?rows.slice():[];
  const scope=importanceScope();
  if(scope==='special')out=out.filter(item=>item.special);
  else if(scope==='regular')out=out.filter(item=>!item.special);
  for(const filter of overviewFilters()){
    if(!filterHasCriteria(filter))continue;
    const kind=filterKind(filter);
    if(kind==='date'&&(filter.from||filter.to)){
      out=out.filter(item=>{
        const day=filterDay(filterRawValue(item,filter));
        if(!day)return false;
        if(filter.from&&day<filter.from)return false;
        if(filter.to&&day>filter.to)return false;
        return true;
      });
    }else if(Array.isArray(filter.values)&&filter.values.length){
      const selected=new Set(filter.values.map(String));
      out=out.filter(item=>selected.has(filterValueKey(filterRawValue(item,filter))));
    }
  }
  return out;
}
function reapplyOverviewFilters(){items=applyOverviewFilters(baseItems||[]);saveState();render();}


/* ------------------------------------------------ ortak satır önbelleği */
/* revision: sunucunun girdilerden türettiği satır revizyonu. Önbellek düşse de
   yeniden çekilen satırlar aynı revizyondaysa ÖNCEKİ dizi döndürülür; böylece
   Genel Bakış ve Teslimat Riski panelleri aynı veriyi baştan hesaplamaz. */
const rowsCache={signature:'',promise:null,rows:null,lastRevision:'',lastRows:null};
function loadRows(params){
  const sig=JSON.stringify(params||{});
  if(rowsCache.signature===sig&&(rowsCache.rows||rowsCache.promise))return rowsCache.rows?Promise.resolve(rowsCache.rows):rowsCache.promise;
  rowsCache.signature=sig;rowsCache.rows=null;
  const qs=new URLSearchParams(params||{}).toString();
  const promise=fetch('/api/backlog-export?'+qs,{credentials:'same-origin'}).then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body&&body.error?body.error:`HTTP ${res.status}`);
    let rows=Array.isArray(body.rows)?body.rows:[];
    const revision=typeof body.rowsRevision==='string'?body.rowsRevision:'';
    if(revision&&revision===rowsCache.lastRevision&&rowsCache.lastRows)rows=rowsCache.lastRows;
    else{rowsCache.lastRevision=revision;rowsCache.lastRows=revision?rows:null;}
    if(rowsCache.signature===sig){rowsCache.rows=rows;rowsCache.promise=null;}
    return rows;
  }).catch(err=>{if(rowsCache.signature===sig){rowsCache.signature='';rowsCache.promise=null;}throw err;});
  rowsCache.promise=promise;
  return promise;
}
window.BLBacklogRows={load:loadRows,invalidate:()=>{rowsCache.signature='';rowsCache.rows=null;rowsCache.promise=null;}};

function queryParams(){try{return typeof backlogExportQueryParams==='function'?backlogExportQueryParams():null;}catch(_){return null;}}
function visible(){const c=$('backlogContent');return !!c&&c.style.display!=='none'&&!!c.offsetParent;}
async function refresh(force){
  const host=$('backlogOverviewBody');if(!host||!state.open)return;
  const params=overviewQueryParams();if(!params){return;}
  const sig=JSON.stringify(params);
  if(!force&&sig===signature&&baseItems){items=applyOverviewFilters(baseItems);return render();}
  loading=true;error='';render();
  try{
    if(window.BLPerf?.ensureFeature)await window.BLPerf.ensureFeature('backlogAnalysis').catch(()=>null);
    if(force)window.BLBacklogRows.invalidate();
    const rows=await loadRows(params);
    if(!R())throw new Error(L('Backlog V3 rapor motoru yüklenemedi.','Backlog V3 report engine could not be loaded.'));
    // Aynı satır dizisi (aynı sunucu revizyonu) zaten normalleştirildiyse tekrarlanmaz.
    if(!(rows===normalizedRows&&baseItems))baseItems=R().normalizeRows(rows);
    normalizedRows=rows;items=applyOverviewFilters(baseItems);signature=sig;
  }catch(err){error=String(err&&err.message||err);baseItems=null;items=null;}
  finally{loading=false;render();}
}
let pendingTimer=0,lastData=null,normalizedRows=null;
function onBacklogRendered(data){
  $('backlogContent')?.classList.add('has-blv');
  // Her yeni Backlog yanıtı (filtre değişimi veya veri yenileme) taze satır
  // demektir: ortak önbellek ve imza burada, Teslimat Riski panelinden ÖNCE sıfırlanır.
  if(data!==lastData){lastData=data;window.BLBacklogRows.invalidate();signature='';}
  clearTimeout(pendingTimer);
  pendingTimer=setTimeout(()=>{if(visible())void refresh(false);},60);
}

/* --------------------------------------------------------------- çizim */
function tip(html){const id='t'+(++seq);tips.set(id,html);return id}
function opener(spec){const id='o'+(++seq);openers.set(id,spec);return id}
function tipHtml(title,lines,hint){return `<div class="bpaTipTitle">${esc(title)}</div>${lines.map(([k,v,stage])=>`<div class="bpaTipLine"><span>${esc(k)}</span><b${stage?` data-stage="${stage}" class="blvTipVal"`:''}>${esc(v)}</b></div>`).join('')}${hint?`<div class="bpaTipHint">${esc(hint)}</div>`:''}`}
function stageLabel(key){return R().stageLabel(key,lang())}
function ring(value){
  const v=Math.max(0,Math.min(1,Number(value)||0)),r=42,c=2*Math.PI*r;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bpaRingTrack" cx="50" cy="50" r="${r}"/><circle class="bpaRingValue" cx="50" cy="50" r="${r}" stroke-dasharray="${(c*v).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 50 50)"/></svg>`;
}
function hero(s){
  const st=s.stages;
  const tile=(value,label,sub,stage,open)=>`<button type="button" class="bpaTile blvTile"${stage?` data-stage="${stage}"`:''}${open?` data-blv-open="${open}"`:''}><span class="bpaTileValue">${esc(value)}</span><span class="bpaTileLabel">${esc(label)}</span>${sub?`<span class="bpaTileSub">${esc(sub)}</span>`:''}</button>`;
  const by=(title,filter)=>opener({title,subtitle:L('Backlog genel bakış','Backlog overview'),items:items.filter(filter)});
  const share=v=>pct(s.qty?v/s.qty:null);
  return `<div class="bpaHero">
    <div class="bpaRing">${ring(s.loadedPct)}<div class="bpaRingText"><b>${esc(pct(s.loadedPct))}</b><span>${esc(L('yüklendi','loaded'))}</span></div><div class="bpaRingSub">${esc(L(`${n(s.orders)} sipariş · ${n(s.lines)} satır`,`${n(s.orders)} orders · ${n(s.lines)} lines`))}</div></div>
    <div class="bpaTiles">
      ${tile(n(s.qty),L('Toplam adet','Total qty'),L(`${n(s.rows)} operasyon satırı`,`${n(s.rows)} operational rows`),'',by(L('Tüm Backlog','Entire Backlog'),()=>true))}
      ${tile(n(st.PRODUCTION),stageLabel('PRODUCTION'),share(st.PRODUCTION),'PRODUCTION',by(stageLabel('PRODUCTION'),it=>it.stage==='PRODUCTION'))}
      ${tile(n(st.LOADING),stageLabel('LOADING'),share(st.LOADING),'LOADING',by(stageLabel('LOADING'),it=>it.stage==='LOADING'))}
      ${tile(n(st.IN_TRANSIT+st.CUSTOMS),L('Yolda + Gümrük','In transit + customs'),share(st.IN_TRANSIT+st.CUSTOMS),'IN_TRANSIT',by(L('Yolda + Gümrük','In transit + customs'),it=>it.stage==='IN_TRANSIT'||it.stage==='CUSTOMS'))}
      ${tile(n(st.IN_WAREHOUSE+st.AWAITING_RETAIL_TRANSFER),L('Depoda + Retail bekleyen','Warehouse + awaiting retail'),share(st.IN_WAREHOUSE+st.AWAITING_RETAIL_TRANSFER),'IN_WAREHOUSE',by(L('Depoda + Retail bekleyen','Warehouse + awaiting retail'),it=>it.stage==='IN_WAREHOUSE'||it.stage==='AWAITING_RETAIL_TRANSFER'))}
      ${tile(n(s.overdueQty),L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'),L(`${n(s.overdueLines)} satır`,`${n(s.overdueLines)} lines`),'SHORTAGE',by(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'),it=>it.overdueNotLoaded))}
      ${tile(n(st.SHORTAGE),stageLabel('SHORTAGE'),share(st.SHORTAGE),st.SHORTAGE?'SHORTAGE':'',by(stageLabel('SHORTAGE'),it=>it.stage==='SHORTAGE'))}
      ${tile(n(s.riskQty),L('Riskli adet','At-risk qty'),L(`${n(s.riskOrders)} sipariş · transit gecikmiş ${n(s.transitOverdueQty)}`,`${n(s.riskOrders)} orders · transit overdue ${n(s.transitOverdueQty)}`),s.riskQty?'SHORTAGE':'',by(L('Riskli adet','At-risk qty'),it=>it.risk||it.transitOverdue))}
      ${tile(n(s.specialQty),L('Özel siparişler','Special orders'),L(`${n(s.specialOrders)} sipariş · ${n(s.specialRiskOrders)} riskli`,`${n(s.specialOrders)} orders · ${n(s.specialRiskOrders)} at risk`),s.specialRiskOrders?'SHORTAGE':'',by(L('Özel siparişler','Special orders'),it=>it.special))}
    </div>
  </div>`;
}
/* Veri kalitesi şeridi: hatalı/eksik kaynak verisi rapora sessizce girmesin. */
function qualityStrip(){
  const issues=R().dataQuality?R().dataQuality(items):[];
  if(!issues.length)return '';
  const chips=issues.map(issue=>{
    const o=opener({title:lang()==='en'?issue.en:issue.tr,subtitle:L('Veri kalitesi','Data quality'),items:issue.items});
    return `<button type="button" class="blvQualityChip" data-blv-open="${o}"><b>${n(issue.count)}</b> ${esc(L('satır','lines'))} · ${esc(lang()==='en'?issue.en:issue.tr)}</button>`;
  }).join('');
  return `<div class="blvQuality" role="status"><span class="blvQualityTitle">${esc(L('Veri kalitesi uyarısı','Data quality warning'))}</span>${chips}<span class="blvQualityHint">${esc(L('Satırlar Excel Backlog V3 › Veri Kalitesi sayfasında da listelenir.','Rows are also listed in Excel Backlog V3 › Data Quality.'))}</span></div>`;
}
/* Özel sipariş uyarısı: riskli siparişlerin içindeki özel siparişler ayrıca
   gösterilir ("riskli 100 siparişin 30'u özel"). Etiket bazında çip tıklanınca
   o etiketin riskli satırları sağdaki çekmecede açılır. */
function specialStrip(total){
  const groups=R().importanceSummary?R().importanceSummary(items):[];
  const scope=importanceScope();
  const seg=`<div class="bpaSeg2 blvImportanceScope" role="group" aria-label="${esc(L('Özel sipariş kapsamı','Special order scope'))}">${[['all',L('Tümü','All')],['special',L('Özel','Special')],['regular','Regular']].map(([key,label])=>`<button type="button" class="${scope===key?'is-active':''}" data-blv-importance="${key}">${esc(label)}</button>`).join('')}</div>`;
  const risky=groups.filter(g=>g.riskItems.length);
  const chips=risky.map(g=>{
    const orders=new Set(g.riskItems.map(it=>it.orderCode||it.lineId)).size;
    const o=opener({title:`${g.name} · ${L('riskli','at risk')}`,subtitle:L('Özel sipariş riski','Special order risk'),items:g.riskItems});
    return `<button type="button" class="blvQualityChip blvSpecialChip" data-blv-open="${o}"><b>${n(orders)}</b> ${esc(L('sipariş','orders'))} · ${esc(g.name)} · ${n(g.riskItems.reduce((t,it)=>t+it.qty,0))} ${esc(L('adet','pcs'))}</button>`;
  }).join('');
  const message=total.specialRiskOrders
    ? L(`Riskli ${n(total.riskOrders)} siparişin ${n(total.specialRiskOrders)} tanesi özel sipariş`,`${n(total.specialRiskOrders)} of ${n(total.riskOrders)} at-risk orders are special orders`)
    : (total.specialOrders?L(`${n(total.specialOrders)} özel siparişte risk yok`,`No risk on ${n(total.specialOrders)} special orders`):L('Bu kapsamda önem etiketli sipariş yok','No tagged orders in this scope'));
  return `<div class="blvQuality blvSpecial${total.specialRiskOrders?' is-alert':''}" role="status"><span class="blvQualityTitle">${esc(message)}</span>${chips}<span class="bpaSectionSpacer"></span>${seg}</div>`;
}
function legend(){return `<div class="bpaLegend">${R().STAGES.map(s=>`<span><i class="bpaDot" data-stage="${s.key}"></i>${esc(stageLabel(s.key))}</span>`).join('')}</div>`}
function bar(name,g,scaleMax,subtitle){
  const width=state.barScale==='qty'&&scaleMax>0?Math.max(2,g.qty/scaleMax*100):100;
  const segs=R().STAGES.filter(s=>g.stages[s.key]>0).map(s=>{
    const qty=g.stages[s.key],list=g.items.filter(it=>it.stage===s.key);
    const t=tip(tipHtml(name,[[subtitle,name],[stageLabel(s.key),n(qty)+' '+L('adet','pcs'),s.key],[L('Grup içindeki payı','Share of group'),pct(g.qty?qty/g.qty:null)],[L('Satır','Lines'),n(g.stageLines[s.key])]],L('Detay için tıklayın','Click for details')));
    const o=opener({title:name,subtitle:`${subtitle} · ${stageLabel(s.key)}`,items:list,stage:s.key});
    return `<span class="bpaSeg" data-stage="${s.key}" style="flex-grow:${qty}" data-blv-tip="${t}" data-blv-open="${o}"></span>`;
  }).join('');
  return `<div class="bpaBarTrack"><div class="bpaBar" style="width:${width.toFixed(2)}%">${segs||'<span class="bpaSeg is-empty"></span>'}</div></div>`;
}
function groupCard(total){
  const dims=R().DIMENSIONS,key=dims.includes(state.groupBy)?state.groupBy:'buyer',label=R().dimLabel(key,lang());
  const groups=R().groupBy(items,key,{blank:L('(boş)','(blank)')}),list=state.showAll?groups:groups.slice(0,15),max=groups.reduce((m,g)=>Math.max(m,g.qty),0);
  const row=(name,g,isTotal)=>{
    const o=opener({title:name,subtitle:label,items:g.items});
    return `<div class="bpaGRow${isTotal?' is-total':''}"><button type="button" class="bpaGName" data-blv-open="${o}" title="${esc(name)}">${esc(name)}</button>${bar(name,g,isTotal?0:max,label)}<div class="bpaGStats"><b>${esc(pct(g.loadedPct))}</b><span>${n(g.qty)} ${esc(L('adet','pcs'))}${g.overdueQty?` · <i class="blvOver">${n(g.overdueQty)} ${esc(L('gecikmiş','overdue'))}</i>`:''}</span></div></div>`;
  };
  return `<div class="bpaCardBox"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Operasyon dağılımı','Operational distribution'))}</span><span class="bpaSectionSub">${esc(L('Segmentin üzerine gelin; tıklayınca siparişler sağda açılır. Sağdaki yüzde yüklenen oranıdır.','Hover a segment; click to open its orders. The percentage is the loaded share.'))}</span><span class="bpaSectionSpacer"></span>
    <div class="bpaSeg2" role="group">${dims.map(d=>`<button type="button" class="${d===key?'is-active':''}" data-blv-group="${d}">${esc(R().dimLabel(d,lang()))}</button>`).join('')}</div>
    <div class="bpaSeg2" role="group"><button type="button" class="${state.barScale!=='qty'?'is-active':''}" data-blv-scale="pct">%</button><button type="button" class="${state.barScale==='qty'?'is-active':''}" data-blv-scale="qty">${esc(L('Adet','Qty'))}</button></div></div>
    ${legend()}
    <div class="bpaGroups">${row(L('Tümü','All'),{...total,items},true)}${list.map(g=>row(g.name,g,false)).join('')}</div>
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
function timelineDimensionTipHtml(title,bucket,dimension,names){
  const grouped=R().groupBy(bucket&&bucket.items||[],dimension,{blank:L('(boş)','(blank)')}),byName=new Map(grouped.map(g=>[g.name,g]));
  const rows=(names||[]).map((name,index)=>{
    const g=byName.get(name);if(!g||!g.qty)return '';
    return `<span><i style="--seg:${timelineGroupColor(index)}"></i><b>${esc(name)}</b><em>${esc(n(g.qty))}</em></span>`;
  }).join('');
  return `<strong>${esc(title)}</strong>${rows}<span class="backlogChartTooltipTotal"><i></i><b>${esc(L('Dönem toplamı','Period total'))}</b><em>${esc(n(bucket&&bucket.qty||0))}</em></span>`;
}
function timelineDimensionLegend(names,label){
  return `<div class="blvTimelineLegend blvTimelineLegend--dimension"><span class="blvTimelineLegendLabel">${esc(label)}</span><div class="bpaLegend blvBuyerLegend">${(names||[]).map((name,index)=>`<span title="${esc(name)}"><i class="bpaDot" style="--seg:${timelineGroupColor(index)}"></i>${esc(name)}</span>`).join('')}</div></div>`;
}
function flowCard(){
  const fields=R().TIMELINE_FIELDS,field=fields.find(f=>f.key===state.timeField)||fields[0];
  const series=R().timeline(items,field.key,{granularity:state.granularity,lang:lang()}),max=series.reduce((m,b)=>Math.max(m,b.qty),0);
  const stageMax=series.reduce((m,b)=>Math.max(m,...R().STAGES.map(s=>Number(b.stages[s.key])||0)),0);
  const chartMode=state.timelineChart==='grouped'?'grouped':'stacked';
  const dimension=state.timelineDimension==='buyer'?'buyer':'buyingGroup',dimensionLabel=R().dimLabel(dimension,lang());
  const dimensionNames=R().groupBy(items,dimension,{blank:L('(boş)','(blank)')}).map(g=>g.name);
  const dimensionByBucket=new Map(series.map(b=>[b.key,R().groupBy(b.items,dimension,{blank:L('(boş)','(blank)')})]));
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
        const qty=b.stages[s.key],list=b.items.filter(it=>it.stage===s.key);
        const o=opener({title:`${fLabel} · ${b.label}`,subtitle:stageLabel(s.key),items:list,stage:s.key});
        const height=stageMax?Math.max(2,qty/stageMax*100):0;
        return `<span class="blvGroupBar" data-stage="${s.key}" style="height:${height.toFixed(1)}%" data-blv-open="${o}" title="${esc(stageLabel(s.key)+': '+n(qty))}"></span>`;
      }).join('');
      logistics=`<div class="blvGroupBars">${bars}</div>`;
    }else{
      const segs=R().STAGES.filter(s=>b.stages[s.key]>0).map(s=>{
        const qty=b.stages[s.key],list=b.items.filter(it=>it.stage===s.key);
        const o=opener({title:`${fLabel} · ${b.label}`,subtitle:stageLabel(s.key),items:list,stage:s.key});
        return `<span class="bpaSeg" data-stage="${s.key}" style="flex-grow:${qty}" data-blv-open="${o}"></span>`;
      }).join('');
      logistics=`<div class="bpaColBar" style="height:${max?Math.max(3,b.qty/max*100).toFixed(1):0}%">${segs}</div>`;
    }
    const bucketGroups=dimensionByBucket.get(b.key)||[],byName=new Map(bucketGroups.map(g=>[g.name,g]));
    const groupTip=tip(timelineDimensionTipHtml(`${dimensionLabel} · ${b.label}`,b,dimension,dimensionNames));
    const dimensionEntries=dimensionNames.map((name,index)=>{
      const g=byName.get(name);if(!g||!g.qty)return null;
      return {name,index,g,o:opener({title:name,subtitle:`${dimensionLabel} · ${fLabel} · ${b.label}`,items:g.items})};
    }).filter(Boolean);
    let dimensionChart='';
    if(chartMode==='grouped'){
      const bars=dimensionEntries.map(({name,index,g,o})=>{
        const height=dimensionMax?Math.max(2,g.qty/dimensionMax*100):0;
        return `<span class="blvBuyerBar" style="height:${height.toFixed(1)}%;--seg:${timelineGroupColor(index)}" data-blv-open="${o}" title="${esc(name+': '+n(g.qty))}"></span>`;
      }).join('');
      dimensionChart=`<div class="blvBuyerBars is-grouped">${bars}</div>`;
    }else{
      const stackHeight=max?Math.max(3,b.qty/max*100):0;
      const segs=dimensionEntries.map(({name,index,g,o})=>`<span class="blvBuyerStackSeg" style="flex-grow:${g.qty};--seg:${timelineGroupColor(index)}" data-blv-open="${o}" title="${esc(name+': '+n(g.qty))}"></span>`).join('');
      dimensionChart=`<div class="blvBuyerBars is-stacked"><div class="blvBuyerStack" style="height:${stackHeight.toFixed(1)}%">${segs}</div></div>`;
    }
    return `<div class="${columnClass} ${chartMode==='grouped'?'blvGroupedCol':''}" ${commonAttrs}>${todayMarker}<div class="bpaColValue">${value}</div><div class="bpaColTrack blvLogisticsTrack ${chartMode==='grouped'?'blvGroupTrack':''}">${logistics}</div><div class="blvBandDivider"></div><div class="blvBuyerTrack" data-blv-tip="${groupTip}" data-blv-tip-style="chart">${dimensionChart}</div><div class="bpaColLabel">${esc(b.label)}</div></div>`;
  }).join('');
  return `<div class="bpaCardBox blvUnifiedTimelineCard"><div class="bpaSectionHead"><button type="button" class="bpaTodayBtn" data-blv-action="today" title="${esc(L('Bugünün dönemine git','Go to the current period'))}">${esc(L('Bugün','Today'))}</button><span class="bpaSectionTitle">${esc(L('Zaman akışı','Timeline'))}</span><span class="bpaSectionSub">${esc(L('Tek zaman ekseninde üstte lojistik durum, altta Buyer kırılımı gösterilir. Kırmızı sayı: Ex-F tarihi geçmiş ama yüklenmemiş adet.','One shared time axis: logistics status above, Buyer breakdown below. Red figure: Ex-F passed but not loaded.'))}</span><span class="bpaSectionSpacer"></span>
    <div class="bpaSeg2" role="group">${fields.map(f=>`<button type="button" class="${f.key===field.key?'is-active':''}" data-blv-time="${f.key}">${esc(lang()==='en'?f.en:f.tr)}</button>`).join('')}</div>
    <div class="bpaSeg2 blvChartMode" role="group" aria-label="${esc(L('Lojistik grafik tipi','Logistics chart type'))}"><button type="button" class="${chartMode==='stacked'?'is-active':''}" data-blv-chart="stacked" title="${esc(L('Durumları aynı sütunda yığılmış göster','Show statuses stacked in one column'))}">${esc(L('Yığılmış','Stacked'))}</button><button type="button" class="${chartMode==='grouped'?'is-active':''}" data-blv-chart="grouped" title="${esc(L('Durumları yan yana ayrı sütunlarda göster','Show statuses as separate side-by-side columns'))}">${esc(L('Yan yana','Side by side'))}</button></div>
    <div class="bpaSeg2 blvTimelineDimension" role="group" aria-label="${esc(L('Alt grafik kırılımı','Lower chart breakdown'))}"><button type="button" class="${dimension==='buyingGroup'?'is-active':''}" data-blv-timeline-dim="buyingGroup">${esc(L('Buyer Grup','Buying Group'))}</button><button type="button" class="${dimension==='buyer'?'is-active':''}" data-blv-timeline-dim="buyer">Buyer</button></div>
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
  filterCatalogPromise=fetch('/api/backlog-source-columns',{credentials:'same-origin'}).then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body&&body.error?body.error:`HTTP ${res.status}`);
    const cp=(Array.isArray(body.defaultHeaders)?body.defaultHeaders:[]).map(header=>({
      id:'cp:'+header,source:'cp',header:String(header),rowKey:String(header),label:String(header)
    }));
    const raw=(Array.isArray(body.columns)?body.columns:[]).filter(column=>column&&column.id&&column.header&&column.label).map(column=>({
      id:String(column.id),source:column.source==='antrepo'?'antrepo':'asas',header:String(column.header),
      rowKey:String(column.label),label:String(column.header)
    }));
    filterCatalog=[...cp,...raw];
    return filterCatalog;
  }).catch(err=>{filterCatalogError=String(err&&err.message||err);throw err;}).finally(()=>{filterCatalogPromise=null;});
  return filterCatalogPromise;
}
function filterRoot(){
  let root=$('blvFilterRoot');
  if(root)return root;
  root=document.createElement('div');root.id='blvFilterRoot';root.className='blvFilterRoot';root.hidden=true;
  root.innerHTML='<div class="blvFilterScrim" data-blvf-close></div><aside class="blvFilterDrawer" role="dialog" aria-modal="true" aria-labelledby="blvFilterTitle"><div class="blvFilterMount"></div></aside>';
  document.body.appendChild(root);
  root.addEventListener('click',e=>{
    const close=e.target.closest('[data-blvf-close]');if(close){closeFilterPanel();return;}
    const source=e.target.closest('[data-blvf-source]');if(source){filterSource=source.dataset.blvfSource||'cp';filterSearch='';renderFilterPanel();return;}
    const reset=e.target.closest('[data-blvf-reset]');if(reset){state.filters=[];filterEditorId='';filterValueSearch='';signature='';reapplyOverviewFilters();return;}
    const add=e.target.closest('[data-blvf-add]');if(add){void addOverviewFilter(decodeURIComponent(add.dataset.blvfAdd||''));return;}
    const edit=e.target.closest('[data-blvf-edit]');if(edit){filterEditorId=decodeURIComponent(edit.dataset.blvfEdit||'');filterValueSearch='';renderFilterPanel();return;}
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
  root.addEventListener('input',e=>{
    if(e.target.matches('[data-blvf-search]')){
      filterSearch=e.target.value||'';const pos=e.target.selectionStart;renderFilterPanel();
      requestAnimationFrame(()=>{const input=root.querySelector('[data-blvf-search]');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch(_){}}});return;
    }
    if(e.target.matches('[data-blvf-value-search]')){
      filterValueSearch=e.target.value||'';const pos=e.target.selectionStart;renderFilterPanel();
      requestAnimationFrame(()=>{const input=root.querySelector('[data-blvf-value-search]');if(input){input.focus();try{input.setSelectionRange(pos,pos)}catch(_){}}});return;
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
  filterOpen=true;const root=filterRoot();root.hidden=false;requestAnimationFrame(()=>root.classList.add('is-open'));updateFilterButton();renderFilterPanel();
  try{await ensureFilterCatalog();renderFilterPanel();}catch(_){renderFilterPanel();}
}
function closeFilterPanel(){
  filterOpen=false;const root=$('blvFilterRoot');if(root){root.classList.remove('is-open');setTimeout(()=>{if(!filterOpen)root.hidden=true;},160);}updateFilterButton();
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
  let filter=overviewFilters().find(item=>item.id===id),added=false;
  if(!filter){
    filter={id:field.id,source:field.source,header:field.header,rowKey:field.rowKey,label:field.label,values:[],from:'',to:''};
    state.filters=[...overviewFilters(),filter];added=true;saveState();
  }
  filterEditorId=id;filterValueSearch='';
  if(!baseItems||added&&(field.source==='asas'||field.source==='antrepo')){signature='';await refresh(!!baseItems);}
  else renderFilterPanel();
}
function renderFilterEditor(filter){
  if(!filter)return `<div class="blvFilterEditorEmpty"><svg class="ic"><use href="#i-filter"/></svg><b>${esc(L('Bir sütun seçin','Select a column'))}</b><span>${esc(L('Soldaki CP, ASAS veya IAS sütunlarından birini seçerek filtre ekleyin.','Choose a CP, ASAS or IAS column on the left to add a filter.'))}</span></div>`;
  const kind=filterKind(filter),rawValues=(baseItems||[]).map(item=>filterRawValue(item,filter)).filter(value=>value!=null&&value!=='');
  let controls='';
  if(kind==='date'){
    const days=rawValues.map(filterDay).filter(Boolean).sort(),min=days[0]||'',max=days[days.length-1]||'';
    controls=`<div class="blvFilterDateGrid"><label><span>${esc(L('Başlangıç','From'))}</span><input type="date" data-blvf-from value="${esc(filter.from||'')}"${min?` min="${esc(min)}"`:''}${max?` max="${esc(max)}"`:''}></label><label><span>${esc(L('Bitiş','To'))}</span><input type="date" data-blvf-to value="${esc(filter.to||'')}"${min?` min="${esc(min)}"`:''}${max?` max="${esc(max)}"`:''}></label></div>
      <div class="blvFilterRangeHint">${esc(min&&max?L(`Veri aralığı: ${fmtDay(min)} – ${fmtDay(max)}`,`Data range: ${fmtDay(min)} – ${fmtDay(max)}`):L('Bu sütunda tarih değeri bulunamadı.','No date values found in this column.'))}</div>`;
  }else{
    const q=filterValueSearch.trim().toLocaleLowerCase(lang()==='en'?'en':'tr'),all=distinctFilterValues(filter);
    const matched=all.filter(entry=>!q||entry.label.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)),visible=matched.slice(0,300),selected=new Set(filter.values||[]);
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
  const sourceItems=filterCatalog.filter(field=>field.source===filterSource).filter(field=>!q||field.label.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q)||field.header.toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q));
  const visibleFields=sourceItems.slice(0,300),editor=overviewFilters().find(f=>f.id===filterEditorId)||null;
  const sourceCount=source=>filterCatalog.filter(field=>field.source===source).length;
  const active=overviewFilters();
  mount.innerHTML=`<header class="blvFilterHead"><div><span class="blvFilterKicker">${esc(L('BACKLOG GENEL BAKIŞ','BACKLOG OVERVIEW'))}</span><h3 id="blvFilterTitle">${esc(L('Analiz Filtreleri','Analysis Filters'))}</h3><p>${esc(L('Bu filtreler yalnız Genel Bakış analizini etkiler; Backlog ana tablosunu değiştirmez.','These filters affect only Overview analysis; the main Backlog table is unchanged.'))}</p></div><div class="blvFilterHeadActions"><button type="button" data-blvf-reset${active.length?'':' disabled'}>${esc(L('Tümünü sıfırla','Reset all'))}</button><button type="button" data-blvf-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
    <div class="blvFilterSummary"><div><b>${n((items||[]).length)}</b><span>/ ${n((baseItems||[]).length)} ${esc(L('satır','rows'))}</span></div><span>${esc(L(`${activeFilterCount()} aktif filtre`,`${activeFilterCount()} active filters`))}</span></div>
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
  if(!state.open){host.innerHTML='';return;}
  if(loading){host.innerHTML=`<div class="bpaLoading"><span class="bpaSpinner"></span>${esc(L('Backlog satırları toplanıyor…','Collecting Backlog rows…'))}</div>`;return;}
  if(error){host.innerHTML=`<div class="bpaError">${esc(error)}</div>`;return;}
  if(!items||!R()){host.innerHTML=`<div class="bpaEmpty">${esc(L('Backlog yüklendiğinde genel bakış burada görünür.','The overview appears once Backlog loads.'))}</div>`;return;}
  if(!items.length){host.innerHTML=`<div class="bpaEmpty">${esc(L('Aktif filtrede Backlog satırı yok.','No Backlog rows for the active filter.'))}</div>`;return;}
  const total=R().summarize(items);
  host.innerHTML=hero(total)+specialStrip(total)+qualityStrip()+groupCard(total)+`<div class="blvGap"></div>`+flowCard();
  // Yeni DOM sıfır scrollLeft ile başlar; zaman eksenini mevcut döneme otomatik geri odakla.
  requestAnimationFrame(()=>scrollTimelineToToday('auto'));
}

/* --------------------------------------------------------- tooltip/panel */
function tipEl(){let el=$('blvTip');if(!el){el=document.createElement('div');el.id='blvTip';el.className='bpaTip blvTipBox';el.hidden=true;el.setAttribute('role','tooltip');document.body.appendChild(el);}return el}
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
  let plmId=take(it&&it.plmId,row._plmId,row.plmId,row.plm,row['PLM ID'],row['PLM Id'],row['Plm Kod'],row['PLM Kod'],row['PLM Code']);
  try{plmId=window.BLDetailImages?.resolvePlmId?.(plmId,modelName)||plmId;}catch(_){}
  return {
    plmId,
    modelName,
    colourCode:take(it&&it.colourCode,row._colourCode,row.colourCode,row.ccode,row['C.Code'],row['Renk Kod'],row['Renk Kodu'],row['Colour Code'],row['Color Code']),
    colour:take(it&&it.colour,row.colour,row.color,row.Colour,row.Color,row.Renk,row['Renk Adı']),
    orderCode:take(it&&it.orderCode,row.orderCode,row.ocode,row['Sipariş Kod'],row['Sipariş Kodu'],row['Order Code'])
  };
}
function drawerModelImageUrl(it){
  const api=window.BLDetailImages,id=drawerModelIdentity(it),row=it&&it.row&&typeof it.row==='object'?it.row:{};
  if(!api)return '';
  const directRef=String(row._imageRef==null?'':row._imageRef).trim();
  return api.sourceFor?.({plmId:id.plmId,modelName:id.modelName,colourCode:id.colourCode,colour:id.colour})||
    (directRef?'/api/cp-images/'+encodeURIComponent(directRef):'')||'';
}
function drawerModelImageHtml(it){
  const api=window.BLDetailImages,id=drawerModelIdentity(it);
  if(!api?.thumbHtml)return '<span class="bpaSub">—</span>';
  return api.thumbHtml(drawerModelImageUrl(it),{
    modelId:id.plmId||id.modelName,plmId:id.plmId,modelName:id.modelName,colourCode:id.colourCode,colour:id.colour
  },{
    classes:'detailModelThumb blvModelThumb',
    title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),
    allowEmpty:true
  });
}
function registerDrawerModelImages(aside,list,spec){
  const api=window.BLDetailImages;if(!api)return;
  const identities=(list||[]).map((it,index)=>{
    const id=drawerModelIdentity(it);
    return {...id,rowId:String(index),hasImage:Boolean(drawerModelImageUrl(it))};
  });
  api.registerScope?.(aside,{
    contextType:'backlog-overview-detail',
    label:String(spec&&spec.title||L('Backlog detay','Backlog detail')),
    identities,
    repaint:()=>openDrawer(spec)
  });
  api.bindThumbs?.(aside);
  api.bindModelImagesButton?.('blvDrawerPlmSync');
}
function drawerEl(){
  let el=$('blvDrawer');
  if(!el){
    el=document.createElement('div');el.id='blvDrawer';el.className='bpaDrawerRoot blvDrawerRoot';el.hidden=true;
    el.innerHTML='<div class="bpaDrawerScrim" data-blv-close></div><aside class="bpaDrawer" role="dialog" aria-modal="true" aria-labelledby="blvDrawerTitle"></aside>';
    document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target.closest('[data-blv-close]'))closeDrawer();});
  }
  return el;
}
function closeDrawer(){const el=$('blvDrawer');if(el&&!el.hidden){el.hidden=true;el.classList.remove('is-open');}}
function openDrawer(spec){
  if(!spec)return;hideTip();
  const root=drawerEl(),aside=root.querySelector('.bpaDrawer');
  const list=(spec.items||[]).slice().sort((a,b)=>(b.overdueDays-a.overdueDays)||(b.qty-a.qty));
  const s=R().summarize(list);
  const rows=list.slice(0,ROW_LIMIT).map(it=>`<tr>
    <td class="detailImgCell">${drawerModelImageHtml(it)}</td>
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
  const plmSyncButton=window.BLDetailImages?.modelImagesButtonHtml?.('blvDrawerPlmSync')||'';
  aside.innerHTML=`<header class="bpaDrawerHead"><div><div class="bpaDrawerKicker">${spec.stage?`<i class="bpaDot" data-stage="${spec.stage}"></i>`:''}${esc(spec.subtitle||'')}</div><h3 id="blvDrawerTitle">${esc(spec.title||'')}</h3></div><div class="bpaActions">${plmSyncButton}<button type="button" class="tbtn bpaMoveBtn" data-blv-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
    <div class="bpaDrawerStats">
      <div><b>${n(s.qty)}</b><span>${esc(L('adet','qty'))}</span></div>
      <div><b>${n(s.orders)}</b><span>${esc(L('sipariş','orders'))}</span></div>
      <div><b>${n(s.lines)}</b><span>${esc(L('satır','lines'))}</span></div>
      <div><b>${esc(pct(s.loadedPct))}</b><span>${esc(L('yüklendi','loaded'))}</span></div>
      <div><b class="is-overdue">${n(s.overdueQty)}</b><span>${esc(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'))}</span></div>
    </div>
    <div class="bpaBar bpaDrawerBar">${R().STAGES.filter(x=>s.stages[x.key]>0).map(x=>`<span class="bpaSeg" data-stage="${x.key}" style="flex-grow:${s.stages[x.key]}" title="${esc(stageLabel(x.key)+': '+n(s.stages[x.key]))}"></span>`).join('')}</div>
    <div class="bpaTableWrap bpaDrawerTable"><table class="bpaTable"><thead><tr><th class="detailImgCell">${esc(L('Görsel','Image'))}</th><th>${esc(L('Aşama','Stage'))}</th><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th class="num">${esc(L('Adet','Qty'))}</th><th>Ex-Factory</th><th>${esc(L('Antrepo','Warehouse'))}</th><th>Retail</th><th>${esc(L('Sinyal','Signal'))}</th></tr></thead><tbody>${rows}</tbody></table>${list.length>ROW_LIMIT?`<div class="bpaNote">${esc(L(`İlk ${ROW_LIMIT} satır gösteriliyor; tamamı Excel Backlog V3'te.`,`Showing first ${ROW_LIMIT} rows; Excel Backlog V3 contains all.`))}</div>`:''}</div>`;
  registerDrawerModelImages(aside,list,spec);
  root.hidden=false;requestAnimationFrame(()=>root.classList.add('is-open'));
  aside.querySelector('[data-blv-close]')?.focus();
}

/* ------------------------------------------------------------- bağlar */
function setOpen(value){
  state.open=value;saveState();
  const mod=$('backlogOverview'),body=$('backlogOverviewBody'),toggle=$('backlogOverviewToggle');
  mod?.classList.toggle('is-open',value);if(body)body.hidden=!value;
  toggle?.setAttribute('aria-expanded',value?'true':'false');
  if(value)void refresh(false);else{closeDrawer();closeFilterPanel();render();}
}
function bind(){
  if(bound)return;const host=$('backlogOverviewBody');if(!host)return;bound=true;
  $('backlogOverviewToggle')?.addEventListener('click',()=>setOpen(!state.open));
  $('backlogOverviewFilter')?.addEventListener('click',e=>{e.stopPropagation();if(filterOpen)closeFilterPanel();else void openFilterPanel();});
  $('backlogOverviewRefresh')?.addEventListener('click',e=>{e.stopPropagation();void refresh(true);});
  host.addEventListener('click',e=>{
    const t=e.target.closest('[data-blv-open],[data-blv-importance],[data-blv-group],[data-blv-scale],[data-blv-time],[data-blv-chart],[data-blv-timeline-dim],[data-blv-gran],[data-blv-action]');
    if(!t||!host.contains(t))return;
    if(t.dataset.blvImportance){state.importanceScope=t.dataset.blvImportance;saveState();items=applyOverviewFilters(baseItems||[]);return render();}
    if(t.dataset.blvGroup){state.groupBy=t.dataset.blvGroup;state.showAll=false;saveState();return render();}
    if(t.dataset.blvScale){state.barScale=t.dataset.blvScale;saveState();return render();}
    if(t.dataset.blvTime){state.timeField=t.dataset.blvTime;saveState();return render();}
    if(t.dataset.blvChart){state.timelineChart=t.dataset.blvChart==='grouped'?'grouped':'stacked';saveState();return render();}
    if(t.dataset.blvTimelineDim){state.timelineDimension=t.dataset.blvTimelineDim==='buyer'?'buyer':'buyingGroup';saveState();return render();}
    if(t.dataset.blvGran){state.granularity=t.dataset.blvGran;saveState();return render();}
    if(t.dataset.blvAction==='today'){scrollTimelineToToday();return;}
    if(t.dataset.blvAction==='toggleAll'){state.showAll=!state.showAll;saveState();return render();}
    if(t.dataset.blvOpen)openDrawer(openers.get(t.dataset.blvOpen));
  });
  host.addEventListener('mousemove',moveTip);
  host.addEventListener('mouseleave',hideTip);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeFilterPanel();}});
  document.addEventListener('bl:language-changed',()=>{render();if(filterOpen)renderFilterPanel();});
}
function init(){
  bind();
  const mod=$('backlogOverview');
  if(mod){mod.classList.toggle('is-open',!!state.open);const body=$('backlogOverviewBody');if(body)body.hidden=!state.open;$('backlogOverviewToggle')?.setAttribute('aria-expanded',state.open?'true':'false');}
  updateFilterButton();render();
  // Görünmeyen modül çizilmez (perf-runtime sözleşmesi): Backlog sekmesi
  // görünür olduğunda bekleyen yenileme burada tetiklenir.
  if(mod&&'IntersectionObserver' in window){
    new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&state.open&&!loading&&(!items||signature!==JSON.stringify(overviewQueryParams()||{})))void refresh(false);}).observe(mod);
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
  onBacklogRendered,refresh:()=>refresh(true),openItems:openExternalItems,
  exportOptions:()=>({includePlanActual:state.exportPlanActual!==false,includeLegacy:state.exportLegacy!==false,groupBy:state.groupBy}),
  setExportOption:(key,value)=>{if(key==='includePlanActual')state.exportPlanActual=!!value;if(key==='includeLegacy')state.exportLegacy=!!value;saveState();},
};
})();
