'use strict';

/* Rapor görünümü: CP / Siparişler / Koleksiyon görünüm seçicisinden tablo kendi yerinde
   rapor düzenine döner (sağ çekmece açılmaz). Görünen alanlar paylaşılan rol projeksiyonunda
   (BLDetailReportLayout) iki satırlı hücrelerde durur; satırlar tablonun o anki filtre,
   sıralama ve sayfa aralığıdır. Salt okunurdur; tabloya dönünce her şey aynıdır.
   Gerçek tarayıcı davranışı: scripts/ui-line-consistency-acceptance.js (rapor bölümü). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('each table view picker offers a Report view toggle in TR/EN after the presets and Fields', () => {
  const html = read('index.html');
  for (const key of ['cp', 'orders', 'koleksiyon']) {
    const start = html.indexOf(`data-bl-view-picker="${key}"`);
    assert.ok(start > 0, key);
    const picker = html.slice(start, html.indexOf('</div>', html.indexOf('blViewPickerMenu', start)));
    const all = picker.indexOf(`data-table-view-preset="all" data-table-key="${key}"`);
    const report = picker.indexOf(`data-table-report="${key}"`);
    assert.ok(all > 0 && report > all, key + ': Report view follows All');
    // A toggle, not a dialog opener.
    assert.match(picker, new RegExp(`data-table-report="${key}" aria-pressed="false"[^>]*data-i18n-title-en="Switch the table to report layout in place: fields grouped by role in two-line cells; click again to return to the table"`));
    assert.doesNotMatch(picker.slice(report - 40, report + 120), /aria-haspopup="dialog"/);
    assert.match(picker, /<span data-i18n-tr="Rapor görünümü" data-i18n-en="Report view">Rapor görünümü<\/span>/);
    assert.doesNotMatch(picker.slice(report - 120, report + 80), /data-table-view-preset="report"/);
  }
  assert.ok(html.indexOf('table-report-inline.js') > html.indexOf('detail-report-layout.js'), 'inline report loads after the shared layout');
  assert.ok(html.indexOf('table-report-inline.js') < html.indexOf('app-main.js'), 'inline report loads before app-main');
});

test('Report view switches the table in place instead of opening the right drawer', () => {
  const app = read('app-main.js');
  const start = app.indexOf('function openTableReportView(tableKey){');
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf('\n}\n', start));
  assert.match(body, /return window\.BLTableReportInline\.toggle\(tableKey\);/);
  assert.doesNotMatch(body, /BLDetailDrawer|openDrilldown/);
  // Rows are exactly the table's current filtered, sorted page.
  assert.match(app, /view\.visibleRows=range\.rows;\n  \/\/ Tablo içi Rapor görünümü aynı sayfa aralığını izler \(sayfa\/boyut\/filtre\/sıralama\)\.\n  if\(ensureTableReportAdapters\(\)\)window\.BLTableReportInline\.schedule\(tableKey\);\n  return range\.rows;/);
  const adapters = app.slice(app.indexOf('function ensureTableReportAdapters(){'), app.indexOf('function openTableReportView('));
  assert.match(adapters, /rows:\(\)=>tableRangeVisibleRows\(key\)/);
  assert.match(adapters, /rows:\(\)=>tableRangeVisibleRows\('koleksiyon'\)/);
  assert.match(adapters, /columns:\(\)=>tableReportCoreColumns\(key\)/);
  assert.match(adapters, /columns:tableReportKolColumns/);
  // Field filters reuse the table's own header filters.
  assert.match(adapters, /openHeaderFilter\(key,field,anchor,key==='cp'\?renderCP:renderOrders\)/);
  assert.match(adapters, /openKolHeaderFilter\(field,anchor\)/);
  // Read-only: no preset, record or selection writes from this path.
  assert.doesNotMatch(adapters + body, /applyTableViewPreset|saveState|setPartialView|\.rows\s*=|splice\(|Selected\.(add|delete|clear)/);
});

test('inline report stacks fields by the table column main headers, stays read-only and lazy', () => {
  const src = read('table-report-inline.js');
  // Column main headers decide what stacks: each consecutive header group is one report column;
  // the shared role projection is only the fallback for tables without header groups.
  assert.match(src, /const projected=columns\.some\(col=>clean\(col\.group\)\)\?groupProjection\(columns\):\n    layout\?layout\.project\(columns,moduleId,canonical,labels\(\)\)/);
  assert.match(src, /if\(group&&last&&last\.group===group\)\{last\.fields\.push\(col\);continue;\}/);
  const app = read('app-main.js');
  assert.match(app, /map\(col=>\(\{key:col\.key,label:col\.label,group:col\.group,/);
  assert.match(app, /group:tableColumnGroupLabel\(kolColumnGroupFor\(d\.k,order\)\)/);
  // Visible text is TR/EN.
  for (const pair of [["'Rapor görünümü','Report view'"], ["'Tablo görünümüne dön','Back to table view'"], ["'Daha fazla göster','Show more'"], ["'Gösterilecek satır yok.','No rows to display.'"]])
    assert.ok(src.includes('L(' + pair[0] + ')'), pair[0]);
  // Escapes every value; never writes to the rows it receives.
  assert.match(src, /const esc=value=>/);
  assert.doesNotMatch(src, /row\[[^\]]+\]\s*=|\.push\(row|rows\.(splice|sort)\(/);
  // Hidden tabs do not render; the next table render brings it back.
  assert.match(src, /if\(!tabVisible\(adapter\)\)continue;/);
  // The table stays in the DOM (hidden by CSS) so selection, editing and export state survive.
  assert.match(src, /wrap\?\.classList\.add\('blTableReportMode'\)/);
  assert.match(read('detail-drawer.css'), /\.tablewrap\.blTableReportMode>table:not\(\.blTableReportTable\)/);
  // Preference is per table and storage failures are harmless.
  assert.match(src, /const STORE_PREFIX='buyerlog\.tableReportMode\.v1\.';/);
  assert.match(src, /function saved\(key\)\{try\{/);
});
