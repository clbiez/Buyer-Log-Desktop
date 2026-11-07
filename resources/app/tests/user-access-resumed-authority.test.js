'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, grant, isolate, response } = require('./fixtures/admin-03-resumed-authority.cjs');

const root = isolate();
const access = require('../server/lib/user-access');
const changedPasswordHash = access.hashPin('Changed-synthetic-only-456');
function changeCredentials(profile) {
  profile.passwordHash = profile.pinHash = changedPasswordHash;
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let sequence = 0;

async function selectedRequest(centralEnabled, configure = () => {}) {
  // Each fixture starts from local authority before its optional central hub is initialized.
  access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [], centralIam: { enabled: false } });
  // A previous synthetic hub must not supply its valid recovery copy or revision floor to the next fixture.
  for (const file of ['user-access.json.bak', 'user-access.meta.json']) {
    fs.rmSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, file), { force: true });
  }
  const initial = fixture(3, 2), salt = Buffer.alloc(16, 7);
  const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Synthetic-only-123', salt, 32).toString('hex')}`;
  for (const profile of [initial.moderator, ...initial.users]) profile.passwordHash = profile.pinHash = hash;
  initial.users[0].directPermissions = [grant('USER.GRANT')];
  configure(initial.users[0], initial);
  fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(initial));
  const prepared = access.loadStore();
  const sharedRoot = path.join(root, `central-${++sequence}`);
  fs.mkdirSync(sharedRoot, { recursive: true });
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [],
    centralIam: { enabled: centralEnabled, sharedRoot } });
  if (centralEnabled) await access.getCentralIam().initialize(prepared, { id: 'moderator' });
  const loginRes = response(), headers = {};
  loginRes.append = (key, value) => { headers[key] = value; }; loginRes.set = () => {};
  await runtime.loginHandler({ body: { username: 'demo-u0', password: 'Synthetic-only-123' }, headers: {}, socket: {} }, loginRes);
  assert.equal(loginRes.statusCode, 200, JSON.stringify(loginRes.body));
  const request = () => ({ headers: { cookie: headers['Set-Cookie'].split(';')[0] }, path: '/api/resumed-authority-probe', socket: {} });
  const req = request(); let selected = false;
  runtime.requireSelection(req, response(), () => { selected = true; });
  assert.equal(selected, true);
  const commit = async change => {
    const before = access.readStore(), next = access.loadStore();
    change(next.users.find(profile => profile.username === 'demo-u0'), next);
    if (centralEnabled) await access.getCentralIam().commit(next, before._revision, { id: 'moderator' });
    else access.saveStore(next, before._revision);
  };
  return { runtime, req, request, commit };
}

function callGate(handler, req) {
  const res = response(); let passed = false;
  handler(req, res, () => { passed = true; });
  return { status: passed ? 200 : res.statusCode, passed, code: res.body && res.body.code };
}

for (const centralEnabled of [false, true]) {
  const mode = centralEnabled ? 'central' : 'local';
  test(`${mode}: revoked USER.GRANT denies a resumed selected request as well as a fresh request`, async () => {
    const { runtime, req, request, commit } = await selectedRequest(centralEnabled);
    const gate = runtime.requireCapability('USER.GRANT');
    assert.equal(callGate(gate, req).passed, true);
    let release;
    const resumed = (async () => { await new Promise(resolve => { release = resolve; }); return callGate(gate, req); })();
    await commit(profile => { profile.directPermissions = []; });
    const store = access.readStore(), current = store.users.find(profile => profile.username === 'demo-u0');
    assert.equal(access.publicProfile(current, store).capabilities.includes('USER.GRANT'), false);
    const fresh = request(); runtime.requireSelection(fresh, response(), () => {});
    assert.equal(callGate(gate, fresh).status, 403);
    release();
    assert.equal((await resumed).status, 403, 'revoked USER.GRANT survived in req.currentUser after await');
    assert.equal(req.currentUser.id, current.id, 'access revocation must not log out an otherwise valid session');
    assert.deepEqual(req.currentUser.directPermissions, current.directPermissions);
  });
}

test('an unchanged authenticated request keeps its authority and receives a private profile', async () => {
  const { runtime, req } = await selectedRequest(false);
  const before = JSON.stringify(access.readStore());
  assert.equal(callGate(runtime.requireCapability('USER.GRANT'), req).status, 200);
  req.currentUser.displayName = 'request-local change';
  req.currentUser.directPermissions.length = 0;
  assert.equal(JSON.stringify(access.readStore()), before, 'request mutation must not modify the shared cached directory');
});

test('central credential replacement rejects the previously selected signed session', async () => {
  const { runtime, req, commit } = await selectedRequest(true);
  const revision = req.currentUser.credentialRevision;
  await commit(changeCredentials);
  const saved = access.readStore().users.find(profile => profile.username === 'demo-u0');
  assert.equal(saved.credentialRevision, revision + 1);
  assert.equal(callGate(runtime.requireCapability('USER.GRANT'), req).status, 403);
  assert.equal(req.currentUser, null);
});

