'use strict';

/* OAB (Küp) — Veri Yönetimi'nde tanımlı, yönetilebilir kaynak (v2026-11-22).
 * FOB Sonrası Maliyet (PR #1138) ile aynı desen: 'oabcube' rolü, varsayılan
 * kayıt + migrasyon, 'oab-cube' kaynak profili, kendi ufuk satırı ve ufkun
 * widget sorgusuna girmesi. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const report = require('../server/lib/oab-cube-report');
const intakeReport = require('../server/lib/intake-report');
const modelScopes = require('../server/lib/model-scopes');
const sourceProfiles = require('../server/lib/data-domain/source-profiles');
const modelFields = require('../server/lib/model-fields');
const readModel = require('../server/lib/data-domain/read-model');
const { createIntakeStore } = require('../server/lib/intake-store');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const liveSchema = () => intakeReport.allowedSchema({
  columns: report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  measures: report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});
const userRecords = count => Array.from({ length: count }, (_, index) => ({ id: `user_${index}`, name: `Özel ${index}`, role: 'custom', server: 'lcwtabular_s30', catalog: `Katalog_${index}` }));
const ids = items => items.map(item => item.id);
const SEASON_HORIZON = { groups: [{ conditions: [{ field: 'SezonKod', table: 'Sezon', name: 'SezonKod', op: 'in', values: ['S6', 'W6'] }] }] };
const withHorizon = (horizon, extra = {}) => ({ id: 'mc_oabcube_default', name: 'OAB (Küp)', role: 'oabcube', server: 'lcwtabular_s20', catalog: 'OAB_Cube', scopes: [{ id: 's', enabled: true, targets: ['oabcube'], horizon }], ...extra });

/* ---------- Rol, varsayılan kayıt ve profil ---------- */
test('oabcube rolü INTAKE / FOB gibi ayrı veritabanı kaynağıdır: varsayılan kayıt, kapsam, profil', () => {
  const items = db.normalizeModelConnections([]);
  const item = items.find(entry => entry.role === 'oabcube');
  assert.ok(item, 'varsayılan oabcube bağlantısı eklenir');
  assert.deepEqual([item.id, item.name, item.server, item.catalog, item.refreshEnabled], ['mc_oabcube_default', 'OAB (Küp)', 'lcwtabular_s20', 'OAB_Cube', true]);
  assert.deepEqual(item.scopes[0].targets, ['oabcube']);
  // Boş liste: üç varsayılan, sabit sırayla.
  assert.deepEqual(items.map(entry => entry.role), ['intake', 'postfob', 'oabcube']);
  assert.deepEqual(modelScopes.allowedTargets('oabcube'), ['oabcube']);
  assert.ok(modelScopes.SCOPE_TARGETS.includes('oabcube'));
  assert.equal(modelScopes.TARGET_LABELS.oabcube, 'OAB (Küp)');
  assert.ok(!modelScopes.REFRESH_TARGETS.includes('oabcube'), 'global "Tümünü yenile" hedefine girmez');
  const profile = sourceProfiles.fromLegacyRole('oabcube');
  assert.equal(profile.id, 'oab-cube');
  assert.equal(profile.engine, 'tabular-dax');
  assert.deepEqual(profile.feedableModules, ['oabcube']);
  assert.deepEqual(profile.requiredModules, ['oabcube']);
  assert.deepEqual(profile.capabilities, ['filters', 'schema-discovery']);
  assert.ok(profile.label.tr && profile.label.en && profile.summary.tr && profile.summary.en);
  assert.deepEqual(sourceProfiles.validate({ roleTargets: modelScopes.ROLE_TARGETS, fieldsForRole: modelFields.fieldsForRole, scopeTargets: modelScopes.SCOPE_TARGETS }), { ok: true, problems: [] });
  // Bağlantı artık rol kaydından gelir (Veri Yönetimi'nde yönetilen kaynak).
  const resolved = report.resolveConnection(items);
  assert.deepEqual([resolved.id, resolved.server, resolved.catalog, resolved.source], ['mc_oabcube_default', 'lcwtabular_s20', 'OAB_Cube', 'settings']);
});

