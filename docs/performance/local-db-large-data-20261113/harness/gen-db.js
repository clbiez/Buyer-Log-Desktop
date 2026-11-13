'use strict';
// node gen-db.js <file> <scale>  — synthetic local DB shaped like a long-lived production DB.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const APP = process.env.APP || '/home/user/Buyer-Log-Desktop/resources/app';
const { jsonToBuffer } = require(path.join(APP, 'server/lib/large-json'));
const [file, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg || 1);
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const dev = 'aaaaaaaa-0000-4000-8000-000000000001', peers = ['bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003'];
const t0 = Date.parse('2025-01-01T00:00:00Z');
const iso = i => new Date(t0 + i * 60000).toISOString();
const state = { schemaVersion: 3, revision: 0, deviceId: dev, localSequence: 0, hlc: { wallMs: t0, counter: 0, node: dev }, records: {}, tombstones: {}, events: {}, appliedEvents: {}, appliedPackages: {}, conflicts: [], journal: [], syncCheckpoints: {}, syncLedger: { version: 1, eventIds: {}, acknowledgedEventIds: {}, compactedEvents: 0, compactedThrough: 0, acknowledgedThrough: 0, ranges: [], receivedBeyondByDevice: {} }, assets: {}, migrations: {}, causalKnowledge: {}, remoteApplyRevisions: {} };
const RECORDS = Math.round(40000 * scale), LOCAL = Math.round(180000 * scale), REMOTE = Math.round(150000 * scale);
const fieldVal = () => ({ dates: { po: iso(Math.floor(rnd() * 1e5)), ex: iso(Math.floor(rnd() * 1e5)) }, suppFob: (rnd() * 20).toFixed(2), importance: rnd() > 0.5 ? 'High' : 'Normal', subManufacturer: 'SUB-' + Math.floor(rnd() * 900), note: 'n'.repeat(Math.floor(rnd() * 120)) });
for (let i = 0; i < RECORDS; i++) {
  const v = fieldVal(), rev = i + 1;
  const fr = {}, fw = {}; for (const k of Object.keys(v)) { fr[k] = rev; fw[k] = { d: dev, s: rev }; }
  state.records['cp-order:' + (100000 + i)] = { ...v, _fieldRevisions: fr, _fieldWriters: fw, _revision: rev, _deleted: false };
}
// a few large shared documents (stores)
for (let s = 0; s < 12; s++) {
  const doc = { rows: Array.from({ length: Math.round(4000 * scale) }, (_, i) => ({ id: i, a: 'x'.repeat(40), b: rnd() })) };
  state.records['store:doc-' + s + '.json'] = { doc, _fieldRevisions: { doc: 1 }, _fieldWriters: { doc: { d: dev, s: 1 } }, _revision: 1, _deleted: false };
}
let seq = 0, revision = RECORDS;
for (let i = 0; i < LOCAL; i++) {
  seq++; revision++;
  const eid = crypto.randomUUID(), at = iso(i);
  const patch = fieldVal();
  const item = { schemaVersion: 3, eventId: eid, id: 'cp-order:' + (100000 + Math.floor(rnd() * RECORDS)), entityType: 'record', userId: 'u1', deviceId: dev, operation: 'update', patch, revision, baseRevision: revision - 1, seen: { [peers[0]]: i, [peers[1]]: i }, localSequence: seq, at, origin: 'local', hlc: { wallMs: t0 + i * 60000, counter: 0, node: dev }, uploaded: true, acknowledged: true, synced: true, uploadedAt: at, acknowledgedAt: at };
  item.sha256 = crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');
  state.journal.push(item);
  state.events[eid] = { eventId: eid, revision, at, origin: 'local', deviceId: dev, localSequence: seq };
}
for (let i = 0; i < REMOTE; i++) {
  revision++;
  const eid = crypto.randomUUID(), at = iso(i), d = peers[i % 2];
  state.events[eid] = { eventId: eid, revision, at, origin: 'remote', deviceId: d, localSequence: i + 1 };
  state.appliedEvents[eid] = { eventId: eid, revision, at, origin: 'remote', deviceId: d, userId: 'u2' };
}
state.syncCheckpoints = { [peers[0]]: Math.ceil(REMOTE / 2), [peers[1]]: Math.floor(REMOTE / 2) };
state.revision = revision; state.localSequence = seq; state.hlc.wallMs = t0 + LOCAL * 60000;
state.syncLedger.acknowledgedThrough = seq;
fs.mkdirSync(path.dirname(file), { recursive: true });
const buf = jsonToBuffer(state);
fs.writeFileSync(file, buf);
fs.writeFileSync(file + '.bak', buf);
console.log(JSON.stringify({ file, bytes: buf.length, records: RECORDS, journal: LOCAL, events: LOCAL + REMOTE }));
