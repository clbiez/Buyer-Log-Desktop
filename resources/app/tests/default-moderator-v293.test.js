'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-default-moderator-v293-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const access = require('../server/lib/user-access');
const serverSource = require('./helpers/server-source')();
const uiSource = fs.readFileSync(path.join(__dirname, '../public/user-access-ui.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(__dirname, '../public/user-storage.js'), 'utf8');
const stopScriptSource = fs.readFileSync(path.join(__dirname, '../server/lib/StopBuyerLog.ps1'), 'utf8')
  + fs.readFileSync(path.join(__dirname, '../server/lib/stop-buyer-log.js'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '../server/lib/auth.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function responseMock() {
  return {
    headers: [], statusCode: 200, body: null, redirectTo: null,
    append(name, value) { this.headers.push([name, value]); return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    redirect(code, value) { this.statusCode = code; this.redirectTo = value; return this; },
  };
}

test('default Moderator identity is Gökberk while its stable ID remains moderator', () => {
  const store = access.loadStore();
  assert.equal(store.moderator.id, 'moderator');
  assert.equal(store.moderator.role, 'moderator');
  assert.equal(store.moderator.displayName, 'Gökberk');
  assert.equal(access.DEFAULT_MODERATOR_NAME, 'Gökberk');
});

test('old generic Moderator display label migrates to Gökberk without changing the ID', () => {
  const dataRoot = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'user-access.json'), JSON.stringify({
    schemaVersion: 1,
    moderator: { id: 'moderator', role: 'moderator', displayName: 'Moderatör', enabled: true, pinHash: '' },
    users: [], orderAccess: {}, _revision: 4,
  }));
  const store = access.loadStore();
  assert.equal(store.moderator.id, 'moderator');
  assert.equal(store.moderator.displayName, 'Gökberk');
});

// Kullanıcı kararı: kök "/" isteğinde otomatik Moderatör girişi bilerek kaldırıldı
// (autoSelectModerator ölü kodu da server/lib/user-access.js'ten silindi); oturum yoksa
// her zaman seçim ekranına yönlendirilir, tıpkı diğer korumalı yollarda olduğu gibi.
test('a fresh root request without a session redirects to the selector instead of auto-logging in', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const req = { method: 'GET', path: '/', headers: {}, secure: false, socket: { remoteAddress: '127.0.0.1' } };
  const res = responseMock();
  let nextCalled = false;
  runtime.requireSelection(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(req.currentUser, undefined);
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectTo, '/select-user.html');
  assert.equal(res.headers.length, 0, 'oturum açılmadığı için çerez yazılmamalı');
});

test('explicit selector paths remain selectable and do not auto-login', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  for (const selectorPath of ['/select-user', '/select-user/', '/select-user.html']) {
    const req = { method: 'GET', path: selectorPath, headers: {}, secure: false, socket: { remoteAddress: '127.0.0.1' } };
    const res = responseMock();
    let nextCalled = false;
    runtime.requireSelection(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, selectorPath);
    assert.equal(req.currentUser, undefined, selectorPath);
    assert.equal(res.headers.length, 0, selectorPath);
  }
});

test('server exposes extensionless and explicit HTML selector routes', () => {
  assert.match(serverSource, /app\.get\('\/select-user', sendUserSelectionPage\)/);
  assert.match(serverSource, /app\.get\(\['\/select-user\/', '\/select-user\.html'\], sendUserSelectionPage\)/);
  assert.match(serverSource, /Cache-Control', 'no-store'/);
  assert.match(uiSource, /location\.assign\('\/select-user\.html\?switch=1'\)/);
  assert.doesNotMatch(uiSource, /fetch\('\/api\/user-logout'/);
});

test('Moderator settings retain the moderator namespace and legacy values are copied missing-only', () => {
  const values = new Map([
    ['lcw_theme', 'dark'],
    ['lcw.cp.dimFilters.main', '{"buyer":["Gökberk"]}'],
    ['bl.user.moderator.lcw_theme', 'charcoal'],
    ['bl.user.G_kberk.lcw_rail', 'min'],
  ]);
  const native = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); },
  };
  const window = { localStorage: native, BL_USER_CONTEXT: { id: 'moderator', displayName: 'Gökberk' } };
  vm.runInNewContext(storageSource, { window });
  assert.equal(window.BLStorage.actualKey('lcw_theme'), 'bl.user.moderator.lcw_theme');
  assert.equal(window.BLStorage.getItem('lcw_theme'), 'charcoal', 'newer moderator value must not be overwritten');
  assert.equal(values.get('bl.user.moderator.lcw.cp.dimFilters.main'), '{"buyer":["Gökberk"]}');
  assert.equal(values.get('bl.user.moderator.lcw_rail'), 'min');
});


test('status is available before selection and launcher replaces a stale Buyer Log process', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const req = { method: 'GET', path: '/api/status', headers: {}, secure: false, socket: { remoteAddress: '127.0.0.1' } };
  const res = responseMock();
  let nextCalled = false;
  runtime.requireSelection(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.currentUser, undefined);
  assert.match(serverSource, /app: 'Buyer Log', appVersion: APP_VERSION/);
  assert.match(serverSource, /auth\.enabled && !auth\.isAuthenticated\(req\)/);
  assert.match(authSource, /'\/api\/status'/);
  // Sürüm literali her yayında güncellenir (CLAUDE.md); sabit değeri değil varlığını sına.
  assert.match(stopScriptSource, /stop-buyer-log\.js/);
  assert.match(stopScriptSource, /verifiedWatchdog/);
  assert.match(stopScriptSource, /verifiedServer/);
  assert.doesNotMatch(stopScriptSource, new RegExp('task' + 'kill(?:\\.exe)?', 'i'));
  assert.match(stopScriptSource, /watchdog\\\.js/);
});
