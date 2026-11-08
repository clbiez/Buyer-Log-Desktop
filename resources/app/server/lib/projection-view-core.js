'use strict';
// Stateless worker core; callers own authorization, exact gzip pinning, admission and response guards.
const crypto = require('node:crypto'), { types } = require('node:util');
const VIEW = 'cp-orders-private-view-v1', DETAIL = 'cp-orders-full-details-v1', MiB = 1048576;
const FULL_SHADOW_PLAN = 'cp-orders-full-shadow-v1';
const TOKEN_KEYS = Object.freeze(['ownerId', 'actorId', 'module', 'sourceGeneration', 'sourceRevision', 'moduleInputKey', 'sourceProjectionKey', 'accessHash', 'contextHash', 'planRevision', 'requestGeneration']);
const PIN_KEYS = Object.freeze(['schemaVersion', 'cacheGeneration', 'sourceLoadedAt', 'sourceRevisionKey', 'module', 'moduleInputKey', 'sourceProjectionKey', 'contextHash', 'checksum', 'uncompressedBytes']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
function fail(reason, statusCode) {
  const code = reason === 'STALE_PROJECTION' ? 'PROJECTION_VIEW_STALE' : statusCode === 413 || reason === 'WIRE_LIMIT' ? 'PROJECTION_VIEW_TOO_LARGE' : 'PROJECTION_VIEW_INVALID';
  return Object.assign(new Error(reason), { code, reason, statusCode: statusCode === undefined ? code === 'PROJECTION_VIEW_STALE' ? 409 : code === 'PROJECTION_VIEW_TOO_LARGE' ? 413 : 400 : statusCode });
}
function check(ok, code, status) { if (!ok) throw fail(code, status); }
function dataKeys(o, code = 'PROJECTION_WIRE_UNSUPPORTED') {
  check(o && typeof o === 'object' && !types.isProxy(o) && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o)), code);
  const keys = Reflect.ownKeys(o);
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(o, key); check(typeof key === 'string' && d.enumerable && own(d, 'value'), code); }
  return keys;
}
function tokenOf(input) {
  check(dataKeys(input, 'INVALID_PROJECTION_TOKEN').length === TOKEN_KEYS.length, 'INVALID_PROJECTION_TOKEN'); const token = {};
  for (const key of TOKEN_KEYS) { const v = Object.getOwnPropertyDescriptor(input, key)?.value; check(typeof v === 'string' && v.length && v.length <= 512, 'INVALID_PROJECTION_TOKEN'); put(token, key, v); }
  check(['cp', 'orders'].includes(token.module), 'INVALID_PROJECTION_TOKEN'); return Object.freeze(token);
}
const sameToken = (a, b) => TOKEN_KEYS.every(k => a[k] === b[k]);
function textList(value, max) {
  check(Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max && Reflect.ownKeys(value).length === value.length + 1, 'UNKNOWN_PLAN');
  const copy = []; for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); check(d && own(d, 'value') && typeof d.value === 'string' && d.value.length && d.value.length <= 512, 'UNKNOWN_PLAN'); copy.push(d.value); }
  check(new Set(copy).size === copy.length, 'UNKNOWN_PLAN'); return copy;
}
function stringBytes(text, available) {
  check(text.length + 2 <= available, 'WIRE_LIMIT', 413); let n = 2;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) n += 2;
    else if (c < 32) n += 6;
    else if (c < 128) n++;
    else if (c < 2048) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += c >= 0xd800 && c <= 0xdfff ? 6 : 3;
    check(n <= available, 'WIRE_LIMIT', 413);
  }
  return n;
}
function budget(maxBytes, maxNodes) { return { maxBytes, maxNodes, bytes: 0, nodes: 0, ancestors: new WeakSet() }; }
function charge(state, bytes) { state.bytes += bytes; check(state.bytes <= state.maxBytes, 'WIRE_LIMIT', 413); }
function measure(value, state, depth = 0) {
  check(++state.nodes <= state.maxNodes && depth <= 48, 'WIRE_LIMIT', 413);
  if (value === null) return charge(state, 4);
  if (typeof value === 'string') return charge(state, stringBytes(value, state.maxBytes - state.bytes));
  if (typeof value === 'boolean') return charge(state, value ? 4 : 5);
  if (typeof value === 'number') { check(Number.isFinite(value), 'PROJECTION_WIRE_UNSUPPORTED'); return charge(state, JSON.stringify(value).length); }
  check(value && typeof value === 'object' && !types.isProxy(value) && !types.isDate(value) && !state.ancestors.has(value), 'PROJECTION_WIRE_UNSUPPORTED');
  const array = Array.isArray(value), keys = array ? Reflect.ownKeys(value) : dataKeys(value);
  if (array) check(Object.getPrototypeOf(value) === Array.prototype && keys.length === value.length + 1, 'PROJECTION_WIRE_UNSUPPORTED');
  state.ancestors.add(value); charge(state, 2); let count = 0;
  try {
    for (const key of keys) {
      if (array && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && d && d.enumerable && own(d, 'value') && (!array || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)), 'PROJECTION_WIRE_UNSUPPORTED');
      if (count++) charge(state, 1); if (!array) charge(state, stringBytes(key, state.maxBytes - state.bytes) + 1); measure(d.value, state, depth + 1);
    }
  } finally { state.ancestors.delete(value); } // shared acyclic JSON-like aliases are counted, never copied/rejected merely as aliases
}
function secretOf(secret) { check(Buffer.isBuffer(secret) && secret.length === 32, 'INVALID_PROJECTION_SECRET', 500); return secret; }
function handleOf(token, ordinal, secret) { return crypto.createHmac('sha256', secret).update('buyerlog-projection-details-v1\0').update(JSON.stringify(token)).update('\0' + ordinal).digest().subarray(0, 24).toString('base64url'); }
function createProjectionCore(options = {}) {
  const defaults = { maxRows: 200000, maxViewBytes: 128 * MiB, maxDetailBytes: 4 * MiB, maxFullRawBytes: 128 * MiB, maxNodes: 16000000 };
  check(dataKeys(options, 'INVALID_OPTIONS').every(k => own(defaults, k)), 'INVALID_OPTIONS', 500); const limits = { ...defaults, ...options };
  for (const key of Object.keys(defaults)) check(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= defaults[key], 'INVALID_OPTIONS', 500);
  function bindProjectionPin(baseToken, pin) {
    const base = tokenOf(baseToken, false), keys = dataKeys(pin, 'INVALID_PROJECTION_PIN');
    check(keys.length === PIN_KEYS.length && PIN_KEYS.every(k => own(pin, k)), 'INVALID_PROJECTION_PIN');
    check(Number.isSafeInteger(pin.schemaVersion) && pin.schemaVersion > 0 && Number.isSafeInteger(pin.uncompressedBytes) && pin.uncompressedBytes > 0 && pin.uncompressedBytes <= limits.maxFullRawBytes, 'INVALID_PROJECTION_PIN');
    for (const key of PIN_KEYS.filter(k => !['schemaVersion', 'uncompressedBytes'].includes(k))) check(typeof pin[key] === 'string' && pin[key].length <= 4096, 'INVALID_PROJECTION_PIN');
    check(pin.cacheGeneration.length && /^[a-f0-9]{64}$/.test(pin.checksum) && pin.module === base.module && pin.moduleInputKey === base.moduleInputKey && pin.sourceProjectionKey === base.sourceProjectionKey && pin.contextHash === base.contextHash, 'INVALID_PROJECTION_PIN');
    const bound = { ...base, sourceRevision: 'projection-cache-v1:' + crypto.createHash('sha256').update(JSON.stringify([base.sourceRevision, ...PIN_KEYS.map(k => pin[k])])).digest('hex') };
    return Object.freeze(bound);
  }
  function compileFinitePlan(request, catalog) {
    try {
      check(dataKeys(request).every(k => ['token', 'viewId', 'rowKey', 'readers'].includes(k)), 'UNKNOWN_PLAN'); const token = tokenOf(request.token);
      check(typeof request.viewId === 'string' && request.viewId.length > 0 && request.viewId.length <= 128 && (request.rowKey === undefined || request.rowKey === 'rows'), 'UNKNOWN_PLAN');
      const roots = textList(request.readers, 64); check(roots.length > 0 && dataKeys(catalog).length === 2 && own(catalog, 'revision') && own(catalog, 'readers') && catalog.revision === token.planRevision && catalog.readers instanceof Map && !types.isProxy(catalog.readers), 'UNKNOWN_PLAN');
      const visiting = new Set(), visited = new Set(), fields = new Set(), ordered = [];
      function visit(id) {
        if (visited.has(id)) return; check(!visiting.has(id) && visited.size + visiting.size < 64, 'UNKNOWN_PLAN'); visiting.add(id);
        const reader = catalog.readers.get(id); check(dataKeys(reader).every(k => ['mode', 'fields', 'dependsOn'].includes(k)) && own(reader, 'mode') && own(reader, 'fields') && reader.mode === 'finite', 'UNKNOWN_PLAN');
        for (const dependency of textList(reader.dependsOn || [], 64)) visit(dependency);
        for (const field of textList(reader.fields, 512)) fields.add(field); check(fields.size <= 512, 'UNKNOWN_PLAN');
        visiting.delete(id); visited.add(id); ordered.push(id);
      }
      roots.forEach(visit);
      return Object.freeze({ version: 1, status: 'finite', revision: catalog.revision, viewId: request.viewId, rowKey: request.rowKey || 'rows', token, readers: Object.freeze(ordered), fields: Object.freeze([...fields]) });
    } catch (_) { return null; }
  }
  function planOf(plan) {
    try {
      check(dataKeys(plan).length === 8 && ['version', 'status', 'revision', 'viewId', 'rowKey', 'token', 'readers', 'fields'].every(k => own(plan, k)) && plan.version === 1 && ['finite', 'full-shadow'].includes(plan.status) && plan.rowKey === 'rows', 'UNKNOWN_PLAN');
      const token = tokenOf(plan.token); check(plan.revision === token.planRevision && typeof plan.viewId === 'string' && plan.viewId.length > 0 && plan.viewId.length <= 128, 'UNKNOWN_PLAN');
      check((token.planRevision === FULL_SHADOW_PLAN) === (plan.status === 'full-shadow'), 'UNKNOWN_PLAN');
      const readers = textList(plan.readers, 64); check(readers.length > 0, 'UNKNOWN_PLAN');
      return Object.freeze({ ...plan, token, readers: Object.freeze(readers), fields: Object.freeze(textList(plan.fields, 512)) });
    } catch (_) { return null; }
  }
  function sourceRows(full, rowKey) {
    dataKeys(full); const rows = Object.getOwnPropertyDescriptor(full, rowKey)?.value;
    check(Array.isArray(rows) && !types.isProxy(rows) && Object.getPrototypeOf(rows) === Array.prototype && rows.length <= limits.maxRows && Reflect.ownKeys(rows).length === rows.length + 1, 'PROJECTION_WIRE_UNSUPPORTED'); return rows;
  }
  function fullShadowPlan(fullWireEnvelope, trustedToken) {
    try {
      const token = tokenOf(trustedToken); if (token.planRevision !== FULL_SHADOW_PLAN) return null;
      const rows = sourceRows(fullWireEnvelope, 'rows'), fields = new Set();
      for (let i = 0; i < rows.length; i++) { const d = Object.getOwnPropertyDescriptor(rows, String(i)); check(d && own(d, 'value'), 'PROJECTION_WIRE_UNSUPPORTED'); for (const key of dataKeys(d.value)) fields.add(key); check(fields.size <= 512, 'UNKNOWN_PLAN'); }
      return Object.freeze({ version: 1, status: 'full-shadow', revision: FULL_SHADOW_PLAN, viewId: token.module + '-full-shadow', rowKey: 'rows', token, readers: Object.freeze(['full-row-own-keys']), fields: Object.freeze([...fields]) });
    } catch (_) { return null; }
  }
  function buildView(fullWireEnvelope, trustedToken, trustedPlan, secret) {
    const plan = planOf(trustedPlan); if (!plan) return fullWireEnvelope;
    const token = tokenOf(trustedToken); check(sameToken(plan.token, token), 'STALE_PROJECTION'); secretOf(secret);
    try {
      const rows = sourceRows(fullWireEnvelope, plan.rowKey), fullKeys = dataKeys(fullWireEnvelope);
      if ((own(fullWireEnvelope, 'profile') && fullWireEnvelope.profile !== 'full') || ['mode', 'token', 'completeness'].some(k => own(fullWireEnvelope, k)) || (plan.rowKey === 'orders' && own(fullWireEnvelope, 'rows'))) return fullWireEnvelope;
      const result = {}, viewRows = [], completeness = [], wanted = new Set(plan.fields), state = budget(limits.maxViewBytes, limits.maxNodes);
      for (const key of fullKeys) if (key !== plan.rowKey && key !== 'profile') put(result, key, fullWireEnvelope[key]);
      put(result, 'profile', VIEW); put(result, 'mode', 'shadow'); put(result, 'token', token); put(result, 'rows', viewRows); put(result, 'completeness', completeness); measure(result, state);
      for (let ordinal = 0; ordinal < rows.length; ordinal++) {
        const d = Object.getOwnPropertyDescriptor(rows, String(ordinal)); check(d && own(d, 'value'), 'PROJECTION_WIRE_UNSUPPORTED'); const row = d.value, thin = {};
        const rowKeys = dataKeys(row); if (plan.status === 'full-shadow') check(rowKeys.every(key => wanted.has(key)), 'FULL_SHADOW_FIELDS_INCOMPLETE');
        for (const key of rowKeys) if (wanted.has(key)) put(thin, key, row[key]);
        const sidecar = { ordinal, handle: handleOf(token, ordinal, secret), absentKeys: plan.fields.filter(key => !own(row, key)) };
        if (ordinal) charge(state, 2); measure(thin, state); measure(sidecar, state); viewRows.push(thin); completeness.push(sidecar);
      }
      return result;
    } catch (e) { if (['PROJECTION_WIRE_UNSUPPORTED', 'WIRE_LIMIT'].includes(e.reason)) return fullWireEnvelope; throw e; }
  }
  function resolveDetails(fullWireEnvelope, request, currentToken, secret) {
    check(dataKeys(request, 'INVALID_DETAIL_REQUEST').every(k => ['token', 'records', 'maxBytes'].includes(k)) && own(request, 'token') && own(request, 'records'), 'INVALID_DETAIL_REQUEST');
    const token = tokenOf(request.token), current = tokenOf(currentToken); check(sameToken(token, current), 'STALE_PROJECTION'); secretOf(secret);
    const records = request.records, maximum = request.maxBytes === undefined ? limits.maxDetailBytes : request.maxBytes;
    check(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 4 * MiB && Array.isArray(records) && !types.isProxy(records) && records.length > 0 && records.length <= 128 && Reflect.ownKeys(records).length === records.length + 1, 'INVALID_DETAIL_REQUEST');
    const seen = new Set();
    for (let i = 0; i < records.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(records, String(i)); check(descriptor && own(descriptor, 'value'), 'INVALID_DETAIL_RECORD'); const record = descriptor.value;
      check(dataKeys(record, 'INVALID_DETAIL_RECORD').length === 2 && own(record, 'ordinal') && own(record, 'handle') && Number.isSafeInteger(record.ordinal) && record.ordinal >= 0 && record.ordinal < limits.maxRows && !seen.has(record.ordinal) && typeof record.handle === 'string' && /^[A-Za-z0-9_-]{32}$/.test(record.handle), 'INVALID_DETAIL_RECORD'); seen.add(record.ordinal);
      check(crypto.timingSafeEqual(Buffer.from(record.handle), Buffer.from(handleOf(token, record.ordinal, secret))), 'DETAIL_HANDLE_MISMATCH');
    }
    measure({ token, records, maxBytes: maximum }, budget(65536, 20000));
    const rows = sourceRows(fullWireEnvelope, 'rows'), selected = [], result = { profile: DETAIL, complete: true, token, records: selected }, state = budget(Math.min(maximum, limits.maxDetailBytes), limits.maxNodes); measure(result, state);
    for (const record of records) {
      check(record.ordinal < rows.length, 'INVALID_DETAIL_RECORD'); const d = Object.getOwnPropertyDescriptor(rows, String(record.ordinal)); check(d && own(d, 'value'), 'PROJECTION_WIRE_UNSUPPORTED'); dataKeys(d.value);
      const item = { ordinal: record.ordinal, handle: record.handle, row: d.value }; if (selected.length) charge(state, 1); measure(item, state); selected.push(item);
    }
    return result; // read-only, task-local aliases; caller serializes before releasing its existing compute/source lease
  }
  return Object.freeze({ bindProjectionPin, compileFinitePlan, fullShadowPlan, buildView, resolveDetails });
}
module.exports = Object.freeze({ createProjectionCore, ...createProjectionCore(), VIEW, DETAIL, FULL_SHADOW_PLAN, TOKEN_KEYS, PIN_KEYS });
