'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fixture, S, createLocalDb, verifyDurability } = require('./fixtures/collection-committed-native.cjs');
const { spawn } = require('node:child_process');

test('actual current native API commits row, head, receipt and inverse in one frame; exact checksum changes', async t => {
  const f = await fixture(t); await f.source.refresh(f.binding);
  const before = f.source.readSync(f.binding), wal = await f.wal();
  const result = await f.service.commit(f.request('atomic'));
  const frames = (await f.wal()).subarray(wal.length).toString().trim().split('\n').map(JSON.parse);
  assert.equal(frames.length, 1);
  assert.deepEqual(Object.keys(frames[0].payload.records).sort(), [f.key.head, f.key.row('1'), f.key.tx('atomic')].sort());
  assert.deepEqual(result.receipt.applied[0].before, S('base'));
  assert.deepEqual(result.receipt.applied[0].after, S('next'));
  assert.notEqual(f.source.readSync(f.binding).workspaceSha256, before.workspaceSha256);
  assert.notEqual(frames[0].payload.records[f.key.tx('atomic')].doc.digest, f.source.readSync(f.binding).workspaceSha256);
  const bytes = await f.wal();
  assert.equal((await f.service.commit(f.request('atomic'))).duplicate, true);
  assert.deepEqual(await f.wal(), bytes);
  await assert.rejects(f.service.commit(f.request('atomic', 'different')), { code: 'TRANSACTION_ID_REUSED' });
});

test('failed fsync leaves outcome unknown; retry verifies durability instead of trusting replayed receipt', async t => {
  let verifies = 0;
  const f = await fixture(t, { verify: async ctx => { verifies++; return verifyDurability(ctx); } });
  await f.source.refresh(f.binding);
  const original = fs.open;
  fs.open = async (file, flags, ...args) => {
    const handle = await original(file, flags, ...args);
    if (file !== f.file + '.wal' || flags !== 'a') return handle;
    return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle), sync: async () => { throw Object.assign(new Error('fsync EIO after complete write'), { code: 'EIO' }); } };
  };
  try { await assert.rejects(f.service.commit(f.request('uncertain')), error => error.code === 'EIO' && error.durability === 'unknown-retry-same-transaction-id'); }
  finally { fs.open = original; }
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  const wal = await f.wal(), count = verifies;
  const result = await f.service.commit(f.request('uncertain'));
  assert.equal(result.duplicate, true); assert.equal(result.durable, true); assert.equal(verifies, count + 1);
  assert.deepEqual(await f.wal(), wal);
  assert.equal(f.source.readSync(f.binding).workspace.rows[0]._rev, 1);
});

test('unverified duplicate cannot report durable success after restart or lost ACK', async t => {
  const f = await fixture(t); await f.service.commit(f.request('duplicate'));
  const { createCollectionDeltaService } = require('../server/lib/collection-delta-commit');
  const service = createCollectionDeltaService({ db: f.cold(), actorId: 'editor', assertAuthority: f.assertAuthority });
  await assert.rejects(service.commit(f.request('duplicate')), { code: 'COMMITTED_READ_ADAPTER_REQUIRED' });
});

test('retired transaction receipt cannot acknowledge or reapply an old transaction id', async t => {
  const f = await fixture(t); await f.service.commit(f.request('retired_receipt'));
  await f.db.privateRecordTransaction(state => ({ records: { [f.key.tx('retired_receipt')]: f.document({ ...state.records[f.key.tx('retired_receipt')].doc, tombstone: true }) } }));
  const wal = await f.wal();
  await assert.rejects(f.service.commit(f.request('retired_receipt')), { code: 'COLLECTION_SOURCE_INTEGRITY' });
  assert.deepEqual(await f.wal(), wal);
});

test('malformed native receipt cannot be returned as a durable duplicate', async t => {
  const f = await fixture(t); await f.service.commit(f.request('bad_receipt'));
  await f.db.privateRecordTransaction(state => {
    const tx = state.records[f.key.tx('bad_receipt')].doc;
    return { records: { [f.key.tx('bad_receipt')]: f.document({ ...tx, receipt: { ...tx.receipt, nativeRevision: state.revision + 100 } }) } };
  });
  const wal = await f.wal();
  await assert.rejects(f.service.commit(f.request('bad_receipt')), { code: 'COLLECTION_SOURCE_INTEGRITY' });
  assert.deepEqual(await f.wal(), wal);
});

test('legacy adapter rejects property-order-only changes that alter full JSON source identity', async t => {
  const f = await fixture(t), base = f.initial;
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.throws(() => f.adaptLegacyFullState(base, reordered, {}), { code: 'LEGACY_STRUCTURE_CHANGE_BLOCKED' });
  const rowOrder = JSON.parse(JSON.stringify(base));
  rowOrder.rows[0] = Object.fromEntries(Object.entries(rowOrder.rows[0]).reverse());
  assert.throws(() => f.adaptLegacyFullState(base, rowOrder, {}), { code: 'LEGACY_STRUCTURE_CHANGE_BLOCKED' });
});

