'use strict';

/* v20260928 — BAĞLI YENİLEME VE UFUK.
 *
 * Kullanıcı kararı: Orders, Price & Supplier Analysis, LFL Analysis ve Backlog
 * sayfalarının yenileme komutu ve horizonları birbirine bağlı olsun; tek
 * yenilemeyle hepsine veri gitsin, her sayfaya ayrı yenileme konmasın.
 *
 * Korunan kusurlar:
 *
 * 1) AYRIK UFUK. Bağlı sayfalar ayrı kapsamlarda (ayrı sorgularda) kalırsa aynı
 *    sipariş bir sayfada var, ötekinde yok görünür. ASAS'ta dördü tek kapsamda
 *    durmalı; CP ise v4.71 kararı gereği ayrı kalmalı.
 * 2) SESSİZ DARALMA. Eski ayrık kayıtlar birleşirken en çok sayfanın kullandığı
 *    ufuk kazanmalı; aksi hâlde birleşme gereğinden fazla sayfanın verisini değiştirir.
 * 3) YARIM YENİLEME. Gruptan tek sayfa istenirse (istemci, sunucu, yenileme
 *    grupları, otomasyon) dördü birlikte yenilenmeli; yalnız birini yayınlamak
 *    sayfaları farklı anlık görüntülerde bırakırdı.
 * 4) BAYAT EKRAN. Yenileme açık olmayan Backlog'u ve Fiyat & Üretici Analizi'ni
 *    eski veriyle bırakmamalı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-linked-refresh-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const scopes = require('../server/lib/model-scopes');
const { normalizeHorizon } = require('../server/lib/modelHorizon');
const prefs = require('../server/lib/user-preferences');
const refreshGroups = require('../server/lib/data-domain/refresh-groups');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const APP = read('public/app-main.js');
const LFL = read('public/lfl.js');
const HTML = read('public/index.html');
const ANALYTICS = read('public/price-supplier-analysis.js');
const SERVER = read('server/server.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const LINKED = ['orders', 'backlog', 'lfl', 'priceanalysis'];
const H = values => ({ table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] });
const valuesOf = scope => scope.horizon.groups[0].conditions[0].values;
const linkedScopes = list => list.filter(scope => scope.targets.some(target => LINKED.includes(target)));

test('ASAS: eski ayrık kayıt tek bağlı kapsama birleşir, CP ayrı kalır ve normalizasyon kararlıdır', () => {
  const raw = [
    { id: 'core', name: 'Core', targets: ['cp', 'backlog', 'lfl', 'priceanalysis'], horizon: H(['S7']) },
    { id: 'ord', name: '', targets: ['orders'], horizon: H(['W1']) },
  ];
  const out = scopes.normalizeScopes(raw, 'asas', {}, normalizeHorizon);
  const linked = linkedScopes(out);
  assert.equal(linked.length, 1, 'bağlı modüller tek kapsamda olmalı (tek sorgu)');
  assert.deepEqual(linked[0].targets.slice().sort(), LINKED.slice().sort());
  // Üç sayfa S7, Orders W1 kullanıyordu: çoğunluğun ufku kazanır.
  assert.deepEqual(valuesOf(linked[0]), ['S7']);
  const cp = out.find(scope => scope.targets.includes('cp'));
  assert.deepEqual(cp.targets, ['cp']);
  assert.equal(cp.id, 'core', 'CP kapsamı kimliğini korur');
  assert.notEqual(linked[0].id, cp.id, 'ayrılan grup kaynak kapsamın kimliğini kopyalamaz');
  assert.deepEqual(scopes.normalizeScopes(out, 'asas', {}, normalizeHorizon), out, 'ikinci normalizasyon bir şey değiştirmemeli');
});

test('ASAS: oylama kapsam değil ufuk üzerindendir; eşitlikte Orders önce gelir', () => {
  const byVote = scopes.normalizeScopes([
    { id: 'core', targets: ['cp', 'backlog'], horizon: H(['LIC']) },
    { id: 'lfl', targets: ['lfl'], horizon: H(['S6', 'S7']) },
    { id: 'ord', targets: ['orders'], horizon: H(['LIC']) },
  ], 'asas', {}, normalizeHorizon);
  const linked = linkedScopes(byVote)[0];
  assert.deepEqual(valuesOf(linked), ['LIC'], 'Backlog + Orders aynı ufku kullanıyordu');
  assert.equal(linked.id, 'ord', 'yalnız bağlı sayfalardan oluşan kapsam kimliğini korur');

  const tie = scopes.normalizeScopes([
    { id: 'lfl', targets: ['lfl'], horizon: H(['S6']) },
    { id: 'ord', targets: ['orders'], horizon: H(['W1']) },
  ], 'asas', {}, normalizeHorizon);
  assert.deepEqual(valuesOf(linkedScopes(tie)[0]), ['W1']);
});

test('ASAS: kapatılmış (park edilmiş) bağlı besleme geri doğmaz', () => {
  const out = scopes.normalizeScopes([
    { id: 'core', targets: ['cp', 'orders', 'backlog'], horizon: H(['S7']) },
  ], 'asas', {}, normalizeHorizon, ['priceanalysis']);
  assert.ok(!out.some(scope => scope.targets.includes('priceanalysis')));
  assert.deepEqual(linkedScopes(out)[0].targets, ['orders', 'backlog']);
});

test('IAS (antrepo) eski Orders ayrıştırma kuralıyla devam eder', () => {
  const out = scopes.normalizeScopes([
    { id: 'mixed', targets: ['cp', 'orders', 'backlog'], horizon: H(['S7']) },
  ], 'antrepo', {}, normalizeHorizon);
  assert.deepEqual(out.find(scope => scope.targets.includes('orders')).targets, ['orders']);
  assert.deepEqual(out.find(scope => scope.targets.includes('cp')).targets, ['cp', 'backlog']);
});

/* v20260930 — TEK MOTOR GERİ ALINDI. Kullanıcı: "CP yenilemek 40 sn sürerken
   şimdi 200'e yanaştı." Yenileme filtre bağını izler: bağlı gruptaki bir sayfa
   grubu (tek sorgu) birlikte yeniler; gruptan ayrı sayfa (varsayılan CP) yalnız
   kendini. En geniş filtre dar CP yenilemesinin süresini belirlememeli. */
