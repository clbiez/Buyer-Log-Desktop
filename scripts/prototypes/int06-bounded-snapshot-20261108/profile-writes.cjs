'use strict';
// Diagnostic only; reuse the existing no-GC/no-sampling lifecycle probes and
// add observations for bounded descriptor writes. Never load in acceptance.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
require(path.resolve(__dirname, '../../../resources/app/tests/fixtures/int06-checkpoint-journal/profile.cjs'));
const output = process.env.INT06_PROFILE_OUTPUT + '.writes.json';
if (fs.existsSync(output)) throw Error('never overwrite diagnostic evidence');
const original = { open: fs.openSync, close: fs.closeSync, write: fs.writeSync };
const descriptors = new Map(), snapshots = [];
fs.openSync = function(file, ...args) {
  const fd = original.open.call(this, file, ...args);
  if (typeof file === 'string' && /snapshot\.json\..*\.tmp$/.test(file) && args[0] === 'wx') {
    descriptors.set(fd, { writes: 0, bytes: 0, maxWriteBytes: 0, before: process.memoryUsage(),
      observedMax: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 } });
  }
  return fd;
};
fs.writeSync = function(fd, bytes, ...args) {
  const result = original.write.call(this, fd, bytes, ...args), record = descriptors.get(fd);
  if (record) {
    record.writes += 1; record.bytes += result;
    record.maxWriteBytes = Math.max(record.maxWriteBytes, bytes.length);
    const memory = process.memoryUsage();
    for (const key of Object.keys(record.observedMax)) record.observedMax[key] = Math.max(record.observedMax[key], memory[key]);
  }
  return result;
};
fs.closeSync = function(fd) {
  const record = descriptors.get(fd);
  if (record) {
    record.after = process.memoryUsage(); snapshots.push(record); descriptors.delete(fd);
  }
  return original.close.call(this, fd);
};
process.once('beforeExit', () => fs.writeFileSync(output, JSON.stringify({ diagnosticOnly: true,
  profilerSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), snapshots }, null, 2) + '\n', { flag: 'wx' }));
