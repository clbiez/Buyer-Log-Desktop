'use strict';
const crypto = require('node:crypto');

// The account bucket survives peer rotation and aliases; the peer bucket uses
// only the transport address. Unknown-name floods have their own bounded pool
// so they cannot evict a known user's lock or block other known team accounts.
function createLoginThrottle({ limit = 5, lockMs = 60000, windowMs = 300000, maxBuckets = 4096, now = () => Date.now() } = {}) {
  const known = new Map(), unknown = new Map();
  const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
  function keys(identity) {
    const account = digest(identity.account);
    return ['account:' + account, 'peer:' + digest(String(identity.peer || 'local') + '|' + account)];
  }
  function expired(state, time) {
    return state.lockedUntil ? state.lockedUntil <= time : time - state.lastAt >= windowMs;
  }
  function pool(identity) { return identity.known ? known : unknown; }
  function sweep(table, time) {
    for (const [key, state] of table) if (expired(state, time)) table.delete(key);
  }
  function stateFor(table, key, time) {
    const state = table.get(key);
    if (state && expired(state, time)) { table.delete(key); return null; }
    return state;
  }
  function check(identity) {
    const table = pool(identity), time = now(), pair = keys(identity);
    let retryAfter = 0;
    for (const key of pair) {
      const state = stateFor(table, key, time);
      if (state && state.lockedUntil > time) retryAfter = Math.max(retryAfter, Math.ceil((state.lockedUntil - time) / 1000));
    }
    if (retryAfter) return { retryAfter };
    if (table.size + pair.filter(key => !table.has(key)).length > maxBuckets) {
      sweep(table, time);
      // Existing account protection still applies when a new peer cannot get
      // its own bucket. Never evict live history to admit attacker-chosen keys.
      if (!table.has(pair[0]) && table.size + 2 > maxBuckets) {
        const nextExpiry = Math.min(...[...table.values()].map(state => state.lockedUntil || state.lastAt + windowMs));
        return { retryAfter: Math.max(1, Math.ceil((nextExpiry - time) / 1000)) };
      }
    }
    return { retryAfter: 0 };
  }
  function failure(identity) {
    const table = pool(identity), time = now(), pair = keys(identity);
    if (table.size + 2 > maxBuckets) sweep(table, time);
    let failures = 0;
    for (const key of pair) {
      const previous = stateFor(table, key, time);
      if (!previous && table.size >= maxBuckets) continue;
      const count = (previous ? previous.failures : 0) + 1;
      table.set(key, { account: pair[0], failures: count, lastAt: time, lockedUntil: count >= limit ? time + lockMs : 0 });
      failures = Math.max(failures, count);
    }
    return failures;
  }
  function clear(identity) {
    const table = pool(identity), accountKey = keys(identity)[0];
    for (const [key, state] of table) if (state.account === accountKey) table.delete(key);
  }
  return { check, failure, clear, size: () => ({ known: known.size, unknown: unknown.size }) };
}
module.exports = { createLoginThrottle };