test('yenileme hedefleri: bağlı grup birlikte, gruptan ayrı CP tek başına', () => {
  const ALL = ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'];
  assert.deepEqual(scopes.withRefreshTargets(['lfl']).slice().sort(), LINKED.slice().sort());
  assert.deepEqual(scopes.withRefreshTargets(['cp']), ['cp'], 'dar CP yenilemesi geniş grubu çalıştırmaz');
  assert.deepEqual(scopes.withRefreshTargets(['cp', 'orders', 'cp']).slice().sort(), ALL.slice().sort());
  assert.deepEqual(scopes.withRefreshTargets([]), [], 'boş liste boş kalır; varsayılanı çağıran uygular');
  // Üyelik düzenlenebilir: kayıttaki gerçek grup esas alınır.
  assert.deepEqual(scopes.withRefreshTargets(['cp'], ['cp', 'orders']).slice().sort(), ['cp', 'orders']);
  assert.deepEqual(scopes.withRefreshTargets(['backlog'], ['orders', 'lfl']), ['backlog'], 'gruptan ayrılan sayfa tek başına');
  assert.equal(scopes.withLinkedTargets, scopes.withRefreshTargets, 'eski ad aynı kuralı çağırır');
  assert.deepEqual(refreshGroups.targetsFor([{ id: 'g', name: 'G', moduleIds: ['backlog'] }], 'g'), LINKED);
  assert.deepEqual(scopes.REFRESH_TARGETS, ALL, '"Tümünü yenile" kapsamı');
});

