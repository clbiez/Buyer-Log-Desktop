'use strict';
/* WS6c (#1079) çizim paritesi: Backlog Genel Bakış (V3) paneli.
 *
 * public/backlog-overview.js eski sürümü (tests/fixtures/backlog-overview-ws6b.js,
 * main 222ea68'deki dosyanın birebir kopyası) ile yeni sürüm aynı sahte DOM'da,
 * aynı satırlarla çalıştırılır:
 *   - eski: /api/backlog-export satırları → tarayıcıda normalleştirme + toplulaştırma;
 *   - yeni, anahtar kapalı (geri dönüş): aynı satırlar → BLBacklogV3Report.panelModel;
 *   - yeni, anahtar açık: POST /api/read-model/backlog/v3 → hesap işçisi yükü
 *     (compute-tasks 'v3-items') + okuma modeli işçisi görevi (backlog-v3-model).
 * Karşılaştırılan çıktı panelin innerHTML'i (kutucuklar, şeritler, gruplar, zaman
 * çizelgesi, ipuçları) ve drill-down çekmecesidir; görünüm değişimleri (gruplama,
 * zaman alanı, ay/hafta, öncelik kırılımı, önem kapsamı, dil) ve öncelik dizini dahil.
 * Anahtar açıkken satır listesi (/api/backlog-export) hiç istenmez.
 */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), zlib = require('node:zlib');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const V3 = require('../public/backlog-v3-report.js');
const OD = require('../public/order-decision-engine.js');
const model = require('../server/lib/read-model/backlog-v3-model');

const NEW_SOURCE = fs.readFileSync(path.join(__dirname, '../public/backlog-overview.js'), 'utf8');
const OLD_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures/backlog-overview-ws6b.js'), 'utf8');

