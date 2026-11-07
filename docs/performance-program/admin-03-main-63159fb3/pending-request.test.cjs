'use strict';
// Explicit security acceptance gate. A failure blocks ADMIN-03 implementation.
// Kept in the diagnosis package: run separately; never presented as npm-test PASS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, grant, isolate, response } = require('./fixture.cjs');
const root = isolate();
const access = require('../../../resources/app/server/lib/user-access');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function seed() {
  const initial = fixture(3, 2), salt = Buffer.alloc(16, 7);
  const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Synthetic-only-123', salt, 32).toString('hex')}`;
  for (const profile of [initial.moderator, ...initial.users]) profile.passwordHash = profile.pinHash = hash;
  initial.users[0].directPermissions = [grant('USER.GRANT')];
  fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(initial));
  return access.loadStore();
}
function gate(runtime, req) {
  const res = response(); let passed = false;
  runtime.requireCapability('USER.GRANT')(req, res, () => { passed = true; });
  return { status: passed ? 200 : res.statusCode, passed, code: res.body && res.body.code };
}
for (const centralEnabled of [false, true]) {
  const mode = centralEnabled ? 'central' : 'local';
  test(`ADMIN-03 ${mode}: revocation while a selected request is awaiting must deny the resumed capability gate`, async () => {
    const initial = seed();
    const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [],
      centralIam: { enabled: centralEnabled, sharedRoot: process.env.BUYER_LOG_IAM_SHARED_ROOT } });
    if (centralEnabled) await access.getCentralIam().initialize(initial, { id: 'moderator' });
    const loginRes = response(), headers = {};
    loginRes.append = (key, value) => { headers[key] = value; }; loginRes.set = () => {};
    await runtime.loginHandler({ body: { username: 'demo-u0', password: 'Synthetic-only-123' }, headers: {}, socket: {} }, loginRes);
    assert.equal(loginRes.statusCode, 200, JSON.stringify(loginRes.body));
    const request = () => ({ headers: { cookie: headers['Set-Cookie'].split(';')[0] }, path: '/api/admin03-probe', socket: {} });
    const pending = request(); let selected = false;
    runtime.requireSelection(pending, response(), () => { selected = true; });
    assert.equal(selected, true); assert.equal(gate(runtime, pending).passed, true);
    const before = access.readStore(), startedAt = new Date().toISOString();
    let release;
    const resumed = (async () => { await new Promise(resolve => { release = resolve; }); return gate(runtime, pending); })();
    const next = access.loadStore(); next.users.find(p => p.username === 'demo-u0').directPermissions = [];
    if (centralEnabled) await access.getCentralIam().commit(next, before._revision, { id: 'moderator' });
    else access.saveStore(next, before._revision);
    const after = access.readStore(), current = after.users.find(p => p.username === 'demo-u0');
    assert.equal(access.publicProfile(current, after).capabilities.includes('USER.GRANT'), false);
    const fresh = request(); runtime.requireSelection(fresh, response(), () => {});
    const freshResult = gate(runtime, fresh); assert.equal(freshResult.status, 403);
    release(); const pendingResult = await resumed;
    const evidence = { mode, startedAt, endedAt: new Date().toISOString(), beforeRevision: before._revision,
      afterRevision: after._revision, currentDirectoryGrant: false, freshResult, pendingResult,
      expectedPendingStatus: 403, productionChanged: false };
    fs.writeFileSync(path.join(__dirname, 'artifacts', `pending-${mode}.json`), JSON.stringify(evidence, null, 2) + '\n');
    assert.equal(pendingResult.status, 403, 'revoked USER.GRANT survived in req.currentUser after await');
  });
}
