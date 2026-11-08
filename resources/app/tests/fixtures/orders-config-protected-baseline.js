function applyViewState(data){
  if(!data) return;
  const page = activeProfilePage();
  if(data.__page && data.__page!==page) return;
  const legacyData=data;
  data=window.BLViewContext?.unpack(data,{page,columns:viewContextColumns(page,data),canonical:viewContextCanonical,filterIds:FILTER_INPUTS[page]?.selects||[]})||(!legacyData.__viewVersion?legacyData:null);
  if(!data)return;
  if(data[page]?.density!=null)window.BLTableDensity?.set(page,data[page].density);
  if(data.__filters)applyFilterState(data.__filters);
  restoreViewContext(page,data.__context);
  if(!state.freeze) state.freeze={};
  if(page==='koleksiyon' && data.koleksiyon){
    const v=data.koleksiyon;
    kolCustomCols=kolNormalizeCustomCols(v.custom);
    kolColOrder=Array.isArray(v.order)?v.order.filter(k=>kolColDefs().some(c=>c.k===k)):null;
    kolHiddenCols=new Set((v.hidden||[]).filter(k=>kolIsSyntheticColKey(k)||kolColDefs().some(c=>c.k===k)));
    kolPictureHidden=!!v.pictureHidden;
    if(v.imgSize) kolImgSize=kolNormalizeImgSize(v.imgSize);
    kolColWidths={...(v.widthPx||{})};
    kolSort={key:kolColDefs().some(c=>c.k===v.sorting?.key)?v.sorting.key:null,dir:Number(v.sorting?.dir)===-1?-1:1};
    if(v.freeze&&typeof v.freeze==='object')state.freeze.koleksiyon={left:Number(v.freeze.left)||0,right:Number(v.freeze.right)||0,...(Number(v.freeze.pane)>0?{pane:Math.round(Number(v.freeze.pane))}:{})};
    else delete state.freeze.koleksiyon;
    saveKolColState();
    renderKol();
    if(typeof fitTableHeights==='function') setTimeout(fitTableHeights,0);
    return;
  }
  const pages = data.__page ? [page] : VIEW_TABLES;
  pages.forEach(t=>{
    if(t==='koleksiyon' || !data[t] || !colmgr[t]) return;
    const validKeys = (COLS_BY_TABLE[t]||[]).map(c=>c.k);
    const savedOrder = Array.isArray(data[t].order) ? data[t].order.filter(k=>validKeys.includes(k)) : [];
    // Yeni sürümde eklenen sütunlar eski kayıtlı görünümde bulunmaz. Kullanıcının
    // mevcut özel sırasını korurken eksik sütunları varsayılan komşularının yanına ekle.
    const mergedOrder = savedOrder.length ? savedOrder.slice() : validKeys.slice();
    validKeys.forEach((key, defaultIndex)=>{
      if(mergedOrder.includes(key)) return;
      let insertAt = mergedOrder.length;
      for(let i=defaultIndex-1;i>=0;i--){
        const prevIndex = mergedOrder.indexOf(validKeys[i]);
        if(prevIndex>=0){ insertAt=prevIndex+1; break; }
      }
      if(insertAt===mergedOrder.length){
        for(let i=defaultIndex+1;i<validKeys.length;i++){
          const nextIndex = mergedOrder.indexOf(validKeys[i]);
          if(nextIndex>=0){ insertAt=nextIndex; break; }
        }
      }
      mergedOrder.splice(insertAt,0,key);
    });
    colmgr[t].order = mergedOrder;
    colmgr[t].hidden = new Set((data[t].hidden||[]).filter(k=>validKeys.includes(k)));
    colmgr[t].widthPx = {...(data[t].widthPx||{})};
    const sort=data[t].sorting;
    if((t==='cp'||t==='orders')&&sort&&(!sort.key||validKeys.includes(sort.key))){
      state[t+'Sort']={key:sort.key||null,dir:Number(sort.dir)===-1?-1:1};
    }else if(t==='cp'||t==='orders')state[t+'Sort']={key:null,dir:1};
    if(data[t].freeze&&typeof data[t].freeze==='object')state.freeze[t]={left:Number(data[t].freeze.left)||0,right:Number(data[t].freeze.right)||0,...(Number(data[t].freeze.pane)>0?{pane:Math.round(Number(data[t].freeze.pane))}:{})};
    else delete state.freeze[t];
  });
  saveAutoTableColumnState();
  if(page==='cp' && state.cp) renderCP();
  if(page==='orders' && state.orders) renderOrders();
  if(page==='ship' && typeof renderShipTable==='function') renderShipTable();
  if(typeof fitTableHeights==='function') setTimeout(fitTableHeights,0);
}

