'use strict';

/* Koleksiyon fiyat görünümü (v2026-10-22): Kompakt · Detay · Maliyet.
   Görünüm yalnız çizim katmanıdır; sütun sırası/gizli sütunlar değişmez,
   Excel'e aktarma ayrıntılı sütunları kullanır, çekmece ve şerit kanonik
   yazım/hesap yollarından geçer. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const DRAWER = fs.readFileSync(path.join(ROOT, 'public', 'collection-price-drawer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, end);
  return source.slice(from, to);
}

function viewApi(mode) {
  const context = { appLang: 'tr', BLStorage: { getItem: () => mode, setItem() {} }, renderKol() {} };
  vm.createContext(context);
  vm.runInContext(between(APP, 'const KOL_PRICE_VIEW_KEY=', 'function syncKolPriceViewToggle(') + between(APP, 'function kolPriceViewDescriptor(', '// Görünür tanımlayıcı listesine') + between(APP, 'function kolApplyPriceView(', '\nfunction kolDefaultDisplayOrder') + ';this.api={kolApplyPriceView,kolPriceViewMode};', context);
  return context.api;
}
const list = keys => keys.map(k => ({ kind: k.startsWith('__') ? 'synthetic' : 'base', k }));

test('Kompakt varsayılandır ve teklif/FOB ile landed sütunlarını kaynak yerinde toplar', () => {
  const api = viewApi(null);
  assert.equal(api.kolPriceViewMode(), 'compact');
  const out = api.kolApplyPriceView(list(['modelKod', 'targetPrice', '__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'fob', 'endeksmatik', 'ydLanded', 'trLanded']));
  assert.deepEqual(plain(out.map(d => d.k)), ['modelKod', 'targetPrice', '__priceStrip__', 'endeksmatik', '__landedSummary__']);
  assert.deepEqual(plain(out[2].folds), ['__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'fob']);
  assert.deepEqual(plain(out[4].folds), ['ydLanded', 'trLanded']);
});

test('gizli kaynak sütunlar özet sütunu doğurmaz; Detay hiçbir şeyi değiştirmez', () => {
  const compact = viewApi('compact');
  assert.deepEqual(plain(compact.kolApplyPriceView(list(['modelKod', 'targetPrice'])).map(d => d.k)), ['modelKod', 'targetPrice']);
  const detail = viewApi('detail');
  const keys = ['targetPrice', '__bestPrice__', 'fob', 'ydLanded'];
  assert.deepEqual(plain(detail.kolApplyPriceView(list(keys)).map(d => d.k)), keys);
});

test('Maliyet teklifleri şeritte toplar, FOB ve landed sütunlarını ayrı bırakır', () => {
  const api = viewApi('cost');
  const out = api.kolApplyPriceView(list(['targetPrice', '__bestPrice__', '__confirmedPrice__', 'fob', 'royalty', 'ydLanded', 'trLanded']));
  assert.deepEqual(plain(out.map(d => d.k)), ['targetPrice', '__priceStrip__', 'fob', 'royalty', 'ydLanded', 'trLanded']);
  assert.match(APP, /costView&&KOL_COST_VIEW_KEYS\.includes\(c\.k\)/, 'Maliyet görünümü maliyet sütunlarını gizli olsalar bile açar');
});

test('görünüm kalıcı sütun durumunu değiştirmez; Excel ayrıntılı sütunlarla aktarır', () => {
  const descriptors = between(APP, 'function kolDisplayDescriptors(', 'function kolDescriptorDefaultWidth(');
  assert.match(descriptors, /opts\.all\|\|opts\.detail\?list:kolApplyPriceView\(list\)/);
  assert.match(APP, /ws=wb\.addWorksheet\('Koleksiyon'\),descriptors=kolDisplayDescriptors\(\{detail:true\}\)/);
  const save = between(APP, 'function saveKolColState(', 'function loadKolColState(');
  assert.doesNotMatch(save, /priceView|__priceStrip__/, 'fiyat görünümü sütun durumuna yazılmaz');
  assert.match(HTML, /data-kol-price-view="compact"[^>]*aria-pressed="true"/);
  assert.match(HTML, /data-kol-price-view="detail"/);
  assert.match(HTML, /data-kol-price-view="cost"/);
});

test('özet hücreleri kopyalama/hücre okuma yollarında metin üretir, çökmeden', () => {
  assert.match(between(APP, 'function kolCollectionRawCellText(', 'const c=col.col;if(!c)return'), /kolPriceViewCellText\(col,row\)/);
  assert.match(between(APP, 'function kolSpreadsheetRawValue(', 'const groups=window.BLCollectionModelGroups;'), /kolPriceViewCellText\(d,row\)/);
  assert.match(between(APP, 'function kolDescriptorByKey(', '\n}'), /KOL_PRICE_VIEW_COLS\[key\]\)return kolPriceViewDescriptor\(key\)/);
});

test('Veri Sağlığı filtresi tablo filtresidir: belirteç olarak görünür ve temizlenir', () => {
  assert.match(between(APP, 'function filteredKol(', 'function kolPresentationRows('), /kolHealthState\.filter&&!kolHealthMatches\(r,kolHealthState\.filter\)/);
  assert.match(between(APP, 'function clearTableFilters(', 'function '), /kolHealthState\.filter=''/);
  assert.match(between(APP, 'function activeTableFilterTokens(', 'function renderActiveFilterContext('), /kind:'health'/);
  assert.match(QUOTES, /function collectionQuoteIndex\(\)/);
  assert.match(QUOTES, /window\.BL_QUOTATIONS=\{collectionQuoteIndex,/);
});

test('Fiyat Çekmecesi yalnız kanonik yazım yollarını kullanır', () => {
  assert.match(DRAWER, /kolApplyCollectionCellChange\(\{rowId:row\.id,key,value,source:'drawer'\},\{rerender:true\}\)/);
  assert.match(DRAWER, /kolToggleConfirmedManufacturer\(row,approve\.dataset\.cpdApprove\)/);
  assert.match(DRAWER, /openKolManualPriceModal\(row\)/);
  assert.match(DRAWER, /kolLandedCalc\(kolGroupSummaryEffectiveLandedRow\(row\)\)/);
  assert.doesNotMatch(DRAWER, /row\.(pricing|confirmedManufacturer|targetPrice|trPrice)\s*=/, 'çekmece satıra doğrudan yazmaz');
  assert.doesNotMatch(DRAWER, /<section/, 'global section kuralı çekmece içeriğini gizler');
  assert.match(HTML, /<script src="collection-price-drawer\.js\?v=__BL_ASSET_VERSION__&rev=1"><\/script>/);
});
