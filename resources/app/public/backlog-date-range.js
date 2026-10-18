(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLBacklogDateRange=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const DAY=86400000;
  function day(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return null;
    const value=new Date(iso+'T00:00:00Z');
    return Number.isFinite(+value)&&value.toISOString().slice(0,10)===iso?value:null;
  }
  const iso=d=>d.toISOString().slice(0,10);
  const add=(d,n)=>new Date(+d+n*DAY);
  const monthEnd=d=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));
  function move(value,unit,n){
    const d=day(value);if(!d)return '';
    if(unit!=='month')return iso(add(d,n*(unit==='week'?7:1)));
    const target=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1));
    const end=monthEnd(target).getUTCDate();
    target.setUTCDate(d.getUTCDate()===monthEnd(d).getUTCDate()?end:Math.min(d.getUTCDate(),end));
    return iso(target);
  }
  function shift(range,unit,n){return {from:move(range.from,unit,n),to:move(range.to,unit,n)};}
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function preset(kind,now=today()){
    const d=day(now);
    if(kind==='week'){const start=add(d,-((d.getUTCDay()+6)%7));return {from:iso(start),to:iso(add(start,6))};}
    if(kind==='month')return {from:iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))),to:iso(monthEnd(d))};
    return {from:now,to:iso(add(d,29))};
  }
  function periodStart(value,unit){
    const d=day(value);
    if(unit==='month')return iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)));
    if(unit==='week')return iso(add(d,-((d.getUTCDay()+6)%7)));
    return value;
  }
  // Boundary indices let months, weeks and days have equal visual widths.
  function axis(range,unit){
    const defaults=preset('month');
    const from=range.from||range.to||defaults.from,to=range.to||range.from||defaults.to;
    const margin=unit==='month'?6:unit==='week'?8:14;
    const origin=move(periodStart(from,unit),unit,-margin),last=periodStart(to,unit);
    const a=day(origin),b=day(last);
    const distance=unit==='month'?(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth():Math.round((+b-a)/DAY/(unit==='week'?7:1));
    // Calculate boundaries on demand, even for a range spanning many years.
    return {at:index=>move(origin,unit,index),count:distance+margin+2,start:margin,end:distance+1};
  }
  const FIELDS={mb:{ids:['backlogInStoreFrom','backlogInStoreTo'],tr:'MB tarihi',en:'MB date'},ex:{ids:['backlogExFactoryFrom','backlogExFactoryTo'],tr:'Exfactory tarihi',en:'Exfactory date'},retail:{ids:['backlogFrom','backlogTo'],tr:'Retail depo tarihi',en:'Retail warehouse date'}};
  const KEY='lcw.backlog.dateRange.v1';
  let selected='mb',unit='week',host,apply,scale,drafts={},mounted=false,reportState='ready';
  const en=()=>document.documentElement.lang==='en';
  const L=(tr,english)=>en()?english:tr;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=id=>document.getElementById(id)?.value||'';
  function current(field=selected){const ids=FIELDS[field].ids;return {from:value(ids[0]),to:value(ids[1])};}
  function draft(){return drafts[selected]||current();}
  function active(){return document.body.dataset.activeTab==='backlog';}
  function save(){try{(window.BLStorage||localStorage).setItem(KEY,JSON.stringify({selected,unit}));}catch(_){}}
  function fmt(v){return day(v)?new Intl.DateTimeFormat(en()?'en-GB':'tr-TR',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(day(v)):'…';}
  function valid(r){return (!r.from||!!day(r.from))&&(!r.to||!!day(r.to))&&(!r.from||!r.to||r.from<=r.to);}
  function changed(){return Object.keys(drafts).some(field=>JSON.stringify(drafts[field])!==JSON.stringify(current(field)));}
  function setDraft(r){drafts[selected]=r;render();}
  function button(text,attrs=''){return `<button type="button" class="tbtn" ${attrs}>${text}</button>`;}
  function updatePreview(){
    const r=draft(),ok=valid(r),status=host.querySelector('[data-range-status]');
    status.textContent=!ok?L('Başlangıç, bitişten sonra olamaz.','Start must be on or before end.'):(r.from||r.to)?`${fmt(r.from)} → ${fmt(r.to)}${r.from&&r.to?' · '+(Math.round((+day(r.to)-day(r.from))/DAY)+1)+' '+L('gün','days'):''}`:L('Tüm tarihler · kaydırarak bir aralık seçin','All dates · slide to select a range');
    if(ok&&reportState==='loading')status.textContent+=' · '+L('Rapor güncelleniyor…','Updating report…');
    if(ok&&reportState==='error')status.textContent=L('Rapor güncellenemedi. Uygula ile yeniden deneyin.','Report update failed. Select Apply to retry.');
    status.classList.toggle('is-error',!ok||reportState==='error');
    host.setAttribute('aria-busy',String(reportState==='loading'));
    host.querySelector('[data-range-apply]').disabled=(!changed()&&reportState!=='error')||Object.values(drafts).some(r=>!valid(r));
    host.querySelector('[data-range-cancel]').hidden=!changed();
    const a=host.querySelector('[data-range-thumb="from"]'),b=host.querySelector('[data-range-thumb="to"]');
    const rail=host.querySelector('.backlogDateRail');
    rail.style.setProperty('--range-start',`${Number(a.value)/a.max*100}%`);
    rail.style.setProperty('--range-end',`${Number(b.value)/b.max*100}%`);
    a.setAttribute('aria-valuetext',fmt(r.from));b.setAttribute('aria-valuetext',fmt(r.to));
  }
  function render(){
    if(!host||!active())return;
    const focused=host.contains(document.activeElement)?[...document.activeElement.attributes].find(a=>/^data-range-(field|unit|shift|preset|clear|apply|cancel)$/.test(a.name)):null;
    const optionsOpen=host.querySelector('[data-range-options]')?.open||false;
    const activeCount=Object.keys(FIELDS).filter(key=>current(key).from||current(key).to).length;
    const r=draft();scale=axis(valid(r)?r:{},unit);
    const max=scale.count-1;
    host.innerHTML=`<div class="backlogDateTop">
      <strong class="backlogDateTitle"><svg class="ic"><use href="#i-calendar"/></svg>${L('Tarih aralığı','Date range')}</strong>
      <div class="bpaSeg2" role="group" aria-label="${L('Tarih türü','Date field')}">${Object.entries(FIELDS).map(([key,f])=>`<button type="button" data-range-field="${key}" aria-pressed="${selected===key}">${en()?f.en:f.tr}${current(key).from||current(key).to?' •':''}</button>`).join('')}</div>
      <span class="backlogDateSpacer"></span>
      <div class="bpaSeg2" role="group" aria-label="${L('Kaydırma adımı','Shift step')}">${[['day','Gün','Day'],['week','Hafta','Week'],['month','Ay','Month']].map(([key,tr,english])=>`<button type="button" data-range-unit="${key}" aria-pressed="${unit===key}">${L(tr,english)}</button>`).join('')}</div>
    </div>
    <div class="backlogDateControls">
      <label>${L('Başlangıç','Start')}<input type="date" data-range-input="from" value="${esc(r.from)}" max="9999-12-31"></label>
      ${button('←',`data-range-shift="-1" aria-label="${L('Aralığı bir adım geri taşı','Shift range one step back')}"`)}
      <div class="backlogDateTimeline">
        <div class="backlogDateRail"><div class="backlogDateSelection"></div>
          <input type="range" min="0" max="${max}" value="${scale.start}" data-range-thumb="from" aria-label="${L('Başlangıç tarihini kaydır','Slide start date')}">
          <input type="range" min="0" max="${max}" value="${scale.end}" data-range-thumb="to" aria-label="${L('Bitiş tarihini kaydır','Slide end date')}">
        </div>
        <div class="backlogDateTicks"><span>${fmt(scale.at(0))}</span><span>${L('Tutamakları sürükle · oklarla aralığı taşı','Drag handles · use arrows to shift range')}</span><span>${fmt(scale.at(max))}</span></div>
      </div>
      ${button('→',`data-range-shift="1" aria-label="${L('Aralığı bir adım ileri taşı','Shift range one step forward')}"`)}
      <label>${L('Bitiş','End')}<input type="date" data-range-input="to" value="${esc(r.to)}" max="9999-12-31"></label>
      ${button(L('Uygula','Apply'),'data-range-apply')}${button(L('Vazgeç','Cancel'),'data-range-cancel hidden')}
    </div>
    <div class="backlogDateBottom"><details class="backlogDateOptions" data-range-options ${optionsOpen?'open':''}><summary>${L('Kısayollar / filtreler','Presets / filters')}${activeCount?' ('+activeCount+')':''}</summary><div class="backlogDateOptionsBody"><div class="backlogDatePresets">${[['week','Bu hafta','This week'],['month','Bu ay','This month'],['next30','Önümüzdeki 30 gün','Next 30 days']].map(([key,tr,english])=>button(L(tr,english),`data-range-preset="${key}"`)).join('')}${button(L('Tüm tarihler','All dates'),'data-range-preset="all"')}</div>
    <div class="backlogDateActive">${Object.entries(FIELDS).filter(([key])=>{const r=current(key);return r.from||r.to;}).map(([key,f])=>button(`${en()?f.en:f.tr}: ${fmt(current(key).from)} → ${fmt(current(key).to)} ×`,`data-range-clear="${key}" aria-label="${esc((en()?f.en:f.tr)+' · '+L('Filtreyi kaldır','Remove filter'))}"`)).join('')}</div>
    <details class="backlogDateHelp"><summary>${L('Nasıl çalışır?','How does it work?')}</summary><p>${L('Gün / hafta / ay, kaydırıcı adımını belirler. Başlangıç ve bitiş dahil edilir; boş uç sınırsızdır. Birden fazla tarih türündeki filtreler birlikte uygulanır. MB, model bütçe; Exfactory, güncel/revize yükleme; Retail, depo hedef tarihidir. Seçimleri Uygula ile rapora aktarın.','Day / week / month sets the slider step. Start and end are inclusive; an empty end is unbounded. Filters on multiple date fields apply together. MB is model budget; Exfactory is the current/revised shipment date; Retail is the warehouse target date. Apply sends your selections to the report.')}</p></details></div></details><output data-range-status aria-live="polite"></output></div>`;
    updatePreview();
    if(focused)host.querySelector(`[${focused.name}="${focused.value}"]`)?.focus({preventScroll:true});
  }
  function sync(){
    reportState='ready';
    // Retain an unsaved draft while an earlier report request finishes.
    if(!changed())drafts={};
    render();
  }
  function requestState(state){reportState=state;if(host?.firstElementChild&&active())updatePreview();}
  function mount(options){
    if(mounted)return;mounted=true;apply=options.apply;host=document.getElementById('backlogDateRange');if(!host)return;
    try{const saved=JSON.parse((window.BLStorage||localStorage).getItem(KEY)||'{}');if(FIELDS[saved.selected])selected=saved.selected;if(['day','week','month'].includes(saved.unit))unit=saved.unit;}catch(_){}
    host.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||!host.contains(b))return;
      if(b.dataset.rangeField){selected=b.dataset.rangeField;save();render();}
      else if(b.dataset.rangeUnit){unit=b.dataset.rangeUnit;save();render();}
      else if(b.dataset.rangeShift){const r=draft();setDraft(shift(r.from||r.to?r:preset(unit==='day'?'next30':unit),unit,Number(b.dataset.rangeShift)));}
      else if(b.dataset.rangePreset)setDraft(b.dataset.rangePreset==='all'?{from:'',to:''}:preset(b.dataset.rangePreset));
      else if(b.hasAttribute('data-range-cancel')){drafts={};render();}
      else if(b.dataset.rangeClear){drafts[b.dataset.rangeClear]={from:'',to:''};commit([b.dataset.rangeClear]);}
      else if(b.hasAttribute('data-range-apply')){
        for(const native of host.querySelectorAll('input[type="date"][data-range-input]')){
          const display=native._dateDisplayInput;
          if(display&&typeof window.commitEnhancedDateDisplay==='function'&&!window.commitEnhancedDateDisplay(display,true)){display.focus();return;}
        }
        commit();
      }
    });
    host.addEventListener('change',event=>{
      const input=event.target._nativeDateInput||event.target;
      if(input.dataset.rangeInput){
        drafts[selected]={...draft(),[input.dataset.rangeInput]:input.value};
        scale=axis(valid(draft())?draft():{},unit);
        const a=host.querySelector('[data-range-thumb="from"]'),b=host.querySelector('[data-range-thumb="to"]');
        a.max=b.max=scale.count-1;a.value=scale.start;b.value=scale.end;
        const ticks=host.querySelector('.backlogDateTicks');
        ticks.firstElementChild.textContent=fmt(scale.at(0));ticks.lastElementChild.textContent=fmt(scale.at(scale.count-1));
        updatePreview();
      }
    });
    host.addEventListener('input',event=>{
      const input=event.target,key=input.dataset.rangeThumb;if(!key)return;
      const a=host.querySelector('[data-range-thumb="from"]'),b=host.querySelector('[data-range-thumb="to"]');
      if(key==='from')a.value=Math.min(Number(a.value),Number(b.value)-1);
      else b.value=Math.max(Number(b.value),Number(a.value)+1);
      drafts[selected]={from:scale.at(Number(a.value)),to:iso(add(day(scale.at(Number(b.value))),-1))};
      ['from','to'].forEach(key=>{
        const native=host.querySelector(`input[type="date"][data-range-input="${key}"]`);
        native.value=draft()[key];window.syncEnhancedDateDisplay?.(native);
      });
      updatePreview();
    });
    new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    render();
  }
  function commit(fields=Object.keys(drafts)){
    if(fields.some(field=>!valid(drafts[field])))return;
    fields.forEach(field=>{
      const r=drafts[field];
      FIELDS[field].ids.forEach((id,index)=>{const el=document.getElementById(id);el.value=index?r.to:r.from;el.dispatchEvent(new Event('change',{bubbles:true}));});
      delete drafts[field];
    });
    render();apply();
  }
  return {day,shift,preset,axis,mount,sync,requestState};
});
