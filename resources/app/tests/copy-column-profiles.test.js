'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
const P = require('../public/copy-column-profiles');

const CP_CATALOG = [
  { key: 'Model Name', group: 'Model Detayları' },
  { key: 'Supp. FOB', group: 'Sipariş Detayları' },
  { key: 'Retail Date', group: 'Tarihler' },
  { key: 'Ex→Retail', group: 'Tarihler' },
  { key: 'In-Store (Model Budget)', group: 'Tarihler' },
];
const KOL_CATALOG = [
  { key: 'modelKod', group: 'Model Detayları' },
  { key: 'retail', group: 'Tarihler & Sevkiyat' },
  { key: 'inStoreWeek', group: 'Model Detayları' },
  { key: 'inStoreMonth', group: 'Model Detayları' },
  { key: '__bestPrice__', group: 'Fiyatlandırma' },
  { key: '__confirmedPrice__', group: 'Fiyatlandırma' },
  { key: '__confirmedName__', group: 'Fiyatlandırma' },
  { key: '__lfl__', group: 'Fiyatlandırma' },
  { key: '__ekIdxUsd__', group: 'Endeksmatik & Avantaj' },
  { key: '__advantage__', group: 'Endeksmatik & Avantaj' },
];

test('default sensitive columns: Retail Date, Ex→Retail and MB date/week/month', () => {
  const cp = P.defaultSensitive('cp', CP_CATALOG);
  assert.deepEqual([...cp].sort(), ['Ex→Retail', 'In-Store (Model Budget)', 'Retail Date'].sort());
  assert.deepEqual([...P.defaultSensitive('orders', CP_CATALOG)].sort(), [...cp].sort());
  const kol = P.defaultSensitive('koleksiyon', KOL_CATALOG);
  for (const key of ['retail', 'exToRetail', 'inStoreWeek', 'inStoreMonth']) assert.ok(kol.has(key), key);
});

test('Collection price analysis, index, advantage and approved price/manufacturer are sensitive by default', () => {
  const kol = P.defaultSensitive('koleksiyon', KOL_CATALOG);
  for (const key of ['__confirmedPrice__', '__confirmedName__', '__lfl__', '__previousSeason__', '__seasonImpact__', 'endeksmatik', '__ekIdxUsd__', '__advantage__', 'ydLanded', 'trLanded']) {
    assert.ok(kol.has(key), key);
  }
  // Talep edilmeyen fiyat sütunları kendiliğinden hassas olmaz.
  assert.equal(kol.has('__bestPrice__'), false);
  assert.equal(kol.has('modelKod'), false);
});

test('sensitive choices are stored as a diff against defaults and can be changed later', () => {
  const chosen = new Set(['Supp. FOB', 'Retail Date', 'In-Store (Model Budget)']);
  const diff = P.sensitiveDiff('cp', CP_CATALOG, chosen);
  assert.deepEqual(diff, { sensitiveOn: ['Supp. FOB'], sensitiveOff: ['Ex→Retail'] });
  const effective = P.sensitiveSet('cp', CP_CATALOG, diff);
  assert.deepEqual([...effective].sort(), [...chosen].sort());
  // Kayıt yoksa varsayılanlar geçerlidir.
  assert.ok(P.sensitiveSet('cp', CP_CATALOG, null).has('Ex→Retail'));
});

test('custom profile keeps saved order and drops columns that no longer exist', () => {
  assert.equal(P.profileKeys(CP_CATALOG, {}), null, 'profil seçilmeden kopyalama sütunu uydurulmaz');
  const keys = P.profileKeys(CP_CATALOG, { columns: ['Retail Date', 'Removed Column', 'Model Name', 'Model Name'] });
  assert.deepEqual(keys, ['Retail Date', 'Model Name']);
  const columns = CP_CATALOG.map(item => ({ k: item.key }));
  assert.deepEqual(P.orderedByKeys(columns, c => c.k, keys).map(c => c.k), ['Retail Date', 'Model Name']);
});

