(function(){
'use strict';

/* Planlanan & Gerçekleşen paneli.
   İş gerçeği /api/backlog-plan-actual'dan gelir (snapshot farkı + plan
   penceresi satırları). Segment/kırılım hesapları ve Excel yazıcısı
   BLPlanActualReport'tadır; panel yalnız filtreler, çizer ve etkileşim kurar. */
const STORAGE_KEY='lcw.backlog.planactual.v1';
const POSITIONS=4;
const ROW_LIMIT=400;
const $=id=>document.getElementById(id);
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const lang=()=>document.documentElement.lang==='en'?'en':'tr';
const L=(tr,en)=>lang()==='en'?en:tr;
const nf=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:0});
const pf=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:1,minimumFractionDigits:0});
const shortDate=new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const Report=()=>window.BLPlanActualReport;
let state=loadState();
let data=null,loading=false,exporting=false,error='',bound=false;
// Tooltip ve detay paneli içerikleri her render'da yeniden kurulan kayıtlardan okunur.
let tips=new Map(),openers=new Map(),seq=0;

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
function dayValue(date){return inputValue(date).slice(0,10)}
function defaultRange(){
  const end=mondayAnchor(),start=new Date(end);start.setDate(start.getDate()-7);
  return {from:inputValue(start),to:inputValue(end)};
}
function loadState(){
  const defaults={open:false,preset:'prevWeek',agenda:'all',breakdown:'buyer',position:2,
    tab:'overview',planMode:'period',planFrom:'',planTo:'',groupBy:'buyer',barScale:'pct',outcome:'all',scope:'all',showAllGroups:false,
    filters:{buyer:'',buyingGroup:'',manufacturer:'',season:'',mag:'',mmyg:'',productMainDefinition:''},...defaultRange()};
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
/* Plan penceresi: "bu aralıkta yüklenmesi planlananlar". Analiz döneminden
   bağımsız seçilebilir; tarihi geçmiş kararı analiz bitiş günüyle verilir. */
function planWindow(){
  const mode=state.planMode,now=new Date(),dimension=window.BLDateDimension;
  if(mode==='custom'&&/^\d{4}-\d{2}-\d{2}$/.test(state.planFrom)&&/^\d{4}-\d{2}-\d{2}$/.test(state.planTo)&&state.planFrom<=state.planTo)return {from:state.planFrom,to:state.planTo};
  if(mode==='thisWeek'){const s=new Date(now);s.setDate(s.getDate()-((s.getDay()+6)%7));const e=new Date(s);e.setDate(e.getDate()+6);return {from:dayValue(s),to:dayValue(e)};}
  if(mode==='thisMonth'){
    const merch=dimension?.businessMonthRange?.(now);
    if(merch)return {from:merch.start,to:merch.end};
    if(dimension?.hasMerchCalendar?.())return {from:'',to:''};
    const s=new Date(now.getFullYear(),now.getMonth(),1),e=new Date(now.getFullYear(),now.getMonth()+1,0);return {from:dayValue(s),to:dayValue(e)};
  }
  if(mode==='lastMonth'){
    const merch=dimension?.previousBusinessMonthRange?.(now);
    if(merch)return {from:merch.start,to:merch.end};
    if(dimension?.hasMerchCalendar?.())return {from:'',to:''};
    const s=new Date(now.getFullYear(),now.getMonth()-1,1),e=new Date(now.getFullYear(),now.getMonth(),0);return {from:dayValue(s),to:dayValue(e)};
  }
  return {from:String(state.from||'').slice(0,10),to:String(state.to||'').slice(0,10)};
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
function fmtShortDay(value){const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}`:String(value||'—')}
function n(value){return nf.format(Number(value)||0)}
function pct(value){return value==null||!Number.isFinite(value)?'—':'%'+pf.format(value*100)}
function rangeIso(){
  const from=new Date(state.from),to=new Date(state.to);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to)return null;
  return {from:from.toISOString(),to:to.toISOString()};
}
function segLabel(seg){return lang()==='en'?seg.en:seg.tr}
function segments(){return Report()?Report().SEGMENTS:[]}
function moduleEl(){return $('backlogPlanActualModule')}
function positionModule(){
  const mod=moduleEl(),parent=$('backlogContent');if(!mod||!parent)return;
  const pos=Math.max(0,Math.min(POSITIONS-1,Number(state.position)||0));
  const kpi=$('backlogOverview')||$('backlogKpi'),chart=$('backlogChartPanel'),delivery=$('backlogAnalysis');
  const tree=[...parent.children].find(el=>el.classList&&el.classList.contains('panel')&&el!==mod&&el.id!=='backlogChartPanel'&&el.id!=='backlogOverview');
  if(pos===0&&kpi)kpi.insertAdjacentElement('afterend',mod);
  else if(pos===1&&(chart||kpi))(chart||kpi).insertAdjacentElement('afterend',mod);
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
  if(!value)closeDrawer();
  if(value&&!data&&!loading)void refresh();
}
async function refresh(){
  const range=rangeIso();
  if(!range){error=L('Geçerli bir başlangıç ve bitiş zamanı seçin.','Choose a valid start and end time.');render();return;}
  loading=true;error='';render();
  try{
    const win=planWindow();
    const params=new URLSearchParams({from:range.from,to:range.to,planFrom:win.from,planTo:win.to,asOf:String(state.to||'').slice(0,10)});
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
function planIds(){return new Set(visiblePlan().map(row=>row.id))}
function matchScope(row,ids){return state.scope!=='plan'||Boolean(row&&(row.inPlanWindow||ids.has(row.id||row.lineId)))}
function visibleChanges(){
  const ids=state.scope==='plan'?planIds():null;
  return (data&&Array.isArray(data.changes)?data.changes:[]).filter(row=>matchDims(row)&&matchAgenda(row)&&matchScope(row,ids));
}
function visibleActivity(){
  const list=data&&Array.isArray(data.activity)?data.activity:[];
  const ids=state.scope==='plan'?new Set([...planIds(),...(data.changes||[]).filter(row=>row.inPlanWindow).map(row=>row.id)]):null;
  return list.filter(row=>matchDims(row)&&(state.agenda==='all'||state.agenda==='instability'?(state.agenda!=='instability'||row.repeated):row.category===state.agenda)&&(!ids||ids.has(row.lineId)));
}
function visiblePlan(){return (data&&data.plan&&Array.isArray(data.plan.rows)?data.plan.rows:[]).filter(matchDims)}
function selectOptions(key){
  const list=data&&data.catalogs&&Array.isArray(data.catalogs[key])?data.catalogs[key]:[];
  return '<option value="">'+esc(L('Tümü','All'))+'</option>'+list.map(v=>`<option value="${esc(v)}"${state.filters[key]===v?' selected':''}>${esc(v)}</option>`).join('');
}
function controls(){
  const custom=state.preset==='custom',planCustom=state.planMode==='custom',win=planWindow();
  const planOpts=[['period',L('Analiz dönemi ile aynı','Same as analysis period')],['thisWeek',L('Bu hafta (Pzt–Paz)','This week (Mon–Sun)')],['thisMonth',L('Bu ay','This month')],['lastMonth',L('Geçen ay','Last month')],['custom',L('Özel tarih aralığı','Custom date range')]];
  return `<div class="bpaControls">
    <div class="bpaControlGroup">
    <span class="bpaGroupLabel">${esc(L('Karşılaştırma','Comparison'))}</span>
    <label class="bpaControl"><span>${esc(L('Dönem','Period'))}</span><select data-bpa-control="preset">
      <option value="prevWeek"${state.preset==='prevWeek'?' selected':''}>${esc(L('Önceki hafta · Pzt 10:00','Previous week · Mon 10:00'))}</option>
      <option value="currentWeek"${state.preset==='currentWeek'?' selected':''}>${esc(L('Bu hafta · Pzt 10:00 → şimdi','This week · Mon 10:00 → now'))}</option>
      <option value="custom"${state.preset==='custom'?' selected':''}>${esc(L('Özel aralık','Custom range'))}</option>
    </select></label>
    <label class="bpaControl bpaControl--wide"><span>${esc(L('Başlangıç','Start'))}</span><input type="datetime-local" data-bpa-control="from" value="${esc(state.from)}"${custom?'':' readonly'}></label>
    <label class="bpaControl bpaControl--wide"><span>${esc(L('Bitiş','End'))}</span><input type="datetime-local" data-bpa-control="to" value="${esc(state.to)}"${custom?'':' readonly'}></label>
    </div>
    <div class="bpaControlGroup bpaControlGroup--plan">
    <span class="bpaGroupLabel">${esc(L('Plan penceresi · yüklenmesi planlananlar','Plan window · planned to load'))}</span>
    <label class="bpaControl"><span>${esc(L('Plan Ex-Factory aralığı','Planned Ex-Factory range'))}</span><select data-bpa-control="planMode">${planOpts.map(([v,l])=>`<option value="${v}"${state.planMode===v?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="bpaControl"><span>${esc(L('Plan başlangıç','Plan from'))}</span><input type="date" data-bpa-control="planFrom" value="${esc(win.from)}"${planCustom?'':' readonly'}></label>
    <label class="bpaControl"><span>${esc(L('Plan bitiş','Plan to'))}</span><input type="date" data-bpa-control="planTo" value="${esc(win.to)}"${planCustom?'':' readonly'}></label>
    </div>
    <div class="bpaControlGroup bpaControlGroup--filters">
    <span class="bpaGroupLabel">${esc(L('Filtreler','Filters'))}</span>
    <label class="bpaControl"><span>${esc(L('Gündem','Agenda'))}</span><select data-bpa-control="agenda">
      ${[['all',L('Tüm değişiklikler','All changes')],['exfactory','Ex-Factory / Handover'],['status',L('Statü','Status')],['eta',L('Antrepo ETA','Warehouse ETA')],['quantity',L('Miktar','Quantity')],['dates',L('Diğer tarihler','Other dates')],['instability',L('Çok revize edilenler','Frequently revised')]].map(([v,l])=>`<option value="${v}"${state.agenda===v?' selected':''}>${esc(l)}</option>`).join('')}
    </select></label>
    <label class="bpaControl"><span>${esc(L('Kapsam','Scope'))}</span><select data-bpa-control="scope">
      <option value="all"${state.scope!=='plan'?' selected':''}>${esc(L('Tüm Backlog','Entire Backlog'))}</option>
      <option value="plan"${state.scope==='plan'?' selected':''}>${esc(L('Yalnız plan penceresindekiler','Plan window only'))}</option>
    </select></label>
    <label class="bpaControl"><span>Buyer</span><select data-bpa-filter="buyer">${selectOptions('buyer')}</select></label>
    <label class="bpaControl"><span>Buyer Group</span><select data-bpa-filter="buyingGroup">${selectOptions('buyingGroup')}</select></label>
    <label class="bpaControl"><span>${esc(L('Üretici','Manufacturer'))}</span><select data-bpa-filter="manufacturer">${selectOptions('manufacturer')}</select></label>
    <label class="bpaControl"><span>${esc(L('Sezon','Season'))}</span><select data-bpa-filter="season">${selectOptions('season')}</select></label>
    <label class="bpaControl"><span>MAG</span><select data-bpa-filter="mag">${selectOptions('mag')}</select></label>
    <label class="bpaControl"><span>MMYG</span><select data-bpa-filter="mmyg">${selectOptions('mmyg')}</select></label>
    <label class="bpaControl"><span>${esc(L('Ürün Ana Tanım','Product Main Definition'))}</span><select data-bpa-filter="productMainDefinition">${selectOptions('productMainDefinition')}</select></label>
    </div>
    <div class="bpaActions">
      <button type="button" class="tbtn bpaRefresh" data-bpa-action="refresh"><svg class="ic"><use href="#i-refresh"/></svg><span>${esc(L('Analiz et','Analyse'))}</span></button>
      <button type="button" class="tbtn bpaExport" data-bpa-action="export"${data&&data.resolved&&data.resolved.start&&!exporting?'':' disabled'}><svg class="ic"><use href="#i-download"/></svg><span>${esc(exporting?L('Hazırlanıyor…','Preparing…'):L("Excel'e aktar",'Export to Excel'))}</span></button>
    </div>
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
  const win=data.plan&&data.plan.window||{};
  return `<div class="bpaSnapshotBar">
    <span>${esc(L('Kullanılan snapshotlar','Snapshots used'))}:</span>
    <span class="bpaSnapshotPoint">${esc(fmtDate(start.capturedAt)+offset(driftStart))}</span>
    <span class="bpaSnapshotArrow">→</span>
    <span class="bpaSnapshotPoint">${esc(fmtDate(end.capturedAt)+offset(driftEnd))}</span>
    <span>· ${esc(L('kapsam','coverage'))}: ${esc(coverage.from?fmtDate(coverage.from):'—')} → ${esc(coverage.to?fmtDate(coverage.to):'—')} · ${n(coverage.snapshotCount||0)} snapshot</span>
    ${win.from?`<span class="bpaPlanPill">${esc(L('Plan penceresi','Plan window'))}: ${esc(fmtDay(win.from))} → ${esc(fmtDay(win.to))}</span>`:''}
    ${start.dateRepair||end.dateRepair?`<span class="bpaPlanPill" title="${esc(L('Soğuk açılıştan sonra alınan snapshotlarda tarihler bir gün geri yazılmıştı; analiz bu snapshotları otomatik düzeltilmiş tarihlerle karşılaştırır.','Snapshots taken after a cold start stored dates one day early; the analysis compares them with automatically corrected dates.'))}">${esc(L('Tarih kayması düzeltildi','Date shift corrected'))}</span>`:''}
    ${warn?`<span class="bpaCoverageWarn">${esc(L('Seçilen saate birebir snapshot yok; en yakın mevcut zaman işareti kullanıldı.','No exact snapshot exists for the selected time; the nearest available marker was used.'))}</span>`:''}
  </div>`;
}
function changeSummary(rows){
  const out={changed:rows.length,delayed:0,advanced:0,status:0,etaDelayed:0,repeated:0,reverted:0};
  rows.forEach(row=>{
    if(row.repeatedRevision)out.repeated+=1;if(row.revertedRevision)out.reverted+=1;
    (row.fields||[]).forEach(field=>{
      if(field.label==='Planlanan Ex-Factory'){if(Number(field.days)>0)out.delayed+=1;if(Number(field.days)<0)out.advanced+=1;}
      if(field.category==='status')out.status+=1;
      if(field.category==='eta'&&Number(field.days)>0)out.etaDelayed+=1;
    });
  });
  return out;
}
function tip(html){const id='t'+(++seq);tips.set(id,html);return id}
function opener(spec){const id='o'+(++seq);openers.set(id,spec);return id}
function tipHtml(title,lines){return `<div class="bpaTipTitle">${esc(title)}</div>${lines.map(([k,v,tone])=>`<div class="bpaTipLine"><span>${esc(k)}</span><b${tone?` class="is-${tone}"`:''}>${esc(v)}</b></div>`).join('')}`}
function ring(value,label,sub){
  const v=Math.max(0,Math.min(1,Number(value)||0));
  return `<div class="bpaRing"><div class="uiMeasure" aria-hidden="true"><i style="transform:scaleX(${v})"></i></div><div class="bpaRingText"><b>${esc(value==null?'—':pct(value))}</b><span>${esc(label)}</span></div><div class="bpaRingSub">${sub}</div></div>`;
}
function hero(planRows,changes){
  const R=Report(),s=R.summarize(planRows),c=changeSummary(changes);
  const tile=(value,label,sub,tone,jump)=>`<button type="button" class="bpaTile"${tone?` data-tone="${tone}"`:''}${jump?` data-bpa-jump="${jump}"`:''}><span class="bpaTileValue">${esc(value)}</span><span class="bpaTileLabel">${esc(label)}</span>${sub?`<span class="bpaTileSub">${esc(sub)}</span>`:''}</button>`;
  return `<div class="bpaHero">
    ${ring(s.pct,L('plan gerçekleşti','plan realised'),`<span class="bpaDot" data-seg="onTime"></span>${esc(L('Zamanında','On time'))} <b>${esc(pct(s.onTimePct))}</b>`)}
    <div class="bpaTiles">
      ${tile(n(s.planned),L('Plan penceresinde planlanan adet','Qty planned in plan window'),L(`${n(s.lines)} sipariş satırı`,`${n(s.lines)} order lines`),'',`plan:all`)}
      ${tile(n(s.segments.onTime),L('Zamanında yüklenen','Loaded on time'),pct(s.planned?s.segments.onTime/s.planned:null),'onTime','plan:onTime')}
      ${tile(n(s.segments.late),L('Plan tarihinden geç yüklenen','Loaded after planned date'),pct(s.planned?s.segments.late/s.planned:null),'late','plan:late')}
      ${tile(n(s.segments.overdue),L('Tarihi geçmiş · yüklenmedi','Overdue · not loaded'),L(`${n(s.overdueLines)} satır`,`${n(s.overdueLines)} lines`),'overdue','plan:notLoaded')}
      ${tile(n(s.segments.pending),L('Vadesi gelmemiş · açık','Not yet due · open'),pct(s.planned?s.segments.pending/s.planned:null),'pending','plan:pending')}
      ${tile(n(c.delayed),L('Ex-Factory ileri ötelenen','Ex-Factory pushed later'),L(`${n(c.advanced)} öne çekildi`,`${n(c.advanced)} pulled earlier`),c.delayed?'overdue':'','agenda:exfactory')}
      ${tile(n(c.etaDelayed),L('Antrepo ETA ileri ötelenen','Warehouse ETA pushed later'),'',c.etaDelayed?'late':'','agenda:eta')}
      ${tile(n(c.repeated),L('Birden fazla revize edilen','Revised more than once'),L(`${n(c.changed)} değişen satır`,`${n(c.changed)} changed lines`),c.repeated?'late':'','agenda:instability')}
    </div>
  </div>`;
}
function tabs(planCount,changeCount,activityCount){
  const t=(key,label,count)=>`<button type="button" class="bpaTab${state.tab===key?' is-active':''}" data-bpa-tab="${key}" role="tab" aria-selected="${state.tab===key}">${esc(label)}${count==null?'':`<span class="bpaTabCount">${n(count)}</span>`}</button>`;
  return `<div class="bpaTabs" role="tablist">${t('overview',L('Genel bakış','Overview'))}${t('plan',L('Plan gerçekleşme','Plan realisation'),planCount)}${t('changes',L('Net değişiklikler','Net changes'),changeCount)}${t('activity',L('Değişiklik trafiği','Change activity'),activityCount)}</div>`;
}
function legend(){return `<div class="bpaLegend">${segments().map(s=>`<span><i class="bpaDot" data-seg="${s.key}"></i>${esc(segLabel(s))}</span>`).join('')}</div>`}
/* Yatay yığılmış bar: her segment hover'da bilgi verir, tıklanınca sağ panelde
   o segmentin siparişlerini açar. */
function stackedBar(name,group,scaleMax,dimLabel){
  const R=Report(),total=group.planned||0;
  const width=state.barScale==='qty'&&scaleMax>0?Math.max(2,total/scaleMax*100):100;
  const segs=R.SEGMENTS.filter(s=>group.segments[s.key]>0).map(s=>{
    const qty=group.segments[s.key],rows=group.rows.filter(row=>R.rowHasSegment(row,s.key));
    const t=tip(tipHtml(name,[[dimLabel,name],[segLabel(s),n(qty)+' '+L('adet','pcs'),s.key],[L('Grup içindeki payı','Share of group'),pct(total?qty/total:null)],[L('Sipariş satırı','Order lines'),n(rows.length)]])+`<div class="bpaTipHint">${esc(L('Detay için tıklayın','Click for details'))}</div>`);
    const o=opener({title:name,subtitle:`${dimLabel} · ${segLabel(s)}`,rows,segment:s.key});
    return `<span class="bpaSeg" data-seg="${s.key}" style="flex-grow:${qty}" data-bpa-tip="${t}" data-bpa-open="${o}"></span>`;
  }).join('');
  return `<div class="bpaBarTrack"><div class="bpaBar" style="width:${width.toFixed(2)}%">${segs||'<span class="bpaSeg is-empty"></span>'}</div></div>`;
}
function groupSection(planRows){
  const R=Report(),dims=R.DIMENSIONS,key=state.groupBy||'buyer',dim=dims.find(d=>d.key===key)||dims[0],dimLabel=segLabel(dim);
  const groups=R.groupBy(planRows,dim.key,{blank:L('(boş)','(blank)')});
  const list=state.showAllGroups?groups:groups.slice(0,15),max=groups.reduce((m,g)=>Math.max(m,g.planned),0);
  const total=R.summarize(planRows);
  const row=(name,g,isTotal)=>{
    const o=opener({title:name,subtitle:dimLabel,rows:g.rows});
    return `<div class="bpaGRow${isTotal?' is-total':''}">
      <button type="button" class="bpaGName" data-bpa-open="${o}" title="${esc(name)}">${esc(name)}</button>
      ${stackedBar(name,g,isTotal?0:max,dimLabel)}
      <div class="bpaGStats"><b>${esc(pct(g.pct))}</b><span>${n(g.loaded)} / ${n(g.planned)}</span></div>
    </div>`;
  };
  return `<div class="bpaCardBox bpaGroupCard">
    <div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Planlanan / Gerçekleşen dağılımı','Planned / actual distribution'))}</span><span class="bpaSectionSub">${esc(L('Bar segmentinin üzerine gelin; tıklayınca siparişler sağda açılır.','Hover a segment; click to open its orders on the right.'))}</span><span class="bpaSectionSpacer"></span>
      <div class="bpaSeg2" role="group" aria-label="${esc(L('Kırılım','Breakdown'))}">${dims.map(d=>`<button type="button" class="${d.key===dim.key?'is-active':''}" data-bpa-group="${d.key}">${esc(segLabel(d))}</button>`).join('')}</div>
      <div class="bpaSeg2" role="group"><button type="button" class="${state.barScale!=='qty'?'is-active':''}" data-bpa-scale="pct">%</button><button type="button" class="${state.barScale==='qty'?'is-active':''}" data-bpa-scale="qty">${esc(L('Adet','Qty'))}</button></div>
    </div>
    ${legend()}
    ${groups.length?`<div class="bpaGroups">${row(L('Tümü','All'),{...total,rows:planRows},true)}${list.map(g=>row(g.name,g,false)).join('')}</div>
    ${groups.length>15?`<button type="button" class="bpaMore" data-bpa-action="toggleGroups">${esc(state.showAllGroups?L('Daha az göster','Show less'):L(`Tümünü göster (${groups.length})`,`Show all (${groups.length})`))}</button>`:''}`
    :`<div class="bpaEmpty">${esc(L('Plan penceresinde yüklenmesi planlanan açık adet yok.','No open quantity planned to load in the plan window.'))}</div>`}
  </div>`;
}
function dailySection(planRows){
  const R=Report(),days=R.dailySeries(planRows),max=days.reduce((m,d)=>Math.max(m,d.planned),0);
  const cols=days.map(d=>{
    const segs=R.SEGMENTS.filter(s=>d.segments[s.key]>0).map(s=>{
      const qty=d.segments[s.key],rows=d.rows.filter(row=>R.rowHasSegment(row,s.key));
      const t=tip(tipHtml(fmtDay(d.day),[[segLabel(s),n(qty)+' '+L('adet','pcs'),s.key],[L('Günün planı','Planned that day'),n(d.planned)],[L('Pay','Share'),pct(d.planned?qty/d.planned:null)],[L('Sipariş satırı','Order lines'),n(rows.length)]]));
      const o=opener({title:fmtDay(d.day),subtitle:`${L('Plan Ex-Factory','Planned Ex-Factory')} · ${segLabel(s)}`,rows,segment:s.key});
      return `<span class="bpaSeg" data-seg="${s.key}" style="flex-grow:${qty}" data-bpa-tip="${t}" data-bpa-open="${o}"></span>`;
    }).join('');
    return `<div class="bpaCol"><div class="bpaColValue">${esc(pct(d.pct))}</div><div class="bpaColTrack"><div class="bpaColBar" style="height:${max?Math.max(3,d.planned/max*100).toFixed(1):0}%">${segs}</div></div><div class="bpaColLabel">${esc(fmtShortDay(d.day))}</div></div>`;
  }).join('');
  return `<div class="bpaCardBox"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Plan tarihine göre yükleme performansı','Loading performance by planned date'))}</span><span class="bpaSectionSub">${esc(L('Planlanan Ex-Factory günü · adet','Planned Ex-Factory day · qty'))}</span></div>
    ${days.length?`<div class="bpaCols">${cols}</div>`:`<div class="bpaEmpty">${esc(L('Veri yok.','No data.'))}</div>`}</div>`;
}
function revisionSection(changes){
  const R=Report(),buckets=R.exFactoryRevisions(changes),max=buckets.reduce((m,b)=>Math.max(m,b.count),0);
  const rows=buckets.map(b=>{
    const t=tip(tipHtml(segLabel(b),[[L('Sipariş satırı','Order lines'),n(b.count),b.tone==='bad'?'overdue':'onTime']]));
    const o=b.count?opener({title:L('Ex-Factory revizyonu','Ex-Factory revision'),subtitle:segLabel(b),changes:b.items}):'';
    return `<div class="bpaRevRow${b.count?'':' is-zero'}"${o?` data-bpa-open="${o}"`:''} data-bpa-tip="${t}"><span class="bpaRevLabel">${esc(segLabel(b))}</span><span class="bpaRevTrack"><span class="bpaRevBar" data-tone="${b.tone}" style="width:${max?(b.count/max*100).toFixed(1):0}%"></span></span><b>${n(b.count)}</b></div>`;
  }).join('');
  const total=buckets.reduce((t,b)=>t+b.count,0);
  return `<div class="bpaCardBox"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Ex-Factory revizyonları','Ex-Factory revisions'))}</span><span class="bpaSectionSub">${esc(L(`${n(total)} satırda plan tarihi değişti`,`Plan date changed on ${n(total)} lines`))}</span></div><div class="bpaRevs">${rows}</div></div>`;
}
function outcomeBadge(row){
  const R=Report(),o=R.OUTCOMES[row.outcome]||{tr:row.outcome,en:row.outcome,segment:''};
  return `<span class="bpaBadge" data-seg="${o.segment}">${esc(segLabel(o))}</span>`;
}
function progress(row){
  const R=Report(),planned=Number(row.plannedQty)||0,seg=R.rowSegments(row);
  return `<div class="bpaMini">${R.SEGMENTS.filter(s=>seg[s.key]>0).map(s=>`<span data-seg="${s.key}" style="flex-grow:${seg[s.key]}"></span>`).join('')}</div><small>${esc(pct(planned?(Number(row.loadedQty)||0)/planned:null))}</small>`;
}
function planDateCell(row){
  const shift=Number(row.planShiftDays);
  const moved=row.currentPlanDate&&row.currentPlanDate!==row.planDate;
  return `${esc(fmtDay(row.planDate))}${moved?`<small>→ ${esc(fmtDay(row.currentPlanDate))}${Number.isFinite(shift)&&shift?` <span class="bpaDayDelta ${shift>0?'is-late':'is-early'}">${shift>0?'+':''}${shift}</span>`:''}</small>`:''}`;
}
function delayCell(row){
  if(row.overdueDays)return `<span class="bpaDayDelta is-late">${n(row.overdueDays)} ${esc(L('gün geçti','days overdue'))}</span>`;
  if(row.lateDays)return `<span class="bpaDayDelta is-warn">+${n(row.lateDays)} ${esc(L('gün geç','days late'))}</span>`;
  return '';
}
function planTableRows(rows){
  return rows.map(row=>`<tr>
    <td>${outcomeBadge(row)}</td>
    <td><div class="bpaIdentity">${esc(row.orderCode||'—')}<small>${esc([row.modelName,row.colourCode,row.colour].filter(Boolean).join(' · '))}</small></div></td>
    <td>${esc(row.buyer||'—')}<small class="bpaSub">${esc([row.buyingGroup,row.mag,row.productMainDefinition].filter(Boolean).join(' · '))}</small></td>
    <td>${esc(row.manufacturer||'—')}<small class="bpaSub">${esc(row.season||'')}</small></td>
    <td class="bpaDateCell">${planDateCell(row)}</td>
    <td class="num">${n(row.plannedQty)}</td><td class="num">${n(row.loadedQty)}</td><td class="num${row.openQty?' is-open':''}">${n(row.openQty)}</td>
    <td class="bpaProgressCell">${progress(row)}</td>
    <td>${delayCell(row)}</td>
    <td class="bpaStatusCell">${esc(row.status||'—')}${row.eta?`<small>${esc(L('ETA','ETA'))} ${esc(fmtDay(row.eta))}</small>`:''}</td>
  </tr>`).join('');
}
function planTableHead(){
  return `<thead><tr><th>${esc(L('Sonuç','Outcome'))}</th><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th>${esc(L('Plan Ex-F.','Planned Ex-F.'))}</th><th class="num">${esc(L('Plan','Plan'))}</th><th class="num">${esc(L('Yüklenen','Loaded'))}</th><th class="num">${esc(L('Açık','Open'))}</th><th>${esc(L('Gerçekleşme','Realisation'))}</th><th>${esc(L('Gecikme','Delay'))}</th><th>${esc(L('Güncel statü','Current status'))}</th></tr></thead>`;
}
function planSection(planRows){
  const R=Report(),keys=['all',...Object.keys(R.OUTCOMES)];
  const counts={all:planRows.length};Object.keys(R.OUTCOMES).forEach(k=>{counts[k]=planRows.filter(r=>r.outcome===k).length;});
  const rows=state.outcome==='all'?planRows:planRows.filter(r=>r.outcome===state.outcome);
  const chips=keys.map(k=>{const o=R.OUTCOMES[k];return `<button type="button" class="bpaChip${state.outcome===k?' is-active':''}" data-bpa-outcome="${k}"${o?` data-seg="${o.segment}"`:''}>${o?'<i class="bpaDot" data-seg="'+o.segment+'"></i>':''}${esc(o?segLabel(o):L('Tümü','All'))}<span>${n(counts[k])}</span></button>`;}).join('');
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Plan penceresinde yüklenmesi planlananlar','Planned to load in the plan window'))}</span><span class="bpaSectionSub">${esc(L('Başlangıç snapshotındaki plan Ex-Factory tarihi esas alınır.','Based on the planned Ex-Factory date in the start snapshot.'))}</span></div>
    <div class="bpaChips">${chips}</div>
    ${rows.length?`<div class="bpaTableWrap"><table class="bpaTable bpaPlanTable">${planTableHead()}<tbody>${planTableRows(rows.slice(0,ROW_LIMIT))}</tbody></table></div>${rows.length>ROW_LIMIT?`<div class="bpaNote">${esc(L(`İlk ${ROW_LIMIT} satır gösteriliyor; tamamı Excel'de.`,`Showing first ${ROW_LIMIT} rows; Excel contains all.`))}</div>`:''}`:`<div class="bpaEmpty">${esc(L('Bu sonuçta sipariş yok.','No orders with this outcome.'))}</div>`}
  </div>`;
}
function dayBadge(field){
  if(!Number.isFinite(Number(field.days))||Number(field.days)===0||field.days===null)return '';
  const d=Number(field.days),cls=d>0?'is-late':'is-early';
  return `<span class="bpaDayDelta ${cls}">${d>0?'+':''}${d} ${esc(L('gün','days'))}</span>`;
}
function fieldHtml(field){
  // Tarih ve "tarih/statü · adet" kovaları okunur biçimde gösterilir (14.03.2026 · 39.641 adet).
  const fmt=value=>Report()?Report().formatFieldText(value,lang()):fmtDay(value);
  const before=fmt(field.before),after=fmt(field.after);
  return `<div class="bpaField"><span class="bpaFieldName">${esc(field.label)}${dayBadge(field)}</span><span class="bpaBefore">${esc(before||'—')}</span><span class="bpaArrow">→</span><span class="bpaAfter">${esc(after||'—')}</span></div>`;
}
function changeRowsHtml(rows){
  return rows.map(row=>{
    const tags=[];
    if(row.lateQty>0)tags.push(`<span class="bpaTag is-alert">${n(row.lateQty)} ${esc(L('adet geç yükleme','late-loaded'))}</span>`);
    if(row.repeatedRevision)tags.push(`<span class="bpaTag is-alert">${esc(L('çoklu revizyon','multiple revisions'))}</span>`);
    if(row.revertedRevision)tags.push(`<span class="bpaTag">${esc(L('geri alınan değişiklik','reverted change'))}</span>`);
    if(row.inPlanWindow)tags.push(`<span class="bpaTag is-plan">${esc(L('plan penceresinde','in plan window'))}</span>`);
    return `<tr>
      <td><div class="bpaIdentity">${esc(row.orderCode||'—')}<small>${esc([row.modelName,row.colourCode,row.colour].filter(Boolean).join(' · '))}</small></div></td>
      <td>${esc([row.buyer,row.buyingGroup].filter(Boolean).join(' · ')||'—')}</td>
      <td>${esc([row.manufacturer,row.season].filter(Boolean).join(' · ')||'—')}</td>
      <td><div class="bpaFieldList">${(row.fields||[]).length?(row.fields||[]).map(fieldHtml).join(''):`<span class="bpaMuted">${esc(L('Net fark yok; dönem içinde değişiklik trafiği var.','No net difference; there was change activity during the period.'))}</span>`}</div></td>
      <td><div class="bpaTags">${tags.join('')}</div></td>
    </tr>`;
  }).join('');
}
function changesSection(rows){
  const shown=rows.slice(0,ROW_LIMIT);
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Net değişiklikler','Net changes'))}</span><span class="bpaSectionSub">${n(rows.length)} ${esc(L('kayıt · değişmeyen Backlog satırları gösterilmez','records · unchanged Backlog rows are hidden'))}</span></div>
    ${rows.length?`<div class="bpaTableWrap"><table class="bpaTable"><thead><tr><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Üretici / Sezon','Manufacturer / Season'))}</th><th>${esc(L('Başlangıç → Bitiş','Start → End'))}</th><th>${esc(L('Sinyal','Signal'))}</th></tr></thead><tbody>${changeRowsHtml(shown)}</tbody></table></div>${rows.length>ROW_LIMIT?`<div class="bpaNote">${esc(L(`İlk ${ROW_LIMIT} kayıt gösteriliyor; tamamı Excel'de.`,`Showing first ${ROW_LIMIT} records; Excel contains all.`))}</div>`:''}`:`<div class="bpaEmpty">${esc(L('Seçili kapsamda net değişiklik yok.','No net changes in the selected scope.'))}</div>`}
  </div>`;
}
function activitySection(list){
  const rows=list.slice(0,ROW_LIMIT).map(item=>`<tr>
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
  const labels={buyer:'Buyer',buyingGroup:'Buyer Group',manufacturer:L('Üretici','Manufacturer'),season:L('Sezon','Season'),mag:'MAG',mmyg:'MMYG',productMainDefinition:L('Ürün Ana Tanım','Product Main Definition')};
  const max=list.reduce((m,g)=>Math.max(m,g.orders),0);
  const cells=list.map(g=>`<div>${esc(g.name)}</div><div class="bpaBreakBar"><span style="width:${max?(g.orders/max*100).toFixed(1):0}%"></span><b>${n(g.orders)}</b></div><div class="bpaOptional">${n(g.late)}</div><div class="bpaOptional">${n(g.activity)}</div>`).join('');
  return `<div class="bpaSection"><div class="bpaSectionHead"><span class="bpaSectionTitle">${esc(L('Kırılım','Breakdown'))}</span><span class="bpaSectionSpacer"></span><select class="bpaMiniSelect" data-bpa-control="breakdown">${Object.entries(labels).map(([v,l])=>`<option value="${v}"${key===v?' selected':''}>${esc(l)}</option>`).join('')}</select></div>
    ${list.length?`<div class="bpaBreakdown"><div class="bpaBreakdownHead">${esc(labels[key]||key)}</div><div class="bpaBreakdownHead">${esc(L('Değişen','Changed'))}</div><div class="bpaBreakdownHead bpaOptional">${esc(L('Geç yüklenen adet','Late-loaded qty'))}</div><div class="bpaBreakdownHead bpaOptional">${esc(L('Revizyon hareketi','Revision activity'))}</div>${cells}</div>`:`<div class="bpaEmpty">${esc(L('Kırılım için veri yok.','No data for breakdown.'))}</div>`}
  </div>`;
}
function render(){
  const host=$('backlogPlanActual');if(!host||!state.open)return;
  bindHost(host);
  tips=new Map();openers=new Map();hideTip();
  if(loading){host.innerHTML=controls()+'<div class="bpaLoading"><span class="bpaSpinner"></span>'+esc(L('Snapshotlar karşılaştırılıyor…','Comparing snapshots…'))+'</div>';return;}
  if(error){host.innerHTML=controls()+'<div class="bpaError">'+esc(error)+'</div>';return;}
  if(!data){host.innerHTML=controls()+'<div class="bpaEmpty">'+esc(L('Bir dönem seçip Analiz et düğmesine basın.','Choose a period and click Analyse.'))+'</div>';return;}
  if(!data.resolved||!data.resolved.start||!data.resolved.end){
    host.innerHTML=controls()+`<div class="bpaEmpty">${esc(data.message||L('Henüz karşılaştırılabilir snapshot yok. Bir sonraki veri yenilemelerinden itibaren geçmiş birikmeye başlayacak.','There is no comparable snapshot yet. History will start accumulating from the next data refreshes.'))}</div>`;return;
  }
  if(!Report()){host.innerHTML=controls()+'<div class="bpaError">'+esc(L('Rapor motoru yüklenemedi.','Report engine could not be loaded.'))+'</div>';return;}
  const rows=visibleChanges(),activity=visibleActivity(),planRows=visiblePlan();
  let body='';
  if(state.tab==='plan')body=planSection(planRows);
  else if(state.tab==='changes')body=changesSection(rows)+breakdownSection(rows);
  else if(state.tab==='activity')body=activitySection(activity);
  else body=groupSection(planRows)+`<div class="bpaGrid2">${dailySection(planRows)}${revisionSection(rows)}</div>`;
  host.innerHTML=controls()+snapshotBar()+hero(planRows,rows)+tabs(planRows.length,rows.length,activity.length)+`<div class="bpaTabBody">${body}</div>`;
}

/* ---------------------------------------------------------------- tooltip */
function tipEl(){
  let el=$('bpaTip');
  if(!el){el=document.createElement('div');el.id='bpaTip';el.className='bpaTip';el.dataset.uiMigrated='plan-execute';el.hidden=true;el.setAttribute('role','tooltip');document.body.appendChild(el);}
  return el;
}
function hideTip(){const el=$('bpaTip');if(el)el.hidden=true}
function moveTip(e){
  const target=e.target&&e.target.closest?e.target.closest('[data-bpa-tip]'):null;
  if(!target||!tips.has(target.dataset.bpaTip)){hideTip();return;}
  const el=tipEl();
  if(el.dataset.key!==target.dataset.bpaTip){el.innerHTML=tips.get(target.dataset.bpaTip);el.dataset.key=target.dataset.bpaTip;}
  el.hidden=false;
  const pad=14,w=el.offsetWidth,h=el.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;
  if(x+w>window.innerWidth-8)x=e.clientX-w-pad;
  if(y+h>window.innerHeight-8)y=e.clientY-h-pad;
  el.style.left=Math.max(8,x)+'px';el.style.top=Math.max(8,y)+'px';
}

/* ------------------------------------------------------- sağ detay paneli */
function drawerEl(){
  let el=$('bpaDrawer');
  if(!el){
    el=document.createElement('div');el.id='bpaDrawer';el.className='bpaDrawerRoot';el.dataset.uiMigrated='plan-execute';el.hidden=true;
    el.innerHTML='<div class="bpaDrawerScrim" data-bpa-close></div><aside class="bpaDrawer" role="dialog" aria-modal="true" aria-labelledby="bpaDrawerTitle"></aside>';
    document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target.closest('[data-bpa-close]'))closeDrawer();});
  }
  return el;
}
function closeDrawer(){const el=$('bpaDrawer');if(el&&!el.hidden){window.BLLayerSystem?.closeDialog(el);el.hidden=true;el.classList.remove('is-open');}}
function openDrawer(spec){
  if(!spec)return;
  hideTip();
  const R=Report(),root=drawerEl(),aside=root.querySelector('.bpaDrawer');
  let summary='',content='';
  if(Array.isArray(spec.changes)){
    const items=spec.changes.slice().sort((a,b)=>Math.abs(b.days)-Math.abs(a.days));
    summary=`<div class="bpaDrawerStats"><div><b>${n(items.length)}</b><span>${esc(L('sipariş satırı','order lines'))}</span></div></div>`;
    content=`<div class="bpaTableWrap bpaDrawerTable"><table class="bpaTable"><thead><tr><th>${esc(L('Sipariş','Order'))}</th><th>Buyer</th><th>${esc(L('Plan Ex-F.','Planned Ex-F.'))}</th><th class="num">${esc(L('Gün','Days'))}</th></tr></thead><tbody>${items.map(({change,days})=>{const f=(change.fields||[]).find(x=>x.label==='Planlanan Ex-Factory')||{};return `<tr><td><div class="bpaIdentity">${esc(change.orderCode||'—')}<small>${esc([change.modelName,change.colourCode,change.colour].filter(Boolean).join(' · '))}</small></div></td><td>${esc(change.buyer||'—')}<small class="bpaSub">${esc(change.manufacturer||'')}</small></td><td>${esc(fmtDay(f.before))} → ${esc(fmtDay(f.after))}</td><td class="num"><span class="bpaDayDelta ${days>0?'is-late':'is-early'}">${days>0?'+':''}${days}</span></td></tr>`;}).join('')}</tbody></table></div>`;
  }else{
    const rows=(spec.rows||[]).slice().sort((a,b)=>(b.overdueDays-a.overdueDays)||(b.openQty-a.openQty)||(b.plannedQty-a.plannedQty));
    const s=R.summarize(rows);
    summary=`<div class="bpaDrawerStats">
      <div><b>${n(rows.length)}</b><span>${esc(L('sipariş satırı','order lines'))}</span></div>
      <div><b>${n(s.planned)}</b><span>${esc(L('planlanan','planned'))}</span></div>
      <div><b>${n(s.loaded)}</b><span>${esc(L('yüklenen','loaded'))}</span></div>
      <div><b class="is-overdue">${n(s.segments.overdue)}</b><span>${esc(L('tarihi geçmiş açık','overdue open'))}</span></div>
      <div><b>${esc(pct(s.pct))}</b><span>${esc(L('gerçekleşme','realised'))}</span></div>
    </div><div class="bpaBar bpaDrawerBar">${R.SEGMENTS.filter(x=>s.segments[x.key]>0).map(x=>`<span class="bpaSeg" data-seg="${x.key}" style="flex-grow:${s.segments[x.key]}" title="${esc(segLabel(x)+': '+n(s.segments[x.key]))}"></span>`).join('')}</div>`;
    content=`<div class="bpaTableWrap bpaDrawerTable"><table class="bpaTable bpaPlanTable">${planTableHead()}<tbody>${planTableRows(rows)}</tbody></table></div>`;
  }
  const seg=spec.segment?R.SEGMENTS.find(x=>x.key===spec.segment):null;
  aside.innerHTML=`<header class="bpaDrawerHead"><div><div class="bpaDrawerKicker">${seg?`<i class="bpaDot" data-seg="${seg.key}"></i>`:''}${esc(spec.subtitle||'')}</div><h3 id="bpaDrawerTitle">${esc(spec.title||'')}</h3></div><button type="button" class="tbtn bpaMoveBtn" data-bpa-close title="${esc(L('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>${summary}${content}`;
  root.hidden=false;
  window.BLLayerSystem?.openDialog(root,{onClose:closeDrawer});
  requestAnimationFrame(()=>root.classList.add('is-open'));
  aside.querySelector('[data-bpa-close]')?.focus();
}

/* ------------------------------------------------------------ Excel export */
function filterText(){
  const labels={buyer:'Buyer',buyingGroup:'Buyer Group',manufacturer:L('Üretici','Manufacturer'),season:L('Sezon','Season'),mag:'MAG',mmyg:'MMYG',productMainDefinition:L('Ürün Ana Tanım','Product Main Definition')};
  const parts=Object.entries(state.filters).filter(([,v])=>v).map(([k,v])=>`${labels[k]||k}: ${v}`);
  if(state.agenda!=='all')parts.push(L('Gündem','Agenda')+': '+state.agenda);
  if(state.scope==='plan')parts.push(L('Yalnız plan penceresi','Plan window only'));
  return parts.join(' · ');
}
function download(data,name){
  const blob=data instanceof Blob?data:new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function toast(message,opts){if(typeof window.showToast==='function')window.showToast(message,opts);}
function buildReport(){
  if(!data||!data.resolved||!data.resolved.start)return null;
  const win=data.plan&&data.plan.window||planWindow();
  return {
    planRows:visiblePlan(),changes:visibleChanges(),activity:visibleActivity(),groupBy:state.groupBy,
    planFrom:win.from,planTo:win.to,
    periodText:`${fmtDate((data.requested||{}).from)} → ${fmtDate((data.requested||{}).to)}`,
    planWindowText:`${fmtDay(win.from)} → ${fmtDay(win.to)}`,
    snapshotText:`${fmtDate(data.resolved.start.capturedAt)} → ${fmtDate(data.resolved.end.capturedAt)}`,
    filterText:filterText(),
  };
}
/* Backlog V3 Excel'i bu raporu kendi çalışma kitabına ekler. Panel hiç
   açılmadıysa veri mevcut dönem/plan penceresi tercihleriyle yüklenir. */
async function exportReport(){
  if(!data&&!loading)await refresh();
  return buildReport();
}
async function exportExcel(){
  if(exporting||!data||!data.resolved||!data.resolved.start)return;
  const R=Report();if(!R)return;
  exporting=true;render();
  try{
    if(window.BLPerf){await window.BLPerf.ensureLibrary('exceljs');await window.BLPerf.ensureLibrary('jszip').catch(()=>null);}
    if(typeof window.ExcelJS==='undefined')throw new Error(L('Excel kütüphanesi yüklenemedi.','Excel library could not be loaded.'));
    const report=buildReport();
    const out=await R.buildXlsx(report,{ExcelJS:window.ExcelJS,JSZip:window.JSZip,lang:lang(),outputType:'blob',onChartError:err=>console.warn('[plan-actual] Excel grafikleri eklenemedi',err)});
    const name=R.fileName(report);
    download(out,name);
    toast(L(`${name} indirildi.`,`${name} downloaded.`));
  }catch(err){toast(L('Excel aktarımı başarısız: ','Excel export failed: ')+(err&&err.message||err),{kind:'error'});}
  finally{exporting=false;render();}
}

/* ----------------------------------------------------------- olay bağları */
function bindHost(host){
  if(host.dataset.bpaBound)return;host.dataset.bpaBound='1';
  host.addEventListener('change',e=>{
    const el=e.target;
    if(el.dataset.bpaFilter){state.filters[el.dataset.bpaFilter]=el.value;saveState();render();return;}
    const key=el.dataset.bpaControl;if(!key)return;
    if(key==='preset'){state.preset=el.value;applyPreset(state.preset);saveState();render();if(state.preset!=='custom')void refresh();return;}
    if(key==='planMode'){
      if(el.value==='custom'){const win=planWindow();state.planFrom=win.from;state.planTo=win.to;}
      state.planMode=el.value;saveState();void refresh();return;
    }
    if(key==='planFrom'||key==='planTo'){state[key]=el.value;state.planMode='custom';saveState();if(state.planFrom&&state.planTo&&state.planFrom<=state.planTo)void refresh();return;}
    if(key==='from'||key==='to'){state[key]=el.value;state.preset='custom';}
    else if(key==='agenda')state.agenda=el.value;
    else if(key==='breakdown')state.breakdown=el.value;
    else if(key==='scope')state.scope=el.value;
    saveState();render();
  });
  host.addEventListener('click',e=>{
    const t=e.target.closest('[data-bpa-action],[data-bpa-tab],[data-bpa-jump],[data-bpa-open],[data-bpa-outcome],[data-bpa-group],[data-bpa-scale]');
    if(!t||!host.contains(t))return;
    if(t.dataset.bpaAction==='refresh')return void refresh();
    if(t.dataset.bpaAction==='export')return void exportExcel();
    if(t.dataset.bpaAction==='toggleGroups'){state.showAllGroups=!state.showAllGroups;saveState();return render();}
    if(t.dataset.bpaTab){state.tab=t.dataset.bpaTab;saveState();return render();}
    if(t.dataset.bpaOutcome){state.outcome=t.dataset.bpaOutcome;saveState();return render();}
    if(t.dataset.bpaGroup){state.groupBy=t.dataset.bpaGroup;saveState();return render();}
    if(t.dataset.bpaScale){state.barScale=t.dataset.bpaScale;saveState();return render();}
    if(t.dataset.bpaJump){
      const [kind,value]=t.dataset.bpaJump.split(':');
      if(kind==='plan'){state.tab='plan';state.outcome=value;}
      else if(kind==='agenda'){state.tab='changes';state.agenda=value;}
      saveState();return render();
    }
    if(t.dataset.bpaOpen)openDrawer(openers.get(t.dataset.bpaOpen));
  });
  host.addEventListener('mousemove',moveTip);
  host.addEventListener('mouseleave',hideTip);
}
function bindShell(){
  if(bound)return;bound=true;
  $('backlogPlanActualToggle')?.addEventListener('click',()=>openModule(!state.open));
  $('backlogPlanActualMoveUp')?.addEventListener('click',e=>{e.stopPropagation();move(-1)});
  $('backlogPlanActualMoveDown')?.addEventListener('click',e=>{e.stopPropagation();move(1)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
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
  if(state.preset==='prevWeek'||state.preset==='currentWeek')applyPreset(state.preset);
  bindShell();positionModule();openModule(Boolean(state.open));
  document.addEventListener('bl:language-changed',()=>{if(state.open)render()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.BLBacklogPlanActual={refresh:()=>refresh(),open:()=>openModule(true),close:()=>openModule(false),exportExcel:()=>exportExcel(),exportReport:()=>exportReport()};
})();
