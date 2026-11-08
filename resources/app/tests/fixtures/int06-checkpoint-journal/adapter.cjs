'use strict';

// Test-only seam: existing connector still creates full checkpoints. This is
// correctness evidence, never a production integration/performance claim.
const path = require('node:path');
const assert = require('node:assert/strict');
const { PowerBiImportDashboardConnector, createDashboardRefreshManifest } = require('../../../server/lib/power-bi-import-dashboard');
const { openCheckpointJournal } = require('../../../server/lib/power-bi-checkpoint-journal');
const { createFixture, identity } = require('./inherited/resources/app/scripts/lib/powerbi-checkpoint-fixture.js.source');

async function refresh(config, boundary = () => {}) {
  const fixture = createFixture(config), transport = fixture.transport();
  const journal = openCheckpointJournal({ root: path.join(config.root, 'checkpoint'),
    initial: createDashboardRefreshManifest(fixture.orderCodes, { refreshId: 'synthetic-int06' }),
    legacyFile: config.legacyFile, snapshotEvery: config.snapshotEvery || 2,
    onPhase: config.onPhase });
  const saved = journal.materialize(), controller = new AbortController();
  let rowCursor = saved.rows.length, checkpoints = 0;
  if (config.cancelDuring) transport.queryBatch = async () => {
    if (config.cancelDuring === 'retry') {
      setImmediate(() => controller.abort()); throw Error('synthetic retry wait');
    }
    controller.abort(); throw Object.assign(Error('synthetic cancel'), { code: 'POWERBI_DASHBOARD_CANCELLED' });
  };
  if (config.cancelBefore) controller.abort();
  const connector = new PowerBiImportDashboardConnector({ transport, batchSize: config.batchSize, maxRetries: 1,
    backoffMs: config.cancelDuring === 'retry' ? 20 : 1 });
  const result = await connector.refresh({ orderCodes: fixture.orderCodes, manifest: saved, signal: controller.signal,
    checkpoint: async value => {
      const orderStates = Object.fromEntries((value.lastBatch?.orderCodes || []).map(code => [identity(code), value.orderStates[identity(code)]]));
      const ack = journal.commit({ seq: journal.sequence + 1, orderStates, rows: value.rows.slice(rowCursor),
        lastBatch: value.lastBatch, updatedAt: value.updatedAt, retryPending: value.retryPending });
      assert.deepEqual(journal.materialize(), JSON.parse(JSON.stringify(value)), 'every persisted manifest field equals the existing connector checkpoint');
      rowCursor = value.rows.length; checkpoints += 1;
      if (checkpoints === config.cancelAt) controller.abort();
      await boundary({ checkpoints, ack });
    } });
  return { result, checkpoints, saved: journal.materialize(), queriedCodes: transport.queriedCodes, stats: transport.stats };
}
module.exports = { refresh };
