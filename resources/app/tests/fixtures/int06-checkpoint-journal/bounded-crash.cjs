'use strict';
const fs = require('node:fs');
const { openCheckpointJournal } = require('../../../server/lib/power-bi-checkpoint-journal');
const journal = openCheckpointJournal({ root: process.argv[2] });
const write = fs.writeSync;
let writes = 0;
fs.writeSync = function(...args) {
  const result = write.apply(this, args);
  if (++writes === 3) {
    process.send({ phase: 'snapshot:partial-body' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  return result;
};
journal.compact();
if (process.connected) process.disconnect();
