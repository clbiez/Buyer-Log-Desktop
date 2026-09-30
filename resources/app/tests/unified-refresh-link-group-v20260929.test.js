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
 * Korunan kusurlar:
 *  1) Ayrılan modül normalizasyonda gruba GERİ DÖNMEMELİ; gruba eklenen modül
 *     grubun filtresini gerçekten kullanmalı.
 *  2) Gruba katılan modülün kendi filtresi (ör. dar CP filtresi) KAYBOLMAMALI;
 *     gruptan tekrar ayrılınca geri gelmeli.
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

test('eski kayıt varsayılan grubu alır; CP varsayılan olarak ayrıdır ve filtresi korunur', () => {
  const asas = asasOf(setup());
  assert.deepEqual(asas.linkedTargets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(valuesOf(scopeOf(asas, 'cp')), ['LIC']);
  assert.equal(scopeOf(asas, 'orders').id, 'sc_link');
  // IAS gibi bağ kavramı olmayan rolde alan yazılmaz.
  const ias = db.replaceModelConnections([{ id: 'mc_ias', name: 'IAS', server: 's', catalog: 'c', role: 'antrepo', scopes: [{ id: 'x', targets: ['cp'], horizon: H(['S7']) }] }], null).items[0];
  assert.equal(ias.linkedTargets, undefined);
});

test('gruptan ayır: modül grubun filtresinin kopyasıyla kendi kapsamına çıkar ve kalıcı olarak ayrı kalır', () => {
  const next = apply(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'lfl', linked: false }));
  const asas = asasOf(next);
  assert.deepEqual(asas.linkedTargets, ['orders', 'backlog', 'priceanalysis']);
  const lfl = scopeOf(asas, 'lfl');
  assert.deepEqual(lfl.targets, ['lfl']);
  assert.deepEqual(valuesOf(lfl), ['S6', 'S7'], 'ayrılma anında veri kapsamı değişmez');
  assert.equal(scopeOf(asas, 'orders').id, 'sc_link', 'grup kimliğini korur');
  assert.notEqual(lfl.id, 'sc_link');
  // Kararlılık: yeniden normalleştirmek ayrılan modülü gruba geri katmaz.
  assert.deepEqual(asasOf(db.replaceModelConnections(next, null).items).scopes, asas.scopes);
});

test('gruba ekle: CP ortak filtreyi kullanır; kendi dar filtresi saklanır ve ayrılınca geri gelir', () => {
  const linked = apply(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'cp', linked: true }));
  const asas = asasOf(linked);
  assert.deepEqual(asas.linkedTargets, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.equal(scopeOf(asas, 'cp'), scopeOf(asas, 'orders'), 'CP grubun kapsamında (tek sorgu)');
  assert.deepEqual(valuesOf(scopeOf(asas, 'cp')), ['S6', 'S7']);
  assert.equal(scopeOf(asas, 'cp').id, 'sc_link');
  assert.deepEqual(asas.linkRestore.map(entry => entry.moduleId), ['cp']);

  const back = asasOf(apply(linkWriter.planLinkChange(linked, { sourceId: 'mc_asas', moduleId: 'cp', linked: false })));
  const cp = scopeOf(back, 'cp');
  assert.deepEqual(cp.targets, ['cp']);
  assert.deepEqual(valuesOf(cp), ['LIC'], 'CP\'nin eski filtresi geri geldi');
  assert.equal(cp.name, 'Lisans');
  assert.equal(cp.id, 'sc_cp');
  assert.deepEqual(back.linkRestore, []);
  assert.deepEqual(valuesOf(scopeOf(back, 'orders')), ['S6', 'S7']);
});

test('ayrılan modül geri eklenince grubun filtresine döner; değişiklik yoksa NO_CHANGE', () => {
  const split = apply(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'backlog', linked: false }));
  const again = asasOf(apply(linkWriter.planLinkChange(split, { sourceId: 'mc_asas', moduleId: 'backlog', linked: true })));
  assert.equal(scopeOf(again, 'backlog'), scopeOf(again, 'orders'));
  assert.equal(again.scopes.filter(scope => scope.targets.some(t => again.linkedTargets.includes(t))).length, 1);
  assert.equal(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'orders', linked: true }).code, 'NO_CHANGE');
  assert.equal(linkWriter.planLinkChange(setup(), { sourceId: 'nope', moduleId: 'cp', linked: true }).code, 'SOURCE_NOT_FOUND');
  assert.equal(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'intake', linked: true }).code, 'MODULE_NOT_FEEDABLE');
});

test('okuma modeli bağlı grubu ve modül beslemesinin bağ durumunu taşır; gidiş-dönüş eşitliği korunur', () => {
  const items = asasOf(apply(linkWriter.planLinkChange(setup(), { sourceId: 'mc_asas', moduleId: 'lfl', linked: false })));
  const model = readModel.build([items]);
  const source = model.sources.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(source.linkedModules, ['orders', 'backlog', 'priceanalysis']);
  assert.deepEqual(source.linkableModules, ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  const feed = id => model.modules.find(module => module.id === id).feeds.find(entry => entry.sourceId === 'mc_asas');
  assert.equal(feed('orders').linked, true);
  assert.equal(feed('lfl').linked, false);
  assert.equal(feed('lfl').linkable, true);
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
  assert.match(ROUTES, /dataManagementLinkWriter\.planLinkChange\(store\.items, \{ sourceId, moduleId, linked: body\.linked \}\)/);
  assert.match(ROUTES, /code: 'SOURCE_CHANGED'/);
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

test('Veri Yönetimi: bağlı grup tek panelde; modül ayrılabilir ve geri eklenebilir', () => {
  assert.match(DM, /\$\{linkGroupPanels\(\)\}<div class="dmModules">/);
  assert.match(DM, /data-link="\$\{esc\(source\.id\)\}:\$\{esc\(id\)\}" data-next="off"/);
  assert.match(DM, /data-link="\$\{esc\(source\.id\)\}:\$\{esc\(id\)\}" data-next="on"/);
  assert.match(DM, /fetch\('\/api\/data-management\/link'/);
  assert.match(DM, /expectedSourceRevision: source \? source\.revision : ''/);
  // Filtre düzenleyicide bağlı modül "yalnız bunu ayır" ile gruptan çıkabilir.
  assert.match(DM, /canSplit: true,\s*linked: feed\.linked === true,/);
  assert.match(DMF, /Yalnız \$\{context\.moduleLabel\} için ayır \(gruptan çıkar\)/);
});
