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
const ANALYTICS = read('public/collection-analytics.js');
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

test('yenileme hedefleri: bağlı modüllerden biri istenirse hepsi eklenir, CP tek başına kalır', () => {
  assert.deepEqual(scopes.withLinkedTargets(['lfl']), ['lfl', 'orders', 'backlog', 'priceanalysis']);
  assert.deepEqual(scopes.withLinkedTargets(['cp']), ['cp']);
  assert.deepEqual(scopes.withLinkedTargets(['cp', 'orders', 'cp']), ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(refreshGroups.targetsFor([{ id: 'g', name: 'G', moduleIds: ['backlog'] }], 'g'), LINKED);
});

test('sunucu: /api/refresh, performRefresh ve loadFromModels (LFL yolu dahil) bağlı hedefleri genişletir', () => {
  assert.match(SERVER, /const \{ withLinkedTargets \} = require\('\.\/lib\/model-scopes'\);/);
  assert.match(SERVER, /const targets = rawTargets \? withLinkedTargets\(/);
  const perform = SERVER.slice(SERVER.indexOf('async function performRefresh('), SERVER.indexOf('async function performRefresh(') + 400);
  assert.match(perform, /targets = withLinkedTargets\(targets\)/);
  const load = SERVER.slice(SERVER.indexOf('async function loadFromModels('), SERVER.indexOf('async function loadFromModels(') + 800);
  assert.match(load, /targets = withLinkedTargets\(targets\)/);
  // Son yenilemenin kapsadığı sayfalar saklanır: "son yenileme" saati sekme açılışında da görünür.
  assert.match(SERVER, /targets: requestedTargets\.slice\(\),/);
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

test('istemci: tek yenileme — sayfa düğmeleri ve menü bağlı grubu birlikte yeniler', () => {
  assert.match(APP, /const LINKED_REFRESH_TARGETS=Object\.freeze\(\['orders','backlog','lfl','priceanalysis'\]\);/);
  const load = APP.slice(APP.indexOf('async function loadFromServer(force, targets){'), APP.indexOf('async function loadFromServer(force, targets){') + 300);
  assert.match(load, /targets=withLinkedRefreshTargets\(targets\)/);
  // Menüde bağlı sayfalar TEK satırdır; ayrı ayrı yenileme seçeneği yok.
  const menu = APP.slice(APP.indexOf('function openTopRefreshMenu'), APP.indexOf('// Yenileme sürerken aynı düğmeye tekrar basmak'));
  assert.match(menu, /const options=\[\['cp','CP'\],\['linked',linkedRefreshLabel\(\)\],\['all',/);
  assert.doesNotMatch(menu, /\['lfl','LFL'\]|\['backlog','Backlog'\]|\['priceanalysis',/);
  assert.match(menu, /if\(key==='linked'\)return loadFromServer\(true,\[\.\.\.LINKED_REFRESH_TARGETS\]\)/);
  // LFL'in ayrı yenilemesi yok: düğmesi ortak akışı çağırır.
  assert.match(APP, /window\.BLRunLinkedRefresh=function\(\)\{[\s\S]{0,160}loadFromServer\(true,\[\.\.\.LINKED_REFRESH_TARGETS\]\)/);
  assert.match(LFL, /lflRefreshBtn'\)\?\.addEventListener\('click',\(\)=>\{void refreshLinked\(\);\}\)/);
  assert.doesNotMatch(HTML, /LFL Verisini Yenile|Siparişleri Yenile/);
  // Backlog ve Fiyat & Üretici'ye ayrı yenileme düğmesi eklenmedi.
  const backlog = HTML.slice(HTML.indexOf('id="view-backlog"'), HTML.indexOf('id="view-backlog"') + 4000);
  assert.doesNotMatch(backlog, /RefreshBtn/);
  const price = HTML.slice(HTML.indexOf('id="view-priceanalysis"'), HTML.indexOf('id="view-lfl"'));
  assert.doesNotMatch(price, /RefreshBtn/);
});

test('istemci: yenileme açık olmayan Backlog ve Fiyat & Üretici Analizi ekranını bayat bırakmaz', () => {
  const load = APP.slice(APP.indexOf('async function loadFromServer(force, targets){'), APP.indexOf('let sharedRevisionSnapshot'));
  assert.match(load, /backlogLoadedOnce=false;/);
  assert.match(load, /window\.BLPriceSupplierAnalysis\?\.invalidate\?\.\(\)/);
  assert.match(ANALYTICS, /function invalidate\(\)\{if\(!root\|\|!root\.dataset\.initialized\)return;datasetStale=true;if\(isVisible\(\)\)\{datasetStale=false;void prepare\(\);\}\}/);
  assert.match(ANALYTICS, /if\(root\.dataset\.initialized\)\{if\(datasetStale\)\{datasetStale=false;await prepare\(\);return;\}render\(\);return;\}/);
});

test('istemci: ufuk rozeti bağlı grubu ve son yenileme saatini gösterir', () => {
  const badge = APP.slice(APP.indexOf('function renderHorizonBadges(){'), APP.indexOf('function sourceFilterNoticeText'));
  assert.match(badge, /LINKED_REFRESH_TARGETS\.includes\(target\)/);
  assert.match(badge, /linkedRefreshStamp\(\)/);
  assert.match(APP, /function seedSourceStatusFromServer\(result\)/);
  assert.match(APP, /try\{seedSourceStatusFromServer\(data\.lastRefreshResult\);\}catch\(_\)\{\}/);
});
