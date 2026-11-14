'use strict';

/* Rapor görünümü: CP / Siparişler / Koleksiyon görünüm seçicisinden, tablonun o anki
   filtre ve sıralama sonucunu paylaşılan detay rapor motorunda (rol gruplu, iki
   satırlı hücreler) açar. Salt okunurdur; tablo ön ayarı, filtre ve kayıtlar değişmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('each table view picker offers Report view in TR/EN after the presets and Fields', () => {
  const html = read('index.html');
  for (const key of ['cp', 'orders', 'koleksiyon']) {
    const start = html.indexOf(`data-bl-view-picker="${key}"`);
    assert.ok(start > 0, key);
    const picker = html.slice(start, html.indexOf('</div>', html.indexOf('blViewPickerMenu', start)));
    const all = picker.indexOf(`data-table-view-preset="all" data-table-key="${key}"`);
    const report = picker.indexOf(`data-table-report="${key}"`);
    assert.ok(all > 0 && report > all, key + ': Report view follows All');
    assert.match(picker, new RegExp(`data-table-report="${key}" aria-haspopup="dialog"[^>]*data-i18n-title-en="Open the visible records in report layout: fields grouped by role in two-line cells"`));
    assert.match(picker, /<span data-i18n-tr="Rapor görünümü" data-i18n-en="Report view">Rapor görünümü<\/span>/);
    // Not a preset: the picker label still follows Focus / Extended / All.
    assert.doesNotMatch(picker.slice(report - 120, report + 80), /data-table-view-preset="report"/);
  }
});

test('Report view opens the filtered, sorted rows read-only in the shared report engine', () => {
  const app = read('app-main.js');
  const start = app.indexOf('function openTableReportView(tableKey,trigger){');
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf('\n}\n', start));
  assert.match(body, /rows=tableKey==='cp'\?filteredCP\(\):tableKey==='orders'\?filteredOrders\(\):filteredKol\(\);/);
  assert.match(body, /if\(!rows\.length\)\{showToast\(en\?'There are no visible records to show in report view\.':'Rapor görünümünde gösterilecek görünür kayıt yok\.'\);return false;\}/);
  assert.match(body, /window\.BLDetailDrawer\.open\(\{storageKey:tableKey\+'\.report\.view',moduleId:tableKey,source:tableKey,tableSetup:tableKey,/);
  assert.match(body, /window\.BLCollectionAnalyticsBridge\.openDrilldown\(rows,title\)/);
  // Read-only: no preset, filter, selection or record writes from this path.
  assert.doesNotMatch(body, /applyTableViewPreset|saveState|persist|setPartialView|\.rows\s*=|delete |splice\(/);
  assert.match(app, /const button=event\.target\.closest\?\.\('\[data-table-report\]'\);if\(!button\)return;\n  openTableReportView\(button\.dataset\.tableReport,button\.closest\('\.blViewPicker'\)\?\.querySelector\('\[data-bl-view-trigger\]'\)\|\|button\);/);
  // The shared drawer already uses role projection for CP/Orders table setups.
  assert.match(read('detail-drawer.js'), /return root\.BLDetailReportLayout\.project\(current,detailModule\(\),root\.BLCanonicalFields,labels\);/);
});
