(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLProjectionShadowHydration = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VIEW = 'cp-orders-private-view-v1', DETAIL = 'cp-orders-full-details-v1';
  const TOKEN_KEYS = Object.freeze(['ownerId', 'actorId', 'module', 'sourceGeneration', 'sourceRevision', 'moduleInputKey',
    'sourceProjectionKey', 'accessHash', 'contextHash', 'planRevision', 'requestGeneration']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function fail(code) { const error = new Error(code); error.code = code; return error; }
  function check(condition, code) { if (!condition) throw fail(code); }
  function abortError() { const error = fail('ABORTED'); error.name = 'AbortError'; return error; }
  function withSubscriberAbort(work, signal) {
    if (!signal) return work;
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(ok, value) { if (settled) return; settled = true; signal.removeEventListener('abort', onAbort); if (ok) resolve(value); else reject(value); }
      function onAbort() { finish(false, abortError()); }
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(work).then(value => finish(true, value), error => finish(false, error));
      if (signal.aborted) onAbort();
    });
  }
  function tokenOf(input) {
    check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_TOKEN');
    check(Reflect.ownKeys(input).length === TOKEN_KEYS.length, 'INVALID_TOKEN');
    const token = {};
    for (const key of TOKEN_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      check(descriptor && own(descriptor, 'value') && typeof descriptor.value === 'string'
        && descriptor.value.length > 0 && descriptor.value.length <= 512, 'INVALID_TOKEN');
      token[key] = descriptor.value;
    }
    check(token.module === 'cp' || token.module === 'orders', 'INVALID_TOKEN');
    return Object.freeze(token);
  }
  // Input is parsed date-safe JSON, before the actual client normalizer. No raw graph/descriptor promise.
  function jsonCopy(value, budget, depth = 0) {
    check(++budget.nodes <= 1000000 && depth <= 48, 'DETAIL_TOO_LARGE');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { check(Number.isFinite(value), 'NON_JSON_VALUE'); return value; }
    check(value && typeof value === 'object' && !(value instanceof Date), 'NON_JSON_VALUE');
    const prototype = Object.getPrototypeOf(value), array = Array.isArray(value);
    check(array || prototype === Object.prototype || prototype === null, 'NON_JSON_VALUE');
    check(!budget.seen.has(value), 'NON_JSON_VALUE'); budget.seen.add(value);
    const keys = Reflect.ownKeys(value), result = array ? [] : {};
    if (array) check(keys.length === value.length + 1, 'NON_JSON_VALUE');
    for (const key of keys) {
      if (array && key === 'length') continue;
      check(typeof key === 'string' && (!array || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)), 'NON_JSON_VALUE');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(descriptor && descriptor.enumerable && own(descriptor, 'value'), 'NON_JSON_VALUE');
      Object.defineProperty(result, key, { value: jsonCopy(descriptor.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  const copy = value => jsonCopy(value, { nodes: 0, seen: new WeakSet() });
  function sameJson(left, right) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left), other = Object.keys(right);
    return keys.length === other.length && keys.every((key, index) => key === other[index] && sameJson(left[key], right[key]));
  }
  const byteLength = text => typeof TextEncoder === 'function' ? new TextEncoder().encode(text).byteLength : Buffer.byteLength(text, 'utf8');
  function createShadowCoordinator({ fetchDetails, prepareFull, isCurrent, getDirty,
    maxBatchRows = 128, maxBatchBytes = 4 * 1024 * 1024, maxRequestRows = 4096, maxConcurrentBatches = 2 } = {}) {
    for (const callback of [fetchDetails, prepareFull, isCurrent, getDirty]) check(typeof callback === 'function', 'INVALID_OPTIONS');
    check(Number.isSafeInteger(maxBatchRows) && maxBatchRows > 0 && maxBatchRows <= 4096
      && Number.isSafeInteger(maxBatchBytes) && maxBatchBytes > 0 && maxBatchBytes <= 64 * 1024 * 1024
      && Number.isSafeInteger(maxRequestRows) && maxRequestRows >= maxBatchRows && maxRequestRows <= 200000
      && Number.isSafeInteger(maxConcurrentBatches) && maxConcurrentBatches > 0 && maxConcurrentBatches <= 32, 'INVALID_OPTIONS');
    const pending = new Map(), admission = []; let activeBatches = 0, pumpScheduled = false;
    function scheduleAdmission() {
      if (pumpScheduled) return; pumpScheduled = true;
      Promise.resolve().then(() => {
        pumpScheduled = false;
        while (activeBatches < maxConcurrentBatches && admission.length) {
          const flight = admission.shift();
          if (flight.controller.signal.aborted || !flight.subscribers.size) { flight.reject(abortError()); continue; }
          flight.started = true; activeBatches++; flight.run();
        }
      });
    }
    function live(token, signal) { if (signal?.aborted) throw abortError(); check(isCurrent(token) === true, 'STALE_CONTEXT'); }
    function dirtyStamp(token, record) {
      const value = getDirty({ token, ordinal: record.ordinal, handle: record.handle });
      check(value && value.dirty === false && (typeof value.revision === 'string'
        || (Number.isSafeInteger(value.revision) && value.revision >= 0)), value?.dirty === true ? 'DIRTY_ROW' : 'INVALID_DIRTY_GUARD');
      return JSON.stringify([value.dirty, value.revision]);
    }
    function assertDirty(token, records, stamps) {
      for (const record of records) check(dirtyStamp(token, record) === stamps.get(record.ordinal), 'DIRTY_REVISION_CHANGED');
    }
    const rowKey = (key, record) => JSON.stringify([key, record.ordinal, record.handle]);
    function validateDetails(response, tokenKey, records) {
      check(response && response.profile === DETAIL && response.complete === true, 'INCOMPLETE_DETAILS');
      check(JSON.stringify(tokenOf(response.token)) === tokenKey, 'WRONG_DETAIL_CONTEXT');
      check(Array.isArray(response.records) && response.records.length === records.length, 'INCOMPLETE_DETAILS');
      const wanted = new Map(records.map(record => [record.ordinal, record.handle])), values = new Map();
      for (const item of response.records) {
        check(item && wanted.has(item.ordinal) && wanted.get(item.ordinal) === item.handle && !values.has(item.ordinal), 'WRONG_DETAIL_RECORD');
        check(item.row && typeof item.row === 'object' && !Array.isArray(item.row), 'INVALID_DETAIL_ROW');
        values.set(item.ordinal, copy(item.row));
      }
      check(byteLength(JSON.stringify(records.map(record => ({ ordinal: record.ordinal, handle: record.handle,
        row: values.get(record.ordinal) })))) <= maxBatchBytes, 'DETAIL_TOO_LARGE');
      return values;
    }
    function startFlight(token, key, records) {
      const flight = { records, subscribers: new Set(), controller: new AbortController(), settled: false, started: false };
      for (const record of records) pending.set(rowKey(key, record), flight);
      flight.promise = new Promise((resolve, reject) => { flight.resolve = resolve; flight.reject = reject; }).finally(() => {
        flight.settled = true;
        for (const record of records) if (pending.get(rowKey(key, record)) === flight) pending.delete(rowKey(key, record));
        if (flight.started) activeBatches--;
        scheduleAdmission();
      });
      flight.run = () => Promise.resolve().then(() => {
        live(token, flight.controller.signal);
        return fetchDetails({ token, records: records.map(record => ({ ...record })), signal: flight.controller.signal, maxBytes: maxBatchBytes });
      }).then(response => { live(token, flight.controller.signal); return validateDetails(response, key, records); }).then(flight.resolve, flight.reject);
      admission.push(flight); scheduleAdmission();
      return flight;
    }
    function subscribe(token, records, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      const key = JSON.stringify(token), flights = new Set(), missing = [];
      for (const record of records) { const flight = pending.get(rowKey(key, record)); if (flight) flights.add(flight); else missing.push(record); }
      for (let offset = 0; offset < missing.length; offset += maxBatchRows) flights.add(startFlight(token, key, missing.slice(offset, offset + maxBatchRows)));
      return new Promise((resolve, reject) => {
        const subscriber = {}; let settled = false;
        function finish(ok, value) {
          if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort);
          for (const flight of flights) {
            flight.subscribers.delete(subscriber);
            if (!flight.settled && !flight.subscribers.size) {
              flight.controller.abort(); // cooperative fetch signal only; no running-compute cancellation claim
              for (const record of flight.records) if (pending.get(rowKey(key, record)) === flight) pending.delete(rowKey(key, record));
              if (!flight.started) {
                const queued = admission.indexOf(flight); if (queued >= 0) admission.splice(queued, 1);
                flight.reject(abortError());
              }
            }
          }
          if (ok) resolve(value); else reject(value);
        }
        function onAbort() { finish(false, abortError()); }
        for (const flight of flights) flight.subscribers.add(subscriber);
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.all([...flights].map(flight => flight.promise)).then(values => {
          const merged = new Map(); for (const value of values) for (const [ordinal, row] of value) merged.set(ordinal, row);
          finish(true, merged);
        }, error => finish(false, error));
        if (signal?.aborted) onAbort();
      });
    }
    function accept(envelope) {
      // The established full path is untouched, including envelope and row identity.
      if (envelope && (!own(envelope, 'profile') || envelope.profile === 'full')) return envelope;
      check(envelope && envelope.profile === VIEW && envelope.mode === 'shadow', 'UNSUPPORTED_PROFILE');
      const token = tokenOf(envelope.token), records = envelope.completeness, retained = new Map();
      check(Array.isArray(envelope.rows) && Array.isArray(records) && records.length === envelope.rows.length
        && records.length <= 200000, 'INVALID_VIEW');
      const indexed = new Map(), viewRows = envelope.rows.map((row, index) => {
        const metadata = records[index];
        check(row && typeof row === 'object' && !Array.isArray(row), 'INVALID_VIEW');
        check(metadata && Number.isSafeInteger(metadata.ordinal) && metadata.ordinal >= 0 && !indexed.has(metadata.ordinal)
          && typeof metadata.handle === 'string' && metadata.handle.length > 0 && metadata.handle.length <= 512
          && Array.isArray(metadata.absentKeys) && metadata.absentKeys.every(key => typeof key === 'string' && !own(row, key)), 'INVALID_VIEW');
        const value = copy(row), record = Object.freeze({ ordinal: metadata.ordinal, handle: metadata.handle });
        indexed.set(record.ordinal, { record, viewRow: value, presentKeys: Object.keys(value), absentKeys: [...new Set(metadata.absentKeys)] });
        return copy(value); // keep the compatibility baseline private from exposed view rows
      });
      live(token);
      function completeness(ordinal) {
        const item = indexed.get(ordinal); check(item, 'UNKNOWN_ROW');
        return retained.has(ordinal) ? { state: 'full', presentKeys: Object.keys(retained.get(ordinal).row), absentKeys: null }
          : { state: 'view', presentKeys: [...item.presentKeys], absentKeys: [...item.absentKeys] };
      }
      async function requireFull(ordinals, { signal } = {}) {
        live(token, signal);
        check(Array.isArray(ordinals) && ordinals.length > 0 && ordinals.length <= maxRequestRows, 'INVALID_REQUEST');
        const unique = [...new Set(ordinals)], wanted = unique.map(ordinal => { check(indexed.has(ordinal), 'UNKNOWN_ROW'); return indexed.get(ordinal).record; });
        const stamps = new Map(wanted.map(record => [record.ordinal, dirtyStamp(token, record)]));
        for (const record of wanted) if (retained.has(record.ordinal)) check(retained.get(record.ordinal).stamp === stamps.get(record.ordinal), 'DIRTY_REVISION_CHANGED');
        const missing = wanted.filter(record => !retained.has(record.ordinal));
        const raw = missing.length ? await subscribe(token, missing, signal) : new Map();
        live(token, signal); assertDirty(token, wanted, stamps);
        const staged = missing.map(record => {
          check(raw.has(record.ordinal), 'INCOMPLETE_DETAILS');
          const full = raw.get(record.ordinal), view = indexed.get(record.ordinal);
          check(view.presentKeys.every(key => own(full, key) && sameJson(view.viewRow[key], full[key]))
            && view.absentKeys.every(key => !own(full, key)), 'VIEW_DETAIL_MISMATCH');
          return copy(full);
        });
        if (staged.length) {
          const originals = [...staged];
          const work = Promise.resolve().then(() => {
            live(token, signal); return prepareFull(staged, { token, records: Object.freeze([...missing]), signal });
          });
          const result = await withSubscriberAbort(work, signal);
          check(result === undefined && staged.length === originals.length && staged.every((row, index) => row === originals[index]), 'INVALID_PREPARATION');
        }
        live(token, signal); assertDirty(token, wanted, stamps);
        for (const record of wanted) if (retained.has(record.ordinal)) check(retained.get(record.ordinal).stamp === stamps.get(record.ordinal), 'DIRTY_REVISION_CHANGED');
        // No await between the last checks and complete private publication; no spread into a view row.
        missing.forEach((record, index) => { if (!retained.has(record.ordinal)) retained.set(record.ordinal, { row: staged[index], stamp: stamps.get(record.ordinal) }); });
        return { mode: 'shadow', token, ordinals: [...ordinals], rows: ordinals.map(ordinal => retained.get(ordinal).row),
          assertCurrent() { live(token, signal); assertDirty(token, wanted, stamps); } };
      }
      return Object.freeze({ mode: 'shadow', token, viewRows, completeness, requireFull, assertCurrent() { live(token); } });
    }
    return Object.freeze({ accept });
  }
  return Object.freeze({ createShadowCoordinator, VIEW, DETAIL, TOKEN_KEYS });
});
