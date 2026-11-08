(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLProjectionDependencyPlan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Inactive pure candidate. No rows, DOM, storage, network or sample traces are read.
  const PROFILE = 'cp-orders-finite-demand-candidate-v1';
  const INVENTORY_HEAD = '5736f3370fb55bbd62414585956ca8c53d37ce82';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function fail(code) { const error = new Error(code); error.code = code; throw error; }
  function check(ok, code) { if (!ok) fail(code); }
  function data(object) {
    check(object && typeof object === 'object' && !Array.isArray(object), 'INVALID_DECLARATION');
    const prototype = Object.getPrototypeOf(object);
    check(prototype === Object.prototype || prototype === null, 'INVALID_DECLARATION');
    for (const key of Reflect.ownKeys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      check(typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value'), 'INVALID_DECLARATION');
    }
    return object;
  }
  function names(value, code = 'INVALID_DECLARATION') {
    check(Array.isArray(value) && value.length <= 8192 && Object.keys(value).length === value.length, code);
    check(value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 512), code);
    check(new Set(value).size === value.length, code); return value;
  }
  function nonempty(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
  function sameList(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
  function snapshot(value, state = { nodes: 0, seen: new WeakSet() }, depth = 0) {
    check(++state.nodes <= 50000 && depth <= 24, 'DECLARATION_TOO_LARGE');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { check(value.length <= 1000000, 'DECLARATION_TOO_LARGE'); return value; }
    if (typeof value === 'number') { check(Number.isFinite(value), 'INVALID_DECLARATION'); return value; }
    check(value && typeof value === 'object' && !state.seen.has(value), 'INVALID_DECLARATION'); state.seen.add(value);
    const array = Array.isArray(value), result = array ? [] : {};
    if (array) check(Reflect.ownKeys(value).length === value.length + 1, 'INVALID_DECLARATION'); else data(value);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value')
        && (!array || /^(0|[1-9]\d*)$/.test(key)), 'INVALID_DECLARATION');
      Object.defineProperty(result, key, { value: snapshot(descriptor.value, state, depth + 1), enumerable: true });
    }
    return Object.freeze(result);
  }
  const contractId = value => /^C(?:0[1-9]|1[0-5])$/.test(value);
  function createCompiler({ canonical, formulaEngine, inventory, inventoryRef, manifest, adapters } = {}) {
    check(canonical && typeof canonical.field === 'function' && typeof canonical.bindingFor === 'function', 'CANONICAL_RUNTIME_REQUIRED');
    check(formulaEngine && typeof formulaEngine.compile === 'function' && typeof formulaEngine.analyze === 'function' && formulaEngine.FUNCTIONS, 'FORMULA_RUNTIME_REQUIRED');
    check(inventoryRef && inventoryRef.pr === 891 && inventoryRef.head === INVENTORY_HEAD, 'AUTHORITATIVE_INVENTORY_REQUIRED');
    check(inventory && Array.isArray(inventory.fields) && inventory.fields.length === 42, 'AUTHORITATIVE_INVENTORY_REQUIRED');
    const protectedIds = [], counts = new Map();
    for (const field of inventory.fields) {
      data(field); check(nonempty(field.canonicalId) && field.removable === false, 'INVENTORY_NOT_REMOVABLE');
      check(['ince satırda gerekli', 'belirsiz'].includes(field.classification), 'INVENTORY_NOT_REMOVABLE'); // i18n-ignore
      protectedIds.push(field.canonicalId); counts.set(field.classification, (counts.get(field.classification) || 0) + 1);
    }
    check(new Set(protectedIds).size === 42 && counts.get('ince satırda gerekli') === 32 && counts.get('belirsiz') === 10, 'AUTHORITATIVE_INVENTORY_REQUIRED'); // i18n-ignore
    manifest = snapshot(manifest); check(manifest.version === 1 && nonempty(manifest.revision) && ['cp','orders'].includes(manifest.module), 'INVALID_MANIFEST');
    check(Array.isArray(manifest.consumers) && manifest.consumers.length > 0 && manifest.consumers.length <= 256 && Array.isArray(adapters), 'INVALID_MANIFEST');
    const registered = new Map(), expected = new Map(), coveredContracts = new Set();
    for (const adapter of adapters) {
      data(adapter);
      check(adapter && nonempty(adapter.id) && nonempty(adapter.revision) && typeof adapter.declare === 'function' && !registered.has(adapter.id), 'INVALID_ADAPTER');
      names(adapter.contractIds); check(adapter.contractIds.every(contractId), 'INVALID_ADAPTER');
      registered.set(adapter.id, Object.freeze({ id: adapter.id, revision: adapter.revision,
        contractIds: Object.freeze([...adapter.contractIds]), declare: adapter.declare,
        resolveFormulaReference: adapter.resolveFormulaReference, guaranteesFullBeforeUse: adapter.guaranteesFullBeforeUse === true }));
    }
    for (const consumer of manifest.consumers) {
      data(consumer); check(nonempty(consumer.id) && nonempty(consumer.revision) && !expected.has(consumer.id), 'INVALID_MANIFEST');
      names(consumer.contractIds); check(consumer.contractIds.every(contractId), 'INVALID_MANIFEST');
      const adapter = registered.get(consumer.id);
      check(adapter && adapter.revision === consumer.revision && sameList(adapter.contractIds, consumer.contractIds), 'MISSING_CONSUMER_ADAPTER');
      expected.set(consumer.id, consumer); consumer.contractIds.forEach(id => coveredContracts.add(id));
    }
    check(registered.size === expected.size, 'UNKNOWN_CONSUMER_ADAPTER');
    // Closure declarations cover the existing reviewed contracts, not a new consumer/field inventory.
    for (let number = 1; number <= 15; number++) check(coveredContracts.has('C' + String(number).padStart(2,'0')), 'OPEN_CONSUMER_CLOSURE');

    function compile(request) {
      try {
        request = snapshot(request);
        check(Object.keys(request).every(key => ['module','contextKey','planRevision','requestGeneration','coverage','producer','state'].includes(key)), 'UNKNOWN_CONTEXT_MEMBER');
        check(request.module === manifest.module && nonempty(request.contextKey) && nonempty(request.planRevision)
          && nonempty(request.requestGeneration), 'INVALID_CONTEXT');
        data(request.coverage);
        check(request.coverage.kind === 'reviewed-adapter-closure' && request.coverage.manifestRevision === manifest.revision
          && request.coverage.contextKey === request.contextKey, 'OPEN_CONSUMER_CLOSURE');
        const consumers = names(request.coverage.consumerIds);
        check(consumers.length === expected.size && consumers.every(id => expected.has(id)), 'UNKNOWN_OR_MISSING_CONSUMER');
        const proof = data(request.producer);
        check(proof.kind === 'producer-contract' && proof.wholeContext === true && proof.contextKey === request.contextKey
          && nonempty(proof.revision) && proof.traceDerived === false, 'SAMPLE_OR_UNKNOWN_PROOF');
        const producerKeys = new Set(names(proof.rawKeys)), canonicalModes = data(proof.canonicalModes);
        const fields = new Set(), usedContracts = new Set(), deferred = [], bindingSnapshots = new Map();
        const add = key => { check(nonempty(key), 'UNRESOLVED_RAW_KEY'); fields.add(key); check(fields.size <= 8192, 'PLAN_TOO_LARGE'); };
        // Preserve every #891 required/uncertain canonical family's runtime binding keys.
        // This is conservative per-plan retention, never a global removability classification.
        add('__canonical');
        for (const id of protectedIds) {
          check(canonical.field(id), 'CANONICAL_REGISTRY_DRIFT');
          const binding = canonical.bindingFor(request.module, id);
          bindingSnapshots.set(id, binding ? { keys: [...names(binding.keys)], semantic: binding.semantic } : null);
          if (binding) binding.keys.forEach(add);
        }
        function canonicalDemand(id) {
          check(protectedIds.includes(id) && canonical.field(id), 'UNRESOLVED_CANONICAL_ID');
          const binding = canonical.bindingFor(request.module, id); check(binding && Array.isArray(binding.keys), 'MISSING_MODULE_BINDING');
          const mode = data(canonicalModes[id]);
          check(mode.contextKey === request.contextKey && mode.producerRevision === proof.revision, 'UNKNOWN_CANONICAL_PATH');
          if (mode.mode === 'own-canonical-override') {
            check(mode.everyRowOwnOverride === true, 'UNKNOWN_CANONICAL_PATH'); add('__canonical');
          } else {
            // The actual reader otherwise enumerates tokens after a missing exact key.
            check(mode.mode === 'own-first-nonblank' && mode.key === binding.keys[0]
              && mode.everyRowOwn === true && mode.everyRowNonBlank === true && mode.canonicalOverrideAbsent === true
              && producerKeys.has(mode.key), 'TOKEN_OR_DYNAMIC_CANONICAL_PATH');
          }
          binding.keys.forEach(add);
        }
        function formulaDemand(adapter, definitions) {
          check(Array.isArray(definitions) && definitions.length <= 30 && typeof adapter.resolveFormulaReference === 'function', 'UNSUPPORTED_FORMULA_ADAPTER');
          const byId = new Map();
          for (const definition of definitions) {
            data(definition); check(nonempty(definition.id) && typeof definition.formula === 'string' && definition.formula.length <= 32768 && !byId.has(definition.id), 'UNRESOLVED_FORMULA');
            byId.set(definition.id, definition);
          }
          const visiting = new Set(), done = new Set();
          function walk(id) {
            check(byId.has(id) && !visiting.has(id), 'UNRESOLVED_OR_CYCLIC_FORMULA'); if (done.has(id)) return;
            visiting.add(id); const definition = byId.get(id), program = formulaEngine.compile(definition.formula);
            check(program && program.ok && Array.isArray(program.columns), 'INVALID_FORMULA');
            check(formulaEngine.analyze(definition.formula, { autoFix: false, resolve: () => true }).ok === true, 'INVALID_FORMULA');
            function inspect(node) {
              if (!node || typeof node !== 'object') return;
              if (node.kind === 'call') {
                const fn = formulaEngine.FUNCTIONS[node.name];
                check(fn && node.args.length >= fn.min && node.args.length <= fn.max, 'UNSUPPORTED_FORMULA_FUNCTION');
              }
              for (const key of ['left','right','argument']) if (node[key]) inspect(node[key]);
              if (Array.isArray(node.args)) node.args.forEach(inspect);
            }
            inspect(program.ast);
            // Actual compile.columns includes all lazy branches, not just observed reads.
            for (const reference of program.columns) {
              const resolved = snapshot(adapter.resolveFormulaReference(reference, { request, definition, definitions }));
              check(resolved.mode === 'finite' && resolved.contextKey === request.contextKey && resolved.lookup === 'own-formula-model-v1', 'UNRESOLVED_FORMULA_REFERENCE');
              const rawKeys = names(resolved.rawKeys), formulaIds = names(resolved.formulaIds);
              check(producerKeys.has(reference) || rawKeys.length > 0 || formulaIds.length > 0, 'UNRESOLVED_FORMULA_REFERENCE');
              // Preserve own-name > formula alias > model alias without deciding from sample rows.
              add(reference); rawKeys.forEach(key => { check(producerKeys.has(key), 'UNRESOLVED_MODEL_KEY'); add(key); });
              formulaIds.forEach(walk);
            }
            visiting.delete(id); done.add(id);
          }
          definitions.forEach(definition => walk(definition.id));
        }
        for (const id of consumers) {
          const adapter = registered.get(id), declaration = snapshot(adapter.declare(request));
          expected.get(id).contractIds.forEach(value => usedContracts.add(value));
          check(declaration.contextKey === request.contextKey && declaration.revision === adapter.revision, 'STALE_CONSUMER_DECLARATION');
          if (declaration.mode === 'full-before-use') {
            check(adapter.guaranteesFullBeforeUse === true, 'UNPROVEN_FULL_BARRIER'); deferred.push(id); continue;
          }
          check(declaration.mode === 'finite' && declaration.enumeration === false && declaration.tokenFallback === false, 'DYNAMIC_CONSUMER');
          check(Object.keys(declaration).every(key => ['contextKey','revision','mode','enumeration','tokenFallback','rawKeys','canonicalIds','formulas'].includes(key)), 'UNKNOWN_DECLARATION_MEMBER');
          names(declaration.rawKeys).forEach(key => { check(producerKeys.has(key), 'UNRESOLVED_RAW_KEY'); add(key); });
          names(declaration.canonicalIds).forEach(canonicalDemand);
          if (declaration.formulas !== null) formulaDemand(adapter, declaration.formulas);
        }
        for (const [id, binding] of bindingSnapshots) {
          const current = canonical.bindingFor(request.module, id);
          check(binding ? current && current.semantic === binding.semantic && sameList(current.keys, binding.keys) : !current, 'CANONICAL_BINDING_CHANGED');
        }
        return Object.freeze({ supported: true, profile: PROFILE, mode: 'candidate', version: 1,
          module: request.module, contextKey: request.contextKey, planRevision: request.planRevision, requestGeneration: request.requestGeneration,
          fields: Object.freeze([...fields]), knownAbsenceKeys: Object.freeze([...fields]),
          protectedCanonicalIds: Object.freeze([...protectedIds]), consumerIds: Object.freeze([...consumers]), deferredConsumers: Object.freeze(deferred),
          inventoryRef: Object.freeze({ pr: 891, head: INVENTORY_HEAD }), contractIds: Object.freeze([...usedContracts]),
          authority: 'server-certification-still-required' });
      } catch (error) { return Object.freeze({ supported: false, mode: 'full', reason: error && error.code || 'UNSUPPORTED_CONTEXT' }); }
    }
    return Object.freeze({ compile, select(fullEnvelope, request) { const result = compile(request); return result.supported ? result : fullEnvelope; } });
  }
  return Object.freeze({ createCompiler, PROFILE, INVENTORY_HEAD });
});