test('normalizeModelConnection rol beyaz listesi oabcube rolünü korur (asas\'a düşmez)', () => {
  assert.equal(db.normalizeModelConnection({ id: 'x', role: 'oabcube', server: 's', catalog: 'OAB_Cube' }).role, 'oabcube');
});

/* ---------- Mevcut kullanıcı geçişi ---------- */
test('migrasyon: liste boş (eski kurulum, kayıt yok) → INTAKE, FOB ve OAB (Küp) varsayılanları', () => {
  const items = db.normalizeModelConnections([]);
  assert.equal(items.filter(entry => entry.role === 'oabcube').length, 1);
  assert.equal(items.filter(entry => entry.role === 'intake').length, 1);
  assert.equal(items.filter(entry => entry.role === 'postfob').length, 1);
  // Kararlı: ikinci normalizasyon kayıt eklemez, sırayı bozmaz.
  assert.deepEqual(ids(db.normalizeModelConnections(items)), ids(items));
});

test('migrasyon: OAB_Cube önceden Özel Database ise varsayılan onun sunucu/kataloğunu devralır, özel kayıt silinmez', () => {
  const custom = { id: 'mine', name: 'Küp', role: 'custom', server: 'lcwtabular_s22', catalog: 'OAB_Cube' };
  const items = db.normalizeModelConnections([custom]);
  const cube = items.find(entry => entry.role === 'oabcube');
  assert.deepEqual([cube.id, cube.server, cube.catalog], ['mc_oabcube_default', 'lcwtabular_s22', 'OAB_Cube']);
  const kept = items.find(entry => entry.id === 'mine');
  assert.ok(kept && kept.role === 'custom' && kept.server === 'lcwtabular_s22', 'kullanıcının özel kaydı korunur');
  // Widget aynı sunucuya gitmeye devam eder.
  assert.equal(report.resolveConnection(items).server, 'lcwtabular_s22');
  // Alt çizgisiz katalog yazımı da tanınır (mevcut OAB_CUBE_CATALOG_PATTERN).
  const variant = db.normalizeModelConnections([{ ...custom, catalog: 'OABCube' }]).find(entry => entry.role === 'oabcube');
  assert.equal(variant.catalog, 'OABCube');
});

