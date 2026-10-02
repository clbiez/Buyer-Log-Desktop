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
const n=v=>nf.format(Number(v)||0);
const pct=v=>v==null||!Number.isFinite(v)?'—':'%'+pf.format(v*100);
const R=()=>window.BLBacklogV3Report;
let state=loadState();
let items=null,loading=false,error='',signature='',tips=new Map(),openers=new Map(),seq=0,bound=false;

function loadState(){
  const defaults={open:true,groupBy:'buyer',barScale:'pct',timeField:'exFactory',granularity:'week',showAll:false,exportPlanActual:true,exportLegacy:true};
  try{const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'null');if(raw&&typeof raw==='object')return {...defaults,...raw};}catch(_){}
  return defaults;
}
function saveState(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
function fmtDay(iso){const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:'—'}

/* ------------------------------------------------ ortak satır önbelleği */
const rowsCache={signature:'',promise:null,rows:null};
function loadRows(params){
  const sig=JSON.stringify(params||{});
  if(rowsCache.signature===sig&&(rowsCache.rows||rowsCache.promise))return rowsCache.rows?Promise.resolve(rowsCache.rows):rowsCache.promise;
  rowsCache.signature=sig;rowsCache.rows=null;
  const qs=new URLSearchParams(params||{}).toString();
  const promise=fetch('/api/backlog-export?'+qs,{credentials:'same-origin'}).then(async res=>{
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body&&body.error?body.error:`HTTP ${res.status}`);
    const rows=Array.isArray(body.rows)?body.rows:[];
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
  const params=queryParams();if(!params){return;}
  const sig=JSON.stringify(params);
  if(!force&&sig===signature&&items)return render();
  loading=true;error='';render();
  try{
    if(window.BLPerf?.ensureFeature)await window.BLPerf.ensureFeature('backlogAnalysis').catch(()=>null);
    if(force)window.BLBacklogRows.invalidate();
    const rows=await loadRows(params);
    if(!R())throw new Error(L('Backlog V3 rapor motoru yüklenemedi.','Backlog V3 report engine could not be loaded.'));
    items=R().normalizeRows(rows);signature=sig;
  }catch(err){error=String(err&&err.message||err);items=null;}
  finally{loading=false;render();}
}
let pendingTimer=0,lastData=null;
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
      ${tile(n(s.riskQty),L('Riskli adet','At-risk qty'),L(`Transit gecikmiş ${n(s.transitOverdueQty)}`,`Transit overdue ${n(s.transitOverdueQty)}`),s.riskQty?'SHORTAGE':'',by(L('Riskli adet','At-risk qty'),it=>it.risk||it.transitOverdue))}
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
function flowCard(){
  const fields=R().TIMELINE_FIELDS,field=fields.find(f=>f.key===state.timeField)||fields[0];
  const series=R().timeline(items,field.key,{granularity:state.granularity,lang:lang()}),max=series.reduce((m,b)=>Math.max(m,b.qty),0);
  const fLabel=lang()==='en'?field.en:field.tr;
  const cols=series.map(b=>{
    const segs=R().STAGES.filter(s=>b.stages[s.key]>0).map(s=>{
      const qty=b.stages[s.key],list=b.items.filter(it=>it.stage===s.key);
      const t=tip(tipHtml(`${fLabel} · ${b.label}`,[[stageLabel(s.key),n(qty)+' '+L('adet','pcs'),s.key],[L('Dönem toplamı','Period total'),n(b.qty)],[L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'),n(b.overdueQty)]],L('Detay için tıklayın','Click for details')));
      const o=opener({title:`${fLabel} · ${b.label}`,subtitle:stageLabel(s.key),items:list,stage:s.key});
      return `<span class="bpaSeg" data-stage="${s.key}" style="flex-grow:${qty}" data-blv-tip="${t}" data-blv-open="${o}"></span>`;
    }).join('');
    return `<div class="bpaCol${b.past?' is-past':''}"><div class="bpaColValue">${b.overdueQty?`<span class="blvOver">${n(b.overdueQty)}</span>`:n(b.qty)}</div><div class="bpaColTrack"><div class="bpaColBar" style="height:${max?Math.max(3,b.qty/max*100).toFixed(1):0}%">${segs}</div></div><div class="bpaColLabel">${esc(b.label)}</div></div>`;
  }).join('');
  return `<div class="bpaCardBox"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Zaman akışı','Timeline'))}</span><span class="bpaSectionSub">${esc(L('Sütun üstünde kırmızı sayı: Ex-F tarihi geçmiş ama yüklenmemiş adet.','Red figure above a column: Ex-F passed but not loaded.'))}</span><span class="bpaSectionSpacer"></span>
    <div class="bpaSeg2" role="group">${fields.map(f=>`<button type="button" class="${f.key===field.key?'is-active':''}" data-blv-time="${f.key}">${esc(lang()==='en'?f.en:f.tr)}</button>`).join('')}</div>
    <div class="bpaSeg2" role="group"><button type="button" class="${state.granularity!=='month'?'is-active':''}" data-blv-gran="week">${esc(L('Hafta','Week'))}</button><button type="button" class="${state.granularity==='month'?'is-active':''}" data-blv-gran="month">${esc(L('Ay','Month'))}</button></div></div>
    ${series.length?`<div class="bpaCols blvCols">${cols}</div>`:`<div class="bpaEmpty">${esc(L('Bu tarih alanında veri yok.','No data for this date field.'))}</div>`}</div>`;
}
function render(){
  const host=$('backlogOverviewBody');if(!host)return;
  tips=new Map();openers=new Map();hideTip();
  if(!state.open){host.innerHTML='';return;}
  if(loading){host.innerHTML=`<div class="bpaLoading"><span class="bpaSpinner"></span>${esc(L('Backlog satırları toplanıyor…','Collecting Backlog rows…'))}</div>`;return;}
  if(error){host.innerHTML=`<div class="bpaError">${esc(error)}</div>`;return;}
  if(!items||!R()){host.innerHTML=`<div class="bpaEmpty">${esc(L('Backlog yüklendiğinde genel bakış burada görünür.','The overview appears once Backlog loads.'))}</div>`;return;}
  if(!items.length){host.innerHTML=`<div class="bpaEmpty">${esc(L('Aktif filtrede Backlog satırı yok.','No Backlog rows for the active filter.'))}</div>`;return;}
  const total=R().summarize(items);
  host.innerHTML=hero(total)+qualityStrip()+groupCard(total)+`<div class="blvGap"></div>`+flowCard();
}

/* --------------------------------------------------------- tooltip/panel */
function tipEl(){let el=$('blvTip');if(!el){el=document.createElement('div');el.id='blvTip';el.className='bpaTip blvTipBox';el.hidden=true;el.setAttribute('role','tooltip');document.body.appendChild(el);}return el}
function hideTip(){const el=$('blvTip');if(el)el.hidden=true}
function moveTip(e){
  const target=e.target&&e.target.closest?e.target.closest('[data-blv-tip]'):null;
  if(!target||!tips.has(target.dataset.blvTip)){hideTip();return;}
  const el=tipEl();
  if(el.dataset.key!==target.dataset.blvTip){el.innerHTML=tips.get(target.dataset.blvTip);el.dataset.key=target.dataset.blvTip;}
  el.hidden=false;
  const pad=14,w=el.offsetWidth,h=el.offsetHeight;let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>window.innerWidth-8)x=e.clientX-w-pad;if(y+h>window.innerHeight-8)y=e.clientY-h-pad;
  el.style.left=Math.max(8,x)+'px';el.style.top=Math.max(8,y)+'px';
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
    <td><span class="bpaBadge blvBadge" data-stage="${it.stage}">${esc(stageLabel(it.stage))}</span>${it.status&&it.status!==stageLabel(it.stage)?`<small class="bpaSub">${esc(it.status)}</small>`:''}</td>
    <td><div class="bpaIdentity">${esc(it.orderCode||'—')}<small>${esc([it.modelName,it.colourCode,it.colour].filter(Boolean).join(' · '))}</small></div></td>
    <td>${esc(it.buyer||'—')}<small class="bpaSub">${esc([it.buyingGroup,it.category].filter(Boolean).join(' · '))}</small></td>
    <td>${esc(it.manufacturer||'—')}<small class="bpaSub">${esc([it.season,it.deliveryType].filter(Boolean).join(' · '))}</small></td>
    <td class="num">${n(it.qty)}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.exFactory))}${it.overdueDays?`<small><span class="bpaDayDelta is-late">${n(it.overdueDays)} ${esc(L('gün geçti','days overdue'))}</span></small>`:''}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.antrepo))}</td>
    <td class="bpaDateCell">${esc(fmtDay(it.retail))}</td>
    <td>${it.risk?`<span class="bpaTag is-alert">${esc(L('risk','risk'))}</span>`:''}${it.transitOverdue?`<span class="bpaTag is-alert">${esc(L('transit gecikti','transit overdue'))}</span>`:''}</td>
  </tr>`).join('');
  aside.innerHTML=`<header class="bpaDrawerHead"><div><div class="bpaDrawerKicker">${spec.stage?`<i class="bpaDot" data-stage="${spec.stage}"></i>`:''}${esc(spec.subtitle||'')}</div><h3 id="blvDrawerTitle">${esc(spec.title||'')}</h3></div><button type="button" class="tbtn bpaMoveBtn" data-blv-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>
    <div class="bpaDrawerStats">
      <div><b>${n(s.qty)}</b><span>${esc(L('adet','qty'))}</span></div>
      <div><b>${n(s.orders)}</b><span>${esc(L('sipariş','orders'))}</span></div>
      <div><b>${n(s.lines)}</b><span>${esc(L('satır','lines'))}</span></div>
      <div><b>${esc(pct(s.loadedPct))}</b><span>${esc(L('yüklendi','loaded'))}</span></div>
      <div><b class="is-overdue">${n(s.overdueQty)}</b><span>${esc(L('Ex-F geçti · yüklenmedi','Ex-F passed · not loaded'))}</span></div>
    </div>
    <div class="bpaBar bpaDrawerBar">${R().STAGES.filter(x=>s.stages[x.key]>0).map(x=>`<span class="bpaSeg" data-stage="${x.key}" style="flex-grow:${s.stages[x.key]}" title="${esc(stageLabel(x.key)+': '+n(s.stages[x.key]))}"></span>`).join('')}</div>
    <div class="bpaTableWrap bpaDrawerTable"><table class="bpaTable"><thead><tr><th>${esc(L('Aşama','Stage'))}</th><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th class="num">${esc(L('Adet','Qty'))}</th><th>Ex-Factory</th><th>${esc(L('Antrepo','Warehouse'))}</th><th>Retail</th><th>${esc(L('Sinyal','Signal'))}</th></tr></thead><tbody>${rows}</tbody></table>${list.length>ROW_LIMIT?`<div class="bpaNote">${esc(L(`İlk ${ROW_LIMIT} satır gösteriliyor; tamamı Excel Backlog V3'te.`,`Showing first ${ROW_LIMIT} rows; Excel Backlog V3 contains all.`))}</div>`:''}</div>`;
  root.hidden=false;requestAnimationFrame(()=>root.classList.add('is-open'));
  aside.querySelector('[data-blv-close]')?.focus();
}

