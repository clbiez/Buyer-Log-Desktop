'use strict';
(function(root,factory){root.BLOverviewCollectionDashboard=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function text(value){return String(value==null?'':value).trim();}
  function pct(value,total){return total>0?Math.round((Number(value)||0)*100/total):0;}
  function icon(id){return '<svg class="ic" aria-hidden="true"><use href="#'+id+'"/></svg>';}
  function columnCatalog(ctx){
    const seen=new Set();
    return (Array.isArray(ctx.columns)?ctx.columns:[]).map(function(column){
      const key=text(column&&column.k||column&&column.key);
      return {k:key,label:text(column&&column.label)||key};
    }).filter(function(column){if(!column.k||seen.has(column.k))return false;seen.add(column.k);return true;});
  }
  function scopeState(ctx){
    const saved=ctx.saved||{},columns=columnCatalog(ctx);
    const fallback=columns.find(function(column){return column.k==='inStoreMonth';})||columns[0]||{k:'inStoreMonth',label:'In Store Month'};
    const requested=text(saved.scopeColumn);
    const column=columns.find(function(item){return item.k===requested;})||fallback;
    const availableInfo=ctx.summary.availableColumns(ctx.rows,{columns:[column],valueFor:ctx.columnValue})[0]||{values:[]};
    const values=Array.isArray(availableInfo.values)?availableInfo.values.map(text).filter(Boolean):[];
    const requestedValues=Array.isArray(saved.scopeValues)?saved.scopeValues.map(text).filter(Boolean):[];
    const selected=requestedValues.filter(function(value){return values.includes(value);});
    const filters={};if(selected.length)filters[column.k]=selected;
    const result=ctx.summary.build(ctx.rows,{columnFilters:filters,columnValue:ctx.columnValue,isConfirmed:ctx.isConfirmed,fields:{month:'inStoreMonth',status:'durum',model:'modelKod'}});
    return {column:column,columns:columns,values:values,selected:selected,result:result};
  }
  function saveScope(ctx,column,values){
    const next=Object.assign({},ctx.saved||{},{scopeColumn:column.k,scopeValues:Array.isArray(values)?values.slice():[]});
    delete next.scopeSeason;
    ctx.savePrefs(next);
  }
  function valueSummary(ctx,scoped){
    if(!scoped.selected.length)return ctx.language==='en'?'All':'Tümü';
    if(scoped.selected.length<=2)return scoped.selected.join(' + ');
    return scoped.selected[0]+' +'+(scoped.selected.length-1);
  }
  let outsideHandler=null,viewportHandler=null,popoverHome=null,popoverFrame=0;
  function resetPopoverInlineLayout(pop){
    if(!pop)return;
    ['position','z-index','left','right','top','bottom','width','max-height','display','flex-direction'].forEach(function(name){pop.style.removeProperty(name);});
    const list=pop.querySelector('.ovCollectionScopeValueList');
    if(list){['min-height','flex','max-height'].forEach(function(name){list.style.removeProperty(name);});}
  }
  function restoreValuePopover(pop){
    if(!pop||!popoverHome)return;
    const parent=popoverHome.parent,next=popoverHome.next;
    if(parent&&parent.isConnected){
      if(next&&next.parentNode===parent)parent.insertBefore(pop,next);
      else parent.appendChild(pop);
    }
    popoverHome=null;
  }
  function positionValuePopover(pop,trigger){
    if(!pop||!trigger||pop.hidden)return;
    const margin=8,gap=5;
    const viewportWidth=Math.max(0,window.innerWidth||document.documentElement.clientWidth||0);
    const viewportHeight=Math.max(0,window.innerHeight||document.documentElement.clientHeight||0);
    const rect=trigger.getBoundingClientRect();
    const width=Math.min(350,Math.max(0,viewportWidth-(margin*2)));
    const maxHeight=Math.max(0,viewportHeight-(margin*2));
    pop.style.position='fixed';
    pop.style.zIndex='560';
    pop.style.right='auto';
    pop.style.bottom='auto';
    pop.style.width=width+'px';
    pop.style.maxHeight=maxHeight+'px';
    pop.style.display='flex';
    pop.style.flexDirection='column';
    const list=pop.querySelector('.ovCollectionScopeValueList');
    if(list){list.style.minHeight='0';list.style.flex='1 1 auto';list.style.maxHeight='none';}
    const height=Math.min(pop.getBoundingClientRect().height,maxHeight);
    const below=viewportHeight-rect.bottom-gap-margin,above=rect.top-gap-margin;
    let top=(below>=height||below>=above)?rect.bottom+gap:rect.top-gap-height;
    top=Math.max(margin,Math.min(top,viewportHeight-margin-height));
    const left=Math.max(margin,Math.min(rect.right-width,viewportWidth-margin-width));
    pop.style.top=top+'px';
    pop.style.left=left+'px';
  }
  function scheduleValuePopoverPosition(pop,trigger){
    if(popoverFrame)cancelAnimationFrame(popoverFrame);
    popoverFrame=requestAnimationFrame(function(){popoverFrame=0;positionValuePopover(pop,trigger);});
  }
  function closeValuePopover(){
    const pop=document.getElementById('ovCollectionSummaryScopePopover'),trigger=document.getElementById('ovCollectionSummaryScopeTrigger');
    if(pop)pop.hidden=true;
    if(trigger)trigger.setAttribute('aria-expanded','false');
    if(outsideHandler){document.removeEventListener('pointerdown',outsideHandler,true);outsideHandler=null;}
    if(viewportHandler){
      window.removeEventListener('resize',viewportHandler);
      window.removeEventListener('scroll',viewportHandler,true);
      viewportHandler=null;
    }
    if(popoverFrame){cancelAnimationFrame(popoverFrame);popoverFrame=0;}
    restoreValuePopover(pop);
    resetPopoverInlineLayout(pop);
  }
  function openValuePopover(ctx,scoped){
    const pop=document.getElementById('ovCollectionSummaryScopePopover'),trigger=document.getElementById('ovCollectionSummaryScopeTrigger');
    if(!pop||!trigger)return;
    if(!pop.hidden){closeValuePopover();return;}
    const selected=new Set(scoped.selected),columnLabel=ctx.label(scoped.column.label||scoped.column.k);
    pop.innerHTML=
      '<div class="ovCollectionScopePopoverHead"><b>'+esc(columnLabel)+'</b><button type="button" data-scope-clear>'+(ctx.language==='en'?'Clear':'Temizle')+'</button></div>'+
      '<input type="search" class="ovCollectionScopeSearch" data-scope-search placeholder="'+esc(ctx.language==='en'?'Search values':'Değer ara')+'">'+
      '<div class="ovCollectionScopeValueList">'+
      (scoped.values.length?scoped.values.map(function(value){return '<label data-scope-row><input type="checkbox" value="'+esc(value)+'"'+(selected.has(value)?' checked':'')+'><span>'+esc(value)+'</span></label>';}).join(''):'<div class="ovCollectionScopeEmpty">'+esc(ctx.language==='en'?'No values in this column.':'Bu sütunda değer yok.')+'</div>')+
      '</div>'+
      '<div class="ovCollectionScopePopoverFoot"><button type="button" class="tbtn" data-scope-cancel>'+(ctx.language==='en'?'Cancel':'Vazgeç')+'</button><button type="button" class="tbtn primary" data-scope-apply>'+(ctx.language==='en'?'Apply':'Uygula')+'</button></div>';
    if(!popoverHome)popoverHome={parent:pop.parentNode,next:pop.nextSibling};
    document.body.appendChild(pop);
    pop.hidden=false;
    trigger.setAttribute('aria-expanded','true');
    pop.onclick=function(event){event.stopPropagation();};
    positionValuePopover(pop,trigger);
    viewportHandler=function(){scheduleValuePopoverPosition(pop,trigger);};
    window.addEventListener('resize',viewportHandler,{passive:true});
    window.addEventListener('scroll',viewportHandler,true);
    const search=pop.querySelector('[data-scope-search]');
    if(search)search.oninput=function(){const q=text(search.value).toLocaleLowerCase(ctx.language==='en'?'en':'tr');Array.from(pop.querySelectorAll('[data-scope-row]')).forEach(function(row){row.hidden=!text(row.textContent).toLocaleLowerCase(ctx.language==='en'?'en':'tr').includes(q);});};
    const clear=pop.querySelector('[data-scope-clear]');if(clear)clear.onclick=function(){Array.from(pop.querySelectorAll('input[type="checkbox"]')).forEach(function(input){input.checked=false;});};
    const cancel=pop.querySelector('[data-scope-cancel]');if(cancel)cancel.onclick=closeValuePopover;
    const apply=pop.querySelector('[data-scope-apply]');if(apply)apply.onclick=function(){
      const values=Array.from(pop.querySelectorAll('input[type="checkbox"]:checked')).map(function(input){return input.value;});
      saveScope(ctx,scoped.column,values);closeValuePopover();ctx.onRender();
    };
    setTimeout(function(){
      outsideHandler=function(event){if(!pop.contains(event.target)&&!trigger.contains(event.target))closeValuePopover();};
      document.addEventListener('pointerdown',outsideHandler,true);if(search)search.focus();
    },0);
  }
  function openColumnDrawer(ctx,scoped){
    closeValuePopover();document.getElementById('_ovCollectionScopeColumnDrawer')?.remove();
    const overlay=document.createElement('div');overlay.id='_ovCollectionScopeColumnDrawer';overlay.className='ovCollectionScopeDrawerOverlay';
    const current=scoped.column.k;
    overlay.innerHTML=
      '<aside class="ovCollectionScopeDrawer" role="dialog" aria-modal="true" aria-label="'+esc(ctx.language==='en'?'Collection summary filter column':'Koleksiyon özeti filtre sütunu')+'">'+
      '<div class="ovCollectionScopeDrawerHead"><div><b>'+esc(ctx.language==='en'?'Filter column':'Filtre sütunu')+'</b><span>'+esc(ctx.language==='en'?'Choose any Collection column.':'Koleksiyon sütunlarından birini seç.')+'</span></div><button type="button" data-scope-drawer-close aria-label="'+esc(ctx.language==='en'?'Close':'Kapat')+'">×</button></div>'+
      '<div class="ovCollectionScopeDrawerSearch"><input type="search" data-scope-column-search placeholder="'+esc(ctx.language==='en'?'Search columns':'Sütun ara')+'"></div>'+
      '<div class="ovCollectionScopeColumnList">'+scoped.columns.map(function(column){const label=ctx.label(column.label||column.k);return '<button type="button" data-scope-column="'+esc(column.k)+'"'+(column.k===current?' class="isActive"':'')+'><span>'+esc(label)+'</span>'+(column.k===current?'<i>✓</i>':'')+'</button>';}).join('')+'</div>'+
      '</aside>';
    document.body.appendChild(overlay);
    const close=function(){overlay.remove();};overlay.addEventListener('click',function(event){if(event.target===overlay)close();});
    overlay.querySelector('[data-scope-drawer-close]')?.addEventListener('click',close);
    const search=overlay.querySelector('[data-scope-column-search]');
    if(search)search.addEventListener('input',function(){const q=text(search.value).toLocaleLowerCase(ctx.language==='en'?'en':'tr');Array.from(overlay.querySelectorAll('[data-scope-column]')).forEach(function(button){button.hidden=!text(button.textContent).toLocaleLowerCase(ctx.language==='en'?'en':'tr').includes(q);});});
    Array.from(overlay.querySelectorAll('[data-scope-column]')).forEach(function(button){button.addEventListener('click',function(){
      const column=scoped.columns.find(function(item){return item.k===button.dataset.scopeColumn;});if(!column)return;
      saveScope(ctx,column,[]);close();ctx.onRender();
    });});
    setTimeout(function(){search?.focus();},0);
  }
  function render(ctx){
    if(!ctx||!ctx.root||!ctx.summary)return;
    const scoped=scopeState(ctx),result=scoped.result,total=Number(result.kpi.total)||0,locale=ctx.language==='en'?'en-GB':'tr-TR';
    closeValuePopover();
    const scopeLabel=document.getElementById('ovCollectionSummaryScopeLabel'),scopeTrigger=document.getElementById('ovCollectionSummaryScopeTrigger');
    const columnLabel=ctx.label(scoped.column.label||scoped.column.k);
    if(scopeLabel){
      const hint=ctx.language==='en'?'Double-click to change the Collection filter column':'Collection filtre sütununu değiştirmek için çift tıkla';
      scopeLabel.textContent=columnLabel;scopeLabel.title=hint;scopeLabel.setAttribute('aria-label',columnLabel+'. '+hint);
      scopeLabel.ondblclick=function(event){event.preventDefault();openColumnDrawer(ctx,scoped);};
      scopeLabel.onkeydown=function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();openColumnDrawer(ctx,scoped);}};
    }
    if(scopeTrigger){
      scopeTrigger.disabled=!scoped.values.length;
      scopeTrigger.innerHTML='<span id="ovCollectionSummaryScopeValue">'+esc(valueSummary(ctx,scoped))+'</span><span class="ovCollectionScopeChevron" aria-hidden="true">▾</span>';
      scopeTrigger.setAttribute('aria-label',(ctx.language==='en'?'Filter values for ':'Filtre değerleri: ')+columnLabel);
      scopeTrigger.onclick=function(event){event.preventDefault();event.stopPropagation();openValuePopover(ctx,scoped);};
    }
    const intro=document.getElementById('ovCollectionSummaryIntro');
    if(intro)intro.textContent=ctx.language==='en'?'Collection health at a glance. Double-click the filter title to change column; select one or more values.':'Koleksiyonun durumunu tek bakışta gör. Filtre sütununu değiştirmek için başlığa çift tıkla; bir veya daha fazla değer seç.';
    const meta=document.getElementById('ovCollectionSummaryScopeMeta');
    if(meta)meta.textContent=columnLabel+' · '+valueSummary(ctx,scoped)+' · '+total.toLocaleString(locale)+' '+(ctx.language==='en'?'models':'model');
    const kpi=document.getElementById('ovCollectionSummaryKpi');
    if(kpi){
      const items=[
        {key:'total',label:ctx.language==='en'?'Total Models':'Toplam Model',value:result.kpi.total,icon:'i-table',tone:'neutral'},
        {key:'optionCount',label:ctx.language==='en'?'Total Options':'Toplam Opsiyon',value:result.kpi.optionCount,icon:'i-columns-3',tone:'blue'},
        {key:'confirmed',label:ctx.language==='en'?'Confirmed':'Onaylı',value:result.kpi.confirmed,ratio:pct(result.kpi.confirmed,total),icon:'i-checklist',tone:'green'},
        {key:'notConfirmed',label:ctx.language==='en'?'Not Confirmed':'Onaysız',value:result.kpi.notConfirmed,ratio:pct(result.kpi.notConfirmed,total),icon:'i-notebook',tone:'amber'}
      ];
      kpi.innerHTML=items.map(function(item){return '<button type="button" class="ovCollectionKpiCard tone-'+item.tone+'" data-summary-drill="'+item.key+'"><span class="ovCollectionKpiIcon">'+icon(item.icon)+'</span><span class="ovCollectionKpiCopy"><b>'+Number(item.value||0).toLocaleString(locale)+(item.ratio==null?'':' <em>'+item.ratio+'%</em>')+'</b><span>'+esc(item.label)+'</span></span></button>';}).join('');
      Array.from(kpi.querySelectorAll('[data-summary-drill]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({scopeColumn:scoped.column.k,scopeValues:scoped.selected,kpi:button.dataset.summaryDrill});});});
    }
    const host=document.getElementById('ovCollectionSummaryStatusDistribution'),bar=document.getElementById('ovCollectionSummaryDistributionBar'),order=new Map((ctx.statusCatalog||[]).map(function(entry,index){return [String(entry.name),index];})),totalOptions=Number(result.kpi.optionCount)||0;
    const rows=(result.rows||[]).slice().sort(function(a,b){const ai=order.has(a.status)?order.get(a.status):9999,bi=order.has(b.status)?order.get(b.status):9999;return ai-bi||String(a.status).localeCompare(String(b.status),'tr-TR',{sensitivity:'base'});});
    /* Renk verilmemiş (varsayılan gri) statüler dağılımda birbirinden ayrılsın:
       yalnız görselleştirmede tema tokenlarından sıralı renk atanır; katalog
       verisi ve Excel renkleri değişmez. */
    const VIS_PALETTE=['var(--acc)','var(--green)','var(--orange)','var(--purple,#5e4f8c)','var(--teal,#33685c)','var(--red)','var(--blue-lite,var(--acc))'];
    const visColor=function(status,index){const c=ctx.statusColor(status);return (!c||/^#667085$/i.test(String(c)))?VIS_PALETTE[index%VIS_PALETTE.length]:c;};
    const colorByStatus=new Map(rows.map(function(row,index){return [row.status,visColor(row.status,index)];}));
    if(bar){
      bar.innerHTML=rows.map(function(row){const share=pct(row.optionCount,totalOptions),color=colorByStatus.get(row.status);return '<button type="button" class="ovCollectionDistributionSegment" data-summary-status="'+esc(row.status)+'" style="--status-color:'+esc(color)+';width:'+share+'%" title="'+esc(ctx.statusLabel(row.status)+' · '+share+'%')+'"></button>';}).join('');
      Array.from(bar.querySelectorAll('[data-summary-status]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({scopeColumn:scoped.column.k,scopeValues:scoped.selected,status:button.dataset.summaryStatus});});});
    }
    if(host){
      host.innerHTML=rows.length?rows.map(function(row){const share=pct(row.optionCount,totalOptions),color=colorByStatus.get(row.status);return '<button type="button" class="ovCollectionStatusCard" data-summary-status="'+esc(row.status)+'" style="--status-color:'+esc(color)+'"><span class="ovCollectionStatusDot"></span><span class="ovCollectionStatusName">'+esc(ctx.statusLabel(row.status))+'</span><b>'+Number(row.optionCount||0).toLocaleString(locale)+'</b><span class="ovCollectionStatusShare">'+share+'%</span><span class="ovCollectionStatusOptions">'+Number(row.modelCount||0).toLocaleString(locale)+' '+(ctx.language==='en'?'models':'model')+'</span><span class="ovCollectionStatusTrack"><i style="width:'+share+'%"></i></span></button>';}).join(''):'<div class="ovCollectionSummaryEmpty">'+esc(ctx.language==='en'?'No Collection models in this scope.':'Bu kapsamda Koleksiyon modeli yok.')+'</div>';
      Array.from(host.querySelectorAll('[data-summary-status]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({scopeColumn:scoped.column.k,scopeValues:scoped.selected,status:button.dataset.summaryStatus});});});
    }
  }
  return {render:render,openColumnDrawer:openColumnDrawer,scopeState:scopeState};
});
