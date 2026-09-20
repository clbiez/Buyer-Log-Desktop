'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-tp-retention-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
const userData = require('../server/user-data');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('TP model files older than one year are purged while newer files remain', () => {
  fs.mkdirSync(userData.MODEL_FILES_ROOT, { recursive: true });
  const old = path.join(userData.MODEL_FILES_ROOT, 'old.bin');
  const fresh = path.join(userData.MODEL_FILES_ROOT, 'fresh.bin');
  fs.writeFileSync(old, 'old'); fs.writeFileSync(fresh, 'fresh');
  const now = Date.parse('2026-08-11T00:00:00.000Z');
  const index = [
    { id:'old', modelKey:'m1', filename:'old.bin', storedName:'old.bin', size:3, createdAt:'2025-08-10T23:59:59.000Z' },
    { id:'fresh', modelKey:'m2', filename:'fresh.bin', storedName:'fresh.bin', size:5, createdAt:'2025-08-11T00:00:01.000Z' },
  ];
  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT,'index.json'), JSON.stringify(index));
  const result = userData.purgeExpiredModelFiles(now);
  assert.equal(result.deletedFiles, 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
  const kept = JSON.parse(fs.readFileSync(path.join(userData.MODEL_FILES_ROOT,'index.json'),'utf8'));
  assert.deepEqual(kept.map(x=>x.id), ['fresh']);
});

test('collection images are not touched by TP retention cleanup', () => {
  fs.mkdirSync(userData.COLLECTION_IMAGES_ROOT, { recursive: true });
  const image = path.join(userData.COLLECTION_IMAGES_ROOT, 'keep.png');
  fs.writeFileSync(image, 'image');
  const result = userData.purgeExpiredModelFiles(Date.parse('2030-01-01T00:00:00.000Z'));
  assert.ok(result.deletedFiles >= 0);
  assert.equal(fs.existsSync(image), true);
});
