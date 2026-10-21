/* Overview presentation. All priorities/dates come from the existing CP decision
   model; charts never infer history, capacity or a second risk score. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOverviewPremium=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const DAY=86400000;
  const PRIORITIES=['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK'];
  const CATEGORIES=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-6)','var(--chart-7)','var(--chart-8)'];
  const RISK=new Set(PRIORITIES.slice(0,3));
  const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
  const number=value=>finite(value)?Number(value):0;
  function today(){const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;}
  function buildHorizon(orders,options={}){
    const start=finite(options.start)?Math.floor(Number(options.start)):today(),count=options.days===14?14:7;
    const days=Array.from({length:count},(_,i)=>({date:start+i,qty:0,riskQty:0,unknownRows:0,rows:[]}));
    const result={start,days,qty:0,missing:[],overdue:[],outside:[]};
    for(const item of Array.isArray(orders)?orders:[]){
      if(!finite(item.plannedLoadDate)){result.missing.push(item);continue;}
      const index=Math.floor(Number(item.plannedLoadDate))-start;
      if(index<0){result.overdue.push(item);continue;}
      if(index>=count){result.outside.push(item);continue;}
      const slot=days[index],qty=Math.max(0,number(item.qty));
      slot.rows.push(item);slot.qty+=qty;result.qty+=qty;
      if(RISK.has(item.priority))slot.riskQty+=qty;
      if(item.calculationStatus==='UNKNOWN')slot.unknownRows++;
    }
    return result;
  }
  function buildCoverage(orders){
    const list=Array.isArray(orders)?orders:[];
    const complete=list.filter(item=>finite(item.plannedLoadDate)&&finite(item.targetDate)).length;
    return {total:list.length,complete,percent:list.length?Math.round(complete/list.length*100):null,
      missingLoad:list.filter(item=>!finite(item.plannedLoadDate)).length,
      missingTarget:list.filter(item=>!finite(item.targetDate)).length,
      unknown:list.filter(item=>item.calculationStatus==='UNKNOWN').length};
  }
  function metricSeries(rows){
    const list=(Array.isArray(rows)?rows:[]).filter(row=>finite(row.value)).map(row=>({...row,value:Number(row.value)}));
    return {rows:list.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)),max:Math.max(0,...list.map(row=>Math.abs(row.value)))};
  }
  function pulseScopes(model,options={}){
    const orders=Array.isArray(model?.orders)?model.orders:[];
    const loading=buildHorizon(orders,options).days.flatMap(day=>day.rows);
    return [
      {key:'scope',orders},
      ...[['critical','CRITICAL'],['today','ACTION_TODAY'],['week','ACTION_THIS_WEEK']].map(([key,priority])=>({key,orders:orders.filter(item=>item.priority===priority)})),
      {key:'loading',orders:loading},
    ].filter(entry=>entry.orders.length);
  }
  const api={buildHorizon,buildCoverage,metricSeries,pulseScopes};
  if(!root.document)return api;
  const doc=root.document;
  const L=(tr,en)=>String(doc.documentElement.lang||'tr').startsWith('en')?en:tr;
  const locale=()=>L('tr-TR','en-GB');
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>number(value).toLocaleString(locale(),{maximumFractionDigits:1});
  const icon=name=>`<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const visible=node=>node&&!node.classList.contains('ovHomeOff')&&doc.body.dataset.activeTab==='overview';
  let model=null,checklist=null,collection=null,context={},horizonDays=7,selectedMonth='',frame=0;
  const metricViews=new Map(),metricPrefs=new Map();
  const dateLabel=ordinal=>new Date(ordinal*DAY).toLocaleDateString(locale(),{day:'numeric',month:'short',timeZone:'UTC'});
  function head(title,actions=''){return `<header class="ovPremiumHead"><b>${esc(title)}</b><div>${actions}</div></header>`;}
  function empty(message){return `<div class="ovPremiumEmpty">${icon('chart-bar')}<span>${esc(message)}</span></div>`;}
  function draw(node,html){
    if(!node||node._ovMarkup===html)return;
    const focused=node.contains(doc.activeElement)?doc.activeElement:null;
    const focusKey=focused?.dataset.ovFocus;
    node.innerHTML=html;node._ovMarkup=html;
    if(focusKey)node.querySelector(`[data-ov-focus="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
    return true;
  }
  function priorityBand(){
    const values=PRIORITIES.map(key=>({key,count:number(model?.priorities?.find(item=>item.name===key)?.rows)}));
    return `<div class="ovPulseBand" aria-hidden="true">${values.filter(x=>x.count).map(x=>`<i class="ovBdTone--${{CRITICAL:'critical',ACTION_TODAY:'today',ACTION_THIS_WEEK:'week',WATCH:'watch',ON_TRACK:'ok'}[x.key]}" style="flex:${x.count}"></i>`).join('')}</div>`;
  }
  function animatePulse(node){
    if(doc.hidden||doc.documentElement.dataset.overviewMotion==='paused'||root.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const localeValue=locale(),group=new Intl.NumberFormat(localeValue).formatToParts(1000).find(p=>p.type==='group')?.value||'',decimal=new Intl.NumberFormat(localeValue).formatToParts(1.1).find(p=>p.type==='decimal')?.value||'.';
    node.querySelectorAll('[data-ov-count]').forEach(el=>{
      const original=el.textContent,suffix=original.endsWith('%')?'%':'',raw=original.replace('%','').split(group).join('').replace(decimal,'.'),target=Number(raw);if(!Number.isFinite(target)||!target)return;
      const places=raw.includes('.')?raw.split('.')[1].length:0,start=performance.now();
      const step=now=>{if(!el.isConnected)return;if(doc.hidden||doc.body.dataset.activeTab!=='overview'||doc.documentElement.dataset.overviewMotion==='paused'){el.textContent=original;return;}const t=Math.min(1,(now-start)/650);el.textContent=t===1?original:(target*(1-Math.pow(1-t,3))).toLocaleString(localeValue,{minimumFractionDigits:places,maximumFractionDigits:places})+suffix;if(t<1)requestAnimationFrame(step);};
      requestAnimationFrame(step);
    });
  }
  function renderPulse(){
    const node=doc.getElementById('ovPulse');if(!visible(node))return;
    if(!model){draw(node,empty(context.message||L('CP özeti hazırlanıyor…','Preparing CP summary…')));return;}
    const horizon=buildHorizon(model.orders);
    const labels={scope:L('Aktif CP kapsamı','Active CP scope'),critical:L('Kritik aksiyon','Critical action'),today:L('Bugün Aksiyon','Action Today'),week:L('Bu Hafta Aksiyon','Action This Week'),loading:L('Yakın yükleme · 7 gün','Upcoming loading · 7 days')};
    const records=pulseScopes(model).map(entry=>{
      const qty=entry.orders.reduce((sum,item)=>sum+number(item.qty),0),loading=entry.key==='loading';
      return {...entry,label:labels[entry.key],value:fmt(loading?qty:entry.orders.length),unit:loading?L('adet','units'):L('satır','rows'),sub:loading?`${fmt(entry.orders.length)} ${L('planlı satır','planned rows')}`:`${fmt(qty)} ${L('adet','units')}`,
        visual:loading?`<div class="ovPulseMini" aria-hidden="true">${horizon.days.map(d=>`<i style="--ov-level:${Math.max(4,100*d.qty/Math.max(1,...horizon.days.map(x=>x.qty)))}%"></i>`).join('')}</div>`:priorityBand()};
    });
    const changed=draw(node,records.length?`<div class="ovPulseGrid" style="--ov-pulse-count:${records.length}">${records.map(r=>`<button type="button" class="ovPulseKpi${r.key==='critical'?' isRisk':''}" data-ov-pulse="${r.key}" data-ov-focus="pulse-${r.key}"><span>${esc(r.label)}</span><strong><b data-ov-count>${esc(r.value)}</b><small>${esc(r.unit)}</small></strong><em>${esc(r.sub)}</em>${r.visual}</button>`).join('')}</div>`:empty(L('Bu kapsamda aktif sipariş yok.','No active orders in this scope.')));
    if(changed)animatePulse(node);
  }
  function renderHorizon(){
    const node=doc.getElementById('ovDeadline');if(!visible(node))return;
    const tools=`<div class="ovPremiumSegment">${[7,14].map(n=>`<button type="button" data-ov-days="${n}" data-ov-focus="days-${n}" aria-pressed="${n===horizonDays}">${n} ${L('gün','days')}</button>`).join('')}</div>`;
    if(!model){draw(node,head(L('Termin Ufku','Delivery Horizon'),tools)+empty(context.message||L('CP tarihleri hazırlanıyor…','Preparing CP dates…')));return;}
    const h=buildHorizon(model.orders,{days:horizonDays}),max=Math.max(1,...h.days.map(d=>d.qty));
    const chart=`<div class="ovHorizonChart">${h.days.map((d,i)=>`<button type="button" class="ovHorizonDay" data-ov-day="${i}" data-ov-focus="day-${i}" ${d.rows.length?'':'disabled'} aria-label="${esc(`${dateLabel(d.date)} · ${fmt(d.qty)} ${L('adet','units')} · ${d.rows.length} ${L('satır','rows')} · ${d.unknownRows} ${L('hesaplanamıyor','uncalculable')}`)}" title="${esc(`${dateLabel(d.date)} · ${fmt(d.qty)} ${L('adet','units')} · ${d.rows.length} ${L('satır','rows')}`)}"><b>${fmt(d.rows.length)}</b><span class="ovHorizonTrack"><i style="--ov-level:${Math.max(d.qty>0?3:0,100*d.qty/max)}%;--ov-risk:${d.qty?100*d.riskQty/d.qty:0}%;--ov-delay:${i*25}ms"></i></span><small>${esc(new Date(d.date*DAY).toLocaleDateString(locale(),{day:'numeric',timeZone:'UTC'}))}</small></button>`).join('')}</div>`;
    draw(node,head(L('Termin Ufku','Delivery Horizon'),tools)+chart+`<div class="ovHorizonFoot"><span>${esc(dateLabel(h.start))} – ${esc(dateLabel(h.start+horizonDays-1))}</span><span><i></i>${L('Riskli adet','At-risk units')}</span><button type="button" data-ov-horizon="overdue" data-ov-focus="overdue">${fmt(h.overdue.length)} ${L('tarihi geçmiş','past date')}</button><button type="button" data-ov-horizon="missing" data-ov-focus="missing">${fmt(h.missing.length)} ${L('tarihsiz','undated')}</button></div>`);
  }
  function collectionBuckets(){
    const c=collection;if(!c)return [];
    const saved=c.saved||{},filters={};
    if(saved.scopeColumn&&saved.scopeValues?.length)filters[saved.scopeColumn]=saved.scopeValues;
    return c.summary.monthBuckets(c.rows,{columnFilters:filters,columnValue:c.columnValue,isConfirmed:c.isConfirmed,quantityFor:c.quantityFor,imageFor:c.imageFor,fields:{month:'inStoreMonth',status:'durum',model:'modelKod'}});
  }
  function renderCollection(){
    const node=doc.getElementById('ovCollectionPreview');if(!visible(node))return;
    const buckets=collectionBuckets();
    if(!buckets.length){draw(node,head(L('Koleksiyon Vitrini','Collection Showcase'))+empty(L('Bu kapsamda koleksiyon modeli yok.','No collection models in this scope.')));return;}
    let bucket=buckets.find(b=>b.month===selectedMonth);
    if(!bucket){
      // Sıralama artık en yeni ay önce: yakın gelecek ayını seç, yoksa en son ayı.
      const today=new Date(),thisMonth=today.getFullYear()*12+today.getMonth()+1;
      const future=buckets.filter(b=>b.year&&b.monthNumber&&b.year*12+b.monthNumber>=thisMonth);
      bucket=future.length?future[future.length-1]:(buckets.find(b=>b.year&&b.monthNumber)||buckets[0]);
      selectedMonth=bucket.month;
    }
    const monthLabel=b=>b.year&&b.monthNumber
      ?new Date(b.year,b.monthNumber-1,1).toLocaleDateString(locale(),{month:'long',year:'numeric'})
      :(b.month||L('Ay yok','No month'));
    const options=buckets.map(b=>`<option value="${esc(b.month)}"${b.month===selectedMonth?' selected':''}>${esc(monthLabel(b))}</option>`).join('');
    const total=bucket.optionCount||1;
    draw(node,head(L('Koleksiyon Vitrini','Collection Showcase'),`<select data-ov-month data-ov-focus="collection-month" aria-label="${esc(L('Koleksiyon ayı','Collection month'))}">${options}</select>`)+
      `<div class="ovShowcaseProducts">${bucket.models.slice(0,6).map((m,i)=>`<button type="button" data-ov-model="${i}" data-ov-focus="model-${i}" title="${esc(m.label)}" aria-label="${esc(m.label)}">${m.image?`<img src="${esc(m.image)}" alt="${esc(m.label)}" loading="lazy" decoding="async">`:icon('hanger')}<span>${esc(m.label)}</span></button>`).join('')}</div>`+
      `<button type="button" class="ovShowcaseTotal" data-ov-collection data-ov-focus="collection-total"><b>${fmt(bucket.modelCount)}</b><span>${L('model','models')}</span><strong>${fmt(bucket.quantity)}</strong><span>${L('adet','units')}</span>${icon('chevron-right')}</button>`+
      `<div class="ovShowcaseStatus">${bucket.statuses.map((s,i)=>`<button type="button" data-ov-status="${i}" data-ov-focus="status-${i}" style="flex:${s.optionCount};--ov-category:${CATEGORIES[i%8]}" title="${esc(`${collection.statusLabel(s.status)} · ${Math.round(s.optionCount/total*100)}%`)}" aria-label="${esc(`${collection.statusLabel(s.status)} · ${s.optionCount} ${L('opsiyon','options')}`)}"></button>`).join('')}</div>`);
  }
  function openRows(items,title){if(!model)return;const rows=(items||[]).map(item=>item.sourceRow).filter(Boolean);root.BLCpAssistant?.openOverviewRows?.(rows,title);}
  function render(){if(doc.body.dataset.activeTab!=='overview')return;renderPulse();renderHorizon();renderCollection();for(const [id,input] of metricViews)renderMetricChart(id,input);}
  function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;render();});}
  function update(input={}){model=input.model||null;checklist=input.checklist||null;context={...context,...input,message:input.message||''};schedule();}
  function updateCollection(input){collection=input;schedule();}
  function revealWidget(key){
    const home=root.BLOverviewHome,layout=root.BLOverviewLayout,place=home&&layout?.locate(home.state(),key);
    if(place)home.goToPage(place.page);
    const el=doc.querySelector(`[data-overview-widget="${key}"]`);el?.scrollIntoView({block:'nearest',behavior:root.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  /* Charts consume pre-aggregated source models. No subtotal or percentage
     aggregation is performed in this presentation layer. */
  function renderMetricChart(id,input){
    metricViews.set(id,input);
    const section=doc.getElementById(id==='oab'?'oabSection':'intakeSection');
    if(!section||!visible(section))return;
    const table=section.querySelector(id==='oab'?'#oabTable':'#intakeTable'),wrap=table?.parentElement;
    if(!wrap)return;
    let host=section.querySelector('.ovMetricSummary');
    if(!host){host=doc.createElement('div');host.className='ovMetricSummary';wrap.before(host);}
    if(input.raw||!input.fields?.length||!input.rows?.length){host.hidden=true;section.classList.remove('hasOverviewChart');return;}
    host.hidden=false;section.classList.add('hasOverviewChart');
    const prefs=metricPrefs.get(id)||{field:input.fields[0].key,table:false};
    if(!input.fields.some(f=>f.key===prefs.field))prefs.field=input.fields[0].key;
    metricPrefs.set(id,prefs);section.classList.toggle('ovMetricTableOpen',prefs.table);
    const field=input.fields.find(f=>f.key===prefs.field),series=metricSeries(input.rows.map((row,index)=>({label:input.labelFor(row,index),value:input.valueFor(row,field),row})));
    const format=input.format||fmt;
    const markup=`<div class="ovMetricTools"><select data-ov-metric="${id}" data-ov-focus="metric-${id}" aria-label="${esc(L('Grafik ölçüsü','Chart measure'))}">${input.fields.map(f=>`<option value="${esc(f.key)}"${f.key===prefs.field?' selected':''}>${esc(f.label)}</option>`).join('')}</select><button type="button" class="cpaBtn sm" data-ov-metric-table="${id}" data-ov-focus="metric-table-${id}" aria-pressed="${prefs.table}">${prefs.table?L('Grafik','Chart'):L('Pivot / Tablo','Pivot / Table')}</button></div>`+
      `<div class="ovMetricBars"${prefs.table?' hidden':''}>${series.rows.slice(0,5).map((row,index)=>`<button type="button" data-ov-metric-row="${id}:${index}" title="${esc(row.label+' · '+format(row.value,field))}" class="ovMetricRow${row.value<0?' isNegative':''}"><span>${esc(row.label)}</span><b>${esc(format(row.value,field))}</b><i><em style="--ov-share:${series.max?Math.abs(row.value)/series.max*100:0}%"></em></i></button>`).join('')||empty(L('Sayısal veri yok.','No numeric data.'))}</div>`+
      `<small class="ovMetricCaption">${esc(input.scope||'')}${series.rows.length>5?` · ${L('İlk 5 /','Top 5 /')} ${fmt(series.rows.length)}`:''}</small>`;
    draw(host,markup);input.series=series;
  }
  function bind(){
    doc.getElementById('ovMotionBtn')?.addEventListener('click',event=>{
      const paused=doc.documentElement.dataset.overviewMotion!=='paused';
      doc.documentElement.dataset.overviewMotion=paused?'paused':'full';event.currentTarget.setAttribute('aria-pressed',String(!paused));
      root.dispatchEvent(new CustomEvent('bl:overview-motion-changed'));
    });
    doc.addEventListener('click' ,event=>{
      const button=event.target.closest('[data-ov-pulse],[data-ov-days],[data-ov-day],[data-ov-horizon],[data-ov-model],[data-ov-status],[data-ov-collection],[data-ov-metric-table],[data-ov-metric-row]');if(!button)return;
      if(!model&&(button.hasAttribute('data-ov-pulse')||button.hasAttribute('data-ov-day')||button.hasAttribute('data-ov-horizon')))return;
      if(button.dataset.ovPulse){const entry=pulseScopes(model).find(item=>item.key===button.dataset.ovPulse);if(entry)openRows(entry.orders,button.querySelector('span').textContent);}
      else if(button.dataset.ovDays){horizonDays=Number(button.dataset.ovDays);renderHorizon();}
      else if(button.dataset.ovDay!=null){const slot=buildHorizon(model?.orders,{days:horizonDays}).days[Number(button.dataset.ovDay)];openRows(slot.rows,`${L('Planlı yükleme','Planned loading')} · ${dateLabel(slot.date)}`);}
      else if(button.dataset.ovHorizon){const h=buildHorizon(model?.orders,{days:horizonDays});openRows(h[button.dataset.ovHorizon],button.dataset.ovHorizon==='missing'?L('Yükleme tarihi eksik','Missing loading date'):L('Planlı yükleme tarihi geçmiş','Planned loading date passed'));}
      else if(button.dataset.ovMetricTable){const id=button.dataset.ovMetricTable,prefs=metricPrefs.get(id);prefs.table=!prefs.table;renderMetricChart(id,metricViews.get(id));}
      else if(button.dataset.ovMetricRow){const [id,index]=button.dataset.ovMetricRow.split(':'),input=metricViews.get(id),prefs=metricPrefs.get(id);input.drill?.(input.series.rows[Number(index)].row,input.fields.find(f=>f.key===prefs.field));}
      else if(collection){const bucket=collectionBuckets().find(b=>b.month===selectedMonth);if(!bucket)return;const extra={month:bucket.month,scopeColumn:collection.saved?.scopeColumn,scopeValues:collection.saved?.scopeValues};if(button.dataset.ovModel!=null)extra.model=bucket.models[Number(button.dataset.ovModel)]?.label;if(button.dataset.ovStatus!=null)extra.status=bucket.statuses[Number(button.dataset.ovStatus)]?.status;collection.drill(extra);}
    });
    doc.addEventListener('change',event=>{
      if(event.target.matches('[data-ov-month]')){selectedMonth=event.target.value;renderCollection();}
      if(event.target.matches('[data-ov-metric]')){const id=event.target.dataset.ovMetric;metricPrefs.get(id).field=event.target.value;renderMetricChart(id,metricViews.get(id));}
    });
    doc.addEventListener('error',event=>{const img=event.target;if(img.tagName==='IMG'&&img.closest('.ovShowcaseProducts,.cpaVisualThumb')){img.hidden=true;img.parentElement.classList.add('isImageMissing');}},true);
    doc.addEventListener('bl:language-changed',schedule);
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)schedule();});
    new MutationObserver(schedule).observe(doc.body,{attributes:true,attributeFilter:['data-active-tab']});
    new MutationObserver(schedule).observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  return Object.assign(api,{update,updateCollection,renderMetricChart,onViewChanged:schedule});
});