test('migrasyon: devre dışı + etkin iki OAB_Cube kaydında varsayılan ETKİN olanın sunucusunu devralır (resolver sırası)', () => {
  const list = [
    { id: 'retired', name: 'Eski küp', role: 'custom', server: 'retired-server', catalog: 'OAB_Cube', refreshEnabled: false },
    { id: 'working', name: 'Küp', role: 'custom', server: 'working-server', catalog: 'OAB_Cube', refreshEnabled: true },
  ];
  assert.equal(report.resolveConnection(list).server, 'working-server', 'migrasyon öncesi çözüm');
  const items = db.normalizeModelConnections(list);
  assert.equal(items.find(entry => entry.role === 'oabcube').server, 'working-server');
  assert.equal(report.resolveConnection(items).server, 'working-server', 'migrasyon sonrası aynı sunucu');
  // Yalnız devre dışı kayıt varsa yine onu devralır (INTAKE sunucusundan önce).
  const onlyRetired = db.normalizeModelConnections([list[0], { id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' }]);
  assert.equal(onlyRetired.find(entry => entry.role === 'oabcube').server, 'retired-server');
});

test('migrasyon: OAB_Cube kaydı yoksa varsayılan INTAKE sunucusunu devralır (bugünkü "intake-server" davranışı korunur)', () => {
  const before = report.resolveConnection([{ id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' }]);
  const items = db.normalizeModelConnections([{ id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' }]);
  const after = report.resolveConnection(items);
  assert.equal(before.server, 'lcwtabular_s21');
  assert.deepEqual([after.server, after.catalog], [before.server, before.catalog]);
});

test('migrasyon: postfob ve intake varsayılanları zaten varsa yalnız OAB (Küp) eklenir, mevcutlar değişmez', () => {
  const existing = db.normalizeModelConnections([]).filter(entry => entry.role !== 'oabcube');
  assert.deepEqual(existing.map(entry => entry.role), ['intake', 'postfob']);
  const items = db.normalizeModelConnections([...userRecords(2), ...existing]);
  assert.deepEqual(ids(items), ['user_0', 'user_1', 'mc_intake_default', 'mc_postfob_default', 'mc_oabcube_default']);
  assert.deepEqual(items.find(entry => entry.role === 'postfob').server, 'F5_S41');
  // Kullanıcının kaydettiği oabcube kaydı korunur; ikinci varsayılan eklenmez.
  const saved = db.normalizeModelConnections([...existing, { id: 'mycube', name: 'Küp', role: 'oabcube', server: 'lcwtabular_s23', catalog: 'OAB_Cube' }]);
  assert.equal(saved.filter(entry => entry.role === 'oabcube').length, 1);
  assert.equal(report.resolveConnection(saved).server, 'lcwtabular_s23');
});

test('migrasyon: liste sınırdayken hiçbir kullanıcı kaydı düşmez; yer varsa OAB (Küp) eklenir', () => {
  const limit = db.MODEL_CONNECTION_LIMIT;
  const defaults = db.normalizeModelConnections([]).filter(entry => entry.role !== 'oabcube');
  // Bir yer boş: varsayılan eklenir, liste sınırı aşmaz.
  const roomy = db.normalizeModelConnections([...userRecords(limit - 3), ...defaults]);
  assert.equal(roomy.length, limit);
  assert.ok(roomy.some(entry => entry.role === 'oabcube'));
  // Tam sınır: kullanıcı kaydı silinmez (kayıt anında kalıcı veri kaybı olurdu);
  // varsayılan INTAKE / FOB kayıtları da düşmez. OAB (Küp) yedek bağlantı
  // sırasıyla (INTAKE sunucusu + OAB_Cube) çalışmaya devam eder.
  const full = [...userRecords(limit - 2), ...defaults];
  const items = db.normalizeModelConnections(full);
  assert.equal(items.length, limit);
  assert.deepEqual(ids(items), ids(full));
  assert.ok(!items.some(entry => entry.role === 'oabcube'));
  assert.deepEqual([report.resolveConnection(items).server, report.resolveConnection(items).source], ['lcwtabular_s20', 'intake-server']);
  // Sınırda ve OAB_Cube özel kaydı varken: o kayıt korunur ve widget onu kullanır.
  const withCube = [...userRecords(limit - 3), { id: 'mine', name: 'Küp', role: 'custom', server: 'lcwtabular_s22', catalog: 'OAB_Cube' }, ...defaults];
  const cubeItems = db.normalizeModelConnections(withCube);
  assert.deepEqual(ids(cubeItems), ids(withCube));
  assert.equal(report.resolveConnection(cubeItems).server, 'lcwtabular_s22');
});

/* ---------- Bağlantı çözümü ---------- */
test('resolveConnection: önce oabcube rolü; mevcut sıra (katalog → INTAKE sunucusu → kaynak Excel) yedek kalır', () => {
  const custom = { id: 'c', role: 'custom', server: 'lcwtabular_s22', catalog: 'OAB_Cube' };
  const role = { id: 'r', name: 'OAB (Küp)', role: 'oabcube', server: 'lcwtabular_s24', catalog: 'OAB_Cube' };
  const intake = { id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' };
  assert.equal(report.resolveConnection([custom, intake, role]).id, 'r', 'rol kaydı listede sonra gelse de önce gelir');
  assert.equal(report.resolveConnection([custom, intake, { ...role, refreshEnabled: false }, { ...role, id: 'r2', server: 'lcwtabular_s25' }]).id, 'r2', 'etkin rol kaydı tercih edilir');
  assert.deepEqual([report.resolveConnection([intake, custom]).id, report.resolveConnection([intake, custom]).source], ['c', 'settings']);
  assert.equal(report.resolveConnection([intake]).source, 'intake-server');
  assert.equal(report.resolveConnection([]).source, 'default');
});

/* ---------- Ufuk ---------- */
test('ufuk: Veri Yönetimi\'ndeki oabcube kapsamı sorguya girer ve sezon zorunluluğunu kaldırır', () => {
  const horizon = report.resolveHorizon([withHorizon(SEASON_HORIZON)]);
  assert.ok(horizon);
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: {}, horizon });
  assert.equal(built.horizonApplied, true);
  assert.match(built.query, /'Sezon'\[SezonKod\]/);
  assert.match(built.query, /"S6"/);
  // Ufuk + widget filtresi VE ile birleşir.
  const both = report.buildQuery({ liveFields: liveSchema(), filterValues: { mag: ['CU4C'] }, horizon });
  assert.match(both.query, /'Sezon'\[SezonKod\][\s\S]*TREATAS\(\{ "CU4C" \}/);
  // Ufuksuz sorgu: horizonApplied false, sezon yine zorunlu.
  assert.equal(report.buildQuery({ liveFields: liveSchema(), filterValues: { season: ['S6'] } }).horizonApplied, false);
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), filterValues: {}, horizon: null }), error => error.code === 'OAB_CUBE_SEASON_REQUIRED');
  // Boş / normalize edilmiş boş ufuk sınır sayılmaz.
  assert.equal(report.resolveHorizon([withHorizon({})]), null);
  assert.equal(report.resolveHorizon(db.normalizeModelConnections([])), null);
  // Ufuk yalnız oabcube rol kaydından okunur (özel OAB_Cube kaydının kapsamı değil).
  assert.equal(report.resolveHorizon([withHorizon(SEASON_HORIZON, { role: 'custom', id: 'c' })]), null);
});

test('ufuk: ölçülerle ilişkisi kanıtlanmamış tablo (Urun) sınır sayılmaz; açık ufuk hatası verir', () => {
  const horizon = report.resolveHorizon([withHorizon({ groups: [{ conditions: [{ field: 'FİT', table: 'Urun', name: 'FİT', op: 'in', values: ['Slim'] }] }] })]);
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), filterValues: {}, horizon }), error => error.code === 'OAB_CUBE_HORIZON_INVALID' && error.statusCode === 400);
  // Tek sorguya çevrilemeyen ufuk (çok tablolu VEYA) da kaynak kesintisi değil ufuk hatasıdır.
  const multi = report.resolveHorizon([withHorizon({ groups: [
    { conditions: [{ field: 'SezonKod', table: 'Sezon', name: 'SezonKod', op: 'in', values: ['S6'] }] },
    { conditions: [{ field: 'MerchAltGrupKod', table: 'DummyUrun', name: 'MerchAltGrupKod', op: 'in', values: ['CU4C'] }] },
  ] })]);
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), filterValues: {}, horizon: multi }), error => error.code === 'OAB_CUBE_HORIZON_INVALID');
});

