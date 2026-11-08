'use strict';
// Measurement-only extension: count direct descriptor writes as well as the
// inherited path-based observer's writeFileSync/appendFileSync payloads.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
function observeCheckpointWrites(root) {
  const prefix = path.resolve(root) + path.sep;
  const names = ['openSync', 'closeSync', 'writeSync', 'writeFileSync', 'appendFileSync'];
  const originals = Object.fromEntries(names.map(name => [name, fs[name]]));
  const descriptors = new Map(), metrics = { bytes: 0, calls: 0, descriptorCalls: 0 };
  let depth = 0;
  const inside = file => {
    if (typeof file === 'number') return descriptors.get(file) === true;
    if (file instanceof URL) file = fileURLToPath(file);
    return typeof file === 'string' && path.resolve(file).startsWith(prefix);
  };
  fs.openSync = function(file, ...args) {
    const fd = originals.openSync.call(this, file, ...args);
    descriptors.set(fd, inside(file)); return fd;
  };
  fs.closeSync = function(fd) {
    try { return originals.closeSync.call(this, fd); } finally { descriptors.delete(fd); }
  };
  for (const name of ['writeFileSync', 'appendFileSync']) fs[name] = function(file, data, options) {
    const outer = depth++ === 0;
    try {
      const result = originals[name].apply(this, arguments);
      if (outer && inside(file)) {
        const encoding = typeof options === 'string' ? options : options && options.encoding || 'utf8';
        metrics.bytes += typeof data === 'string' ? Buffer.byteLength(data, encoding) : data.byteLength;
        metrics.calls += 1;
      }
      return result;
    } finally { depth -= 1; }
  };
  fs.writeSync = function(fd, ...args) {
    const result = originals.writeSync.call(this, fd, ...args);
    if (depth === 0 && inside(fd)) {
      metrics.bytes += result; metrics.calls += 1; metrics.descriptorCalls += 1;
    }
    return result;
  };
  return { metrics, restore() { Object.assign(fs, originals); } };
}
module.exports = { observeCheckpointWrites };