/* ------------------------------------------------------------- bağlar */
function setOpen(value){
  state.open=value;saveState();
  const mod=$('backlogOverview'),body=$('backlogOverviewBody'),toggle=$('backlogOverviewToggle');
  mod?.classList.toggle('is-open',value);if(body)body.hidden=!value;
  toggle?.setAttribute('aria-expanded',value?'true':'false');
  if(value)void refresh(false);else{closeDrawer();render();}
}
function bind(){
  if(bound)return;const host=$('backlogOverviewBody');if(!host)return;bound=true;
  $('backlogOverviewToggle')?.addEventListener('click',()=>setOpen(!state.open));
  $('backlogOverviewRefresh')?.addEventListener('click',e=>{e.stopPropagation();void refresh(true);});
  host.addEventListener('click',e=>{
    const t=e.target.closest('[data-blv-open],[data-blv-group],[data-blv-scale],[data-blv-time],[data-blv-gran],[data-blv-action]');
    if(!t||!host.contains(t))return;
    if(t.dataset.blvGroup){state.groupBy=t.dataset.blvGroup;state.showAll=false;saveState();return render();}
    if(t.dataset.blvScale){state.barScale=t.dataset.blvScale;saveState();return render();}
    if(t.dataset.blvTime){state.timeField=t.dataset.blvTime;saveState();return render();}
    if(t.dataset.blvGran){state.granularity=t.dataset.blvGran;saveState();return render();}
    if(t.dataset.blvAction==='toggleAll'){state.showAll=!state.showAll;saveState();return render();}
    if(t.dataset.blvOpen)openDrawer(openers.get(t.dataset.blvOpen));
  });
  host.addEventListener('mousemove',moveTip);
  host.addEventListener('mouseleave',hideTip);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
  document.addEventListener('bl:language-changed',()=>render());
}
function init(){
  bind();
  const mod=$('backlogOverview');
  if(mod){mod.classList.toggle('is-open',!!state.open);const body=$('backlogOverviewBody');if(body)body.hidden=!state.open;$('backlogOverviewToggle')?.setAttribute('aria-expanded',state.open?'true':'false');}
  render();
  // Görünmeyen modül çizilmez (perf-runtime sözleşmesi): Backlog sekmesi
  // görünür olduğunda bekleyen yenileme burada tetiklenir.
  if(mod&&'IntersectionObserver' in window){
    new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&state.open&&!loading&&(!items||signature!==JSON.stringify(queryParams()||{})))void refresh(false);}).observe(mod);
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();

/* Excel Backlog V3 seçenekleri ve kırılım tercihi app-main'deki dışa aktarım
   akışına buradan verilir. */
window.BLBacklogOverview={
  onBacklogRendered,refresh:()=>refresh(true),
  exportOptions:()=>({includePlanActual:state.exportPlanActual!==false,includeLegacy:state.exportLegacy!==false,groupBy:state.groupBy}),
  setExportOption:(key,value)=>{if(key==='includePlanActual')state.exportPlanActual=!!value;if(key==='includeLegacy')state.exportLegacy=!!value;saveState();},
};
})();