/* ---------- Route ---------- */
function harness(connections) {
  const handlers = {};
  const app = {};
  ['get', 'put', 'post'].forEach(method => { app[method] = (url, ...fns) => { handlers[`${method.toUpperCase()} ${url}`] = fns; }; });
  const calls = [], prefs = new Map();
  const schema = liveSchema();
  const state = { connections };
  const modelQuery = {
    discoverSchema: async input => { calls.push({ schema: input }); return { columns: schema.filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: f.dataType })), measures: schema.filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })), provider: 'ADOMD' }; },
    runModelRows: async input => { calls.push(input); return { rows: /^EVALUATE ROW/.test(input.query) ? [] : [{ season: 'S6', modelCode: 'M1', colourCode: 'C1', approved: '3', wssi: '1' }] }; },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  const routes = require('../server/routes/oab-cube-routes')(app, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: () => {} },
    modelQuery, userPreferences,
    loadModelConnections: () => ({ items: state.connections }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'oab-cube-dm-')) }),
  });
  async function call(key, req) {
    const fns = handlers[key];
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const request = { currentUser: { id: 'u1' }, body: {}, ...req };
    let i = 0;
    const next = async () => { const fn = fns[i++]; if (fn) await fn(request, res, next); };
    await next();
    return res;
  }
  return { call, calls, state, routes };
}

