'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CLOCK, item, inspect } = require('./workload.cjs');
const config = JSON.parse(process.argv[2]);
const events = [];
const record = (event, detail = {}) => events.push({ ns: process.hrtime.bigint().toString(),
  wall: new Date().toISOString(), pid: process.pid, event, ...detail });
const send = (event, detail = {}) => { record('ipc:send', { name: event, ...detail }); process.send?.({ event, ...detail }); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const go = deferred();
process.on('message', message => { record('ipc:received', message); if (message.event === 'go') go.resolve(); });
function save() { fs.writeFileSync(config.timeline, events.map(e => JSON.stringify(e)).join('\n') + '\n'); }
async function main() {
  record('runtime', { versions: process.versions, config });
  require('./trace.cjs').install(record, config);
  const leases = require('../../../resources/app/server/lib/shared-file-transaction');
  const originalLease = leases.withFileLeaseAsync;
  const ownerFile = path.join(config.file + '.write-lock', 'owner.json');
  const heldRead = deferred();
  let renewing = false, intercepted = false;
  if (config.scenario === 'completion-race') {
    const read = fsp.readFile;
    fsp.readFile = function(file, ...args) {
      const result = read.call(this, file, ...args);
      if (config.role !== 'a' || file !== ownerFile || !renewing || intercepted) return result;
      intercepted = true;
      return result.then(async raw => {
        record('injection:renew-read-held', { owner: JSON.parse(raw) });
        send('renew-read-held'); go.resolve();
        await heldRead.promise;
        record('injection:renew-read-resumed'); return raw;
      });
    };
  }
  if (config.scenario === 'active-after-fsync' && config.role === 'a') {
    const open = fsp.open;
    fsp.open = async function(file, ...args) {
      const h = await open.call(this, file, ...args);
      if (file === config.file + '.wal' && args[0] === 'a') {
        const sync = h.sync.bind(h);
        h.sync = async () => { await sync(); record('injection:after-wal-fsync'); send('after-wal-fsync'); await go.promise; };
      }
      return h;
    };
  }
  leases.withFileLeaseAsync = (file, operation, ...settings) => originalLease(file, async lease => {
    if (config.role === 'a' && config.scenario === 'completion-race') {
      const renew = lease.renew.bind(lease);
      lease.renew = (...args) => { renewing = true; return renew(...args); };
      const finish = lease.finishOperation.bind(lease);
      lease.finishOperation = (...args) => {
        const p = finish(...args); // Calls the real guard; never bypass it.
        record('injection:finish-started-resume-renewal'); heldRead.resolve(); return p;
      };
    }
    if (config.role === 'a' && config.scenario === 'contention') {
      const renew = lease.renew.bind(lease);
      lease.renew = (...args) => {
        const p = renew(...args); p.then(() => send('renewed'), () => {}); return p;
      };
    }
    send('held', { token: lease.token, generation: lease.generation });
    if (config.role === 'a' && config.scenario !== 'active-after-fsync' || config.role === 'b' && config.hold) {
      record('injection:callback-gate'); await go.promise; record('injection:callback-resumed');
    }
    return operation(lease);
  }, ...settings);
  const { createLocalDb } = require('../../../resources/app/server/lib/local-db');
  const db = createLocalDb(config.file, { clock: () => CLOCK });
  if (config.role === 'init') { await db.ensure(); send('initialized'); return; }
  if (config.role === 'verify') {
    record('reopen:start'); const state = await db.read(); const result = inspect(state, config.ranges);
    record('reopen:verified', result); fs.writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
    send('verified', result); return;
  }
  const e = item(0, config.role);
  record('api:start', { method: 'queuePatch', eventId: e.eventId });
  try {
    const result = await db.queuePatch(e);
    assert.equal(result.eventId, e.eventId); assert.equal(result.duplicate, false);
    record('api:ack', { eventId: e.eventId, sequence: result.localSequence });
    send('ack', { eventId: e.eventId, sequence: result.localSequence });
    assert.equal(config.expectedError, undefined, 'expected rejection must not ACK');
  } catch (error) {
    record('api:rejected', { eventId: e.eventId, code: error.code }); send('rejected', { eventId: e.eventId, code: error.code });
    if (!config.expectedError) throw error;
    assert.equal(error.code, config.expectedError);
    // A failed native mutation must reload durable data rather than dirty cache.
    const state = await db.read();
    const present = Boolean(state.events[e.eventId] || state.syncLedger.eventIds[e.eventId]);
    const recordPresent = Boolean(state.records[e.id]);
    assert.equal(present, config.scenario === 'active-after-fsync');
    assert.equal(recordPresent, present);
    record('rejected:cache-reloaded', { eventId: e.eventId, present, recordPresent });
  }
}
main().then(() => { save(); process.disconnect?.(); }).catch(error => {
  record('run:failed', { code: error.code, message: error.message, stack: error.stack }); save();
  console.error(error.stack); process.exitCode = 1; process.disconnect?.();
});
