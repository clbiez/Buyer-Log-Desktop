(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('node:util').types.isProxy);
  else root.BLOrdersFiniteClosure = factory(null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (isProxy) {
  'use strict';
  // Inactive candidate. compile reads the COMPLETE full snapshot, never a sample.
  // compileSchema is private to a caller that already verified the server's
  // owner/access/generation/full-SHA binding and complete producer attributes.
  // Schema/guards/token strings do not authenticate or authorize that caller.
  const REVISION = 'orders-hidden-model-closure-v1';
  const BARRIERS = Object.freeze(['public-row-providers', 'details', 'ai-export', 'collection-bridge',
    'manufacturers-price', 'formula-editor-and-column-changes', 'global-flow']);
  const TOKEN_KEYS = ['ownerId','actorId','module','sourceGeneration','sourceRevision','moduleInputKey',
    'sourceProjectionKey','accessHash','contextHash','planRevision','requestGeneration'];
  const GUARDS = Object.freeze({ consumerClosure: REVISION, predicates: 'literal-keys-only-v1',
    canonicalReads: 'all-binding-token-matches-v1', migration: 'settled-on-full-v1', formulaStorageKnown: true,
    operationsKnown: true, traceDerived: false });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const check = (ok, reason) => { if (!ok) throw Object.assign(new Error(reason), { code: reason }); };
  const word = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
  function keys(value) {
    check(value && typeof value === 'object' && !(isProxy && isProxy(value)) && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'UNSUPPORTED_OBJECT');
    const result = Reflect.ownKeys(value);
    for (const key of result) { const d = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && d.enumerable && own(d, 'value'), 'UNSUPPORTED_OBJECT'); }
    return result;
  }
  function list(value, max = 512) {
    check(Array.isArray(value) && !(isProxy && isProxy(value)) && value.length <= max
      && Reflect.ownKeys(value).length === value.length + 1, 'UNSUPPORTED_ARRAY');
    const out = [];
    for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i));
      check(d && own(d, 'value'), 'UNSUPPORTED_ARRAY'); out.push(d.value); }
    return out;
  }
  function names(value) { const out = list(value); check(out.every(word) && new Set(out).size === out.length, 'INVALID_KEYS'); return out; }
  function snapshot(value, state = { nodes: 0, ancestors: new WeakSet() }, depth = 0) {
    check(++state.nodes <= 50000 && depth <= 24, 'CONTEXT_TOO_LARGE');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { check(value.length <= 32768, 'CONTEXT_TOO_LARGE'); return value; }
    if (typeof value === 'number') { check(Number.isFinite(value), 'INVALID_CONTEXT'); return value; }
    check(value && typeof value === 'object' && !state.ancestors.has(value), 'INVALID_CONTEXT');
    const array = Array.isArray(value), entries = array ? list(value, 4096).map((v, i) => [String(i), v]) : keys(value).map(k => [k, value[k]]);
    const out = array ? [] : {}; state.ancestors.add(value);
    try { for (const [k, v] of entries) Object.defineProperty(out, k, { value: snapshot(v, state, depth + 1), enumerable: true }); }
    finally { state.ancestors.delete(value); }
    return Object.freeze(out);
  }
  const sameMembers = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  function createOrdersFiniteClosure({ canonical, formulaEngine, formulaColumns, dependencyPlan, inventory, inventoryRef }) {
    check(canonical && typeof canonical.token === 'function' && typeof canonical.canonicalId === 'function'
      && formulaColumns && typeof formulaColumns.columnIndex === 'function' && dependencyPlan, 'ACTUAL_RUNTIMES_REQUIRED');
    function compileCore(capturedContext, producer) {
      try {
        const context = snapshot(capturedContext);
        check(JSON.stringify(context).length <= 262144, 'CONTEXT_TOO_LARGE');
        check(keys(context).length === 10 && ['token','schema','columns','hiddenKeys','filterKeys','sortKeys','ruleKeys','operationKeys','guards','fullBeforeUse'].every(k => own(context, k)), 'UNKNOWN_CONTEXT');
        const token = context.token;
        check(keys(token).length === 11 && TOKEN_KEYS.every(k => own(token, k) && word(token[k])) && token.module === 'orders', 'ORDERS_ONLY');
        check(keys(context.guards).length === Object.keys(GUARDS).length
          && Object.keys(GUARDS).every(k => context.guards[k] === GUARDS[k]), 'UNKNOWN_CONSUMER_OR_MIGRATION');
        check(sameMembers(names(context.fullBeforeUse), BARRIERS), 'UNPROVEN_FULL_BARRIER');
        const schema = context.schema;
        check(keys(schema).length === 6 && ['schemaVersion','module','status','rowCount','rowKeys','modelColumns'].every(k => own(schema, k))
          && schema.schemaVersion === 1 && schema.module === 'orders' && schema.status === 'known'
          && Number.isSafeInteger(schema.rowCount) && schema.rowCount >= 0 && schema.rowCount <= 200000, 'UNKNOWN_OR_DIFFERENT_SCHEMA');
        const schemaKeys = names(schema.rowKeys);
        check(schema.rowCount !== 0 || schemaKeys.length === 0, 'UNKNOWN_OR_DIFFERENT_SCHEMA');
        if (producer) check(schema.rowCount === producer.rowCount && sameMembers(schemaKeys, producer.rawKeys), 'UNKNOWN_OR_DIFFERENT_SCHEMA');
        // No fabricated rows: metadata mode uses the verified complete producer
        // universe directly; full mode preserves its actual first-seen order.
        const rawKeys = producer ? producer.rawKeys : schemaKeys, raw = new Set(rawKeys);
        const model = new Map();
        for (const definition of list(schema.modelColumns)) { keys(definition);
          check(word(definition.id) && word(definition.header) && word(definition.label) && !model.has(definition.header), 'UNREGISTERED_MODEL_SCHEMA');
          model.set(definition.header, definition); }
        const columns = list(context.columns), registered = new Set(), hidden = new Set(names(context.hiddenKeys)), seen = new Set();
        const index = formulaColumns.columnIndex('orders');
        for (const column of columns) { keys(column); check(word(column.k) && !seen.has(column.k), 'UNKNOWN_COLUMNS'); seen.add(column.k);
          if (column.modelCustom !== true) continue;
          const definition = model.get(column.k), actual = index.byKey.get(column.k);
          check(definition && definition.id === column.modelColumnId && definition.label === column.label
            && actual && actual.kind === 'model' && actual.name === String(column.label).trim(), 'MODEL_RUNTIME_DRIFT');
          if (column.k.startsWith('__CPX_') && hidden.has(column.k)) registered.add(column.k);
        }
        // Check reverse membership too: a hidden model column cannot disappear from the capture.
        for (const [key, entry] of index.byKey) if (entry.kind === 'model') check(seen.has(key), 'MODEL_RUNTIME_DRIFT');
        for (const key of model.keys()) check(seen.has(key), 'MODEL_RUNTIME_DRIFT');
        const tokens = new Set(), bindingsBefore = [];
        for (const id of Object.keys(canonical.fields)) {
          const binding = canonical.bindingFor('orders', id);
          if (!binding) continue;
          const bindingKeys = names(binding.keys); bindingKeys.forEach(k => tokens.add(canonical.token(k)));
          bindingsBefore.push([id, binding.semantic, bindingKeys]);
        }
        // Keep EVERY raw token match, including later/blank aliases; never infer the chosen value from a row sample.
        const base = rawKeys.filter(key => !registered.has(key) || tokens.has(canonical.token(key)) || canonical.canonicalId('orders', key));
        const definitions = snapshot(formulaColumns.definitions('orders'));
        const formulaStamp = JSON.stringify(definitions);
        const mapping = { base:['C01','C02','C03'], filters:['C04'], sort:['C05'], formulas:['C06'],
          rules:['C07','C10'], operations:['C11','C12','C13'], full:['C08','C09','C14','C15'] };
        const rawDemand = { base, filters:names(context.filterKeys), sort:names(context.sortKeys),
          rules:names(context.ruleKeys), operations:names(context.operationKeys) };
        const adapters = Object.entries(mapping).map(([id, contractIds]) => ({ id, revision: REVISION, contractIds,
          guaranteesFullBeforeUse: id === 'full',
          declare(request) { return id === 'full' ? { contextKey: request.contextKey, revision: REVISION, mode:'full-before-use' }
            : { contextKey: request.contextKey, revision: REVISION, mode:'finite', enumeration:false, tokenFallback:false,
              rawKeys:rawDemand[id] || [], canonicalIds:[], formulas:id === 'formulas' ? definitions : null }; },
          resolveFormulaReference(name, { request, definitions: defs }) {
            const normalized = String(name).trim().toLocaleLowerCase('tr-TR');
            const alias = formulaColumns.aliasMap(defs).get(normalized);
            const formulaIds = defs.filter(def => formulaColumns.columnKey(def) === name || formulaColumns.columnKey(def) === alias).map(def => def.id);
            const modelKey = index.model.get(normalized), exact = index.byKey.get(name);
            const rawKeys = [...new Set([modelKey, exact && exact.kind === 'model' ? name : null].filter(Boolean))];
            return { mode:raw.has(name) || rawKeys.length || formulaIds.length ? 'finite' : 'unresolved',
              contextKey:request.contextKey, lookup:'own-formula-model-v1', rawKeys, formulaIds };
          } }));
        const manifest = { version:1, module:'orders', revision:REVISION,
          consumers:adapters.map(a => ({id:a.id,revision:a.revision,contractIds:a.contractIds})) };
        const compiler = dependencyPlan.createCompiler({ canonical, formulaEngine, inventory, inventoryRef, manifest, adapters });
        const result = compiler.compile({ module:'orders', contextKey:token.contextHash, planRevision:token.planRevision,
          requestGeneration:token.requestGeneration, coverage:{kind:'reviewed-adapter-closure', manifestRevision:REVISION,
            contextKey:token.contextHash, consumerIds:adapters.map(a => a.id)},
          producer:{kind:'producer-contract', wholeContext:true, traceDerived:false, revision:token.sourceRevision,
            contextKey:token.contextHash, rawKeys, canonicalModes:{}}, state:{} });
        check(result.supported, result.reason || 'OPEN_CLOSURE');
        check(JSON.stringify(formulaColumns.definitions('orders')) === formulaStamp, 'FORMULA_SETTINGS_CHANGED');
        for (const [id, semantic, bindingKeys] of bindingsBefore) { const binding = canonical.bindingFor('orders', id);
          check(binding && binding.semantic === semantic && JSON.stringify(binding.keys) === JSON.stringify(bindingKeys), 'CANONICAL_BINDING_CHANGED'); }
        const wanted = new Set(result.fields), omittedKeys = rawKeys.filter(key => registered.has(key) && !wanted.has(key));
        check(omittedKeys.every(key => !base.includes(key)), 'PROTECTED_FIELD_OMISSION');
        return Object.freeze({ supported:true, profile:REVISION, module:'orders', token,
          fields:Object.freeze(rawKeys.filter(key => !omittedKeys.includes(key))), omittedKeys:Object.freeze(omittedKeys),
          protectedCanonicalIds:result.protectedCanonicalIds, inventoryRef:result.inventoryRef,
          fullBeforeUse:BARRIERS, authority:'server-certification-and-caller-barriers-required' });
      } catch (error) { return Object.freeze({ supported:false, mode:'full', reason:error && error.code || 'UNSUPPORTED_CONTEXT' }); }
    }
    function compile(fullEnvelope, capturedContext) {
      try {
        keys(fullEnvelope); check((!own(fullEnvelope, 'profile') || fullEnvelope.profile === 'full')
          && !['mode','token','completeness'].some(k => own(fullEnvelope, k)), 'NOT_LEGACY_FULL');
        const rows = list(fullEnvelope.rows, 200000), raw = new Set();
        for (const row of rows) { for (const key of keys(row)) { check(word(key), 'INVALID_RAW_KEY'); raw.add(key); }
          check(raw.size <= 512, 'KEY_UNIVERSE_TOO_LARGE'); }
        return compileCore(capturedContext, { rowCount:rows.length, rawKeys:[...raw] });
      } catch (error) { return Object.freeze({ supported:false, mode:'full', reason:error && error.code || 'UNSUPPORTED_CONTEXT' }); }
    }
    // PRECONDITION: capturedContext.schema is a verified OWN Orders producer
    // schema bound by the real server to this exact owner/access/generation and
    // full JSON SHA. No verification, flags-as-authority or network fetch here.
    function compileSchema(capturedContext) { return compileCore(capturedContext); }
    return Object.freeze({ compile, compileSchema, select(full, context) { const result = compile(full, context); return result.supported ? result : full; } });
  }
  return Object.freeze({ createOrdersFiniteClosure, REVISION, BARRIERS, GUARDS });
});
