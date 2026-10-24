'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-wal-tail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'BuyerLogLocal.db');
  const db = createLocalDb(file);
  await db.ensure();
  await db.queuePatch({ id: 'before', patch: { n: 1 } });
  return { root, file, wal: `${file}.wal`, db };
}

for (const reopen of [false, true]) {
  test(`ND-003: acknowledged write survives a torn WAL tail (${reopen ? 'cold' : 'warm'} writer)`, async t => {
    const box = await fixture(t);
    await fs.appendFile(box.wal, '{"v":1,"op":"pat');
    const damaged = await fs.readFile(box.wal);
    const writer = reopen ? createLocalDb(box.file) : box.db;
    await writer.queuePatch({ id: 'after', patch: { n: 2 } });
    const cold = await createLocalDb(box.file).read();
    assert.equal(cold.records.before.n, 1);
    assert.equal(cold.records.after.n, 2, 'a successful save must survive reopening');
    const preserved = (await fs.readdir(box.root)).filter(name => name.startsWith('BuyerLogLocal.db.wal.corrupt-'));
    assert.equal(preserved.length, 1);
    assert.deepEqual(await fs.readFile(path.join(box.root, preserved[0])), damaged, 'preserve every original byte');
    await writer.transaction(state => { state.migrations.compacted = true; });
    assert.deepEqual(await fs.readFile(path.join(box.root, preserved[0])), damaged, 'later compaction must preserve evidence');
    assert.equal((await createLocalDb(box.file).read()).records.after.n, 2);
  });
}

test('complete checksummed final entry without a newline remains replayable after append', async t => {
  const box = await fixture(t);
  const bytes = await fs.readFile(box.wal);
  await fs.writeFile(box.wal, bytes.subarray(0, bytes.length - 1));
  await box.db.queuePatch({ id: 'after', patch: { n: 2 } });
  const cold = await createLocalDb(box.file).read();
  assert.equal(cold.records.before.n, 1);
  assert.equal(cold.records.after.n, 2);
});

for (const corruption of ['checksum', 'middle', 'version']) {
  test(`non-tail ${corruption} corruption rejects writes without modifying the WAL`, async t => {
    const box = await fixture(t);
    if (corruption === 'checksum') {
      const entry = JSON.parse((await fs.readFile(box.wal, 'utf8')).trim());
      entry.payload.patch.n = 999;
      await fs.writeFile(box.wal, JSON.stringify(entry) + '\n');
    } else if (corruption === 'version') {
      await fs.appendFile(box.wal, '{"v":99,"op":"patch"}');
    } else {
      const valid = await fs.readFile(box.wal);
      await fs.appendFile(box.wal, Buffer.concat([Buffer.from('{broken}\n'), valid]));
    }
    const damaged = await fs.readFile(box.wal);
    await assert.rejects(box.db.queuePatch({ id: 'after', patch: { n: 2 } }), { code: 'DATA_INTEGRITY_ERROR' });
    assert.deepEqual(await fs.readFile(box.wal), damaged);
    assert.equal((await box.db.read()).records.after, undefined, 'no uncommitted cached record');
  });
}

test('failed quarantine fsync rejects the save and leaves the damaged WAL unchanged', async t => {
  const box = await fixture(t);
  await fs.appendFile(box.wal, '{"v":1,"op":"pat');
  const damaged = await fs.readFile(box.wal);
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).includes('.wal.corrupt-')) handle.sync = async () => { throw Object.assign(new Error('synthetic disk failure'), { code: 'EIO' }); };
    return handle;
  };
  try { await assert.rejects(box.db.queuePatch({ id: 'after', patch: { n: 2 } }), { code: 'EIO' }); }
  finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readFile(box.wal), damaged);
  assert.equal((await createLocalDb(box.file).read()).records.after, undefined);
});

for (const method of ['transaction', 'compact', 'rotateDeviceId']) {
  test(`${method} cannot checkpoint past checksum corruption`, async t => {
    const box = await fixture(t);
    const entry = JSON.parse((await fs.readFile(box.wal, 'utf8')).trim());
    entry.payload.patch.n = 999;
    await fs.writeFile(box.wal, JSON.stringify(entry) + '\n');
    const damaged = await fs.readFile(box.wal);
    const snapshot = await fs.readFile(box.file);
    const operation = method === 'transaction' ? () => box.db.transaction(state => { state.records.after = { n: 2 }; }) : () => box.db[method]();
    await assert.rejects(operation(), { code: 'DATA_INTEGRITY_ERROR' });
    assert.deepEqual(await fs.readFile(box.wal), damaged);
    assert.deepEqual(await fs.readFile(box.file), snapshot);
    assert.equal((await box.db.read()).records.after, undefined);
  });
}

test('torn-tail recovery preserves the prior WAL generation and backup fallback', async t => {
  const box = await fixture(t);
  await box.db.transaction(state => { state.migrations.firstCheckpoint = true; });
  await box.db.queuePatch({ id: 'between', patch: { n: 3 } });
  await fs.appendFile(box.wal, '{"v":1,"op":"pat');
  await box.db.queuePatch({ id: 'after', patch: { n: 2 } });
  await fs.writeFile(box.file, '{broken snapshot');
  const cold = await createLocalDb(box.file).read();
  assert.equal(cold.records.before.n, 1);
  assert.equal(cold.records.between.n, 3);
  assert.equal(cold.records.after.n, 2);
});

for (const phase of ['snapshot', 'rotation']) {
  test(`failure during ${phase} keeps evidence and allows a safe retry`, async t => {
    const box = await fixture(t);
    await fs.appendFile(box.wal, '{"v":1,"op":"pat');
    const damaged = await fs.readFile(box.wal);
    const originalRename = fs.rename;
    fs.rename = async (source, target, ...rest) => {
      if (phase === 'snapshot' ? target === box.file && String(source).endsWith('.tmp') : source === box.wal && target === box.wal + '.bak') {
        throw Object.assign(new Error('synthetic replacement failure'), { code: 'EIO' });
      }
      return originalRename(source, target, ...rest);
    };
    try { await assert.rejects(box.db.queuePatch({ id: 'after', patch: { n: 2 } }), { code: 'EIO' }); }
    finally { fs.rename = originalRename; }
    assert.deepEqual(await fs.readFile(box.wal), damaged);
    const preserved = (await fs.readdir(box.root)).filter(name => name.startsWith('BuyerLogLocal.db.wal.corrupt-'));
    assert.ok(preserved.length >= 1);
    assert.deepEqual(await fs.readFile(path.join(box.root, preserved[0])), damaged);
    const restarted = createLocalDb(box.file);
    assert.equal((await restarted.read()).records.after, undefined);
    await restarted.queuePatch({ id: 'after', patch: { n: 2 } });
    const cold = await createLocalDb(box.file).read();
    assert.equal(cold.records.before.n, 1);
    assert.equal(cold.records.after.n, 2);
  });
}
