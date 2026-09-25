(function(){
  'use strict';

  const E=window.BLCollectionAnalyticsEngine;if(!E)return;
  const STORAGE_KEY='lcw.priceSupplierAnalysis.v2';
  const DIMENSION_ORDER=['classification','manufacturer','subManufacturer','productGroup','productMainDefinition','buyingGroup','country','buyer','collection','season','month','planStartMonth','status','model','colour'];
  const CORE_COLUMNS=['average','parentAverage','difference','differencePct','min','max','median','modelCount','optionCount','recordCount','pricePosition','lowestDifferencePct','weightedAverage','totalQuantity'];
  const PRICE_COLUMNS=new Set(['average','parentAverage','difference','min','max','median','weightedAverage']);
  const SOURCE_NAMES={collection:'Collection',cp:'CP',orders:'Orders',lfl:'LFL',horizon:'Horizon'};
  const PRICE_NAMES={quotation:['Üretici Teklifleri','Supplier Quotations'],confirmed:['Onaylı Teklif','Confirmed Quotation'],best:['En İyi Teklif','Best Quotation'],target:['Hedef Fiyat','Target Price'],fob:['FOB','FOB'],ydLanded:['Yurtdışı Landed','Overseas Landed'],trLanded:['Türkiye Landed','Türkiye Landed'],trPrice:['Türkiye Fiyatı','Türkiye Price'],previousFob:['Önceki Sezon FOB','Previous Season FOB'],finalFob:['Final FOB','Final FOB'],supplierFob:['Tedarikçi FOB','Supplier FOB']};
  const TEXT={
    scope:['Kapsam','Scope'],all:['Tüm veri','All data'],filtered:['Mevcut filtreli veri','Current filtered data'],price:['Fiyat alanı','Price field'],metric:['Ana metrik','Primary metric'],filters:['Filtreler','Filters'],breakdown:['Kırılımı değiştir','Change breakdown'],saved:['Kayıtlı görünüm','Saved view'],columns:['Sütunlar','Columns'],export:['Excel’e aktar','Export to Excel'],source:['Kaynak','Source'],loading:['Kaynak hazırlanıyor…','Preparing source…'],failed:['Analiz hazırlanamadı','Analysis could not be prepared'],noData:['Seçilen kapsamda kullanılabilir fiyat yok.','No usable price exists in the selected scope.'],overview:['Genel görünüm','Overview'],ranking:['Fiyat sıralaması','Price ranking'],opportunities:['Fırsatlar ve aykırı değerler','Opportunities & outliers'],heatmap:['Fiyat matrisi','Price heatmap'],compare:['Karşılaştırma','Compare'],addCurrent:['Mevcut görünümü karşılaştırmaya ekle','Add current view to comparison'],clear:['Temizle','Clear'],average:['Ortalama Fiyat','Average Price'],median:['Medyan','Median'],min:['Minimum','Minimum'],max:['Maksimum','Maximum'],weightedAverage:['Ağırlıklı Ortalama','Weighted Average'],modelCount:['Model Sayısı','Model Count'],recordCount:['Kayıt Sayısı','Record Count'],orderCount:['Sipariş Sayısı','Order Count'],totalQuantity:['Toplam Adet','Total Quantity'],parentAverage:['Kırılım Ortalaması','Segment Average'],difference:['Fark','Difference'],differencePct:['Fark %','Difference %'],lowestDifferencePct:['En Düşüğe Fark %','Gap to Lowest %'],pricePosition:['Fiyat Pozisyonu','Price Position'],manufacturer:['Üretici','Supplier'],classification:['Klasman','Classification'],productGroup:['Ürün Grubu','Product Group'],productMainDefinition:['Ürün Ana Tanım','Product Main Definition'],category:['Kategori','Category'],buyingGroup:['Buying Group','Buying Group'],country:['Ülke','Country'],buyer:['Buyer','Buyer'],collection:['Koleksiyon','Collection'],season:['Sezon','Season'],month:['In Store Ayı','In Store Month'],planStartMonth:['Plan Başlangıç Ayı','Plan Start Month'],status:['Durum','Status'],model:['Model','Model'],colour:['Renk','Colour'],below:['Ortalamanın Altında','Below Average'],market:['Ortalama Seviyesi','Around Average'],above:['Ortalamanın Üstünde','Above Average'],unavailable:['Hesaplanamadı','Unavailable'],lowSample:['Düşük örnek','Low sample'],dataQuality:['Veri Kalitesi','Data Quality'],input:['Kaynak kayıt','Source records'],valid:['Geçerli fiyat','Valid prices'],missing:['Eksik/geçersiz fiyat','Missing/invalid price'],outliers:['Aykırı fiyat','Outliers'],excluded:['Analiz dışı','Excluded'],mixed:['Karışık para birimi','Mixed currency'],thresholds:['Pozisyon eşikleri','Position thresholds'],includeOutliers:['Aykırı değerleri dahil et','Include outliers'],minSample:['Minimum örnek','Minimum sample'],addDimension:['Kırılım ekle','Add dimension'],apply:['Uygula','Apply'],close:['Kapat','Close'],newView:['Yeni görünüm','New view'],viewName:['Görünüm adı','View name'],save:['Kaydet','Save'],load:['Yükle','Load'],remove:['Sil','Delete'],savedOk:['Görünüm kaydedildi.','View saved.'],lowestSuppliers:['En düşük fiyatlı üreticiler','Lowest-price suppliers'],belowAverage:['Ortalama altı fırsatlar','Below-average opportunities'],highAlerts:['Yüksek fiyat uyarıları','High-price alerts'],none:['Uygun kayıt yok','No matching record'],row:['Satır','Row'],column:['Sütun','Column'],mixedWarning:['Karışık para birimlerinde fiyat farkı hesaplanmadı.','Price differences were blocked for mixed currencies.'],outlierWarning:['Aykırı fiyatlar analiz dışında tutuluyor.','Outliers are excluded from the analysis.'],details:['Detay için satıra çift tıklayın.','Double-click a row for details.'],analysis:['Analiz','Analysis'],configuration:['Yapılandırma','Configuration']
  };
  TEXT.optionCount=['Opsiyon Sayısı','Option Count'];
  Object.assign(TEXT,{sortColumn:['Sütunu sırala','Sort this column'],sortRow:['Bu satırdaki sütunları sırala','Sort columns by this row']});
  const EXTRA_TEXT={insightLimit:['Özet satır sayısı','Summary row count']};
  const BASE={source:'collection',scope:'all',priceType:'quotation',dimensions:['classification','manufacturer'],metric:'average',filters:[],includeOutliers:false,minSample:2,insightLimit:5,thresholds:{below:-5,above:5},sort:{key:'average',dir:'asc'},columns:{},heatmap:{row:'classification',column:'manufacturer',limit:12,rowSort:{key:'',dir:'asc'},columnSort:{key:'',dir:'asc'}},saved:{},comparisonConfigs:[]};
  let state=structuredClone(BASE),root,dataset=null,analysis=null,dimensions=[],loading=false,error='',activeDrawer='',scrollTop=0,requestSeq=0;
  let comparisons=[],collapsed=new Set();
  const analysisCache=(window.BLAnalysisCache?.create||window.BLPerf?.createBoundedCache)?.(32)||new Map();

  try{const raw=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'{}');state={...state,...raw,thresholds:{...BASE.thresholds,...raw.thresholds},heatmap:{...BASE.heatmap,...raw.heatmap,rowSort:{...BASE.heatmap.rowSort,...raw.heatmap?.rowSort},columnSort:{...BASE.heatmap.columnSort,...raw.heatmap?.columnSort}},columns:raw.columns||{},saved:raw.saved||{}};}catch(_){state=structuredClone(BASE);}
  const isEn=()=>document.documentElement.lang==='en';
  const t=key=>TEXT[key]?.[isEn()?1:0]||EXTRA_TEXT[key]?.[isEn()?1:0]||key;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const sourceName=source=>SOURCE_NAMES[source]||source;
  const dimensionLabel=key=>TEXT[key]?.[isEn()?1:0]||window.BLCanonicalFields?.label?.(key,isEn()?'en':'tr')||String(key).replace(/([a-z])([A-Z])/g,'$1 $2');
  const metricLabel=key=>TEXT[key]?.[isEn()?1:0]||key;
  const observationValue=(item,key)=>item&&Object.prototype.hasOwnProperty.call(item,key)?item[key]:(item?.row&&Object.prototype.hasOwnProperty.call(item.row,key)?item.row[key]:item?.raw?.[key]);
  const config=()=>({source:state.source,scope:state.scope,priceType:state.priceType,dimensions:[...state.dimensions],metric:state.metric,filters:structuredClone(state.filters),includeOutliers:state.includeOutliers,minSample:state.minSample,thresholds:structuredClone(state.thresholds)});
  function persist(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify({...state,comparisonConfigs:comparisons.map(slot=>({...slot.config,name:slot.name}))}));}catch(_){}}
  function format(value,key,currency=''){
    if(!Number.isFinite(Number(value)))return '—';const percent=key==='differencePct'||key==='lowestDifferencePct',price=PRICE_COLUMNS.has(key),number=Number(value).toLocaleString(isEn()?'en-GB':'tr-TR',{minimumFractionDigits:price?2:0,maximumFractionDigits:2});
    if(percent)return `${number}%`;if(!price)return number;return `${currency==='TRY'?'₺':currency==='USD'?'$':''}${number}`;
  }
  function defaultPrice(source){return source==='collection'?'quotation':source==='lfl'?'fob':'finalFob';}
  function normalizeInsightLimit(value){return Math.min(100,Math.max(1,Math.round(Number(value)||5)));}
  function cleanState(){
    dimensions=E.availableDimensions(dataset?.observations||[],DIMENSION_ORDER).filter(key=>!String(key).startsWith('_'));
    state.dimensions=[...new Set(state.dimensions.filter(key=>dimensions.includes(key)))];
    if(!state.dimensions.length)state.dimensions=[dimensions.includes('classification')?'classification':dimensions[0]].filter(Boolean);
    if(state.dimensions.length===1&&dimensions.includes('manufacturer')&&!state.dimensions.includes('manufacturer'))state.dimensions.push('manufacturer');
    state.filters=state.filters.filter(filter=>dimensions.includes(filter.field));
    state.insightLimit=normalizeInsightLimit(state.insightLimit);
    if(!E.PRICE_METRICS.has(state.metric))state.metric='average';
    if(!dimensions.includes(state.heatmap.row))state.heatmap.row=state.dimensions[0]||dimensions[0]||'';
    if(!dimensions.includes(state.heatmap.column)||state.heatmap.column===state.heatmap.row)state.heatmap.column=state.dimensions.at(-1)||dimensions.find(key=>key!==state.heatmap.row)||state.heatmap.row;
    if(!state.heatmap.rowSort||typeof state.heatmap.rowSort!=='object')state.heatmap.rowSort={key:'',dir:'asc'};
    if(!state.heatmap.columnSort||typeof state.heatmap.columnSort!=='object')state.heatmap.columnSort={key:'',dir:'asc'};
    if(state.heatmap.rowSort.key&&!dimensions.includes(state.heatmap.rowSort.key))state.heatmap.rowSort={key:'',dir:'asc'};
    if(state.heatmap.columnSort.key&&!dimensions.includes(state.heatmap.columnSort.key))state.heatmap.columnSort={key:'',dir:'asc'};
  }
  async function prepare(){
    const seq=++requestSeq;loading=true;error='';dataset=null;analysis=null;render();await frame();
    try{
      const next=await window.BLPriceSupplierAnalysisBridge.get(state.source,state.scope,state.priceType);
      if(seq!==requestSeq)return;dataset=next;state.priceType=next.priceType||state.priceType;cleanState();runAnalysis();
    }catch(err){if(seq!==requestSeq)return;error=err?.message||String(err);analysis=null;}
    finally{if(seq===requestSeq){loading=false;persist();render();}}
  }
  function runAnalysis(){
    if(!dataset)return;const cfg=config(),datasetVersion=String(dataset.version||dataset.loadedAt||`${state.source}:${dataset.observations?.length||0}`),key=window.BLAnalysisCache?.key?window.BLAnalysisCache.key({sourceVersion:datasetVersion,filters:cfg.filters,metric:cfg.metric,config:cfg}):`${datasetVersion}|${JSON.stringify(cfg)}`;
    analysis=analysisCache.get(key);if(!analysis){analysis=E.supplierIntelligence(dataset.observations,cfg);analysisCache.set(key,analysis);}analysis.config=cfg;persist();
  }
  function recalculate(){runAnalysis();render();}
  function activeFilterCount(){return state.filters.filter(filter=>String(filter.value??'').trim()).length;}
  function priceOptions(){return dataset?.priceTypes||[];}
  function priceLabel(item){return PRICE_NAMES[item.key]?.[isEn()?1:0]||item.label||item.key;}

  function toolbar(){
    const savedNames=Object.keys(state.saved).sort((a,b)=>a.localeCompare(b,isEn()?'en':'tr'));
    return `<div class="paV2Toolbar">
      <label><span>${t('source')}</span><select data-pa="source">${Object.keys(SOURCE_NAMES).map(source=>`<option value="${source}"${state.source===source?' selected':''}>${sourceName(source)}</option>`).join('')}</select></label>
      <label><span>${t('scope')}</span><select data-pa="scope"><option value="all"${state.scope==='all'?' selected':''}>${t('all')}</option><option value="filtered"${state.scope==='filtered'?' selected':''}>${t('filtered')}</option></select></label>
      ${priceOptions().length?`<label><span>${t('price')}</span><select data-pa="priceType">${priceOptions().map(item=>`<option value="${esc(item.key)}"${state.priceType===item.key?' selected':''}>${esc(priceLabel(item))}</option>`).join('')}</select></label>`:''}
      <label><span>${t('metric')}</span><select data-pa="metric">${['average','median','weightedAverage'].map(metric=>`<option value="${metric}"${state.metric===metric?' selected':''}>${t(metric)}</option>`).join('')}</select></label>
      <button type="button" class="tbtn${activeFilterCount()?' active':''}" data-pa="filters">${t('filters')}${activeFilterCount()?` <b>${activeFilterCount()}</b>`:''}</button>
      <button type="button" class="tbtn" data-pa="breakdown">${t('breakdown')} <small>${esc(state.dimensions.map(dimensionLabel).join(' › '))}</small></button>
      <button type="button" class="tbtn" data-pa="saved">${t('saved')}${savedNames.length?` <b>${savedNames.length}</b>`:''}</button>
      <span class="paV2ToolbarSpacer"></span>
      <button type="button" class="tbtn" data-pa="columns">${t('columns')}</button>
      <button type="button" class="tbtn" data-pa="compare">${t('compare')}${comparisons.length?` <b>${comparisons.length}</b>`:''}</button>
      <button type="button" class="primary" data-pa="export">${t('export')}</button>
    </div>`;
  }
  function chips(){const active=state.filters.filter(filter=>String(filter.value??'').trim());if(!active.length)return '';return `<div class="paV2Chips">${active.map((filter,index)=>`<button type="button" data-filter-chip="${index}" title="${t('remove')}"><span>${esc(dimensionLabel(filter.field))}</span>${esc(Array.isArray(filter.value)?filter.value.join(', '):filter.value)} ×</button>`).join('')}</div>`;}
  function drawer(){
    if(!activeDrawer)return '';
    if(activeDrawer==='filters')return filterDrawer();
    if(activeDrawer==='breakdown')return breakdownDrawer();
    if(activeDrawer==='saved')return savedDrawer();
    if(activeDrawer==='columns')return columnsDrawer();
    if(activeDrawer==='compare')return compareDrawer();return '';
  }
  function drawerShell(title,body){return `<section class="paV2Drawer" role="region" aria-label="${esc(title)}"><div class="paV2DrawerHead"><b>${esc(title)}</b><button type="button" class="iconBtn" data-pa="closeDrawer" aria-label="${t('close')}">×</button></div>${body}</section>`;}
  function filterDrawer(){
    const rows=state.filters.map((filter,index)=>`<div class="paV2FilterRow"><select data-filter-field="${index}">${dimensions.map(dim=>`<option value="${esc(dim)}"${dim===filter.field?' selected':''}>${esc(dimensionLabel(dim))}</option>`).join('')}</select><button type="button" class="tbtn${String(filter.value??'').trim()?' active':''}" data-filter-values="${index}">${String(filter.value??'').trim()?`${Array.isArray(filter.value)?filter.value.length:String(filter.value).split(',').filter(Boolean).length} ${isEn()?'selected':'seçim'}`:t('all')}</button><button type="button" class="iconBtn" data-filter-remove="${index}" aria-label="${t('remove')}">×</button></div>`).join('');
    return drawerShell(t('filters'),`<div class="paV2FilterList">${rows||`<span class="muted">${t('none')}</span>`}</div><button type="button" class="tbtn" data-pa="addFilter">＋ ${t('filters')}</button>`);
  }
  function breakdownDrawer(){
    const rows=state.dimensions.map((dimension,index)=>`<div class="paV2DimensionRow"><span>${index+1}</span><select data-dimension="${index}">${dimensions.map(dim=>`<option value="${esc(dim)}"${dim===dimension?' selected':''}>${esc(dimensionLabel(dim))}</option>`).join('')}</select><button type="button" class="iconBtn" data-dim-up="${index}"${index?'':' disabled'}>↑</button><button type="button" class="iconBtn" data-dim-down="${index}"${index<state.dimensions.length-1?'':' disabled'}>↓</button><button type="button" class="iconBtn" data-dim-remove="${index}"${state.dimensions.length>1?'':' disabled'}>×</button></div>`).join('');
    return drawerShell(t('breakdown'),`<div class="paV2DimensionList">${rows}</div><button type="button" class="tbtn" data-pa="addDimension">＋ ${t('addDimension')}</button><div class="paV2Settings"><b>${t('thresholds')}</b><label>${t('below')} <input type="number" step="1" data-pa-setting="below" value="${state.thresholds.below}"></label><label>${t('above')} <input type="number" step="1" data-pa-setting="above" value="${state.thresholds.above}"></label><label>${t('minSample')} <input type="number" min="1" step="1" data-pa-setting="minSample" value="${state.minSample}"></label><label>${t('insightLimit')} <input type="number" min="1" max="100" step="1" data-pa-setting="insightLimit" value="${state.insightLimit}"></label><label class="paV2Check"><input type="checkbox" data-pa-setting="includeOutliers"${state.includeOutliers?' checked':''}> ${t('includeOutliers')}</label></div>`);
  }
  function savedDrawer(){
    const names=Object.keys(state.saved).sort((a,b)=>a.localeCompare(b,isEn()?'en':'tr'));
    return drawerShell(t('saved'),`<div class="paV2Saved"><select data-pa="savedSelect"><option value="">${t('newView')}</option>${names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select><input data-pa="savedName" placeholder="${t('viewName')}"><button type="button" class="primary" data-pa="saveView">${t('save')}</button><button type="button" class="tbtn" data-pa="loadView">${t('load')}</button><button type="button" class="tbtn danger" data-pa="deleteView">${t('remove')}</button></div>`);
  }
  function columnDefinitions(){
    const all=[...state.dimensions,...CORE_COLUMNS];
    all.forEach((key,index)=>{if(!state.columns[key])state.columns[key]={visible:!['weightedAverage','totalQuantity'].includes(key),order:index,width:state.dimensions.includes(key)?150:112};});
    return all.map(key=>({key,...state.columns[key]})).sort((a,b)=>a.order-b.order);
  }
  function columnsDrawer(){return drawerShell(t('columns'),`<div class="paV2ColumnList">${columnDefinitions().map((column,index)=>`<label><input type="checkbox" data-column-visible="${esc(column.key)}"${column.visible!==false?' checked':''}> <span>${esc(state.dimensions.includes(column.key)?dimensionLabel(column.key):metricLabel(column.key))}</span><button type="button" class="iconBtn" data-column-up="${esc(column.key)}"${index?'':' disabled'}>↑</button><button type="button" class="iconBtn" data-column-down="${esc(column.key)}"${index<columnDefinitions().length-1?'':' disabled'}>↓</button></label>`).join('')}</div>`);}
  function compareDrawer(){return drawerShell(t('compare'),`<div class="paV2CompareActions"><button type="button" class="primary" data-pa="addComparison"${analysis&&comparisons.length<4?'':' disabled'}>＋ ${t('addCurrent')}</button><button type="button" class="tbtn" data-pa="clearComparison">${t('clear')}</button></div>${comparisons.map((slot,index)=>`<article><button type="button" class="iconBtn" data-comparison-remove="${index}">×</button><b>${esc(slot.name)}</b><span>${esc(sourceName(slot.config.source))} · ${esc(slot.config.dimensions.map(dimensionLabel).join(' › '))}</span></article>`).join('')}`);}

  function kpi(label,value,key,currency){return `<article><span>${esc(label)}</span><strong>${format(value,key,currency)}</strong></article>`;}
  function overview(){
    if(!analysis)return '';const global=E.metricResult(analysis.records,state.metric),currency=global.currency;
    return `<section class="paV2Overview paV2Panel"><div class="paV2PanelHead"><h2>${t('overview')}</h2><span>${esc(state.dimensions.map(dimensionLabel).join(' › '))}</span></div><div class="paV2Kpis">${kpi(t(state.metric),global.value,state.metric,currency)}${kpi(t('median'),analysis.stats.median,'median',currency)}${kpi(t('modelCount'),analysis.stats.modelCount,'modelCount')}${kpi(t('optionCount'),analysis.stats.optionCount,'optionCount')}${kpi(t('recordCount'),analysis.stats.recordCount,'recordCount')}${kpi(t('below'),analysis.rows.filter(row=>row.pricePosition==='below').length,'recordCount')}${kpi(t('above'),analysis.rows.filter(row=>row.pricePosition==='above').length,'recordCount')}</div>${qualityStrip()}</section>`;
  }
  function qualityStrip(){const q=analysis.dataQuality;return `<div class="paV2Quality"><b>${t('dataQuality')}</b><span>${t('input')}: <strong>${q.inputCount}</strong></span><span>${t('valid')}: <strong>${q.validPriceCount}</strong></span><span>${t('missing')}: <strong>${q.excludedMissingPrice}</strong></span><span>${t('outliers')}: <strong>${q.outlierCount}</strong></span><span>${t('excluded')}: <strong>${q.excludedOutlier}</strong></span><span>${t('mixed')}: <strong>${q.mixedCurrencyGroups}</strong></span>${q.mixedCurrencyGroups?`<em>${t('mixedWarning')}</em>`:''}${!state.includeOutliers&&q.outlierCount?`<em>${t('outlierWarning')}</em>`:''}</div>`;}
  function insightList(title,rows,tone){return `<article class="paV2Insight ${tone}"><h3>${esc(title)}</h3>${rows.length?rows.slice(0,state.insightLimit).map(row=>`<button type="button" data-insight="${esc(row.path.join('\u241f'))}"><span>${esc(row.path.join(' › '))}</span><b>${format(row.values[state.metric]?.value,state.metric,row.values[state.metric]?.currency)}</b><small>${format(row.differencePct,'differencePct')}</small></button>`).join(''):`<p>${t('none')}</p>`}</article>`;}
  function opportunities(){if(!analysis)return '';return `<section class="paV2Opportunities">${insightList(t('lowestSuppliers'),analysis.insights.lowest,'neutral')}${insightList(t('belowAverage'),analysis.insights.opportunities,'good')}${insightList(t('highAlerts'),analysis.insights.alerts,'bad')}</section>`;}

  function rowValue(row,key){
    if(state.dimensions.includes(key))return row.dimensions?.[key]??(row.path?.[state.dimensions.indexOf(key)]||'');
    if(key==='parentAverage')return row.parentBenchmark?.value;
    if(key==='difference'||key==='differencePct'||key==='lowestDifferencePct'||key==='pricePosition')return row[key];
    return row.values?.[key]?.value;
  }
  function columnCurrency(row,key){if(key==='parentAverage')return row.parentBenchmark?.currency;if(key==='difference')return row.values?.[state.metric]?.currency;return row.values?.[key]?.currency;}
  function visibleColumns(){return columnDefinitions().filter(column=>column.visible!==false);}
  function sortLeaves(list){const {key,dir}=state.sort||{},factor=dir==='desc'?-1:1;return [...list].sort((a,b)=>{const av=rowValue(a,key),bv=rowValue(b,key);const delta=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),isEn()?'en':'tr',{numeric:true,sensitivity:'base'});return factor*delta;});}
  function appendHierarchy(out,parentPath=[]){
    const prefix=JSON.stringify(parentPath),nextDepth=parentPath.length+1;
    const summaries=analysis.hierarchyRows.filter(row=>row.isSummary&&row.path.length===nextDepth&&JSON.stringify(row.path.slice(0,-1))===prefix);
    summaries.forEach(summary=>{const key=JSON.stringify(summary.path);out.push(summary);if(!collapsed.has(key))appendHierarchy(out,summary.path);});
    if(nextDepth===state.dimensions.length)out.push(...sortLeaves(analysis.rows.filter(row=>JSON.stringify(row.path.slice(0,-1))===prefix)));
  }
  function rankingRows(){
    if(!analysis)return [];if(state.dimensions.length<2)return sortLeaves(analysis.rows);
    const out=[];appendHierarchy(out);
    return out;
  }
  function positionHtml(value){return `<span class="paV2Position is-${esc(value||'unavailable')}">${t(value||'unavailable')}</span>`;}
  function ranking(){
    if(!analysis)return '';const columns=visibleColumns();return `<section class="paV2Ranking paV2Panel"><div class="paV2PanelHead"><h2>${t('ranking')} <small>${analysis.rows.length.toLocaleString()}</small></h2><span>${t('details')}</span></div><div class="paV2Virtual" id="paV2Virtual"><table class="miniTable"><colgroup>${columns.map(column=>`<col style="width:${column.width}px">`).join('')}</colgroup><thead><tr>${columns.map(column=>`<th><button type="button" data-sort="${esc(column.key)}">${esc(state.dimensions.includes(column.key)?dimensionLabel(column.key):metricLabel(column.key))}${state.sort.key===column.key?` ${state.sort.dir==='asc'?'↑':'↓'}`:''}</button></th>`).join('')}</tr></thead><tbody id="paV2Body"></tbody></table></div></section>`;
  }
  function renderVirtual(){
    const body=root?.querySelector('#paV2Body'),viewport=root?.querySelector('#paV2Virtual');if(!body||!viewport||!analysis)return;const rows=rankingRows(),columns=visibleColumns(),height=32,start=Math.max(0,Math.floor(scrollTop/height)-8),end=Math.min(rows.length,start+42),span=Math.max(columns.length,1);
    body.innerHTML=`${start?`<tr class="paV2Spacer"><td colspan="${span}" style="height:${start*height}px"></td></tr>`:''}${rows.slice(start,end).map((row,index)=>rankingRow(row,start+index,columns)).join('')}${end<rows.length?`<tr class="paV2Spacer"><td colspan="${span}" style="height:${(rows.length-end)*height}px"></td></tr>`:''}`;
    body.querySelectorAll('[data-rank-index]').forEach(tr=>tr.addEventListener('dblclick',()=>{const row=rows[Number(tr.dataset.rankIndex)];if(!row.isSummary)window.BLPriceSupplierAnalysisBridge.openDrilldown(state.source,row.items,row.path.map((part,index)=>`${dimensionLabel(state.dimensions[index])}: ${part}`).join(' · '));}));
    body.querySelectorAll('[data-summary-key]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const key=button.dataset.summaryKey;if(collapsed.has(key))collapsed.delete(key);else collapsed.add(key);renderVirtual();}));
  }
  function rankingRow(row,index,columns){
    const current=row.values?.[state.metric],summary=row.isSummary,summaryKey=JSON.stringify(row.path||[]),firstDimension=columns.find(column=>state.dimensions.includes(column.key))?.key;
    return `<tr data-rank-index="${index}" class="${summary?'is-summary':''}${row.sampleFlag==='low-sample'?' is-low-sample':''}">${columns.map(column=>{const value=rowValue(row,column.key);let content;if(column.key==='pricePosition')content=summary?'':positionHtml(value);else if(summary&&column.key===firstDimension)content=`<button type="button" data-summary-key="${esc(summaryKey)}" style="--pa-level:${Math.max(0,row.path.length-1)}">${collapsed.has(summaryKey)?'▸':'▾'} ${esc(row.path.at(-1)||'—')}</button>`;else if(state.dimensions.includes(column.key))content=summary?'':esc(value||'—');else content=format(value,column.key,columnCurrency(row,column.key)||current?.currency);return `<td>${content}${!summary&&row.sampleFlag==='low-sample'&&column.key==='modelCount'?` <small>${t('lowSample')}</small>`:''}</td>`;}).join('')}</tr>`;
  }

  function heatmapSortLabels(labels,matrix,axis,key,dir){
    if(!key)return [...labels];
    const factor=dir==='desc'?-1:1;
    return [...labels].sort((a,b)=>{
      const av=axis==='rows'?matrix.value(a,key).value:matrix.value(key,a).value;
      const bv=axis==='rows'?matrix.value(b,key).value:matrix.value(key,b).value;
      const an=Number(av),bn=Number(bv),ahas=Number.isFinite(an)&&an>0,bhas=Number.isFinite(bn)&&bn>0;
      if(ahas!==bhas)return ahas?-1:1;
      if(!ahas)return String(a).localeCompare(String(b),isEn()?'en':'tr',{numeric:true,sensitivity:'base'});
      return (an-bn)*factor||String(a).localeCompare(String(b),isEn()?'en':'tr',{numeric:true,sensitivity:'base'});
    });
  }
  function heatmap(){
    if(!analysis||state.dimensions.length<2)return '';const matrix=E.flexibleMatrix(analysis.records,state.heatmap.row,state.heatmap.column,state.metric),rows=heatmapSortLabels(matrix.rows,matrix,'rows',state.heatmap.rowSort?.key,state.heatmap.rowSort?.dir).slice(0,state.heatmap.limit),columns=heatmapSortLabels(matrix.columns,matrix,'columns',state.heatmap.columnSort?.key,state.heatmap.columnSort?.dir).slice(0,state.heatmap.limit);const columnRanges=new Map(columns.map(column=>{const values=rows.map(row=>matrix.value(row,column).value).filter(value=>Number.isFinite(value)&&value>0);return [column,{min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0}];})),rowSort=state.heatmap.rowSort||{},columnSort=state.heatmap.columnSort||{};
    return `<section class="paV2Heatmap paV2Panel"><div class="paV2PanelHead"><h2>${t('heatmap')}</h2><div><label>${t('row')} <select data-heatmap="row">${dimensions.map(dim=>`<option value="${esc(dim)}"${state.heatmap.row===dim?' selected':''}>${esc(dimensionLabel(dim))}</option>`).join('')}</select></label><label>${t('column')} <select data-heatmap="column">${dimensions.map(dim=>`<option value="${esc(dim)}"${state.heatmap.column===dim?' selected':''}>${esc(dimensionLabel(dim))}</option>`).join('')}</select></label></div></div><div class="paV2HeatmapScroll"><table><thead><tr><th>${esc(dimensionLabel(state.heatmap.row))}</th>${columns.map(column=>`<th><button type="button" class="paV2HeatmapSort" data-heat-column-sort="${esc(column)}" title="${esc(t('sortColumn'))}">${esc(column)}${rowSort.key===column?` ${rowSort.dir==='asc'?'↑':'↓'}`:''}</button></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th>${esc(row)}</th>${columns.map(column=>{const cell=matrix.value(row,column),columnRange=columnRanges.get(column)||{min:0,max:0},ratio=Number.isFinite(cell.value)&&cell.value>0&&columnRange.max>columnRange.min?1-(cell.value-columnRange.min)/(columnRange.max-columnRange.min):0;return `<td style="--pa-heat:${ratio.toFixed(3)}" data-heat-row="${esc(row)}" data-heat-column="${esc(column)}" data-heat-row-sort="${esc(row)}" title="${esc(t('sortRow'))}">${Number(cell.value)===0?'':format(cell.value,state.metric,cell.currency)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function comparison(){
    if(comparisons.length<2)return '';const metric=state.metric,result=E.compareAnalyses(comparisons.map(slot=>slot.result),metric);if(!result.compatible)return `<section class="paV2Panel paV2Comparison"><h2>${t('compare')}</h2><p>${t('mixedWarning')}</p></section>`;
    return `<section class="paV2Panel paV2Comparison"><div class="paV2PanelHead"><h2>${t('compare')}</h2><button class="tbtn" data-pa="clearComparison">${t('clear')}</button></div><div><table class="miniTable"><thead><tr>${result.dimensions.map(dim=>`<th>${esc(dimensionLabel(dim))}</th>`).join('')}${comparisons.map(slot=>`<th>${esc(slot.name)}</th>`).join('')}<th>${t('difference')}</th><th>${t('differencePct')}</th></tr></thead><tbody>${result.rows.slice(0,250).map(row=>`<tr>${row.path.map(value=>`<td>${esc(value)}</td>`).join('')}${row.values.map(value=>`<td>${format(value?.value,metric,value?.currency)}</td>`).join('')}<td>${format(row.delta,'difference',row.values[0]?.currency)}</td><td>${format(row.deltaPct,'differencePct')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function empty(){
    const ui=window.BLUI;
    if(ui&&typeof ui.stateView==='function'){
      const en=isEn();
      const view=error
        ?ui.stateView({kind:'error',title:t('failed'),detail:error})
        :ui.stateView({kind:'empty',icon:'chart-histogram',title:t('noData'),
          detail:en?'Change the source or scope above. The analysis fills in as prices are entered in Collection or Quotations.':'Yukarıdan kaynağı veya kapsamı değiştir. Koleksiyon ya da Quotations’a fiyat girildikçe analiz dolar.'});
      return `<section class="paV2Panel paV2Empty">${view}</section>`;
    }
    return `<section class="paV2Panel paV2Empty">${error?`${t('failed')}: ${esc(error)}`:t('noData')}</section>`;
  }
  function render(){
    if(!root)return;root.innerHTML=`${toolbar()}${chips()}${drawer()}${loading?`<div class="paV2Busy"><span></span>${t('loading')}</div>`:analysis&&analysis.records.length?`${overview()}${opportunities()}${ranking()}${heatmap()}${comparison()}`:empty()}`;bind();if(analysis){const viewport=root.querySelector('#paV2Virtual');if(viewport){viewport.scrollTop=scrollTop;requestAnimationFrame(renderVirtual);}}
  }

  function openFilterValues(anchor,index){
    const filter=state.filters[index];if(!filter||!dataset?.observations||typeof window.openValueFilterPanel!=='function')return;const values=[...new Set(dataset.observations.map(item=>String(observationValue(item,filter.field)??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,isEn()?'en':'tr',{numeric:true,sensitivity:'base'}));const selected=new Set(Array.isArray(filter.value)?filter.value:String(filter.value||'').split(',').map(value=>value.trim()).filter(Boolean));
    window.openValueFilterPanel({anchorEl:anchor,title:dimensionLabel(filter.field),values,selected,onApply:next=>{const chosen=[...(next||[])].map(String).filter(Boolean);filter.operator='in';filter.value=chosen.length===values.length?[]:chosen;recalculate();},onRemove:()=>{filter.value=[];recalculate();}});
  }
  function moveDimension(from,to){if(to<0||to>=state.dimensions.length)return;const [item]=state.dimensions.splice(from,1);state.dimensions.splice(to,0,item);state.columns={};collapsed.clear();recalculate();}
  function moveColumn(key,step){const list=columnDefinitions(),index=list.findIndex(column=>column.key===key),target=index+step;if(target<0||target>=list.length)return;[state.columns[list[index].key].order,state.columns[list[target].key].order]=[state.columns[list[target].key].order,state.columns[list[index].key].order];persist();render();}
  function saveView(){const input=root.querySelector('[data-pa="savedName"]'),name=String(input?.value||'').trim();if(!name)return input?.focus();state.saved[name]={source:state.source,scope:state.scope,priceType:state.priceType,metric:state.metric,filters:structuredClone(state.filters),dimensions:structuredClone(state.dimensions),thresholds:structuredClone(state.thresholds),includeOutliers:state.includeOutliers,minSample:state.minSample,insightLimit:state.insightLimit,sort:structuredClone(state.sort),columns:structuredClone(state.columns),heatmap:structuredClone(state.heatmap),comparisonConfigs:comparisons.map(slot=>({...slot.config,name:slot.name}))};persist();window.showToast?.(t('savedOk'));render();}
  async function loadView(name){const view=state.saved[name];if(!view)return;const saved=state.saved,next={...state,...structuredClone(view),saved,thresholds:{...BASE.thresholds,...view.thresholds},heatmap:{...BASE.heatmap,...view.heatmap}};Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,next);comparisons=[];collapsed.clear();await prepare();if(view.comparisonConfigs?.length)await hydrateComparisons(view.comparisonConfigs);}
  async function hydrateComparisons(configs){for(const cfg of (configs||[]).slice(0,4)){await frame();const data=await window.BLPriceSupplierAnalysisBridge.get(cfg.source,cfg.scope,cfg.priceType);const result=E.supplierIntelligence(data.observations,cfg);comparisons.push({name:cfg.name||sourceName(cfg.source),config:cfg,result});}persist();render();}
  function exportXlsx(){
    if(!window.XLSX||!analysis)return;const workbook=XLSX.utils.book_new(),columns=visibleColumns(),out=analysis.rows.map(row=>Object.fromEntries(columns.map(column=>[state.dimensions.includes(column.key)?dimensionLabel(column.key):metricLabel(column.key),rowValue(row,column.key)])));
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(out),t('analysis'));
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{'Data Quality':t('input'),Value:analysis.dataQuality.inputCount},{'Data Quality':t('valid'),Value:analysis.dataQuality.validPriceCount},{'Data Quality':t('missing'),Value:analysis.dataQuality.excludedMissingPrice},{'Data Quality':t('outliers'),Value:analysis.dataQuality.outlierCount},{'Data Quality':t('excluded'),Value:analysis.dataQuality.excludedOutlier},{'Data Quality':t('mixed'),Value:analysis.dataQuality.mixedCurrencyGroups}]),'Data Quality');
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Source:sourceName(state.source),Scope:state.scope,Price:state.priceType,Metric:state.metric,Breakdown:state.dimensions.map(dimensionLabel).join(' > '),Filters:JSON.stringify(state.filters),IncludeOutliers:state.includeOutliers,MinimumSample:state.minSample}]),t('configuration'));
    XLSX.writeFile(workbook,`Price_Supplier_Analysis_V2_${new Date().toISOString().slice(0,10).replaceAll('-','')}.xlsx`);
  }
  function bind(){
    root.querySelector('[data-pa="source"]')?.addEventListener('change',event=>{state.source=event.target.value;state.priceType=defaultPrice(state.source);state.filters=[];state.columns={};collapsed.clear();analysisCache.clear();prepare();});
    root.querySelector('[data-pa="scope"]')?.addEventListener('change',event=>{state.scope=event.target.value;prepare();});
    root.querySelector('[data-pa="priceType"]')?.addEventListener('change',event=>{state.priceType=event.target.value;prepare();});
    root.querySelector('[data-pa="metric"]')?.addEventListener('change',event=>{state.metric=event.target.value;state.sort={key:event.target.value,dir:'asc'};recalculate();});
    ['filters','breakdown','saved','columns','compare'].forEach(name=>root.querySelector(`[data-pa="${name}"]`)?.addEventListener('click',()=>{activeDrawer=activeDrawer===name?'':name;render();}));
    root.querySelector('[data-pa="closeDrawer"]')?.addEventListener('click',()=>{activeDrawer='';render();});
    root.querySelector('[data-pa="export"]')?.addEventListener('click',exportXlsx);
    root.querySelectorAll('[data-filter-chip]').forEach(button=>button.addEventListener('click',()=>{const active=state.filters.filter(filter=>String(filter.value??'').trim()),filter=active[Number(button.dataset.filterChip)],index=state.filters.indexOf(filter);if(index>=0)state.filters.splice(index,1);recalculate();}));
    root.querySelector('[data-pa="addFilter"]')?.addEventListener('click',()=>{const field=dimensions.find(dim=>!state.filters.some(filter=>filter.field===dim))||dimensions[0];if(field)state.filters.push({field,operator:'in',value:[]});render();});
    root.querySelectorAll('[data-filter-field]').forEach(select=>select.addEventListener('change',()=>{const filter=state.filters[Number(select.dataset.filterField)];filter.field=select.value;filter.value=[];recalculate();}));
    root.querySelectorAll('[data-filter-values]').forEach(button=>button.addEventListener('click',()=>openFilterValues(button,Number(button.dataset.filterValues))));
    root.querySelectorAll('[data-filter-remove]').forEach(button=>button.addEventListener('click',()=>{state.filters.splice(Number(button.dataset.filterRemove),1);recalculate();}));
    root.querySelectorAll('[data-dimension]').forEach(select=>select.addEventListener('change',()=>{state.dimensions[Number(select.dataset.dimension)]=select.value;state.dimensions=[...new Set(state.dimensions)];state.columns={};collapsed.clear();recalculate();}));
    root.querySelectorAll('[data-dim-up]').forEach(button=>button.addEventListener('click',()=>moveDimension(Number(button.dataset.dimUp),Number(button.dataset.dimUp)-1)));
    root.querySelectorAll('[data-dim-down]').forEach(button=>button.addEventListener('click',()=>moveDimension(Number(button.dataset.dimDown),Number(button.dataset.dimDown)+1)));
    root.querySelectorAll('[data-dim-remove]').forEach(button=>button.addEventListener('click',()=>{state.dimensions.splice(Number(button.dataset.dimRemove),1);state.columns={};collapsed.clear();recalculate();}));
    root.querySelector('[data-pa="addDimension"]')?.addEventListener('click',()=>{const dimension=dimensions.find(dim=>!state.dimensions.includes(dim));if(dimension){state.dimensions.push(dimension);state.columns={};recalculate();}});
    root.querySelectorAll('[data-pa-setting]').forEach(control=>control.addEventListener('change',()=>{const key=control.dataset.paSetting;if(key==='includeOutliers')state.includeOutliers=control.checked;else if(key==='minSample')state.minSample=Math.max(1,Number(control.value)||2);else if(key==='insightLimit')state.insightLimit=normalizeInsightLimit(control.value);else state.thresholds[key]=Number(control.value);recalculate();}));
    root.querySelector('[data-pa="saveView"]')?.addEventListener('click',saveView);root.querySelector('[data-pa="loadView"]')?.addEventListener('click',()=>loadView(root.querySelector('[data-pa="savedSelect"]')?.value));root.querySelector('[data-pa="deleteView"]')?.addEventListener('click',()=>{const name=root.querySelector('[data-pa="savedSelect"]')?.value;if(name){delete state.saved[name];persist();render();}});
    root.querySelectorAll('[data-column-visible]').forEach(input=>input.addEventListener('change',()=>{state.columns[input.dataset.columnVisible].visible=input.checked;persist();render();}));root.querySelectorAll('[data-column-up]').forEach(button=>button.addEventListener('click',()=>moveColumn(button.dataset.columnUp,-1)));root.querySelectorAll('[data-column-down]').forEach(button=>button.addEventListener('click',()=>moveColumn(button.dataset.columnDown,1)));
    root.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{state.sort=state.sort.key===button.dataset.sort?{key:button.dataset.sort,dir:state.sort.dir==='asc'?'desc':'asc'}:{key:button.dataset.sort,dir:'asc'};persist();render();}));
    const viewport=root.querySelector('#paV2Virtual');viewport?.addEventListener('scroll',()=>{scrollTop=viewport.scrollTop;requestAnimationFrame(renderVirtual);});
    root.querySelectorAll('[data-insight]').forEach(button=>button.addEventListener('click',()=>{const row=analysis.rows.find(item=>item.path.join('\u241f')===button.dataset.insight);if(row)window.BLPriceSupplierAnalysisBridge.openDrilldown(state.source,row.items,row.path.join(' · '));}));
    root.querySelectorAll('[data-heatmap]').forEach(select=>select.addEventListener('change',()=>{const axis=select.dataset.heatmap;state.heatmap[axis]=select.value;state.heatmap[axis==='row'?'rowSort':'columnSort']={key:'',dir:'asc'};if(state.heatmap.row===state.heatmap.column){state.heatmap[axis==='row'?'column':'row']=dimensions.find(dim=>dim!==select.value)||select.value;}persist();render();}));
    root.querySelectorAll('[data-heat-column-sort],[data-heat-row-sort]').forEach(control=>control.addEventListener('click',event=>{if(event.detail>1)return;const isColumn=control.hasAttribute('data-heat-column-sort'),sortKey=isColumn?'rowSort':'columnSort',key=isColumn?control.dataset.heatColumnSort:control.dataset.heatRowSort,current=state.heatmap[sortKey]||{key:'',dir:'asc'};state.heatmap[sortKey]={key,dir:current.key===key&&current.dir==='asc'?'desc':'asc'};persist();render();}));
    root.querySelectorAll('[data-heat-row]').forEach(cell=>cell.addEventListener('dblclick',()=>{const matrix=E.flexibleMatrix(analysis.records,state.heatmap.row,state.heatmap.column,state.metric),items=matrix.items(cell.dataset.heatRow,cell.dataset.heatColumn);window.BLPriceSupplierAnalysisBridge.openDrilldown(state.source,items,`${cell.dataset.heatRow} · ${cell.dataset.heatColumn}`);}));
    root.querySelector('[data-pa="addComparison"]')?.addEventListener('click',()=>{if(analysis&&comparisons.length<4){const cfg=config();comparisons.push({name:`${sourceName(cfg.source)} ${comparisons.length+1}`,config:cfg,result:analysis});persist();render();}});root.querySelectorAll('[data-comparison-remove]').forEach(button=>button.addEventListener('click',()=>{comparisons.splice(Number(button.dataset.comparisonRemove),1);persist();render();}));root.querySelectorAll('[data-pa="clearComparison"]').forEach(button=>button.addEventListener('click',()=>{comparisons=[];persist();render();}));
  }
  async function init(){root=document.getElementById('priceSupplierAnalysis');if(!root)return;if(root.dataset.initialized){render();return;}root.dataset.initialized='1';render();await prepare();}
  window.initPriceSupplierAnalysis=init;
  window.renderPriceSupplierAnalysisLanguage=render;
  window.BLPriceSupplierAnalysis={state,prepare,run:recalculate};
})();
