'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-login-throttle-'));
Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: root, BUYER_LOG_AUTH_DATA_ROOT: root, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_CENTRAL_IAM_ENABLED: '0' });
const iam = require('../server/lib/iam-core'), access = require('../server/lib/user-access'), express = require('express');
const password = 'Synthetic-only-123', hash = access.hashPin(password);
fs.writeFileSync(path.join(root, 'user-access.json'), JSON.stringify(iam.migrateStore({ schemaVersion: 8, _revision: 1,
  moderator: { id: 'moderator', username: 'admin', displayName: 'Synthetic Admin', role: 'moderator', systemRole: 'moderator', enabled: true, passwordHash: hash, pinHash: hash },
  users: [{ id: 'buyer', username: 'buyer', displayName: 'Synthetic Buyer', role: 'buyer', systemRole: 'buyer', enabled: true, passwordHash: hash, pinHash: hash }],
})));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
async function fixture(run) {
  const app = express(), runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  app.use(express.json()); app.post('/login', runtime.loginHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const login = async (body = {}, headers = {}) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ username: 'admin', password: 'wrong', ...body }) });
    return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
  };
  try { await run(login); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('live HTTP forged forwarding headers, case variants and legacy userId share one account lock', async () => {
  await fixture(async login => {
    for (let i = 0; i < 5; i++) assert.equal((await login({}, { 'x-forwarded-for': '192.0.2.1' })).status, 401);
    for (const headers of [{}, { 'x-forwarded-for': '192.0.2.2' }, { 'x-forwarded-for': '198.51.100.1, 203.0.113.1', forwarded: 'for=203.0.113.5', 'x-real-ip': '203.0.113.7' }]) {
      const result = await login({ username: 'ADMİN' }, headers);
      assert.equal(result.status, 429); assert.ok(Number(result.retryAfter) > 0);
    }
    assert.equal((await login({ username: '', userId: 'moderator' })).status, 429);
    assert.equal((await login({ username: 'buyer', password })).status, 200, 'one locked account does not lock the team on the same socket');
  });
});
test('unknown accounts receive bounded failure handling too', async () => {
  await fixture(async login => {
    for (let i = 0; i < 5; i++) assert.equal((await login({ username: 'absent' })).status, 401);
    assert.equal((await login({ username: 'ABSENT' }, { 'x-forwarded-for': '192.0.2.8' })).status, 429);
  });
});
test('parallel failures are counted before the next password verification', async () => {
  await fixture(async login => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => login({}, { 'x-forwarded-for': '192.0.2.' + i })));
    assert.equal(results.filter(result => result.status === 401).length, 5);
    assert.equal(results.filter(result => result.status === 429).length, 7);
  });
});
test('live lock expires without traffic extending it; successful sign-in clears failure history', async () => {
  await fixture(async login => {
    const originalNow = Date.now, start = originalNow(); let elapsed = 0;
    Date.now = () => start + elapsed;
    try {
      for (let i = 0; i < 5; i++) await login();
      assert.equal((await login({ password })).status, 429);
      elapsed = 61000;
      assert.equal((await login({ password })).status, 200);
      for (let i = 0; i < 4; i++) assert.equal((await login()).status, 401);
      assert.equal((await login({ password })).status, 200);
      assert.equal((await login()).status, 401);
    } finally { Date.now = originalNow; }
  });
});
