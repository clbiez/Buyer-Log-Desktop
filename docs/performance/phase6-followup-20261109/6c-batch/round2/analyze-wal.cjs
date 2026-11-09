'use strict';
// Offline accounting only: raw byte totals remain the acceptance metric.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(process.argv[2] || path.join(__dirname, 'pairs'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonSha = value => sha(JSON.stringify(value));
const sum = xs => xs.reduce((a, b) => a + b, 0);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const readEvidence = file => fs.existsSync(file) ? fs.readFileSync(file) : zlib.gunzipSync(fs.readFileSync(file + '.gz'));
function logicalWal(entries) {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      /^(NotesAt|EkNotAt|markedAt|updatedAt|_updatedAt)$/.test(k) && typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? 'SERVER_TIMESTAMP' : normalize(v)]));
    return value;
  };
  return entries.map(({ v, op, payload }) => {
    const { eventId, at, hlc, ...business } = payload;
    if (eventId !== undefined) assert.match(eventId, /^[0-9a-f-]{36}$/);
    if (at !== undefined) assert.ok(Number.isFinite(Date.parse(at)));
    if (hlc !== undefined) assert.ok(Number.isSafeInteger(hlc.wallMs) && Number.isSafeInteger(hlc.counter));
    return { v, op, payload: normalize(business) };
  });
}
function parseWal(raw) {
  // Match the unchanged product's literal backslash-n separator. Splitting must
  // happen outside JSON strings (patch text can itself contain escaped newlines).
  const entries = [];
  let start = raw.startsWith('\\n') ? 2 : raw.startsWith('\n') ? 1 : 0;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        const text = raw.slice(start, i + 1), entry = JSON.parse(text);
        assert.equal(JSON.stringify(entry), text);
        assert.equal(entry.sha256, jsonSha({ v: entry.v, op: entry.op, payload: entry.payload }));
        entries.push(entry);
        if (raw.slice(i + 1, i + 3) === '\\n') i += 2;
        else if (raw[i + 1] === '\n') i++;
        else assert.equal(i + 1, raw.length, 'Unexpected WAL separator');
        start = i + 1;
      }
    }
  }
  assert.equal(start, raw.length);
  return entries;
}
function account(sample) {
  const raw = readEvidence(path.join(root, sample.walFile));
  assert.equal(raw.length, sample.physical.walBytes);
  const entries = parseWal(raw.toString('utf8')), fields = {}, histogram = {};
  function visit(value, key) {
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, key ? `${key}.${k}` : k);
    } else fields[key] = (fields[key] || 0) + Buffer.byteLength(JSON.stringify(value));
  }
  for (const entry of entries) {
    visit(entry, '');
    const n = entry.payload?.hlc?.counter;
    if (n !== undefined) histogram[n] = (histogram[n] || 0) + 1;
  }
  fields['<JSON keys, structure, separators>'] = raw.length - sum(Object.values(fields));
  const journal = JSON.parse(readEvidence(path.join(root, sample.journalFile)));
  const ids = new Set();
  for (const event of journal) {
    assert.equal(event.sha256, jsonSha({ ...event, sha256: undefined }));
    assert.ok(!ids.has(event.eventId)); ids.add(event.eventId);
  }
  const journalById = new Map(journal.map(e => [e.eventId, e]));
  const cp = entries.filter(e => e.payload?.entityType === 'cp-order');
  assert.equal(cp.length, sample.count);
  for (const entry of cp) {
    const e = journalById.get(entry.payload.eventId);
    assert.ok(e);
    for (const k of ['id', 'eventId', 'userId', 'entityType', 'patch', 'hlc', 'at']) {
      assert.deepEqual(entry.payload[k], e[k], `WAL→journal identity ${k}`);
    }
    // local-db.normalizeSubfields intentionally omits a no-op dates mask when
    // dates is absent from the effective patch. Validate the existing rule.
    const p = entry.payload;
    const dates = p.patch?.dates;
    const subs = Object.hasOwn(p.patch, 'dates') && (dates == null || (typeof dates === 'object' && !Array.isArray(dates)))
      ? [...new Set((p.subfields?.dates || []).map(String))].filter(s => ['ex', 'retail', 'mb'].includes(s)).sort() : [];
    assert.deepEqual(e.subfields, subs.length ? { dates: subs } : undefined);
  }
  return { rawBytes: raw.length, sha256: sha(raw), entryCount: entries.length,
    cpEventCount: cp.length, journalCount: journal.length,
    walJournalIdentityAndChecksums: true, counterHistogram: histogram, fields };
}
const pairs = [];
for (const count of [100, 1000]) for (let pair = 1; pair <= 3; pair++) {
  const arms = Object.fromEntries(['main', 'candidate'].map(arm => {
    const result = JSON.parse(fs.readFileSync(path.join(root, `ab-${count}-${pair}-${arm}.json`)));
    assert.equal(result.ok, true); return [arm, result];
  }));
  assert.equal(arms.main.fixtureHash, arms.candidate.fixtureHash);
  for (const phase of ['cold', 'warm']) {
    const samples = Object.fromEntries(Object.entries(arms).map(([arm, r]) => [arm, r.rows.find(s => s.phase === phase)]));
    const m = samples.main, c = samples.candidate;
    for (const key of ['fixtureHash', 'businessHash', 'eventHash', 'ackHash', 'eventCount', 'updated']) assert.deepEqual(m[key], c[key], key);
    assert.equal(m.replayEqual, true); assert.equal(c.replayEqual, true);
    const main = account(m), candidate = account(c);
    assert.deepEqual(logicalWal(parseWal(readEvidence(path.join(root, m.walFile)).toString('utf8'))),
      logicalWal(parseWal(readEvidence(path.join(root, c.walFile)).toString('utf8'))), 'Ordered WAL patch/owner/actor/subfields parity');
    const fieldDeltas = Object.fromEntries([...new Set([...Object.keys(main.fields), ...Object.keys(candidate.fields)])]
      .map(key => [key, (candidate.fields[key] || 0) - (main.fields[key] || 0)]).filter(([, n]) => n));
    const byteDelta = candidate.rawBytes - main.rawBytes;
    assert.equal(sum(Object.values(fieldDeltas)), byteDelta);
    pairs.push({ count, pair, phase, byteDelta, bytePercent: 100 * byteDelta / main.rawBytes,
      counterByteDelta: fieldDeltas['payload.hlc.counter'] || 0,
      nonCounterByteDelta: byteDelta - (fieldDeltas['payload.hlc.counter'] || 0),
      fieldDeltas, parity: true, main, candidate, metrics: samples });
  }
}
const medians = [];
for (const count of [100, 1000]) for (const phase of ['cold', 'warm']) {
  const group = pairs.filter(p => p.count === count && p.phase === phase);
  const result = { count, phase, pairedByteDeltas: group.map(p => p.byteDelta),
    pairedBytePercent: group.map(p => p.bytePercent), pairedCounterByteDeltas: group.map(p => p.counterByteDelta) };
  for (const arm of ['main', 'candidate']) {
    result[arm] = Object.fromEntries(['ackMs', 'totalMs', 'cpuMs', 'eventLoopGapMs', 'peakRss', 'peakHeap']
      .map(k => [k, median(group.map(p => p.metrics[arm][k]))]));
    result[arm].physical = Object.fromEntries(['walAppend', 'fsync', 'walBytes', 'lease', 'serialize']
      .map(k => [k, median(group.map(p => p.metrics[arm].physical[k]))]));
  }
  medians.push(result);
}
const result = { decision: pairs.some(p => p.byteDelta > 0) ? 'BLOCKED: strict raw WAL gate FAIL' : 'WAL gate passed in this series only',
  samples: pairs.length, increased: pairs.filter(p => p.byteDelta > 0).length,
  explanation: 'Field widths are diagnostic accounting of actual raw bytes, not a normalized acceptance total. UUID/hash/time content differs across independent processes; equal widths are verified. Replay preserves actual UUID/HLC/receipts within each process.',
  medians, pairs };
fs.writeFileSync(path.join(__dirname, 'wal-analysis.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ decision: result.decision, increased: result.increased, medians }, null, 2));
