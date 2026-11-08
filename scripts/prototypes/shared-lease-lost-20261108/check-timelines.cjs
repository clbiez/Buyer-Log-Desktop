'use strict';
// Evidence oracle: checks observed ordering and ACK/reopen, not log wording alone.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const evidence = path.join(root, 'docs/performance-program/shared-lease-lost-20261108');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const jsonl = p => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const summaries = [];
const excerpts = [];
for (const label of fs.readdirSync(evidence).sort()) {
  const folder = path.join(evidence, label);
  if (!fs.existsSync(path.join(folder, 'manifest.json'))) continue;
  const manifest = read(path.join(folder, 'manifest.json'));
  const files = fs.readdirSync(folder);
  const timeline = files.filter(p => p.endsWith('.timeline.jsonl')).flatMap(p => jsonl(path.join(folder, p)).map(e => ({ ...e, log: p })))
    .sort((a, b) => BigInt(a.ns) < BigInt(b.ns) ? -1 : BigInt(a.ns) > BigInt(b.ns) ? 1 : 0);
  const stdout = files.filter(p => p.endsWith('.stdout.log')).map(p => fs.readFileSync(path.join(folder, p), 'utf8')).join('');
  const warnings = stdout.split('\n').filter(p => p.includes('[LEASE] renew:failed'));
  const renewalStarts = timeline.filter(e => e.event === 'lease:method:begin' && e.method === 'renew');
  const renewalFailures = timeline.filter(e => e.event === 'lease:method:error' && e.method === 'renew');
  const finish = timeline.filter(e => e.event === 'lease:method:begin' && e.method === 'finishOperation');
  const leases = timeline.filter(e => e.event === 'lease:acquired').map(e => {
    const complete = timeline.find(x => x.pid === e.pid && x.scope === e.scope && x.event === 'callback:ok');
    return { pid: e.pid, scope: e.scope, token: e.token, generation: e.generation,
      callbackMs: complete ? Number(BigInt(complete.ns) - BigInt(e.ns)) / 1e6 : null };
  });
  const summary = { label, status: manifest.status, node: manifest.versions.node, scenario: manifest.scenario || 'independent-200k',
    trace: manifest.trace || 'controlled', durationMs: Date.parse(manifest.ended) - Date.parse(manifest.started),
    warningLines: warnings.length, renewalCalls: renewalStarts.length, renewalRejectedCalls: renewalFailures.length,
    leaseCount: leases.length, longestCallbackMs: Math.max(0, ...leases.map(e => e.callbackMs || 0)),
    accepted: manifest.accepted, rejected: manifest.rejected, permittedUnacknowledged: manifest.permittedUnacknowledged };
  assert.equal(manifest.status, 'passed', label);
  if (!manifest.scenario) {
    const written = read(path.join(folder, 'write.result.json'));
    const reopened = read(path.join(folder, 'verify.result.json'));
    assert.deepEqual(written.after, reopened);
    assert.equal(reopened.acceptedEvents, manifest.size);
    summary.reopened = reopened;
    summary.maxRssBytes = written.maxRssBytes;
  } else if (manifest.scenario === 'completion-race') {
    assert.equal(renewalStarts.length, 1);
    assert.equal(renewalFailures.length, 1);
    assert.equal(renewalFailures[0].code, 'SHARED_LEASE_LOST');
    assert.ok(warnings.length >= 1 && warnings.length <= 2, 'timer logs; drain can also log the same failed renewal');
    const callback = timeline.find(e => e.event === 'callback:ok');
    const unlink = timeline.find(e => e.event === 'io:begin' && e.method === 'unlink' && e.file.endsWith('/owner.json'));
    const held = timeline.find(e => e.event === 'injection:renew-read-held');
    const ack = timeline.find(e => e.event === 'api:ack');
    const sync = timeline.find(e => e.event === 'handle:ok' && e.method === 'sync' && e.file.endsWith('.wal'));
    assert.ok(BigInt(held.ns) < BigInt(callback.ns));
    assert.ok(BigInt(callback.ns) < BigInt(finish[0].ns));
    assert.ok(BigInt(finish[0].ns) < BigInt(renewalFailures[0].ns));
    assert.ok(BigInt(renewalFailures[0].ns) < BigInt(unlink.ns));
    assert.ok(BigInt(sync.ns) < BigInt(ack.ns));
    assert.equal(held.owner.token, leases[0].token);
    assert.equal(held.owner.generation, leases[0].generation);
    const observedOwners = timeline.filter(e => e.metadata?.token).map(e => e.metadata);
    assert.ok(observedOwners.length > 0);
    assert.ok(observedOwners.every(o => o.token === leases[0].token && (!o.generation || o.generation === leases[0].generation)));
    assert.equal(manifest.accepted.length, 1); assert.equal(manifest.rejected.length, 0);
    summary.conclusion = 'Scope completion precedes rejected renewal; same token/generation until release; one accepted event reopens.';
  } else if (manifest.scenario === 'contention') {
    assert.equal(manifest.accepted.length, 2);
    assert.deepEqual(manifest.rejected.map(e => e.code), ['SHARED_WRITE_BUSY']);
    assert.ok(timeline.some(e => e.event === 'lease:method:ok' && e.method === 'renew'));
    assert.equal(warnings.length, 0);
    summary.conclusion = 'Live owner renews; contender rejects busy; retry after release ACKs; both accepted events reopen.';
  } else {
    assert.deepEqual(manifest.accepted.map(e => e.eventId), ['diag-b-0']);
    assert.deepEqual(manifest.rejected.map(e => e.code), ['SHARED_LEASE_LOST']);
    assert.ok(timeline.some(e => e.event === 'assertion:successor-preserved'));
    const displaced = timeline.find(e => e.event === 'injection:live-owner-directory-displaced');
    const successor = timeline.find(e => e.event === 'injection:successor-owner');
    assert.notEqual(displaced.previous.token, successor.current.token);
    assert.ok(displaced.previous.generation < successor.current.generation);
    const a = timeline.filter(e => e.pid === displaced.previous.pid);
    const aAck = a.filter(e => e.event === 'api:ack'); assert.equal(aAck.length, 0);
    const aWrites = a.filter(e => e.event === 'handle:ok' && e.method === 'writeFile' && e.file.endsWith('.wal'));
    assert.equal(aWrites.length, manifest.scenario === 'active-before-write' ? 0 : 1);
    assert.equal(renewalFailures.length, 0, 'active loss is raised by write fencing, not timer renewal');
    summary.conclusion = manifest.scenario === 'active-before-write'
      ? 'Injected ownership transfer before WAL: stale write rejects, only successor ACK/event reopens.'
      : 'Injected transfer after WAL fsync: stale call rejects, its unacknowledged durable event and successor ACK/event reopen.';
  }
  if (manifest.scenario) summary.reopened = read(path.join(folder, 'verify.result.json'));
  summaries.push(summary);
  const first = timeline[0]?.ns;
  const selected = timeline.filter(e => /^(lease:acquired|lease:released|callback:|api:|injection:|assertion:|reopen:)/.test(e.event)
    || e.event === 'lease:log' || e.event.startsWith('lease:method') && ['renew', 'finishOperation', 'drainRenewal'].includes(e.method)
    || e.event === 'handle:ok' && e.method === 'sync' && e.file.endsWith('.wal')
    || e.event === 'io:ok' && e.method === 'unlink' && e.file.endsWith('/owner.json'));
  excerpts.push({ label, events: selected.map(e => ({ elapsedMs: Number(BigInt(e.ns) - BigInt(first)) / 1e6, ...e })) });
}
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'timeline-excerpts.json'), JSON.stringify(excerpts, null, 2) + '\n');
console.log(JSON.stringify({ checkedRuns: summaries.length, assertions: 'passed', summaries }, null, 2));