test('route: ufuk tanımlıysa sezonsuz sorgu çalışır; durum ve yanıt ufku bildirir; önbellek anahtarı ufku içerir', async () => {
  const h = harness([withHorizon(SEASON_HORIZON, { server: 'lcwtabular_s24' })]);
  const state = await h.call('GET /api/oab-cube/state', {});
  assert.equal(state.body.horizon, true);
  assert.equal(state.body.connection.server, 'lcwtabular_s24');
  const first = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.horizonApplied, true);
  assert.equal(first.body.fromCache, false);
  const dataQuery = h.calls.find(call => call.query && /SUMMARIZECOLUMNS/.test(call.query));
  assert.equal(dataQuery.server, 'lcwtabular_s24');
  assert.match(dataQuery.query, /'Sezon'\[SezonKod\]/);
  const cached = await h.call('POST /api/oab-cube/report', { body: {} });
  assert.equal(cached.body.fromCache, true);
  assert.equal(cached.body.horizonApplied, true);
  // Ufuk değişince önbellekteki eski satırlar dönmez.
  h.state.connections = [withHorizon({ groups: [{ conditions: [{ field: 'SezonKod', table: 'Sezon', name: 'SezonKod', op: 'in', values: ['W7'] }] }] }, { server: 'lcwtabular_s24' })];
  const changed = await h.call('POST /api/oab-cube/report', { body: {} });
  assert.equal(changed.body.fromCache, false);
  assert.match(h.calls.filter(call => call.query && /SUMMARIZECOLUMNS/.test(call.query)).pop().query, /"W7"/);
  // Snapshot ufuk bilgisini taşır.
  assert.equal((await h.call('GET /api/oab-cube/state', {})).body.snapshot.horizonApplied, true);
  // Ufuk kaldırılınca sezon yeniden zorunlu.
  h.state.connections = [withHorizon({}, { server: 'lcwtabular_s24' })];
  const none = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(none.statusCode, 400);
  assert.equal(none.body.code, 'OAB_CUBE_SEASON_REQUIRED');
  assert.equal((await h.call('GET /api/oab-cube/state', {})).body.horizon, false);
});

test('route: sezon da ufuk da yoksa küpe gitmeden reddeder; başarılı yanıt güncel ufuk durumunu taşır', async () => {
  const h = harness([withHorizon({})]);
  const res = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'OAB_CUBE_SEASON_REQUIRED');
  assert.equal(res.body.horizon, false);
  assert.deepEqual(h.calls, [], 'şema keşfi veya sorgu çalışmaz');
  // Widget açıkken Veri Yönetimi'nde ufuk tanımlanır: sayfa yenilemeden sezonsuz Yenile çalışır.
  h.state.connections = [withHorizon(SEASON_HORIZON)];
  const ok = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.horizon, true);
});

test('route: kullanıcının düzeltebileceği ufuk hatası kendi koduyla döner, "küpe ulaşılamıyor" diye maskelenmez', async () => {
  const h = harness([withHorizon({ groups: [{ conditions: [{ field: 'FİT', table: 'Urun', name: 'FİT', op: 'in', values: ['Slim'] }] }] })]);
  const res = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'OAB_CUBE_HORIZON_INVALID');
});

test('Corporate Integration Lab İncele: canlı şema okunur, eksik alan raporlanır, veri sorgusu atılmaz', async () => {
  const h = harness([]);
  const probe = {};
  const rows = await h.routes.probe({ currentUser: { id: 'u1' } }, { server: 'lcwtabular_s20', catalog: 'OAB_Cube' }, probe);
  assert.deepEqual(rows, []);
  assert.equal(probe.queryOk, true);
  assert.equal(probe.schema.provider, 'ADOMD');
  assert.deepEqual(probe.queryRuns[0].targets, ['oabcube']);
  assert.deepEqual(h.calls.map(call => Object.keys(call)[0]), ['schema'], 'İncele veri sorgusu atmaz');
  assert.equal(typeof h.routes.snapshotRows, 'function');
  const server = read('server/server.js');
  assert.match(server, /source\.profileId === 'oab-cube'\) return oabCubeRoutes\.snapshotRows\(userId\)/);
  assert.match(server, /source\.profileId === 'oab-cube'\s*\? await oabCubeRoutes\.probe\(/);
  assert.match(server, /source\.profileId === 'oab-cube' \? 'oabcube'/);
});

