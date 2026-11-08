'use strict';
const nativeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const appRoot = process.env.BL_NATIVE_VERIFIER_APP_ROOT;
assert.ok(appRoot, 'Explicit real app root required');
const leases = require(path.join(appRoot, 'server/lib/shared-file-transaction'));
const realWithLease = leases.withFileLeaseAsync;
let admissions = 0, depth = 0, maxDepth = 0, held;
// Observe the real native lease object; do not fabricate or replace a lease.
leases.withFileLeaseAsync = (file, operation, settings) => {
  admissions++;
  return realWithLease(file, async lease => {
    const prior = held;
    held = lease; maxDepth = Math.max(maxDepth, ++depth);
    try { return await operation(lease); }
    finally { --depth; held = prior; }
  }, settings);
};
const { fixture, createLocalDb } = require('./committed-source/resources/app/tests/fixtures/collection-committed-native.cjs');
leases.withFileLeaseAsync = realWithLease;
const { createLocalDb: createBaseDb } = require(path.join(appRoot, 'server/lib/local-db'));
const { createCollectionCommittedSource } = require('./committed-source/resources/app/server/lib/collection-committed-source');
const test = (name, body) => nativeTest(name, { timeout: 10000, concurrency: false }, body);
async function members(file) {
  const value = {};
  for (const suffix of ['', '.wal', '.wal.bak']) {
    try { value[suffix] = await fs.readFile(file + suffix); }
    catch (error) { if (error.code !== 'ENOENT') throw error; value[suffix] = null; }
  }
  return value;
}
async function readOnly(db, action = state => db.verifyPrivateRecordDurability(state)) {
  const stop = new Error('read-only sentinel'); let result;
  try { await db.privateRecordTransaction(async state => { result = await action(state); throw stop; }); }
  catch (error) { if (error !== stop) throw error; }
  return result;
}
async function instrumentOpen(action, decorate) {
  const original = fs.open;
  fs.open = async function (target, ...args) {
    const handle = await original.call(this, target, ...args);
    decorate(handle, String(target)); return handle;
  };
  try { return await action(); } finally { fs.open = original; }
}

test('committed refresh/duplicate keep the exact native DB, state, lease and fence; verifier admits zero nested leases', async t => {
  const f = await fixture(t); let prepareState, checks = 0;
  const transaction = f.db.privateRecordTransaction;
  f.db.privateRecordTransaction = prepare => transaction(async state => {
    prepareState = state;
    try { return await prepare(state); } finally { prepareState = null; }
  });
  const verify = f.db.verifyPrivateRecordDurability;
  f.db.verifyPrivateRecordDurability = async function (state) {
    checks++;
    assert.strictEqual(this, f.db); assert.strictEqual(state, prepareState);
    assert.ok(held); assert.equal(held.resource, f.file);
    const lease = held, count = admissions;
    const owner = await fs.readFile(f.file + '.write-lock/owner.json', 'utf8');
    const fence = await fs.readFile(f.file + '.write-fence.json', 'utf8');
    await lease.assertOwnedAsync();
    const proof = await verify.call(this, state);
    assert.deepEqual(proof, { verified: true, nativeRevision: state.revision });
    assert.strictEqual(held, lease); assert.equal(admissions, count);
    assert.equal(await fs.readFile(f.file + '.write-lock/owner.json', 'utf8'), owner);
    assert.equal(await fs.readFile(f.file + '.write-fence.json', 'utf8'), fence);
    return proof;
  };
  const before = await members(f.file), count = admissions;
  await f.source.refresh(f.binding);
  assert.equal(admissions, count + 1); assert.deepEqual(await members(f.file), before);
  const first = await f.service.commit(f.request('same-native-boundary'));
  const written = await members(f.file), native = await f.db.read();
  const revision = native.revision, sequence = native.localSequence, journal = JSON.stringify(native.journal);
  const repeated = await f.service.commit(f.request('same-native-boundary'));
  assert.equal(repeated.duplicate, true); assert.deepEqual(repeated.receipt, first.receipt);
  assert.deepEqual(await members(f.file), written);
  const after = await f.db.read();
  assert.equal(after.revision, revision); assert.equal(after.localSequence, sequence);
  assert.equal(JSON.stringify(after.journal), journal); assert.equal(after.records[f.key.row('1')].doc.value._rev, 1);
  assert.equal(checks, 2); assert.equal(maxDepth, 1);
});

