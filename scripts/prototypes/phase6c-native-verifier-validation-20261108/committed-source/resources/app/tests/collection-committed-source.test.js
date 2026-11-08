'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { fixture, workspace, deferred, verifyDurability } = require('./fixtures/collection-committed-native.cjs');

test('unready source fails closed; verified refresh preserves exact full JSON key order/checksum', async t => {
  const f = await fixture(t);
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  const wal = await f.wal();
  await f.source.refresh(f.binding);
  const view = f.source.readSync(f.binding);
  assert.equal(JSON.stringify(view.workspace), JSON.stringify(f.initial));
  assert.equal(view.workspaceSha256, crypto.createHash('sha256').update(JSON.stringify(f.initial)).digest('hex'));
  assert.deepEqual(await f.wal(), wal);
  assert.ok(Object.isFrozen(view.workspace.rows[0].unknown.retain));
});

test('db.read and optimistic native cache are never a committed refresh proof', async t => {
  const f = await fixture(t, { verify: undefined });
  const { createCollectionCommittedSource } = require('../server/lib/collection-committed-source');
  const source = createCollectionCommittedSource({ db: f.db, actorId: 'editor', assertAuthority: f.assertAuthority });
  await f.db.read();
  await assert.rejects(source.refresh(f.binding), { code: 'COMMITTED_READ_ADAPTER_REQUIRED' });
  assert.throws(() => source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
});

test('in-flight fsync exposes optimistic native state but retains immutable prior committed snapshot', async t => {
  const f = await fixture(t); await f.source.refresh(f.binding);
  const before = f.source.readSync(f.binding), entered = deferred(), release = deferred(), original = fs.open;
  fs.open = async (file, flags, ...args) => {
    const handle = await original(file, flags, ...args);
    if (file !== f.file + '.wal' || flags !== 'a') return handle;
    return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle), sync: async () => { entered.resolve(); await release.promise; await handle.sync(); } };
  };
  const pending = f.service.commit(f.request('gated'));
  try {
    await entered.promise;
    assert.equal((await f.db.read()).records[f.key.row('1')].doc.value.cx_a, 'next');
    assert.strictEqual(f.source.readSync(f.binding), before);
    release.resolve(); await pending;
    const after = f.source.readSync(f.binding);
    assert.equal(after.workspace.rows[0].cx_a, 'next');
    assert.equal(before.workspace.rows[0].cx_a, 'base');
    assert.strictEqual(after.workspace.rows[1], before.workspace.rows[1]);
    assert.strictEqual(after.workspace.customColumns, before.workspace.customColumns);
  } finally { release.resolve(); fs.open = original; await pending; }
});

test('delayed old durable ACK cannot replace a newer committed view', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.setAuthority(async context => {
    if (context.phase === 'post-durable' && context.transactionId === 'old') { entered.resolve(); await release.promise; }
    return { ...f.binding, canView: true, canEdit: true };
  });
  const old = f.service.commit(f.request('old')); await entered.promise;
  await f.service.commit(f.request('new', 'newest', { patches: [{ rowId: '1', field: 'cx_a', baseRowRevision: 1, base: { present: true, value: 'next' }, incoming: { present: true, value: 'newest' } }] }));
  release.resolve(); await old;
  assert.equal((await f.source.read(f.binding)).workspace.rows[0].cx_a, 'newest');
});

test('fresh authority gates every read; post-durable denial withholds and invalidates view', async t => {
  const f = await fixture(t); await f.source.refresh(f.binding);
  f.setAuthority(context => ({ ...f.binding, canView: context.phase !== 'read', canEdit: true }));
  assert.throws(() => f.source.readSync(f.binding), { code: 'AUTHORITY_CHANGED' });
  f.setAuthority(context => ({ ...f.binding, canView: true, canEdit: context.phase !== 'post-durable' }));
  const result = await f.service.commit(f.request('revoked'));
  assert.equal(result.visibility, 'withheld'); assert.equal(result.receipt, undefined);
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
});

