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

document.addEventListener('copy', e=>{
  if(e.defaultPrevented)return;
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || sel.isCollapsed) return; // nothing selected: let default (e.g. copying inside an input) happen
  const anchorTd = cellOf(sel.anchorNode), focusTd = cellOf(sel.focusNode);
  if(!anchorTd || !focusTd) return; // selection isn't within our data tables: let native copy proceed
  const table = anchorTd.closest('table');
  if(!table || table !== focusTd.closest('table')) return;
  if(anchorTd === focusTd) return; // single-cell text selection: let the browser copy the highlighted plain text normally
  const meta = TABLE_META[table.id]; if(!meta) return;
  const r0=Math.min(+anchorTd.dataset.r, +focusTd.dataset.r), r1=Math.max(+anchorTd.dataset.r, +focusTd.dataset.r);
  const c0=Math.min(+anchorTd.dataset.c, +focusTd.dataset.c), c1=Math.max(+anchorTd.dataset.c, +focusTd.dataset.c);
  const rowsArr = meta.rowsFn();
  const cols = meta.colsFn ? meta.colsFn() : visibleCols(meta.tableKey);
  const colsSlice = cols.slice(c0, c1+1);
  const getText = (col,row,cf) => meta.cellText ? meta.cellText(col,row) : cellPlainText(col,row,cf);
  const getStyle = (col,row,cf) => meta.cellStyle ? meta.cellStyle(col,row) : cellStyleFor(col,row,cf);
  /* Seçilen ARALIKTAKİ kayıtlar. Var olmayan satır atlanır — boş bir satır
     eklemek, kayıt sayısıyla dışa aktarım satır sayısını ayrıştırırdı. */
  const picked=[]; for(let r=r0;r<=r1;r++){ if(rowsArr[r]) picked.push(rowsArr[r]); }
  const matrix = BLTableExport.buildMatrix({
    records:picked, columns:colsSlice,
    columnLabel:col=>meta.tableKey?tableColumnLabel(meta.tableKey,col):(col.label||col.k),
    cellText:(col,row)=>getText(col,row,meta.computeFn?meta.computeFn(row):null),
  });
  // Kopyalama her zaman aydınlık temaya göre: gri başlık (mavi değil).
  const html = BLTableExport.toHTML(matrix,{
    border:_COPY_BORDER,
    cell:(colIndex,rowIndex)=>{
      const col=colsSlice[colIndex], row=picked[rowIndex];
      return {style:getStyle(col,row,meta.computeFn?meta.computeFn(row):null)+`border:${_COPY_BORDER};`};
    },
  });
  e.preventDefault();
  e.clipboardData.setData('text/plain', BLTableExport.toTSV(matrix));
  e.clipboardData.setData('text/html', html);
  showToast(appLang==='en'?`${matrix.recordCount}×${matrix.columnCount} cells copied`:`${matrix.recordCount}×${matrix.columnCount} hücre kopyalandı`);
});
