'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/email-groups.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const seed = () => ({
  countries: [{ id: 'tr', name: 'Turkey' }], types: [{ id: 'knit', name: 'Knit' }],
  records: [{ id: 'demo-a', manufacturer: 'Demo A', aliases: ['Demo Alias'], email: 'demo@example.test', lock: null }],
  revision: 4, lockTtlMs: 120000, currentUserId: 'demo-user',
});
function fixture() {
  let reply = seed(), requests = 0;
  const events = [];
  const window = { addEventListener() {}, dispatchEvent(event) { events.push(event); } };
  vm.runInNewContext(source, {
    window, document: { getElementById: () => null },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    // Background scheduling is outside this explicit public directory-read fixture.
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: async () => { requests++; return { ok: true, json: async () => copy(reply) }; },
  });
  return { state: window.BLEmailGroups.state, directory: window.BLEmailDirectory,
    events, setReply(value) { reply = value; }, get requests() { return requests; } };
}

test('an unchanged real directory read retains list inputs and resolved records', async () => {
  const f = fixture(); await f.directory.ensureDirectory(true);
  const data = f.state.data, records = data.records, countries = data.countries, types = data.types;
  const selected = records[0], alias = f.directory.recordFor('Demo Alias'), snapshot = JSON.stringify(data);
  const eventCount = f.events.length;
  await f.directory.ensureDirectory(true);
  assert.equal(f.requests, 2, 'the second transport read must actually run');
  assert.equal(JSON.stringify(f.state.data), snapshot);
  assert.equal(f.state.data, data);
  assert.equal(f.state.data.records, records, 'unchanged read must not make the next selection rebuild the list');
  assert.equal(f.state.data.countries, countries);
  assert.equal(f.state.data.types, types);
  assert.equal(f.state.data.records[0], selected);
  assert.equal(f.directory.recordFor('Demo Alias'), alias);
  assert.equal(f.events.length, eventCount, 'unchanged data does not publish a change');
});

test('changed lock, revision and recipients still replace the snapshot and publish it', async () => {
  const f = fixture(); await f.directory.ensureDirectory(true);
  const data = f.state.data, records = data.records, events = f.events.length;
  const changed = seed(); changed.revision++;
  changed.records[0].lock = { userId: 'other-user', clientId: 'other-client' };
  changed.records[0].email = 'new@example.test';
  f.setReply(changed); await f.directory.ensureDirectory(true);
  assert.equal(f.state.data, data, 'the public store container stays stable');
  assert.notEqual(f.state.data.records, records);
  assert.deepEqual(copy(f.state.data.records), changed.records);
  assert.equal(f.state.data.revision, changed.revision);
  assert.equal(f.directory.emailFor('Demo Alias'), 'new@example.test');
  assert.equal(f.directory.recordFor('Demo A').lock.userId, 'other-user');
  assert.equal(f.events.length, events + 1);
});

test('partial reads preserve omitted fields, and explicit empty records clear aliases', async () => {
  const f = fixture(); await f.directory.ensureDirectory(true);
  const records = f.state.data.records, snapshot = JSON.stringify(f.state.data);
  f.setReply({ revision: 4 }); await f.directory.ensureDirectory(true);
  assert.equal(JSON.stringify(f.state.data), snapshot);
  assert.equal(f.state.data.records, records);
  f.setReply({ records: [], revision: 5 }); await f.directory.ensureDirectory(true);
  assert.equal(f.state.data.records.length, 0);
  assert.equal(f.state.data.countries[0].id, 'tr');
  assert.equal(f.directory.recordFor('Demo Alias'), null);
  assert.equal(f.directory.size(), 0);
});

test('headings and current-user changes remain part of snapshot invalidation', async () => {
  const f = fixture(); await f.directory.ensureDirectory(true);
  const changed = seed(); changed.currentUserId = 'another-user';
  changed.countries[0].name = 'Updated Country'; changed.types.push({ id: 'woven', name: 'Woven' });
  const events = f.events.length;
  f.setReply(changed); await f.directory.ensureDirectory(true);
  assert.equal(f.state.currentUserId, 'another-user');
  assert.deepEqual(copy(f.state.data.countries), changed.countries);
  assert.deepEqual(copy(f.state.data.types), changed.types);
  assert.equal(f.events.length, events + 1);
});

test('concurrent forced reads still share one in-flight request', async () => {
  const f = fixture();
  await Promise.all([f.directory.ensureDirectory(true), f.directory.ensureDirectory(true)]);
  assert.equal(f.requests, 1);
  assert.equal(f.directory.emailFor('Demo A'), 'demo@example.test');
});
