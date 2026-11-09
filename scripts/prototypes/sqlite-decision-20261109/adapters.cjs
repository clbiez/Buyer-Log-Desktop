'use strict';

const path = require('node:path');
const { createLocalDb } = require('../../../resources/app/server/lib/local-db');
const { DEVICE, CLOCK } = require('./workload.cjs');

function local(file) {
  const db = createLocalDb(file, { clock: () => CLOCK }); // Default WAL limits, leases and fsync.
  return {
    db, ensure: () => db.ensure(),
    initialize: () => db.transaction(state => { state.deviceId = DEVICE; }),
    queuePatch: item => db.queuePatch(item), queuePatches: items => db.queuePatches(items),
    async get(id) { return (await db.read()).records[id] || null; },
    async filter(q) { return Object.entries((await db.read()).records)
      .filter(([, r]) => r.kind === q.kind && r.state === q.state && r.owner === q.owner)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, q.limit).map(([id, record]) => ({ id, record })); },
    pending: limit => db.pending(limit), pendingCount: () => db.pendingCount(),
    markSynced: ids => db.markSynced(ids), compact: () => db.compact({ keepUploadedTail: 1000 }),
    async records() { return (await db.read()).records; },
    async counts() { const s = await db.read(); return { records: Object.keys(s.records).length,
      events: Object.keys(s.events).length, journal: s.journal.length,
      ledger: Object.keys(s.syncLedger.eventIds).length, sequence: s.localSequence }; },
    async eventIds() { const s = await db.read(); return [...Object.keys(s.events), ...Object.keys(s.syncLedger.eventIds)].sort(); },
    close() {},
  };
}

// R2 SQLite compatibility slice owns its SQL transactions and storage.
const { sqlite } = require('./sqlite-compat.cjs');

function open(engine, folder) { return engine === 'local' ? local(path.join(folder, 'BuyerLogLocal.db')) : sqlite(path.join(folder, 'prototype.sqlite')); }
module.exports = { open };
