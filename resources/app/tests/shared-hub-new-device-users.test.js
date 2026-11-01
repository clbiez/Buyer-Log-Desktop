'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');
const { createSharedHub } = require('../server/lib/shared-hub');

const APP = path.resolve(__dirname, '..');
const PASSWORD = 'Demo-password-123';
const salt = crypto.randomBytes(16);
const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(PASSWORD, salt, 32).toString('hex')}`;
function directory(names = []) {
  const profile = (id, role) => ({ id, username:id, displayName:id, title:'Demo',
    role, systemRole:role, enabled:true, status:'ACTIVE', passwordHash:hash, pinHash:hash,
    directPermissions:[], temporaryPermissions:[], collectionAccess:[], accessAreas:{}, permissions:{}, mags:[], mmygs:[], buyingGroups:[],
    managerId:role === 'moderator' ? null : 'moderator', supervisorId:role === 'moderator' ? null : 'moderator' });
  return iam.migrateStore({ schemaVersion:8, _revision:1,
    moderator:{ ...profile('moderator', 'moderator'), username:'demo.admin' }, users:names.map(name => profile(name, 'buyer')) });
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-new-device-'));
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) {
      const stopped = once(child, 'exit'); child.kill();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await stopped; clearTimeout(timer);
    }
    fs.rmSync(root, { recursive:true, force:true });
  });
  const shared = path.join(root, 'SYNC'); fs.mkdirSync(shared);
  const hub = createSharedHub({ localDataRoot:path.join(root, 'publisher', 'local') });
  const { manifest } = await hub.initialize(shared);
  const publisher = central.createCentralIam({ sharedRoot:shared, cacheFile:path.join(root, 'publisher', 'auth', 'user-access.json') });
  await publisher.initialize(directory(['demo.buyer', 'demo.manager']), { id:'moderator' });
  await hub.publishMaster(shared, { records:{ 'store:email-groups.json':{ records:[{ id:'demo-mail', email:'demo@example.com' }], countries:[], types:[] } } });
  await hub.publishBusiness(shared, { records:{ 'cp-order:12345||':{ subManufacturer:'Demo Supplier', _revision:1 } }, syncHeads:{} });
  async function device({ initial, completed = false, cached = false } = {}) {
    const home = path.join(root, 'device-' + children.length);
    const auth = path.join(home, 'auth'), local = path.join(home, 'local');
    fs.mkdirSync(auth, { recursive:true }); fs.mkdirSync(local, { recursive:true });
    if (initial) fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    if (cached) await central.createCentralIam({ sharedRoot:shared, cacheFile:path.join(auth, 'user-access.json') }).refresh();
    if (completed) await createSharedHub({ localDataRoot:local }).markBootstrap({ root:shared, hubId:manifest.hubId, iamRevision:0 });
    fs.writeFileSync(path.join(local, 'sync-settings.json'), JSON.stringify({ sharedSyncRoot:shared }));
    const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const config = path.join(home, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ host:'127.0.0.1', port, centralIamEnabled:false, refreshWithExcel:false, updates:{ enabled:false } }));
    const env = { ...process.env, BUYER_LOG_CONFIG_PATH:config, BUYER_LOG_CENTRAL_IAM_ENABLED:'0',
      BUYER_LOG_DATA_ROOT:path.join(home, 'app'), BUYER_LOG_LOCAL_DATA_ROOT:local,
      BUYER_LOG_SERVER_DATA_ROOT:path.join(home, 'server'), BUYER_LOG_AUTH_DATA_ROOT:auth,
      BUYER_LOG_PORTABLE_DATA_ROOT:path.join(home, 'portable'), BUYER_LOG_TEMP_ROOT:path.join(home, 'temp'), BL_KEEP_ALIVE:'1' };
    delete env.BUYER_LOG_IAM_SHARED_ROOT; delete env.BUYER_LOG_LOCAL_DB;
    const child = spawn(process.execPath, ['server/server.js'], { cwd:APP, env, stdio:['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    const base = `http://127.0.0.1:${port}`;
    async function request(url, body, cookie) {
      const response = await fetch(base + url, { method:body === undefined ? 'GET' : 'POST',
        headers:{ 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}) }, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(5000) });
      return { status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function settled() {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, 'backend exited: ' + output);
        let result;
        try { result = await request('/api/shared-hub/bootstrap-status'); } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
        if (result?.body.configured && !['starting', 'syncing'].includes(result.body.status)) return result.body;
        await delay(50);
      }
      throw new Error('bootstrap timed out: ' + output);
    }
    return { request, settled, auth, local, base };
  }
  return { device, shared, publisher, root };
}

