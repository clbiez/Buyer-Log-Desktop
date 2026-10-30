'use strict';

/*
 * v7.0.183 — HORIZON KULLANICI BAZLI (kullanıcı kararı).
 *
 * Saha olayı: Buyer Log klasörü başka bir kullanıcıya kopyalandı; orada
 * Veri Yönetimi'nden yapılan Horizon (kaynak filtresi) değişikliği ana
 * bilgisayardaki filtreyi bozdu. Kök neden: filtre settings.json ›
 * modelConnections içinde ortak kayıttı ve Sync klasörü üzerinden HER
 * makineye dağıtılıyordu (GLOBAL_MASTER).
 *
 * Sözleşme:
 *   1) Varsayılan kaydetme (mode 'personal') kullanıcının KENDİ tercih
 *      deposuna yazar; ortak bağlantı kaydı değişmez, Sync'e yayın yapılmaz.
 *   2) Yenileme kişisel filtreyi yalnız o kullanıcı için uygular; başka
 *      kullanıcı ortak filtreyi görmeye devam eder.
 *   3) Bağlı gruptaki modül için grubun bütün üyelerine yazılır.
 *   4) Ortak varsayılanı yazmak yönetim yetkisi ister ve arayüzde "Herkes
 *      için" diye ayrıca etiketlidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-personal-horizon-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const writer = require('../server/lib/data-domain/filter-writer');
const userPreferences = require('../server/lib/user-preferences');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const APP = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(APP, 'server', 'routes', 'horizon-template-routes.js'), 'utf8');
const UI = fs.readFileSync(path.join(APP, 'public', 'data-management.js'), 'utf8');
const FILTER_UI = fs.readFileSync(path.join(APP, 'public', 'data-management-filter.js'), 'utf8');

function horizonOf(values) {
  return { table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] };
}
function setup() {
  return db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [
      { id: 'sc_core', name: 'Licensing Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) },
      { id: 'sc_lfl', name: 'LFL', targets: ['lfl'], enabled: true, horizon: horizonOf(['S6']) },
    ],
  }, {
    id: 'mc_ias', name: 'IAS', server: 's2', catalog: 'c2', role: 'antrepo', refreshEnabled: true,
    scopes: [
      { id: 'sc_ias_core', name: 'IAS Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) },
    ],
  }], null).items;
}
function valuesFor(items, sourceId, moduleId) {
  const scope = items.find(entry => entry.id === sourceId).scopes.find(entry => (entry.targets || []).includes(moduleId));
  return scope ? scope.horizon.groups[0].conditions[0].values : null;
}
function savePersonal(userId, plan) {
  for (const target of plan.modules) userPreferences.saveHorizon(userId, target, plan.horizon, { connectionId: plan.connectionId, role: plan.role });
}

test('kişisel plan ortak bağlantı kaydına dokunmaz', () => {
  const items = setup();
  const before = JSON.stringify(items);
  const plan = writer.planPersonalFilter(items, { sourceId: 'mc_ias', moduleId: 'cp', definition: horizonOf(['W9']) });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual(plan.modules, ['cp']);
  assert.equal(plan.connectionId, 'mc_ias');
  assert.equal(plan.items, undefined, 'kişisel plan bağlantı listesi üretmemeli');
  assert.equal(JSON.stringify(items), before);
});

test('kişisel filtre yalnız sahibine uygulanır; diğer kullanıcı ortak filtreyi görür', () => {
  const items = setup();
  const plan = writer.planPersonalFilter(items, { sourceId: 'mc_ias', moduleId: 'cp', definition: horizonOf(['W9']) });
  savePersonal('ali', plan);

  const forAli = userPreferences.applyHorizonOverrides(db.loadModelConnections().items, 'ali', ['cp']);
  const forVeli = userPreferences.applyHorizonOverrides(db.loadModelConnections().items, 'veli', ['cp']);
  assert.deepEqual(valuesFor(forAli, 'mc_ias', 'cp'), ['W9'], 'sahibinin kişisel filtresi uygulanmalı');
  assert.deepEqual(valuesFor(forVeli, 'mc_ias', 'cp'), ['S7'], 'başka kullanıcı ortak filtreyi görmeli');
  assert.deepEqual(valuesFor(db.loadModelConnections().items, 'mc_ias', 'cp'), ['S7'], 'ortak kayıt değişmemeli');
  // Aynı modülü besleyen BAŞKA kaynağın filtresi etkilenmez (byConnection).
  assert.deepEqual(valuesFor(forAli, 'mc_asas', 'cp'), ['S7']);
});

test('bağlı gruptaki modül için grubun bütün üyelerine yazılır', () => {
  const items = setup();
  const members = items.find(entry => entry.id === 'mc_asas').linkedTargets || [];
  assert.ok(members.includes('backlog') && members.length > 1, `bağlı grup bekleniyordu: ${members}`);
  const plan = writer.planPersonalFilter(items, { sourceId: 'mc_asas', moduleId: 'backlog', definition: horizonOf(['K1']) });
  assert.equal(plan.ok, true, plan.message);
  assert.deepEqual([...plan.modules].sort(), [...members].sort());
  assert.ok(plan.warnings.some(text => /bağlı/.test(text)));
  savePersonal('ali', plan);
  const forAli = userPreferences.applyHorizonOverrides(db.loadModelConnections().items, 'ali', members);
  for (const target of members) assert.deepEqual(valuesFor(forAli, 'mc_asas', target), ['K1'], target);
});

test('bağlı olmayan, beslenemeyen ve geçersiz istekler reddedilir', () => {
  const items = setup();
  assert.equal(writer.planPersonalFilter(items, { sourceId: 'yok', moduleId: 'cp', definition: horizonOf(['A']) }).code, 'SOURCE_NOT_FOUND');
  assert.equal(writer.planPersonalFilter(items, { sourceId: 'mc_ias', moduleId: 'lfl', definition: horizonOf(['A']) }).ok, false);
  const unbounded = writer.planPersonalFilter(items, { sourceId: 'mc_ias', moduleId: 'cp', definition: { table: 'ASAS', groups: [] } });
  assert.equal(unbounded.ok, true);
  assert.ok(unbounded.warnings.some(text => /yenileme çalışmaz/.test(text)), 'sınırsız filtre sessiz kalmamalı');
});

test('rota: kişisel kayıt ortak kayda yazmaz, Sync yayını yapmaz; ortak kayıt yetki ister', () => {
  const start = ROUTES.indexOf("app.post('/api/data-management/filter'");
  const route = ROUTES.slice(start, ROUTES.indexOf('\n});', start));
  const routeLine = route.slice(0, route.indexOf('\n'));
  assert.doesNotMatch(routeLine, /requirePermission\('manageModelConnections'\)/, 'kişisel kaydetme herkese açık olmalı');
  const personal = route.slice(route.indexOf("if (body.mode === 'personal')"), route.indexOf("if (!userAccess.hasPermission(req.currentUser, 'manageModelConnections'))"));
  assert.ok(personal.length > 50, 'kişisel dal yetki kontrolünden önce olmalı');
  assert.match(personal, /await personalHorizonService\.update\(\{ sourceId, moduleId, definition: body\.definition \}/);
  const nativePreferences=fs.readFileSync(path.join(APP,'server','lib','user-preferences.js'),'utf8');
  assert.match(nativePreferences,/function saveHorizons\(userId,modules,horizon/);
  assert.match(nativePreferences,/saved=applyEntryChanges\(userId,set,\[\],options\)/);
  assert.match(personal, /sourceUserId\(req\)/);
  assert.doesNotMatch(personal, /replaceModelConnections|publishSharedMasterChange/);
  const shared = route.slice(route.indexOf("if (!userAccess.hasPermission(req.currentUser, 'manageModelConnections'))"));
  assert.match(shared, /PERMISSION_REQUIRED/);
  assert.match(shared, /publishSharedMasterChange\('modelConnections', req\)/);
});

test('arayüz: varsayılan kaydetme kişiseldir; ortak kaydetme yalnız yetkiliye "Herkes için" görünür', () => {
  assert.match(FILTER_UI, /class="navActionBtn" data-save="personal"/);
  assert.doesNotMatch(FILTER_UI, /class="navActionBtn" data-save="shared"/, 'ortak kaydetme birincil düğme olmamalı');
  assert.match(FILTER_UI, /\$\{canShare \? \(shared\s*\?/);
  assert.match(FILTER_UI, /const canShare = context\.canShare === true;/);
  assert.match(FILTER_UI, /onSaved\(payload\.warnings \|\| \[\], payload\)/);

  const fn = UI.match(/function openFilterEditor\(moduleId, sourceId(?:, slotOverride = null)?\) \{[\s\S]*?\n  \}/)[0];
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /if \(!model\.canManage\) \{\s*if \(typeof showToast/, 'yetkisiz kullanıcı kendi filtresini düzenleyebilmeli');
  assert.match(code, /canShare: Boolean\(model\.canManage\)/);
  assert.match(code, /definition: feed\.effectiveDefinition \|\| feed\.definition \|\| \{\}/);
  assert.match(code, /forgetLocalHorizonMirror/);
});

test('arayüz: yetki isteyen şablon ve eşleme düğmeleri yalnız yetkiliye görünür', () => {
  assert.match(FILTER_UI, /\$\{canShare \? templateBar\(\) : ''\}/);
  assert.match(FILTER_UI, /if \(context\.canShare === true\) void loadTemplates\(\)\.then\(render\);/);
  const fn = UI.match(/function openFilterEditor\(moduleId, sourceId(?:, slotOverride = null)?\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /mapFrom: \(\(\) => \{\s*\/\/[^\n]*\n\s*if \(!model\.canManage\) return null;/);
});
