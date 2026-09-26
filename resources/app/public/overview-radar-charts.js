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

  function cleanText(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
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
  function renderRadar(host,config){
    if(!host)return;
    const axes=(config.axes||[]).map(cleanText).filter(Boolean);
    const series=normalizeSeries(config.series||[],config.normalize||'series');
    if(axes.length<2||!series.length||!series.some(item=>item.values.some(v=>v>0))){
      host.innerHTML='<div class="ovRadarEmpty">'+escapeHtml(config.emptyText||'No data')+'</div>';
      return;
    }
    const width=620,height=370,cx=310,cy=170,r=122,levels=4;
    let svg='<svg class="ovRadarSvg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escapeHtml(config.ariaLabel||'Radar chart')+'">';
    for(let level=1;level<=levels;level++){
      const lr=r*level/levels;
      const points=axes.map((_,i)=>{const p=point(cx,cy,lr,i,axes.length);return p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
      svg+='<polygon class="ovRadarGrid" points="'+points+'"/>';
    }
    axes.forEach((axis,i)=>{
      const edge=point(cx,cy,r,i,axes.length),label=point(cx,cy,r+34,i,axes.length);
      const anchor=Math.abs(Math.cos(label.angle))<.28?'middle':Math.cos(label.angle)>0?'start':'end';
      const row=config.axisRows&&Number.isInteger(config.axisRows[i])?config.axisRows[i]:null;
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
    const legend=series.map((item,index)=>{
      const row=Number.isInteger(item.rowIndex)?item.rowIndex:null;
      const totals=item.values.reduce((sum,value)=>sum+(Number(value)||0),0);
      return '<button type="button" class="ovRadarLegendItem'+(row!=null?' isClickable':'')+'" data-series-index="'+index+'"'+(row==null?' disabled':'')+'><span class="ovRadarLegendSwatch ovRadarLegendSwatch--'+(item.style||SERIES_STYLES[index%SERIES_STYLES.length])+'"></span><span>'+escapeHtml(truncate(item.label,28))+'</span><b>'+Number(totals).toLocaleString()+'</b></button>';
    }).join('');
    host.innerHTML='<div class="ovRadarCanvas">'+svg+'</div><div class="ovRadarLegend">'+legend+'</div>';
    host.querySelectorAll('.ovRadarAxisLabel.isClickable').forEach(label=>label.addEventListener('click',()=>{
      const index=Number(label.dataset.axisIndex),rowIndex=config.axisRows&&config.axisRows[index];
      if(Number.isInteger(rowIndex))config.onRowClick?.(rowIndex);
    }));
    host.querySelectorAll('.ovRadarLegendItem.isClickable').forEach(button=>button.addEventListener('click',()=>{
      const item=series[Number(button.dataset.seriesIndex)];
      if(item&&Number.isInteger(item.rowIndex))config.onRowClick?.(item.rowIndex);
    }));
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
    });
  }
  function bind(){
    SOURCE_TABLES.forEach(def=>{
      const table=document.getElementById(def.id);if(!table)return;
      if(!table.dataset.radarBound){
        table.dataset.radarBound='1';
        new MutationObserver(()=>renderTableRadar(def)).observe(table,{childList:true,subtree:true,characterData:true});
      }
      renderTableRadar(def);
    });
    new MutationObserver(refreshAll).observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme']});
    window.addEventListener('resize',refreshAll,{passive:true});
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  }
  return {numberFromText,normalizeSeries,prioritySummary,singleMetricConfig,multiMetricConfig,renderRadar,renderPriority,refreshAll};
});
