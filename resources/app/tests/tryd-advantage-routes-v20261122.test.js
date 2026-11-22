'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/lib/postfob-report');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const liveSchema = () => intakeReport.allowedSchema({
  columns: report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  measures: report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});

function harness(modelRows) {
  const handlers = {};
  const app = { get: (url, ...fns) => { handlers[`GET ${url}`] = fns; }, put: (url, ...fns) => { handlers[`PUT ${url}`] = fns; }, post: (url, ...fns) => { handlers[`POST ${url}`] = fns; } };
  const prefs = new Map();
  const calls = [];
  const audits = [];
  let rowsToReturn = modelRows, schemaFails = false;
  const userAccess = { requireAnyArea: () => (req, res, next) => next(), requireCapability: cap => { userAccess.caps.push(cap); return (req, res, next) => next(); }, caps: [], appendAudit: (...args) => audits.push(args) };
  const modelQuery = {
    discoverSchema: async () => { if (schemaFails) throw Object.assign(new Error('down'), { code: 'MODEL_SCHEMA_UNAVAILABLE' }); return ({ columns: liveSchema().filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: 'WChar' })), measures: liveSchema().filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })) }); },
    runModelRows: async input => { calls.push(input); if (rowsToReturn instanceof Error) throw rowsToReturn; return { rows: typeof rowsToReturn === 'function' ? rowsToReturn(input) : rowsToReturn }; },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tryd-'));
  const store = createIntakeStore({ root });
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() }, userAccess, modelQuery, userPreferences,
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store,
  });
  async function call(key, req) {
    const fns = handlers[key];
    assert.ok(fns, `${key} kayıtlı değil`);
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const request = { currentUser: { id: 'u1' }, body: {}, ...req };
    let i = 0;
    const next = async () => { const fn = fns[i++]; if (fn) await fn(request, res, next); };
    await next();
    return res;
  }
  return { call, calls, audits, prefs, store, userAccess, setRows: value => { rowsToReturn = value; }, schemaDown: () => { schemaFails = true; } };
}

const sample = [
  { order: '1', model: 'M1', season: 'S6', originCountry: 'TÜRKİYE', qty: '100', fob: '5' },
  { order: '2', model: 'M1', season: 'S6', originCountry: 'BANGLADEŞ', qty: '1000', fob: '3', landedActual: '3,5' },
];

test('TR/YD: sezonsuz istek reddedilir; sorgu FOB sonrası görünümünü ve snapshot\'ını değiştirmez', async () => {
  const h = harness(sample);
  const missing = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: {} } } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.code, 'POSTFOB_SEASON_REQUIRED');
  const first = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'], originCountry: ['TR'] }, target: 0.4 } } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.fromCache, false);
  assert.equal(first.body.rows[1].landedActual, 3.5);
  assert.equal(first.body.view.target, 0.4);
  assert.deepEqual(first.body.view.filterValues, { season: ['S6'] });
  // Üretici ülke filtresi sorguya girmez (TR ve YD birlikte gerekli); satış ülkesi grain'i eklenmez.
  assert.doesNotMatch(h.calls[0].query, /Uretici Ulke Adi\]\)/);
  assert.doesNotMatch(h.calls[0].query, /'SatisUlke'\[Satış Ülkesi\]/);
  assert.equal(h.store.loadSnapshot('u1'), null);
  const entries = h.prefs.get('u1').map(([key]) => key);
  assert.deepEqual(entries, ['lcw.postfob.tryd.v1']);
  assert.equal(h.audits[0][1], 'POSTFOB_TRYD_REPORT_FETCH');
});