function fixtureData(count) {
  const fixture = parity.makeFixture({ rows: count });
  const orders = parse.parseASASRows(fixture.asas).orders, antrepo = parse.parseAntrepoRows(fixture.antrepo);
  const lines = [...new Set(orders.map(order => order.line).filter(Boolean))].sort().slice(0, 2);
  const source = { loadedAt: 'r1', asasOrders: orders, asasOrdersByTarget: { backlog: orders }, antrepoMap: antrepo, antrepoMapByTarget: { backlog: antrepo }, lflRows: [] };
  const data = { overrides: { importanceSettings: { tags: [{ id: 'bts', label: 'BTS' }], rules: [{ tagId: 'bts', lines }] } }, horizons: {}, headers: ['Demo'], sourceRevision: 'r', rowsRevision: 'r', calendar: { configured: false }, options: {}, sourceColumns: [] };
  return { source, data, rows: JSON.parse(tasks.serialize(tasks.buildBacklog('export', source, data))).rows };
}
function hitFor(orderCode, modelName, colourCode) {
  if (!String(orderCode || '').trim()) return null;
  let h = 0; for (const ch of `${orderCode}|${modelName}|${colourCode}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const code = ['', 'CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK'][h % 6]; if (!code) return null;
  return { priority: code, source: h % 3 === 0 ? 'orders' : 'cp', trackingTags: h % 4 === 0 ? ['WATCH'] : [], ...(h % 7 === 0 ? { priorityTags: ['ACTION_TODAY'] } : {}) };
}

function element(id) {
  const listeners = {}, classes = new Set();
  const el = { id, innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {}, offsetParent: {}, childElementCount: 0, children: [],
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], appendChild(child) { this.children.push(child); return child; }, focus() {}, contains: () => true, listeners };
  return el;
}
/* Paneli yükler. mode: 'old' | 'legacy' | 'backend'. */
function loadPanel(mode, data, opts) {
  const ids = new Map(), body = element('body');
  const $ = id => { if (!ids.has(id)) ids.set(id, element(id)); return ids.get(id); };
  for (const id of ['backlogOverviewBody', 'backlogOverview', 'backlogContent', 'backlogOverviewToggle', 'backlogOverviewFilter', 'backlogOverviewFilterCount', 'backlogOverviewRefresh']) $(id);
  const html = { lang: 'tr' }, store = new Map([['lcw.backlog.overview.v1', JSON.stringify(opts.state || {})]]), requests = [];
  const created = [];
  const document = { readyState: 'complete', documentElement: html, body, getElementById: id => (ids.has(id) ? ids.get(id) : null), addEventListener() {},
    createElement: () => {
      const el = element('created'); created.push(el);
      // Kimlik atanınca getElementById ile bulunur (çekmece kökü bir kez kurulur).
      Object.defineProperty(el, 'id', { get: () => el._id, set: value => { el._id = value; ids.set(value, el); } });
      el.querySelector = sel => (sel === '.bpaDrawer' ? (el.aside = el.aside || element('aside')) : null); return el;
    } };
  const today = V3.dayIso(new Date());
  const buffer = zlib.gzipSync(Buffer.from(tasks.serialize(tasks.buildBacklog('v3-items', data.source, { ...data.data, today }), 'api')));
  let datasetSeq = 0; const datasetKey = 'render-' + (++datasetSeq) + '-' + Math.random();
  async function fetch(url, init = {}) {
    requests.push(String(url) + (init.body && JSON.parse(init.body).drill ? '#drill' : ''));
    if (String(url).startsWith('/api/backlog-export')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ rows: data.rows })) };
    if (String(url) === '/api/read-model/backlog/v3') {
      const body = JSON.parse(init.body);
      assert.equal(body.view.today, today);
      const out = model.execute({ datasetKey, buffer: requests.filter(u => u.startsWith(url)).length === 1 ? buffer : null, request: { view: body.view, priority: body.priority, drill: body.drill } });
      return { ok: true, status: 200, json: async () => JSON.parse(zlib.gunzipSync(Buffer.from(out.buffer)).toString('utf8')) };
    }
    throw new Error('unexpected fetch ' + url);
  }
  const priority = opts.priority ? { ready: () => true, revision: () => '1:ready', ensure: () => true, lookup: hitFor, catalog: () => OD.getPriorityCatalog() } : null;
  const context = { document, localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    BLBacklogV3Report: V3, BLOrderDecisionEngine: OD, BLCpPriorityIndex: priority, BL_READ_MODEL_BACKLOG_V3: mode === 'backend',
    fetch, AbortController, URLSearchParams, Date, setTimeout, clearTimeout, requestAnimationFrame: () => 0, getComputedStyle: () => ({ getPropertyValue: () => '' }), DOMException, Intl, console,
    backlogExportQueryParams: () => ({ format: 'json', lazyDimensions: '1', groupBy: 'status,antrepoDate' }), CustomEvent: class {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(mode === 'old' ? OLD_SOURCE : NEW_SOURCE, context, { filename: mode + '-backlog-overview.js' });
  const host = $('backlogOverviewBody');
  const click = dataset => { const target = { dataset, closest: () => target }; for (const fn of host.listeners.click || []) fn({ target }); };
  const drawer = () => (ids.get('blvDrawer')?.aside?.innerHTML) || '';
  return { mode, context, host, click, drawer, requests, html };
}
// tip/opener kimlikleri çizim sayısına bağlıdır; görünüş sırasıyla yeniden numaralanır.
function canonicalHtml(text) {
  const seen = new Map();
  return String(text).replace(/data-blv-(open|tip)="([to]\d+)"/g, (_, kind, id) => { if (!seen.has(id)) seen.set(id, seen.size); return `data-blv-${kind}="#${seen.get(id)}"`; });
}
async function settle(panel, predicate = () => true) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    await new Promise(resolve => setTimeout(resolve, 15));
    const now = panel.host.innerHTML + '\u0000' + panel.drawer();
    if (now === last && predicate()) return;
    last = now;
  }
  throw new Error('panel did not settle: ' + panel.mode + ' ' + (last === panel.host.innerHTML + '\u0000' + panel.drawer()) + ' drawer=' + panel.drawer().slice(-400) + ' | ' + panel.requests.join(','));
}
const openIds = html => [...html.matchAll(/data-blv-open="(o\d+)"/g)].map(m => m[1]);

const STEPS = [
  { name: 'ilk açılış' },
  { name: 'gruplama: sezon', click: { blvGroup: 'season' } },
  { name: 'gruplama: öncelik', click: { blvGroup: 'priority' } },
  { name: 'zaman: retail', click: { blvTime: 'retail' } },
  { name: 'ay', click: { blvGran: 'month' } },
  { name: 'kırılım: öncelik', click: { blvTimelineDim: 'priority' } },
  { name: 'kırılım: buyer', click: { blvTimelineDim: 'buyer' } },
  { name: 'grafik: grouped', click: { blvChart: 'grouped' } },
  { name: 'ölçek: adet', click: { blvScale: 'qty' } },
  { name: 'önem: özel', click: { blvImportance: 'special' } },
  { name: 'önem: regular', click: { blvImportance: 'regular' } },
  { name: 'önem: tümü', click: { blvImportance: 'all' } },
  { name: 'dil: en', lang: 'en' },
];

for (const priority of [false, true]) {
  test(`Backlog V3 paneli: eski çizim = yeni çizim (anahtar kapalı ve açık), öncelik dizini ${priority ? 'hazır' : 'yok'}`, { timeout: 300000 }, async () => {
    const data = fixtureData(500);
    const panels = Object.fromEntries(['old', 'legacy', 'backend'].map(mode => [mode, loadPanel(mode, data, { priority })]));
    for (const panel of Object.values(panels)) panel.context.BLBacklogOverview.onBacklogRendered({ rowsInputRevision: 'r1' });
    for (const step of STEPS) {
      for (const panel of Object.values(panels)) {
        if (step.click) panel.click(step.click);
        if (step.lang) { panel.html.lang = step.lang; panel.context.BLBacklogOverview.refresh(); }
        await settle(panel, () => /bpaHero|bpaEmpty/.test(panel.host.innerHTML));
      }
      const old = canonicalHtml(panels.old.host.innerHTML);
      assert.match(old, /bpaHero/, step.name + ': panel dolu');
      assert.equal(canonicalHtml(panels.legacy.host.innerHTML), old, step.name + ': anahtar kapalı');
      assert.equal(canonicalHtml(panels.backend.host.innerHTML), old, step.name + ': anahtar açık');
      // Drill-down: kutucuk, grup, segment, zaman sütunu … her üçüncü açıcı (en fazla 12).
      const ids = openIds(panels.old.host.innerHTML);
      const picks = ids.filter((_, index) => index % 3 === 0).slice(0, 12).map(id => ids.indexOf(id));
      for (const index of picks) {
        for (const panel of Object.values(panels)) { panel.click({ blvOpen: openIds(panel.host.innerHTML)[index] }); await settle(panel, () => /bpaDrawerStats|bpaError/.test(panel.drawer())); }
        const expected = panels.old.drawer();
        assert.match(expected, /bpaDrawerStats/);
        assert.equal(panels.legacy.drawer(), expected, `${step.name}: çekmece #${index} (anahtar kapalı)`);
        assert.equal(panels.backend.drawer(), expected, `${step.name}: çekmece #${index} (anahtar açık)`);
      }
    }
    assert.ok(panels.old.requests.some(url => url.startsWith('/api/backlog-export')));
    assert.ok(panels.legacy.requests.some(url => url.startsWith('/api/backlog-export')), 'geri dönüş yolu satırları indirir');
    assert.equal(panels.backend.requests.filter(url => url.startsWith('/api/backlog-export')).length, 0, 'anahtar açıkken satır listesi indirilmez');
    // Görünüm değişimi başına bir model isteği (çizim tercihleri hariç), her çekmece için bir drill-down isteği.
    const backend = panels.backend.requests, drills = backend.filter(url => url.endsWith('#drill')).length;
    assert.ok(backend.filter(url => url === '/api/read-model/backlog/v3').length >= STEPS.filter(step => step.click && !step.click.blvChart && !step.click.blvScale).length);
    assert.ok(drills >= STEPS.length, 'drill-down satırları tıklanınca yüklenir');
  });
}