for (const suffix of ['', '.wal']) test('generation replacement during the final lease await rejects committed publication: ' + (suffix || 'snapshot'), async t => {
  const f = await fixture(t), originalRead = fs.readFile;
  const owner = f.file + '.write-lock/owner.json';
  let armed = false, replaced = false, inVerifier = false;
  const verify = f.db.verifyPrivateRecordDurability;
  f.db.verifyPrivateRecordDurability = async function (state) {
    inVerifier = true;
    try { return await verify.call(this, state); } finally { inVerifier = false; }
  };
  fs.readFile = async function (target, ...args) {
    const value = await originalRead.call(this, target, ...args);
    if (String(target) === owner && inVerifier && armed && !replaced) {
      replaced = true;
      const temporary = f.file + suffix + '.generation-probe';
      await fs.writeFile(temporary, await originalRead(f.file + suffix));
      await fs.rename(temporary, f.file + suffix);
    }
    return value;
  };
  try {
    await assert.rejects(instrumentOpen(() => f.source.refresh(f.binding), (handle, target) => {
      if (target === f.directory && inVerifier) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); armed = true; };
      }
    }), { code: 'PRIVATE_DURABILITY_STATE_CHANGED' });
    assert.equal(replaced, true);
    assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  } finally { fs.readFile = originalRead; }
});

test('duplicate sync/close failures propagate and the same transaction ID resolves without another frame', async t => {
  const f = await fixture(t); await f.db.transaction(() => null);
  await f.service.commit(f.request('strict-errors'));
  const before = await members(f.file), revision = (await f.db.read()).revision;
  for (const target of [f.file, f.file + '.wal.bak', f.file + '.wal', f.directory, path.join(f.directory, '.buyerlog-db-recovery')]) {
    await fs.access(target); // Fault injection requires a real opened member.
    await assert.rejects(instrumentOpen(() => f.service.commit(f.request('strict-errors')), (handle, opened) => {
      if (opened === target) handle.sync = async () => { throw Object.assign(new Error('strict sync probe'), { code: 'EOPNOTSUPP' }); };
    }), { code: 'EOPNOTSUPP' });
    assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
    assert.deepEqual(await members(f.file), before);
  }
  await assert.rejects(instrumentOpen(() => f.service.commit(f.request('strict-errors')), (handle, opened) => {
    if (opened === f.file) { const close = handle.close.bind(handle); handle.close = async () => { await close(); throw Object.assign(new Error('strict close probe'), { code: 'EIO' }); }; }
  }), { code: 'EIO' });
  const retry = await f.service.commit(f.request('strict-errors'));
  assert.equal(retry.duplicate, true); assert.equal(retry.durable, true);
  assert.deepEqual(await members(f.file), before); assert.equal((await f.db.read()).revision, revision);
  assert.equal(f.source.readSync(f.binding).workspace.rows[0]._rev, 1);
});

test('a real recovery intent created during the final lease await cannot be certified', async t => {
  const f = await fixture(t), state = await f.db.read(), originalRead = fs.readFile;
  const { createDurableFileRecovery } = require(path.join(appRoot, 'server/lib/durable-file-recovery'));
  const recovery = createDurableFileRecovery({ recoveryRoot: path.join(f.directory, '.buyerlog-db-recovery'), allowedRoots: [f.directory] });
  let armed = false, prepared = false, inVerifier = false;
  const verify = f.db.verifyPrivateRecordDurability;
  f.db.verifyPrivateRecordDurability = async function (state) {
    inVerifier = true;
    try { return await verify.call(this, state); } finally { inVerifier = false; }
  };
  fs.readFile = async function (target, ...args) {
    const value = await originalRead.call(this, target, ...args);
    if (String(target) === f.file + '.write-lock/owner.json' && inVerifier && armed && !prepared) {
      prepared = true;
      await recovery.prepare(f.file, Buffer.from(JSON.stringify({ ...state, finalIntentProbe: true })));
    }
    return value;
  };
  try {
    await assert.rejects(instrumentOpen(() => f.source.refresh(f.binding), (handle, target) => {
      if (target === f.directory && inVerifier) { const close = handle.close.bind(handle); handle.close = async () => { await close(); armed = true; }; }
    }), { code: 'PRIVATE_DURABILITY_RECOVERY_PENDING' });
    assert.equal(prepared, true);
    assert.ok((await fs.readdir(path.join(f.directory, '.buyerlog-db-recovery'))).some(name => name.endsWith('.intent.json')));
    assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  } finally { fs.readFile = originalRead; }
});