test('sunucu: /api/refresh, performRefresh ve loadFromModels (LFL yolu dahil) kayıttaki bağlı grupla genişletir', () => {
  assert.match(SERVER, /const \{ withRefreshTargets, linkedTargetsOf \} = require\('\.\/lib\/model-scopes'\);/);
  const config = SERVER.slice(SERVER.indexOf('function configuredRefreshMembers()'), SERVER.indexOf('const cpCoverage'));
  assert.match(config, /linkedTargetsOf\(asasItem\)/);
  assert.match(config, /withRefreshTargets\(targets, configuredRefreshMembers\(\)\)/);
  assert.match(SERVER, /const targets = rawTargets \? refreshTargetsFor\(/);
  const perform = SERVER.slice(SERVER.indexOf('async function performRefresh('), SERVER.indexOf('async function performRefresh(') + 400);
  assert.match(perform, /targets = refreshTargetsFor\(targets\)/);
  const load = SERVER.slice(SERVER.indexOf('async function loadFromModels('), SERVER.indexOf('async function loadFromModels(') + 800);
  assert.match(load, /targets = refreshTargetsFor\(targets\)/);
  assert.doesNotMatch(SERVER, /withLinkedTargets/);
  // Son yenilemenin kapsadığı sayfalar saklanır: "son yenileme" saati sekme açılışında da görünür.
  assert.match(SERVER, /targets: requestedTargets\.slice\(\),/);
  // Kısmi yenilemede dokunulmayan sayfaların kapsam/ufuk rozeti boşalmaz.
  assert.match(SERVER, /const kept = previous\.filter\(entry => entry && entry\.target && !requestedTargets\.includes\(entry\.target\)\);/);
  assert.match(SERVER, /\.\.\.\(result\.partialTargets && runtime\.modelRefresh && runtime\.modelRefresh\.appliedHorizons/);
});

test('kişisel/rol ufku bağlı grubu yeniden bölmez', () => {
  prefs.saveHorizon('user-linked', 'lfl', H(['S5']), { connectionId: 'asas-main', role: 'asas' });
  const items = prefs.applyHorizonOverrides([{
    id: 'asas-main', role: 'asas',
    scopes: [
      { id: 'cp-scope', targets: ['cp'], horizon: H(['S7']) },
      { id: 'linked-scope', targets: LINKED.slice(), horizon: H(['S7']) },
    ],
  }], 'user-linked', ['orders']);
  const linked = linkedScopes(items[0].scopes);
  assert.equal(linked.length, 1, 'tek sayfaya ait kişisel ufuk grubu ikiye bölmemeli');
  assert.deepEqual(linked[0].targets, LINKED);
  assert.deepEqual(valuesOf(linked[0]), ['S5']);
  assert.deepEqual(valuesOf(items[0].scopes.find(scope => scope.targets.includes('cp'))), ['S7']);
});

test('istemci: sayfa düğmeleri yalnız kendi sayfasını ister; menü filtre bağına göre satır üretir', () => {
  assert.match(APP, /const ALL_REFRESH_TARGETS=Object\.freeze\(\['cp','orders','backlog','lfl','priceanalysis'\]\);/);
  assert.match(APP, /const DEFAULT_LINKED_REFRESH_TARGETS=Object\.freeze\(\['orders','backlog','lfl','priceanalysis'\]\);/);
  // Menü üyeliği son yenileme snapshot'ından değil güncel ASAS kaydından okunur.
  assert.match(APP, /async function syncLinkedRefreshMembers\(\)/);
  assert.match(APP, /fetch\('\/api\/refresh-targets',\{cache:'no-store'\}\)/);
  const refreshConfig=APP.slice(APP.indexOf('function linkedRefreshMembers(){'),APP.indexOf('function withLinkedRefreshTargets'));
  assert.doesNotMatch(refreshConfig, /state\.modelScopes|sharedFilter/);
  const load = APP.slice(APP.indexOf('async function loadFromServer(force, targets){'), APP.indexOf('async function loadFromServer(force, targets){') + 300);
  assert.match(load, /targets=withLinkedRefreshTargets\(targets\)/);
  // Menü: ayrı sayfa kendi satırı, bağlı grup tek satır, ayrıca "Tümünü yenile".
  const menu = APP.slice(APP.indexOf('function openTopRefreshMenu'), APP.indexOf('// Yenileme sürerken aynı düğmeye tekrar basmak'));
  assert.match(menu, /options\.push\(\['linked',refreshTargetsLabel\(members\),members\.slice\(\)\]\)/);
  assert.match(menu, /else options\.push\(\[target,refreshTargetsLabel\(\[target\]\),\[target\]\]\);/);
  assert.match(menu, /options\.push\(\['all',appLang==='en'\?'Refresh all':'Tümünü yenile',ALL_REFRESH_TARGETS\.slice\(\)\]\);/);
  assert.match(menu, /if\(option\)return loadFromServer\(true,option\[2\]\.slice\(\)\);/);
  // CP düğmesi yalnız CP'yi, Siparişler düğmesi Siparişler'i ister (grup sunucuda eklenir).
  for (const [id, target] of [['cpRefreshBtn', 'cp'], ['ordersRefreshBtn', 'orders']]) {
    const at = APP.indexOf(`document.getElementById('${id}')?.addEventListener('click'`);
    assert.ok(at > 0, id);
    assert.match(APP.slice(at, at + 220), new RegExp(`void loadFromServer\\(true,\\['${target}'\\]\\);`));
  }
  assert.match(APP, /window\.BLRunLinkedRefresh=function\(\)\{[\s\S]{0,160}loadFromServer\(true,\['lfl'\]\)/);
  assert.match(LFL, /lflRefreshBtn'\)\?\.addEventListener\('click',\(\)=>\{void refreshLinked\(\);\}\)/);
  assert.doesNotMatch(HTML, /tek yenileme|single refresh/);
  // Backlog ve Fiyat & Üretici'ye ayrı yenileme düğmesi eklenmedi.
  const backlog = HTML.slice(HTML.indexOf('id="view-backlog"'), HTML.indexOf('id="view-backlog"') + 4000);
  assert.doesNotMatch(backlog, /RefreshBtn/);
  const price = HTML.slice(HTML.indexOf('id="view-priceanalysis"'), HTML.indexOf('id="view-lfl"'));
  assert.doesNotMatch(price, /RefreshBtn/);
});

test('istemci: yenileme açık olmayan sayfaları bayat bırakmaz ve verilerini arka planda hazırlar', () => {
  const load = APP.slice(APP.indexOf('async function loadFromServer(force, targets){'), APP.indexOf('let sharedRevisionSnapshot'));
  assert.match(load, /backlogLoadedOnce=false;/);
  assert.match(load, /window\.BLPriceSupplierAnalysis\?\.invalidate\?\.\(\)/);
  assert.match(load, /if\(userVisibleRefresh\)\{\s*scheduleRefreshPrewarm\(targets\);\s*notifyCpCoverage\(data\.lastRefreshResult\);\s*\}/);
  // Sunucunun gerçek hedef listesi (düzenlenmiş grup) istemcinin tahminine eklenir.
  assert.match(load, /targets=\[\.\.\.new Set\(\[\.\.\.targets,\.\.\.serverRefreshTargets\.filter\(/);
  assert.match(ANALYTICS, /function invalidate\(\)\{prefetched=false;if\(!root\|\|!root\.dataset\.initialized\)return;datasetStale=true;if\(isVisible\(\)\)\{datasetStale=false;void prepare\(\);\}\}/);
  assert.match(ANALYTICS, /if\(root\.dataset\.initialized\)\{if\(datasetStale\)\{datasetStale=false;await prepare\(\);return;\}render\(\);return;\}/);
});

test('istemci: ufuk rozeti bağlı grubu ve son yenileme saatini gösterir', () => {
  const badge = APP.slice(APP.indexOf('function renderHorizonBadges(){'), APP.indexOf('function sourceFilterNoticeText'));
  assert.match(badge, /ALL_REFRESH_TARGETS\.includes\(target\)/);
  // "Bağlı" rozeti menüyle aynı güncel grup üyeliğine göre hesaplanır.
  assert.match(badge, /if\(linkedRefreshMembers\(\)\.includes\(target\)\)\{/);
  // Saat, sayfanın kendi yenileme kümesinin (grup ya da tek sayfa) en eskisidir.
  assert.match(badge, /refreshTargetsStamp\(withLinkedRefreshTargets\(\[target\]\)\)/);
  assert.match(APP, /function seedSourceStatusFromServer\(result\)/);
  assert.match(APP, /try\{seedSourceStatusFromServer\(data\.lastRefreshResult\);\}catch\(_\)\{\}/);
});