/* ---------- Veri Yönetimi ---------- */
test('Veri Yönetimi okuma modeli OAB (Küp) kaynağını ve modülünü iki dilde listeler', () => {
  const items = db.normalizeModelConnections([]);
  const tr = readModel.build(items, { language: 'tr' });
  const en = readModel.build(items, { language: 'en' });
  const source = tr.sources.find(entry => entry.profileId === 'oab-cube');
  assert.ok(source, 'kaynak listede');
  assert.equal(source.connection.catalog, 'OAB_Cube');
  assert.equal(tr.modules.find(entry => entry.id === 'oabcube').label, 'OAB (Küp)');
  assert.equal(en.modules.find(entry => entry.id === 'oabcube').label, 'OAB (Cube)');
});

test('Veri Yönetimi ekranı OAB (Küp) ufkunu ayrı satır ve çekmece grubu olarak sunar; ufuksuz "filtre gerekli" demez', () => {
  const dm = read('public/data-management.js');
  assert.match(dm, /horizonRow\(\{ id: 'oabcube', targets: \['oabcube'\] \}\)/);
  assert.match(dm, /\{ id: 'postfob', targets: \['postfob'\] \}, \{ id: 'oabcube', targets: \['oabcube'\] \}\];/);
  assert.match(dm, /oabcube: \{\s*title: \{ tr: 'OAB \(Küp\)', en: 'OAB \(Cube\)' \},\s*hint: \{ tr: '[^']+', en: '[^']+' \}/);
  assert.match(dm, /const widgetBounded = \['postfob', 'oabcube'\]\.includes\(group\.id\);/);
  const routes = read('server/routes/horizon-routes.js');
  assert.equal((routes.match(/target === 'oabcube' \? connections\.find\(item => item && item\.role === 'oabcube'\)/g) || []).length, 2);
  const main = read('public/app-main.js');
  assert.match(main, /\{name:'OAB \(Küp\)', server:'lcwtabular_s20', catalog:'OAB_Cube', role:'oabcube', refreshEnabled:true\}/);
  assert.match(main, /oabcube:\['oabcube'\]/);
  assert.match(main, /oabcube:'OAB \(Küp\) \/ OAB \(Cube\)'/);
});

test('widget: ufuk varsa sezon zorunlu değildir; başlık ve Excel özeti ufku gösterir', () => {
  const ui = read('public/oab-cube.js');
  // Sezon zorunluluğu sunucuda: istemci eski (sayfa açılışındaki) ufuk bilgisiyle Yenile'yi engellemez.
  assert.doesNotMatch(ui, /if \(!state\.horizon && !\(view\(\)\.filterValues\.season/);
  assert.match(ui, /code === 'OAB_CUBE_SEASON_REQUIRED'\) \{ state\.horizon = false; setFilterPanelOpen\(true\);/);
  assert.match(ui, /if \(typeof payload\.horizon === 'boolean'\) state\.horizon = payload\.horizon;/);
  assert.match(ui, /state\.horizon = Boolean\(payload\.horizon\);/);
  assert.match(ui, /state\.horizonApplied = Boolean\(payload && payload\.horizonApplied\);/);
  assert.match(ui, /if \(state\.horizon\) parts\.push\(text\('Veri Yönetimi ufku', 'Data Management horizon'\)\);/);
  assert.match(ui, /state\.horizonApplied \? \[\{ \[field\]: text\('Veri Yönetimi ufku', 'Data Management horizon'\), \[valueLabel\]: text\('Uygulandı', 'Applied'\) \}\]/);
  assert.match(ui, /OAB_CUBE_HORIZON_INVALID: \['[^']+', '[^']+'\]/);
  assert.match(ui, /ref\.key === 'season' && !state\.horizon \?/);
});
