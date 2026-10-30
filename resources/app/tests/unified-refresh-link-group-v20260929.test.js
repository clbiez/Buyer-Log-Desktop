'use strict';

/* v20260929 — TEK YENİLEME MOTORU + DÜZENLENEBİLİR BAĞLI GRUP.
 *
 * Kullanıcı kararı:
 *   · "Diğer modülleri yenilemem CP'yi de yenilesin. Tek ortak bir yenileme
 *     motoru istiyorum."
 *   · "Diğer modülleri yenilediğimde genel filtre CP filtremin dışında kalırsa
 *     bunda uyarı versin."
 *   · "Hepsine veri gitsin, sayfalar hiç açılmamışsa bile veriyi alıp snapshot
 *     oluştursun. Sayfalar arasında gezerken beklemeyi minimuma indirelim."
 *   · "Hepsini tek filtreleme altına topla. Kullanıcı herhangi bir sayfayı bu
 *     linklemeden ayırmak isterse bunu yapabilsin. Veya geri ekleyebilsin."
 *
 * v20260930 — "Tek yenileme motoru" kararı GERİ ALINDI: CP yenilemesi 40 sn'den
 * ~200 sn'ye çıktı (en geniş filtre her yenilemenin süresini belirliyordu).
 * Yenileme artık filtre bağını izler (bkz. linked-refresh-horizon testi);
 * bağlı grup, CP kapsam denetimi ve ön-hazırlık bu dosyada korunur.
 *
 * v2026-10-30 — İKİ SABİT UFUK (kullanıcı kararı): "CP ayrı, diğer modüller
 * ayrı çalışacak. Diğer modüller yenilendiğinde CP de yenilensin." Grup
 * üyeliği artık düzenlenemez; ekle/ayır ucu LINK_FIXED ile reddeder.
 *
 * Korunan kusurlar:
 *  1) Grup normalizasyonda bölünmemeli; eski kayıttaki özel üyelik sabit gruba
 *     dönmeli (CP her zaman ayrı).
 *  2) Eskiden ayrı duran modülün kendi filtresi KAYBOLMAMALI; linkRestore'da
 *     saklanmalı ve Veri Yönetimi bunu söylemeli.
 *  3) CP gruptan ayrıyken genel filtre CP satırlarını kapsamıyorsa yenileme
 *     bunu sessizce geçmemeli.
 *  4) Açık olmayan sayfalar yenileme sonrası beklemeden açılabilmeli, ama
 *     görünmeyen ekran çizilmemeli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-unified-refresh-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const scopes = require('../server/lib/model-scopes');
const linkWriter = require('../server/lib/data-domain/link-writer');
const readModel = require('../server/lib/data-domain/read-model');
const adapter = require('../server/lib/data-domain/legacy-adapter');
const cpCoverage = require('../server/lib/cp-coverage');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const APP = read('public/app-main.js');
const DM = read('public/data-management.js');
const DMF = read('public/data-management-filter.js');
const ANALYTICS = read('public/price-supplier-analysis.js');
const ROUTES = read('server/routes/horizon-template-routes.js');
const SERVER = read('server/server.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const H = values => ({ table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] });
const valuesOf = scope => scope.horizon.groups[0].conditions[0].values;

function setup() {
  return db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [
      { id: 'sc_cp', name: 'Lisans', targets: ['cp'], enabled: true, horizon: H(['LIC']) },
      { id: 'sc_link', name: 'Orders horizon', targets: ['orders', 'backlog', 'lfl', 'priceanalysis'], enabled: true, horizon: H(['S6', 'S7']) },
    ],
  }], null).items;
}
const asasOf = items => items.find(item => item.id === 'mc_asas');
const scopeOf = (item, target) => item.scopes.find(scope => scope.targets.includes(target));
const apply = plan => { assert.equal(plan.ok, true, plan.message); return db.replaceModelConnections(plan.items, null).items; };

test('eski kayıt sabit grubu alır; CP ayrıdır ve filtresi korunur; IAS de iki ufka ayrılır', () => {
  const asas = asasOf(setup());
  assert.deepEqual(asas.linkedTargets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(valuesOf(scopeOf(asas, 'cp')), ['LIC']);
  assert.equal(scopeOf(asas, 'orders').id, 'sc_link');
  assert.deepEqual(asas.linkRestore, [], 'değişmeyen kayıtta saklanacak bir şey yok');
  // v2026-10-30: IAS de sabit gruba sahiptir (Siparişler · Backlog); CP ayrıdır.
  const ias = db.replaceModelConnections([{ id: 'mc_ias', name: 'IAS', server: 's', catalog: 'c', role: 'antrepo', scopes: [{ id: 'x', targets: ['cp'], horizon: H(['S7']) }] }], null).items[0];
  assert.deepEqual(ias.linkedTargets, ['orders', 'backlog']);
  assert.deepEqual(scopeOf(ias, 'cp').targets, ['cp']);
  assert.deepEqual(valuesOf(scopeOf(ias, 'orders')), ['S7'], 'eksik Siparişler beslemesi CP ufkunun kopyasıyla kurulur');
});

test('ekle / ayır artık yapılmaz: link ucu LINK_FIXED döner ve kaydı değiştirmez', () => {
  const items = setup();
  for (const request of [
    { sourceId: 'mc_asas', moduleId: 'lfl', linked: false },
    { sourceId: 'mc_asas', moduleId: 'cp', linked: true },
  ]) {
    const plan = linkWriter.planLinkChange(items, request);
    assert.equal(plan.ok, false);
    assert.equal(plan.code, 'LINK_FIXED');
    assert.equal(plan.items, items);
  }
  assert.equal(linkWriter.planLinkChange(items, { sourceId: 'nope', moduleId: 'cp', linked: true }).code, 'SOURCE_NOT_FOUND');
});

test('eski düzenlenmiş üyelik sabit gruba döner: ayrılmış LFL katılır ve eski filtresi saklanır', () => {
  const asas = asasOf(db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    linkedTargets: ['orders', 'backlog', 'priceanalysis'],
    scopes: [
      { id: 'sc_cp', name: 'Lisans', targets: ['cp'], enabled: true, horizon: H(['LIC']) },
      { id: 'sc_link', name: 'Orders horizon', targets: ['orders', 'backlog', 'priceanalysis'], enabled: true, horizon: H(['S6', 'S7']) },
      { id: 'sc_lfl', name: 'LFL Kendi', targets: ['lfl'], enabled: true, horizon: H(['S5']) },
    ],
  }], null).items);
  assert.deepEqual(asas.linkedTargets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.equal(scopeOf(asas, 'lfl'), scopeOf(asas, 'orders'), 'LFL grubun kapsamında (tek sorgu)');
  assert.deepEqual(valuesOf(scopeOf(asas, 'lfl')), ['S6', 'S7'], 'çoğunluğun ufku kazanır');
  const stash = asas.linkRestore.find(entry => entry.moduleId === 'lfl');
  assert.ok(stash, 'LFL\'in kendi filtresi kaybolmamalı');
  assert.equal(stash.scopeName, 'LFL Kendi');
  assert.deepEqual(stash.horizon.groups[0].conditions[0].values, ['S5']);
  assert.deepEqual(valuesOf(scopeOf(asas, 'cp')), ['LIC']);
  // Kararlılık: yeniden kaydetmek saklananı çoğaltmaz, grubu bölmez.
  const again = asasOf(db.replaceModelConnections([asas], null).items);
  assert.deepEqual(again.scopes, asas.scopes);
  assert.deepEqual(again.linkRestore, asas.linkRestore);
});

test('eski kayıtta gruba eklenmiş CP ayrılır ama veri kapsamı geçiş anında değişmez', () => {
  const asas = asasOf(db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    linkedTargets: ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'],
    linkRestore: [{ moduleId: 'cp', scopeId: 'sc_cp', scopeName: 'Lisans', horizon: H(['LIC']), parkedAt: '2026-10-01T00:00:00.000Z' }],
    scopes: [{ id: 'sc_link', name: 'Orders horizon', targets: ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'], enabled: true, horizon: H(['S6', 'S7']) }],
  }], null).items);
  assert.deepEqual(scopeOf(asas, 'cp').targets, ['cp'], 'CP kendi ufkunda');
  assert.deepEqual(valuesOf(scopeOf(asas, 'cp')), ['S6', 'S7'], 'CP\'nin verisi geçiş anında değişmez');
  assert.ok(asas.linkRestore.some(entry => entry.moduleId === 'cp'), 'CP\'nin eski dar filtresi saklı kalır');
});

test('okuma modeli iki sabit ufku ve ortak ufka katılan eski filtreleri taşır; gidiş-dönüş eşitliği korunur', () => {
  const items = asasOf(db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [
      { id: 'sc_cp', name: 'Lisans', targets: ['cp'], enabled: true, horizon: H(['LIC']) },
      { id: 'sc_link', name: 'Orders horizon', targets: ['orders', 'backlog', 'priceanalysis'], enabled: true, horizon: H(['S6', 'S7']) },
      { id: 'sc_lfl', name: 'LFL Kendi', targets: ['lfl'], enabled: true, horizon: H(['S5']) },
    ],
  }], null).items);
  const model = readModel.build([items]);
  const source = model.sources.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(source.linkedModules, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(source.linkableModules, ['orders', 'backlog', 'lfl', 'priceanalysis'], 'gruba eklenebilecek başka modül yok');
  assert.deepEqual(model.horizonGroups, [{ id: 'cp', targets: ['cp'] }, { id: 'linked', targets: ['orders', 'backlog', 'lfl', 'priceanalysis'] }]);
  assert.deepEqual(model.mergedFilters.map(entry => [entry.moduleId, entry.filterName]), [['lfl', 'LFL Kendi']]);
  const feed = id => model.modules.find(module => module.id === id).feeds.find(entry => entry.sourceId === 'mc_asas');
  assert.equal(feed('orders').linked, true);
  assert.equal(feed('lfl').linked, true);
  assert.equal(feed('cp').linked, false);
  const round = adapter.toLegacy(adapter.fromLegacy([items]))[0];
  assert.deepEqual(round.linkedTargets, items.linkedTargets);
  assert.deepEqual(round.linkRestore, items.linkRestore);
});

test('CP kapsam denetimi gerçek satırları karşılaştırır; CP gruptaysa denetlenmez', () => {
  const general = [{ ocode: 1001, colour: 'Red' }, { ocode: 1002, colour: 'Blue' }];
  const cp = [{ ocode: '1001', colour: 'red' }, { ocode: 2001, colour: 'Blue' }, { ocode: 2001, colour: 'Navy' }];
  const result = cpCoverage.assessRefresh({ cp, orders: general }, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.equal(result.generalTarget, 'orders');
  assert.equal(result.outsideCount, 2);
  assert.equal(result.outsideOrderCount, 1);
  assert.deepEqual(result.sampleOrderCodes, ['2001']);
  assert.match(cpCoverage.warningText(result), /Genel \(bağlı modüller\) filtresi CP filtrenizi kapsamıyor/);
  assert.equal(cpCoverage.assessRefresh({ cp: general, orders: general }, ['orders']).outsideCount, 0);
  assert.equal(cpCoverage.assessRefresh({ cp, orders: general }, ['cp', 'orders']), null, 'CP gruptaysa aynı filtreyi kullanır');
  assert.equal(cpCoverage.warningText(cpCoverage.assessRefresh({ cp: [], orders: general }, ['orders'])), '');
});

test('sunucu: yenileme CP kapsamını denetler, sonucu yeniler ve bağlı grup ucu kaynak sürümüyle korunur', () => {
  assert.match(SERVER, /cpCoverageResult = asasItem \? cpCoverage\.assessRefresh\(mergedOrders\.asasOrdersByTarget, linkedTargetsOf\(asasItem\)\) : null;/);
  assert.match(SERVER, /cpCoverage: staged\.cpCoverage && staged\.cpCoverage\.outsideCount \?/);
  assert.match(ROUTES, /app\.post\('\/api\/data-management\/link', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(ROUTES, /await sourceWorkflowService\.update\('link', \{ sourceId, moduleId, linked: body\.linked \}, String\(body\.expectedSourceRevision/);
  const nativeService=read('server/lib/source-workflow-service.js');
  assert.match(nativeService, /link:link\.planLinkChange/);
  assert.match(nativeService, /throw fail\('SOURCE_CHANGED'\)/);
  assert.match(nativeService, /db\.mutateModelConnections\(async lease/);
  assert.deepEqual(scopes.REFRESH_TARGETS, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
});

test('istemci: yenileme sonrası açık olmayan sayfalar çizilmeden arka planda hazırlanır', () => {
  const prewarm = APP.slice(APP.indexOf('function scheduleRefreshPrewarm(targets){'), APP.indexOf('function notifyCpCoverage('));
  assert.match(prewarm, /\['cp',\(\)=>state\.cp\?true:ensureCpLoaded\(\{reason:'prewarm'\}\)\]/);
  assert.match(prewarm, /\['orders',\(\)=>state\.orders\?true:ensureOrdersLoaded\(\)\]/);
  assert.match(prewarm, /\['backlog',\(\)=>backlogLoadedOnce\?true:prefetchBacklogForRefresh\(\)\]/);
  assert.match(prewarm, /window\.BLPriceSupplierAnalysis\?\.prepareInBackground\?\.\(\)/);
  // Açık sekme ve yetkisiz alan atlanır; yeni bir yenileme ön-hazırlığı keser.
  assert.match(prewarm, /if\(!refreshed\.includes\(area\)\|\|!canAccess\(area\)\|\|currentActiveTab\(\)===area\)continue;/);
  // v20260930 — Yalnız bu yenilemenin kapsadığı sayfalar hazırlanır (CP yenilemesi LFL'i belleğe almaz).
  assert.match(prewarm, /const refreshed=Array\.isArray\(targets\)&&targets\.length\?targets:ALL_REFRESH_TARGETS;/);
  assert.match(prewarm, /token!==refreshPrewarmToken\|\|isRefreshRunning\(\)/);
  assert.match(APP, /refreshPrewarmToken\+\+;/);
  // Görünmeyen CP/Siparişler çizilmez: renderCP/renderOrders ertelenmiş çizimdir.
  assert.match(APP, /function renderCP\(\)\{ deferRenderForTab\('cp'\); \}/);
  // Backlog ön yanıtı yalnız aynı sorgu anahtarı ve kısa süre için kullanılır.
  const current = APP.slice(APP.indexOf('function fetchCurrentBacklog(){'), APP.indexOf('function fetchCurrentBacklog(){') + 600);
  assert.match(current, /ready\.key===backlogQueryString\(params\)&&Date\.now\(\)-ready\.at<BACKLOG_PREFETCH_MAX_AGE_MS/);
  assert.match(APP, /async function fetchBacklog\(params\)\{\s*backlogPrefetch=null;/);
  // Fiyat & Üretici: kök yokken DOM çizilmez, ilk girişte hazır küme kullanılır.
  assert.match(ANALYTICS, /async function prepareInBackground\(\)\{\s*if\(root&&root\.dataset\.initialized\)\{invalidate\(\);return;\}/);
  assert.match(ANALYTICS, /if\(prefetched&&!loading\)\{prefetched=false;render\(\);return;\}/);
  assert.match(ANALYTICS, /function render\(\)\{\s*if\(!root\)return;/);
});

test('istemci: genel filtre CP\'yi kapsamıyorsa yenileme bitince açıkça uyarır', () => {
  const notify = APP.slice(APP.indexOf('function notifyCpCoverage(result){'), APP.indexOf('function notifyCpCoverage(result){') + 1200);
  assert.match(notify, /const coverage=result&&result\.cpCoverage;/);
  assert.match(notify, /genel filtre CP filtrenizi kapsamıyor/);
});

test('Veri Yönetimi: iki ufuk tek panelde (Horizon ve yenileme); ekle/ayır ve gruplar yok', () => {
  assert.match(DM, /\$\{horizonPanel\(\)\}/);
  assert.match(DM, /data-refresh-horizon="\$\{esc\(group\.id\)\}"/);
  assert.match(DM, /data-horizon-slot="\$\{esc\(group\.id\)\}"/);
  assert.match(DM, /model\.horizonGroups/);
  assert.match(DM, /model\.mergedFilters/);
  assert.doesNotMatch(DM, /data-link=|linkGroupPanels|fetch\('\/api\/data-management\/link'/);
  assert.doesNotMatch(DM, /canSplit: true/);
  assert.doesNotMatch(DMF, /data-save="split"|gruptan çıkar/);
  // Otomatik yenileme ve kaynak izleme aynı panelde kalır.
  const panel = DM.slice(DM.indexOf('function horizonPanel()'), DM.indexOf('function refreshHorizon('));
  assert.match(panel, /refreshSettings\(\)/);
  assert.match(DM, /id="autoRefreshSelect"/);
  assert.match(DM, /id="sourceWatchToggle"/);
});