test('actual lease loss during duplicate verification never publishes or appends', async t => {
  const f = await fixture(t); await f.service.commit(f.request('lease-loss'));
  const before = await members(f.file), owner = f.file + '.write-lock/owner.json';
  await assert.rejects(instrumentOpen(() => f.service.commit(f.request('lease-loss')), (handle, target) => {
    if (target === f.file) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); const value = JSON.parse(await fs.readFile(owner, 'utf8')); value.generation++; await fs.writeFile(owner, JSON.stringify(value)); };
    }
  }), { code: 'SHARED_LEASE_LOST' });
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  assert.deepEqual(await members(f.file), before);
  assert.equal((await f.service.commit(f.request('lease-loss'))).duplicate, true);
});

test('native partial-tail recovery retains damaged previous WAL and strict committed refresh declines proof', async t => {
  const f = await fixture(t); await f.service.commit(f.request('before-tail'));
  const revision = (await f.db.read()).revision;
  const damaged = Buffer.concat([await f.wal(), Buffer.from('{"partial":')]);
  await fs.writeFile(f.file + '.wal', damaged);
  await assert.rejects(f.source.refresh(f.binding), { code: 'DATA_INTEGRITY_ERROR' });
  assert.throws(() => f.source.readSync(f.binding), { code: 'COLLECTION_SOURCE_UNAVAILABLE' });
  assert.deepEqual(await fs.readFile(f.file + '.wal.bak'), damaged);
  assert.equal((await f.cold().read()).revision, revision);
});

test('pending real recovery intent blocks warm committed refresh; cold native recovery permits proof and same-ID retry', async t => {
  const f = await fixture(t); await f.service.commit(f.request('intent'));
  const state = await f.db.read();
  const { createDurableFileRecovery } = require(path.join(appRoot, 'server/lib/durable-file-recovery'));
  await createDurableFileRecovery({ recoveryRoot: path.join(f.directory, '.buyerlog-db-recovery'), allowedRoots: [f.directory] })
    .prepare(f.file, Buffer.from(JSON.stringify({ ...state, recoveryProbe: 'synthetic' })));
  await assert.rejects(f.source.refresh(f.binding), { code: 'PRIVATE_DURABILITY_RECOVERY_PENDING' });
  assert.equal((await f.db.read()).recoveryProbe, undefined);
  const cold = f.cold(); assert.equal((await cold.read()).recoveryProbe, 'synthetic');
  const source = createCollectionCommittedSource({ db: cold, actorId: 'editor', assertAuthority: f.assertAuthority,
    verifyDurability: ({ db, state }) => db.verifyPrivateRecordDurability(state) });
  const before = await members(f.file);
  await source.refresh(f.binding); assert.deepEqual(await members(f.file), before);
  const { createCollectionDeltaService } = require('./committed-source/resources/app/server/lib/collection-delta-commit');
  assert.equal((await createCollectionDeltaService({ source }).commit(f.request('intent'))).duplicate, true);
  assert.deepEqual(await members(f.file), before);
});

test('base and candidate both replay snapshotted native private conflicts twice; strict verifier rejects the divergent warm state', async t => {
  for (const [name, factory] of [['base', createBaseDb], ['candidate', createLocalDb]]) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-replay-comparison-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'BuyerLogLocal.db'), db = factory(file);
    await db.privateRecordTransaction(() => ({ records: {}, conflicts: [{ id: 'synthetic-private-conflict' }] }));
    await db.transaction(() => null);
    const warm = await db.read(), cold = await factory(file).read();
    assert.equal(warm.conflicts.length, 1, name); assert.equal(cold.conflicts.length, 2, name);
    if (name === 'candidate') await assert.rejects(readOnly(db), { code: 'PRIVATE_DURABILITY_STATE_CHANGED' });
  }
});

test('parallel verification in one genuine native prepare rejects reentry and adds no frame', async t => {
  const f = await fixture(t), before = await members(f.file);
  await readOnly(f.db, async state => {
    const first = f.db.verifyPrivateRecordDurability(state);
    await assert.rejects(f.db.verifyPrivateRecordDurability(state), { code: 'PRIVATE_DURABILITY_SCOPE_REQUIRED' });
    assert.equal((await first).verified, true);
  });
  assert.deepEqual(await members(f.file), before);
});