test('TR/YD: FOB Sonrası ile aynı sorgu önbelleğini paylaşır (ikinci model sorgusu yok)', async () => {
  const h = harness(sample);
  const postfob = await h.call('POST /api/postfob/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(postfob.body.fromCache, false);
  const tryd = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(tryd.body.fromCache, true);
  assert.equal(h.calls.length, 1);
  assert.equal(tryd.body.rows.length, 2);
  // Zorla yenileme yeni sorgu atar ve aynı önbellek kaydını günceller.
  const forced = await h.call('POST /api/postfob/tryd/report', { body: { forceRefresh: true } });
  assert.equal(forced.body.fromCache, false);
  assert.equal(h.calls.length, 2);
  const again = await h.call('POST /api/postfob/report', { body: {} });
  assert.equal(again.body.fromCache, true);
  assert.equal(h.calls.length, 2);
});

test('TR/YD: state son sorgunun önbellek kaydını ve kesilme bilgisini döner; görünüm kaydı normalize edilir', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ order: String(i), model: 'M', originCountry: 'TÜRKİYE', qty: '1', fob: '1' }));
  const h = harness(many);
  const empty = await h.call('GET /api/postfob/tryd/state', {});
  assert.equal(empty.body.data, null);
  assert.equal(empty.body.view.target, 0.36);
  assert.equal(empty.body.rowLimit, report.POSTFOB_MAX_ROWS);
  const saved = await h.call('PUT /api/postfob/tryd/view', { body: { view: { target: 0.3, landedSource: 'forecast', filterValues: { season: ['S6'] } } } });
  assert.equal(saved.body.view.landedSource, 'forecast');
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.equal(state.body.data.rows.length, 5);
  assert.equal(state.body.view.target, 0.3);
  assert.equal(state.body.view.landedSource, 'forecast');
  assert.equal(typeof state.body.data.truncated, 'boolean');
});

test('TR/YD: kaynak kesintisinde aynı sorgunun eski önbellek kaydı çevrimdışı döner; yoksa güvenli hata', async () => {
  const h = harness(sample);
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  h.setRows(Object.assign(new Error('boom \\\\srv'), { code: 'MODEL_QUERY_FAILED' }));
  const offline = await h.call('POST /api/postfob/tryd/report', { body: { forceRefresh: true } });
  assert.equal(offline.statusCode, 200);
  assert.equal(offline.body.offline, true);
  assert.equal(offline.body.rows.length, 2);
  // Şema keşfi de düşerse (tam ağ kesintisi) son başarılı sorgunun kaydı döner; filtre değiştiyse dönmez.
  h.schemaDown();
  const schemaOutage = await h.call('POST /api/postfob/tryd/report', { body: { forceRefresh: true } });
  assert.equal(schemaOutage.body.offline, true);
  assert.equal(schemaOutage.body.rows.length, 2);
  const changed = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S7'] } } } });
  assert.equal(changed.statusCode, 502);
  const fresh = harness(Object.assign(new Error('boom \\\\srv'), { code: 'MODEL_QUERY_FAILED' }));
  const failed = await fresh.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S7'] } } } });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.code, 'POSTFOB_SOURCE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failed.body), /boom|srv/);
});

test('TR/YD: yetki FOB Sonrası ile aynı (Genel Bakış + OAB.VIEW)', () => {
  const h = harness(sample);
  assert.ok(h.userAccess.caps.length >= 1);
  assert.ok(h.userAccess.caps.every(cap => cap === 'OAB.VIEW'));
});

test('TR/YD: tercihe yazılmış başka kullanıcının önbellek anahtarı okunmaz (anahtar oturum kullanıcısıyla yeniden hesaplanır)', async () => {
  const h = harness(sample);
  await h.call('POST /api/postfob/tryd/report', { currentUser: { id: 'victim' }, body: { view: { filterValues: { season: ['S6'] } } } });
  const victimPref = JSON.parse(new Map(h.prefs.get('victim')).get('lcw.postfob.tryd.v1').value);
  assert.equal(victimPref.queryKey, undefined, 'ham önbellek anahtarı tercihte tutulmaz');
  // Saldırgan kurbanın tercih değerini (ve olası bir ham anahtarı) kendi tercihine kopyalar.
  const forged = { ...victimPref, queryKey: 'x', lastQuery: victimPref.lastQuery };
  h.prefs.set('attacker', [['lcw.postfob.tryd.v1', { value: JSON.stringify(forged) }]]);
  const state = await h.call('GET /api/postfob/tryd/state', { currentUser: { id: 'attacker' } });
  assert.equal(state.body.data, null);
  const own = await h.call('GET /api/postfob/tryd/state', { currentUser: { id: 'victim' } });
  assert.equal(own.body.data.rows.length, 2);
});
