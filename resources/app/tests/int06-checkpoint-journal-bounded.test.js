'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createDashboardRefreshManifest } = require('../server/lib/power-bi-import-dashboard');
const { openCheckpointJournal } = require('../server/lib/power-bi-checkpoint-journal');
const LIMIT = 64 * 1024;
const sha = text => createHash('sha256').update(text).digest('hex');
const pack = value => {
  const payload = JSON.stringify(value);
  return JSON.stringify({ payload, sha256: sha(payload) }) + '\n';
};
function setup(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-bounded-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = createDashboardRefreshManifest(['A', 'B', 'C'], { refreshId: 'bounded',
    startedAt: '2026-11-08T00:00:00.000Z' });
  const open = options => openCheckpointJournal({ root, initial, snapshotEvery: 2, ...extra, ...options });
  return { root, open, journal: open() };
}
const delta = (seq, orderStates, rows = []) => ({ seq, orderStates, rows,
  lastBatch: { orderCodes: Object.keys(orderStates), error: null },
  updatedAt: '2026-11-08T00:00:00.000Z', retryPending: 0 });
function snapshotValue(journal, receipts) {
  return { format: 2, type: 'snapshot', seq: journal.sequence, receipts, manifest: journal.materialize() };
}

test('INT-06 bounded snapshot is byte-identical to v2 pack, including Unicode, escapes and every terminal state', t => {
  const { root, journal, open } = setup(t);
  const file = path.join(root, 'snapshot.json'), log = path.join(root, 'batches.jsonl');
  assert.equal(fs.readFileSync(file, 'utf8'), pack(snapshotValue(journal, [])));
  const text = ('İı中文😀"\\\b\f\n\r\t\u0000\u001f\ud800\udfff/\u2028\u2029').repeat(5000);
  const first = delta(1, { A: 'SUCCESS' }, [{ code: 'A', text, nested: [null, true, -0] }, { code: 'A', text: 'second row' }]);
  journal.commit(first);
  const receipts = [[1, JSON.parse(fs.readFileSync(log, 'utf8')).sha256]];
  const second = delta(2, { B: 'NOT_FOUND', C: 'FAILED' });
  // Capture the second receipt before the periodic snapshot retires the log.
  const original = fs.appendFileSync;
  fs.appendFileSync = function(target, data, ...args) {
    if (target === log) receipts.push([2, JSON.parse(data).sha256]);
    return original.call(this, target, data, ...args);
  };
  try { journal.commit(second); } finally { fs.appendFileSync = original; }
  const expected = pack(snapshotValue(journal, receipts));
  assert.equal(fs.readFileSync(file, 'utf8'), expected, 'periodic snapshot bytes and checksum');
  journal.compact();
  assert.equal(fs.readFileSync(file, 'utf8'), expected, 'explicit snapshot bytes and checksum');
  const recovered = open();
  assert.deepEqual(recovered.materialize(), journal.materialize());
  assert.equal(recovered.commit(first).replayed, true);
  assert.equal(recovered.commit(second).replayed, true);
  const legacy = path.join(root, 'legacy.json');
  recovered.exportLegacy(legacy);
  assert.equal(fs.readFileSync(legacy, 'utf8'), JSON.stringify(journal.materialize()));
});

test('INT-06 snapshot never serializes a full envelope or writes a full UTF-8 envelope buffer', t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ blob: 'İ😀"\\'.repeat(200000) }]));
  const stringify = JSON.stringify, writeFile = fs.writeFileSync, write = fs.writeSync;
  let fullEnvelopes = 0, maxWrite = 0, writes = 0;
  JSON.stringify = function(value, ...args) {
    if (value && typeof value.payload === 'string' && value.payload.length > LIMIT) fullEnvelopes += 1;
    return stringify(value, ...args);
  };
  fs.writeFileSync = function(file, data, ...args) {
    if (typeof file === 'string' && /snapshot\.json\..*\.tmp$/.test(file)) {
      maxWrite = Math.max(maxWrite, Buffer.byteLength(data)); writes += 1;
    }
    return writeFile.call(this, file, data, ...args);
  };
  fs.writeSync = function(fd, data, ...args) {
    maxWrite = Math.max(maxWrite, Buffer.byteLength(data)); writes += 1;
    return write.call(this, fd, data, ...args);
  };
  try { journal.commit(delta(2, { B: 'NOT_FOUND' })); journal.compact(); }
  finally { JSON.stringify = stringify; fs.writeFileSync = writeFile; fs.writeSync = write; }
  assert.equal(fullEnvelopes, 0, 'must not allocate an escaped O(n) envelope');
  assert.ok(writes > 2, 'snapshot uses bounded writes');
  assert.ok(maxWrite <= 6 * LIMIT, `bounded encoding scratch: ${maxWrite}`);
  assert.deepEqual(open().materialize(), journal.materialize());
});

