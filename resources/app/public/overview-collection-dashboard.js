'use strict';
(function(root,factory){root.BLOverviewCollectionDashboard=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function pct(value,total){return total>0?Math.round((Number(value)||0)*100/total):0;}
  function unique(rows,key){return Array.from(new Set((rows||[]).map(function(row){return String(row&&row[key]||'').trim();}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'tr-TR',{numeric:true,sensitivity:'base'});});}
  function icon(id){return '<svg class="ic" aria-hidden="true"><use href="#'+id+'"/></svg>';}
  function scopeResult(ctx,pivot){
    const saved=ctx.saved||{},seasons=unique(ctx.rows,'season');
    const selected=seasons.includes(String(saved.scopeSeason||''))?String(saved.scopeSeason):'';
    const result=ctx.summary.build(ctx.rows,{columnFilters:selected?{season:[selected]}:{},pivot:pivot||ctx.pivot,columnValue:ctx.columnValue,isConfirmed:ctx.isConfirmed,fields:{month:'inStoreMonth',status:'durum',model:'modelKod'}});
    return {selected:selected,seasons:seasons,result:result};
  }
  function render(ctx){
    if(!ctx||!ctx.root||!ctx.summary)return;
    const scoped=scopeResult(ctx,ctx.pivot),result=scoped.result,total=Number(result.kpi.total)||0,locale=ctx.language==='en'?'en-GB':'tr-TR';
    const scope=document.getElementById('ovCollectionSummaryScope');
    if(scope){
      scope.innerHTML='<option value="">'+esc(ctx.language==='en'?'All seasons':'Tüm sezonlar')+'</option>'+scoped.seasons.map(function(value){return '<option value="'+esc(value)+'"'+(value===scoped.selected?' selected':'')+'>'+esc(value)+'</option>';}).join('');
      scope.onchange=function(){ctx.savePrefs(Object.assign({},ctx.saved||{},{scopeSeason:scope.value||''}));ctx.onRender();};
    }
    const intro=document.getElementById('ovCollectionSummaryIntro');
    if(intro)intro.textContent=ctx.language==='en'?'Collection health at a glance. Select a season to focus the dashboard.':'Koleksiyonun durumunu tek bakışta gör. Dashboard kapsamını sezonla daraltabilirsin.';
    const meta=document.getElementById('ovCollectionSummaryScopeMeta');
    if(meta)meta.textContent=(scoped.selected||(ctx.language==='en'?'All seasons':'Tüm sezonlar'))+' · '+total.toLocaleString(locale)+' '+(ctx.language==='en'?'models':'model');
    const kpi=document.getElementById('ovCollectionSummaryKpi');
    if(kpi){
      const items=[
        {key:'total',label:ctx.language==='en'?'Total Models':'Toplam Model',value:result.kpi.total,icon:'i-table',tone:'neutral'},
        {key:'optionCount',label:ctx.language==='en'?'Total Options':'Toplam Opsiyon',value:result.kpi.optionCount,icon:'i-columns-3',tone:'blue'},
        {key:'confirmed',label:ctx.language==='en'?'Confirmed':'Onaylı',value:result.kpi.confirmed,ratio:pct(result.kpi.confirmed,total),icon:'i-checklist',tone:'green'},
        {key:'notConfirmed',label:ctx.language==='en'?'Not Confirmed':'Onaysız',value:result.kpi.notConfirmed,ratio:pct(result.kpi.notConfirmed,total),icon:'i-notebook',tone:'amber'}
      ];
      kpi.innerHTML=items.map(function(item){return '<button type="button" class="ovCollectionKpiCard tone-'+item.tone+'" data-summary-drill="'+item.key+'"><span class="ovCollectionKpiIcon">'+icon(item.icon)+'</span><span class="ovCollectionKpiCopy"><b>'+Number(item.value||0).toLocaleString(locale)+(item.ratio==null?'':' <em>'+item.ratio+'%</em>')+'</b><span>'+esc(item.label)+'</span></span></button>';}).join('');
      Array.from(kpi.querySelectorAll('[data-summary-drill]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({season:scoped.selected||null,kpi:button.dataset.summaryDrill});});});
    }
    const host=document.getElementById('ovCollectionSummaryStatusDistribution'),bar=document.getElementById('ovCollectionSummaryDistributionBar'),order=new Map((ctx.statusCatalog||[]).map(function(entry,index){return [String(entry.name),index];}));
    const rows=(result.rows||[]).slice().sort(function(a,b){const ai=order.has(a.status)?order.get(a.status):9999,bi=order.has(b.status)?order.get(b.status):9999;return ai-bi||String(a.status).localeCompare(String(b.status),'tr-TR',{sensitivity:'base'});});
    if(bar){
      bar.innerHTML=rows.map(function(row){const share=pct(row.modelCount,total),color=ctx.statusColor(row.status);return '<button type="button" class="ovCollectionDistributionSegment" data-summary-status="'+esc(row.status)+'" style="--status-color:'+esc(color)+';width:'+share+'%" title="'+esc(ctx.statusLabel(row.status)+' · '+share+'%')+'"></button>';}).join('');
      Array.from(bar.querySelectorAll('[data-summary-status]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({season:scoped.selected||null,status:button.dataset.summaryStatus});});});
    }
    if(host){
      host.innerHTML=rows.length?rows.map(function(row){const share=pct(row.modelCount,total),color=ctx.statusColor(row.status);return '<button type="button" class="ovCollectionStatusCard" data-summary-status="'+esc(row.status)+'" style="--status-color:'+esc(color)+'"><span class="ovCollectionStatusDot"></span><span class="ovCollectionStatusName">'+esc(ctx.statusLabel(row.status))+'</span><b>'+Number(row.modelCount||0).toLocaleString(locale)+'</b><span class="ovCollectionStatusShare">'+share+'%</span><span class="ovCollectionStatusOptions">'+Number(row.optionCount||0).toLocaleString(locale)+' '+(ctx.language==='en'?'options':'opsiyon')+'</span><span class="ovCollectionStatusTrack"><i style="width:'+share+'%"></i></span></button>';}).join(''):'<div class="ovCollectionSummaryEmpty">'+esc(ctx.language==='en'?'No Collection models in this scope.':'Bu kapsamda Koleksiyon modeli yok.')+'</div>';
      Array.from(host.querySelectorAll('[data-summary-status]')).forEach(function(button){button.addEventListener('click',function(){ctx.drill({season:scoped.selected||null,status:button.dataset.summaryStatus});});});
    }
  }
  function previewTable(ctx,pivot){
    const result=scopeResult(ctx,pivot).result,rowFields=Array.isArray(pivot.rows)?pivot.rows:[pivot.rows],labels=new Map((ctx.pivotColumns||[]).map(function(column){return [column.k,column.label||column.k];})),rowHeaders=rowFields.map(function(key){return labels.get(key)||key;}),pivotColumns=result.pivotColumns||[{key:'',path:[],label:''}],metrics=Array.isArray(pivot.values)?pivot.values:['modelCount'];
    function metricLabel(value){return value==='modelCount'?(ctx.language==='en'?'Models':'Model'):value==='optionCount'?(ctx.language==='en'?'Options':'Opsiyon'):value==='confirmed'?(ctx.language==='en'?'Confirmed':'Onaylı'):(ctx.language==='en'?'Not Confirmed':'Onaysız');}
    const headers=pivotColumns.flatMap(function(column){return metrics.map(function(metric){return (column.label?column.label+' · ':'')+metricLabel(metric);});});
    const body=(result.pivotRows||[]).length?(result.pivotRows||[]).map(function(row){const path=Array.isArray(row.rowPath)?row.rowPath:[row.row],left=path.map(function(value,index){const raw=String(value||'');return '<td>'+(rowFields[index]==='durum'?esc(ctx.statusLabel(raw)):esc(raw))+'</td>';}).join(''),values=pivotColumns.flatMap(function(column){return metrics.map(function(metric){return '<td class="num">'+Number(row.cells&&row.cells[column.key]&&row.cells[column.key][metric]||0).toLocaleString(ctx.language==='en'?'en-GB':'tr-TR')+'</td>';});}).join('');return '<tr>'+left+values+'</tr>';}).join(''):'<tr><td colspan="'+Math.max(1,rowHeaders.length+headers.length)+'" class="ovCollectionSummaryEmpty">'+esc(ctx.language==='en'?'No matching models.':'Eşleşen model yok.')+'</td></tr>';
    return '<table class="ovCollectionSummaryPivotPreviewTable"><thead><tr>'+rowHeaders.map(function(h){return '<th>'+esc(ctx.label(h))+'</th>';}).join('')+headers.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
  }
  function openSettings(ctx){
    document.getElementById('_ovCollectionSummaryPivotModal')?.remove();
    const saved=ctx.pivot,modal=document.createElement('div');modal.id='_ovCollectionSummaryPivotModal';modal.className='warnOverlay';
    const rowCatalog=ctx.pivotColumns||[],columnCatalog=[{k:'confirmation',label:ctx.language==='en'?'Confirmation':'Onay'}].concat(rowCatalog.filter(function(column){return column.k!=='confirmation';})),selectedRows=new Set(saved.rows||[]),selectedColumns=new Set(saved.columns||[]);
    function option(value,label,selected){return '<option value="'+esc(value)+'"'+(selected.has(value)?' selected':'')+'>'+esc(ctx.label(label))+'</option>';}
    modal.innerHTML='<div class="modalCard ovCollectionSummaryPivotModal" role="dialog" aria-modal="true"><div class="modalTitle">'+esc(ctx.language==='en'?'Collection · Detailed breakdown':'Koleksiyon · Ayrıntılı kırılım')+'<button type="button" data-close aria-label="Close">×</button></div><p class="ovCollectionSummaryPivotHint">'+esc(ctx.language==='en'?'The main dashboard stays visual. Use this secondary view for deeper pivot analysis.':'Ana dashboard görsel kalır. Daha derin pivot analizi için bu ikincil görünümü kullan.')+'</p><div class="ovCollectionSummaryPivotGrid"><label><span>'+esc(ctx.language==='en'?'Rows':'Satırlar')+'</span><select data-pivot-rows multiple size="8">'+rowCatalog.map(function(column){return option(column.k,column.label||column.k,selectedRows);}).join('')+'</select></label><label><span>'+esc(ctx.language==='en'?'Columns':'Sütunlar')+'</span><select data-pivot-columns multiple size="8"><option value="none"'+(!selectedColumns.size?' selected':'')+'>'+esc(ctx.language==='en'?'None':'Yok')+'</option>'+columnCatalog.map(function(column){return option(column.k,column.label||column.k,selectedColumns);}).join('')+'</select></label><label><span>'+esc(ctx.language==='en'?'Values':'Değerler')+'</span><select data-pivot-values multiple size="4"><option value="modelCount"'+(saved.values.includes('modelCount')?' selected':'')+'>'+esc(ctx.language==='en'?'Model Count':'Model Sayısı')+'</option><option value="optionCount"'+(saved.values.includes('optionCount')?' selected':'')+'>'+esc(ctx.language==='en'?'Option Count':'Opsiyon Sayısı')+'</option><option value="confirmed"'+(saved.values.includes('confirmed')?' selected':'')+'>'+esc(ctx.language==='en'?'Confirmed':'Onaylı')+'</option><option value="notConfirmed"'+(saved.values.includes('notConfirmed')?' selected':'')+'>'+esc(ctx.language==='en'?'Not Confirmed':'Onaysız')+'</option></select></label></div><div class="ovCollectionSummaryPivotPreview">'+previewTable(ctx,saved)+'</div><div class="modalFoot"><button type="button" class="tbtn" data-close>'+esc(ctx.language==='en'?'Close':'Kapat')+'</button><button type="button" class="tbtn primary" data-apply>'+esc(ctx.language==='en'?'Save breakdown':'Kırılımı kaydet')+'</button></div></div>';
    document.body.appendChild(modal);const close=function(){modal.remove();};Array.from(modal.querySelectorAll('[data-close]')).forEach(function(button){button.addEventListener('click',close);});modal.addEventListener('click',function(event){if(event.target===modal)close();});
    const columns=modal.querySelector('[data-pivot-columns]');columns?.addEventListener('change',function(){const none=columns.querySelector('option[value="none"]'),others=Array.from(columns.options).filter(function(o){return o.value!=='none';});if(none&&none.selected)others.forEach(function(o){o.selected=false;});else if(none&&others.some(function(o){return o.selected;}))none.selected=false;});
    modal.querySelector('[data-apply]')?.addEventListener('click',function(){const prefs=Object.assign({},ctx.saved||{}),rows=Array.from(modal.querySelectorAll('[data-pivot-rows] option:checked')).map(function(o){return o.value;}),cols=Array.from(modal.querySelectorAll('[data-pivot-columns] option:checked')).map(function(o){return o.value;}).filter(function(v){return v!=='none';}),values=Array.from(modal.querySelectorAll('[data-pivot-values] option:checked')).map(function(o){return o.value;});prefs.pivot={rows:rows.length?rows:['durum'],columns:cols,values:values.length?values:['modelCount','optionCount','confirmed','notConfirmed']};ctx.savePrefs(prefs);close();ctx.onRender();});
  }
  return {render:render,openSettings:openSettings};
});