function applyFilterState(data){
  if(!data) return;
  const page=activeProfilePage();
  if(data.__page && data.__page!==page) return;
  if(page==='koleksiyon' && data.koleksiyon){
    const f=data.koleksiyon;
    const search=document.getElementById('kolSearch'); if(search) search.value=f.search||'';
    kolColFilters={};
    Object.entries(f.colFilters||{}).forEach(([k,vals])=>{
      if(kolColDefs().some(c=>c.k===k) && Array.isArray(vals) && vals.length) kolColFilters[k]=kolCanonicalFilterSelection(k,vals);
    });
    kolCheckFilter=normalizeCheckFilterMode(f.checkFilter);
    saveKolColState();
    renderKol();
    return;
  }
  const pages=data.__page?[page]:VIEW_TABLES;
  pages.forEach(t=>{
    if(t==='koleksiyon' || !data[t]) return;
    const cfg=FILTER_INPUTS[t];
    if(!cfg) return;
    const searchEl=cfg.search?document.getElementById(cfg.search):null; if(searchEl) searchEl.value=data[t].search||'';
    Object.entries(data[t].selects||{}).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val||'';});
    state.colFilters[t]=deserializeColFilters(data[t].colFilters);
    state.checkFilter[t]=normalizeCheckFilterMode(data[t].checkFilter);
    const dimensionFilters=data[t].dimensionFilters&&typeof data[t].dimensionFilters==='object'?data[t].dimensionFilters:{};
    if(t==='cp'){
      cpDimFilters={};
      Object.entries(dimensionFilters).forEach(([key,values])=>{if(CP_DIM_META[key]&&Array.isArray(values)&&values.length)cpDimFilters[key]=new Set(values.map(String));});
      updateCpDimBtnLabels();
    }
    if(t==='orders'){
      ordersDimFilters={};
      Object.entries(dimensionFilters).forEach(([key,values])=>{if(ORDERS_DIM_META[key]&&Array.isArray(values)&&values.length)ordersDimFilters[key]=new Set(values.map(String));});
      updateOrdersDimBtnLabels();
    }
    if(t==='cp')state.cpQuickExf=data[t].quickExf||'';
    if(t==='orders'){state.ordersQuickExf=data[t].quickExf||'';state.ordersQuickActive=new Set(data[t].quickActive||[]);}
  });
  if(page==='cp'&&state.cp)renderCP();
  if(page==='orders'&&state.orders)renderOrders();
  if(page==='ship'&&typeof renderShipTable==='function')renderShipTable();
}

