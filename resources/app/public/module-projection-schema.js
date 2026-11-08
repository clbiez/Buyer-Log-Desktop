(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('node:util').types.isProxy);
  else root.BLModuleProjectionSchema = factory(null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (isProxy) {
  'use strict';
  const SCHEMA_VERSION = 1, MAX_PUBLIC_BYTES = 65536, MAX_ROW_KEYS = 512;
  const FIELDS = ['schemaVersion', 'module', 'status', 'rowCount', 'rowKeys', 'modelColumns'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const get = (o, k) => Object.getOwnPropertyDescriptor(o, k)?.value;
  function reject() { throw new TypeError('UNSUPPORTED_MODULE_SCHEMA'); }
  function check(ok) { if (!ok) reject(); }
  function put(o, k, value) { Object.defineProperty(o, k, { value, enumerable: true, writable: true, configurable: true }); }
  function plainKeys(value) {
    check(value && typeof value === 'object' && !(isProxy && isProxy(value)) && !Array.isArray(value));
    check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const keys = Reflect.ownKeys(value);
    for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); check(typeof key === 'string' && d && d.enumerable && own(d, 'value')); }
    return keys;
  }
  function dense(value) {
    check(value && typeof value === 'object' && !(isProxy && isProxy(value)) && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
    return value.length;
  }
  function stringBytes(text, available) {
    check(text.length + 2 <= available); let bytes = 2;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) bytes += 2;
      else if (c < 32) bytes += 6;
      else if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += c >= 0xd800 && c <= 0xdfff ? 6 : 3;
      check(bytes <= available);
    }
    return bytes;
  }
  // Copies only bounded public metadata. Full row values/graphs are never copied here.
  function publicCopy(value, maxBytes) {
    let bytes = 0, nodes = 0; const ancestors = new WeakSet();
    function charge(n) { bytes += n; check(bytes <= maxBytes); }
    function visit(v, depth) {
      check(++nodes <= 131072 && depth <= 48);
      if (v === null) { charge(4); return null; }
      if (typeof v === 'string') { charge(stringBytes(v, maxBytes - bytes)); return v; }
      if (typeof v === 'boolean') { charge(v ? 4 : 5); return v; }
      if (typeof v === 'number') { check(Number.isFinite(v)); charge(JSON.stringify(v).length); return v; }
      check(v && typeof v === 'object' && !(isProxy && isProxy(v)) && !ancestors.has(v));
      const array = Array.isArray(v), length = array ? dense(v) : 0;
      if (array) check(length <= Math.floor(maxBytes / 2));
      const keys = array ? Reflect.ownKeys(v) : plainKeys(v);
      if (array) check(keys.length === length + 1);
      const result = array ? [] : {}; ancestors.add(v); charge(2); let count = 0;
      try {
        for (const key of keys) {
          if (array && key === 'length') continue;
          const d = Object.getOwnPropertyDescriptor(v, key);
          check(typeof key === 'string' && d && d.enumerable && own(d, 'value') && (!array || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < length)));
          if (count++) charge(1); if (!array) charge(stringBytes(key, maxBytes - bytes) + 1);
          put(result, key, visit(d.value, depth + 1));
        }
      } finally { ancestors.delete(v); }
      return result;
    }
    return visit(value, 0);
  }
  function validDefinitions(defs) {
    const length = dense(defs);
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(defs, String(i)); check(d && own(d, 'value')); const def = d.value; plainKeys(def);
      check(own(def, 'header') && typeof get(def, 'header') === 'string' && get(def, 'header').length > 0
        && own(def, 'label') && typeof get(def, 'label') === 'string' && get(def, 'label').length > 0);
      // No header/id/role/group/dataType/percentage normalization, deduplication or defaulting.
    }
  }
  function knownShape(value, expectedModule, maxRowKeys) {
    const keys = plainKeys(value); check(keys.length === FIELDS.length && FIELDS.every(key => own(value, key)));
    check(get(value, 'schemaVersion') === SCHEMA_VERSION && get(value, 'status') === 'known' && get(value, 'module') === expectedModule);
    const count = get(value, 'rowCount'), rowKeys = get(value, 'rowKeys');
    check(Number.isSafeInteger(count) && count >= 0 && count <= 0xffffffff); const length = dense(rowKeys); check(length <= maxRowKeys && (count !== 0 || length === 0));
    const seen = new Set();
    for (let i = 0; i < length; i++) { const d = Object.getOwnPropertyDescriptor(rowKeys, String(i)); check(d && own(d, 'value') && typeof d.value === 'string' && !seen.has(d.value)); seen.add(d.value); }
    validDefinitions(get(value, 'modelColumns'));
  }
  function unknown(module, reason) { return { schemaVersion: SCHEMA_VERSION, module: ['cp', 'orders'].includes(module) ? module : null, status: 'unknown', rowCount: null, rowKeys: null, modelColumns: null, reason }; }
  function create(options = {}) {
    const optionKeys = plainKeys(options); check(optionKeys.every(key => ['maxPublicBytes', 'maxRowKeys'].includes(key)));
    const maxPublicBytes = own(options, 'maxPublicBytes') ? get(options, 'maxPublicBytes') : MAX_PUBLIC_BYTES;
    const maxRowKeys = own(options, 'maxRowKeys') ? get(options, 'maxRowKeys') : MAX_ROW_KEYS;
    check(Number.isSafeInteger(maxPublicBytes) && maxPublicBytes >= 4 && maxPublicBytes <= MAX_PUBLIC_BYTES
      && Number.isSafeInteger(maxRowKeys) && maxRowKeys > 0 && maxRowKeys <= MAX_ROW_KEYS);
    function build(input) {
      try {
        check(plainKeys(input).every(key => ['module', 'rows', 'modelColumns', 'modelSchemaKnown', 'canExpose', 'scopePolicy'].includes(key)));
        const module = get(input, 'module'); check(['cp', 'orders'].includes(module));
        if (get(input, 'modelSchemaKnown') !== true || get(input, 'canExpose') !== true) return null;
        const policy = get(input, 'scopePolicy'); check(plainKeys(policy).every(key => ['schemaSource', 'targetKnown', 'bindingsKnown', 'cpSchemaAllowed', 'sameRows', 'sameAntrepo'].includes(key)));
        if (get(policy, 'targetKnown') !== true || get(policy, 'bindingsKnown') !== true || get(policy, 'cpSchemaAllowed') !== true) return null;
        const source = get(policy, 'schemaSource');
        if (source !== 'target' && !(module === 'orders' && source === 'shared-cp' && get(policy, 'sameRows') === true && get(policy, 'sameAntrepo') === true)) return null;
        const definitions = get(input, 'modelColumns'); check(dense(definitions) <= Math.floor(maxPublicBytes / 2));
        const rows = get(input, 'rows'), count = dense(rows), rowKeys = [], seen = new Set();
        for (let i = 0; i < count; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(rows, String(i)); check(descriptor && own(descriptor, 'value')); const row = descriptor.value;
          check(row && typeof row === 'object' && !(isProxy && isProxy(row)) && !Array.isArray(row) && [Object.prototype, null].includes(Object.getPrototypeOf(row)));
          const hook = Object.getOwnPropertyDescriptor(row, 'toJSON'); check(!hook || (own(hook, 'value') && typeof hook.value !== 'function'));
          for (const key of Object.keys(row)) {
            const d = Object.getOwnPropertyDescriptor(row, key); check(d && own(d, 'value'));
            if (!seen.has(key)) { check(rowKeys.length < maxRowKeys); seen.add(key); rowKeys.push(key); }
          }
        }
        const schema = { schemaVersion: SCHEMA_VERSION, module, status: 'known', rowCount: count, rowKeys, modelColumns: definitions };
        // Definitions are bounded/copied once; raw row graphs and Dates remain caller-owned.
        const output = publicCopy(schema, maxPublicBytes); knownShape(output, module, maxRowKeys); return output;
      } catch (_) { return null; }
    }
    function read(value, expectedModule) {
      if (!['cp', 'orders'].includes(expectedModule)) return unknown(null, 'module');
      if (value === undefined || value === null) return unknown(expectedModule, 'missing');
      try {
        plainKeys(value);
        if (get(value, 'schemaVersion') !== SCHEMA_VERSION) return unknown(expectedModule, 'version');
        if (get(value, 'module') !== expectedModule) return unknown(expectedModule, 'module');
        if (get(value, 'status') !== 'known') return unknown(expectedModule, 'not-known');
        const output = publicCopy(value, maxPublicBytes); knownShape(output, expectedModule, maxRowKeys); return output;
      } catch (_) { return unknown(expectedModule, 'malformed-or-budget'); }
    }
    return Object.freeze({ build, read });
  }
  return Object.freeze({ SCHEMA_VERSION, MAX_PUBLIC_BYTES, MAX_ROW_KEYS, create, ...create() });
});
