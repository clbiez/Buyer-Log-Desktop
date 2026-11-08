(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLBacklogRequestLifecycle = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const identityFields = ['scope', 'user', 'session', 'generation', 'revision'];
  function abortError() {
    const error = new Error('Request subscription ended');
    error.name = 'AbortError';
    return error;
  }

  // Local identity partitions work; it is never evidence of server authority.
  // prepare/request/beforePublish may await. isCurrent/publish are synchronous;
  // only publish may commit to the existing owner's cache. No completed rows live here.
  function createRequestLifecycle({ keyForQuery, request, isCurrent, prepare, beforePublish, publish } = {}) {
    for (const callback of [keyForQuery, request, isCurrent]) {
      if (typeof callback !== 'function') throw new TypeError('Missing lifecycle adapter');
    }
    if (prepare !== undefined && typeof prepare !== 'function') throw new TypeError('Invalid prepare adapter');
    if (beforePublish !== undefined && typeof beforePublish !== 'function') throw new TypeError('Invalid beforePublish adapter');
    if (publish !== undefined && typeof publish !== 'function') throw new TypeError('Invalid publish adapter');
    const flights = new Map();
    let disposed = false;

    function remove(flight) {
      if (flights.get(flight.key) === flight) flights.delete(flight.key);
    }
    function cancel(flight) {
      if (flight.state !== 'pending') return;
      flight.state = 'cancelled';
      // Remove before abort listeners run: reentrant subscriptions need a new flight.
      remove(flight);
      flight.controller.abort();
    }
    function assertActive(flight) {
      if (flight.state !== 'pending' || flight.controller.signal.aborted ||
          !flight.subscribers.size || flights.get(flight.key) !== flight ||
          isCurrent(flight.context.identity) !== true) throw abortError();
    }
    function settle(flight, succeeded, value) {
      if (flight.state !== 'pending') return;
      flight.state = succeeded ? 'completed' : 'failed';
      remove(flight);
      for (const subscriber of flight.subscribers) {
        subscriber.active = false;
        if (succeeded) subscriber.resolve(value);
        else subscriber.reject(value);
      }
      flight.subscribers.clear();
      // Failure/staleness may leave an unread body. Normal completion never aborts.
      if (!succeeded) flight.controller.abort();
    }
    async function run(flight) {
      try {
        assertActive(flight);
        if (prepare) await prepare(flight.params, flight.context);
        assertActive(flight);
        const response = await request(flight.params, flight.context);
        assertActive(flight);
        const text = await response.text();
        // Abort can happen during body read, even with an adapter ignoring its signal.
        assertActive(flight);
        const body = JSON.parse(text);
        if (!response.ok) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`);
        assertActive(flight);
        if (beforePublish) await beforePublish(body, flight.context);
        assertActive(flight);
        if (publish) publish(body, flight.context);
        assertActive(flight);
        settle(flight, true, body);
      } catch (error) {
        settle(flight, false, error);
      }
    }
    function subscribe(params, identity) {
      if (disposed) throw new Error('Request lifecycle disposed');
      const captured = {};
      for (const field of identityFields) {
        const value = identity && identity[field];
        if (!((typeof value === 'string' && value.length > 0) ||
              (typeof value === 'number' && Number.isFinite(value)))) {
          throw new TypeError(`Invalid request identity: ${field}`);
        }
        captured[field] = value;
      }
      Object.freeze(captured);
      const query = Object.freeze({ ...params });
      const queryKey = keyForQuery(query);
      if (typeof queryKey !== 'string') throw new TypeError('Query key must be a string');
      const details = query.includeSourceDetails;
      if (details !== undefined && details !== null &&
          !['string', 'number', 'boolean'].includes(typeof details)) throw new TypeError('Invalid source details variant');
      const key = JSON.stringify([identityFields.map(field => captured[field]), queryKey, [typeof details, details]]);
      const subscriber = { active: true };
      const promise = new Promise((resolve, reject) => {
        subscriber.resolve = resolve;
        subscriber.reject = reject;
      });
      // Panels may release before attaching their await/catch; keep rejection observed.
      promise.catch(() => {});
      try {
        if (isCurrent(captured) !== true) throw abortError();
      } catch (error) {
        subscriber.active = false;
        subscriber.reject(error);
        return { promise, release() {} };
      }
      let flight = flights.get(key);
      if (!flight || flight.state !== 'pending' || flight.controller.signal.aborted) {
        const controller = new AbortController();
        flight = { key, params: query, controller, state: 'pending', subscribers: new Set() };
        flight.context = Object.freeze({ identity: captured, signal: controller.signal });
        flights.set(key, flight);
        // Register all synchronous subscribers before starting preparation/transport.
        Promise.resolve().then(() => run(flight));
      }
      flight.subscribers.add(subscriber);
      return {
        promise,
        release() {
          if (!subscriber.active) return;
          subscriber.active = false;
          flight.subscribers.delete(subscriber);
          subscriber.reject(abortError());
          if (!flight.subscribers.size) cancel(flight);
        }
      };
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const flight of [...flights.values()]) {
        for (const subscriber of flight.subscribers) {
          subscriber.active = false;
          subscriber.reject(abortError());
        }
        flight.subscribers.clear();
        cancel(flight);
      }
    }
    return { subscribe, dispose, get inFlight() { return flights.size; } };
  }
  return { createRequestLifecycle };
});