function resetViewToSystemDefault(){
  const page=activeProfilePage();
  if(!isProfilePage(page))return;
  ++viewContextGeneration;
  window.BLTableDensity?.set(page,'default');
  if(!state.freeze)state.freeze={};
  delete state.freeze[page];
  if(page==='koleksiyon'){
    kolColOrder=null;kolColWidths={};kolHiddenCols=new Set();kolPictureHidden=false;
    kolSort={key:null,dir:1};
    saveKolColState();
  }else if(colmgr[page]){
    forgetPersistedTableColumnState(page);
    colmgr[page]=initColState(COLS_BY_TABLE[page]||[]);
    if(page==='cp'||page==='orders')colmgr[page].widthPx.__picture=tableImageSizeDimensions(page,tableImageSizeCurrentValue(page)).col;
    saveAutoTableColumnState();
  }
  if(page==='cp')state.cpSort={key:null,dir:1};
  if(page==='orders')state.ordersSort={key:null,dir:1};
  saveFreezeState();clearProfileSelection('view');
  if(page==='cp'&&state.cp)renderCP();
  else if(page==='orders'&&state.orders)renderOrders();
  else if(page==='koleksiyon'&&typeof renderKol==='function')renderKol();
  else if(page==='ship'&&typeof renderShipTable==='function')renderShipTable();
  syncFreezeButtonState();
  showToast(appLang==='en'?'System default view restored.':'Sistem varsayılan görünümü geri yüklendi.');
}

function resetFiltersToSystemDefault(){
  const page=activeProfilePage(),info=activeTableInfo();
  if(!info)return;
  info.filterIds.forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  if(page==='koleksiyon'){
    kolColFilters={};kolCheckFilter='';saveKolColState();
  }else{
    state.colFilters[page]={};state.checkFilter[page]='';
    if(page==='cp'){cpDimFilters={};state.cpQuickExf='';saveCpDimFilters();updateCpDimBtnLabels();}
    if(page==='orders'){ordersDimFilters={};state.ordersQuickExf='';state.ordersQuickActive.clear();saveOrdersDimFilters();updateOrdersDimBtnLabels();}
  }
  clearProfileSelection('filter');info.rerender();saveCoreAutoFilterState();
  showToast(appLang==='en'?'System default filters restored.':'Sistem varsayılan filtreleri geri yüklendi.');
}

async function ensureCpLoaded(options={}){
  if(state.cp&&!options.force){overviewCpLoadState='ready';overviewCpLoadError='';return true;}
  if(cpLoadPromise)return cpLoadPromise;
  window.BLModulePreparation?.setStatus('cp','loading');
  if(currentActiveTab()==='cp')renderCorePageLoadingState('cp');
  if(options.reason==='overview'){overviewCpLoadState='loading';overviewCpLoadError='';}
  cpLoadPromise=(async()=>{
    try{
      const result=await fetchProjectionWithFallback('cp','/api/data/cp');if(result.cancelled){window.BLModulePreparation?.setStatus('cp','pending');return false;}
      const data=result.payload||{},rows=Array.isArray(data.rows)?data.rows:[];
      reviveServerDates(rows);
      // Görünür CP satırları çizilmeden güncel yerel görsel registry'sini ve (hazır
      // önbellekten geldiyse) paylaşılan alan yetkisini paralel eşle.
      const [registry]=await Promise.allSettled([refreshCpStartupImageRegistry(rows),applyCpSharedEditAccess(rows)]);
      if(registry.status==='rejected'){console.warn('CP model image registry:',registry.reason);showToast(appLang==='en'?'Some saved model images could not be restored. Try reloading CP.':'Bazı kayıtlı model görselleri yüklenemedi. CP ekranını yeniden açmayı deneyin.');}
      state.cp={fname:'Hazır ekran önbelleği',rows};state.cpLogisticExpanded.clear();
      applyPricingRulesToLoadedRows({render:false});
      overviewCpLoadState='ready';overviewCpLoadError='';
      invalidateUnifiedPriorityDecisions('cp-projection-loaded',['cp']);
      syncCpModelColumns(Array.isArray(data.cpModelColumns)?data.cpModelColumns:[]);
      buildCPFilters();applyCoreAutoFilterState();refreshSubmfrList();refreshLicenseList();refreshLicensorList();if(!options.deferRender)renderCP();
      window.BLPerf?.mark?.('CP_LOAD_READY',{reason:options.reason||'cp',rows:rows.length,revision:_unifiedPriorityDataRevision});
      // CP hangi sekme tarafından yüklenmiş olursa olsun Overview artık dirty'dir.
      // Görünürse aynı frame'de bir kez, görünmüyorsa ilk girişte çizilir.
      scheduleOverviewRender('cp-ready');
      return true;
    }catch(err){
      const message=(appLang==='en'?'CP could not be loaded: ':'CP yüklenemedi: ')+(err&&err.message||err);
      window.BLModulePreparation?.setStatus('cp','error','CP_LOAD_FAILED');
      if(options.reason==='overview'||currentActiveTab()==='overview'){
        overviewCpLoadState='error';overviewCpLoadError=message;scheduleOverviewRender('cp-load-error');
      }
      showToast(message);return false;
    }finally{cpLoadPromise=null;}
  })();
  return cpLoadPromise;
}

