/* Fiyat & Üretici Analizi — sade buyer asistanı.
   Veri: BLPriceSupplierAnalysisBridge (kanonik gözlemler, ek sorgu yok).
   Hesap: BLPriceSupplierInsights (saf motor). Bu dosya yalnız görünüm ve
   etkileşimdir; LFL'deki eski "Üretici & Ülke Sipariş Analizi" de buraya
   taşındı (ülke payı, üretici hacim hareketi, yeni/çıkan üretici). */
(function(){
  'use strict';

  const E=window.BLPriceSupplierInsights;if(!E)return;
  const STORAGE_KEY='lcw.priceSupplierAnalysis.v3';
  const SOURCES=['lfl','orders','cp','collection','horizon'];
  const TABS=['overview','advantage','scorecard','movement','relations'];
  const TAB_ICONS={overview:'layout-dashboard',advantage:'star',scorecard:'users-group',movement:'arrows-down-up',relations:'hierarchy'};
  const LIST_LIMIT=15;
  const ALL_SEASONS='*';
  const BASE={source:'lfl',tab:'overview',currentSeason:'',previousSeason:'',filters:{buyingGroup:'',mag:'',mmyg:'',classification:''},priceType:'',currency:'',groupBy:'classification',relationDim:'buyingGroup',sort:'volume',movement:'price'};
  const TEXT={
    tr:{title:'Fiyat & Üretici Analizi',subtitle:'Hangi üretici nerede avantajlı, kim pahalandı, kim yeni — tek bakışta.',source:'Veri',src_lfl:'LFL siparişleri',src_orders:'Siparişler',src_cp:'CP',src_collection:'Koleksiyon teklifleri',src_horizon:'Horizon',
      season:'Sezon',compare:'Kıyas',noCompare:'Kıyas yok',allSeasons:'Tüm sezonlar',all:'Tümü',clear:'Temizle',excel:'Excel',price:'Fiyat',currency:'Para birimi',
      buyingGroup:'Buying Group',buyer:'Buyer',mag:'MAG',mmyg:'MMYG',classification:'Klasman',productGroup:'Ürün Grubu',country:'Ülke',manufacturer:'Üretici',
      tab_overview:'Özet',tab_advantage:'Nerede avantajlı?',tab_scorecard:'Üretici karnesi',tab_movement:'Fiyat hareketi',tab_relations:'Kim kiminle?',
      hint_overview:'Seçili sezonun genel resmi ve sizin için öne çıkanlar.',
      hint_advantage:'Her satır bir grup. Noktalar üreticilerin ortalama fiyatı, çizgi grup ortalaması. Yeşil nokta en avantajlı üretici. Detay için satıra tıklayın.',
      hint_scorecard:'Bir üreticiye tıklayın: hangi klasmanda ucuz/pahalı, kimlerle çalışıyor, fiyatı nasıl değişti.',
      hint_movement:'Fiyat değişimi aynı klasmanlar içinde kıyaslanır; ürün karması farkı sonucu bozmaz.',
      hint_relations:'Her satırda o grubun en çok çalıştığı üreticiler ve payları. Bir parçaya tıklayınca siparişler açılır.',
      loading:'Veriler hazırlanıyor…',failed:'Analiz hazırlanamadı',noData:'Bu seçimde analiz edilecek kayıt yok.',noDataHint:'Başka bir veri kaynağı veya sezon seçmeyi deneyin.',
      volume:'Toplam hacim',units:'adet',records:'kayıt',avgPrice:'Ortalama fiyat',activeSuppliers:'Aktif üretici',countries:'Üretim ülkesi',
      vsPrev:'kıyasa göre',sameCategories:'aynı klasmanlarda',newShort:'yeni',exitShort:'ayrılan',leader:'Lider',assistant:'Sizin için öne çıkanlar',show:'Göster',
      topSuppliers:'En büyük üreticiler',countryMix:'Ülke dağılımı',current:'Bu sezon',previous:'Kıyas',other:'Diğer',unknown:'Belirtilmemiş',
      best:'En avantajlı',mostUsed:'En çok çalışılan',notComparable:'Kıyas için yeterli üretici yok',groupAvg:'Grup ortalaması',models:'model',lowSample:'az örnek',
      cheaper:'ucuz',pricier:'pahalı',onAverage:'Ortalama',priceLevel:'Fiyat seviyesi',priceChange:'Fiyat değişimi',share:'Pay',strongIn:'Güçlü olduğu',
      search:'Ara…',sortBy:'Sırala',sort_volume:'Hacim',sort_cheap:'En avantajlı',sort_rise:'En çok zamlanan',sort_name:'İsim',showAll:'Tümünü göster',showLess:'Daha az göster',
      openOrders:'Siparişleri aç',byCategory:'Klasman bazında fiyat konumu',workWith:'En çok çalıştığı buying group’lar',madeIn:'Üretim ülkeleri',noStrength:'Belirgin bir fiyat avantajı yok.',
      status_new:'Yeni',status_growing:'Büyüyor',status_declining:'Küçülüyor',status_stable:'Stabil',status_exit:'Ayrıldı',status_active:'',
      mode_price:'Fiyat değişimi',mode_volume:'Hacim değişimi',rising:'Fiyatı artanlar',falling:'Fiyatı düşenler',growing:'Hacmi artanlar',shrinking:'Hacmi azalanlar',
      market:'Piyasa geneli',newcomers:'Yeni üreticiler',leavers:'Bu sezon çalışılmayan üreticiler',none:'Kayıt yok.',needCompare:'Bu analiz için bir kıyas sezonu seçin.',
      notEnough:'Kıyaslanabilir fiyat verisi yok.',prevVolume:'Kıyas hacmi',suppliers:'üretici',pts:'puan',excelFail:'Excel dosyası hazırlanamadı.',
      summary:'Özet',sheetSuppliers:'Üreticiler',sheetAdvantage:'Nerede avantajlı',sheetRelations:'Kim kiminle',value:'Değer',status:'Durum',group:'Grup',drillHint:'Tıklayınca siparişler açılır'},
    en:{title:'Price & Supplier Analysis',subtitle:'Which supplier wins where, who got pricier, who is new — at a glance.',source:'Data',src_lfl:'LFL orders',src_orders:'Orders',src_cp:'CP',src_collection:'Collection quotes',src_horizon:'Horizon',
      season:'Season',compare:'Compare',noCompare:'No comparison',allSeasons:'All seasons',all:'All',clear:'Clear',excel:'Excel',price:'Price',currency:'Currency',
      buyingGroup:'Buying Group',buyer:'Buyer',mag:'MAG',mmyg:'MMYG',classification:'Category',productGroup:'Product Group',country:'Country',manufacturer:'Supplier',
      tab_overview:'Summary',tab_advantage:'Who wins where?',tab_scorecard:'Supplier scorecard',tab_movement:'Price movement',tab_relations:'Who works with whom?',
      hint_overview:'The big picture for the selected season and what stands out for you.',
      hint_advantage:'Each row is a group. Dots are supplier average prices, the line is the group average. The green dot is the best-value supplier. Click a row for details.',
      hint_scorecard:'Click a supplier: where it is cheap or expensive, who it works with, how its prices moved.',
      hint_movement:'Price change is compared within the same categories, so product-mix shifts do not distort it.',
      hint_relations:'Each row shows the suppliers that group works with most and their shares. Click a segment to open the orders.',
      loading:'Preparing data…',failed:'Analysis could not be prepared',noData:'No records to analyse for this selection.',noDataHint:'Try another data source or season.',
      volume:'Total volume',units:'units',records:'records',avgPrice:'Average price',activeSuppliers:'Active suppliers',countries:'Production countries',
      vsPrev:'vs comparison',sameCategories:'in the same categories',newShort:'new',exitShort:'left',leader:'Leader',assistant:'What stands out for you',show:'Show',
      topSuppliers:'Largest suppliers',countryMix:'Country mix',current:'This season',previous:'Comparison',other:'Other',unknown:'Unspecified',
      best:'Best value',mostUsed:'Most used',notComparable:'Not enough suppliers to compare',groupAvg:'Group average',models:'models',lowSample:'low sample',
      cheaper:'cheaper',pricier:'pricier',onAverage:'On average',priceLevel:'Price level',priceChange:'Price change',share:'Share',strongIn:'Strongest in',
      search:'Search…',sortBy:'Sort',sort_volume:'Volume',sort_cheap:'Best value',sort_rise:'Largest increase',sort_name:'Name',showAll:'Show all',showLess:'Show less',
      openOrders:'Open orders',byCategory:'Price position by category',workWith:'Top buying groups',madeIn:'Production countries',noStrength:'No clear price advantage.',
      status_new:'New',status_growing:'Growing',status_declining:'Shrinking',status_stable:'Stable',status_exit:'Left',status_active:'',
      mode_price:'Price change',mode_volume:'Volume change',rising:'Prices rising',falling:'Prices falling',growing:'Volume growing',shrinking:'Volume shrinking',
      market:'Market overall',newcomers:'New suppliers',leavers:'Suppliers not used this season',none:'No records.',needCompare:'Select a comparison season for this analysis.',
      notEnough:'No comparable price data.',prevVolume:'Comparison volume',suppliers:'suppliers',pts:'pts',excelFail:'Excel file could not be prepared.',
      summary:'Summary',sheetSuppliers:'Suppliers',sheetAdvantage:'Who wins where',sheetRelations:'Who works with whom',value:'Value',status:'Status',group:'Group',drillHint:'Click to open the orders'}
  };

  let state=JSON.parse(JSON.stringify(BASE)),root=null,data=null,dataset=null,seasonList=[],model=null,loading=false,error='',requestSeq=0;
  const ui={search:'',selected:'',expanded:null,showAll:false};
  const analysisCache=window.BLAnalysisCache?.create?.(24)||new Map();
  try{const saved=JSON.parse((window.BLStorage||localStorage).getItem(STORAGE_KEY)||'{}');state={...state,...saved,filters:{...BASE.filters,...(saved.filters||{})}};}catch(_){state=JSON.parse(JSON.stringify(BASE));}
  if(!SOURCES.includes(state.source))state.source=BASE.source;
  if(!TABS.includes(state.tab))state.tab='overview';

  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const t=key=>TEXT[isEn()?'en':'tr'][key]??TEXT.tr[key]??key;
  const locale=()=>isEn()?'en-GB':'tr-TR';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const icon=name=>`<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const nameOf=value=>value||t('unknown');
  /* Detay anahtarları ':' içerebilir (ör. "T-SHIRT: BASIC"); parçalar ayrı kodlanır. */
  const dk=value=>esc(encodeURIComponent(String(value==null?'':value)));
  const fmtInt=value=>Math.round(Number(value)||0).toLocaleString(locale());
  const fmtOne=value=>Math.abs(Number(value)||0).toLocaleString(locale(),{maximumFractionDigits:1});
  const fmtShare=value=>isEn()?`${fmtOne(value)}%`:`%${fmtOne(value)}`;
  const fmtSigned=value=>value==null||!Number.isFinite(Number(value))?'—':`${Number(value)>0?'+':Number(value)<0?'−':''}${fmtShare(value)}`;
  function fmtPrice(value){
    if(value==null||!Number.isFinite(Number(value)))return '—';
    const code=model?.currency||'USD',symbol={USD:'$',TRY:'₺',EUR:'€',GBP:'£'}[code];
    const number=Number(value).toLocaleString(locale(),{minimumFractionDigits:2,maximumFractionDigits:2});
    return symbol?`${symbol}${number}`:`${number} ${code}`;
  }
  const unit=()=>model&&!model.weighted?t('records'):t('units');
  const vol=value=>`${fmtInt(value)} ${unit()}`;
  function persist(){try{(window.BLStorage||localStorage).setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
  function dimLabel(dim){return TEXT[isEn()?'en':'tr'][dim]||window.BLCanonicalFields?.label?.(dim,isEn()?'en':'tr')||dim;}
  function levelPill(value){
    if(value==null)return '<span class="psaPill">—</span>';
    if(value<=-3)return `<span class="psaPill isGood" title="${esc(t('priceLevel'))}">${fmtShare(value)} ${esc(t('cheaper'))}</span>`;
    if(value>=3)return `<span class="psaPill isBad" title="${esc(t('priceLevel'))}">${fmtShare(value)} ${esc(t('pricier'))}</span>`;
    return `<span class="psaPill">${esc(t('onAverage'))}</span>`;
  }
  function changeText(value,{invert=false}={}){
    if(value==null||!Number.isFinite(Number(value)))return '<span class="psaMuted">—</span>';
    const good=invert?value<0:value>0,cls=Math.abs(value)<0.05?'':good?'isGood':'isBad';
    return `<span class="psaDelta ${cls}">${fmtSigned(value)}</span>`;
  }
  function statusBadge(status){const label=status?t('status_'+status):'';return label?`<span class="psaStatus is-${esc(status)}">${esc(label)}</span>`:'';}

  /* ---------- veri ---------- */
  async function prepare(){
    const seq=++requestSeq;loading=true;error='';render();
    try{
      if(state.source==='lfl'&&window.BLPerf?.ensureFeature)await window.BLPerf.ensureFeature('lfl');
      const next=await window.BLPriceSupplierAnalysisBridge.get(state.source,'all',state.priceType||undefined);
      if(seq!==requestSeq)return;
      data=next;state.priceType=next.priceType||'';dataset=E.prepare(next.observations||[]);seasonList=E.seasons(dataset);analysisCache.clear();
      if(state.currentSeason!==ALL_SEASONS&&state.currentSeason&&!seasonList.includes(state.currentSeason))state.currentSeason='';
      if(!state.currentSeason){const periods=E.defaultPeriods(seasonList);state.currentSeason=periods.currentSeason;state.previousSeason=periods.previousSeason;}
      if(state.previousSeason&&!seasonList.includes(state.previousSeason))state.previousSeason='';
      E.FILTER_DIMENSIONS.forEach(dim=>{if(state.filters[dim]&&!E.dimensionValues(dataset,dim).some(value=>E.keyOf(value)===E.keyOf(state.filters[dim])))state.filters[dim]='';});
      runAnalysis();
    }catch(err){if(seq!==requestSeq)return;error=err?.message||String(err);model=null;}
    finally{if(seq===requestSeq){loading=false;persist();render();}}
  }
  function runAnalysis(){
    if(!dataset){model=null;return;}
    const options={currentSeason:state.currentSeason===ALL_SEASONS?'':state.currentSeason,previousSeason:state.previousSeason,filters:state.filters,currency:state.currency,groupBy:state.groupBy};
    const datasetVersion=`${state.source}|${data?.version||''}|${state.priceType}`;
    const key=window.BLAnalysisCache?.key?window.BLAnalysisCache.key({datasetVersion,options}):`${datasetVersion}|${JSON.stringify(options)}`;
    model=analysisCache.get(key);
    if(!model){model=E.analyze(dataset,options);analysisCache.set(key,model);}
    persist();
  }
  function recalc(){runAnalysis();render();}
  function drill(items,title){if(items&&items.length)window.BLPriceSupplierAnalysisBridge?.openDrilldown?.(state.source,items,title);}

  /* ---------- kabuk ---------- */
  function sourceOptions(){return SOURCES.map(key=>`<option value="${key}"${state.source===key?' selected':''}>${esc(t('src_'+key))}</option>`).join('');}
  function seasonSelect(kind){
    const value=kind==='current'?state.currentSeason:state.previousSeason;
    const first=kind==='current'?`<option value="${ALL_SEASONS}"${value===ALL_SEASONS?' selected':''}>${esc(t('allSeasons'))}</option>`:`<option value="">${esc(t('noCompare'))}</option>`;
    return `<label class="psaField"><span>${esc(t(kind==='current'?'season':'compare'))}</span><select data-ps="${kind}Season">${first}${seasonList.slice().reverse().map(season=>`<option value="${esc(season)}"${season===value?' selected':''}>${esc(season)}</option>`).join('')}</select></label>`;
  }
  function filterSelect(dim){
    const values=dataset?E.dimensionValues(dataset,dim):[];if(!values.length)return '';
    const current=state.filters[dim]||'';
    return `<label class="psaField${current?' isActive':''}"><span>${esc(dimLabel(dim))}</span><select data-ps-filter="${dim}"><option value="">${esc(t('all'))}</option>${values.map(value=>`<option value="${esc(value)}"${E.keyOf(value)===E.keyOf(current)?' selected':''}>${esc(value)}</option>`).join('')}</select></label>`;
  }
  function controls(){
    if(!dataset)return '';
    const priceTypes=data?.priceTypes||[],currencies=dataset.currencies||[],active=E.FILTER_DIMENSIONS.some(dim=>state.filters[dim]);
    return `<div class="psaBar">
      <div class="psaPeriod">${seasonSelect('current')}${state.currentSeason===ALL_SEASONS?'':`<span class="psaVs" aria-hidden="true">↔</span>${seasonSelect('previous')}`}</div>
      <div class="psaFilters">${E.FILTER_DIMENSIONS.map(filterSelect).join('')}
        ${priceTypes.length>1?`<label class="psaField"><span>${esc(t('price'))}</span><select data-ps="priceType">${priceTypes.map(item=>`<option value="${esc(item.key)}"${item.key===state.priceType?' selected':''}>${esc(item.label||item.key)}</option>`).join('')}</select></label>`:''}
        ${currencies.length>1?`<label class="psaField"><span>${esc(t('currency'))}</span><select data-ps="currency">${currencies.map(code=>`<option value="${esc(code)}"${code===model?.currency?' selected':''}>${esc(code)}</option>`).join('')}</select></label>`:''}
        ${active?`<button type="button" class="psaLinkBtn" data-ps="clear">${icon('x')}${esc(t('clear'))}</button>`:''}
      </div>
    </div>`;
  }
  function tabs(){
    return `<div class="psaTabs" data-bl-tabs="line" role="tablist" aria-label="${esc(t('title'))}">${TABS.map(tab=>`<button type="button" id="psaTab-${tab}" role="tab" data-ps-tab="${tab}" aria-controls="psaPanel" aria-selected="${state.tab===tab}" tabindex="${state.tab===tab?'0':'-1'}">${icon(TAB_ICONS[tab])}<span>${esc(t('tab_'+tab))}</span></button>`).join('')}</div>`;
  }
  function stateBox(options){
    const view=window.BLUI?.stateView;
    if(typeof view==='function')return view(options);
    return `<div class="psaEmpty"><b>${esc(options.title||'')}</b>${options.detail?`<span>${esc(options.detail)}</span>`:''}</div>`;
  }
  function render(){
    if(!root)return;
    const head=`<div class="psaHead"><div class="psaTitle"><h2>${esc(t('title'))}</h2><p>${esc(t('subtitle'))}</p></div>
      <div class="psaHeadActions"><label class="psaField psaSource"><span>${esc(t('source'))}</span><select data-ps="source">${sourceOptions()}</select></label>
      <button type="button" class="psaGhostBtn" data-ps="export"${model&&model.totals.records>0?'':' disabled'}>${icon('file-export')}<span>${esc(t('excel'))}</span></button></div></div>`;
    let body='';
    if(loading)body=stateBox({kind:'loading',title:t('loading')});
    else if(error)body=stateBox({kind:'error',title:t('failed'),detail:error});
    else if(!model||!(model.totals.records>0))body=stateBox({kind:'empty',icon:'chart-histogram',title:t('noData'),detail:t('noDataHint')});
    else body=`${tabs()}<div class="psaPanel" id="psaPanel" role="tabpanel" aria-labelledby="psaTab-${state.tab}" tabindex="0"><p class="psaHint">${esc(t('hint_'+state.tab))}</p><div data-ps-tools>${tools()}</div><div data-ps-list>${content()}</div></div>`;
    root.innerHTML=`<div class="psa">${head}${loading||error?'':controls()}${body}</div>`;
  }
  function renderList(){const target=root?.querySelector('[data-ps-list]');if(target)target.innerHTML=content();}
  function tools(){
    const search=`<label class="psaSearch">${icon('search')}<input type="search" data-ps="search" placeholder="${esc(t('search'))}" value="${esc(ui.search)}"></label>`;
    if(state.tab==='advantage'){
      const dims=E.availableDimensions(dataset,E.GROUP_DIMENSIONS);
      return `<div class="psaTools">${segmented('groupBy',dims.map(dim=>[dim,dimLabel(dim)]),state.groupBy)}${search}</div>`;
    }
    if(state.tab==='scorecard')return `<div class="psaTools">${search}<label class="psaField psaInline"><span>${esc(t('sortBy'))}</span><select data-ps="sort">${['volume','cheap','rise','name'].map(key=>`<option value="${key}"${state.sort===key?' selected':''}>${esc(t('sort_'+key))}</option>`).join('')}</select></label></div>`;
    if(state.tab==='movement')return `<div class="psaTools">${segmented('movement',[['price',t('mode_price')],['volume',t('mode_volume')]],state.movement)}</div>`;
    if(state.tab==='relations'){
      const dims=E.availableDimensions(dataset,E.RELATION_DIMENSIONS);
      return `<div class="psaTools">${segmented('relationDim',dims.map(dim=>[dim,dimLabel(dim)]),state.relationDim)}${search}</div>`;
    }
    return '';
  }
  function segmented(key,items,value){return `<div class="psaSegmented" role="group" data-bl-choicebar>${items.map(([id,label])=>`<button type="button" data-ps-seg="${key}" data-value="${esc(id)}" aria-pressed="${id===value}">${esc(label)}</button>`).join('')}</div>`;}
  function content(){
    if(state.tab==='advantage')return advantageView();
    if(state.tab==='scorecard')return scorecardView();
    if(state.tab==='movement')return movementView();
    if(state.tab==='relations')return relationsView();
    return overviewView();
  }
  const searchMatch=name=>{const q=ui.search.trim().toLocaleUpperCase('tr-TR');return !q||String(name||'').toLocaleUpperCase('tr-TR').includes(q);};
  function moreButton(total){return total>LIST_LIMIT?`<button type="button" class="psaMore" data-ps="more">${esc(ui.showAll?t('showLess'):`${t('showAll')} (${fmtInt(total)})`)}</button>`:'';}

  /* ---------- Özet ---------- */
  function kpi(label,value,sub,iconName){return `<div class="psaKpi"><span class="psaKpiIcon">${icon(iconName)}</span><div><small>${esc(label)}</small><strong>${value}</strong><em>${sub}</em></div></div>`;}
  function overviewView(){
    const m=model,tot=m.totals,lead=m.countries[0];
    const kpis=`<div class="psaKpis">
      ${kpi(t('volume'),esc(vol(tot.volume)),m.hasComparison?`${changeText(tot.volumeChange)} ${esc(t('vsPrev'))}`:esc(m.currentSeason||t('allSeasons')),'chart-histogram')}
      ${kpi(t('avgPrice'),esc(fmtPrice(tot.price)),m.hasComparison&&tot.marketPriceChange!=null?`${changeText(tot.marketPriceChange,{invert:true})} ${esc(t('sameCategories'))}`:esc(m.currency),'coins')}
      ${kpi(t('activeSuppliers'),esc(fmtInt(tot.manufacturers)),m.hasComparison?esc(`+${tot.newManufacturers} ${t('newShort')} · −${tot.exitManufacturers} ${t('exitShort')}`):'&nbsp;','users-group')}
      ${kpi(t('countries'),esc(fmtInt(tot.countries)),lead?esc(`${t('leader')}: ${lead.name} ${fmtShare(lead.share)}`):'&nbsp;','globe')}
    </div>`;
    const list=E.insights(m,isEn()?'en':'tr');
    const assistant=list.length?`<div class="psaCard psaAssistant"><h3>${icon('robot')}${esc(t('assistant'))}</h3><ul>${list.map(item=>`<li class="tone-${esc(item.tone)}"><span class="psaDot">${icon(item.icon)}</span><p>${esc(item.text)}</p>${item.tab!=='overview'?`<button type="button" class="psaLinkBtn" data-ps-go="${esc(item.tab)}" data-ps-focus="${esc(item.focus||'')}">${esc(t('show'))} ${icon('chevron-right')}</button>`:''}</li>`).join('')}</ul></div>`:'';
    return `${kpis}${assistant}<div class="psaGrid2">${topSupplierChart()}${countryChart()}</div>`;
  }
  function topSupplierChart(){
    const rows=model.manufacturers.filter(m=>m.records>0).slice(0,8),max=Math.max(1,...rows.map(m=>Math.max(m.volume,m.previousVolume)));
    return `<div class="psaCard"><div class="psaCardHead"><h3>${esc(t('topSuppliers'))}</h3>${model.hasComparison?`<div class="psaLegend"><span class="isCur">${esc(model.currentSeason||t('current'))}</span><span class="isPrev">${esc(model.previousSeason)}</span></div>`:''}</div>
      <div class="psaBars">${rows.map(m=>`<button type="button" class="psaBarRow" data-ps-drill="m:${dk(m.key)}" title="${esc(t('drillHint'))}"><span class="psaBarName">${esc(m.name)} ${statusBadge(m.status==='new'?'new':'')}</span><span class="psaBarTrack">${model.hasComparison?`<i class="isPrev" style="width:${(m.previousVolume/max*100).toFixed(1)}%"></i>`:''}<i class="isCur" style="width:${(m.volume/max*100).toFixed(1)}%"></i></span><b>${esc(fmtInt(m.volume))}</b><small>${esc(fmtShare(m.share))}</small></button>`).join('')}</div></div>`;
  }
  function countryChart(){
    const list=model.countries.filter(c=>c.records>0),head=list.slice(0,5),rest=list.slice(5),total=model.totals.volume||1;
    const slices=[...head.map((c,index)=>({name:c.name,share:c.share,shareChange:c.shareChange,cls:`psaC${index}`,key:c.key})),...(rest.length?[{name:t('other'),share:rest.reduce((s,c)=>s+c.volume,0)/total*100,shareChange:null,cls:'psaCother',key:''}]:[])];
    const r=46,circ=2*Math.PI*r;let offset=0;
    const arcs=slices.map(slice=>{const len=Math.max(0,slice.share/100*circ);const arc=`<circle class="${slice.cls}" r="${r}" cx="60" cy="60" stroke-dasharray="${len.toFixed(2)} ${(circ-len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${esc(slice.name)} ${esc(fmtShare(slice.share))}</title></circle>`;offset+=len;return arc;}).join('');
    return `<div class="psaCard"><div class="psaCardHead"><h3>${esc(t('countryMix'))}</h3></div><div class="psaDonutWrap">
      <svg class="psaDonut" viewBox="0 0 120 120" role="img" aria-label="${esc(t('countryMix'))}"><g transform="rotate(-90 60 60)">${arcs}</g><text x="60" y="57" text-anchor="middle" class="psaDonutValue">${esc(fmtInt(list.length))}</text><text x="60" y="72" text-anchor="middle" class="psaDonutLabel">${esc(t('country').toLocaleLowerCase(locale()))}</text></svg>
      <ul class="psaLegendList">${slices.map(slice=>`<li${slice.key?` data-ps-drill="c:${dk(slice.key)}" title="${esc(t('drillHint'))}"`:''}><i class="${slice.cls}"></i><span>${esc(slice.name)}</span><b>${esc(fmtShare(slice.share))}</b>${slice.shareChange!=null?`<small class="${slice.shareChange>0?'isUp':slice.shareChange<0?'isDown':''}">${slice.shareChange>=0?'+':'−'}${esc(fmtOne(slice.shareChange))} ${esc(t('pts'))}</small>`:''}</li>`).join('')}</ul>
    </div></div>`;
  }

  /* ---------- Nerede avantajlı? ---------- */
  function strip(group){
    const points=group.suppliers.filter(s=>s.eligible);if(!points.length)return '<span class="psaStrip isEmpty"></span>';
    const prices=points.map(s=>s.price),min=Math.min(...prices,group.price||Infinity),max=Math.max(...prices,group.price||-Infinity),span=max-min;
    const at=value=>span>0?4+(value-min)/span*92:50;
    return `<span class="psaStrip" aria-hidden="true"><span class="psaStripLine"></span>${group.price!=null?`<i class="psaStripAvg" style="left:${at(group.price).toFixed(1)}%" title="${esc(t('groupAvg'))} ${esc(fmtPrice(group.price))}"></i>`:''}${points.map(s=>`<i class="psaStripDot${group.best&&group.best.key===s.key?' isBest':''}${group.priciest&&group.priciest.key===s.key?' isHigh':''}" style="left:${at(s.price).toFixed(1)}%" title="${esc(s.name)} · ${esc(fmtPrice(s.price))}"></i>`).join('')}</span>`;
  }
  function advantageView(){
    const all=model.groups.filter(g=>searchMatch(g.name)||g.suppliers.some(s=>searchMatch(s.name))),shown=ui.showAll?all:all.slice(0,LIST_LIMIT);
    if(!all.length)return `<p class="psaMuted">${esc(t('none'))}</p>`;
    return `<div class="psaGroups">${shown.map(g=>{
      const open=ui.expanded===g.key;
      return `<div class="psaGroup${open?' isOpen':''}"><button type="button" class="psaGroupRow" data-ps-expand="${esc(g.key)}" aria-expanded="${open}">
        <span class="psaGroupName"><b>${esc(nameOf(g.name))}</b><small>${esc(vol(g.volume))} · ${esc(fmtPrice(g.price))}</small></span>
        <span class="psaGroupBest">${g.best?`<small>${esc(t('best'))}</small><b>${esc(g.best.name)}</b> <span class="psaPill isGood">${esc(fmtSigned(g.best.index))}</span>`:`<small class="psaMuted">${esc(t('notComparable'))}</small>`}</span>
        <span class="psaGroupLead">${g.leader?`<small>${esc(t('mostUsed'))}</small><b>${esc(nameOf(g.leader.name))}</b> <span class="psaMuted">${esc(fmtShare(g.leader.share))}</span>`:''}</span>
        ${strip(g)}<span class="psaChevron">${icon(open?'chevron-up':'chevron-down')}</span></button>
        ${open?groupDetail(g):''}</div>`;
    }).join('')}</div>${moreButton(all.length)}`;
  }
  function groupDetail(g){
    const rows=g.suppliers.slice().sort((a,b)=>(a.eligible===b.eligible?0:a.eligible?-1:1)||(a.price??Infinity)-(b.price??Infinity));
    const maxIndex=Math.max(5,...rows.map(s=>Math.abs(s.index||0)));
    return `<div class="psaGroupDetail"><div class="psaRank">${rows.map((s,index)=>`<button type="button" class="psaRankRow" data-ps-drill="g:${dk(g.key)}:${dk(s.key)}" title="${esc(t('drillHint'))}">
      <span class="psaRankNo">${index+1}</span><span class="psaRankName">${esc(nameOf(s.name))}${s.eligible?'':` <em class="psaMuted">${esc(t('lowSample'))}</em>`}</span>
      <span class="psaRankPrice">${esc(fmtPrice(s.price))}</span>
      ${diverging(s.eligible?s.index:null,maxIndex,true)}
      <span class="psaRankShare"><span class="psaMiniTrack"><i style="width:${Math.min(100,s.share).toFixed(1)}%"></i></span>${esc(fmtShare(s.share))}</span>
      <span class="psaMuted">${esc(fmtInt(s.models))} ${esc(t('models'))}</span></button>`).join('')}</div></div>`;
  }
  /* Ortada sıfır çizgisi olan yatay çubuk. invert=true: negatif (ucuz) iyi. */
  function diverging(value,max,invert){
    if(value==null||!Number.isFinite(value))return '<span class="psaDiverge"><span class="psaDivergeTrack"></span><b class="psaMuted">—</b></span>';
    const width=Math.min(50,Math.abs(value)/max*50),good=invert?value<0:value>0;
    return `<span class="psaDiverge"><span class="psaDivergeTrack"><i class="${good?'isGood':'isBad'}" style="${value<0?`right:50%`:`left:50%`};width:${width.toFixed(1)}%"></i></span><b class="${Math.abs(value)<3?'':good?'isGood':'isBad'}">${esc(fmtSigned(value))}</b></span>`;
  }

  /* ---------- Üretici karnesi ---------- */
  function sortedSuppliers(){
    const list=model.manufacturers.filter(m=>(m.records>0||m.status==='exit')&&searchMatch(m.name));
    if(state.sort==='cheap')return list.sort((a,b)=>(a.priceLevel??Infinity)-(b.priceLevel??Infinity));
    if(state.sort==='rise')return list.sort((a,b)=>(b.priceChange??-Infinity)-(a.priceChange??-Infinity));
    if(state.sort==='name')return list.sort((a,b)=>a.name.localeCompare(b.name,locale()));
    return list;
  }
  function scorecardView(){
    const all=sortedSuppliers();if(!all.length)return `<p class="psaMuted">${esc(t('none'))}</p>`;
    if(!all.some(m=>m.key===ui.selected))ui.selected=all[0].key;
    const shown=ui.showAll?all:all.slice(0,LIST_LIMIT),max=Math.max(1,...all.map(m=>m.volume));
    const table=`<div class="psaCard psaTableCard"><table class="psaTable"><thead><tr><th>${esc(t('manufacturer'))}</th><th class="num">${esc(t('volume'))}</th><th>${esc(t('priceLevel'))}</th>${model.hasComparison?`<th class="num">${esc(t('priceChange'))}</th>`:''}<th>${esc(t('strongIn'))}</th></tr></thead><tbody>${shown.map(m=>`<tr data-ps-select="${esc(m.key)}" class="${m.key===ui.selected?'isSelected':''}" tabindex="0">
      <td><b>${esc(m.name)}</b> ${statusBadge(m.status)}</td>
      <td class="num"><span class="psaCellBar"><span class="psaMiniTrack"><i style="width:${(m.volume/max*100).toFixed(1)}%"></i></span>${esc(fmtInt(m.volume))}</span><small class="psaMuted">${esc(fmtShare(m.share))}</small></td>
      <td>${levelPill(m.priceLevel)}</td>${model.hasComparison?`<td class="num">${changeText(m.priceChangeCoverage>=30?m.priceChange:null,{invert:true})}</td>`:''}
      <td>${m.strengths[0]?esc(m.strengths[0].name):'<span class="psaMuted">—</span>'}</td></tr>`).join('')}</tbody></table>${moreButton(all.length)}</div>`;
    return `<div class="psaSplit">${table}${supplierDetail(model.manufacturers.find(m=>m.key===ui.selected))}</div>`;
  }
  function supplierDetail(m){
    if(!m)return '';
    const groups=m.groups.filter(g=>g.records>0).slice(0,8),maxIndex=Math.max(5,...groups.map(g=>Math.abs(g.index||0)));
    const chips=list=>list.length?`<div class="psaChips">${list.slice(0,6).map(item=>`<span><b>${esc(nameOf(item.name))}</b> ${esc(fmtShare(item.share))}</span>`).join('')}</div>`:`<p class="psaMuted">${esc(t('none'))}</p>`;
    return `<div class="psaCard psaDetail"><div class="psaDetailHead"><div><h3>${esc(m.name)}</h3>${statusBadge(m.status)}</div><button type="button" class="psaGhostBtn" data-ps-drill="m:${dk(m.key)}">${icon('table')}${esc(t('openOrders'))}</button></div>
      <div class="psaMiniKpis">
        <div><small>${esc(t('volume'))}</small><b>${esc(fmtInt(m.volume))}</b>${model.hasComparison?changeText(m.volumeChange):''}</div>
        <div><small>${esc(t('avgPrice'))}</small><b>${esc(fmtPrice(m.price))}</b></div>
        <div><small>${esc(t('priceLevel'))}</small>${levelPill(m.priceLevel)}</div>
        ${model.hasComparison?`<div><small>${esc(t('priceChange'))}</small><b>${changeText(m.priceChangeCoverage>=30?m.priceChange:null,{invert:true})}</b></div>`:''}
      </div>
      <h4>${esc(t('byCategory'))}</h4>
      ${groups.length?`<div class="psaRank isCompact">${groups.map(g=>`<button type="button" class="psaRankRow" data-ps-drill="mg:${dk(m.key)}:${dk(g.key)}" title="${esc(t('drillHint'))}"><span class="psaRankName">${esc(nameOf(g.name))}</span><span class="psaRankPrice">${esc(fmtPrice(g.price))}</span>${diverging(g.index,maxIndex,true)}<span class="psaMuted">${esc(fmtShare(g.groupShare))}</span></button>`).join('')}</div>`:`<p class="psaMuted">${esc(t('noStrength'))}</p>`}
      <h4>${esc(t('workWith'))}</h4>${chips(m.buyingGroups)}
      <h4>${esc(t('madeIn'))}</h4>${chips(m.countries)}
    </div>`;
  }

  /* ---------- Fiyat hareketi ---------- */
  function moverColumn(title,rows,value,max,tone,formatter){
    return `<div class="psaCard"><div class="psaCardHead"><h3>${esc(title)}</h3></div>${rows.length?`<div class="psaMovers">${rows.map(m=>`<button type="button" class="psaMover${ui.selected===m.key?' isFocus':''}" data-ps-drill="m:${dk(m.key)}" title="${esc(t('drillHint'))}"><span class="psaMoverName">${esc(m.name)}</span><span class="psaMoverTrack"><i class="${tone}" style="width:${Math.min(100,Math.abs(value(m))/max*100).toFixed(1)}%"></i></span><b class="${tone}">${formatter(m)}</b></button>`).join('')}</div>`:`<p class="psaMuted">${esc(t('none'))}</p>`}</div>`;
  }
  function movementView(){
    if(!model.hasComparison)return stateBox({kind:'info',title:t('needCompare')});
    let charts='';
    if(state.movement==='volume'){
      const movers=E.volumeMovers(model),max=Math.max(1,...[...movers.up,...movers.down].map(m=>Math.abs(m.volumeDelta)));
      const fmt=m=>`${m.volumeDelta>0?'+':'−'}${esc(fmtInt(Math.abs(m.volumeDelta)))}`;
      charts=`<div class="psaGrid2">${moverColumn(t('growing'),movers.up,m=>m.volumeDelta,max,'isGood',fmt)}${moverColumn(t('shrinking'),movers.down,m=>m.volumeDelta,max,'isWarn',fmt)}</div>`;
    }else{
      const movers=E.priceMovers(model),max=Math.max(5,...[...movers.up,...movers.down].map(m=>Math.abs(m.priceChange)));
      const market=model.totals.marketPriceChange;
      charts=`${market!=null?`<div class="psaMarket">${icon('chart-histogram')}<span>${esc(t('market'))} (${esc(t('sameCategories'))}):</span>${changeText(market,{invert:true})}</div>`:''}
        ${movers.count?`<div class="psaGrid2">${moverColumn(t('rising'),movers.up,m=>m.priceChange,max,'isBad',m=>esc(fmtSigned(m.priceChange)))}${moverColumn(t('falling'),movers.down,m=>m.priceChange,max,'isGood',m=>esc(fmtSigned(m.priceChange)))}</div>`:`<p class="psaMuted">${esc(t('notEnough'))}</p>`}`;
    }
    const fresh=E.newcomers(model),gone=E.leavers(model);
    const freshList=fresh.length?`<ul class="psaPeople">${fresh.slice(0,12).map(m=>`<li data-ps-drill="m:${dk(m.key)}" title="${esc(t('drillHint'))}"><b>${esc(m.name)}</b><span class="psaMuted">${esc(vol(m.volume))}${m.groups[0]?` · ${esc(nameOf(m.groups[0].name))}`:''}</span>${levelPill(m.priceLevel)}</li>`).join('')}</ul>`:`<p class="psaMuted">${esc(t('none'))}</p>`;
    const goneList=gone.length?`<ul class="psaPeople">${gone.slice(0,12).map(m=>`<li data-ps-drill="p:${dk(m.key)}" title="${esc(t('drillHint'))}"><b>${esc(m.name)}</b><span class="psaMuted">${esc(t('prevVolume'))}: ${esc(vol(m.previousVolume))}</span></li>`).join('')}</ul>`:`<p class="psaMuted">${esc(t('none'))}</p>`;
    return `${charts}<div class="psaGrid2"><div class="psaCard"><div class="psaCardHead"><h3>${icon('star')}${esc(t('newcomers'))} <span class="psaCount">${fresh.length}</span></h3></div>${freshList}</div><div class="psaCard"><div class="psaCardHead"><h3>${esc(t('leavers'))} <span class="psaCount">${gone.length}</span></h3></div>${goneList}</div></div>`;
  }

  /* ---------- Kim kiminle? ---------- */
  let relationRows=[];
  function relationsView(){
    relationRows=E.relations(model,state.relationDim).filter(row=>searchMatch(row.name)||row.segments.some(s=>searchMatch(s.name)));
    if(!relationRows.length)return `<p class="psaMuted">${esc(t('none'))}</p>`;
    const shown=ui.showAll?relationRows:relationRows.slice(0,LIST_LIMIT);
    return `<div class="psaCard"><div class="psaRelations">${shown.map((row,index)=>`<div class="psaRelation">
      <span class="psaRelationName"><b>${esc(row.name)}</b><small>${esc(vol(row.volume))} · ${esc(fmtInt(row.supplierCount))} ${esc(t('suppliers'))}</small></span>
      <span class="psaStack">${row.segments.map((s,i)=>`<button type="button" class="psaSeg${i}" style="width:${s.share.toFixed(2)}%" data-ps-drill="r:${index}:${i}" title="${esc(nameOf(s.name))} · ${esc(fmtShare(s.share))}"></button>`).join('')}${row.other?`<button type="button" class="psaSegOther" style="width:${row.other.share.toFixed(2)}%" data-ps-drill="r:${index}:o" title="${esc(t('other'))} (${row.other.count}) · ${esc(fmtShare(row.other.share))}"></button>`:''}</span>
      <span class="psaRelationTop">${row.segments.map((s,i)=>`<span><i class="psaSeg${i}"></i>${esc(nameOf(s.name))} <b>${esc(fmtShare(s.share))}</b></span>`).join('')}</span>
    </div>`).join('')}</div>${moreButton(relationRows.length)}</div>`;
  }

  /* ---------- drilldown ---------- */
  function openDrill(spec){
    const [kind,a,b]=spec.split(':').map(part=>decodeURIComponent(part)),find=key=>model.manufacturers.find(m=>m.key===key);
    if(kind==='m'){const m=find(a);if(m)drill(m.items,`${t('manufacturer')}: ${m.name}`);return;}
    if(kind==='p'){const m=find(a);if(m)drill(m.previousItems,`${t('manufacturer')}: ${m.name} · ${model.previousSeason}`);return;}
    if(kind==='c'){const c=model.countries.find(item=>item.key===a);if(c)drill(c.items,`${t('country')}: ${c.name}`);return;}
    if(kind==='g'){const g=model.groups.find(item=>item.key===a),s=g&&g.suppliers.find(item=>item.key===b);if(s)drill(s.items,`${nameOf(g.name)} · ${nameOf(s.name)}`);return;}
    if(kind==='mg'){const m=find(a),g=m&&m.groups.find(item=>item.key===b);if(g)drill(g.items,`${m.name} · ${nameOf(g.name)}`);return;}
    if(kind==='r'){const row=(ui.showAll?relationRows:relationRows.slice(0,LIST_LIMIT))[Number(a)];if(!row)return;const seg=b==='o'?row.other:row.segments[Number(b)];if(seg)drill(seg.items,`${row.name} · ${b==='o'?t('other'):nameOf(seg.name)}`);}
  }

  /* ---------- Excel ---------- */
  async function exportExcel(){
    if(!model)return;
    try{
      if(!window.XLSX&&window.BLPerf?.ensureLibrary)await window.BLPerf.ensureLibrary('xlsx');
      const X=window.XLSX;if(!X)throw new Error('XLSX');
      const book=X.utils.book_new(),r=value=>E.round(value,2);
      const summary=[{[t('summary')]:t('source'),[t('value')]:t('src_'+state.source)},{[t('summary')]:t('season'),[t('value')]:model.currentSeason||t('allSeasons')},{[t('summary')]:t('compare'),[t('value')]:model.previousSeason||t('noCompare')},
        ...E.FILTER_DIMENSIONS.filter(dim=>state.filters[dim]).map(dim=>({[t('summary')]:dimLabel(dim),[t('value')]:state.filters[dim]})),
        {[t('summary')]:t('volume'),[t('value')]:model.totals.volume},{[t('summary')]:`${t('avgPrice')} (${model.currency})`,[t('value')]:r(model.totals.price)},{[t('summary')]:t('activeSuppliers'),[t('value')]:model.totals.manufacturers},
        ...E.insights(model,isEn()?'en':'tr').map(item=>({[t('summary')]:t('assistant'),[t('value')]:item.text}))];
      X.utils.book_append_sheet(book,X.utils.json_to_sheet(summary),t('summary').slice(0,31));
      const suppliers=model.manufacturers.map(m=>({[t('manufacturer')]:m.name,[t('status')]:t('status_'+m.status),[t('volume')]:m.volume,[t('prevVolume')]:m.previousVolume,[t('share')]:r(m.share),[`${t('avgPrice')} (${model.currency})`]:r(m.price),[`${t('priceLevel')} %`]:r(m.priceLevel),[`${t('priceChange')} %`]:m.priceChangeCoverage>=30?r(m.priceChange):null,[t('strongIn')]:m.strengths.map(s=>s.name).join(', ')}));
      X.utils.book_append_sheet(book,X.utils.json_to_sheet(suppliers),t('sheetSuppliers').slice(0,31));
      const groups=model.groups.map(g=>({[dimLabel(model.groupBy)]:nameOf(g.name),[t('volume')]:g.volume,[`${t('groupAvg')} (${model.currency})`]:r(g.price),[t('best')]:g.best?.name||'',[`${t('best')} %`]:g.best?r(g.best.index):null,[t('mostUsed')]:g.leader?nameOf(g.leader.name):'',[`${t('mostUsed')} ${t('share')}`]:g.leader?r(g.leader.share):null}));
      X.utils.book_append_sheet(book,X.utils.json_to_sheet(groups),t('sheetAdvantage').slice(0,31));
      const relations=E.relations(model,state.relationDim).map(row=>({[dimLabel(state.relationDim)]:row.name,[t('volume')]:row.volume,...Object.fromEntries(row.segments.flatMap((s,i)=>[[`${i+1}. ${t('manufacturer')}`,nameOf(s.name)],[`${i+1}. ${t('share')}`,r(s.share)]]))}));
      X.utils.book_append_sheet(book,X.utils.json_to_sheet(relations),t('sheetRelations').slice(0,31));
      X.writeFile(book,`Price_Supplier_Analysis_${new Date().toISOString().slice(0,10).replaceAll('-','')}.xlsx`);
    }catch(_){window.showToast?.(t('excelFail'));}
  }

  /* ---------- olaylar (kök üzerinde tek sefer) ---------- */
  function bind(){
    root.addEventListener('change',event=>{
      const target=event.target,key=target.dataset.ps;
      if(target.dataset.psFilter){state.filters[target.dataset.psFilter]=target.value;ui.showAll=false;recalc();return;}
      if(key==='source'){state.source=target.value;state.priceType='';state.currency='';state.currentSeason='';state.previousSeason='';persist();prepare();return;}
      if(key==='priceType'){state.priceType=target.value;persist();prepare();return;}
      if(key==='currentSeason'){state.currentSeason=target.value;state.previousSeason=target.value!==ALL_SEASONS?E.previousSeason(target.value,seasonList):'';recalc();return;}
      if(key==='previousSeason'){state.previousSeason=target.value;recalc();return;}
      if(key==='currency'){state.currency=target.value;recalc();return;}
      if(key==='sort'){state.sort=target.value;persist();renderList();}
    });
    root.addEventListener('input',event=>{if(event.target.dataset.ps==='search'){ui.search=event.target.value;renderList();}});
    root.addEventListener('click',event=>{
      const el=event.target.closest('button,[data-ps-drill],[data-ps-select]');if(!el||!root.contains(el))return;
      if(el.dataset.psTab){state.tab=el.dataset.psTab;ui.search='';ui.showAll=false;persist();render();return;}
      if(el.dataset.psGo){state.tab=el.dataset.psGo;ui.search='';ui.showAll=false;const focus=el.dataset.psFocus||'';if(state.tab==='advantage')ui.expanded=focus||null;else if(focus)ui.selected=focus;persist();render();return;}
      if(el.dataset.psSeg){state[el.dataset.psSeg]=el.dataset.value;ui.showAll=false;ui.expanded=null;if(el.dataset.psSeg==='groupBy')recalc();else{persist();render();}return;}
      if(el.dataset.psExpand!=null){ui.expanded=ui.expanded===el.dataset.psExpand?null:el.dataset.psExpand;renderList();return;}
      if(el.dataset.psSelect!=null&&!event.target.closest('[data-ps-drill]')){ui.selected=el.dataset.psSelect;renderList();return;}
      if(el.dataset.psDrill){openDrill(el.dataset.psDrill);return;}
      const key=el.dataset.ps;
      if(key==='more'){ui.showAll=!ui.showAll;renderList();return;}
      if(key==='clear'){E.FILTER_DIMENSIONS.forEach(dim=>{state.filters[dim]='';});recalc();return;}
      if(key==='export')exportExcel();
    });
    root.addEventListener('keydown',event=>{const row=event.target.closest?.('[data-ps-select]');if(row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();ui.selected=row.dataset.psSelect;renderList();}});
  }

  async function init(){
    root=document.getElementById('priceSupplierAnalysis');if(!root)return;
    if(root.dataset.initialized){render();return;}
    root.dataset.initialized='1';bind();render();await prepare();
  }
  window.initPriceSupplierAnalysis=init;
  window.renderPriceSupplierAnalysisLanguage=render;
  window.BLPriceSupplierAnalysis={state,prepare,run:recalc,get model(){return model;},_i18n:TEXT,_translate:t};
})();
