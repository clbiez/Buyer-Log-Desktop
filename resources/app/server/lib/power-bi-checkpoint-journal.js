'use strict';

// INT-06: bağımsız yardımcı; çağıran tek yazarı ve refresh sahipliğini sağlar.
// Mevcut connector/store'a bağlanmaz. Yalnız JSON batch deltası sıcak yoldadır.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { uniqueOrderCodes } = require('./power-bi-import-dashboard');

const FORMAT = 2;
const COUNTER = { SUCCESS: 'successfulOrders', NOT_FOUND: 'notFoundOrders', FAILED: 'failedOrders' };
const identity = value => String(value).trim().toLocaleUpperCase('tr-TR').replace(/[.,\s]/g, '');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code) { return Object.assign(new Error(code), { code }); }
function check(value, code = 'CHECKPOINT_CORRUPT') { if (!value) throw fail(code); }
function pack(value) {
  const payload = JSON.stringify(value);
  return JSON.stringify({ payload, sha256: hash(payload) }) + '\n';
}
function unpack(bytes) {
  try {
    const envelope = JSON.parse(bytes.toString('utf8'));
    check(typeof envelope.payload === 'string' && hash(envelope.payload) === envelope.sha256);
    return { value: JSON.parse(envelope.payload), digest: envelope.sha256 };
  } catch (_) { throw fail('CHECKPOINT_CORRUPT'); }
}
function syncFile(file) {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncDir(folder) {
  const fd = fs.openSync(folder, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

// durable-file-recovery/user-data yardımcıları incelendi: bazı fsync hataları
// best-effort sayılıyor. Burada ACK/retirement için fsync zorunludur; hatalar
// yutulmaz. Bu dar snapshot değişimi, genel DB/WAL veya yeni worker değildir.
function atomicReplace(file, bytes, phase, hook) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
    hook(`${phase}:written`);
    syncFile(temp);
    hook(`${phase}:synced`);
    fs.renameSync(temp, file);
    hook(`${phase}:renamed`);
    syncDir(path.dirname(file));
    hook(`${phase}:durable`);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function readLegacyCheckpoint(file) {
  // Ayrı API: hasarlı yeni format için otomatik eski/stale checkpoint seçilmez.
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateManifest(value);
  return value;
}
function validateManifest(value) {
  check(value && value.schemaVersion === 1 && value.source === 'dashboard'
    && typeof value.refreshId === 'string' && value.refreshId.length > 0);
  check(Array.isArray(value.allOrderCodes));
  const codes = uniqueOrderCodes(value.allOrderCodes);
  check(JSON.stringify(codes) === JSON.stringify(value.allOrderCodes));
  const known = new Set(codes.map(identity));
  check(value.orderStates && !Array.isArray(value.orderStates) && typeof value.orderStates === 'object');
  const counts = { totalOrders: codes.length, processedOrders: 0, successfulOrders: 0, notFoundOrders: 0, failedOrders: 0 };
  for (const [code, state] of Object.entries(value.orderStates)) {
    check(known.has(code) && Object.hasOwn(COUNTER, state));
    counts.processedOrders += 1; counts[COUNTER[state]] += 1;
  }
  for (const [name, count] of Object.entries(counts)) check(value[name] === count);
  check(value.rows === undefined || Array.isArray(value.rows));
  check(value.retryPending === 0 || value.retryPending === 1);
  const remaining = codes.filter(code => !Object.hasOwn(value.orderStates, identity(code)));
  const failed = Object.entries(value.orderStates).filter(([, state]) => state === 'FAILED').map(([code]) => code);
  check(JSON.stringify(value.remainingOrders) === JSON.stringify(remaining));
  check(JSON.stringify(value.failedOrderCodes) === JSON.stringify(failed));
  if (value._allOrderCodes) check(JSON.stringify(value._allOrderCodes) === JSON.stringify(codes));
  return { codes, known, counts };
}

function openCheckpointJournal({ root, initial, legacyFile, snapshotEvery = 64, onPhase = () => {} } = {}) {
  check(typeof root === 'string' && root.length > 0, 'CHECKPOINT_OPTIONS');
  check(Number.isSafeInteger(snapshotEvery) && snapshotEvery > 0, 'CHECKPOINT_OPTIONS');
  root = path.resolve(root);
  // Üst dizin çağırana aittir; oluşturma ve dizin girdisi de ACK öncesi sync olur.
  try { fs.mkdirSync(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  syncDir(root); syncDir(path.dirname(root));
  const snapshotFile = path.join(root, 'snapshot.json'), journalFile = path.join(root, 'batches.jsonl');
  let poisoned = false, seq = 0, snapshotSeq = 0, receipts = new Map();
  let base, codes, known, counts, states, chunks;
  function install(manifest) {
    const validated = validateManifest(manifest);
    ({ codes, known, counts } = validated);
    base = clone(manifest);
    states = Object.assign(Object.create(null), base.orderStates);
    chunks = [base.rows || []];
    for (const name of ['rows', 'orderStates', 'remainingOrders', 'failedOrderCodes']) delete base[name];
  }
  function assertOpen() { check(!poisoned, 'CHECKPOINT_REOPEN_REQUIRED'); }
  function progress() { assertOpen(); return { seq, ...counts, retryPending: base.retryPending }; }
  // Yalnız senkron iç serialization kullanır; dışarıya referans verilmez.
  // Snapshot öncesi JSON roundtrip ikinci bir tam rows/state grafiği üretirdi.
  function manifestView() {
    assertOpen();
    const rows = [];
    for (const chunk of chunks) for (const row of chunk) rows.push(row);
    return { ...base, ...counts, allOrderCodes: codes, _allOrderCodes: codes,
      orderStates: states, rows,
      remainingOrders: codes.filter(code => !Object.hasOwn(states, identity(code))),
      failedOrderCodes: Object.entries(states).filter(([, state]) => state === 'FAILED').map(([code]) => code) };
  }
  function materialize() { return clone(manifestView()); }
  function validateDelta(d) {
    check(d && d.format === FORMAT && d.type === 'batch' && d.refreshId === base.refreshId);
    check(Number.isSafeInteger(d.seq) && d.seq > 0, 'CHECKPOINT_SEQUENCE');
    check(d.orderStates && typeof d.orderStates === 'object' && !Array.isArray(d.orderStates));
    for (const [code, state] of Object.entries(d.orderStates)) check(known.has(code) && Object.hasOwn(COUNTER, state));
    check(Array.isArray(d.rows) && typeof d.updatedAt === 'string' && d.retryPending === 0);
    check(d.lastBatch === null || d.lastBatch && Array.isArray(d.lastBatch.orderCodes)
      && d.lastBatch.orderCodes.every(code => known.has(identity(code)))
      && (d.lastBatch.error === null || typeof d.lastBatch.error === 'string'));
  }
  function apply(d, digest) {
    for (const [code, state] of Object.entries(d.orderStates)) {
      if (Object.hasOwn(states, code)) counts[COUNTER[states[code]]] -= 1;
      else counts.processedOrders += 1;
      states[code] = state; counts[COUNTER[state]] += 1;
    }
    chunks.push(d.rows);
    base.lastBatch = d.lastBatch; base.updatedAt = d.updatedAt; base.retryPending = d.retryPending;
    seq = d.seq; receipts.set(seq, digest);
  }
  function snapshot() {
    const bytes = pack({ format: FORMAT, type: 'snapshot', seq, receipts: [...receipts], manifest: manifestView() });
    atomicReplace(snapshotFile, bytes, 'snapshot', onPhase);
    snapshotSeq = seq;
  }
  function compact() {
    assertOpen();
    try {
      snapshot();
      // Snapshot + parent dir kalıcı olmadan eski journal emekli edilmez.
      atomicReplace(journalFile, '', 'retirement', onPhase);
      return { seq, durable: true };
    } catch (error) { poisoned = true; throw error; }
  }

  if (fs.existsSync(snapshotFile)) {
    const saved = unpack(fs.readFileSync(snapshotFile)).value;
    check(saved.format === FORMAT && saved.type === 'snapshot'
      && Number.isSafeInteger(saved.seq) && saved.seq >= 0 && Array.isArray(saved.receipts));
    install(saved.manifest);
    check(saved.receipts.length === saved.seq);
    for (let i = 0; i < saved.receipts.length; i += 1) {
      const entry = saved.receipts[i];
      check(Array.isArray(entry) && entry[0] === i + 1 && /^[a-f0-9]{64}$/.test(entry[1]));
      receipts.set(entry[0], entry[1]);
    }
    seq = snapshotSeq = saved.seq;
  } else {
    check(!fs.existsSync(journalFile), 'CHECKPOINT_CORRUPT');
    check(initial || legacyFile, 'CHECKPOINT_INITIAL_REQUIRED');
    install(clone(legacyFile ? readLegacyCheckpoint(legacyFile) : initial));
    snapshot();
  }
  if (!fs.existsSync(journalFile)) atomicReplace(journalFile, '', 'retirement', onPhase);
  const bytes = fs.readFileSync(journalFile);
  let start = 0, end;
  while ((end = bytes.indexOf(10, start)) !== -1) {
    const { value: d, digest } = unpack(bytes.subarray(start, end));
    validateDelta(d);
    if (d.seq <= seq) check(receipts.get(d.seq) === digest, 'CHECKPOINT_REPLAY_CONFLICT');
    else { check(d.seq === seq + 1, 'CHECKPOINT_SEQUENCE'); apply(d, digest); }
    start = end + 1;
  }
  if (start !== bytes.length) {
    // Yalnız newline'sız son parça uncommitted sayılır; tam bozuk kayıt atlanmaz.
    fs.truncateSync(journalFile, start); syncFile(journalFile);
  }
  // Recovered/unacknowledged bytes are synced before a duplicate can receive ACK.
  syncFile(journalFile); syncDir(root);

  function commit(delta) {
    assertOpen();
    const d = clone({ format: FORMAT, type: 'batch', refreshId: base.refreshId,
      seq: delta.seq, orderStates: delta.orderStates, rows: delta.rows,
      lastBatch: delta.lastBatch, updatedAt: delta.updatedAt, retryPending: delta.retryPending });
    validateDelta(d);
    const encoded = pack(d), digest = hash(JSON.stringify(d));
    if (d.seq <= seq) {
      check(receipts.get(d.seq) === digest, 'CHECKPOINT_REPLAY_CONFLICT');
      return { seq: d.seq, durable: true, replayed: true };
    }
    check(d.seq === seq + 1, 'CHECKPOINT_SEQUENCE');
    try {
      fs.appendFileSync(journalFile, encoded, { encoding: 'utf8', mode: 0o600 });
      onPhase('journal:written');
      syncFile(journalFile);
      onPhase('journal:durable');
      apply(d, digest);
      onPhase('commit:applied');
      if (seq - snapshotSeq >= snapshotEvery) compact();
      return { seq, durable: true, replayed: false };
    } catch (error) { poisoned = true; throw error; }
  }
  function exportLegacy(file) {
    assertOpen();
    check(typeof file === 'string' && ![snapshotFile, journalFile].includes(path.resolve(file)), 'CHECKPOINT_OPTIONS');
    const value = materialize();
    try { atomicReplace(path.resolve(file), JSON.stringify(value), 'legacy-export', onPhase); }
    catch (error) { poisoned = true; throw error; }
    return { seq, durable: true, file: path.resolve(file) };
  }
  return { get sequence() { assertOpen(); return seq; }, progress, materialize, commit, compact, exportLegacy };
}

module.exports = { FORMAT, openCheckpointJournal, readLegacyCheckpoint };
