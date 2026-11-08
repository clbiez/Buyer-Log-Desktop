/* Revision-only polling. The caller owns leadership, transport and authority.
 * No election, channel, SSE connection, permission cache or persistent state. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLSharedRevisionPoller = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const reserved = new Set(['__proto__', 'prototype', 'constructor']);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function revisionsOnly(value) {
    if (!value || value.schemaVersion !== 1 || !integer(value.revision) ||
        !value.entities || typeof value.entities !== 'object' || Array.isArray(value.entities)) return null;
    const entries = Object.entries(value.entities);
    if (entries.length > 512) return null;
    const entities = {};
    for (const [key, item] of entries) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || reserved.has(key) || !item || !integer(item.revision)) return null;
      entities[key] = { revision: item.revision };
    }
    return { schemaVersion: 1, revision: value.revision, entities };
  }
  const same = (a, b) => Boolean(a && b && a.actor === b.actor && a.source === b.source && a.authority === b.authority && a.valid === b.valid);
  function create(options) {
    const get = options.fetch || globalThis.fetch.bind(globalThis);
    const now = options.now || Date.now;
    const later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
    const newGeneration = options.newGeneration || (() => globalThis.crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}`);
    let disposed = false, running = false, online = true, active = true;
    let context = null, epoch = 0, generation = '', sequence = 0;
    let timer = 0, nextAt = null, busy = null, snapshot = null, failures = 0, idleMs = 7000;
    // Bounded replay filtering is operational metadata, never permission evidence.
    const sequences = new Map();
    function read() {
      try {
        const value = options.readContext();
        if (!value || value.valid !== true || !['actor', 'source', 'authority'].every(k => typeof value[k] === 'string' && value[k].length > 0)) return null;
        return { actor: value.actor, source: value.source, authority: value.authority, valid: true };
      } catch (_) { return null; }
    }
    function eligible() { return !disposed && running && online && context; }
    function clearTimer() { if (timer) cancel(timer); timer = 0; }
    function invalidate() {
      epoch++;
      clearTimer();
      if (busy) busy.controller.abort();
    }
    function syncContext() {
      const current = read();
      if (same(context, current) || (!context && !current)) return false;
      invalidate(); context = current; snapshot = null; sequences.clear(); failures = 0; idleMs = 7000;
      generation = running ? newGeneration() : ''; sequence = 0;
      nextAt = now();
      return true;
    }
    function current(ticket) {
      return eligible() && !ticket.controller.signal.aborted && ticket.epoch === epoch && same(ticket.context, read());
    }
    function arm() {
      clearTimer();
      if (!eligible() || busy || nextAt === null) return;
      timer = later(() => { timer = 0; nextAt = null; void poll(); }, Math.max(0, nextAt - now()));
    }
    function schedule(ms) { nextAt = now() + ms; arm(); }
    function apply(next) {
      if (snapshot && (next.revision < snapshot.revision || Object.entries(snapshot.entities).some(([key, item]) => (next.entities[key]?.revision ?? -1) < item.revision))) return null;
      const previous = snapshot;
      snapshot = next;
      const changed = previous ? Object.keys(next.entities).filter(key => next.entities[key].revision > (previous.entities[key]?.revision || 0)) : [];
      if (changed.length) options.onRevisions({ changed, revisions: revisionsOnly(next) });
      return changed;
    }
    function publish(ticket) {
      if (!snapshot || !current(ticket)) return;
      options.publish?.({ type: 'shared-revisions', generation, sequence: ++sequence, revisions: revisionsOnly(snapshot) });
    }
    async function poll() {
      syncContext();
      if (!eligible() || busy) { arm(); return; }
      const ticket = { controller: new AbortController(), epoch, context, at: now(), timedOut: false };
      busy = ticket;
      let success = false, changed = null;
      const timeout = later(() => { ticket.timedOut = true; ticket.controller.abort(); }, 10000);
      try {
        const response = await get(`/api/shared-revisions?_=${now()}`, { cache: 'no-store', credentials: 'same-origin', signal: ticket.controller.signal });
        if (!current(ticket)) return;
        if (!response.ok) throw new Error('REVISION_HTTP');
        const next = revisionsOnly(await response.json());
        if (!current(ticket)) return;
        if (!next) throw new Error('REVISION_SCHEMA');
        changed = apply(next);
        if (changed === null) throw new Error('REVISION_REGRESSION');
        publish(ticket);
        success = true;
      } catch (_) { /* Operational failure: no UI, payload logging or POST retry. */ }
      finally {
        cancel(timeout);
        busy = null;
        const contextChanged = syncContext();
        if (!eligible()) { clearTimer(); return; }
        if (ticket.epoch !== epoch || contextChanged) { if (nextAt === null) nextAt = now(); arm(); return; }
        if (nextAt === null) {
          if (success) {
            failures = 0;
            idleMs = changed.length ? 3500 : Math.min(7000, idleMs * 2);
            // Schedule from request START, preserving the old 7s freshness bound.
            nextAt = ticket.at + idleMs;
          } else {
            failures = Math.min(failures + 1, 6);
            nextAt = now() + Math.min(30000, 1000 * (2 ** (failures - 1)));
          }
        }
        arm();
      }
    }
    function catchUp() {
      if (disposed || !running) return;
      syncContext(); failures = 0; schedule(0);
    }
    function start({ catchUp: immediate = false } = {}) {
      if (disposed) return;
      if (running) { if (immediate) catchUp(); return; }
      running = true; invalidate(); syncContext();
      generation = newGeneration(); sequence = 0; failures = 0; idleMs = 7000;
      schedule(immediate ? 0 : 2500);
    }
    function stop() { running = false; invalidate(); nextAt = null; }
    function dispose() { stop(); disposed = true; snapshot = context = null; sequences.clear(); }
    function contextChanged() { if (disposed) return; syncContext(); if (running) schedule(0); }
    function setOnline(value) {
      value = Boolean(value);
      if (online === value || disposed) return;
      online = value; invalidate();
      if (online && running) catchUp();
    }
    function setActive(value) {
      value = Boolean(value);
      if (disposed || active === value) return;
      active = value;
      if (active) catchUp();
      // Hidden/native-inactive pages retain the same <=7s healthy ceiling.
    }
    function receive(message) {
      if (disposed) return false;
      if (syncContext()) arm();
      if (!context || !same(context, read()) || !message || message.type !== 'shared-revisions' ||
          typeof message.generation !== 'string' || message.generation.length < 1 || message.generation.length > 128 ||
          !integer(message.sequence) || message.sequence < 1) return false;
      const next = revisionsOnly(message.revisions);
      if (!next || message.sequence <= (sequences.get(message.generation) || 0)) return false;
      const captured = context;
      if (!same(captured, read())) return false;
      if (apply(next) === null) return false;
      sequences.set(message.generation, message.sequence);
      if (sequences.size > 16) sequences.delete(sequences.keys().next().value);
      return true;
    }
    function share() {
      if (disposed) return;
      if (syncContext()) arm();
      if (eligible()) publish({ epoch, context, controller: new AbortController() });
    }
    return Object.freeze({ start, stop, dispose, catchUp, contextChanged, setOnline, setActive, receive, share });
  }
  return Object.freeze({ create });
});
