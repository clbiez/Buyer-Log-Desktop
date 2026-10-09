'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { runScenario, createSimulation } = require('./helpers/sync-sim');

test('OneDrive simulation: 10 devices, 300 operations, three reproducible seeds', { timeout: 15000 }, async t => {
  for (const seed of [1701, 90210, 0xC0FFEE]) {
    const result = await runScenario({ seed, devices: 10, operations: 300 });
    assert.equal(result.operations, 300);
    t.diagnostic(JSON.stringify(result));
  }
});

test('OneDrive simulation soak: 10 devices, 20,000 operations', { skip: process.env.BUYERLOG_SYNC_SOAK !== '1', timeout: 300000 }, async t => {
  const result = await runScenario({ seed: 0x51A7, devices: 10, operations: 20000 });
  assert.equal(result.operations, 20000);
  t.diagnostic(JSON.stringify(result));
});

test('simulator distinguishes real concurrent same-field writes from separate-field writes', async t => {
  const simulation = await createSimulation({ seed: 4401, devices: 2 });
  t.after(() => simulation.close());
  await simulation.syncRound(); await simulation.replicator.flush();
  await Promise.all(simulation.devices.map((device, index) => device.db.queuePatch({ id: 'cp-order:RACE', patch: { suppFob: index + 1 } })));
  await simulation.syncRound(); await simulation.settle();
  for (const [index, device] of simulation.devices.entries()) {
    const state = await device.db.read(), conflicts = state.conflicts.filter(item => !item.resolved);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].id, 'cp-order:RACE'); assert.equal(conflicts[0].field, 'suppFob');
    assert.equal(state.records['cp-order:RACE'].suppFob, index + 1);
  }
});

test('causally ordered cross-device writes keep the actual last value without conflicts', async t => {
  const simulation = await createSimulation({ seed: 4402, devices: 2 });
  t.after(() => simulation.close());
  await simulation.syncRound(); await simulation.replicator.flush();
  const [a, b] = simulation.devices;
  for (const [device, value] of [[a, 1], [b, 2], [a, 3]]) {
    await device.db.queuePatch({ id: 'cp-order:SEQUENTIAL', patch: { suppFob: value } });
    await simulation.syncRound(); await simulation.settle();
  }
  for (const device of simulation.devices) {
    const state = await device.db.read();
    assert.equal(state.records['cp-order:SEQUENTIAL'].suppFob, 3);
    assert.equal(state.conflicts.filter(item => !item.resolved).length, 0);
  }
});

test('OneDrive conflict copies and corrupt final packages do not hide a valid package; partial .tmp is ignored', async t => {
  const simulation = await createSimulation({ seed: 4400, devices: 2 });
  t.after(() => simulation.close());
  await simulation.syncRound(); await simulation.replicator.flush();
  const [a, b] = simulation.devices;
  await a.db.queuePatch({ id: 'cp-order:PROVIDER-CORRUPTION', patch: { subManufacturer: 'SAFE' } });
  await a.sync.syncOnce(); await simulation.replicator.flush();
  await simulation.injectProviderArtifacts();
  const result = await b.sync.syncOnce();
  assert.equal(result.online, true); assert.equal(result.corruptPackages, 2);
  assert.equal((await b.db.read()).records['cp-order:PROVIDER-CORRUPTION'].subManufacturer, 'SAFE');
  assert.equal(simulation.replicator.metrics.conflictCopies, 1);
});

test('known protocol gap: a partial foreign head must not take a device offline', {
  todo: 'P3 evidence, seed=4403: sync-settings.js detectLegacyPeers/detectGzipUnsupportedPeers/runSyncOnce foreign _head.json parse escapes the corrupt-package guard; fix in a separate package',
}, async t => {
  const simulation = await createSimulation({ seed: 4403, devices: 2 });
  t.after(() => simulation.close());
  await simulation.syncRound(); await simulation.replicator.flush();
  const [a, b] = simulation.devices;
  await fsp.writeFile(path.join(b.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(a.id), '_head.json'), '{"latestSequence":');
  const result = await b.sync.syncOnce();
  // Intentionally RED/TODO. No production fix or relaxed invariant in P3.
  assert.equal(result.online, true, `seed=4403: ${result.lastError}`);
});

test('known protocol gap: delayed capability head must not invalidate scoped legacy checksums', {
  todo: 'P3 evidence, seed=4404: outgoing scope changes patch/syncClass but preserves journal sha256; the legacy receiver rejects every scoped event',
}, async t => {
  const simulation = await createSimulation({ seed: 4404, devices: 2 });
  t.after(() => simulation.close());
  const [a, b] = simulation.devices;
  // OneDrive copied the peer directory, but its capability head has not arrived.
  await fsp.mkdir(path.join(a.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(b.id)), { recursive: true });
  await a.db.queuePatch({ id: 'cp-order:CAPABILITY-DELAY', patch: { notes: { Notes: 'local only' } } });
  await a.db.queuePatch({ id: 'cp-order:CAPABILITY-DELAY', patch: { suppFob: 12 } });
  const publication = await a.sync.syncOnce();
  assert.equal(publication.online, true); assert.equal(publication.legacyCompatibilityMode, true);
  await simulation.settle();
  const received = await b.db.read();
  assert.equal(received.records['cp-order:CAPABILITY-DELAY']?.suppFob, 12, 'seed=4404: a legitimately scoped legacy event must be received');
  assert.equal(received.records['cp-order:CAPABILITY-DELAY'].notes, undefined);
  const head = JSON.parse(await fsp.readFile(path.join(a.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(a.id), '_head.json'), 'utf8'));
  assert.equal(head.latestSequence, 2);
  assert.equal(Number(received.syncCheckpoints[a.id] || 0), head.latestSequence);
});

test('known protocol gap: valid legacy event after a local-only event cannot close the contiguous checkpoint', {
  todo: 'P3 evidence, seed=4405: legacy .ready lacks local-only cover ranges; checkpoint remains zero although value arrives and every file was delivered',
}, async t => {
  const simulation = await createSimulation({ seed: 4405, devices: 2 });
  t.after(() => simulation.close());
  const [a, b] = simulation.devices;
  await fsp.mkdir(path.join(a.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(b.id)), { recursive: true });
  await a.db.queuePatch({ id: 'cp-order:LEGACY-GAP', patch: { notes: { Notes: 'private sequence 1' } } });
  await a.db.queuePatch({ id: 'cp-order:LEGACY-GAP', patch: { suppFob: 13 } });
  const publication = await a.sync.syncOnce();
  assert.equal(publication.legacyCompatibilityMode, true);
  const sourceFolder = path.join(a.mirror, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(a.id));
  const name = (await fsp.readdir(sourceFolder)).find(item => item.endsWith('.ready'));
  const file = path.join(sourceFolder, name), payload = JSON.parse(await fsp.readFile(file, 'utf8'));
  // A valid legacy fixture isolates sequence accounting from the separate
  // checksum defect above. This changes only a synthetic transport file.
  payload.sha256 = crypto.createHash('sha256').update(JSON.stringify({ ...payload, sha256: undefined }), 'utf8').digest('hex');
  await fsp.writeFile(file, JSON.stringify(payload));
  await simulation.settle();
  const state = await b.db.read();
  assert.equal(state.records['cp-order:LEGACY-GAP']?.suppFob, 13);
  assert.equal((await b.sync.read()).corruptPackages, 0);
  assert.equal(Number(state.syncCheckpoints[a.id] || 0), 2, 'seed=4405: exactly two settled rounds leave the checkpoint at zero');
});
