'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-final-phase-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const userData = require('../server/user-data');
const { runExcelTask, getExcelWorkerStats } = require('../server/excel-worker-client');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('order and Supp. FOB mutations reject stale sub-revisions and batch writes are atomic', () => {
  const first = db.patchOrderOverride(1001, { subManufacturer: 'A' }, 0);
  assert.equal(first.revision, 1);
  assert.throws(() => db.patchOrderOverride(1002, { subManufacturer: 'B' }, 0), err => err && err.code === 'REVISION_CONFLICT' && err.currentRevision === 1);
  const batch = db.patchOrderOverrides([
    { orderCode: 1002, patch: { subManufacturer: 'B' } },
    { orderCode: 1003, patch: { licensor: 'DTR' } },
  ], 1);
  assert.equal(batch.updated, 2);
  assert.equal(batch.revision, 2);
  const loaded = db.loadOverrides();
  assert.equal(loaded.submap[1002], 'B');
  assert.equal(loaded.licensormap[1003], 'DTR');
  assert.equal(loaded._revisions.orders, 2);

  const manualFob = db.patchOrderOverride(1001, { suppFob: 4.25 }, 2, 0);
  assert.equal(manualFob.revisions.orders, 3);
  assert.equal(manualFob.revisions.suppFob, 1);
  assert.throws(
    () => db.patchOrderOverride(1002, { suppFob: 5 }, 3, 0),
    err => err && err.code === 'REVISION_CONFLICT' && err.revisionKey === 'suppFob' && err.currentRevision === 1,
  );

  const fob = db.patchSuppFobOverrides([{ orderCode: 1002, suppFob: 5 }], 1);
  assert.equal(fob.revision, 2);
  assert.throws(() => db.patchSuppFobOverrides([{ orderCode: 1003, suppFob: 6 }], 1), err => err && err.code === 'REVISION_CONFLICT' && err.revisionKey === 'suppFob');

  const cpBatch = db.patchOrderOverrides([
    { orderCode: 1004, patch: { subManufacturer: 'CP-A', suppFob: 7.5 } },
    { orderCode: 1005, patch: { licensor: 'CP-B' } },
  ], 3, 2);
  assert.equal(cpBatch.updated, 2);
  assert.deepEqual(cpBatch.revisions, { orders: 4, suppFob: 3 });
  assert.equal(db.loadOverrides().suppfobmap[1004], 7.5);
});

test('schema v2 backup streams file chunks and restores a complete data set', async () => {
  fs.mkdirSync(userData.SERVER_DATA_ROOT, { recursive: true });
  fs.mkdirSync(userData.MODEL_FILES_ROOT, { recursive: true });
  fs.mkdirSync(userData.COLLECTION_IMAGES_ROOT, { recursive: true });
  const large = Buffer.alloc(3 * 1024 * 1024 + 137, 0x5a);
  fs.writeFileSync(path.join(userData.SERVER_DATA_ROOT, 'stream.json'), JSON.stringify({ ok: true }));
  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT, 'large.bin'), large);
  fs.writeFileSync(path.join(userData.COLLECTION_IMAGES_ROOT, 'image.bin'), Buffer.from('image-data'));
  fs.writeFileSync(userData.CONFIG_PATH, JSON.stringify({ host: '127.0.0.1' }));

  const progress = [];
  const backup = await userData.exportBackupToFile({ appVersion: '2.72', browserStorage: { theme: 'dark' }, onProgress: p => progress.push(p.processedBytes) });
  assert.ok(backup.size > 0);
  assert.ok(progress.length > 1);
  const raw = zlib.gunzipSync(fs.readFileSync(backup.path));
  const firstLine = raw.subarray(0, raw.indexOf(0x0a)).toString('utf8');
  const manifest = JSON.parse(firstLine);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.record, 'manifest');
  assert.match(raw.toString('utf8', 0, Math.min(raw.length, 200000)), /"record":"fileChunk"/);

  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT, 'large.bin'), Buffer.from('changed'));
  fs.writeFileSync(path.join(userData.SERVER_DATA_ROOT, 'created-after.bak'), Buffer.from('remove'));
  const restored = await userData.restoreBackupFromFile(backup.path);
  assert.equal(restored.sourceAppVersion, '2.72');
  assert.equal(restored.browserStorage.theme, 'dark');
  assert.deepEqual(fs.readFileSync(path.join(userData.MODEL_FILES_ROOT, 'large.bin')), large);
  assert.equal(fs.existsSync(path.join(userData.SERVER_DATA_ROOT, 'created-after.bak')), false);

  const unpacked = zlib.gunzipSync(fs.readFileSync(backup.path)).toString('utf8').trimEnd().split('\n');
  assert.equal(JSON.parse(unpacked.at(-1)).record, 'end');
  const truncatedPath = path.join(root, 'truncated.blgbackup');
  fs.writeFileSync(truncatedPath, zlib.gzipSync(Buffer.from(unpacked.slice(0, -1).join('\n') + '\n')));
  await assert.rejects(() => userData.restoreBackupFromFile(truncatedPath), /eksik veya yarım kalmış/i);
  const trailingPath = path.join(root, 'trailing.blgbackup');
  fs.writeFileSync(trailingPath, zlib.gzipSync(Buffer.from(unpacked.join('\n') + '\n' + JSON.stringify({ record: 'browserChunk', base64: '' }) + '\n')));
  await assert.rejects(() => userData.restoreBackupFromFile(trailingPath), /bitiş kaydından sonra/i);
  backup.cleanup();
});

test('Excel CPU work runs outside the main event loop and the queue reports completion', async () => {
  let timerFired = false;
  const pending = runExcelTask('diagnosticSpin', { ms: 120 }, { timeoutMs: 5000 });
  await new Promise(resolve => setTimeout(() => { timerFired = true; resolve(); }, 20));
  assert.equal(timerFired, true);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.ms, 120);
  const stats = getExcelWorkerStats();
  assert.ok(stats.completed >= 1);
  assert.equal(stats.active, false);
});
