'use strict';

const path = require('node:path');
const { createLocalDb } = require('../../../resources/app/server/lib/local-db');
const { createHlc } = require('../../../resources/app/server/lib/hlc');
const { DEVICE, CLOCK, clone, hash } = require('./workload.cjs');

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

// Deliberately limited to local authoritative patches in workload.cjs. This is
// not a migration adapter: no remote merge, permissions, tombstones or packages.
function sqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    PRAGMA cache_size=-8192; PRAGMA wal_autocheckpoint=256;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta VALUES('sequence','0');
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, body TEXT NOT NULL,
      kind TEXT, state TEXT, owner TEXT);
    CREATE INDEX IF NOT EXISTS records_filter ON records(kind,state,owner,id);
    CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL,
      uploaded INTEGER NOT NULL DEFAULT 0, body TEXT);
    CREATE INDEX IF NOT EXISTS pending_events ON events(uploaded,sequence);`);
  const get = db.prepare('SELECT body FROM records WHERE id=?');
  const put = db.prepare(`INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(id)
    DO UPDATE SET body=excluded.body,kind=excluded.kind,state=excluded.state,owner=excluded.owner`);
  const exists = db.prepare('SELECT 1 FROM events WHERE event_id=?');
  const add = db.prepare('INSERT INTO events(event_id,sequence,body) VALUES(?,?,?)');
  const sequenceGet = db.prepare("SELECT value FROM meta WHERE key='sequence'");
  const sequencePut = db.prepare("UPDATE meta SET value=? WHERE key='sequence'");
  const selectPending = db.prepare('SELECT body FROM events WHERE uploaded=0 ORDER BY sequence LIMIT ?');
  const selectFilter = db.prepare('SELECT id,body FROM records WHERE kind=? AND state=? AND owner=? ORDER BY id LIMIT ?');
  const updateSync = db.prepare('UPDATE events SET uploaded=1 WHERE event_id=?');
  let sequence = Number(sequenceGet.get().value);
  function transaction(fn) {
    const before = sequence;
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); sequencePut.run(String(sequence)); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); sequence = before; throw error; }
  }
  function patch(item) {
    if (exists.get(item.eventId)) return { duplicate: true, eventId: item.eventId };
    const prior = get.get(item.id);
    const record = prior ? JSON.parse(prior.body) : {};
    const baseRevision = record._revision || 0;
    sequence++;
    const fields = { ...record._fieldRevisions }, writers = { ...record._fieldWriters };
    for (const [key, value] of Object.entries(item.patch)) {
      if (key.startsWith('_')) throw Error('Prototype accepts business fields only');
      record[key] = clone(value); fields[key] = sequence; writers[key] = { d: DEVICE, s: sequence };
    }
    Object.assign(record, { _fieldRevisions: fields, _fieldWriters: writers, _revision: sequence, _deleted: false });
    const hlc = createHlc({ node: DEVICE, now: () => CLOCK,
      state: sequence > 1 ? { wallMs: CLOCK, counter: sequence - 2, node: DEVICE } : null }).tick();
    const journal = { schemaVersion: 3, eventId: item.eventId, id: item.id, entityType: 'record',
      userId: item.userId ?? null, deviceId: DEVICE, operation: prior ? 'update' : 'create',
      patch: clone(item.patch), revision: sequence, baseRevision, seen: {}, localSequence: sequence,
      at: item.at, origin: item.origin, hlc, uploaded: false, acknowledged: false, synced: false };
    journal.sha256 = hash(journal);
    put.run(item.id, JSON.stringify(record), record.kind ?? null, record.state ?? null, record.owner ?? null);
    add.run(item.eventId, sequence, JSON.stringify(journal));
    return { duplicate: false, eventId: item.eventId, record, revision: sequence, localSequence: sequence };
  }
  return {
    db, ensure() {}, initialize() {},
    queuePatch: item => transaction(() => patch(item)),
    queuePatches: items => transaction(() => { const results = items.map(patch);
      return { count: results.filter(r => !r.duplicate).length, results }; }),
    get: id => { const row = get.get(id); return row ? JSON.parse(row.body) : null; },
    filter: q => selectFilter.all(q.kind, q.state, q.owner, q.limit).map(r => ({ id: r.id, record: JSON.parse(r.body) })),
    pending: limit => selectPending.all(limit).map(r => JSON.parse(r.body)),
    pendingCount: () => db.prepare('SELECT count(*) AS n FROM events WHERE uploaded=0').get().n,
    markSynced: ids => transaction(() => { for (const id of ids) updateSync.run(id); }),
    compact() {
      transaction(() => db.exec(`UPDATE events SET body=NULL WHERE uploaded=1 AND body IS NOT NULL
        AND event_id NOT IN (SELECT event_id FROM events WHERE uploaded=1 AND body IS NOT NULL ORDER BY sequence DESC LIMIT 1000)`));
      db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
    },
    records: () => Object.fromEntries(db.prepare('SELECT id,body FROM records ORDER BY id').all().map(r => [r.id, JSON.parse(r.body)])),
    counts: () => ({ records: db.prepare('SELECT count(*) AS n FROM records').get().n,
      events: db.prepare('SELECT count(*) AS n FROM events WHERE body IS NOT NULL').get().n,
      journal: db.prepare('SELECT count(*) AS n FROM events WHERE body IS NOT NULL').get().n,
      ledger: db.prepare('SELECT count(*) AS n FROM events WHERE body IS NULL').get().n, sequence }),
    eventIds: () => db.prepare('SELECT event_id FROM events ORDER BY event_id').all().map(r => r.event_id),
    close: () => db.close(),
  };
}

function open(engine, folder) { return engine === 'local' ? local(path.join(folder, 'BuyerLogLocal.db')) : sqlite(path.join(folder, 'prototype.sqlite')); }
module.exports = { open };
