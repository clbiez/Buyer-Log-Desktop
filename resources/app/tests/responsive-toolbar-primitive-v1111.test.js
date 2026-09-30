'use strict';

/* v11.11 — Paylaşılan duyarlı araç çubuğu.
   Saf planlayıcı DOM'suz koşar; kaynak/markup sözleşmeleri mevcut desenle
   doğrulanır. Korunan davranış: eylemler ASLA üst üste binmez, ⋯ tetikleyicisi
   her zaman erişilebilir kalır ve genişlik gidip geldiğinde eylem kaybolmaz,
   çoğalmaz, sırası bozulmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const TOOLBAR = require(path.join(ROOT, 'public', 'toolbar-responsive.js'));
const SOURCE = read('public/toolbar-responsive.js');
const CSS = read('public/app.css');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');

const { planToolbarLayout, layoutWidth, overflowCandidates, samePlan, searchInputTargetWidth } = TOOLBAR;

const GROUP = 'kolTableActions';
const GAPS = { __root__: 6, [GROUP]: 5 };

/* Koleksiyon araç çubuğunun gerçek yapısı: arama kutusu + eylem grubu +
   PLM Sync / Araçlar / ⋯ sarmalayıcıları. Genişlikler ölçüm ölçeğindedir. */
function collectionEntries(scale = 1) {
  const w = value => Math.round(value * scale);
  const item = (id, priority, width, compactWidth, extra = {}) => ({
    id, priority, container: GROUP, overflowable: true,
    width: w(width), compactWidth: w(compactWidth), ...extra,
  });
  return [
    { id: 'kolSearch', priority: 'pinned', container: '__root__', overflowable: false,
      flexible: true, width: 230, minWidth: 150, compactMinWidth: 120 },
    item('kolAddRowBtn', 'primary', 34, 34, { overflowable: false }),
    item('kolUndoBtn', 'selection', 74, 34),
    item('kolRedoBtn', 'selection', 74, 34),
    item('kolSpreadsheetPasteBtn', 'secondary', 92, 34),
    item('kolRecycleBinBtn', 'utility', 160, 34),
    item('kolExportImgBtn', 'secondary', 110, 34),
    item('kolCopySelectedBtn', 'selection', 90, 34),
    item('kolDuplicateBtn', 'selection', 84, 34),
    item('kolDropSelectedBtn', 'selection', 82, 34),
    item('kolDelRowBtn', 'selection', 116, 34),
    { id: 'kolPlmSyncWrap', priority: 'utility', container: '__root__', overflowable: false, width: w(108), compactWidth: w(44) },
    { id: 'kolToolsWrap', priority: 'utility', container: '__root__', overflowable: false, width: w(92), compactWidth: w(44) },
    { id: 'kolMoreWrap', priority: 'pinned', container: '__root__', overflowable: false, width: 44, compactWidth: 44 },
  ];
}

const TRIGGER = { width: 44, alwaysVisible: true };

function planAt(available, entries = collectionEntries()) {
  return planToolbarLayout({ available, entries, gaps: GAPS, overflowTrigger: TRIGGER });
}

/* "Üst üste binme yok" ölçülebilir hâli: görünür eylemlerin toplam genişliği
   kullanılabilir genişliği aşıyorsa plan SARMA kademesinde olmak zorundadır. */
function assertNoCollision(plan, available, entries = collectionEntries()) {
  const used = layoutWidth(entries, { compact: plan.compact, hidden: new Set(plan.overflow), gaps: GAPS });
  assert.ok(used <= available || plan.wrap === true,
    `genişlik ${available}px için çakışma: ${used}px kullanılıyor, wrap=${plan.wrap}`);
}

const fullWidth = () => layoutWidth(collectionEntries(), { compact: false, gaps: GAPS });

test('v11.11 geniş alanda araç çubuğu tam yerleşimde kalır, hiçbir eylem taşmaz', () => {
  const plan = planAt(fullWidth() + 200);
  assert.deepEqual(plan, { compact: false, overflow: [], wrap: false });
});

test('v11.11 Collection toolbar no longer budgets a redundant Selected Models label', () => {
  assert.doesNotMatch(INDEX, /kolSelectedGroupLabel/);
  assert.equal(collectionEntries().some(entry => entry.id === 'kolSelectedGroupLabel'), false);
});

