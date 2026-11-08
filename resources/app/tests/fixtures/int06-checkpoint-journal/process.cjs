'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { refresh } = require('./adapter.cjs');
const config = JSON.parse(process.argv[2]);
let armed = false;
function park(message) {
  process.send(message);
  // Parent issues a real SIGKILL. No exception-based crash simulation here.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
(async () => {
  const output = await refresh({ ...config, onPhase: phase => {
    if (armed && phase === config.killPhase) park({ type: 'phase', phase });
    if (phase === 'journal:written') armed = true;
    // Include the first append boundary, after initialization has completed.
    if (armed && phase === config.killPhase && phase === 'journal:written') park({ type: 'phase', phase });
  } }, async message => {
    if (message.checkpoints === config.killAt) park({ type: 'ack', ...message });
  });
  fs.writeFileSync(path.join(config.root, 'result.json'), JSON.stringify(output));
  if (process.connected) process.disconnect();
})().catch(error => { console.error(error); process.exitCode = 1; if (process.connected) process.disconnect(); });
