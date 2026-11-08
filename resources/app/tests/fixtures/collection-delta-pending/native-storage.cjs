'use strict';
const assert = require('node:assert/strict');
const { fixture, edit, receipt, journal } = require('./harness.cjs');
const stage = process.argv[2];
const storage = journal().createWebStorage(localStorage);
const f = fixture({ storage, bind: false });
if (stage === 'seed') {
  f.adapter.bindAccepted(f.spec); f.adapter.record(edit(f));
  f.adapter.prepareRequest(['edit'], { requestId: 'real-request' });
  console.log(JSON.stringify({ stage, value: f.adapter.getState().rows[0].quantity, sequence: f.adapter.status().sequence }));
} else if (stage === 'ack') {
  f.adapter.open(); const retry = f.adapter.retry('real-request');
  assert.equal(retry.request.commands[0].operationId, 'edit');
  f.adapter.acknowledgePrimary(retry, receipt(retry)); f.adapter.compact();
  console.log(JSON.stringify({ stage, history: f.adapter.getState().history.undo }));
} else if (stage === 'quota') {
  f.adapter.open();
  for (const size of [65536, 1024, 64]) {
    for (let i = 0; i < 20000; i++) {
      try { localStorage.setItem('synthetic-filler-' + size + '-' + i, 'x'.repeat(size)); }
      catch (error) { assert.equal(error.name, 'QuotaExceededError'); break; }
    }
  }
  const command = edit(f, 'quota-edit', 2);
  assert.throws(() => f.adapter.record(command), error => error.name === 'QuotaExceededError');
  assert.equal(f.reopen().getState().rows[0].quantity, '20');
  assert.equal(f.reopen().getState().operations.has('quota-edit'), false);
  console.log(JSON.stringify({ stage, keys: localStorage.length, oldEditPreserved: true }));
} else if (stage === 'half-compaction') {
  f.adapter.open();
  const wrapped = { getItem: key => localStorage.getItem(key), setItem(key, value) {
    if (key.endsWith('/head')) throw new Error('simulated interrupted head write');
    localStorage.setItem(key, value);
  } };
  const failing = journal().createPendingJournal({ storage: wrapped, api: f.api, getCurrent: () => ({ ...f.live }), legacyKey: 'legacy.pending.owner', keyPrefix: 'bl.collection.pending-journal.candidate.test.' });
  failing.open(); assert.throws(() => failing.compact(), /interrupted/);
  assert.equal(f.reopen().getState().rows[0].quantity, '20');
  console.log(JSON.stringify({ stage, oldEditPreserved: true }));
} else if (stage === 'corrupt' || stage === 'missing') {
  f.adapter.open();
  const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).find(key => key.includes('/event/'));
  if (stage === 'missing') localStorage.removeItem(key); else localStorage.setItem(key, '{');
  const keys = localStorage.length;
  assert.throws(() => f.reopen()); assert.equal(localStorage.length, keys);
  console.log(JSON.stringify({ stage, rejected: true, basePreserved: Array.from({ length: keys }, (_, i) => localStorage.key(i)).some(key => key.includes('/base/')) }));
} else throw new Error('unknown stage');