test('v11.11 ikincil eylemler taşma menüsüne girmeden ÖNCE kompakt kademe denenir', () => {
  const compactOnly = layoutWidth(collectionEntries(), { compact: true, gaps: GAPS });
  const plan = planAt(compactOnly + 10);
  assert.equal(plan.compact, true);
  assert.deepEqual(plan.overflow, []);
  assert.equal(plan.wrap, false);
});

test('v11.11 dar alanda önce en düşük öncelikli eylemler ⋯ menüsüne taşınır', () => {
  const compactOnly = layoutWidth(collectionEntries(), { compact: true, gaps: GAPS });
  const plan = planAt(compactOnly - 60);
  assert.ok(plan.overflow.length > 0, 'taşma beklenir');
  assert.equal(plan.overflow.includes('kolRecycleBinBtn'), true, 'utility önce taşar');
  assert.equal(plan.overflow.includes('kolAddRowBtn'), false, 'birincil eylem taşmaz');
  assertNoCollision(plan, compactOnly - 60);
});

test('v11.11 birincil eylem ve ⋯ tetikleyicisi her genişlikte görünür kalır', () => {
  for (let available = 1920; available >= 420; available -= 20) {
    const plan = planAt(available);
    assert.equal(plan.overflow.includes('kolAddRowBtn'), false, `${available}px: birincil eylem kayboldu`);
    assert.equal(plan.overflow.includes('kolMoreWrap'), false, `${available}px: ⋯ tetikleyicisi taştı`);
    assert.equal(plan.overflow.includes('kolPlmSyncWrap'), false, `${available}px: PLM Sync menüsü taştı`);
    assert.equal(plan.overflow.includes('kolToolsWrap'), false, `${available}px: Araçlar menüsü taştı`);
    assertNoCollision(plan, available);
  }
});

test('v11.11 ⋯ tetikleyicisi görünür bir yuva değilse genişliği taşmadan ÖNCE bütçelenir', () => {
  const entries = collectionEntries().filter(entry => entry.id !== 'kolMoreWrap');
  const compactOnly = layoutWidth(entries, { compact: true, gaps: GAPS });
  const available = compactOnly - 1;
  const budgeted = planToolbarLayout({
    available, entries, gaps: GAPS,
    overflowTrigger: { width: 44, alwaysVisible: false },
  });
  const used = layoutWidth(entries, { compact: true, hidden: new Set(budgeted.overflow), gaps: GAPS });
  assert.ok(budgeted.overflow.length > 0, 'taşma beklenir');
  assert.ok(used + 44 + GAPS.__root__ <= available || budgeted.wrap,
    '⋯ düğmesi için yer ayrılmadan taşma kararı verilmiş');
});

test('v11.11 taşacak eylem kalmadığında araç çubuğu üst üste binmek yerine satır sarar', () => {
  /* Eşik sabit değil, taşamayan eylemlerin kompakt genişliğinden türetilir:
     araç çubuğu küçüldükçe (ör. 7.0.174'te Yeni satır ikona indi) sabit 320px
     artık "her şey sığıyor" genişliği olabiliyordu. */
  const pinned = collectionEntries().filter(entry => !entry.overflowable);
  const minimum = layoutWidth(pinned, { compact: true, gaps: GAPS });
  const plan = planAt(minimum - 40);
  assert.equal(plan.wrap, true);
  assert.equal(plan.compact, true);
  for (const entry of collectionEntries()) {
    if (!entry.overflowable) assert.equal(plan.overflow.includes(entry.id), false, `${entry.id} taşmamalı`);
  }
});

test('v11.11 dar → geniş → dar geçişi aynı planı üretir (idempotent yeniden yerleşim)', () => {
  const narrow = planAt(980);
  const wide = planAt(fullWidth() + 300);
  const back = planAt(980);
  assert.equal(samePlan(narrow, back), true);
  assert.deepEqual(back.overflow, narrow.overflow);
  assert.equal(samePlan(narrow, wide), false);
  assert.deepEqual(wide.overflow, []);
  assert.equal(new Set(narrow.overflow).size, narrow.overflow.length, 'eylem çoğalmamalı');
});

test('v11.11 taşan eylemler araç çubuğundaki sıralarını korur', () => {
  const entries = collectionEntries();
  const order = entries.map(entry => entry.id);
  const plan = planAt(900);
  const positions = plan.overflow.map(id => order.indexOf(id));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));
});