test('INT-06 payload surrogate pair across chunk boundary preserves exact v2 UTF-8 bytes', t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ text: 'MARKER' }]));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'batches.jsonl'), 'utf8')).sha256;
  const value = snapshotValue(journal, [[1, receipt]]);
  const prefix = JSON.stringify(value).indexOf('MARKER');
  value.manifest.rows[0].text = 'x'.repeat(LIMIT - 1 - prefix % LIMIT) + '😀' + 'y'.repeat(LIMIT);
  const payload = JSON.stringify(value);
  assert.equal(payload.indexOf('😀') % LIMIT, LIMIT - 1);
  // Supply this exact valid snapshot through the unchanged reader, then rewrite.
  fs.writeFileSync(path.join(root, 'snapshot.json'), pack(value));
  fs.writeFileSync(path.join(root, 'batches.jsonl'), '');
  const recovered = open(); recovered.compact();
  assert.equal(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'), pack(value));
  assert.deepEqual(open().materialize(), recovered.materialize());
});

test('INT-06 bounded snapshot retries short writes before fsync and ACK', t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ text: 'x'.repeat(2 * LIMIT) }]));
  const original = fs.writeSync;
  let shortWrites = 0;
  fs.writeSync = function(fd, data, offset, length, position) {
    assert.ok(Buffer.isBuffer(data));
    shortWrites += 1;
    return original.call(this, fd, data, offset, Math.min(length, 101), position);
  };
  try { assert.equal(journal.compact().durable, true); } finally { fs.writeSync = original; }
  assert.ok(shortWrites > 100, 'exercise the short-write loop');
  assert.deepEqual(open().materialize(), journal.materialize());
  assert.equal(fs.readdirSync(root).filter(name => name.endsWith('.tmp')).length, 0);
});

for (const failure of ['EIO', 'zero']) test(`INT-06 mid-snapshot ${failure}: no ACK, no replacement, poison then disk-only replay`, t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ text: 'x'.repeat(2 * LIMIT) }]));
  const file = path.join(root, 'snapshot.json'), previous = fs.readFileSync(file);
  const second = delta(2, { B: 'NOT_FOUND', C: 'FAILED' });
  const original = fs.writeSync;
  let attempted = 0;
  fs.writeSync = function(fd, data, ...args) {
    if (++attempted === 3) {
      if (failure === 'zero') return 0;
      throw Object.assign(Error('synthetic snapshot EIO'), { code: 'EIO' });
    }
    return original.call(this, fd, data, ...args);
  };
  try { assert.throws(() => journal.commit(second), { code: 'EIO' }); }
  finally { fs.writeSync = original; }
  assert.deepEqual(fs.readFileSync(file), previous);
  assert.throws(() => journal.progress(), { code: 'CHECKPOINT_REOPEN_REQUIRED' });
  const recovered = open();
  assert.equal(recovered.sequence, 2);
  assert.equal(recovered.commit(second).replayed, true);
  assert.equal(recovered.materialize().rows.length, 1);
  assert.equal(recovered.materialize().failedOrders, 1);
  recovered.compact();
  assert.deepEqual(open().materialize(), recovered.materialize());
  assert.equal(fs.readdirSync(root).filter(name => name.endsWith('.tmp')).length, 0);
});

test('INT-06 real SIGKILL in a partially written snapshot body preserves manifest, receipts and journal', async t => {
  const { fork } = require('node:child_process');
  const { root, journal, open } = setup(t, { snapshotEvery: 64 });
  const d = delta(1, { A: 'SUCCESS', B: 'NOT_FOUND', C: 'FAILED' }, [{ text: 'İ😀'.repeat(LIMIT) }]);
  journal.commit(d);
  const expected = journal.materialize(), snapshot = fs.readFileSync(path.join(root, 'snapshot.json'));
  const log = fs.readFileSync(path.join(root, 'batches.jsonl'));
  await new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(__dirname, 'fixtures/int06-checkpoint-journal/bounded-crash.cjs'), [root],
      { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let boundary, stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('partial snapshot timeout')); }, 15000);
    child.on('message', message => { boundary = message; child.kill('SIGKILL'); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try {
        assert.equal(signal, 'SIGKILL', stderr);
        assert.deepEqual(boundary, { phase: 'snapshot:partial-body' });
        resolve();
      } catch (error) { reject(error); }
    });
  });
  assert.deepEqual(fs.readFileSync(path.join(root, 'snapshot.json')), snapshot);
  assert.deepEqual(fs.readFileSync(path.join(root, 'batches.jsonl')), log);
  assert.ok(fs.readdirSync(root).some(name => name.endsWith('.tmp')), 'retain abandoned partial snapshot');
  const recovered = open();
  assert.deepEqual(recovered.materialize(), expected);
  assert.equal(recovered.commit(d).replayed, true);
  recovered.compact();
  assert.deepEqual(open().materialize(), expected);
});
