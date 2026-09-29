/* Genel Bakış · Aktif Sipariş Kırılımı.

   Eski dört ayrı modül (Ülke, Alt Üretici, Sezon, Buying Group) ve her birinin
   radar grafiği tek widget'ta birleşti. Radar, sıralı kategori karşılaştırması
   için yanlış biçimdi (farklı ölçekli eksenler aynı çokgende) ve CP Öncelik
   Radarı Üretim Odağı'ndaki öncelik çipleriyle aynı veriyi tekrar ediyordu.

   Biçimler:
   - Ülke / Alt Üretici: tek seri, sıralı yatay çubuk + pay yüzdesi.
   - Sezon: öncelik bileşimini gösteren yığılmış yatay çubuk (durum renkleri,
     her zaman lejant + metin etiketiyle; renk tek başına anlam taşımaz).
   - Buying Group: aktif sipariş çubuğu; adet/FOB metin olarak yanında
     (iki farklı ölçek tek eksende çizilmez).
   Tablo görünümü aynı widget'ta kalır; drill davranışı tablolarınkiyle aynıdır. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewBreakdown=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const STORAGE_KEY='buyerlog.overview.breakdown.v1';
  const DIMENSIONS=Object.freeze(['country','subManufacturer','season','buyingGroup']);
  const VIEWS=Object.freeze(['chart','table']);
  const DIM_LABELS=Object.freeze({
    country:{tr:'Ülke',en:'Country'},
    subManufacturer:{tr:'Alt Üretici',en:'Sub-Manufacturer'},
    season:{tr:'Sezon',en:'Season'},
    buyingGroup:{tr:'Buying Group',en:'Buying Group'},
  });
  /* Öncelik = durum paleti; kategorik renklerle karıştırılmaz. */
  const PRIORITY_TONES=Object.freeze({CRITICAL:'critical',ACTION_TODAY:'today',ACTION_THIS_WEEK:'week',WATCH:'watch',ON_TRACK:'ok',UNKNOWN:'unknown'});

  const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
  const esc=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
  function lang(){try{return (document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';}catch(_){return 'tr';}}
  function fmt(value,l){return Math.round(num(value)).toLocaleString(l==='en'?'en-GB':'tr-TR');}
  function pct(part,total){return total>0?Math.round(part/total*1000)/10:0;}
  function store(){try{return (typeof window!=='undefined'&&(window.BLStorage||window.localStorage))||null;}catch(_){return null;}}
  function readPrefs(){
    let saved={};try{saved=JSON.parse(store()?.getItem(STORAGE_KEY)||'{}')||{};}catch(_){saved={};}
    return {dim:DIMENSIONS.includes(saved.dim)?saved.dim:'country',view:VIEWS.includes(saved.view)?saved.view:'chart'};
  }
  function savePrefs(next){try{store()?.setItem(STORAGE_KEY,JSON.stringify({dim:next.dim,view:next.view}));}catch(_){}}

  /* ---- saf model yardımcıları (testlenir) ---- */
  function singleSeries(entries){
    const rows=(Array.isArray(entries)?entries:[]).map(entry=>Array.isArray(entry)?{label:clean(entry[0])||'—',value:num(entry[1])}:{label:clean(entry&&entry.label)||'—',value:num(entry&&entry.value)})
      .filter(row=>row.value>0).sort((a,b)=>b.value-a.value);
    const total=rows.reduce((sum,row)=>sum+row.value,0),max=rows.reduce((m,row)=>Math.max(m,row.value),0);
    return {rows:rows.map(row=>({...row,share:pct(row.value,total),ratio:max?row.value/max:0})),total,max};
  }
  function stackedSeries(rows,codes){
    const list=(Array.isArray(rows)?rows:[]).map(row=>({
      label:clean(row&&row.label)||'—',count:num(row&&row.count),qty:num(row&&row.qty),
      parts:(Array.isArray(codes)?codes:[]).map(code=>({code,value:num(row&&row.priorities&&row.priorities[code])})),
    })).filter(row=>row.count>0).sort((a,b)=>b.count-a.count);
    const max=list.reduce((m,row)=>Math.max(m,row.count),0);
    return {rows:list.map(row=>({...row,ratio:max?row.count/max:0})),max,total:list.reduce((sum,row)=>sum+row.count,0)};
  }
  function groupSeries(rows){
    const list=(Array.isArray(rows)?rows:[]).map(row=>({
      label:clean(row&&row.label)||'—',active:num(row&&row.active),total:num(row&&row.total),remaining:num(row&&row.remaining),totalQty:num(row&&row.totalQty),
      fobUsd:num(row&&row.fobUsd),fobTry:num(row&&row.fobTry),
    })).filter(row=>row.total>0).sort((a,b)=>b.active-a.active||b.total-a.total);
    const max=list.reduce((m,row)=>Math.max(m,row.active),0);
    return {rows:list.map(row=>({...row,ratio:max?row.active/max:0})),max,total:list.reduce((sum,row)=>sum+row.active,0)};
  }

  /* ---- çizim ---- */
  let lastModel=null;
  function host(){return typeof document!=='undefined'?document.getElementById('ovBreakdown'):null;}
  function empty(l){return `<div class="ovBreakdownEmpty">${esc(l==='en'?'No data for the active filters.':'Aktif filtrelerde veri yok.')}</div>`;}
  function barRow({label,ratio,valueText,subText,attrs,tooltip,segments}){
    const width=Math.max(ratio>0?1.5:0,Math.min(100,ratio*100));
    const inner=segments||`<span class="ovBdFill" style="width:${width.toFixed(2)}%"></span>`;
    return `<button type="button" class="ovBdRow" ${attrs||''} data-tip="${esc(tooltip)}"><span class="ovBdLabel" title="${esc(label)}">${esc(label)}</span><span class="ovBdTrack"${segments?` style="--bd-w:${width.toFixed(2)}%"`:''}>${inner}</span><span class="ovBdValue"><b>${esc(valueText)}</b>${subText?`<small>${esc(subText)}</small>`:''}</span></button>`;
  }
  function renderSingle(model,dim,l){
    const series=singleSeries(model&&model[dim]);if(!series.rows.length)return empty(l);
    const unit=l==='en'?'orders':'sipariş';
    const head=`<div class="ovBdSummary"><b>${fmt(series.total,l)}</b><span>${esc(l==='en'?'active orders':'aktif sipariş')} · ${series.rows.length} ${esc(DIM_LABELS[dim][l].toLocaleLowerCase(l==='en'?'en':'tr'))}</span></div>`;
    return head+`<div class="ovBdList">${series.rows.map(row=>barRow({
      label:row.label,ratio:row.ratio,valueText:fmt(row.value,l),subText:`%${String(row.share).replace('.',l==='en'?'.':',')}`,
      attrs:`data-bd-drill="${esc(dim)}" data-bd-label="${esc(row.label)}"`,tooltip:`${row.label} · ${fmt(row.value,l)} ${unit} · %${row.share}`,
    })).join('')}</div>`;
  }
  function renderSeason(model,l){
    const data=model&&model.season||{};const codes=Array.isArray(data.codes)?data.codes:[];const labels=data.labels||{};
    const series=stackedSeries(data.rows,codes);if(!series.rows.length)return empty(l);
    const legend=`<div class="ovBdLegend">${codes.map(code=>`<span><i class="ovBdTone--${PRIORITY_TONES[code]||'unknown'}"></i>${esc(labels[code]||code)}</span>`).join('')}</div>`;
    const list=series.rows.map(row=>{
      const segs=row.parts.filter(part=>part.value>0).map(part=>`<span class="ovBdSeg ovBdTone--${PRIORITY_TONES[part.code]||'unknown'}" style="flex:${part.value} 0 0" data-bd-seg="${esc(part.code)}" data-bd-label="${esc(row.label)}" data-tip="${esc(`${row.label} · ${labels[part.code]||part.code}: ${fmt(part.value,l)}`)}"></span>`).join('');
      return barRow({
        label:row.label,ratio:row.ratio,valueText:fmt(row.count,l),subText:`${fmt(row.qty,l)} ${l==='en'?'units':'adet'}`,
        attrs:`data-bd-drill="season" data-bd-label="${esc(row.label)}"`,tooltip:`${row.label} · ${fmt(row.count,l)} ${l==='en'?'orders':'sipariş'} · ${fmt(row.qty,l)} ${l==='en'?'units':'adet'}`,
        segments:`<span class="ovBdStack">${segs}</span>`,
      });
    }).join('');
    return `<div class="ovBdSummary"><b>${fmt(series.total,l)}</b><span>${esc(l==='en'?'active orders by season and priority':'sezon ve önceliğe göre aktif sipariş')}</span></div>${legend}<div class="ovBdList">${list}</div>`;
  }
  function renderGroups(model,l){
    const series=groupSeries(model&&model.buyingGroup);if(!series.rows.length)return empty(l);
    const list=series.rows.map(row=>{
      const fob=`$${fmt(row.fobUsd,l)}${row.fobTry?` + ${fmt(row.fobTry,l)} ₺`:''}`;
      return barRow({
        label:row.label,ratio:row.ratio,valueText:fmt(row.active,l),subText:`${fmt(row.remaining,l)} ${l==='en'?'left':'kalan'} · ${fob}`,
        attrs:'data-bd-static="1"',tooltip:`${row.label} · ${l==='en'?'Active':'Aktif'} ${fmt(row.active,l)} / ${fmt(row.total,l)} · ${l==='en'?'Remaining':'Kalan'} ${fmt(row.remaining,l)} / ${fmt(row.totalQty,l)} · ${l==='en'?'Active FOB':'Aktif FOB'} ${fob}`,
      });
    }).join('');
    return `<div class="ovBdSummary"><b>${fmt(series.total,l)}</b><span>${esc(l==='en'?'active orders by buying group':'buying group bazında aktif sipariş')}</span></div><div class="ovBdList">${list}</div>`;
  }
  function syncChrome(root,prefs,l){
    root.dataset.dim=prefs.dim;root.dataset.view=prefs.view;
    root.querySelectorAll('[data-breakdown-dim]').forEach(button=>{
      const on=button.dataset.breakdownDim===prefs.dim;button.classList.toggle('isActive',on);button.setAttribute('aria-selected',on?'true':'false');
      const label=DIM_LABELS[button.dataset.breakdownDim];if(label)button.textContent=label[l];
    });
    root.querySelectorAll('[data-breakdown-pane]').forEach(pane=>{pane.hidden=pane.dataset.breakdownPane!==prefs.dim;});
    const toggle=root.querySelector('[data-breakdown-view]');
    if(toggle){
      const table=prefs.view==='table';toggle.setAttribute('aria-pressed',table?'true':'false');
      const text=table?(l==='en'?'Chart':'Grafik'):(l==='en'?'Table':'Tablo');
      const span=toggle.querySelector('span');if(span)span.textContent=text;toggle.title=l==='en'?(table?'Show chart':'Show table'):(table?'Grafiği göster':'Tabloyu göster');
    }
  }
  function render(){
    const root=host();if(!root)return;
    const prefs=readPrefs(),l=lang(),chart=root.querySelector('#ovBreakdownChart');
    syncChrome(root,prefs,l);
    if(!chart)return;
    if(!lastModel){chart.innerHTML=empty(l);return;}
    chart.innerHTML=prefs.dim==='season'?renderSeason(lastModel,l):prefs.dim==='buyingGroup'?renderGroups(lastModel,l):renderSingle(lastModel,prefs.dim,l);
  }
  function update(model){lastModel=model&&typeof model==='object'?model:null;render();}
  function tooltipFor(root){
    let tip=root.querySelector('.ovBdTip');
    if(!tip){tip=document.createElement('div');tip.className='ovBdTip';tip.setAttribute('role','tooltip');tip.hidden=true;root.appendChild(tip);}
    return tip;
  }
  function bind(){
    const root=host();if(!root||root.dataset.bdBound)return;root.dataset.bdBound='1';
    root.addEventListener('click',event=>{
      const dimBtn=event.target.closest('[data-breakdown-dim]');
      if(dimBtn){const next=readPrefs();next.dim=dimBtn.dataset.breakdownDim;savePrefs(next);render();return;}
      const viewBtn=event.target.closest('[data-breakdown-view]');
      if(viewBtn){const next=readPrefs();next.view=next.view==='table'?'chart':'table';savePrefs(next);render();return;}
      const seg=event.target.closest('[data-bd-seg]');
      if(seg&&lastModel&&lastModel.drill&&typeof lastModel.drill.season==='function'){lastModel.drill.season(seg.dataset.bdLabel,seg.dataset.bdSeg);return;}
      const row=event.target.closest('[data-bd-drill]');
      if(row&&lastModel&&lastModel.drill&&typeof lastModel.drill[row.dataset.bdDrill]==='function')lastModel.drill[row.dataset.bdDrill](row.dataset.bdLabel,'');
    });
    root.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-breakdown-dim]');if(!tab||!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();const index=DIMENSIONS.indexOf(tab.dataset.breakdownDim),next=DIMENSIONS[(index+(event.key==='ArrowRight'?1:DIMENSIONS.length-1))%DIMENSIONS.length];
      const prefs=readPrefs();prefs.dim=next;savePrefs(prefs);render();root.querySelector(`[data-breakdown-dim="${next}"]`)?.focus();
    });
    const move=event=>{
      const target=event.target.closest('[data-tip]'),tip=tooltipFor(root);
      if(!target||!root.contains(target)){tip.hidden=true;return;}
      tip.textContent=target.dataset.tip;tip.hidden=false;
      const box=root.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
      tip.style.left=Math.max(6,Math.min(box.width-w-6,event.clientX-box.left+12))+'px';
      tip.style.top=Math.max(6,Math.min(box.height-h-6,event.clientY-box.top+14))+'px';
    };
    root.addEventListener('pointermove',move);
    root.addEventListener('pointerleave',()=>{const tip=root.querySelector('.ovBdTip');if(tip)tip.hidden=true;});
    document.addEventListener('bl:language-changed',render);
    render();
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  }
  return {STORAGE_KEY,DIMENSIONS,VIEWS,PRIORITY_TONES,readPrefs,savePrefs,singleSeries,stackedSeries,groupSeries,update,render};
});