test('v11.11 uzun İngilizce/Türkçe etiketler çakışma değil, daha erken taşma üretir', () => {
  const long = collectionEntries(1.35);
  const available = 1180;
  const plan = planToolbarLayout({ available, entries: long, gaps: GAPS, overflowTrigger: TRIGGER });
  const used = layoutWidth(long, { compact: plan.compact, hidden: new Set(plan.overflow), gaps: GAPS });
  assert.ok(used <= available || plan.wrap, 'uzun etiketlerde çakışma');
  assert.ok(plan.overflow.length >= planAt(available).overflow.length,
    'uzun etiketler en az aynı sayıda eylemi taşımalı');
});

test('v11.11 birincil ve sabitlenmiş eylemler taşma adayı bile olmaz', () => {
  const ids = overflowCandidates(collectionEntries()).map(entry => entry.id);
  assert.equal(ids.includes('kolAddRowBtn'), false);
  assert.equal(ids.includes('kolSearch'), false);
  assert.equal(ids.includes('kolMoreWrap'), false);
  /* Sıra: utility → secondary → selection. */
  const rank = id => ({ utility: 3, secondary: 2, selection: 1 })[
    collectionEntries().find(entry => entry.id === id).priority];
  const ranks = ids.map(rank);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => b - a));
});

test('v11.11 planlayıcı tablo genişliğini değil yalnız araç çubuğu genişliğini girdi alır', () => {
  /* Tablo yatay kaydırması araç çubuğunu ETKİLEMEZ: aynı available değeri
     her zaman aynı planı verir, tablo ne kadar geniş olursa olsun. */
  assert.deepEqual(planAt(1200), planAt(1200));
  assert.doesNotMatch(SOURCE, /scrollWidth|tablewrap|table\.offsetWidth/);
});

test('v11.11 taşma eylemi klonlanmaz; gerçek DOM düğümü taşınır', () => {
  assert.doesNotMatch(SOURCE, /cloneNode/);
  assert.match(SOURCE, /slot\.insertBefore\(node,before\)/);
  assert.match(SOURCE, /anchor\.parentNode\.replaceChild\(node,anchor\)/);
  /* Odak, düğüm taşınırken korunur. */
  assert.match(SOURCE, /keepFocus&&typeof keepFocus\.focus==='function'/);
});

test('v11.11 CP, Siparişler ve Koleksiyon araç çubukları ortak katmana kayıtlıdır', () => {
  for (const [toolbar, menu, trigger] of [
    ['cpTableToolbar', 'cpMoreMenu', 'cpMoreWrap'],
    ['ordersTableToolbar', 'ordersMoreMenu', 'ordersMoreWrap'],
    ['kolTableToolbar', 'kolMoreMenu', 'kolMoreWrap'],
  ]) {
    assert.match(INDEX, new RegExp(`id="${toolbar}"[^>]*data-responsive-toolbar="[a-z]+"`));
    assert.match(INDEX, new RegExp(`id="${toolbar}"[^>]*data-overflow-menu="${menu}"`));
    assert.match(INDEX, new RegExp(`id="${toolbar}"[^>]*data-overflow-trigger="${trigger}"`));
    assert.match(INDEX, new RegExp(`id="${menu}"`));
    assert.match(INDEX, new RegExp(`id="${trigger}"[^>]*data-tb-overflow="never"`));
  }
  assert.match(INDEX, /<script src="toolbar-responsive\.js\?v=__BL_ASSET_VERSION__&rev=\d+"><\/script>/);
});

test('v11.11 ikon ölçeğine inen her eylem erişilebilir bir metin alternatifi taşır', () => {
  const marked = INDEX.match(/<(?:button|label)[^>]*data-tb-compact="icon"[^>]*>/g) || [];
  assert.ok(marked.length >= 10, 'kompakt eylem işaretlemesi beklenenden az');
  for (const tag of marked) {
    assert.match(tag, /\btitle="[^"]+"/, `tooltip eksik: ${tag.slice(0, 120)}`);
  }
});

