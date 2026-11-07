'use strict';

// Test subprocess only: no application worker or production IPC mechanism.
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('../../scripts/lib/powerbi-checkpoint-fixture');
const config = JSON.parse(process.argv[2]);
const { PowerBiImportDashboardConnector, createDashboardCheckpointStore } = require('../../server/lib/power-bi-import-dashboard');

(async () => {
  const fixture = createFixture(config), transport = fixture.transport();
  const store = createDashboardCheckpointStore({ root: config.root, userId: 'synthetic' });
  const controller = new AbortController();
  if (config.cancelBefore) controller.abort();
  let checkpoints = 0;
  if (config.killAt) process.on('message', () => {}); // keep IPC alive while parked
  const connector = new PowerBiImportDashboardConnector({ transport, batchSize: config.batchSize, maxRetries: 1, backoffMs: 1 });
  const result = await connector.refresh({ orderCodes: fixture.orderCodes, manifest: store.load(), signal: controller.signal,
    checkpoint: async value => {
      store.save(value);
      checkpoints += 1;
      if (checkpoints === config.cancelAt) controller.abort();
      if (checkpoints === config.killAt) {
        process.send({ type: 'durable-boundary', checkpoints });
        await new Promise(() => {}); // parent kills only after the real save returns
      }
    } });
  fs.writeFileSync(path.join(config.root, 'result.json'), JSON.stringify({ result, checkpoints,
    queriedCodes: transport.queriedCodes, stats: transport.stats }));
  if (process.connected) process.disconnect();
})().catch(error => { console.error(error); process.exitCode = 1; if (process.connected) process.disconnect(); });
