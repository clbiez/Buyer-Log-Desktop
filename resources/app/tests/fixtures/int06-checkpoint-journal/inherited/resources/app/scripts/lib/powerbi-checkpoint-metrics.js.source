'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// For the current synchronous store; isolated CLI/test process only. Counts
// successful payload bytes, not physical device/SMB bytes, rename metadata or fsync.
function observeCheckpointWrites(root) {
  const prefix = path.resolve(root) + path.sep;
  const originals = {};
  const metrics = { bytes: 0, calls: 0 };
  let depth = 0;
  for (const name of ['writeFileSync', 'appendFileSync']) {
    originals[name] = fs[name];
    fs[name] = function(file, data, options) {
      const outer = depth++ === 0;
      try {
        const result = originals[name].apply(this, arguments);
        const filename = file instanceof URL ? fileURLToPath(file) : file;
        if (outer && typeof filename === 'string' && path.resolve(filename).startsWith(prefix)) {
          const encoding = typeof options === 'string' ? options : options && options.encoding || 'utf8';
          metrics.bytes += typeof data === 'string' ? Buffer.byteLength(data, encoding) : data.byteLength;
          metrics.calls += 1;
        }
        return result;
      } finally { depth -= 1; }
    };
  }
  return { metrics, restore() { Object.assign(fs, originals); } };
}

module.exports = { observeCheckpointWrites };