function registerManagedGridClipboard(tableId,tableKey){
  if(!window.BLGridClipboard)return;
  const meta=TABLE_META[tableId];
  window.BLGridClipboard.register(tableId,{
    label:()=>appLang==='en'
      ?(tableKey==='orders'?'Orders data grid':'CP Tracker data grid')
      :(tableKey==='orders'?'Siparişler veri tablosu':'CP Tracker veri tablosu'),
    // Alt detay raporu çekmecesi açıkken Ctrl+C arkadaki CP/Orders seçimini değil
    // çekmecedeki seçimi kopyalar.
    isActive:()=>String(document.body.dataset.activeTab||'')===tableKey&&!blOverlayOpen()&&!window.BLDetailDrawer?.isOpen?.(),
    rows:table=>table?._blRenderedRows||meta.rowsFn(),
    columns:table=>table?._blRenderedColumns||visibleCols(meta.tableKey),
    rowId:row=>row?._id,
    columnId:column=>column?.k,
    header:column=>tableColumnLabel(meta.tableKey,column),
    value:(row,column)=>meta.cellText
      ? meta.cellText(column,row)
      : cellPlainText(column,row,meta.computeFn?meta.computeFn(row):null),
    exporter:BLTableExport,
    selectionChanged:size=>updateGridSelectionStatus(tableKey,size),
    // Çoklu yapıştırma yalnız CP'de; Orders salt kopyalama kalır.
    pasteTarget:tableKey==='cp'?cpPasteTarget:undefined,
    pasteValue:tableKey==='cp'?cpPasteValue:undefined,
    applyPaste:tableKey==='cp'?applyCpGridPaste:undefined,
    copy:async (matrix,range,selectionState,options={})=>{
      const payload=window.BLGridClipboard.serialize(matrix,BLTableExport,options),plain=payload.plain,html=payload.html;
      const ok=await copyRichToClipboard(html,plain);
      window.BLGridClipboard.diagnostics.record({module:tableKey,operation:'copy',selection:window.BLGridClipboard.selectionSize(range),includeHeaders:payload.includeHeaders,transport:'rich',ok});
      window.BLTableToolbarActionCleanup?.finish?.('navCopy',ok);
      if(!ok)showToast(appLang==='en'?'Copy failed.':'Kopyalama başarısız.',{kind:'error'});
      else{const size=window.BLGridClipboard.selectionSize(range);showToast(appLang==='en'?`${size.label} cells copied${payload.includeHeaders?' with headers':''}.`:`${size.label} hücre${payload.includeHeaders?' başlıklarıyla':''} kopyalandı.`);}
      return ok;
    },
  });
}

window.BLFormulaRows = {
  cp: () => (state.cp && Array.isArray(state.cp.rows) ? state.cp.rows : []),
  orders: () => (state.orders && Array.isArray(state.orders.rows) ? state.orders.rows : []),
  ship: () => (Array.isArray(shipRows) ? shipRows : []),
};

