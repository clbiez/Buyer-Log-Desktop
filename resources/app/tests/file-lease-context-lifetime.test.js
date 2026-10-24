'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { withFileLeaseSync, withFileLeaseAsync, replaceFileWithRetry } = require('../server/lib/shared-file-transaction');
const fsSync = require('node:fs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-lease-context-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const parent = path.join(dir, 'parent'), child = path.join(dir, 'child'), staged = path.join(dir, 'staged');
  await fs.writeFile(staged, 'durable');
  return { parent, child, staged };
}

for (const kind of ['sync', 'async']) {
  test(`a separately leased write after a completed ${kind} scope ignores the completed parent`, async t => {
    const box = await fixture(t);
    let finish, deferred;
    const gate = new Promise(resolve => { finish = resolve; });
    const queue = () => { deferred = gate.then(() => withFileLeaseAsync(box.child, () => replaceFileWithRetry(box.staged, box.child))); };
    if (kind === 'sync') withFileLeaseSync(box.parent, queue);
    else await withFileLeaseAsync(box.parent, queue);
    finish();
    await deferred;
    assert.equal(await fs.readFile(box.child, 'utf8'), 'durable');
  });
}

test('an active outer lease that loses ownership still fences a separately leased write', async t => {
  const box = await fixture(t);
  await assert.rejects(withFileLeaseAsync(box.parent, async () => {
    const ownerPath = path.join(box.parent + '.write-lock', 'owner.json');
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    await fs.writeFile(ownerPath, JSON.stringify({ ...owner, token: 'successor' }));
    await withFileLeaseAsync(box.child, () => replaceFileWithRetry(box.staged, box.child));
  }), { code: 'SHARED_LEASE_LOST' });
  assert.equal(await fs.readFile(box.staged, 'utf8'), 'durable');
  await assert.rejects(fs.access(box.child), { code: 'ENOENT' });
});

test('a detached write without a new lease stays fenced after its original scope ends', async t => {
  const box = await fixture(t);
  let finish, deferred;
  const gate = new Promise(resolve => { finish = resolve; });
  withFileLeaseSync(box.parent, () => { deferred = gate.then(() => replaceFileWithRetry(box.staged, box.child)); });
  finish();
  await assert.rejects(deferred, { code: 'SHARED_LEASE_LOST' });
  assert.equal(await fs.readFile(box.staged, 'utf8'), 'durable');
});

test('a transient Windows metadata rename denial retries before entering the callback', async t => {
  const box = await fixture(t), rename = fsSync.renameSync;
  let injected = false, entered = false;
  fsSync.renameSync = (source, target) => {
    if (!injected && target === path.join(box.parent + '.write-lock', 'owner.json')) {
      injected = true;
      throw Object.assign(new Error('synthetic Windows sharing violation'), { code: 'EPERM' });
    }
    return rename(source, target);
  };
  try { await withFileLeaseAsync(box.parent, lease => { entered = true; lease.assertOwned(); }); }
  finally { fsSync.renameSync = rename; }
  assert.equal(injected, true);
  assert.equal(entered, true);
  await assert.rejects(fs.access(box.parent + '.write-lock'), { code: 'ENOENT' });
});

test('persistent metadata rename denial never enters the callback and preserves source bytes', async t => {
  const box = await fixture(t), rename = fsSync.renameSync;
  let entered = false;
  fsSync.renameSync = (source, target) => {
    if (target === path.join(box.parent + '.write-lock', 'owner.json')) throw Object.assign(new Error('synthetic access denial'), { code: 'EACCES' });
    return rename(source, target);
  };
  try { await assert.rejects(withFileLeaseAsync(box.parent, () => { entered = true; }), { code: 'EACCES' }); }
  finally { fsSync.renameSync = rename; }
  assert.equal(entered, false);
  assert.equal(await fs.readFile(box.staged, 'utf8'), 'durable');
});
