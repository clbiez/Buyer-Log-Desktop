(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewRadar=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const MAX_CATEGORY_AXES=8;
  const MAX_ENTITY_SERIES=5;
  const SOURCE_TABLES=[
    {id:'tblCountry',mode:'single',key:'country'},
    {id:'tblLicense',mode:'single',key:'subManufacturer'},
    {id:'tblSeason',mode:'multi',key:'season'},
    {id:'tblBuyingGroup',mode:'multi',key:'buyingGroup'},
  ];
  const SERIES_STYLES=['a','b','c','d','e','f','g'];
  const FILTER_STORAGE_KEY='buyerlog.overview.radarFilters.v1';
  const CHART_TYPES=['radar','bar','line'];

  function cleanText(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function filterStore(){
    if(typeof window==='undefined')return null;
    try{return window.BLStorage||window.localStorage||null;}catch(_){return null;}
  }
  function readFilterMap(){
    try{const raw=filterStore()?.getItem(FILTER_STORAGE_KEY);const parsed=raw?JSON.parse(raw):{};return parsed&&typeof parsed==='object'?parsed:{};}catch(_){return {};}
  }
  function readFilterState(key){
    const saved=readFilterMap()[String(key||'')]||{};
    return {
      axesHidden:Array.isArray(saved.axesHidden)?saved.axesHidden.map(String):[],
      seriesHidden:Array.isArray(saved.seriesHidden)?saved.seriesHidden.map(String):[],
      chartType:CHART_TYPES.includes(saved.chartType)?saved.chartType:'radar',
    };
  }
  function saveFilterState(key,next){
    if(!key)return;
    const all=readFilterMap();
    all[String(key)]={axesHidden:Array.isArray(next.axesHidden)?next.axesHidden:[],seriesHidden:Array.isArray(next.seriesHidden)?next.seriesHidden:[],chartType:CHART_TYPES.includes(next.chartType)?next.chartType:'radar'};
    try{filterStore()?.setItem(FILTER_STORAGE_KEY,JSON.stringify(all));}catch(_){}
  }
  function numberFromText(value){
    const text=cleanText(value);
    if(!text)return 0;
    const first=(text.match(/-?[\d][\d.,]*/)||[])[0]||'';
    if(!first)return 0;
    const digits=first.replace(/[^\d-]/g,'');
    const n=Number(digits);
    return Number.isFinite(n)?n:0;
  }
  function truncate(value,max=16){
    const text=cleanText(value);
    return text.length>max?text.slice(0,Math.max(1,max-1))+'…':text;
  }
  function normalizeSeries(series,mode='series'){
    const input=(Array.isArray(series)?series:[]).map(item=>({...item,values:(Array.isArray(item.values)?item.values:[]).map(v=>Math.max(0,Number(v)||0))}));
    if(!input.length)return [];
    const len=Math.max(...input.map(item=>item.values.length),0);
    if(mode==='axis'){
      const maxes=Array.from({length:len},(_,i)=>Math.max(1,...input.map(item=>item.values[i]||0)));
      return input.map(item=>({...item,normalized:item.values.map((v,i)=>Math.max(0,Math.min(1,v/maxes[i])))}));
    }
    return input.map(item=>{
      const max=Math.max(1,...item.values);
      return {...item,normalized:item.values.map(v=>Math.max(0,Math.min(1,v/max)))};
    });
  }
  function matrixFromTable(table){
    if(!table)return {headers:[],rows:[]};
    const all=[...table.querySelectorAll('tr')];
    if(!all.length)return {headers:[],rows:[]};
    const headers=[...all[0].querySelectorAll('th,td')].map(cell=>cleanText(cell.textContent));
    const rows=all.slice(1).map((tr,rowIndex)=>({
      rowIndex,
      element:tr,
      cells:[...tr.querySelectorAll('td')].map(cell=>cleanText(cell.textContent)),
    })).filter(row=>row.cells.length&&row.cells.some(Boolean)&&!row.element.querySelector('.quantityTotalLabel'));
    return {headers,rows};
  }
  function singleMetricConfig(matrix,key){
    const rows=(matrix.rows||[]).map(row=>({label:row.cells[0]||'—',value:numberFromText(row.cells[1]),rowIndex:row.rowIndex}))
      .filter(row=>row.label&&row.value>=0).sort((a,b)=>b.value-a.value).slice(0,MAX_CATEGORY_AXES);
    return {
      key,
      axes:rows.map(row=>row.label),
      series:[{label:(matrix.headers&&matrix.headers[1])||'Order',values:rows.map(row=>row.value),style:'a'}],
      normalize:'series',
      axisRows:rows.map(row=>row.rowIndex),
    };
  }
  function multiMetricConfig(matrix,key){
    let rows=(matrix.rows||[]).map(row=>({
      label:row.cells[0]||'—',rowIndex:row.rowIndex,
      values:row.cells.slice(1).map(numberFromText),
    }));
    if(key==='buyingGroup'){
      // FOB hücreleri USD + TRY karışık olabildiği için radar ölçeğini bozmasın.
      rows=rows.map(row=>({...row,values:row.values.slice(0,4)}));
    }
    rows=rows.filter(row=>row.label).sort((a,b)=>(b.values[0]||0)-(a.values[0]||0)).slice(0,MAX_ENTITY_SERIES);
    const metricCount=rows.length?rows[0].values.length:0;
    const axes=(matrix.headers||[]).slice(1,1+metricCount);
    return {
      key,axes,
      series:rows.map((row,index)=>({label:row.label,values:row.values,style:SERIES_STYLES[index%SERIES_STYLES.length],rowIndex:row.rowIndex})),
      normalize:'axis',
    };
  }
  function prioritySummary(rows,codes){
    const list=Array.isArray(codes)?codes:[];
    const summary=Object.fromEntries(list.map(code=>[code,{count:0,units:0}]));
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const code=cleanText(row&&row.priority);
      if(!summary[code])return;
      summary[code].count++;
      summary[code].units+=Math.max(0,Number(row&&row.units)||0);
    });
    return summary;
  }
  function point(cx,cy,r,index,total){
    const angle=-Math.PI/2+(Math.PI*2*index/Math.max(1,total));
    return {x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r,angle};
  }
  function polygonPoints(values,cx,cy,r){
    return values.map((value,index)=>{
      const p=point(cx,cy,r*Math.max(0,Math.min(1,Number(value)||0)),index,values.length);
      return p.x.toFixed(1)+','+p.y.toFixed(1);
    }).join(' ');
  }
  function escapeHtml(value){return cleanText(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function compactNumber(value){
    const n=Number(value)||0,abs=Math.abs(n);
    if(abs>=1000000)return (n/1000000).toFixed(abs>=10000000?0:1).replace(/\.0$/,'')+'M';
    if(abs>=1000)return (n/1000).toFixed(abs>=10000?0:1).replace(/\.0$/,'')+'K';
    return Math.round(n).toLocaleString();
  }
  function chartTypeControls(active,l){
    const labels=l==='en'?{radar:'Radar',bar:'Bar',line:'Line'}:{radar:'Radar',bar:'Sütun',line:'Çizgi'};
    return '<div class="ovChartTypeSwitch" role="group" aria-label="'+escapeHtml(l==='en'?'Chart type':'Grafik tipi')+'">'
      +CHART_TYPES.map(type=>'<button type="button" data-radar-chart-type="'+type+'" class="'+(active===type?'isActive':'')+'" aria-pressed="'+(active===type?'true':'false')+'">'+escapeHtml(labels[type])+'</button>').join('')
      +'</div>';
  }
  function renderCartesianSvg(axes,series,config,axisIndexes,chartType){
    const width=760,height=400,left=66,right=22,top=24,bottom=96,plotW=width-left-right,plotH=height-top-bottom;
    const maxValue=Math.max(1,...series.flatMap(item=>item.values.map(v=>Number(v)||0)));
    const y=value=>top+plotH-(Math.max(0,Number(value)||0)/maxValue)*plotH;
    const x=index=>left+((index+.5)*plotW/Math.max(1,axes.length));
    let svg='<svg class="ovRadarSvg ovCartesianSvg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escapeHtml((config.ariaLabel||'Chart')+' '+chartType)+'">';
    for(let tick=0;tick<=4;tick++){
      const ratio=tick/4,yy=top+plotH-(ratio*plotH),raw=maxValue*ratio;
      svg+='<line class="ovCartesianGrid" x1="'+left+'" y1="'+yy.toFixed(1)+'" x2="'+(width-right)+'" y2="'+yy.toFixed(1)+'"/>';
      svg+='<text class="ovCartesianYAxisLabel" x="'+(left-9)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end">'+escapeHtml(compactNumber(raw))+'</text>';
    }
    axes.forEach((axis,i)=>{
      const xx=x(i);
      svg+='<text class="ovCartesianXAxisLabel" x="'+xx.toFixed(1)+'" y="'+(height-bottom+22)+'" text-anchor="end" transform="rotate(-28 '+xx.toFixed(1)+' '+(height-bottom+22)+')"><title>'+escapeHtml(axis)+'</title>'+escapeHtml(truncate(axis,18))+'</text>';
    });
    if(chartType==='bar'){
      const groupW=plotW/Math.max(1,axes.length),usable=Math.min(groupW*.76,82),barW=Math.max(3,Math.min(24,usable/Math.max(1,series.length))),totalW=barW*series.length;
      axes.forEach((axis,ai)=>{
        const center=x(ai);
        series.forEach((item,si)=>{
          const raw=Number(item.values[ai])||0,yy=y(raw),h=Math.max(0,top+plotH-yy),style=item.style||SERIES_STYLES[si%SERIES_STYLES.length];
          const xx=center-totalW/2+(si*barW)+1,clickable=config.axisRows&&Number.isInteger(config.axisRows[axisIndexes[ai]]);
          svg+='<rect class="ovRadarBar ovRadarBar--'+style+(clickable?' isClickable':'')+'"'+(clickable?' data-cart-axis-index="'+ai+'"':'')+' x="'+xx.toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+Math.max(2,barW-2).toFixed(1)+'" height="'+h.toFixed(1)+'"><title>'+escapeHtml(item.label+' · '+axis+': '+raw.toLocaleString())+'</title></rect>';
        });
      });
    }else{
      series.forEach((item,si)=>{
        const style=item.style||SERIES_STYLES[si%SERIES_STYLES.length];
        const pts=axes.map((axis,ai)=>x(ai).toFixed(1)+','+y(item.values[ai]).toFixed(1)).join(' ');
        if(axes.length>1)svg+='<polyline class="ovRadarLine ovRadarLine--'+style+'" points="'+pts+'"/>';
        axes.forEach((axis,ai)=>{
          const raw=Number(item.values[ai])||0,clickable=config.axisRows&&Number.isInteger(config.axisRows[axisIndexes[ai]]);
          svg+='<circle class="ovRadarPoint ovRadarPoint--'+style+(clickable?' isClickable':'')+'"'+(clickable?' data-cart-axis-index="'+ai+'"':'')+' cx="'+x(ai).toFixed(1)+'" cy="'+y(raw).toFixed(1)+'" r="4"><title>'+escapeHtml(item.label+' · '+axis+': '+raw.toLocaleString())+'</title></circle>';
        });
      });
    }
    svg+='</svg>';
    return svg;
  }
  function renderRadar(host,config){
    if(!host)return;
    const rawAxes=(config.axes||[]).map(cleanText).filter(Boolean);
    const rawSeries=(Array.isArray(config.series)?config.series:[]).map(item=>({...item,values:(Array.isArray(item.values)?item.values:[]).map(v=>Math.max(0,Number(v)||0))}));
    const filterKey=String(config.filterKey||'').trim();
    const filterState=filterKey?readFilterState(filterKey):{axesHidden:[],seriesHidden:[]};
    const axesHidden=new Set(filterState.axesHidden),seriesHidden=new Set(filterState.seriesHidden),chartType=CHART_TYPES.includes(filterState.chartType)?filterState.chartType:'radar';
    const axisIndexes=rawAxes.map((axis,index)=>({axis,index})).filter(item=>!axesHidden.has(item.axis)).map(item=>item.index);
    const axes=axisIndexes.map(index=>rawAxes[index]);
    const filteredSeries=rawSeries.filter(item=>!seriesHidden.has(cleanText(item.label))).map(item=>({...item,values:axisIndexes.map(index=>item.values[index]||0)}));
    const series=normalizeSeries(filteredSeries,config.normalize||'series');
    const l=(typeof document!=='undefined'&&(document.documentElement.lang||'tr').toLowerCase().startsWith('en'))?'en':'tr';
    const filterCount=axisIndexes.length+'/'+rawAxes.length+(rawSeries.length>1?' · '+series.length+'/'+rawSeries.length:'');
    const typeControls=filterKey?chartTypeControls(chartType,l):'';
    const filterControls=filterKey?'<details class="ovRadarFilter"><summary>'+(l==='en'?'Filter':'Filtre')+' <span>'+escapeHtml(filterCount)+'</span></summary><div class="ovRadarFilterPanel">'
      +(rawAxes.length>1?'<div class="ovRadarFilterGroup"><strong>'+(l==='en'?'Categories / axes':'Kategoriler / eksenler')+'</strong>'+rawAxes.map(axis=>'<label><input type="checkbox" data-radar-filter-axis="'+escapeHtml(axis)+'"'+(axesHidden.has(axis)?'':' checked')+'><span>'+escapeHtml(truncate(axis,30))+'</span></label>').join('')+'</div>':'')
      +(rawSeries.length>1?'<div class="ovRadarFilterGroup"><strong>'+(l==='en'?'Series':'Seriler')+'</strong>'+rawSeries.map(item=>{const label=cleanText(item.label);return '<label><input type="checkbox" data-radar-filter-series="'+escapeHtml(label)+'"'+(seriesHidden.has(label)?'':' checked')+'><span>'+escapeHtml(truncate(label,30))+'</span></label>';}).join('')+'</div>':'')
      +'<button type="button" class="tbtn" data-radar-filter-clear>'+(l==='en'?'Clear filter':'Filtreyi temizle')+'</button></div></details>':'';
    const bindFilters=()=>{
      if(!filterKey)return;
      host.querySelectorAll('[data-radar-chart-type]').forEach(button=>button.addEventListener('click',()=>{
        const type=String(button.dataset.radarChartType||'');
        if(!CHART_TYPES.includes(type))return;
        const next=readFilterState(filterKey);next.chartType=type;saveFilterState(filterKey,next);renderRadar(host,config);
      }));
      host.querySelectorAll('[data-radar-filter-axis]').forEach(input=>input.addEventListener('change',()=>{
        const next=readFilterState(filterKey),hidden=new Set(next.axesHidden),value=String(input.dataset.radarFilterAxis||'');
        if(input.checked)hidden.delete(value);else hidden.add(value);
        next.axesHidden=[...hidden];saveFilterState(filterKey,next);renderRadar(host,config);
      }));
      host.querySelectorAll('[data-radar-filter-series]').forEach(input=>input.addEventListener('change',()=>{
        const next=readFilterState(filterKey),hidden=new Set(next.seriesHidden),value=String(input.dataset.radarFilterSeries||'');
        if(input.checked)hidden.delete(value);else hidden.add(value);
        next.seriesHidden=[...hidden];saveFilterState(filterKey,next);renderRadar(host,config);
      }));
      host.querySelector('[data-radar-filter-clear]')?.addEventListener('click',()=>{const next=readFilterState(filterKey);saveFilterState(filterKey,{axesHidden:[],seriesHidden:[],chartType:next.chartType});renderRadar(host,config);});
    };
    if(!axes.length||(chartType==='radar'&&axes.length<2)||!series.length||!series.some(item=>item.values.some(v=>v>0))){
      host.innerHTML='<div class="ovRadarEmpty">'+escapeHtml(config.emptyText||'No data')+'</div><div class="ovRadarSide">'+typeControls+filterControls+'</div>';
      bindFilters();return;
    }
    let svg='';
    if(chartType==='radar'){
    const width=760,height=400,cx=380,cy=186,r=118,levels=4;
    svg='<svg class="ovRadarSvg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escapeHtml(config.ariaLabel||'Radar chart')+'">';
    for(let level=1;level<=levels;level++){
      const lr=r*level/levels;
      const points=axes.map((_,i)=>{const p=point(cx,cy,lr,i,axes.length);return p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
      svg+='<polygon class="ovRadarGrid" points="'+points+'"/>';
    }
    axes.forEach((axis,i)=>{
      const edge=point(cx,cy,r,i,axes.length),label=point(cx,cy,r+42,i,axes.length);
      const anchor=Math.abs(Math.cos(label.angle))<.28?'middle':Math.cos(label.angle)>0?'start':'end';
      const originalIndex=axisIndexes[i],row=config.axisRows&&Number.isInteger(config.axisRows[originalIndex])?config.axisRows[originalIndex]:null;
      svg+='<line class="ovRadarAxis" x1="'+cx+'" y1="'+cy+'" x2="'+edge.x.toFixed(1)+'" y2="'+edge.y.toFixed(1)+'"/>';
      svg+='<text class="ovRadarAxisLabel'+(row!=null?' isClickable':'')+'" data-axis-index="'+i+'" x="'+label.x.toFixed(1)+'" y="'+label.y.toFixed(1)+'" text-anchor="'+anchor+'"><title>'+escapeHtml(axis)+'</title>'+escapeHtml(truncate(axis,18))+'</text>';
    });
    series.forEach((item,si)=>{
      const cls='ovRadarSeries ovRadarSeries--'+(item.style||SERIES_STYLES[si%SERIES_STYLES.length]);
      svg+='<polygon class="'+cls+'" points="'+polygonPoints(item.normalized,cx,cy,r)+'"><title>'+escapeHtml(item.label)+'</title></polygon>';
      item.normalized.forEach((value,i)=>{
        const p=point(cx,cy,r*value,i,axes.length);
        const raw=item.values[i]||0;
        svg+='<circle class="ovRadarPoint ovRadarPoint--'+(item.style||SERIES_STYLES[si%SERIES_STYLES.length])+'" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.6"><title>'+escapeHtml(item.label+' · '+axes[i]+': '+Number(raw).toLocaleString())+'</title></circle>';
      });
    });
    svg+='</svg>';
    }else{
      svg=renderCartesianSvg(axes,series,config,axisIndexes,chartType);
    }
    const legend=series.map((item,index)=>{
      const row=Number.isInteger(item.rowIndex)?item.rowIndex:null;
      const totals=item.values.reduce((sum,value)=>sum+(Number(value)||0),0);
      return '<button type="button" class="ovRadarLegendItem'+(row!=null?' isClickable':'')+'" data-series-index="'+index+'"'+(row==null?' disabled':'')+'><span class="ovRadarLegendSwatch ovRadarLegendSwatch--'+(item.style||SERIES_STYLES[index%SERIES_STYLES.length])+'"></span><span>'+escapeHtml(truncate(item.label,28))+'</span><b>'+Number(totals).toLocaleString()+'</b></button>';
    }).join('');
    host.innerHTML='<div class="ovRadarCanvas">'+svg+'</div><div class="ovRadarSide">'+typeControls+filterControls+'<div class="ovRadarLegend">'+legend+'</div></div>';
    host.querySelectorAll('.ovRadarAxisLabel.isClickable').forEach(label=>label.addEventListener('click',()=>{
      const index=Number(label.dataset.axisIndex),originalIndex=axisIndexes[index],rowIndex=config.axisRows&&config.axisRows[originalIndex];
      if(Number.isInteger(rowIndex))config.onRowClick?.(rowIndex);
    }));
    host.querySelectorAll('[data-cart-axis-index]').forEach(node=>node.addEventListener('click',()=>{
      const index=Number(node.dataset.cartAxisIndex),originalIndex=axisIndexes[index],rowIndex=config.axisRows&&config.axisRows[originalIndex];
      if(Number.isInteger(rowIndex))config.onRowClick?.(rowIndex);
    }));
    host.querySelectorAll('.ovRadarLegendItem.isClickable').forEach(button=>button.addEventListener('click',()=>{
      const item=series[Number(button.dataset.seriesIndex)];
      if(item&&Number.isInteger(item.rowIndex))config.onRowClick?.(item.rowIndex);
    }));
    bindFilters();
  }
  function ensureHost(table,key){
    if(!table)return null;
    const body=table.parentElement;
    if(!body)return null;
    table.classList.add('ovRadarSourceTable');
    let host=body.querySelector(':scope > .ovRadarHost[data-radar-key="'+key+'"]');
    if(!host){host=document.createElement('div');host.className='ovRadarHost';host.dataset.radarKey=key;table.after(host);}
    return host;
  }
  function renderTableRadar(def){
    const table=document.getElementById(def.id);if(!table)return;
    const matrix=matrixFromTable(table),config=def.mode==='single'?singleMetricConfig(matrix,def.key):multiMetricConfig(matrix,def.key);
    const host=ensureHost(table,def.key);if(!host)return;
    const en=(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
    config.emptyText=en?'No data for the active filters.':'Aktif filtrelerde veri yok.';
    config.filterKey='overview:'+def.key;
    config.ariaLabel=(table.closest('[data-overview-detail-widget]')?.querySelector('.cardTitle')?.textContent||def.key)+' radar';
    config.onRowClick=rowIndex=>{
      const row=matrix.rows.find(item=>item.rowIndex===rowIndex)?.element;
      if(!row)return;
      const drill=row.querySelector('.ovDrill');
      (drill||row).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    };
    renderRadar(host,config);
  }
  function refreshAll(){SOURCE_TABLES.forEach(renderTableRadar);}
  // Tablo mutasyonları ve pencere yeniden boyutlandırması kare başına tek çizime
  // toplanır; sürükleyerek yeniden boyutlandırmada her olayda tüm radarlar kurulmaz.
  const pendingRadars=new Set();let radarFrame=0;
  function scheduleRadar(def){
    pendingRadars.add(def);if(radarFrame)return;
    const run=()=>{radarFrame=0;const list=[...pendingRadars];pendingRadars.clear();list.forEach(renderTableRadar);};
    radarFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame(run):setTimeout(run,16);
  }
  function scheduleAll(){SOURCE_TABLES.forEach(scheduleRadar);}
  function renderPriority(rows,options={}){
    const host=document.getElementById('ovPriorityRadar');if(!host)return;
    const codes=Array.isArray(options.codes)?options.codes:[];
    const labels=options.labels&&typeof options.labels==='object'?options.labels:{};
    const summary=prioritySummary(rows,codes);
    const en=(options.lang||'tr')==='en';
    renderRadar(host,{
      axes:codes.map(code=>labels[code]||code),
      series:[
        {label:en?'Orders':'Sipariş',values:codes.map(code=>summary[code]?.count||0),style:'a'},
        {label:en?'Units':'Adet',values:codes.map(code=>summary[code]?.units||0),style:'b'},
      ],
      normalize:'series',
      emptyText:en?'No priority data for the active filters.':'Aktif filtrelerde öncelik verisi yok.',
      ariaLabel:en?'CP priority radar chart':'CP öncelik radar diyagramı',
      filterKey:'overview:priority',
    });
  }
  function bind(){
    SOURCE_TABLES.forEach(def=>{
      const table=document.getElementById(def.id);if(!table)return;
      if(!table.dataset.radarBound){
        table.dataset.radarBound='1';
        new MutationObserver(()=>scheduleRadar(def)).observe(table,{childList:true,subtree:true,characterData:true});
      }
      renderTableRadar(def);
    });
    new MutationObserver(scheduleAll).observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme']});
    window.addEventListener('resize',scheduleAll,{passive:true});
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  }
  return {FILTER_STORAGE_KEY,CHART_TYPES,numberFromText,normalizeSeries,prioritySummary,singleMetricConfig,multiMetricConfig,renderRadar,renderPriority,refreshAll,readFilterState};
});