test('new computer imports the shared directory, settings and business checkpoint before reporting ready', async t => {
  const f = await fixture(t), device = await f.device({ initial:directory() });
  const status = await device.settled();
  assert.equal(status.status, 'ready', JSON.stringify(status));
  assert.equal(status.steps.users.current, 3);
  assert.equal(status.dataInventory.localMasterRecords >= 1, true);
  assert.equal(status.dataInventory.localBusinessRecords >= 1, true);
  assert.equal(status.iamRevision, 1);
  const suggestions = await device.request('/api/auth/users/suggest?q=demo');
  assert.deepEqual(suggestions.body.users.map(user => user.loginName).sort(), ['demo.admin', 'demo.buyer', 'demo.manager']);
  assert.equal(JSON.stringify(suggestions.body).includes('passwordHash'), false);
  const login = await device.request('/api/user-login', { username:'demo.buyer', password:PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal((await device.request('/api/current-user', undefined, login.cookie)).body.user.username, 'demo.buyer');
});

test('a remembered completed Hub cannot strand a single local Moderator instead of the shared users', async t => {
  const f = await fixture(t), device = await f.device({ initial:directory(), completed:true });
  const status = await device.settled();
  assert.equal(status.status, 'ready', JSON.stringify(status));
  assert.equal(status.steps.users.current, 3, 'completion metadata does not prove that the IAM directory was imported');
  assert.equal((await device.request('/api/auth/users/suggest?q=demo.buyer')).body.users.length, 1);
});

test('an unreadable shared IAM never reports users synchronized merely because one local account can log in', async t => {
  const f = await fixture(t);
  fs.renameSync(path.join(f.shared, 'iam', 'revisions'), path.join(f.shared, 'iam', 'parked-revisions'));
  const device = await f.device({ initial:directory() });
  const status = await device.settled();
  assert.equal(status.status, 'error', JSON.stringify(status));
  assert.equal(status.steps.users.status, 'error');
  assert.equal(status.errorCode, 'IAM_NOT_INITIALIZED');
  assert.equal(status.loginAllowed, true, 'a synchronization failure must preserve local sign-in');
  assert.equal((await device.request('/api/user-login', { username:'demo.admin', password:PASSWORD })).status, 200);
});

test('a real independent local directory stays protected and the migration conflict remains visible', async t => {
  const f = await fixture(t), device = await f.device({ initial:directory(['local.buyer']), completed:true });
  const status = await device.settled();
  assert.equal(status.status, 'offline', JSON.stringify(status));
  assert.equal(status.errorCode, 'IAM_MIGRATION_CONFLICT');
  assert.equal(status.steps.users.status, 'error');
  assert.equal(JSON.parse(fs.readFileSync(path.join(device.auth, 'user-access.json'))).users[0].username, 'local.buyer');
  assert.equal(f.publisher.readLocal().users.length, 2, 'joining never republishes local users into the Hub');
  assert.equal(fs.readdirSync(path.join(f.shared, 'iam', 'revisions')).length, 1);
});

test('a clean computer without any auth file receives all shared login accounts', async t => {
  const f = await fixture(t), device = await f.device();
  const status = await device.settled();
  assert.equal(status.status, 'ready', JSON.stringify(status));
  assert.equal(status.steps.users.current, 3);
  assert.equal((await device.request('/api/user-login', { username:'demo.buyer', password:PASSWORD })).status, 200);
});

test('a clean computer with unavailable shared IAM cannot advertise a nonexistent local login', async t => {
  const f = await fixture(t);
  fs.renameSync(path.join(f.shared, 'iam', 'revisions'), path.join(f.shared, 'iam', 'parked-revisions'));
  const device = await f.device();
  const status = await device.settled();
  assert.equal(status.status, 'error', JSON.stringify(status));
  assert.equal(status.steps.users.status, 'error');
  assert.equal(status.errorCode, 'IAM_NOT_INITIALIZED');
  assert.equal(status.loginAllowed, false);
});

test('a verified offline directory keeps existing users available without claiming a successful shared refresh', async t => {
  const f = await fixture(t), device = await f.device({ cached:true, completed:true });
  assert.equal((await device.settled()).status, 'ready');
  fs.renameSync(path.join(f.shared, 'iam', 'revisions'), path.join(f.shared, 'iam', 'parked-revisions'));
  await device.request('/api/shared-hub/bootstrap-retry', {});
  const status = await device.settled();
  assert.equal(status.status, 'offline', JSON.stringify(status));
  assert.equal(status.steps.users.status, 'error');
  assert.equal(status.errorCode, 'IAM_NOT_INITIALIZED');
  assert.equal((await device.request('/api/auth/users/suggest?q=demo.buyer')).body.users.length, 1);
  assert.equal((await device.request('/api/user-login', { username:'demo.buyer', password:PASSWORD })).status, 200);
});
