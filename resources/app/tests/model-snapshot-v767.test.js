'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v767-snapshot-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const snapshots = require('../server/lib/model-snapshot');

test.after(() => fs.rmSync(root, { recursive:true, force:true }));

function payload(model = 'MODEL-A', rowCount = 300) {
  const orders = Array.from({ length:rowCount }, (_, index) => ({ ocode:index + 1, model, description:`${model}-${index}` }));
  const antrepo = Object.fromEntries(orders.map(row => [String(row.ocode), { qty:row.ocode, date:'2026-08-30' }]));
  return {
    loadedAt:'2026-08-30T10:00:00.000Z', asasOrders:orders,
    asasOrdersByTarget:{ cp:orders, orders, backlog:orders },
    antrepoMap:antrepo, antrepoMapByTarget:{ cp:antrepo, orders:antrepo, backlog:antrepo },
    sources:{ asas:'Excel: ASAS.xlsx', antrepo:'Excel: Antrepo.xlsx' },
  };
}

test('v7.67 snapshot stores shared target datasets once and restores identity aliases', async () => {
  const source = payload();
  const legacyBytes = Buffer.byteLength(JSON.stringify({ schemaVersion:1, ...source }));
  const saved = await snapshots.saveModelSnapshotAsync('buyer-a', source);
  assert.equal(saved.aliasCount, 6);
  assert.ok(saved.uncompressedBytes < legacyBytes * 0.45, `expected compact snapshot; ${saved.uncompressedBytes}/${legacyBytes}`);

  const wrapper = JSON.parse(zlib.gunzipSync(fs.readFileSync(saved.file)).toString('utf8'));
  assert.equal(wrapper.schemaVersion, 2);
  assert.match(wrapper.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual(wrapper.payload.targetAliases.asasOrdersByTarget, { cp:'asasOrders', orders:'asasOrders', backlog:'asasOrders' });

  const loaded = await snapshots.loadModelSnapshotAsync('buyer-a');
  assert.equal(loaded.asasOrdersByTarget.cp, loaded.asasOrders);
  assert.equal(loaded.asasOrdersByTarget.orders, loaded.asasOrders);
  assert.equal(loaded.antrepoMapByTarget.backlog, loaded.antrepoMap);
  assert.equal(loaded.asasOrders[0].model, 'MODEL-A');
  assert.ok(loaded._snapshotMetrics.totalMs >= 0);
});

test('v7.67 async snapshot yields and corrupt primary safely falls back to the last valid copy', async () => {
  let eventLoopYielded = false;
  setImmediate(() => { eventLoopYielded = true; });
  await snapshots.saveModelSnapshotAsync('buyer-b', payload('FIRST'));
  assert.equal(eventLoopYielded, true);
  await snapshots.saveModelSnapshotAsync('buyer-b', payload('SECOND'));
  fs.writeFileSync(snapshots.snapshotPath('buyer-b'), Buffer.from('corrupt-snapshot'));
  const fallback = await snapshots.loadModelSnapshotAsync('buyer-b');
  assert.equal(fallback.asasOrders[0].model, 'FIRST');
  assert.equal(fallback._snapshotMetrics.fallback, true);
});

test('v7.67 legacy schema remains readable without rewriting user data', async () => {
  const source = payload('LEGACY', 2);
  const legacy = zlib.gzipSync(Buffer.from(JSON.stringify({ schemaVersion:1, savedAt:'2026-08-30T09:00:00.000Z', ...source })), { level:6 });
  fs.mkdirSync(path.dirname(snapshots.snapshotPath('legacy-user')), { recursive:true });
  fs.writeFileSync(snapshots.snapshotPath('legacy-user'), legacy);
  const loaded = await snapshots.loadModelSnapshotAsync('legacy-user');
  assert.equal(loaded.asasOrders[0].model, 'LEGACY');
  assert.equal(loaded.schemaVersion, 1);
});

test('v7.67 concurrent writes stay ordered per user and never publish a partial snapshot', async () => {
  await Promise.all([
    snapshots.saveModelSnapshotAsync('buyer-c', payload('QUEUE-FIRST', 500)),
    snapshots.saveModelSnapshotAsync('buyer-c', payload('QUEUE-LAST', 500)),
  ]);
  const loaded = await snapshots.loadModelSnapshotAsync('buyer-c');
  assert.equal(loaded.asasOrders[0].model, 'QUEUE-LAST');
});
