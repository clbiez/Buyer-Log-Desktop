'use strict';

// Regresyon: uygulama açıkken sunucu süreci çöküp gözetmen (watchdog) onu
// yeniden başlatınca, açık kullanıcı oturumu geçersizleşip giriş ekranına
// dönülüyordu. Oturum imza anahtarı her süreçte rastgele üretildiği için
// yeniden başlatma bütün çerezleri düşürüyordu. Gözetmen artık kendi ömrü
// boyunca sabit bir anahtarı sunucuya yalnız ortam değişkeniyle (diske
// yazmadan) aktarır.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-session-restart-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const access = require('../server/lib/user-access');
const watchdogSource = fs.readFileSync(path.join(__dirname, '../server/watchdog.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const SECRET = 'ab'.repeat(32);
const deps = { ensureDataLoaded: async () => {}, getOrders: () => [] };

function responseMock() {
  return {
    headers: [], statusCode: 200, body: null,
    append(name, value) { this.headers.push([name, value]); return this; },
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    redirect(code, value) { this.statusCode = code; this.body = value; return this; },
  };
}
function request(extra = {}) {
  return { method: 'POST', path: '/api/user-login', headers: {}, secure: false, socket: { remoteAddress: '127.0.0.1' }, ...extra };
}
async function loginCookie(runtime) {
  const res = responseMock();
  await runtime.loginHandler(request({ body: { username: access.DEFAULT_MODERATOR_NAME, password: 'restart-pass-123', newPassword: 'restart-pass-123' } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const header = res.headers.find(([name]) => name === 'Set-Cookie');
  return header[1].split(';')[0];
}
function isSelected(runtime, cookie) {
  const res = responseMock();
  runtime.currentHandler(request({ method: 'GET', path: '/api/current-user', headers: { cookie } }), res);
  return res.body.selected;
}

test('session cookie survives a server restart under the same watchdog secret', async () => {
  process.env.BUYER_LOG_USER_SESSION_SECRET = SECRET;
  const first = access.buildUserAccess(deps);
  assert.equal(process.env.BUYER_LOG_USER_SESSION_SECRET, undefined, 'anahtar alt süreçlere sızmamalı');
  const cookie = await loginCookie(first);
  assert.equal(isSelected(first, cookie), true);

  process.env.BUYER_LOG_USER_SESSION_SECRET = SECRET; // gözetmen yeni sürece aynı anahtarı verir
  const restarted = access.buildUserAccess(deps);
  assert.equal(isSelected(restarted, cookie), true, 'yeniden başlatma oturumu düşürmemeli');
});

test('without an inherited secret (or with a malformed one) sessions stay process-local', async () => {
  process.env.BUYER_LOG_USER_SESSION_SECRET = SECRET;
  const cookie = await loginCookie(access.buildUserAccess(deps));
  delete process.env.BUYER_LOG_USER_SESSION_SECRET;
  assert.equal(isSelected(access.buildUserAccess(deps), cookie), false);
  process.env.BUYER_LOG_USER_SESSION_SECRET = 'short';
  assert.equal(isSelected(access.buildUserAccess(deps), cookie), false);
});

test('watchdog generates one in-memory secret per lifetime and passes it to every server start', () => {
  assert.match(watchdogSource, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(watchdogSource, /BUYER_LOG_USER_SESSION_SECRET: USER_SESSION_SECRET/);
  assert.doesNotMatch(watchdogSource, /writeFileSync\([^)]*USER_SESSION_SECRET/);
});
