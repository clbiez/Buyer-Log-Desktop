'use strict';
const assert = require('node:assert/strict');
const target = '../../public/projection-shadow-hydration.js';
const api = require(target);
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function token() { return { ownerId: 'source-owner', actorId: 'buyer', module: 'cp', sourceGeneration: 'g1', sourceRevision: 'r1',
  moduleInputKey: 'cp-input-1', sourceProjectionKey: 'cp-source-1', accessHash: 'access-1', contextHash: 'context-1', planRevision: 'plan-1', requestGeneration: 'request-1' }; }
function defaultRows(count) { return Array.from({ length: count }, (_, ordinal) => ({ Probe: ordinal, 'Order Code': '000123', custom: { ordinal }, tail: false })); }
function response(request, rows) { return { profile: api.DETAIL, complete: true, token: request.token,
  records: request.records.map(record => ({ ...record, row: rows[record.ordinal] })) }; }
function fixture({ count = 4, viewRows, fullRows, absentKeys, fetchDetails, prepareFull, ...options } = {}) {
  const state = { calls: [], prepareCalls: 0 }, full = fullRows || defaultRows(count);
  const envelope = { profile: api.VIEW, mode: 'shadow', token: token(), rows: viewRows || defaultRows(count).map(row => ({ Probe: row.Probe })),
    completeness: Array.from({ length: count }, (_, ordinal) => ({ ordinal, handle: 'source-row:' + ordinal, absentKeys: absentKeys?.[ordinal] || [] })) };
  const coordinator = api.createShadowCoordinator({ isCurrent: () => true, getDirty: () => ({ dirty: false, revision: 0 }),
    fetchDetails: request => { state.calls.push(request); return fetchDetails ? fetchDetails(request, full) : Promise.resolve(response(request, full)); },
    prepareFull: (rows, context) => { state.prepareCalls++; return prepareFull?.(rows, context, state.prepareCalls); }, ...options });
  return { coordinator, envelope, state, full, session: coordinator.accept(envelope), open: () => coordinator.accept(envelope) };
}
function controlledFetch() {
  const calls = []; let active = 0, peak = 0;
  return { calls, get active() { return active; }, get peak() { return peak; },
    fetch(request, rows) {
      const gate = deferred(); calls.push({ request, gate }); active++; peak = Math.max(peak, active);
      return gate.promise.then(() => response(request, rows)).finally(() => { active--; });
    },
    async drain(observedPromises) {
      let done = false; const completion = Promise.all(observedPromises).then(result => { done = true; return result; });
      for (let turn = 0; turn < 30 && !done; turn++) {
        for (const call of calls) call.gate.resolve();
        await nextTurn();
      }
      assert.equal(done, true, 'controlled backend releases must settle all subscribers'); return completion;
    },
  };
}
const observe = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
module.exports = { fixture, response, deferred, nextTurn, controlledFetch, observe, target };
