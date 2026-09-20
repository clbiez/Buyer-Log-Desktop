'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fsync-resilience-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const userData = require('../server/user-data');
const db = require('../server/db');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function withFsyncFailure(code, fn) {
  const original = fs.fsyncSync;
  fs.fsyncSync = () => { const err = new Error(`${code}: simulated fsync failure`); err.code = code; throw err; };
  try { return fn(); } finally { fs.fsyncSync = original; }
}

test('atomic writes continue when Windows/OneDrive rejects fsync with EPERM', () => {
  const file = path.join(root, 'atomic', 'value.json');
  withFsyncFailure('EPERM', () => userData.atomicWriteBuffer(file, Buffer.from('{"ok":true}')));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}');
  const leftovers = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('atomic async writes retry transient EPERM while opening the temporary file', async () => {
  const file = path.join(root, 'atomic', 'async-open.json');
  const originalOpen = fs.promises.open;
  let failures = 0;
  fs.promises.open = async function patchedOpen(...args) {
    if (String(args[0]).endsWith('.tmp') && failures < 2) {
      failures += 1;
      const error = new Error('EPERM: simulated temporary-file open failure');
      error.code = 'EPERM';
      throw error;
    }
    return originalOpen.apply(this, args);
  };
  try {
    await userData.atomicWriteBufferAsync(file, Buffer.from('{"ok":true}'));
  } finally {
    fs.promises.open = originalOpen;
  }
  assert.equal(failures, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}');
  const leftovers = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('atomic writes still reject genuine I/O failures and preserve the old file', () => {
  const file = path.join(root, 'atomic', 'stable.json');
  userData.atomicWriteBuffer(file, Buffer.from('old'));
  assert.throws(
    () => withFsyncFailure('EIO', () => userData.atomicWriteBuffer(file, Buffer.from('new'))),
    err => err && err.code === 'EIO',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  const leftovers = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});


test('FX saves and repeated Collection image writes survive EPERM fsync failures', () => {
  const pixel = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');
  withFsyncFailure('EPERM', () => {
    const fx = db.saveFx({ base: 'USD', currencies: ['EUR'], months: { '2026-07': { EUR: 0.86 } }, sourceFile: 'KUR.xlsx' }, 0);
    assert.equal(fx._revision, 1);
    for (let i = 0; i < 25; i += 1) {
      userData.saveCollectionImage({ rowId: `row-${i}`, filename: `${i}.png`, mimeType: 'image/png', base64: pixel.toString('base64') });
    }
  });
  assert.equal(db.loadFx().months['2026-07'].EUR, 0.86);
  assert.equal(userData.readCollectionImageIndex().length, 25);
  const files = fs.readdirSync(userData.COLLECTION_IMAGES_ROOT);
  assert.equal(files.filter(name => /\.(png|jpg|webp|gif|svg|img)$/i.test(name)).length, 25);
});

test('backup restore also tolerates unsupported fsync without losing restored data', async () => {
  fs.mkdirSync(userData.SERVER_DATA_ROOT, { recursive: true });
  const source = path.join(userData.SERVER_DATA_ROOT, 'restore.json');
  fs.writeFileSync(source, '{"version":1}');
  const backup = await userData.exportBackupToFile({ appVersion: '2.79', browserStorage: {} });
  fs.writeFileSync(source, '{"version":2}');
  const original = fs.fsyncSync;
  fs.fsyncSync = () => { const err = new Error('EPERM: simulated restore sync failure'); err.code = 'EPERM'; throw err; };
  try { await userData.restoreBackupFromFile(backup.path); }
  finally { fs.fsyncSync = original; backup.cleanup(); }
  assert.equal(fs.readFileSync(source, 'utf8'), '{"version":1}');
});

test('model file index uses the shared resilient atomic writer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(source, /resolveStoredFile, atomicWriteJson,/);
  assert.match(source, /function writeModelFilesIndex\(items\)\{[\s\S]*?atomicWriteJson\(MODEL_FILES_INDEX,items\);/);
  assert.doesNotMatch(source, /function writeModelFilesIndex\(items\)\{[\s\S]*?fsyncSync/);
});
