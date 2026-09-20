'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { withFileLeaseAsync } = require('../server/lib/shared-file-transaction');
const { createDeltaStore } = require('../server/lib/delta-store');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const leaseModule = path.resolve(__dirname, '../server/lib/shared-file-transaction.js');

function startLeaseHolder(t, file, { crash = false, holdMs = 500 } = {}) {
  const script = `
    const { withFileLeaseAsync } = require(process.env.TEST_LEASE_MODULE);
    withFileLeaseAsync(process.env.TEST_LEASE_FILE, async () => {
      if (process.send) process.send('locked');
      if (process.env.TEST_LEASE_CRASH === '1') process.exit(0);
      await new Promise(resolve => setTimeout(resolve, Number(process.env.TEST_LEASE_HOLD_MS)));
    }).then(() => process.exit(0), () => process.exit(2));
  `;
  const child = spawn(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      TEST_LEASE_MODULE: leaseModule,
      TEST_LEASE_FILE: file,
      TEST_LEASE_CRASH: crash ? '1' : '0',
      TEST_LEASE_HOLD_MS: String(holdMs),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const locked = new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', code => { if (code && code !== 0) reject(new Error(`lease holder exited: ${code}`)); });
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  return { child, locked, exited };
}

async function tempRoot(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

test('same-process writes for one resource wait in a local queue instead of reporting another instance', async t => {
  const root = await tempRoot(t, 'buyerlog-local-lease-');
  const file = path.join(root, 'shared.json');
  let active = 0, maxActive = 0, firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });

  const first = withFileLeaseAsync(file, async () => {
    active += 1; maxActive = Math.max(maxActive, active); firstStarted();
    await sleep(180);
    active -= 1;
    return 'first';
  }, { timeoutMs: 100 });
  await started;
  const second = withFileLeaseAsync(file, async () => {
    active += 1; maxActive = Math.max(maxActive, active);
    active -= 1;
    return 'second';
  }, { timeoutMs: 100 });

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(maxActive, 1);
});

test('recent lease owned by a dead local process is recovered without waiting for TTL', async t => {
  const root = await tempRoot(t, 'buyerlog-stale-lease-');
  const file = path.join(root, 'shared.json');
  const lockDir = `${path.resolve(file)}.write-lock`;
  await fsp.mkdir(lockDir, { recursive: true });
  await fsp.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({
    token: 'orphan-token',
    instanceId: 'orphan-instance',
    machine: os.hostname(),
    pid: 2147483647,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  }));

  const result = await withFileLeaseAsync(file, async () => 'recovered', {
    timeoutMs: 120,
    staleMs: 60000,
  });

  assert.equal(result, 'recovered');
});

test('a live second process remains a genuine lease conflict', async t => {
  const root = await tempRoot(t, 'buyerlog-live-lease-');
  const file = path.join(root, 'shared.json');
  const holder = startLeaseHolder(t, file, { holdMs: 400 });
  await holder.locked;

  await assert.rejects(
    withFileLeaseAsync(file, async () => 'must-not-run', { timeoutMs: 120 }),
    error => error && error.code === 'SHARED_WRITE_BUSY' && Number(error.owner && error.owner.pid) === holder.child.pid
  );
  await holder.exited;
});

test('a lock orphaned by a crashed process is recovered on reopen', async t => {
  const root = await tempRoot(t, 'buyerlog-crashed-lease-');
  const file = path.join(root, 'shared.json');
  const holder = startLeaseHolder(t, file, { crash: true });
  await holder.locked;
  await holder.exited;

  assert.equal(await withFileLeaseAsync(file, async () => 'reopened', { timeoutMs: 150 }), 'reopened');
});

test('parallel mirror invocations are persisted one at a time without losing any patch', async () => {
  let active = 0, maxActive = 0;
  const persisted = [];
  const localDb = {
    queuePatches: async items => {
      active += 1; maxActive = Math.max(maxActive, active);
      await sleep(10);
      persisted.push(...items.map(item => item.id));
      active -= 1;
      return { count: items.length };
    },
  };
  const store = createDeltaStore({ localDb });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    store.mirror('collection-note', { [`note-${index}`]: { text: `Note ${index}` } })
  ));

  assert.equal(maxActive, 1);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(new Set(persisted).size, 20);
});

test('twenty concurrent local saves remain durable and deadlock-free', async t => {
  const root = await tempRoot(t, 'buyerlog-local-saves-');
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));

  await Promise.all(Array.from({ length: 20 }, (_, index) => db.queuePatch({
    id: `record-${index}`,
    entityType: 'regression',
    patch: { value: index },
  })));

  const state = await db.read();
  assert.equal(Object.keys(state.records).filter(key => key.startsWith('record-')).length, 20);
  assert.equal((await db.pending()).length, 20);
});

test('automatic and manual sync requests share one worker while a new save remains durable', async t => {
  const root = await tempRoot(t, 'buyerlog-sync-single-flight-');
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  const events = [];
  const sync = createSyncSettings({
    localDataRoot: path.join(root, 'settings'),
    localDb: db,
    trace: (name, detail) => events.push({ name, detail }),
  });
  await sync.save(shared);
  await db.queuePatch({ id: 'before-sync', entityType: 'regression', patch: { value: 1 } });

  await Promise.all([
    sync.syncOnce(),
    sync.syncOnce(),
    db.queuePatch({ id: 'during-sync', entityType: 'regression', patch: { value: 2 } }),
  ]);

  assert.equal(events.filter(event => event.name === 'NETWORK_FIRST_ACCESS').length, 1);
  const state = await db.read();
  assert.equal(state.records['before-sync'].value, 1);
  assert.equal(state.records['during-sync'].value, 2);
  assert.equal(state.journal.filter(item => item.id === 'before-sync' || item.id === 'during-sync').length, 2);
});
