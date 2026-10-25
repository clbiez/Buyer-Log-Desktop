'use strict';
(function(root,factory){root.BLOverviewCollectionDashboard=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function text(value){return String(value==null?'':value).trim();}
  function pct(value,total){return total>0?Math.round((Number(value)||0)*100/total):0;}
  function columnCatalog(ctx){
    const seen=new Set();
    return (Array.isArray(ctx.columns)?ctx.columns:[]).map(function(column){
      const key=text(column&&column.k||column&&column.key);
      return {k:key,label:text(column&&column.label)||key};
    }).filter(function(column){if(!column.k||seen.has(column.k))return false;seen.add(column.k);return true;});
  }
  function scopeColumnLabel(ctx,column){
    const original=text(column&&column.label||column&&column.k);
    const resolved=typeof ctx.label==='function'?text(ctx.label(original)):original;
    // Yalnız standart MB başlığını çevir; kullanıcıya özel sütun etiketleri saklı kalır.
    if(column&&column.k==='inStoreMonth'&&
      (resolved==='Model Budget Month'||resolved==='Model Bütçe Ayı'))
      return ctx.language==='en'?'Model Budget Month':'Model Bütçe Ayı';
    return resolved;
  }
  function scopeState(ctx){
    const saved=ctx.saved||{},columns=columnCatalog(ctx);
    const fallback=columns.find(function(column){return column.k==='inStoreMonth';})||columns[0]||{k:'inStoreMonth',label:'Model Budget Month'};
    const requested=text(saved.scopeColumn);
    const column=columns.find(function(item){return item.k===requested;})||fallback;
    const availableInfo=ctx.summary.availableColumns(ctx.rows,{columns:[column],valueFor:ctx.columnValue})[0]||{values:[]};
    const values=Array.isArray(availableInfo.values)?availableInfo.values.map(text).filter(Boolean):[];
    if(column.k==='inStoreMonth'&&typeof ctx.summary.monthParts==='function'){
      const rank=value=>{const parts=ctx.summary.monthParts(value);return parts?parts.year*12+parts.month:null;};
      values.sort(function(a,b){
        const am=rank(a),bm=rank(b);
        return am==null?(bm==null?a.localeCompare(b,'tr-TR',{numeric:true}):1):bm==null?-1:bm-am||a.localeCompare(b,'tr-TR',{numeric:true});
      });
    }
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
  function scopeValueLabel(ctx,column,value){
    if(column.k!=='inStoreMonth'||typeof ctx.summary.monthParts!=='function')return value;
    const parts=ctx.summary.monthParts(value);
    return parts?monthLabel({month:value,year:parts.year,monthNumber:parts.month},ctx.language==='en'?'en-GB':'tr-TR',ctx.language==='en'):value;
  }
  function valueSummary(ctx,scoped){
    if(!scoped.selected.length)return ctx.language==='en'?'All':'Tümü';
    const names=[...new Set(scoped.selected.map(function(value){return scopeValueLabel(ctx,scoped.column,value);}))];
    if(names.length<=2)return names.join(' + ');
    return names[0]+' +'+(names.length-1);
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
    const selected=new Set(scoped.selected),columnLabel=scopeColumnLabel(ctx,scoped.column);
    pop.innerHTML=
      '<div class="ovCollectionScopePopoverHead"><b>'+esc(columnLabel)+'</b><button type="button" data-scope-clear>'+(ctx.language==='en'?'Clear':'Temizle')+'</button></div>'+
      '<input type="search" class="ovCollectionScopeSearch" data-scope-search placeholder="'+esc(ctx.language==='en'?'Search values':'Değer ara')+'">'+
      '<div class="ovCollectionScopeValueList">'+
      (scoped.values.length?scoped.values.map(function(value){return '<label data-scope-row><input type="checkbox" value="'+esc(value)+'"'+(selected.has(value)?' checked':'')+'><span>'+esc(scopeValueLabel(ctx,scoped.column,value))+'</span></label>';}).join(''):'<div class="ovCollectionScopeEmpty">'+esc(ctx.language==='en'?'No values in this column.':'Bu sütunda değer yok.')+'</div>')+
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
      '<div class="ovCollectionScopeColumnList">'+scoped.columns.map(function(column){const label=scopeColumnLabel(ctx,column);return '<button type="button" data-scope-column="'+esc(column.k)+'"'+(column.k===current?' class="isActive"':'')+'><span>'+esc(label)+'</span>'+(column.k===current?'<i>✓</i>':'')+'</button>';}).join('')+'</div>'+
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
    const columnLabel=scopeColumnLabel(ctx,scoped.column);
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
    const order=new Map((ctx.statusCatalog||[]).map(function(entry,index){return [String(entry.name),index];}));
    const rows=(result.rows||[]).slice().sort(function(a,b){const ai=order.has(a.status)?order.get(a.status):9999,bi=order.has(b.status)?order.get(b.status):9999;return ai-bi||String(a.status).localeCompare(String(b.status),'tr-TR',{sensitivity:'base'});});
    /* Renk verilmemiş (varsayılan gri) statüler dağılımda birbirinden ayrılsın:
       yalnız görselleştirmede tema tokenlarından sıralı renk atanır; katalog
       verisi ve Excel renkleri değişmez. */
    const VIS_PALETTE=['var(--acc)','var(--green)','var(--orange)','var(--purple,#5e4f8c)','var(--teal,#33685c)','var(--red)','var(--blue-lite,var(--acc))'];
    const visColor=function(status,index){const c=ctx.statusColor(status);return (!c||/^#667085$/i.test(String(c)))?VIS_PALETTE[index%VIS_PALETTE.length]:c;};
    const colorByStatus=new Map(rows.map(function(row,index){return [row.status,visColor(row.status,index)];}));
    const rank=function(status){return order.has(status)?order.get(status):9999;};
    const drill=function(extra){ctx.drill(Object.assign({scopeColumn:scoped.column.k,scopeValues:scoped.selected},extra));};
    const legend=document.getElementById('ovCollectionSummaryLegend');
    if(legend){
      legend.innerHTML=rows.map(function(row){return '<button type="button" class="ovCollectionMonthLegendItem" data-summary-status="'+esc(row.status)+'" style="--ui-series-color:'+esc(colorByStatus.get(row.status))+'"><i></i>'+esc(ctx.statusLabel(row.status))+'</button>';}).join('');
      Array.from(legend.querySelectorAll('[data-summary-status]')).forEach(function(button){button.addEventListener('click',function(){drill({status:button.dataset.summaryStatus});});});
    }
    const host=document.getElementById('ovCollectionSummaryMonths');
    if(!host)return;
    const filters={};if(scoped.selected.length)filters[scoped.column.k]=scoped.selected;
    const buckets=ctx.summary.monthBuckets?ctx.summary.monthBuckets(ctx.rows,{columnFilters:filters,columnValue:ctx.columnValue,isConfirmed:ctx.isConfirmed,quantityFor:ctx.quantityFor,imageFor:ctx.imageFor,fields:{month:'inStoreMonth',status:'durum',model:'modelKod'},sort:'desc'}):[];
    const en=ctx.language==='en';
    host.setAttribute('aria-label',en?'Collection months':'Koleksiyon ayları');
    if(!buckets.length){
      revolverTeardown();
      host.innerHTML='<div class="ovCollectionSummaryEmpty">'+esc(en?'No Collection models in this scope.':'Bu kapsamda Koleksiyon modeli yok.')+'</div>';
      return;
    }
    host.innerHTML='<div class="ovCollectionRevolverTrack">'+buckets.map(function(bucket,index){
      const name=monthLabel(bucket,locale,en);
      const statuses=bucket.statuses.slice().sort(function(a,b){return rank(a.status)-rank(b.status)||a.status.localeCompare(b.status,'tr-TR',{sensitivity:'base'});});
      const segments=statuses.map(function(entry){
        const share=pct(entry.optionCount,bucket.optionCount);
        const color=colorByStatus.get(entry.status)||VIS_PALETTE[0];
        const tip='<b>'+esc(name)+'</b><span class="ovCollectionTipStatus" style="--ui-series-color:'+esc(color)+'"><i></i>'+esc(ctx.statusLabel(entry.status))+'<em>'+share+'%</em></span>'+
          '<span><small>'+esc(en?'Models':'Model')+'</small>'+Number(entry.modelCount).toLocaleString(locale)+'</span>'+
          '<span><small>'+esc(en?'Quantity':'Adet')+'</small>'+Number(entry.quantity||0).toLocaleString(locale)+'</span>';
        const label=name+' · '+ctx.statusLabel(entry.status)+' · '+entry.modelCount+' '+(en?'models':'model')+' · '+Number(entry.quantity||0).toLocaleString(locale)+' '+(en?'pcs':'adet');
        return '<button type="button" class="ovCollectionMonthSeg" data-month-status="'+esc(entry.status)+'" data-month-tip="'+esc(tip)+'" style="--ui-series-color:'+esc(color)+';flex-grow:'+entry.optionCount+'" aria-label="'+esc(label)+'"></button>';
      }).join('');
      const thumbs=bucket.models.slice(0,MAX_THUMBS).map(function(model){
        return model.image
          ?'<span class="ovCollectionMonthThumb" title="'+esc(model.label)+'"><img src="'+esc(model.image)+'" alt="'+esc(model.label)+'" loading="lazy" decoding="async" draggable="false"></span>'
          :'<span class="ovCollectionMonthThumb isEmpty" title="'+esc(model.label+' · '+(en?'No image':'Görsel yok'))+'">—</span>';
      }).join('');
      return '<div class="ovCollectionMonthRow" role="option" data-month-index="'+index+'" data-month="'+esc(bucket.month)+'" data-model-count="'+bucket.modelCount+'">'+
        '<button type="button" class="ovCollectionMonthName" data-month-open title="'+esc(en?'Open this month in Collection':'Bu ayı Koleksiyon\'da aç')+'">'+esc(name)+'</button>'+
        '<span class="ovCollectionMonthQty"><b>'+Number(bucket.quantity||0).toLocaleString(locale)+'</b><span> '+esc(en?'pcs':'adet')+'</span></span>'+
        '<span class="ovCollectionMonthThumbs">'+thumbs+'<span class="ovCollectionMonthMore" hidden></span></span>'+
        '<span class="ovCollectionMonthBar">'+(segments||'<span class="ovCollectionMonthSeg isEmpty"></span>')+'</span>'+
      '</div>';
    }).join('')+'</div>';
    Array.from(host.querySelectorAll('.ovCollectionMonthRow')).forEach(function(row){
      const month=row.dataset.month;
      row.querySelector('[data-month-open]')?.addEventListener('click',function(){drill({month:month});});
      Array.from(row.querySelectorAll('[data-month-status]')).forEach(function(button){
        button.addEventListener('click',function(){drill({month:month,status:button.dataset.monthStatus});});
        button.addEventListener('pointerenter',function(){showSegmentTip(button);});
        button.addEventListener('pointerleave',hideSegmentTip);
      });
    });
    mountRevolver(host,buckets);
  }
  /* Status dilimi hover kartı: model sayısı ve adet (tek, body'ye bağlı). */
  function segmentTipEl(){
    let tip=document.getElementById('ovCollectionMonthTip');
    if(!tip){tip=document.createElement('div');tip.id='ovCollectionMonthTip';tip.className='ovCollectionMonthTip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.appendChild(tip);}
    return tip;
  }
  function showSegmentTip(button){
    if(revolver&&revolver.dragging)return;
    const tip=segmentTipEl();tip.innerHTML=button.dataset.monthTip||'';tip.hidden=false;
    const rect=button.getBoundingClientRect(),box=tip.getBoundingClientRect(),vw=window.innerWidth||document.documentElement.clientWidth;
    const left=Math.max(8,Math.min(rect.left+rect.width/2-box.width/2,vw-box.width-8));
    const top=rect.top-box.height-8>=8?rect.top-box.height-8:rect.bottom+8;
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function hideSegmentTip(){const tip=document.getElementById('ovCollectionMonthTip');if(tip)tip.hidden=true;}
  function monthLabel(bucket,locale,en){
    if(!bucket.month)return en?'No month':'Ay yok';
    if(!bucket.year||!bucket.monthNumber)return bucket.month;
    try{
      const name=new Date(bucket.year,bucket.monthNumber-1,1).toLocaleString(locale,{month:'long'});
      return name.charAt(0).toLocaleUpperCase(locale)+name.slice(1)+' '+bucket.year;
    }catch(_){return bucket.month;}
  }
  /* Revolver: her zaman VISIBLE_ROWS (3) satır görünür; tekerlek/sürükleme
     serbest kaydırır, bırakınca en yakın ay ortaya oturur (snapRevolver). */
  const VISIBLE_ROWS=3,MAX_THUMBS=40,SNAP_IDLE_MS=140;
  let revolver=null;
  function revolverTeardown(){
    if(!revolver)return;
    revolver.cleanup.forEach(function(fn){try{fn();}catch(_){}});
    revolver=null;
  }
  function revolverClamp(state,pos){
    if(state.count<VISIBLE_ROWS)return 0;
    const min=Math.floor(VISIBLE_ROWS/2),max=state.count-1-min;
    return Math.max(min,Math.min(max,pos));
  }
  function paintRevolver(state,animate){
    state.host.classList.toggle('isMoving',!animate);
    const center=state.count>=VISIBLE_ROWS?Math.floor(VISIBLE_ROWS/2):0;
    state.rows.forEach(function(row,index){
      const delta=index-state.pos,distance=Math.abs(delta);
      const y=(delta+center)*state.rowHeight;
      row.style.transform='translateY('+y.toFixed(2)+'px)';
      row.style.visibility=distance>=2?'hidden':'';
      row.setAttribute('aria-selected',distance<0.5?'true':'false');
    });
  }
  function snapRevolver(state,target){
    state.pos=revolverClamp(state,Math.round(target==null?state.pos:target));
    state.centerMonth=state.rows[state.pos]?state.rows[state.pos].dataset.month:'';
    paintRevolver(state,true);
  }
  function fitThumbs(state){
    const sample=state.host.querySelector('.ovCollectionMonthThumb');
    if(sample&&sample.offsetWidth>0)state.thumbStep=sample.offsetWidth+THUMB_GAP;
    state.rows.forEach(function(row){
      const strip=row.querySelector('.ovCollectionMonthThumbs');if(!strip)return;
      const thumbs=Array.from(strip.querySelectorAll('.ovCollectionMonthThumb')),more=strip.querySelector('.ovCollectionMonthMore');
      const total=Number(row.dataset.modelCount)||thumbs.length,step=state.thumbStep,width=strip.clientWidth;
      let fit=step>0?Math.max(0,Math.floor((width+THUMB_GAP)/step)):thumbs.length;
      if(total>fit)fit=Math.max(0,fit-1);
      fit=Math.min(fit,thumbs.length);
      thumbs.forEach(function(thumb,index){thumb.hidden=index>=fit;});
      const hidden=total-fit;
      if(more){more.hidden=hidden<=0;more.textContent='+'+hidden;}
    });
  }
  const THUMB_GAP=3;
  function mountRevolver(host,buckets){
    const previous=revolver&&revolver.host===host?revolver.centerMonth:null;
    revolverTeardown();
    const track=host.querySelector('.ovCollectionRevolverTrack');
    const rows=Array.from(host.querySelectorAll('.ovCollectionMonthRow'));
    /* Satır yüksekliği CSS'ten okunur: widget gizliyken de (ölçü 0) doğru kalır. */
    const rowHeight=Math.max(32,parseFloat(getComputedStyle(host).getPropertyValue('--revolver-row'))||36);
    const state={host:host,track:track,rows:rows,count:rows.length,rowHeight:rowHeight,thumbStep:22+THUMB_GAP,pos:0,centerMonth:'',cleanup:[]};
    host.style.height=(rowHeight*Math.min(VISIBLE_ROWS,Math.max(1,rows.length)))+'px';
    let start=previous?buckets.findIndex(function(bucket){return bucket.month===previous;}):-1;
    // First render starts at the latest month (top visible row), not the
    // nearest month to today. Preserve the focused month on later re-renders.
    if(start<0)start=Math.min(Math.floor(VISIBLE_ROWS/2),buckets.length-1);
    revolver=state;
    state.pos=revolverClamp(state,start);
    state.centerMonth=rows[state.pos]?rows[state.pos].dataset.month:'';
    paintRevolver(state,false);
    void host.offsetHeight;
    host.classList.remove('isMoving');
    fitThumbs(state);
    const scrollable=state.count>VISIBLE_ROWS;
    host.classList.toggle('isScrollable',scrollable);
    if(typeof ResizeObserver==='function'){
      const observer=new ResizeObserver(function(){fitThumbs(state);});
      observer.observe(host);state.cleanup.push(function(){observer.disconnect();});
    }
    if(!scrollable)return;
    let idle=0;
    const settle=function(){clearTimeout(idle);idle=setTimeout(function(){snapRevolver(state);},SNAP_IDLE_MS);};
    const onWheel=function(event){
      hideSegmentTip();
      if(!event.deltaY)return;
      const edge=event.deltaY>0?revolverClamp(state,state.count):revolverClamp(state,0);
      if(Math.abs(state.pos-edge)<0.001)return;
      event.preventDefault();
      const unit=event.deltaMode===1?16:event.deltaMode===2?state.rowHeight*VISIBLE_ROWS:1;
      const delta=event.deltaY*unit;
      if(event.deltaMode!==0||Math.abs(delta)>=60){clearTimeout(idle);snapRevolver(state,Math.round(state.pos)+(delta>0?1:-1));return;}
      state.pos=revolverClamp(state,state.pos+delta/state.rowHeight);
      paintRevolver(state,false);settle();
    };
    let drag=null,suppressClick=false;
    const onDown=function(event){
      if(event.button!==0)return;
      clearTimeout(idle);
      drag={id:event.pointerId,y:event.clientY,pos:state.pos,moved:false};
    };
    const onMove=function(event){
      if(!drag||event.pointerId!==drag.id)return;
      const dy=event.clientY-drag.y;
      if(!drag.moved&&Math.abs(dy)<5)return;
      if(!drag.moved){drag.moved=true;state.dragging=true;hideSegmentTip();try{host.setPointerCapture(drag.id);}catch(_){}}
      event.preventDefault();
      state.pos=revolverClamp(state,drag.pos-dy/state.rowHeight);
      paintRevolver(state,false);
    };
    const onUp=function(event){
      if(!drag||event.pointerId!==drag.id)return;
      const moved=drag.moved;drag=null;state.dragging=false;
      try{host.releasePointerCapture(event.pointerId);}catch(_){}
      if(moved){suppressClick=true;setTimeout(function(){suppressClick=false;},0);snapRevolver(state);}
    };
    const onClick=function(event){if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}};
    const onKey=function(event){
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();snapRevolver(state,Math.round(state.pos)+(event.key==='ArrowDown'?1:-1));}
      else if(event.key==='Home'||event.key==='End'){event.preventDefault();snapRevolver(state,event.key==='Home'?0:state.count-1);}
    };
    host.addEventListener('wheel',onWheel,{passive:false});
    host.addEventListener('pointerdown',onDown);
    host.addEventListener('pointermove',onMove);
    host.addEventListener('pointerup',onUp);
    host.addEventListener('pointercancel',onUp);
    host.addEventListener('click',onClick,true);
    host.addEventListener('keydown',onKey);
    state.cleanup.push(function(){
      clearTimeout(idle);hideSegmentTip();
      host.removeEventListener('wheel',onWheel,{passive:false});
      host.removeEventListener('pointerdown',onDown);
      host.removeEventListener('pointermove',onMove);
      host.removeEventListener('pointerup',onUp);
      host.removeEventListener('pointercancel',onUp);
      host.removeEventListener('click',onClick,true);
      host.removeEventListener('keydown',onKey);
    });
  }
  return {render:render,openColumnDrawer:openColumnDrawer,scopeState:scopeState,monthLabel:monthLabel,scopeColumnLabel:scopeColumnLabel};
});