window.BLAIScreenData = {
  lastTab: () => window.BL_LCWAI_LAST_TAB || 'overview',
  /* LCW AI bağlamı. { all:true } → sayfa filtrelerinden BAĞIMSIZ tüm kayıtlar
     ve tüm sütunlar (kullanıcının yetki kapsamı veri yüklenirken zaten
     uygulanmıştır). Varsayılan (all yok) → ekranda görünen filtreli kayıtlar. */
  table(tab, opts = {}) {
    let info = null;
    try { info = tableInfoForTab(tab); } catch (_) { info = null; }
    if (!info) return null;
    const all = Boolean(opts && opts.all);
    const allRows = {
      cp: () => (state.cp ? state.cp.rows : []),
      orders: () => (state.orders ? state.orders.rows : []),
      koleksiyon: () => kolRows,
    }[tab];
    let rows = [];
    try { rows = opts.columnsOnly ? [] : ((all && allRows ? allRows() : info.rowsFn()) || []); } catch (_) { return null; }
    if (!Array.isArray(rows) || (!rows.length && !opts.columnsOnly)) return null;
    let cols = [];
    try {
      if (info.tableKey === 'cp' || info.tableKey === 'orders') {
        cols = visibleCols(info.tableKey);
        // Tüm veri: gizli sütunlar da dahil (görünür + tanımlı tüm sütunlar).
        if (all) { const seen = new Set(cols.map(col => col && col.k)); cols = cols.concat((info.cols() || []).filter(col => col && !seen.has(col.k))); }
      } else if (info.tableKey === 'koleksiyon') cols = kolDisplayDescriptors({ all, detail: true }); // LCW AI ayrıntılı sütunları okur (Kompakt özet değil)
      else cols = info.cols() || [];
    } catch (err) {
      // Rows without columns would give LCW AI image keys but no data, so a
      // column-build failure must fail closed and stay diagnosable.
      console.error(`[LCW AI] ${tab} column context could not be built`, err);
      return null;
    }
    // Resolve Collection inheritance once per build. The projected rows are
    // private read-only copies; existing formatters can read their effective
    // fields without rescanning the entire collection for each cell.
    const collectionRows = new WeakMap();
    const collectionValue = info.tableKey === 'koleksiyon' ?
      (window.BLCollectionModelGroups?.createValueReader?.(kolRows) || kolEffectiveValue) : null;
    const collectionKeys = collectionValue ? new Set([
      ...kolColDefs().map(col => col.k), ...KOL_LANDED_EFFECTIVE_KEYS,
      'endeksmatikData', 'pricing', 'confirmedManufacturer',
    ]) : null;
    const collectionRow = row => {
      if (!collectionRows.has(row)) {
        const copy = { ...row, variantOverrides: { ...row.variantOverrides } };
        for (const key of collectionKeys) {
          const value = collectionValue(row, key);
          copy[key] = value;
          copy.variantOverrides[key] = value;
        }
        collectionRows.set(row, copy);
      }
      return collectionRows.get(row);
    };
    const selected = (() => { try { return info.selSet ? info.selSet() : null; } catch (_) { return null; } })();
    const filters = {};
    for (const id of info.filterIds || []) {
      const el = document.getElementById(id);
      const value = el && 'value' in el ? String(el.value || '').trim() : '';
      if (value) filters[el.getAttribute('aria-label') || el.getAttribute('placeholder') || id] = value;
    }
    return {
      tableKey: info.tableKey, rows, all, selectedIds: selected ? [...selected] : [], filters: all ? {} : filters,
      canonicalRow: collectionValue ? collectionRow : row => row,
      rowId: row => row && (info.tableKey === 'koleksiyon' ? row.id : row._id),
      columns: cols.filter(col => col && col.k && col.type !== 'cpImage' && col.k !== '__picture__' &&
        (!String(col.k).startsWith('_') || col.formulaCustom || col.modelCustom || col.noteCustom || col.checklistSupplierColumn ||
          (info.tableKey === 'koleksiyon' && KOL_SYNTHETIC_COL_KEYS.includes(col.k))))
        .map(col => ({
          key: col.k,
          label: String(info.tableKey === 'koleksiyon' ? col.label : tableColumnLabel(info.tableKey, col)),
          // Doğal dil veri sorgusu (lcwai-data-query.js) tarih/sayıyı ekran metninden
          // değil ham değerden okur; tür, alan türünü belirlemek içindir.
          type: col.type || '',
          rawValue: info.tableKey === 'cp' || info.tableKey === 'orders' ? row => (row ? row[col.k] : undefined) : undefined,
          readValue: row => {
            if (info.tableKey === 'koleksiyon') {
              const effective = collectionRow(row);
              if (col.col && col.col.checklist) return kolChecklistDisplay(kolEffectiveValue(effective, col.k),effective);
              const displayRow = col.col?.endeksmatik ? kolEffectiveEndeksmatikRow(effective) :
                (col.col?.trLanded || col.col?.ydLanded) ? kolGroupSummaryEffectiveLandedRow(effective) : effective;
              return kolCollectionRawCellText(col, displayRow);
            }
            if (info.tableKey !== 'cp' && info.tableKey !== 'orders') return row[col.k];
            // Reuse display/export formatting; calculate transit flags only for
            // the two derived day columns, rather than for every AI cell.
            const flags = col.type === 'num' && (col.k === 'LT' || col.k === 'Ex→Retail') && info.computeFn ? info.computeFn(row) : null;
            return cellPlainText(col, row, flags);
          },
        })),
    };
  },
  overviewCpRows: (opts = {}) => { try { return opts && opts.all ? (state.cp ? state.cp.rows : []) : ovFilteredCpRows(); } catch (_) { return []; } },
  cpColumns(opts = {}) { return this.table('cp', { ...opts, columnsOnly: true })?.columns || []; },
  backlogQuery: (opts = {}) => {
    try {
      if (typeof backlogExportQueryParams !== 'function') return null;
      const params = backlogExportQueryParams();
      // Tüm veri: tarih/boyut filtreleri ve gruplama olmadan; yalnız biçim ve
      // seçili kaynak sütunlar korunur.
      return opts && opts.all ? { format: 'json', ...(params.sourceColumns ? { sourceColumns: params.sourceColumns } : {}) } : params;
    } catch (_) { return null; }
  },
  // Model görseli kimliği (ekrandaki küçük görselle AYNI kanonik öncelik):
  // CP/Siparişler/Overview → cpOrdersRowImageIdentity, Koleksiyon → kol sırası.
  rowImage(tab, row) {
    try {
      if (tab === 'koleksiyon') {
        const source = kolCollectionProjectionSource(row);
        const url = String(source && source._sharedCollectionImageUrl || '') || canonicalModelImageSource(source.plmId, source.colourCode, source.colour) || source.img || (source.imgRef ? `${COLLECTION_IMAGE_API}/${encodeURIComponent(source.imgRef)}` : '');
        return url ? { modelId: source.plmId || source.modelKod || source.id || '', colourCode: source.colourCode || '', source: url } : null;
      }
      const identity = cpOrdersRowImageIdentity(row);
      return identity ? { modelId: identity.modelId, colourCode: identity.colourCode, source: identity.source } : null;
    } catch (_) { return null; }
  },
  // Kimlik → gömülebilir data URL (panoya/Excel'e kopyalamayla aynı yol).
  imageDataUrl: identity => cpOrdersImageDataUrlFor(identity).catch(() => ''),
  // Backlog ekranı (backlog-overview.js) hiç açılmamış olsa da LCW AI bağlamı
  // için aynı dışa aktarma uç noktasından satırlar alınır.
  backlogRows: async query => {
    const response = await fetch(`/api/backlog-export?${new URLSearchParams(query || {}).toString()}`, { credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`);
    return Array.isArray(body.rows) ? body.rows : [];
  },
  pageTitle: tab => { const item = APP_PAGE_META[tab]; return item ? (appLang === 'en' ? item.en : item.tr) : tab; },
};
