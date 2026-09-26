(function(){
'use strict';

const STORAGE_KEY='lcw.backlog.planactual.v1';
const POSITIONS=4;
const $=id=>document.getElementById(id);
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const lang=()=>document.documentElement.lang==='en'?'en':'tr';
const L=(tr,en)=>lang()==='en'?en:tr;
const nf=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:0});
const shortDate=new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
let state=loadState();
let data=null,loading=false,error='',bound=false;

function mondayAnchor(reference){
  const d=new Date(reference||Date.now());
  d.setSeconds(0,0);
  const day=d.getDay();
  const back=(day+6)%7;
  d.setDate(d.getDate()-back);
  d.setHours(10,0,0,0);
  if(d.getTime()>Date.now())d.setDate(d.getDate()-7);
  return d;
}
function inputValue(date){
  const d=new Date(date),p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function defaultRange(){
  const end=mondayAnchor(),start=new Date(end);start.setDate(start.getDate()-7);
  return {from:inputValue(start),to:inputValue(end)};
}
function loadState(){
  const defaults={open:false,preset:'prevWeek',agenda:'all',breakdown:'buyer',position:2,filters:{buyer:'',buyingGroup:'',manufacturer:'',season:'',mag:'',mmyg:''},...defaultRange()};
  try{
    const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'null');
    if(raw&&typeof raw==='object')return {...defaults,...raw,filters:{...defaults.filters,...(raw.filters||{})},position:Math.max(0,Math.min(POSITIONS-1,Number(raw.position)||0))};
  }catch(_){}
  return defaults;
}
function saveState(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
function applyPreset(preset){
  if(preset==='prevWeek'){
    const end=mondayAnchor(),start=new Date(end);start.setDate(start.getDate()-7);
    state.from=inputValue(start);state.to=inputValue(end);
  }else if(preset==='currentWeek'){
    const start=mondayAnchor(),end=new Date();
    state.from=inputValue(start);state.to=inputValue(end);
  }
}
function fmtDate(value){
  if(!value)return '—';
  const d=new Date(value);return Number.isNaN(d.getTime())?String(value):shortDate.format(d);
}
function fmtDay(value){
  if(!value)return '—';
  const raw=String(value);
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return `${m[3]}.${m[2]}.${m[1]}`;
  return raw;
}
function n(value){return nf.format(Number(value)||0)}
function rangeIso(){
  const from=new Date(state.from),to=new Date(state.to);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to)return null;
  return {from:from.toISOString(),to:to.toISOString()};
}
function moduleEl(){return $('backlogPlanActualModule')}
function positionModule(){
  const mod=moduleEl(),parent=$('backlogContent');if(!mod||!parent)return;
  const pos=Math.max(0,Math.min(POSITIONS-1,Number(state.position)||0));
  const kpi=$('backlogKpi'),chart=$('backlogChartPanel'),delivery=$('backlogAnalysis');
  const tree=[...parent.children].find(el=>el.classList&&el.classList.contains('panel')&&el!==mod&&el.id!=='backlogChartPanel');
  if(pos===0&&kpi)kpi.insertAdjacentElement('afterend',mod);
  else if(pos===1&&chart)chart.insertAdjacentElement('afterend',mod);
  else if(pos===2&&delivery)delivery.insertAdjacentElement('afterend',mod);
  else if(tree)tree.insertAdjacentElement('afterend',mod);
  syncMoveButtons();
}
function move(delta){
  state.position=Math.max(0,Math.min(POSITIONS-1,(Number(state.position)||0)+delta));
  saveState();positionModule();
}
function syncMoveButtons(){
  const up=$('backlogPlanActualMoveUp'),down=$('backlogPlanActualMoveDown');
  if(up)up.disabled=state.position<=0;
  if(down)down.disabled=state.position>=POSITIONS-1;
}
function openModule(value){
  state.open=value;saveState();
  const host=$('backlogPlanActual'),mod=moduleEl(),toggle=$('backlogPlanActualToggle');
  if(host)host.hidden=!value;
  if(mod)mod.classList.toggle('is-open',value);
  if(toggle)toggle.setAttribute('aria-expanded',value?'true':'false');
  if(value&&!data&&!loading)void refresh();
}
async function refresh(){
  const range=rangeIso();
  if(!range){error=L('Geçerli bir başlangıç ve bitiş zamanı seçin.','Choose a valid start and end time.');render();return;}
  loading=true;error='';render();
  try{
    const params=new URLSearchParams({from:range.from,to:range.to});
    const res=await fetch('/api/backlog-plan-actual?'+params.toString(),{cache:'no-store',credentials:'same-origin'});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||L('Analiz alınamadı.','Analysis could not be loaded.'));
    data=body;hydrateFilterValidity();error='';
  }catch(err){error=String(err&&err.message||err);data=null;}
  finally{loading=false;render();}
}
function hydrateFilterValidity(){
  if(!data||!data.catalogs)return;
  for(const key of Object.keys(state.filters)){
    const value=state.filters[key];
    if(value&&!(data.catalogs[key]||[]).includes(value))state.filters[key]='';
  }
  saveState();
}
function matchDims(row){
  return Object.entries(state.filters).every(([key,value])=>!value||String(row&&row[key]||'')===value);
}
function matchAgenda(row){
  if(state.agenda==='all')return true;
  if(state.agenda==='instability')return Boolean(row&&row.repeatedRevision);
  return Array.isArray(row&&row.categories)&&row.categories.includes(state.agenda);
}
function visibleChanges(){return (data&&Array.isArray(data.changes)?data.changes:[]).filter(row=>matchDims(row)&&matchAgenda(row))}
function visibleActivity(){
  const list=data&&Array.isArray(data.activity)?data.activity:[];
  return list.filter(row=>matchDims(row)&&(state.agenda==='all'||state.agenda==='instability'?(state.agenda!=='instability'||row.repeated):row.category===state.agenda));
}
function selectOptions(key){
  const list=data&&data.catalogs&&Array.isArray(data.catalogs[key])?data.catalogs[key]:[];
  return '<option value="">'+esc(L('Tümü','All'))+'</option>'+list.map(v=>`<option value="${esc(v)}"${state.filters[key]===v?' selected':''}>${esc(v)}</option>`).join('');
}
function controls(){
  const custom=state.preset==='custom';
  return `<div class="bpaControls">
    <label class="bpaControl"><span>${esc(L('Dönem','Period'))}</span><select data-bpa-control="preset">
      <option value="prevWeek"${state.preset==='prevWeek'?' selected':''}>${esc(L('Önceki hafta · Pzt 10:00','Previous week · Mon 10:00'))}</option>
      <option value="currentWeek"${state.preset==='currentWeek'?' selected':''}>${esc(L('Bu hafta · Pzt 10:00 → şimdi','This week · Mon 10:00 → now'))}</option>
      <option value="custom"${state.preset==='custom'?' selected':''}>${esc(L('Özel aralık','Custom range'))}</option>
    </select></label>
    <label class="bpaControl bpaControl--wide"><span>${esc(L('Başlangıç','Start'))}</span><input type="datetime-local" data-bpa-control="from" value="${esc(state.from)}"${custom?'':' readonly'}></label>
    <label class="bpaControl bpaControl--wide"><span>${esc(L('Bitiş','End'))}</span><input type="datetime-local" data-bpa-control="to" value="${esc(state.to)}"${custom?'':' readonly'}></label>
    <label class="bpaControl"><span>${esc(L('Gündem','Agenda'))}</span><select data-bpa-control="agenda">
      ${[['all',L('Tüm değişiklikler','All changes')],['exfactory','Ex-Factory / Handover'],['status',L('Statü','Status')],['eta',L('Antrepo ETA','Warehouse ETA')],['quantity',L('Miktar','Quantity')],['dates',L('Diğer tarihler','Other dates')],['instability',L('Çok revize edilenler','Frequently revised')]].map(([v,l])=>`<option value="${v}"${state.agenda===v?' selected':''}>${esc(l)}</option>`).join('')}
    </select></label>
    <label class="bpaControl"><span>Buyer</span><select data-bpa-filter="buyer">${selectOptions('buyer')}</select></label>
    <label class="bpaControl"><span>Buyer Group</span><select data-bpa-filter="buyingGroup">${selectOptions('buyingGroup')}</select></label>
    <label class="bpaControl"><span>${esc(L('Üretici','Manufacturer'))}</span><select data-bpa-filter="manufacturer">${selectOptions('manufacturer')}</select></label>
    <label class="bpaControl"><span>${esc(L('Sezon','Season'))}</span><select data-bpa-filter="season">${selectOptions('season')}</select></label>
    <label class="bpaControl"><span>MAG</span><select data-bpa-filter="mag">${selectOptions('mag')}</select></label>
    <label class="bpaControl"><span>MMYG</span><select data-bpa-filter="mmyg">${selectOptions('mmyg')}</select></label>
    <button type="button" class="tbtn bpaRefresh" data-bpa-action="refresh"><svg class="ic"><use href="#i-refresh"/></svg><span>${esc(L('Analiz et','Analyse'))}</span></button>
  </div>`;
}
function snapshotBar(){
  if(!data||!data.resolved||!data.resolved.start||!data.resolved.end)return '';
  const req=data.requested||{},start=data.resolved.start,end=data.resolved.end,coverage=data.coverage||{};
  const reqStart=Date.parse(req.from||''),usedStart=Date.parse(start.capturedAt||''),reqEnd=Date.parse(req.to||''),usedEnd=Date.parse(end.capturedAt||'');
  const driftStart=Number.isFinite(reqStart)&&Number.isFinite(usedStart)?Math.round((usedStart-reqStart)/60000):0;
  const driftEnd=Number.isFinite(reqEnd)&&Number.isFinite(usedEnd)?Math.round((usedEnd-reqEnd)/60000):0;
  const warn=Math.abs(driftStart)>5||Math.abs(driftEnd)>5;
  const offset=m=>m===0?'':` (${m>0?'+':''}${m} dk)`;
  return `<div class="bpaSnapshotBar">
    <span>${esc(L('Kullanılan snapshotlar','Snapshots used'))}:</span>
    <span class="bpaSnapshotPoint">${esc(fmtDate(start.capturedAt)+offset(driftStart))}</span>
    <span class="bpaSnapshotArrow">→</span>
    <span class="bpaSnapshotPoint">${esc(fmtDate(end.capturedAt)+offset(driftEnd))}</span>
    <span>· ${esc(L('kapsam','coverage'))}: ${esc(coverage.from?fmtDate(coverage.from):'—')} → ${esc(coverage.to?fmtDate(coverage.to):'—')} · ${n(coverage.snapshotCount||0)} snapshot</span>
    ${warn?`<span class="bpaCoverageWarn">${esc(L('Seçilen saate birebir snapshot yok; en yakın mevcut zaman işareti kullanıldı.','No exact snapshot exists for the selected time; the nearest available marker was used.'))}</span>`:''}
  </div>`;
}
function subsetSummary(rows){
  const out={changed:rows.length,delayed:0,advanced:0,status:0,etaDelayed:0,planned:0,realized:0,late:0,loaded:0,repeated:0,reverted:0};
  rows.forEach(row=>{
    out.planned+=Number(row.plannedQty)||0;out.realized+=Number(row.realizedPlannedQty)||0;out.late+=Number(row.lateQty)||0;out.loaded+=Number(row.loadedQty)||0;
    if(row.repeatedRevision)out.repeated+=1;if(row.revertedRevision)out.reverted+=1;
    (row.fields||[]).forEach(field=>{
      if(field.label==='Planlanan Ex-Factory'){if(Number(field.days)>0)out.delayed+=1;if(Number(field.days)<0)out.advanced+=1;}
      if(field.category==='status')out.status+=1;
      if(field.category==='eta'&&Number(field.days)>0)out.etaDelayed+=1;
    });
  });
  out.gap=Math.max(0,out.planned-out.realized);return out;
}
function cards(rows){
  const s=subsetSummary(rows);
  const card=(value,label,tone='')=>`<div class="bpaCard"${tone?` data-tone="${tone}"`:''}><div class="bpaCardValue">${esc(value)}</div><div class="bpaCardLabel">${esc(label)}</div></div>`;
  return `<div class="bpaCards">
    ${card(n(s.changed),L('Değişen sipariş / model-renk','Changed order / model-colour'))}
    ${card(n(s.planned),L('Bu aralıkta planlanan adet','Qty planned in this period'))}
    ${card(n(s.realized),L('Planı gerçekleşen adet','Planned qty realised'),'good')}
    ${card(n(s.gap),L('Plan açığı','Plan gap'),s.gap?'bad':'')}
    ${card(n(s.late),L('Plan tarihinden geç yüklenen','Loaded after planned date'),s.late?'bad':'')}
    ${card(n(s.delayed),L('Ex-Factory ileri ötelenen','Ex-Factory pushed later'),s.delayed?'bad':'')}
    ${card(n(s.etaDelayed),L('Antrepo ETA ileri ötelenen','Warehouse ETA pushed later'),s.etaDelayed?'bad':'')}
    ${card(n(s.repeated),L('Birden fazla revize edilen','Revised more than once'),s.repeated?'bad':'')}
  </div>`;
}
function dayBadge(field){
  if(!Number.isFinite(Number(field.days))||Number(field.days)===0)return '';
  const d=Number(field.days),cls=d>0?'is-late':'is-early';
  return `<span class="bpaDayDelta ${cls}">${d>0?'+':''}${d} ${esc(L('gün','days'))}</span>`;
}
function fieldHtml(field){
  const before=field.category==='exfactory'||field.category==='dates'?fmtDay(field.before):field.before;
  const after=field.category==='exfactory'||field.category==='dates'?fmtDay(field.after):field.after;
  return `<div class="bpaField"><span class="bpaFieldName">${esc(field.label)}${dayBadge(field)}</span><span class="bpaBefore">${esc(before||'—')}</span><span class="bpaArrow">→</span><span class="bpaAfter">${esc(after||'—')}</span></div>`;
}
function changesSection(rows){
  const body=rows.map(row=>{
    const tags=[];
    if(row.lateQty>0)tags.push(`<span class="bpaTag is-alert">${n(row.lateQty)} ${esc(L('adet geç yükleme','late-loaded'))}</span>`);
    if(row.repeatedRevision)tags.push(`<span class="bpaTag is-alert">${esc(L('çoklu revizyon','multiple revisions'))}</span>`);
    if(row.revertedRevision)tags.push(`<span class="bpaTag">${esc(L('geri alınan değişiklik','reverted change'))}</span>`);
    return `<tr>
      <td><div class="bpaIdentity">${esc(row.orderCode||'—')}<small>${esc([row.modelName,row.colourCode,row.colour].filter(Boolean).join(' · '))}</small></div></td>
      <td>${esc([row.buyer,row.buyingGroup].filter(Boolean).join(' · ')||'—')}</td>
      <td>${esc([row.manufacturer,row.season].filter(Boolean).join(' · ')||'—')}</td>
      <td><div class="bpaFieldList">${(row.fields||[]).length?(row.fields||[]).map(fieldHtml).join(''):`<span>${esc(L('Net fark yok; dönem içinde değişiklik trafiği var.','No net difference; there was change activity during the period.'))}</span>`}</div></td>
      <td><div class="bpaTags">${tags.join('')}</div></td>
    </tr>`;
  }).join('');
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Net değişiklikler','Net changes'))}</span><span class="bpaSectionSub">${n(rows.length)} ${esc(L('kayıt · değişmeyen Backlog satırları gösterilmez','records · unchanged Backlog rows are hidden'))}</span></div>
    ${rows.length?`<div class="bpaTableWrap"><table class="bpaTable"><thead><tr><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th>${esc(L('Başlangıç → Bitiş','Start → End'))}</th><th>${esc(L('Sinyal','Signal'))}</th></tr></thead><tbody>${body}</tbody></table></div>`:`<div class="bpaEmpty">${esc(L('Seçili kapsamda net değişiklik yok.','No net changes in the selected scope.'))}</div>`}
  </div>`;
}
function activitySection(list){
  const rows=list.map(item=>`<tr>
    <td><div class="bpaIdentity">${esc(item.orderCode||'—')}<small>${esc([item.modelName,item.colourCode].filter(Boolean).join(' · '))}</small></div></td>
    <td>${esc(item.field)}</td><td>${n(item.eventCount)}</td>
    <td>${esc(item.firstBefore||'—')} → ${esc(item.lastAfter||'—')}<div class="bpaActivityPath">${esc(fmtDate(item.firstAt))} → ${esc(fmtDate(item.lastAt))}</div></td>
    <td><div class="bpaTags">${item.repeated?`<span class="bpaTag is-alert">${esc(L('tekrar revize','revised repeatedly'))}</span>`:''}${item.reverted?`<span class="bpaTag">${esc(L('başlangıca döndü','returned to start'))}</span>`:''}</div></td>
  </tr>`).join('');
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Dönem içi değişiklik trafiği','Change activity during the period'))}</span><span class="bpaSectionSub">${esc(L('Net farktan bağımsız; ara revizyonları da gösterir.','Independent of net difference; intermediate revisions are retained.'))}</span></div>
    ${list.length?`<div class="bpaTableWrap"><table class="bpaTable"><thead><tr><th>${esc(L('Sipariş','Order'))}</th><th>${esc(L('Alan','Field'))}</th><th>${esc(L('Revizyon','Revisions'))}</th><th>${esc(L('İlk → Son','First → Last'))}</th><th>${esc(L('Not','Note'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="bpaEmpty">${esc(L('Seçili kapsamda ara revizyon kaydı yok.','No intermediate revision activity in the selected scope.'))}</div>`}
  </div>`;
}
function breakdownSection(rows){
  const key=state.breakdown||'buyer',groups=new Map();
  rows.forEach(row=>{
    const name=String(row[key]||L('(boş)','(blank)'));
    if(!groups.has(name))groups.set(name,{name,orders:0,late:0,activity:0});
    const g=groups.get(name);g.orders+=1;g.late+=Number(row.lateQty)||0;g.activity+=Number(row.activityCount)||0;
  });
  const list=[...groups.values()].sort((a,b)=>b.orders-a.orders||b.late-a.late).slice(0,30);
  const labels={buyer:'Buyer',buyingGroup:'Buyer Group',manufacturer:L('Üretici','Manufacturer'),season:L('Sezon','Season'),mag:'MAG',mmyg:'MMYG'};
  const cells=list.map(g=>`<div>${esc(g.name)}</div><div>${n(g.orders)}</div><div class="bpaOptional">${n(g.late)}</div><div class="bpaOptional">${n(g.activity)}</div>`).join('');
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Kırılım','Breakdown'))}</span><span class="bpaSectionSpacer"></span><select class="bpaMiniSelect" data-bpa-control="breakdown">${Object.entries(labels).map(([v,l])=>`<option value="${v}"${key===v?' selected':''}>${esc(l)}</option>`).join('')}</select></div>
    ${list.length?`<div class="bpaBreakdown"><div class="bpaBreakdownHead">${esc(labels[key]||key)}</div><div class="bpaBreakdownHead">${esc(L('Değişen','Changed'))}</div><div class="bpaBreakdownHead bpaOptional">${esc(L('Geç yüklenen adet','Late-loaded qty'))}</div><div class="bpaBreakdownHead bpaOptional">${esc(L('Revizyon hareketi','Revision activity'))}</div>${cells}</div>`:`<div class="bpaEmpty">${esc(L('Kırılım için veri yok.','No data for breakdown.'))}</div>`}
  </div>`;
}
function render(){
  const host=$('backlogPlanActual');if(!host||!state.open)return;
  if(loading){host.innerHTML=controls()+'<div class="bpaLoading">'+esc(L('Snapshotlar karşılaştırılıyor…','Comparing snapshots…'))+'</div>';bindInside(host);return;}
  if(error){host.innerHTML=controls()+'<div class="bpaError">'+esc(error)+'</div>';bindInside(host);return;}
  if(!data){host.innerHTML=controls()+'<div class="bpaEmpty">'+esc(L('Bir dönem seçip Analiz et düğmesine basın.','Choose a period and click Analyse.'))+'</div>';bindInside(host);return;}
  if(!data.resolved||!data.resolved.start||!data.resolved.end){
    host.innerHTML=controls()+`<div class="bpaEmpty">${esc(data.message||L('Henüz karşılaştırılabilir snapshot yok. Bir sonraki veri yenilemelerinden itibaren geçmiş birikmeye başlayacak.','There is no comparable snapshot yet. History will start accumulating from the next data refreshes.'))}</div>`;bindInside(host);return;
  }
  const rows=visibleChanges(),activity=visibleActivity();
  host.innerHTML=controls()+snapshotBar()+cards(rows)+changesSection(rows)+activitySection(activity)+breakdownSection(rows);
  bindInside(host);
}
function bindInside(host){
  host.querySelectorAll('[data-bpa-control]').forEach(el=>el.addEventListener('change',()=>{
    const key=el.dataset.bpaControl;
    if(key==='preset'){state.preset=el.value;applyPreset(state.preset);saveState();render();if(state.preset!=='custom')void refresh();return;}
    if(key==='from'||key==='to'){state[key]=el.value;state.preset='custom';}
    else if(key==='agenda')state.agenda=el.value;
    else if(key==='breakdown')state.breakdown=el.value;
    saveState();render();
  }));
  host.querySelectorAll('[data-bpa-filter]').forEach(el=>el.addEventListener('change',()=>{state.filters[el.dataset.bpaFilter]=el.value;saveState();render();}));
  host.querySelectorAll('[data-bpa-action="refresh"]').forEach(el=>el.addEventListener('click',()=>void refresh()));
}
function bindShell(){
  if(bound)return;bound=true;
  $('backlogPlanActualToggle')?.addEventListener('click',()=>openModule(!state.open));
  $('backlogPlanActualMoveUp')?.addEventListener('click',e=>{e.stopPropagation();move(-1)});
  $('backlogPlanActualMoveDown')?.addEventListener('click',e=>{e.stopPropagation();move(1)});
  // Başlık sürüklenebilir; bırakılan dikey konuma göre dört güvenli slot seçilir.
  const head=$('backlogPlanActualHead');
  if(head){
    head.draggable=true;
    head.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','backlog-plan-actual');moduleEl()?.classList.add('is-dragging')});
    head.addEventListener('dragend',e=>{
      moduleEl()?.classList.remove('is-dragging');
      const parent=$('backlogContent');if(!parent)return;
      const rect=parent.getBoundingClientRect(),ratio=Math.max(0,Math.min(0.999,(e.clientY-rect.top)/Math.max(1,rect.height)));
      state.position=Math.max(0,Math.min(POSITIONS-1,Math.floor(ratio*POSITIONS)));saveState();positionModule();
    });
  }
}
function init(){
  bindShell();positionModule();openModule(Boolean(state.open));
  document.addEventListener('bl:language-changed',()=>{if(state.open)render()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.BLBacklogPlanActual={refresh:()=>refresh(),open:()=>openModule(true),close:()=>openModule(false)};
})();