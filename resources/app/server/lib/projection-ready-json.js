'use strict';

// Private worker preparation only. Input must already be verified, parsed,
// date-safe JSON. This helper grants no owner/access/dependency authority.
const { types, promisify } = require('node:util');
const { gzip } = require('node:zlib');
const crypto = require('node:crypto');
const canonical = require('./canonical-fields');
const schemas = require('../../public/module-projection-schema');
const native = require('./projection-native-json');
const MiB = 1024 * 1024;
const PROFILE = 'orders-ready-model-v1';
const MAX_FULL = 128 * MiB, MAX_GZIP = 32 * MiB, MAX_METADATA = 65536;
const INFO_KEYS = ['ownerId', 'actorId', 'sourceKey', 'sourceGeneration', 'accessHash', 'planEpoch', 'fullJsonSha256', 'fullJsonBytes'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function reject(reason) { throw Object.assign(new Error(reason), { reason }); }
function check(value, reason) { if (!value) reject(reason); }
function record(value, reason) {
  check(value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value), reason);
  check([Object.prototype, null].includes(Object.getPrototypeOf(value)), reason);
  const result = new Map();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(typeof key === 'string' && descriptor?.enumerable && own(descriptor, 'value'), reason);
    result.set(key, descriptor.value);
  }
  return result;
}
function array(value, maximum, reason) {
  check(value && typeof value === 'object' && !types.isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, reason);
  check(value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1, reason);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    check(descriptor?.enumerable && own(descriptor, 'value'), reason);
  }
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Descriptor-only validation, no copied value graph and no user hooks. The
// verified JSON boundary remains required; these are defensive shape bounds,
// not a substitute for raw gzip/JSON/source checks in the worker.
function parsedJson(root) {
  check(!Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'), 'UNSUPPORTED_JSON_PROTOTYPE');
  const seen = new WeakSet(), stack = [];
  let nodes = 0;
  function enter(value) {
    check(++nodes <= 32000000, 'PARSED_JSON_NODE_BUDGET');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { check(value.length <= MAX_FULL, 'PARSED_JSON_STRING_BUDGET'); return; }
    if (typeof value === 'number') { check(Number.isFinite(value), 'UNSUPPORTED_PARSED_JSON'); return; }
    check(value && typeof value === 'object' && !types.isProxy(value), 'UNSUPPORTED_PARSED_JSON');
    const isArray = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    check(isArray ? prototype === Array.prototype : [Object.prototype, null].includes(prototype), 'UNSUPPORTED_PARSED_JSON');
    // JSON.parse cannot create aliases/cycles. Reject them rather than let a
    // direct row object reappear nested and inherit the native WeakSet policy.
    check(!seen.has(value) && stack.length < 128, 'UNSUPPORTED_PARSED_JSON');
    const keys = Reflect.ownKeys(value);
    if (isArray) check(value.length <= 1000000 && keys.length === value.length + 1, 'UNSUPPORTED_PARSED_JSON');
    seen.add(value); stack.push({ value, keys, index: 0, isArray });
  }
  enter(root);
  while (stack.length) {
    const current = stack[stack.length - 1];
    if (current.index === current.keys.length) { stack.pop(); continue; }
    const key = current.keys[current.index++];
    if (current.isArray && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
    check(typeof key === 'string' && descriptor?.enumerable && own(descriptor, 'value'), 'UNSUPPORTED_PARSED_JSON');
    if (current.isArray) check(/^(0|[1-9]\d*)$/.test(key) && Number(key) < current.value.length, 'UNSUPPORTED_PARSED_JSON');
    enter(descriptor.value);
  }
}
function stableInfo(input, limits) {
  const descriptors = record(input, 'INVALID_VIEW_INFO');
  check(INFO_KEYS.every(key => descriptors.has(key)) && [...descriptors.keys()].every(key => INFO_KEYS.includes(key) || key === 'requestNonce'), 'INVALID_VIEW_INFO');
  const result = {};
  for (const key of INFO_KEYS) result[key] = descriptors.get(key);
  for (const key of ['ownerId', 'actorId', 'sourceKey', 'sourceGeneration', 'accessHash']) check(typeof result[key] === 'string' && result[key].length > 0 && result[key].length <= limits.metadata, 'INVALID_VIEW_INFO');
  check(Number.isSafeInteger(result.planEpoch) && result.planEpoch >= 0, 'INVALID_VIEW_INFO');
  check(typeof result.fullJsonSha256 === 'string' && /^[a-f0-9]{64}$/.test(result.fullJsonSha256), 'INVALID_VIEW_INFO');
  check(Number.isSafeInteger(result.fullJsonBytes) && result.fullJsonBytes > 0 && result.fullJsonBytes <= limits.full, 'FULL_JSON_BUDGET');
  if (descriptors.has('requestNonce')) check(typeof descriptors.get('requestNonce') === 'string' && descriptors.get('requestNonce').length <= 256, 'INVALID_VIEW_INFO');
  // The nonce is deliberately absent from cached metadata and returned info.
  check(Buffer.byteLength(JSON.stringify(result)) <= limits.metadata, 'VIEW_INFO_BUDGET');
  return result;
}
function canonicalGuard() {
  const tokens = new Set(), modules = new Set(['cp', 'orders']);
  for (const [id, field] of Object.entries(canonical.fields)) {
    tokens.add(canonical.token(id));
    for (const alias of field.aliases || []) tokens.add(canonical.token(alias));
    for (const [module, binding] of Object.entries(field.modules || {})) {
      modules.add(module);
      for (const key of binding.keys || []) tokens.add(canonical.token(key));
    }
  }
  return key => tokens.has(canonical.token(key)) || [...modules].some(module => canonical.canonicalId(module, key) !== null);
}
function lower(value, maximum) { check(Number.isSafeInteger(value) && value > 0 && value <= maximum, 'INVALID_LIMIT'); return value; }
function create(limits = {}) {
  const entries = record(limits, 'INVALID_LIMIT');
  check([...entries.keys()].every(key => ['maxFullBytes', 'maxGzipBytes', 'maxMetadataBytes'].includes(key)), 'INVALID_LIMIT');
  const cap = {
    full: lower(entries.has('maxFullBytes') ? entries.get('maxFullBytes') : MAX_FULL, MAX_FULL),
    gzip: lower(entries.has('maxGzipBytes') ? entries.get('maxGzipBytes') : MAX_GZIP, MAX_GZIP),
    metadata: lower(entries.has('maxMetadataBytes') ? entries.get('maxMetadataBytes') : MAX_METADATA, MAX_METADATA),
  };
  async function prepareReadyJson(fullWire, options) {
    const fallback = reason => ({ kind: 'full', reason, fullWire });
    try {
      const input = record(options, 'INVALID_OPTIONS');
      check(input.size === 3 && ['schema', 'omittedKeys', 'viewInfo'].every(key => input.has(key)), 'INVALID_OPTIONS');
      const known = schemas.read(input.get('schema'), 'orders');
      check(known.status === 'known', 'UNKNOWN_SCHEMA');
      const top = record(fullWire, 'UNSUPPORTED_PARSED_ROWS');
      check(!top.has('profile') && !top.has('projection'), 'ENVELOPE_METADATA_COLLISION');
      check(!top.has('requestNonce'), 'REQUEST_SCOPED_BODY');
      const rows = array(top.get('rows'), 50000, 'UNSUPPORTED_PARSED_ROWS');
      check(known.rowCount === rows.length, 'SCHEMA_ROW_COUNT');
      const rowKeys = [], universe = new Set();
      for (const row of rows) for (const key of record(row, 'UNSUPPORTED_PARSED_ROW').keys()) if (!universe.has(key)) { universe.add(key); rowKeys.push(key); }
      check(rowKeys.length === known.rowKeys.length && rowKeys.every((key, index) => key === known.rowKeys[index]), 'SCHEMA_ROW_KEYS');
      const omitted = array(input.get('omittedKeys'), 64, 'INVALID_OMITTED_KEYS');
      check(omitted.length > 0 && new Set(omitted).size === omitted.length, 'INVALID_OMITTED_KEYS');
      check(known.modelColumns.length <= 512, 'UNKNOWN_REGISTRATION');
      const isCanonical = canonicalGuard(), registry = new Map(), tokens = new Set(), modelIds = new Set();
      for (const definition of known.modelColumns) {
        const key = definition.header, token = canonical.token(key);
        check(key.length <= 256 && token && !registry.has(key) && !tokens.has(token), 'AMBIGUOUS_REGISTRATION');
        check(!isCanonical(key), 'CANONICAL_REGISTRATION');
        check(key.startsWith('__CPX_'), 'UNKNOWN_REGISTRATION');
        const modelId = own(definition, 'id') ? definition.id : undefined;
        if (typeof modelId === 'string' && modelId) { check(!modelIds.has(modelId), 'AMBIGUOUS_REGISTRATION'); modelIds.add(modelId); }
        registry.set(key, { k: key, modelCustom: true, hidden: omitted.includes(key) }); tokens.add(token);
      }
      for (const key of omitted) {
        check(typeof key === 'string' && key.length <= 256 && key.startsWith('__CPX_') && registry.has(key) && universe.has(key), 'UNREGISTERED_OMISSION');
        check(!isCanonical(key), 'CANONICAL_OMISSION');
      }
      const info = freeze({ schemaVersion: 1, module: 'orders', schema: known, omittedKeys: [...omitted], viewInfo: stableInfo(input.get('viewInfo'), cap) });
      const metadataBytes = Buffer.byteLength(JSON.stringify({ profile: PROFILE, projection: info }));
      check(metadataBytes <= cap.metadata, 'METADATA_BUDGET');
      parsedJson(fullWire);
      // Only this top-level wrapper is new. Every row/cell still belongs to the
      // untouched full source; the frozen replacer removes selected own keys.
      const wire = { ...fullWire, profile: PROFILE, projection: info };
      const contextKey = crypto.createHash('sha256').update(JSON.stringify(info.viewInfo)).digest('hex');
      const selected = native.serializeThin(wire, {
        contextKey, columnDefs: [...registry.values()],
        plan: { version: 1, mode: 'explicit-hidden-model-keys', dependencyClosureKnown: true, contextKey, omittedKeys: [...omitted] },
      });
      check(selected.kind === 'thin-json', 'NATIVE_FULL_FALLBACK');
      const uncompressedBytes = Buffer.byteLength(selected.json);
      check(uncompressedBytes <= cap.full + cap.metadata, 'READY_JSON_BUDGET');
      const buffer = await promisify(gzip)(Buffer.from(selected.json, 'utf8'), { level: 4 });
      check(buffer.length <= cap.gzip, 'READY_GZIP_BUDGET');
      return { kind: 'ready', buffer, uncompressedBytes, checksum: crypto.createHash('sha256').update(buffer).digest('hex'), registryKeys: Object.freeze([...rowKeys]), info };
    } catch (error) { return fallback(error.reason || 'UNSUPPORTED_READY_JSON'); }
  }
  return Object.freeze({ prepareReadyJson });
}
module.exports = Object.freeze({ PROFILE, MAX_FULL, MAX_GZIP, MAX_METADATA, create, ...create() });
