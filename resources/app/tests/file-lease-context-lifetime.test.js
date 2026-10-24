'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { withFileLeaseSync, withFileLeaseAsync, replaceFileWithRetry } = require('../server/lib/shared-file-transaction');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-lease-context-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const parent = path.join(dir, 'parent'), child = path.join(dir, 'child'), staged = path.join(dir, 'staged');
  await fs.writeFile(staged, 'durable');
  return { parent, child, staged };
}

test('a synchronous caller returns busy without blocking the async owner on the same event loop', async t => {
  const box=await fixture(t);let release,entered;
  const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const owner=withFileLeaseAsync(box.parent,async lease=>{entered();await gate;lease.assertOwned();});
  await ready;const wait=Atomics.wait;
  Atomics.wait=()=>{throw Object.assign(new Error('A synchronous wait would prevent the local async owner from completing.'),{code:'UNEXPECTED_BLOCKING_WAIT'});};
  try { assert.throws(()=>withFileLeaseSync(box.parent,()=>assert.fail('contender must not enter')),{code:'SHARED_WRITE_BUSY'}); }
  finally { Atomics.wait=wait;release();await owner; }
  assert.equal(withFileLeaseSync(box.parent,()=>true),true,'a retry after the async owner completes must work');
});

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
  const box = await fixture(t), rename = fs.rename;
  let injected = false, entered = false;
  fs.rename = (source, target) => {
    if (!injected && target === path.join(box.parent + '.write-lock', 'owner.json')) {
      injected = true;
      throw Object.assign(new Error('synthetic Windows sharing violation'), { code: 'EPERM' });
    }
    return rename(source, target);
  };
  try { await withFileLeaseAsync(box.parent, lease => { entered = true; lease.assertOwned(); }); }
  finally { fs.rename = rename; }
  assert.equal(injected, true);
  assert.equal(entered, true);
  await assert.rejects(fs.access(box.parent + '.write-lock'), { code: 'ENOENT' });
});

test('persistent metadata rename denial never enters the callback and preserves source bytes', async t => {
  const box = await fixture(t), rename = fs.rename;
  let entered = false;
  fs.rename = (source, target) => {
    if (target === path.join(box.parent + '.write-lock', 'owner.json')) throw Object.assign(new Error('synthetic access denial'), { code: 'EACCES' });
    return rename(source, target);
  };
  try { await assert.rejects(withFileLeaseAsync(box.parent, () => { entered = true; }), { code: 'EACCES' }); }
  finally { fs.rename = rename; }
  assert.equal(entered, false);
  assert.equal(await fs.readFile(box.staged, 'utf8'), 'durable');
});

test('transient owner metadata open and read denials preserve lease verification', async t => {
  const box = await fixture(t), open = fs.open, read = fs.readFile;
  let openDenied=false, readDenied=false;
  const owner=path.join(box.parent+'.write-lock','owner.json');
  fs.open=(file,...args)=>{if(file===owner&&!openDenied){openDenied=true;throw Object.assign(new Error('synthetic sharing violation'),{code:'EPERM'});}return open(file,...args);};
  fs.readFile=(file,...args)=>{if(file===owner&&!readDenied){readDenied=true;throw Object.assign(new Error('synthetic read sharing violation'),{code:'EPERM'});}return read(file,...args);};
  let entered=false;
  try{await withFileLeaseAsync(box.parent,lease=>{lease.assertOwned();entered=true;});}
  finally{fs.open=open;fs.readFile=read;}
  assert.equal(openDenied,true);assert.equal(readDenied,true);assert.equal(entered,true);
});
