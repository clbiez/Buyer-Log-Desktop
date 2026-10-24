'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { atomicWriteJson } = require('../electron/update/json-store');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-updater-atomic-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const file = path.join(root, 'state.json'); fs.writeFileSync(file, '{"generation":"old"}'); return { root, file }; }
test('transient replacement exhaustion preserves the previous updater state instead of unlinking it', t => {
  const { root, file } = fixture(t), rename = fs.renameSync;
  fs.renameSync = (_source, destination) => { if (destination === file) throw Object.assign(new Error('synthetic antivirus lock'), { code: 'EBUSY' }); return rename(_source, destination); };
  try { assert.throws(() => atomicWriteJson(file, { generation: 'new' }), { code: 'EBUSY' }); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"generation":"old"}');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
test('file fsync failure is reported before any replacement and leaves the last valid state intact', t => {
  const { root, file } = fixture(t), sync = fs.fsyncSync;
  fs.fsyncSync = () => { throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); };
  try { assert.throws(() => atomicWriteJson(file, { generation: 'new' }), { code: 'ENOSPC' }); }
  finally { fs.fsyncSync = sync; }
  assert.equal(fs.readFileSync(file, 'utf8'), '{"generation":"old"}');
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});