test('a role downgrade removes moderator authority while retaining the valid session', async () => {
  const { runtime, req, commit } = await selectedRequest(false, profile => {
    profile.role = 'moderator'; profile.systemRole = 'moderator';
  });
  assert.equal(callGate(runtime.requireModerator, req).status, 200);
  await commit(profile => {
    profile.role = 'buyer'; profile.systemRole = 'buyer'; profile.directPermissions = [];
  });
  const current = access.readStore().users.find(profile => profile.username === 'demo-u0');
  assert.equal(current.systemRole, 'buyer');
  assert.equal(callGate(runtime.requireModerator, req).status, 403);
  assert.equal(callGate(runtime.requireUserAdmin, req).status, 403);
  assert.equal(req.currentUser.id, current.id);
  assert.equal(req.currentUser.systemRole, 'buyer');
});

test('a copied privileged request profile cannot bypass a missing signed cookie at any guard', async () => {
  const { runtime, req } = await selectedRequest(false, profile => {
    profile.role = 'moderator'; profile.systemRole = 'moderator';
  });
  const captured = JSON.parse(JSON.stringify(req.currentUser));
  for (const gate of [runtime.requireModerator, runtime.requireUserAdmin, runtime.requireCapability('USER.GRANT'),
    runtime.requirePermission('manageBackup'), runtime.requireArea('cp'), runtime.requireAnyArea('cp', 'orders')]) {
    const unsigned = { ...req, headers: {}, currentUser: JSON.parse(JSON.stringify(captured)) };
    assert.equal(callGate(gate, unsigned).status, 403);
    assert.equal(unsigned.currentUser, null);
  }
});

for (const [name, change] of [
  ['inactive account', profile => { profile.status = 'INACTIVE'; profile.enabled = false; }],
  ['new credential revision', changeCredentials],
  ['deleted account', (profile, store) => { store.users = store.users.filter(item => item.id !== profile.id); }],
]) {
  test(`${name} cannot keep using authority captured before an await`, async () => {
    const { runtime, req, commit } = await selectedRequest(false);
    assert.equal(callGate(runtime.requireCapability('USER.GRANT'), req).status, 200);
    const credentialRevision = req.currentUser.credentialRevision;
    await commit(change);
    if (name === 'new credential revision') {
      const saved = access.readStore().users.find(profile => profile.username === 'demo-u0');
      assert.equal(saved.credentialRevision, credentialRevision + 1, 'the durable credential writer must advance the cookie generation');
    }
    assert.equal(callGate(runtime.requireCapability('USER.GRANT'), req).status, 403);
    assert.equal(req.currentUser, null);
  });
}

for (const [name, handler] of [
  ['moderator', runtime => runtime.requireModerator],
  ['user administrator', runtime => runtime.requireUserAdmin],
  ['capability', runtime => runtime.requireCapability('USER.GRANT')],
  ['legacy permission', runtime => runtime.requirePermission('manageBackup')],
  ['single area', runtime => runtime.requireArea('cp')],
  ['any area', runtime => runtime.requireAnyArea('cp', 'orders')],
]) {
  test(`${name} guard rejects a session whose credentials changed after selection`, async () => {
    const { runtime, req, commit } = await selectedRequest(false, profile => {
      profile.role = 'moderator'; profile.systemRole = 'moderator';
    });
    const gate = handler(runtime);
    assert.equal(callGate(gate, req).status, 200, 'the initial authenticated role must be allowed');
    const credentialRevision = req.currentUser.credentialRevision;
    await commit(changeCredentials);
    const saved = access.readStore().users.find(profile => profile.username === 'demo-u0');
    assert.equal(saved.credentialRevision, credentialRevision + 1, 'the durable credential writer must advance the cookie generation');
    assert.equal(callGate(gate, req).status, 403);
    assert.equal(req.currentUser, null);
  });
}

test('grant time boundaries are checked again without a store revision change', async () => {
  const start = Date.now(), end = start + 60000;
  const { runtime, req } = await selectedRequest(false, profile => {
    profile.directPermissions = [grant('USER.GRANT', { validFrom: new Date(start).toISOString(), validUntil: new Date(end).toISOString() })];
  });
  const gate = runtime.requireCapability('USER.GRANT'), revision = access.readStore()._revision;
  const originalNow = Date.now;
  try {
    Date.now = () => start - 1;
    assert.equal(callGate(gate, req).status, 403);
    Date.now = () => start;
    assert.equal(callGate(gate, req).status, 200);
    Date.now = () => end - 1;
    assert.equal(callGate(gate, req).status, 200);
    Date.now = () => end;
    assert.equal(callGate(gate, req).status, 403);
    assert.equal(access.readStore()._revision, revision);
  } finally { Date.now = originalNow; }
});