test('missing/corrupt active member and retired namespace never return historical JSON', async t => {
  for (const mode of ['missing', 'tombstone', 'retired', 'order']) {
    const f = await fixture(t); await f.source.refresh(f.binding);
    await f.db.privateRecordTransaction(state => ({ records: mode === 'retired' ? {
      [f.key.head]: f.document({ ...state.records[f.key.head].doc, retired: true }),
    } : mode === 'order' ? {
      [f.key.structure]: f.document({ ...state.records[f.key.structure].doc, workspaceKeys: ['rows', '_revision'] }),
    } : {
      [f.key.row('1')]: f.document({ schema: 1, ownerId: 'alice', type: mode === 'missing' ? 'bad' : 'row', tombstone: true }),
    } }));
    await assert.rejects(f.source.refresh(f.binding));
    assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
    assert.equal((await f.db.read()).records['store:collection-workspaces/alice.json'].rows[0].cx_a, 'base');
  }
});

test('refresh verifier failure invalidates readiness and does not publish a candidate', async t => {
  let broken = false;
  const f = await fixture(t, { verify: context => { if (broken) throw new Error('verification failed'); return verifyDurability(context); } });
  await f.source.refresh(f.binding); broken = true;
  await assert.rejects(f.source.refresh(f.binding), /verification failed/);
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
});

test('malformed native retirement and row tombstone flags fail closed', async t => {
  for (const flag of ['retired', 'tombstone']) {
    const f = await fixture(t); await f.source.refresh(f.binding);
    const key = flag === 'retired' ? f.key.head : f.key.row('1');
    await f.db.privateRecordTransaction(state => ({ records: { [key]: f.document({ ...state.records[key].doc, [flag]: 'true' }) } }));
    await assert.rejects(f.source.refresh(f.binding), { code: 'COLLECTION_SOURCE_INTEGRITY' });
    assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  }
});

test('separate retirement control survives rotation and fences a delayed successful ACK', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.setAuthority(async context => {
    if (context.phase === 'post-durable') { entered.resolve(); await release.promise; }
    return { ...f.binding, canView: true, canEdit: true };
  });
  const pending = f.service.commit(f.request('late_retired')); await entered.promise;
  await f.db.privateRecordTransaction(() => ({ records: { [f.key.retirement]: f.document({ schema: 1, type: 'retirement', ownerId: 'alice', sourceGeneration: 7, tombstone: true }) } }));
  await f.db.transaction(() => null);
  await assert.rejects(f.source.refresh(f.binding), { code: 'COLLECTION_SOURCE_RETIRED' });
  release.resolve(); await pending;
  await assert.rejects(f.source.read(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  assert.ok((await f.cold().read()).records[f.key.retirement].doc.tombstone);
});

test('async current authority requires async read; malformed verifier proof never marks source ready', async t => {
  const f = await fixture(t); await f.source.refresh(f.binding);
  f.setAuthority(async () => ({ ...f.binding, canView: true, canEdit: false }));
  assert.throws(() => f.source.readSync(f.binding), { code: 'ASYNC_AUTHORITY_REQUIRES_READ' });
  assert.equal((await f.source.read(f.binding)).workspace.rows[0].cx_a, 'base');
  const g = await fixture(t, { verify: async () => ({ verified: true, nativeRevision: -1 }) });
  await assert.rejects(g.source.refresh(g.binding), { code: 'COMMITTED_READ_VERIFICATION_FAILED' });
});

test('missing handoff and missing exact-order descriptor fail closed without migration', async t => {
  const f = await fixture(t, { adopt: false });
  await assert.rejects(f.source.refresh(f.binding), { code: 'SOURCE_HANDOFF_REQUIRED' });
  const initial = workspace(); initial.rows[0].modelSharedValues = { cx_a: false };
  const g = await fixture(t, { initial }); await g.source.refresh(g.binding);
  assert.deepEqual((await g.source.read(g.binding)).workspace.rows[0].modelSharedValues, { cx_a: false });
  await assert.rejects(g.service.commit(g.request('group')), { code: 'TYPED_GROUP_UNIT_REQUIRED' });
  await g.db.privateRecordTransaction(state => { const structure = { ...state.records[g.key.structure].doc }; delete structure.workspaceKeys; return { records: { [g.key.structure]: g.document(structure) } }; });
  await assert.rejects(g.source.refresh(g.binding), { code: 'SOURCE_HANDOFF_REQUIRED' });
});