test('withoutSensitive removes only sensitive columns and reports how many were hidden', () => {
  const columns = CP_CATALOG.map(item => ({ k: item.key }));
  const result = P.withoutSensitive(columns, c => c.k, P.defaultSensitive('cp', CP_CATALOG));
  assert.deepEqual(result.columns.map(c => c.k), ['Model Name', 'Supp. FOB']);
  assert.equal(result.hidden, 3);
});

test('normalizeStore ignores unknown modules and malformed values', () => {
  const store = P.normalizeStore({ cp: { columns: ['A', '', 'A', 3], sensitiveOn: 'x' }, other: { columns: ['B'] } });
  assert.deepEqual(Object.keys(store), ['cp']);
  assert.deepEqual(store.cp, { columns: ['A', '3'], sensitiveOn: [], sensitiveOff: [] });
});

test('Ctrl+C and normal Copy stay unchanged; new copies go through their own action', () => {
  const app = read('app-main.js');
  const ctrlStart = app.indexOf("document.addEventListener('keydown', event=>{\n  if(event.defaultPrevented) return;\n  if(event.key!=='c' && event.key!=='C') return;");
  assert.ok(ctrlStart > 0, 'Ctrl+C kısayolu bulunamadı');
  const ctrlBlock = app.slice(ctrlStart, app.indexOf('\n});', ctrlStart));
  assert.doesNotMatch(ctrlBlock, /copyRowsWithCopyColumns|BLCopyColumns/, 'Ctrl+C hassas/özel kopyaya bağlanmamalı');
  assert.match(app, /window\.BLCopyColumnsAction=\{/);
  assert.match(app, /buildManagedTableStyledCopy\(tableKey,null,selSet,\{columns:cols,records\}\)/);
  assert.match(app, /buildCollectionStyledCopy\(kolSelected,\{descriptors,picture\}\)/);
  assert.match(app, /const cols=Array\.isArray\(options\.columns\)\?options\.columns:visibleCols\(tableKey\);/,
    'normal CP/Orders kopyası görünür sütunları kullanmaya devam etmeli');
});

test('selection bar shows the sensitive-hidden copy with an edit button immediately to its right', () => {
  const bar = read('selection-action-bar.js');
  assert.match(bar, /\['copy','navCopy'\],\['copySafe',''\]/);
  assert.match(bar, /\['copy','kolCopySelectedBtn'\],\['copySafe',''\]/);
  assert.match(bar, /data-selection-run="copySafe"[^`]*<\/button><button type="button" class="iconbtn blSelectionEdit" data-selection-run="editSensitive"/,
    'düzenleme butonu hassas kopya butonunun hemen sağında olmalı');
  assert.match(bar, /action\.edit\(lastKey,\{focus:'sensitive'\}\)/);
  assert.match(bar, /T\('Hassas sütunları düzenle','Edit sensitive columns'\)/);
});

test('copy menus and context menus offer custom and sensitive-hidden copies in TR and EN', () => {
  const app = read('app-main.js');
  assert.match(app, /'Copy custom columns':'Özel sütunlarla kopyala'/);
  assert.match(app, /'Copy without sensitive columns':'Hassaslar gizli kopyala'/);
  assert.match(read('row-context-menu.js'), /T\('Özel sütunlarla kopyala', 'Copy custom columns'\)/);
  assert.match(read('collection-spreadsheet.js'), /'Copy custom columns':'Özel sütunlarla kopyala'/);
});

test('copy column settings are personal and synced; the module and its style load lazily on first use', () => {
  const storage = read('user-storage.js');
  assert.equal((storage.match(/'lcw\.copyColumns\.'/g) || []).length, 2, 'kullanıcı kapsamı ve senkron listesi');
  const html = read('index.html');
  assert.doesNotMatch(html, /copy-column-profiles\.(js|css)/, 'açılışta yüklenmemeli');
  assert.match(html, /<symbol id="i-eye-off"/);
  assert.match(read('app-main.js'), /_loadScript\?\.\('copy-column-profiles\.js\?rev=1'\)/);
  assert.match(read('copy-column-profiles.js'), /return ensureStyle\(\)\.then\(\(\)=>renderEditor\(doc,options\)\)/);
});
