'use strict';
// PREPARED ONLY. Counts adapter only; provider guards/formula closure separate.
const assert=require('node:assert/strict');
function once(source,before,after){const at=source.indexOf(before);assert.ok(at>=0,'exact counts seam missing');assert.equal(source.indexOf(before,at+before.length),-1,'ambiguous counts seam');return source.slice(0,at)+after+source.slice(at+before.length);}
const summary=`  tableSummary(tab) {
    if (tab !== 'orders') return undefined;
    const fullRows = state.orders && state.orders.rows;
    if (!Array.isArray(fullRows) || !fullRows.length) return null;
    let info = null;
    try { info = tableInfoForTab(tab); } catch (_) { return null; }
    if (!info) return null;
    const metadata = this.table(tab, { all: true, columnsOnly: true });
    if (!metadata) return null;
    let visible = null;
    try {
      const rows = info.rowsFn();
      if (Array.isArray(rows) && rows.length) visible = {
        rowCount: rows.length,
        selectedCount: Array.isArray(metadata.selectedIds) ? metadata.selectedIds.length : 0,
      };
    } catch (_) { /* Existing empty/failed filtered table has no visible options. */ }
    return { full: { rowCount: fullRows.length, columnCount: metadata.columns.length }, visible };
  },
`;
function app(source){const marker="  lastTab: () => window.BL_LCWAI_LAST_TAB || 'overview',\n";return once(source,marker,marker+summary);}
function chat(source){
 const marker="        getOptions() {\n          // Varsayılan: sayfa filtrelerinden bağımsız TÜM kayıtlar.\n";
 const adapter=`        getOptions() {
          if (tab === 'orders' && typeof window.BLAIScreenData?.tableSummary === 'function') {
            const summary = window.BLAIScreenData.tableSummary(tab);
            if (!summary) return [];
            const full = summary.full, data = summary.visible;
            const options = [{ id: 'all', label: { tr: \`Tüm kayıtlar (\${full.rowCount})\`, en: \`All records (\${full.rowCount})\` }, detail: { tr: \`Sayfa filtreleri olmadan, \${full.columnCount} sütun · CSV dosyası olarak\`, en: \`Without page filters, \${full.columnCount} columns · as a CSV file\` } }];
            if (data && data.rowCount !== full.rowCount) options.push({ id: 'visible', label: { tr: \`Yalnız filtrelenmiş kayıtlar (\${data.rowCount})\`, en: \`Filtered records only (\${data.rowCount})\` }, detail: { tr: 'Sayfadaki filtreler uygulanmış', en: 'Page filters applied' } });
            if (data && data.selectedCount) options.push({ id: 'selected', label: { tr: \`Seçili kayıtlar (\${data.selectedCount})\`, en: \`Selected records (\${data.selectedCount})\` } });
            if (data) options.push({ id: 'filters', label: { tr: 'Aktif filtreler ve özet', en: 'Active filters and summary' } });
            return options;
          }
          // Varsayılan: sayfa filtrelerinden bağımsız TÜM kayıtlar.
`;
 return once(source,marker,adapter);
}
module.exports={app,chat,summary};