test('v11.11 eylemler kutularının altına sıkışmaz; taban yerleşim çakışma üretemez', () => {
  assert.match(CSS, /\.tableActionToolbar\{[\s\S]*?flex-wrap:wrap;[\s\S]*?min-width:0;[\s\S]*?\}/);
  assert.match(CSS, /\.tableToolbarActions\{[\s\S]*?flex-wrap:wrap;[\s\S]*?\}/);
  assert.match(CSS, /\.tableActionToolbar \.tableToolbarActions>\*\{flex:0 0 auto;\}/);
  /* Çakışma artık z-index / yatay kaydırma ile GİZLENMİYOR. */
  assert.doesNotMatch(CSS, /\.tableActionToolbar\{overflow-x:auto/);
  assert.doesNotMatch(CSS, /\.toolbar\.tableActionToolbar \[data-action-role="primary"\]\{position:sticky/);
});

test('v11.11 kompakt ikon kuralı taşma menüsündeki eylemlere uygulanmaz', () => {
  assert.match(CSS, /\[data-toolbar-compact\] \[data-tb-compact="icon"\]:not\(\[data-tb-overflowed\]\)>span\{display:none!important;\}/);
  assert.match(CSS, /\.toolbarMoreMenu \.toolbarOverflowItem>span\{display:inline!important;\}/);
  assert.match(CSS, /\.toolbarOverflowSlot\{[^}]*flex-direction:column/);
});

test('v11.11 ortak deseni kullanmayan modül eylem kümeleri de sıkışma koruması taşır', () => {
  /* Bu kümeler Koleksiyon hatasını üretmiyor; korunan şey aynı mekanizmanın
     (nowrap + varsayılan shrink) onlarda da başlayamaması. */
  assert.match(CSS, /\.intakeFilterActions,\.oabConfigActions,\.oabMultiActions\{flex-wrap:wrap;min-width:0;\}/);
  assert.match(CSS, /\.intakeFilterActions>\*,\.oabConfigActions>\*,\.oabMultiActions>\*\{flex:0 0 auto;\}/);
});

test('v11.11 sarma kademesi tabloyu örtmez, araç çubuğunu yükseltir', () => {
  assert.match(CSS, /\.tableActionToolbar\[data-toolbar-wrap\]\{align-items:flex-start;\}/);
  assert.doesNotMatch(CSS, /\.tableActionToolbar\[data-toolbar-wrap\]\{[^}]*position:absolute/);
});

test('v11.11 paylaşılan eylem taşıma sistemi ortak katmanla senkron çalışır', () => {
  const start = APP.indexOf('function syncTableToolbarActions(');
  const body = APP.slice(start, APP.indexOf('const APP_PAGE_META', start));
  assert.ok(body.indexOf('BLToolbarResponsive?.reset?.()') < body.indexOf('restoreSharedTableActions()'),
    'taşınma öncesi taşma menüsü boşaltılmalı');
  assert.match(body, /BLToolbarResponsive\?\.refresh\?\.\(null,\{remeasure:true\}\)/);
  /* ⋯ menüsü ekran dışına açılmaz. */
  assert.match(APP, /if\(!menu\.hidden\)window\.BLToolbarResponsive\?\.placeMenu\?\.\(menu\)/);
});


test('v11.12 arama kutusu yalnız metin taban genişliği aştığında büyür ve üst sınırı geçmez', () => {
  assert.equal(searchInputTargetWidth(120), null, 'kısa metin kutuyu gereksiz büyütmemeli');
  assert.equal(searchInputTargetWidth(240), 282, 'uzun metin için yazı + kontrol payı kadar büyümeli');
  assert.equal(searchInputTargetWidth(900), 520, 'çok uzun metin üst sınırda kalmalı');
  assert.equal(searchInputTargetWidth(260, { base:180, max:360, chrome:40 }), 300);
});

test('v11.12 dinamik arama genişliği sağdaki eylemleri ezmeden flex-shrink ile geri küçülebilir', () => {
  assert.match(SOURCE, /--tb-search-width/);
  assert.match(SOURCE, /input\.addEventListener\('input',\(\)=>syncSearchInputWidth\(input\)\)/);
  assert.match(CSS, /\.tableActionToolbar>input\[type=search\]\{[\s\S]*?flex:0 1 var\(--tb-search-width,230px\);[\s\S]*?max-width:min\(var\(--tb-search-width,230px\),520px\);/);
  assert.match(CSS, /\.tableActionToolbar>:not\(input\[type=search\]\):not\(\.tableToolbarActions\)\{flex:0 0 auto;\}/);
  assert.match(CSS, /\.tableActionToolbar \.tableToolbarActions>\*\{flex:0 0 auto;\}/);
});
