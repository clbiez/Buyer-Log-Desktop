'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { item } = require('./workload.cjs');
const root = path.resolve(__dirname, '../../..');
const evidence = path.join(root, 'docs/performance-program/shared-lease-lost-20261108');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const baseline = '1796193f0a57c7785e7bf9fdb3557e33c550b25e';
const tracked = execFileSync('git', ['diff', baseline, '--name-status'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const entry of tracked) {
  const [status, p] = entry.split('\t');
  assert.equal(status, 'A', 'only added files are authorized');
  assert.ok(p.startsWith('scripts/prototypes/shared-lease-lost-20261108/') || p.startsWith('docs/performance-program/shared-lease-lost-20261108/'), p);
}
assert.deepEqual(json(path.join(root, 'resources/app/tests/fixtures/i18n-coverage-baseline.json')).files, {});
const ackReopen = [];
const diskEvidence = [];
let streamsChecked = 0;
for (const label of fs.readdirSync(evidence).sort()) {
  const folder = path.join(evidence, label);
  if (!fs.existsSync(path.join(folder, 'manifest.json'))) continue;
  const m = json(path.join(folder, 'manifest.json'));
  const dataRoot = m.dataRoot || m.preflight?.dataRoot;
  assert.equal(typeof dataRoot, 'string', label + ': synthetic data root must be recorded');
  assert.equal(m.status, 'passed', label);
  for (const [p, pin] of Object.entries(m.sourcePins)) assert.equal(hash(fs.readFileSync(path.join(root, p))), typeof pin === 'string' ? pin : pin.sha256);
  for (const [p, pin] of Object.entries(m.harnessPins)) assert.equal(hash(fs.readFileSync(path.join(__dirname, p))), pin, `recorded harness ${label}/${p}`);
  for (const p of fs.readdirSync(folder).filter(p => p.endsWith('.streams.jsonl'))) {
    const prefix = p.slice(0, -'.streams.jsonl'.length);
    const chunks = fs.readFileSync(path.join(folder, p), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    for (const stream of ['stdout', 'stderr']) {
      assert.deepEqual(Buffer.concat(chunks.filter(c => c.stream === stream).map(c => Buffer.from(c.base64, 'base64'))),
        fs.readFileSync(path.join(folder, `${prefix}.${stream}.log`)), `${label}/${prefix}/${stream}`);
      streamsChecked++;
    }
  }
  const config = json(path.join(folder, 'verify.config.json'));
  const reopened = json(path.join(folder, 'verify.result.json'));
  const durableIds = config.ranges.flatMap(r => Array.from({ length: r.count }, (_, i) => item(i, r.writer).eventId)).sort();
  const acknowledgedIds = m.scenario ? m.accepted.map(e => e.eventId).sort() : durableIds;
  const permittedUnacknowledgedIds = (m.permittedUnacknowledged || []).slice().sort();
  assert.deepEqual([...acknowledgedIds, ...permittedUnacknowledgedIds].sort(), durableIds,
    `${label}: reopened IDs must exactly equal ACKed IDs plus explicitly allowed unacknowledged IDs`);
  assert.equal(reopened.eventIdsHash, hash(Buffer.from(JSON.stringify(durableIds))));
  assert.equal(reopened.sequence, durableIds.length);
  assert.equal(reopened.allExpectedValuesChecked, true);
  ackReopen.push({ label, acknowledgedCount: acknowledgedIds.length,
    acknowledged: m.scenario ? acknowledgedIds : [{ writer: 'single', first: 0, count: m.size, format: 'diag-single-{index}' }],
    permittedUnacknowledgedIds, checkedDurableCount: durableIds.length, actualReopenedEventIdsHash: reopened.eventIdsHash,
    businessValuesChecked: true, equality: 'ACK union explicitly permitted unacknowledged IDs equals actual disk-reopened IDs',
    rawFieldNote: 'verify.result.json acceptedEvents counts the expected durable set supplied to the oracle. It includes permitted unacknowledged writes in active-after-fsync; use acknowledgedCount here or manifest.accepted for ACK count.' });
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = fs.statSync(p); files.push({ path: path.relative(dataRoot, p), bytes: s.size, inode: s.ino, sha256: hash(fs.readFileSync(p)) }); }
    }
  }
  walk(dataRoot); diskEvidence.push({ label, dataRoot, files });
}
fs.writeFileSync(path.join(evidence, 'ack-reopen.json'), JSON.stringify(ackReopen, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'disk-evidence.json'), JSON.stringify(diskEvidence, null, 2) + '\n');
const lock = fs.statSync('/tmp/buyerlog-performance-measurement.lock');
fs.writeFileSync(path.join(evidence, 'integrity.json'), JSON.stringify({ checkedRuns: ackReopen.length, streamsChecked,
  productionTrackedDiff: 'empty', i18nBaselineFiles: {}, sourceAndRecordedHarnessHashes: 'match',
  ackReopenEquality: 'passed', streamBytesReconstructed: 'identical',
  lock: { path: '/tmp/buyerlog-performance-measurement.lock', inode: lock.ino, unlinked: false },
  platform: process.platform, arch: process.arch, checkedAt: new Date().toISOString() }, null, 2) + '\n');
const entries = [];
function index(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) index(p);
    else if (e.name !== 'SHA256SUMS') entries.push(`${hash(fs.readFileSync(p))}  ${path.relative(root, p)}`);
  }
}
index(evidence);
fs.writeFileSync(path.join(evidence, 'SHA256SUMS'), entries.sort().join('\n') + '\n');
console.log(JSON.stringify({ checkedRuns: ackReopen.length, streamsChecked, indexedArtifacts: entries.length, assertions: 'passed' }));