test('Backlog V3 anahtarı: varsayılan açık; window bayrağı ve yerel tercih "0" kapatır', () => {
  const start = NEW_SOURCE.indexOf('function backendModelEnabled(){');
  const fn = NEW_SOURCE.slice(start, NEW_SOURCE.indexOf('\n}\n', start) + 2);
  const run = (flag, stored) => vm.runInNewContext(`${fn};backendModelEnabled()`, { window: flag === undefined ? {} : { BL_READ_MODEL_BACKLOG_V3: flag }, localStorage: { getItem: key => (key === 'buyerlog.readModel.backlogV3.v1' ? stored : null) } });
  assert.equal(run(undefined, null), true);
  assert.equal(run(undefined, '0'), false);
  assert.equal(run(false, null), false);
  assert.equal(run(true, '0'), true);
});

test('drawerModelIdentity okuduğu satır anahtarları okuma modelinin taşıdığı projeksiyonda', () => {
  const start = NEW_SOURCE.indexOf('function drawerModelIdentity(it){');
  const body = NEW_SOURCE.slice(start, NEW_SOURCE.indexOf('\n}\n', start));
  const keys = [...body.matchAll(/row(?:\.(\w+)|\['([^']+)'\])/g)].map(m => m[1] || m[2]).filter(key => key && key !== 'row');
  const { DRAWER_ROW_KEYS } = require('../server/lib/read-model/backlog-v3-items');
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(DRAWER_ROW_KEYS.includes(key), 'taşınmayan çekmece anahtarı: ' + key);
  assert.match(body, /identityFromRow\?\.\(row,'backlog'\)/, 'kanonik kimlik backlog bağlamasıyla okunur (IDENTITY_FIELDS)');
});