test('private row tombstone and retirement remain authoritative through checkpoint and previous-WAL replay', async t => {
  const f = await fixture(t);
  await f.db.privateRecordTransaction(state => ({ records: {
    [f.key.row('1')]: f.document({ schema: 1, ownerId: 'alice', type: 'row', tombstone: true, sourceGeneration: 7 }),
    [f.key.structure]: f.document({ ...state.records[f.key.structure].doc, rowIds: ['2'] }),
    [f.key.head]: f.document({ ...state.records[f.key.head].doc, workspaceRevision: 11 }),
  } }));
  await f.db.transaction(() => null);
  await f.source.refresh(f.binding);
  assert.deepEqual(f.source.readSync(f.binding).workspace.rows.map(row => row.id), [2]);
  const result = await f.service.commit(f.request('deleted'));
  assert.equal(result.receipt.status, 'conflict');
  assert.equal(result.receipt.conflicts[0].reason, 'row-missing');
  await f.db.privateRecordTransaction(state => ({ records: { [f.key.head]: f.document({ ...state.records[f.key.head].doc, retired: true }) } }));
  await f.db.transaction(() => null);
  const { createCollectionDeltaService } = require('../server/lib/collection-delta-commit');
  const cold = createCollectionDeltaService({ db: f.cold(), actorId: 'editor', assertAuthority: f.assertAuthority, verifyDurability });
  await assert.rejects(cold.commit(f.request('retired')), { code: 'COLLECTION_SOURCE_RETIRED' });
});

test('owner/source/client generation and pre-append authority recheck reject stale intent without effects', async t => {
  const f = await fixture(t), wal = await f.wal();
  await assert.rejects(f.service.commit(f.request('owner', 'next', { ownerId: 'bob' })), { code: 'AUTHORITY_CHANGED' });
  await assert.rejects(f.service.commit(f.request('generation', 'next', { sourceGeneration: 8 })), { code: 'AUTHORITY_CHANGED' });
  f.setAuthority(context => ({ ...f.binding, clientGeneration: 2, canView: true, canEdit: context.phase !== 'pre-append' }));
  await assert.rejects(f.service.commit(f.request('client', 'next', { clientGeneration: 1 })), { code: 'AUTHORITY_CHANGED' });
  await assert.rejects(f.service.commit(f.request('revoke', 'next', { clientGeneration: 2 })), { code: 'AUTHORITY_CHANGED' });
  assert.deepEqual(await f.wal(), wal);
});

test('real child SIGKILL before native append or after fsync preserves atomic row/receipt replay', { timeout: 10000 }, async t => {
  for (const point of ['before-write', 'after-sync']) {
    const f = await fixture(t);
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/collection-commit-crash-child.cjs'), f.file, point], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let stderr = ''; child.stderr.on('data', value => { stderr += value; });
    const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
    const gate = new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('Child exited before crash gate: ' + stderr))); });
    assert.equal(await gate, point); child.kill('SIGKILL');
    assert.deepEqual(await closed, { code: null, signal: 'SIGKILL' });
    const state = await f.cold().read(), committed = point === 'after-sync';
    assert.equal(state.records[f.key.row('1')].doc.value.cx_a, committed ? 'crashed' : 'base');
    assert.equal(Boolean(state.records[f.key.tx('crash')]), committed);
    const { createCollectionDeltaService } = require('../server/lib/collection-delta-commit');
    const service = createCollectionDeltaService({ db: f.cold(), actorId: 'editor', assertAuthority: f.assertAuthority, verifyDurability });
    const request = f.request('crash', 'crashed');
    const wal = await f.wal(), retry = await service.commit(request);
    assert.equal(retry.duplicate, committed); assert.equal(retry.receipt.status, 'applied');
    if (committed) assert.deepEqual(await f.wal(), wal);
    assert.equal((await f.cold().read()).records[f.key.row('1')].doc.value._rev, 1);
  }
});

test('synthetic torn frame cuts replay row and receipt together through current native backend', async t => {
  const f = await fixture(t), prefix = await f.wal(); await f.service.commit(f.request('cut'));
  const full = await f.wal(), frame = full.subarray(prefix.length);
  for (const length of [0, 1, Math.floor(frame.length / 2), frame.length - 3, frame.length - 1, frame.length]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-committed-cut-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.cp(f.directory, directory, { recursive: true });
    const file = path.join(directory, 'BuyerLogLocal.db');
    await fs.writeFile(file + '.wal', Buffer.concat([prefix, frame.subarray(0, length)]));
    const state = await createLocalDb(file).read(), complete = length >= frame.length - 1;
    assert.equal(state.records[f.key.row('1')].doc.value.cx_a, complete ? 'next' : 'base');
    assert.equal(Boolean(state.records[f.key.tx('cut')]), complete);
  }
});
