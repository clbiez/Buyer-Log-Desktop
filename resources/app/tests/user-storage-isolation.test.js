'use strict';

/* AYNI BİLGİSAYARDA BİRDEN FAZLA KULLANICI (kullanıcı bildirimi).

   Farklı bir profille giriş yapınca filtreler birbirine karışıyordu. Sebep:
   BLStorage yalnız listelenmiş önekleri kullanıcıya ayırıyordu; hızlı filtre
   grupları, koleksiyon hızlı boyutları, hesaplanan sütunlar, Excel içe aktarma
   profilleri, sütun genişlikleri gibi anahtarlar ortak localStorage anahtarına
   yazılıyor ve cihazdaki bütün profiller aynı değeri okuyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '../public');
const storageSource = fs.readFileSync(path.join(PUBLIC, 'user-storage.js'), 'utf8');

function nativeStore(values = new Map()) {
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
}

function boot(native, userId) {
  const window = { localStorage: native, BL_USER_CONTEXT: { id: userId, displayName: userId } };
  // Sunucu eşitlemesi test dışında: fetch hiç çözülmez.
  vm.runInNewContext(storageSource, { window, fetch: () => new Promise(() => {}) });
  return window.BLStorage;
}

// Kullanıcı tercihi olup daha önce ortak anahtara yazılan örnekler.
const PERSONAL_KEYS = [
  'bl.quickFilterGroups.cp.v1',
  'lcw.collection.quickDims.v1',
  'bl.formulaColumns.cp.v1',
  'bl.excelImport.profiles.orders.v1',
  'lcw.tableColWidth.oab.pivot.v1',
  'lcw.priceSupplierAnalysis.v3',
  'lcw.pricingHistory.columns.v1',
  'lcw.priceHistory.mfrOrder.v1',
  'lcw.orders.imageSize.v2',
  'lcw.koleksiyon.imageSize.v2',
  'lcw.koleksiyon.modelGroups.view.v1',
  'lcw.lfl.analysisHeights.v1',
  'lcw.backlog.radar.layout.v1',
  'lcw.backlog.chart.v1',
  'bl.backlog.excelFormulas.v1',
  'buyerlog.shipCompare.order.v1',
  'buyerlog.shipCompare.hidden.v1',
  'buyerlog.shipCompare.colWidths.v1',
  'buyerlog.overview.worldClocks.v1',
  'buyerlog.overview.worldClocks.display.v1',
  'buyerlog.detailDrawer.columns.cp',
  'buyerlog.detailDrawer.width.cp',
  'buyerlog.backlog.detail.compact.v1',
  'buyerlog.outlook.notifications.seen.v1',
  'buyerlog.endeksmatikClipboard.v1',
  'buyerlog.fx.pending.v1',
  'lcw.dashboard.layout.v1',
  'lcw.favorites.cp.v1',
  'blPlmSyncColumnChoice',
];

test('kişisel filtre ve görünüm anahtarları her profilin kendi alanına yazılır', () => {
  const native = nativeStore();
  const ayse = boot(native, 'ayse');
  PERSONAL_KEYS.forEach(key => ayse.setItem(key, `ayse:${key}`));

  const mehmet = boot(native, 'mehmet');
  PERSONAL_KEYS.forEach(key => {
    assert.equal(mehmet.getItem(key), null, `${key} başka profile sızmamalı`);
    assert.match(mehmet.actualKey(key), /^bl\.user\.mehmet\./, key);
  });
  mehmet.setItem('bl.quickFilterGroups.cp.v1', 'mehmet');

  const ayseAgain = boot(native, 'ayse');
  PERSONAL_KEYS.forEach(key => assert.equal(ayseAgain.getItem(key), `ayse:${key}`, key));
  assert.equal(boot(native, 'mehmet').getItem('bl.quickFilterGroups.cp.v1'), 'mehmet');
});

test('sunucuda kullanıcıya bağlı eşitlenen her önek tarayıcıda da kullanıcıya ayrılır', () => {
  const storage = boot(nativeStore(), 'ayse');
  assert.ok(Array.isArray(storage.syncedPrefixes) && storage.syncedPrefixes.length > 10);
  storage.syncedPrefixes.forEach(prefix => {
    assert.equal(storage.isUserScoped(`${prefix}probe`), true, `${prefix} eşitleniyor ama ortak anahtara yazılıyor`);
  });
});

test('eski ortak kayıt yalnız ilk açan profile taşınır ve ortak kopya silinir', () => {
  const native = nativeStore(new Map([
    ['bl.quickFilterGroups.cp.v1', '{"hidden":["pri"]}'],
    ['lcw.collection.quickDims.v1', '["Season"]'],
    ['bl.user.ayse.lcw.collection.quickDims.v1', '["Buyer"]'],
    // Paylaşılan iş verisi aynaları ve cihaz anahtarları olduğu gibi kalır.
    ['lcw.quotations.v1', '{"requests":[]}'],
    ['buyerlog.lastSuccessfulUsername', 'ayse'],
  ]));
  const ayse = boot(native, 'ayse');
  assert.equal(ayse.getItem('bl.quickFilterGroups.cp.v1'), '{"hidden":["pri"]}');
  assert.equal(ayse.getItem('lcw.collection.quickDims.v1'), '["Buyer"]', 'kişisel değer ezilmemeli');
  assert.equal(native.values.has('bl.quickFilterGroups.cp.v1'), false);
  assert.equal(native.values.has('lcw.collection.quickDims.v1'), false);
  assert.equal(native.values.get('lcw.quotations.v1'), '{"requests":[]}');
  assert.equal(native.values.get('buyerlog.lastSuccessfulUsername'), 'ayse');

  const mehmet = boot(native, 'mehmet');
  assert.equal(mehmet.getItem('bl.quickFilterGroups.cp.v1'), null);
  assert.equal(mehmet.getItem('lcw.collection.quickDims.v1'), null);
});

test('kullanıcı kimliği yokken eski kayıt sahiplenilmez', () => {
  const native = nativeStore(new Map([['bl.quickFilterGroups.cp.v1', 'x']]));
  const window = { localStorage: native };
  vm.runInNewContext(storageSource, { window, fetch: () => new Promise(() => {}) });
  assert.equal(native.values.get('bl.quickFilterGroups.cp.v1'), 'x');
  assert.equal(native.values.has('bl.user.anonymous.bl.quickFilterGroups.cp.v1'), false);
});

test('BLStorage ile okunan her ön ek ya kullanıcıya ayrılır ya da bilinçli olarak cihaz/ortak kalır', () => {
  /* Yeni bir tercih anahtarı eklendiğinde user-storage.js listesine eklenmeyi
     unutmasın. Ortak kalan anahtarlar paylaşılan iş verisinin yerel aynası
     veya bir defalık taşıma işaretidir; kullanıcı tercihi değildir. */
  const SHARED_ON_PURPOSE = [
    'bl.user.', 'bl.presetShare.notice',
    'lcw.quotations.v1', 'lcw.quotations.serverMigrated.', 'lcw.quotations.dropDetached.', 'lcw.quotations.notebookDetached.',
    'lcw.transitRules.', 'lcw.transitAnalysis.v1', 'lcw.suppFobPricingRules.', 'lcw.nonDtrManufacturers.',
    'lcw.emailGroups.centralMigration.', 'lcw.appr.dimFilters.',
    'buyerlog.lastSuccessfulUsername', 'buyerlog.bootRetry.',
    // Açılış perdesi kullanıcı bilinmeden çalışır: görülen bilgi kartları cihaz düzeyindedir.
    'bl.trivia.',
    // Ortak PLM numune verisinin arka plan tazeleme zamanı (24 saat kısıtı); tercih değil.
    'lcw.cp.plmSamples.autoRefreshAt',
    // Koleksiyon SAHİBİNİN kimliğiyle anahtarlanan ortak iş verisi önbelleği.
    'bl.collection.workspace.', 'bl.collection.pending.',
  ];
  const storage = boot(nativeStore(), 'ayse');
  const files = fs.readdirSync(PUBLIC).filter(name => name.endsWith('.js'));
  const offenders = new Set();
  files.forEach(name => {
    const source = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    const pattern = /['"`]((?:lcw|bl|buyerlog)\.[A-Za-z][A-Za-z0-9_.-]*)/g;
    let match;
    while ((match = pattern.exec(source))) {
      const key = match[1];
      if (SHARED_ON_PURPOSE.some(prefix => key.startsWith(prefix))) continue;
      if (!storage.isUserScoped(key)) offenders.add(`${name}: ${key}`);
    }
  });
  assert.deepEqual([...offenders], []);
});

test('PLM eşitleme sütun seçimi ham localStorage yerine BLStorage kullanır', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app-main.js'), 'utf8');
  const start = app.indexOf('function kolPlmSyncLoadColumnChoice');
  const body = app.slice(start, app.indexOf('function', start + 60) + 400);
  assert.doesNotMatch(body, /[^.]localStorage\.(get|set)Item\(KOL_PLM_SYNC_COLUMN_CHOICE_KEY/);
  assert.match(body, /BLStorage\.getItem\(KOL_PLM_SYNC_COLUMN_CHOICE_KEY/);
});
