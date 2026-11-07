'use strict';
// Offline, source-only audit. Never starts Buyer Log or reads a data directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
let acorn;
try { acorn = require('acorn'); }
catch { acorn = require('internal/deps/acorn/acorn/dist/acorn'); }
const here = __dirname;
const root = path.resolve(here, '../../..');
const app = path.join(root, 'resources/app');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const registry = require(path.join(app, 'server/lib/canonical-fields.js'));
const UNKNOWN = Symbol('unknown');
const classes = ['ince satırda gerekli', 'tembel detay adayı', 'belirsiz'];
const usages = ['gösterim', 'filtre', 'sıralama', 'hesap', 'export/AI'];
const unique = xs => [...new Set(xs)];
function children(node) {
  return Object.entries(node).flatMap(([key, value]) => key === 'loc' ? [] :
    Array.isArray(value) ? value.filter(v => v && typeof v.type === 'string') :
      value && typeof value.type === 'string' ? [value] : []);
}
function analyze(source, file) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true, allowHashBang: true });
  const nodes = [], parents = new Map(), scopes = new Map(), owners = new Map();
  function bindUnknown(pattern, scope) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') scope.defs.set(pattern.name, null);
    else for (const child of children(pattern)) bindUnknown(child, scope);
  }
  function visit(node, parent, scope, owner) {
    if (parent) parents.set(node, parent);
    if (/Function/.test(node.type)) {
      const name = node.id?.name || (parent?.type === 'VariableDeclarator' ? parent.id.name :
        parent?.type === 'Property' ? parent.key.name || parent.key.value : null);
      owner = name ? (owner ? owner + '/' : '') + name : owner || '<callback>';
    }
    if (node.type === 'Program' || node.type === 'BlockStatement' || /Function/.test(node.type)) scope = { parent: scope, defs: new Map() };
    scopes.set(node, scope); owners.set(node, owner || '<module>'); nodes.push(node);
    if (/Function/.test(node.type)) node.params.forEach(param => bindUnknown(param, scope));
    if (node.type === 'CatchClause') bindUnknown(node.param, scope);
    if (node.type === 'VariableDeclarator') {
      if (node.id.type === 'Identifier') scope.defs.set(node.id.name, parent?.kind === 'const' ? node.init : null);
      else bindUnknown(node.id, scope);
    }
    for (const child of children(node)) visit(child, node, scope, owner);
  }
  visit(ast, null, null, '');
  const text = node => source.slice(node.start, node.end);
  function evaluate(node, depth = 0, scope = scopes.get(node)) {
    if (!node || depth > 12) return UNKNOWN;
    if (node.type === 'ChainExpression') return evaluate(node.expression, depth + 1, scope);
    if (node.type === 'Literal') return node.regex ? UNKNOWN : node.value;
    if (node.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
    if (node.type === 'Identifier') {
      for (let s = scope; s; s = s.parent) if (s.defs.has(node.name)) return evaluate(s.defs.get(node.name), depth + 1);
    }
    if (node.type === 'ArrayExpression') {
      const values = node.elements.map(n => evaluate(n, depth + 1, scope));
      return values.includes(UNKNOWN) ? UNKNOWN : values;
    }
    if (node.type === 'ObjectExpression') {
      const value = Object.create(null);
      for (const prop of node.properties) {
        if (prop.type !== 'Property') continue;
        const key = prop.computed ? evaluate(prop.key, depth + 1, scope) : prop.key.name ?? prop.key.value;
        if (typeof key === 'string') value[key] = evaluate(prop.value, depth + 1, scope);
      }
      return value;
    }
    if (node.type === 'CallExpression' && text(node.callee) === 'Object.freeze') return evaluate(node.arguments[0], depth + 1, scope);
    if (node.type === 'MemberExpression') {
      const object = evaluate(node.object, depth + 1, scope);
      const key = node.computed ? evaluate(node.property, depth + 1, scope) : node.property.name;
      if (object !== UNKNOWN && object != null && key !== UNKNOWN && Object.hasOwn(object, key)) return object[key];
    }
    return UNKNOWN;
  }
  function location(node) {
    return { file, line: node.loc.start.line, column: node.loc.start.column + 1, function: owners.get(node), expression: text(node).slice(0, 240) };
  }
  function useTypes(node) {
    const context = owners.get(node) + ' ' + file;
    const out = [];
    if (/filter|search|passes|matches|predicate|facet|query|scope|horizon/i.test(context)) out.push('filtre');
    if (/sort|compare|rank|chronolog/i.test(context)) out.push('sıralama');
    if (/export|copy|plainText|matrix|tsv|csv|excel|lcwai|aiContext|contextProvider|output.source/i.test(context)) out.push('export/AI');
    if (/compute|calc|formula|rule|analy|readiness|decision|checklist|priority|summar|measure|total|average|business|buildOrder|logistic|freight|royalty/i.test(context)) out.push('hesap');
    if (/render|cell|html|display|label|image|detail|view|draw|column/i.test(context)) out.push('gösterim');
    return out.length ? out : [];
  }
  function rowLike(node) {
    const receiver = text(node);
    return /^(r|o|row|order|raw|record|rec|source|sourceRow|item|hit|candidate|segment|a|b|left|right|current|incoming|ias)(\b|\[|\.)/i.test(receiver) || /\b(?:cp|orders|sourceRows|rows)\b.*\[/.test(receiver);
  }
  function isWrite(node) {
    const p = parents.get(node);
    return p?.type === 'AssignmentExpression' && p.left === node && p.operator === '=' || p?.type === 'UnaryExpression' && p.operator === 'delete';
  }
  const accesses = [], dynamics = [], declarations = [];
  const canonicalObject = node => /(?:BLCanonicalFields|canonicalFields|canonical|fields|CF|C)$/.test(text(node));
  const methods = new Set(['value', 'canonicalValue', 'normalizedValue', 'project', 'keyFor', 'joinRows', 'enrichRow']);
  for (const node of nodes) {
    if (node.type === 'MemberExpression' && rowLike(node.object) && !isWrite(node)) {
      const key = node.computed ? evaluate(node.property) : node.property.name;
      let p = parents.get(node), fallback = null;
      while (p && p.type !== 'Statement' && !/Function|Statement|Declaration/.test(p.type)) {
        if (p.type === 'LogicalExpression' && ['||', '??'].includes(p.operator)) fallback = { operator: p.operator, expression: text(p).slice(0, 500) };
        p = parents.get(p);
      }
      const record = { ...location(node), usageTypes: useTypes(node), evidence: 'syntactic-row-candidate', ...(fallback ? { fallback } : {}) };
      if (typeof key === 'string') accesses.push({ ...record, kind: 'member-read', rawKey: key });
      else if (node.computed) {
        const keyObject = node.property.type === 'MemberExpression' ? evaluate(node.property.object) : UNKNOWN;
        const possibleRawKeys = Array.isArray(keyObject) && keyObject.every(v => typeof v === 'string') ? unique(keyObject) : [];
        dynamics.push({ ...record, kind: 'computed-member', keyExpression: text(node.property), possibleRawKeys, canonicalId: null, classification: 'belirsiz', removable: false });
        for (const rawKey of possibleRawKeys) accesses.push({ ...record, kind: 'finite-key-member-candidate', rawKey, evidence: 'literal-array-expanded-at-read' });
      }
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init && rowLike(node.init)) {
      for (const prop of node.id.properties) if (prop.type === 'Property') {
        const key = prop.computed ? evaluate(prop.key) : prop.key.name ?? prop.key.value;
        if (typeof key === 'string') accesses.push({ ...location(prop), kind: 'destructure-read', rawKey: key, usageTypes: useTypes(prop), evidence: 'syntactic-row-candidate' });
      }
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
      if (callee.type === 'MemberExpression' && canonicalObject(callee.object) && methods.has(callee.property.name)) {
        const method = callee.property.name, moduleId = evaluate(node.arguments[1]), ids = evaluate(node.arguments[2]);
        const list = typeof ids === 'string' ? [ids] : Array.isArray(ids) ? ids : [];
        if (list.length && ['value', 'canonicalValue', 'normalizedValue', 'project', 'keyFor'].includes(method)) {
          for (const ref of list) if (typeof ref === 'string') accesses.push({ ...location(node), kind: 'canonical-call', ref, moduleId: typeof moduleId === 'string' ? moduleId : null, usageTypes: useTypes(node), evidence: 'explicit-canonical-call' });
        } else dynamics.push({ ...location(node), kind: 'dynamic-canonical-call', moduleExpression: node.arguments[1] ? text(node.arguments[1]) : '',
          fieldExpression: ['joinRows', 'enrichRow'].includes(method) ? 'options.fields/profile/matchFields; see argumentExpressions' : node.arguments[2] ? text(node.arguments[2]) : '<all registry fields>',
          argumentExpressions: node.arguments.map(text), usageTypes: useTypes(node), canonicalId: null, classification: 'belirsiz', removable: false });
      }
      if (/^Object\.(keys|values|entries|assign)$/.test(text(node.callee)) && node.arguments.some(rowLike)) dynamics.push({ ...location(node), kind: 'whole-object-enumeration-or-copy', usageTypes: useTypes(node), canonicalId: null, classification: 'belirsiz', removable: false });
      // Shared reader wrappers: read(row,F.qty), rowText(row,'x'), g(row,header).
      if (/^(read|readValue|value|val|num|date|text|rowValue|rowText|rowNumber|rowDate|g|get|v)$/i.test(text(node.callee)) && node.arguments[0] && rowLike(node.arguments[0])) {
        for (const arg of node.arguments.slice(1)) {
          const key = evaluate(arg);
          for (const rawKey of typeof key === 'string' ? [key] : Array.isArray(key) ? key : []) if (typeof rawKey === 'string') accesses.push({ ...location(node), kind: 'reader-call-candidate', rawKey, usageTypes: useTypes(node), evidence: 'syntactic-reader-candidate' });
        }
      }
      if (/^(canonicalText|canonicalDate|value)$/.test(text(node.callee)) && node.arguments.length === 1) {
        const ref = evaluate(node.arguments[0]);
        if (typeof ref === 'string' && registry.field(ref)) accesses.push({ ...location(node), kind: 'canonical-wrapper-candidate', ref, moduleId: null, usageTypes: useTypes(node), evidence: 'syntactic-wrapper-candidate' });
      }
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && /^(CP_COLS|ORDERS_STATUS_COL|CP_SEARCH_KEYS|CP_DIM_META|CP_MIRROR_GROUPS|F)$/.test(node.id.name)) {
      const value = evaluate(node.init);
      function collect(value) {
        if (typeof value === 'string') declarations.push({ ...location(node), kind: 'key-catalog', catalog: node.id.name, rawKey: value, usageTypes: node.id.name === 'CP_SEARCH_KEYS' ? ['filtre'] : node.id.name === 'F' ? ['hesap'] : ['gösterim', 'filtre', 'sıralama', 'export/AI'], evidence: 'key-catalog-not-runtime-proof' });
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && value !== UNKNOWN && typeof value === 'object') {
          if (typeof value.k === 'string') collect(value.k);
          else if (typeof value.col === 'string') collect(value.col);
          else Object.values(value).forEach(collect);
        }
      }
      if (value !== UNKNOWN) collect(value);
    }
    if (node.type === 'ObjectExpression' && file.endsWith('/parse.js') && /buildOrderRowsFromASAS/.test(owners.get(node))) {
      for (const prop of node.properties) if (prop.type === 'Property') {
        const key = prop.computed ? evaluate(prop.key) : prop.key.name ?? prop.key.value;
        if (typeof key === 'string') declarations.push({ ...location(prop), kind: 'projection-property-candidate', rawKey: key, usageTypes: [], evidence: 'producer-not-read' });
      }
    }
    if (node.type === 'SpreadElement' && rowLike(node.argument)) dynamics.push({ ...location(node), kind: 'object-or-iterable-spread', usageTypes: useTypes(node), canonicalId: null, classification: 'belirsiz', removable: false });
  }
  return { accesses, dynamics, declarations };
}
function build(review) {
  const fieldIds = Object.keys(registry.fields);
  const result = { formatVersion: 1, baseline: review.baseline, registryVersion: registry.version, joinProfiles: registry.joinProfiles,
    scope: review.scope, classifications: classes, usageTypes: usages,
    limitations: review.limitations, inputFiles: [], accesses: [], dynamicAccesses: [], fields: [], unregisteredFields: [], reviewedContracts: review.contracts,
    measurementStatus: 'not-measured', projectionImplemented: false, removalAuthorized: false };
  const fieldRefs = new Map(fieldIds.map(id => [id, []]));
  const rawRefs = new Map();
  const mapKey = (key, moduleId) => unique((moduleId ? [moduleId] : ['cp', 'orders', 'collection', 'backlog', 'lfl', 'logistics', 'antrepo']).flatMap(mod => {
    // A binding collision must retain every candidate, not just canonicalId's last-write index.
    return fieldIds.filter(id => registry.bindingFor(mod, id)?.keys.some(k => registry.token(k) === registry.token(key)));
  }));
  for (const file of review.scope.files) {
    assert.match(file, /^resources\/app\/(public|server)\/.+\.js$/);
    const bytes = fs.readFileSync(path.join(root, file));
    const parsed = analyze(bytes.toString('utf8'), file);
    result.inputFiles.push({ file, sha256: sha(bytes), bytes: bytes.length });
    for (const access of [...parsed.accesses, ...parsed.declarations]) {
      const ids = access.ref ? registry.field(access.ref) ? [access.ref] : mapKey(access.ref, access.moduleId) : mapKey(access.rawKey);
      if (access.kind === 'key-catalog' && !ids.length && !/^(CP_COLS|ORDERS_STATUS_COL|F)$/.test(access.catalog)) continue;
      const id = 'a' + (result.accesses.length + 1);
      const record = { id, ...access, usageStatus: access.usageTypes.length ? 'context-inferred; see reviewedContracts' : 'unresolved-or-producer-only', canonicalIds: ids, classification: 'belirsiz', removable: false };
      result.accesses.push(record);
      ids.forEach(field => fieldRefs.get(field).push(id));
      if (!ids.length && access.rawKey) {
        if (!rawRefs.has(access.rawKey)) rawRefs.set(access.rawKey, []);
        rawRefs.get(access.rawKey).push(id);
      }
    }
    parsed.dynamics.forEach(d => result.dynamicAccesses.push({ id: 'd' + (result.dynamicAccesses.length + 1), ...d }));
  }
  const accessById = new Map(result.accesses.map(a => [a.id, a]));
  const applies = (contract, canonicalId) => contract.canonicalIds?.includes(canonicalId) ||
    contract.appliesTo === 'all-cp-orders-bindings' && Boolean(registry.fields[canonicalId].modules.cp || registry.fields[canonicalId].modules.orders) ||
    contract.appliesTo === 'all-cp-orders-collection-bindings' && ['cp', 'orders', 'collection'].some(mod => registry.fields[canonicalId].modules[mod]);
  for (const canonicalId of fieldIds) {
    const definition = registry.fields[canonicalId], refs = fieldRefs.get(canonicalId);
    const cpBound = Boolean(definition.modules.cp || definition.modules.orders);
    const catalogRead = refs.some(id => accessById.get(id).catalog === 'CP_COLS' || accessById.get(id).catalog === 'F');
    const note = review.fieldNotes[canonicalId];
    const classification = note?.classification || (cpBound && catalogRead ? classes[0] : classes[2]);
    const applicable = review.contracts.filter(c => applies(c, canonicalId));
    const dynamicReaders = applicable.filter(c => c.id === 'C09' || c.id === 'C03' && refs.some(id => accessById.get(id).catalog === 'CP_COLS')).map(c => ({ contractId: c.id, evidence: c.id === 'C09' ? 'reviewed-moduleFields-loop' : 'reviewed-column-key-loop',
      modules: (c.id === 'C09' ? ['cp', 'orders', 'collection'] : ['cp', 'orders']).filter(mod => definition.modules[mod]), locations: c.locations, usageTypes: c.usageTypes }));
    result.fields.push({ canonicalId, type: definition.type, role: definition.role, aliases: definition.aliases, bindings: definition.modules,
      registryLocation: { file: 'resources/app/public/canonical-fields.js', function: 'FIELDS', line: fs.readFileSync(path.join(app, 'public/canonical-fields.js'), 'utf8').split('\n').findIndex(line => line.trimStart().startsWith(canonicalId + ':')) + 1 },
      usageIds: refs, dynamicReaders, usageTypes: unique([...refs.flatMap(id => accessById.get(id).usageTypes), ...dynamicReaders.flatMap(r => r.usageTypes)]), classification,
      rationale: note?.rationale || (classification === classes[0] ? 'CP sütun/hesap sözleşmesinde mevcut. Dinamik sütun, filtre, sıralama ve export bağımlılığı korunmalı.' : 'Statik kanıt CP/Orders ince satır ihtiyacını kapatmıyor; dinamik tüketiciler ve diğer modüller açık. Kaldırılabilir değildir.'),
      openContractIds: applicable.map(c => c.id), removable: false });
  }
  result.unregisteredFields = [...rawRefs].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([rawKey, usageIds]) => {
    const note = review.rawFieldNotes[rawKey];
    const catalogRead = usageIds.some(id => ['CP_COLS', 'ORDERS_STATUS_COL', 'F'].includes(accessById.get(id).catalog));
    return { canonicalId: null, rawKey, usageIds, usageTypes: unique(usageIds.flatMap(id => accessById.get(id).usageTypes)), classification: note?.classification || (catalogRead ? classes[0] : classes[2]),
      rationale: note?.rationale || 'Canonical ID atanmamış sözdizimsel aday. Satır/nesne kökeni ve dinamik tüketiciler doğrulanmadan kaldırılmaz.', removable: false };
  });
  for (const access of result.accesses) {
    const classifications = unique(access.canonicalIds.map(id => result.fields.find(f => f.canonicalId === id).classification));
    access.classification = classifications.length === 1 ? classifications[0] : !classifications.length ? result.unregisteredFields.find(f => f.rawKey === access.rawKey)?.classification || classes[2] : classes[2];
  }
  result.summary = { canonicalFields: result.fields.length, accessSites: result.accesses.length, dynamicAccessSites: result.dynamicAccesses.length, unregisteredKeys: result.unregisteredFields.length,
    fieldClassifications: Object.fromEntries(classes.map(c => [c, result.fields.filter(f => f.classification === c).length])) };
  return result;
}
function encode(inventory) {
  // One source access per line keeps generated diffs reviewable without omitting evidence.
  const packed = new Set(['accesses', 'dynamicAccesses', 'unregisteredFields']);
  return '{\n' + Object.entries(inventory).map(([key, value]) => '  ' + JSON.stringify(key) + ': ' +
    (packed.has(key) ? '[\n' + value.map(record => '    ' + JSON.stringify(record)).join(',\n') + '\n  ]' :
      JSON.stringify(value, null, 2).replace(/\n/g, '\n  '))).join(',\n') + '\n}\n';
}
function validate(inventory, matrix) {
  validateFullTestGate(matrix);
  assert.equal(inventory.measurementStatus, 'not-measured');
  assert.equal(inventory.projectionImplemented, false);
  assert.equal(inventory.removalAuthorized, false);
  assert.deepEqual(inventory.fields.map(f => f.canonicalId).sort(), Object.keys(registry.fields).sort());
  const ids = new Set(inventory.accesses.map(a => a.id));
  assert.equal(ids.size, inventory.accesses.length);
  for (const record of [...inventory.fields, ...inventory.unregisteredFields, ...inventory.dynamicAccesses]) {
    assert.ok(classes.includes(record.classification));
    assert.equal(record.removable, false);
    for (const id of record.usageIds || []) assert.ok(ids.has(id), id);
  }
  for (const field of inventory.fields) assert.ok(field.usageIds.length || field.dynamicReaders.length, 'missing reader evidence: ' + field.canonicalId);
  for (const a of inventory.accesses) {
    assert.ok(a.line > 0 && a.column > 0 && a.function && a.expression);
    assert.ok(a.usageTypes.every(u => usages.includes(u)));
  }
  for (const input of inventory.inputFiles) assert.equal(sha(fs.readFileSync(path.join(root, input.file))), input.sha256, 'source drift: ' + input.file);
  const cases = new Set(matrix.cases.map(c => c.id));
  assert.equal(cases.size, matrix.cases.length);
  for (const contract of inventory.reviewedContracts) {
    assert.ok(contract.matrixIds.length, contract.id);
    contract.matrixIds.forEach(id => assert.ok(cases.has(id), id));
    for (const loc of contract.locations) {
      const source = fs.readFileSync(path.join(root, loc.file), 'utf8').split('\n');
      assert.ok(source[loc.line - 1]?.includes(loc.anchor), `${contract.id}: stale ${loc.file}:${loc.line}`);
    }
  }
  for (const field of inventory.fields) assert.ok(matrix.canonicalCoverage.includes(field.canonicalId));
  assert.ok(matrix.cases.every(c => c.status === 'planned-after-885' && c.oracle && c.fixtures.length && c.assertions.length));
}
function validateFullTestGate(matrix) {
  const gate = matrix.requiredValidation?.fullRegression;
  assert.ok(gate, 'Phase 6 full regression gate is required');
  assert.equal(gate.required, true);
  assert.equal(gate.gate, 'phase-6-or-final-program-pr-closure');
  assert.equal(gate.cwd, 'resources/app');
  assert.equal(gate.executable, 'npm');
  assert.deepEqual(gate.arguments, ['test']);
  assert.deepEqual(gate.filters, []);
  assert.equal(gate.scope, 'entire pinned post-885 Main suite plus candidate additions');
  assert.equal(gate.status, 'pending-after-885-implementation');
  for (const flag of ['testsMayBeWeakened', 'assertionsMayBeReduced', 'thresholdsMayBeRelaxed', 'mandatoryFailuresMayBeIgnored', 'skippedOrCancelledMandatoryChecksMayPass']) assert.equal(gate[flag], false, flag);
  assert.equal(gate.finalSourceShaRequired, true);
  assert.equal(gate.invalidateAfterRelevantChange, true);
  assert.deepEqual(gate.substitutesAllowed, []);
  assert.deepEqual(gate.evidence, ['command', 'sourceSha', 'exitCode', 'pass', 'fail', 'skip', 'cancel']);
}
function selfTest() {
  const matrix = JSON.parse(fs.readFileSync(path.join(here, 'shadow-matrix.json'), 'utf8'));
  validateFullTestGate(matrix);
  assert.throws(() => validateFullTestGate({}), 'missing full regression gate must fail');
  for (const patch of [{ required: false }, { arguments: ['test', '--', 'cp'] }, { filters: ['cp'] }, { thresholdsMayBeRelaxed: true }, { assertionsMayBeReduced: true }, { substitutesAllowed: ['fast-checks'] }, { finalSourceShaRequired: false }]) {
    const weakened = structuredClone(matrix);
    Object.assign(weakened.requiredValidation.fullRegression, patch);
    assert.throws(() => validateFullTestGate(weakened), 'weakened full regression gate must fail');
  }
  const sample = `const F=Object.freeze({qty:'Order Quantity'});const CP_SEARCH_KEYS=['PLM ID','Model Name'];function cpFilter(row){const {Country}=row;return row[F.qty]+(row['Sub-Manufacturer']??row.subManufacturer)+row[key]+row[CP_SEARCH_KEYS[i]];}function cpCompute(row,id){return BLCanonicalFields.canonicalValue(row,'cp',id);}function cpExport(row){return {...row};}`;
  const result = analyze(sample, 'resources/app/public/example.js');
  assert.ok(result.accesses.some(a => a.rawKey === 'Order Quantity'));
  assert.ok(result.accesses.some(a => a.kind === 'destructure-read' && a.rawKey === 'Country'));
  assert.ok(result.accesses.some(a => a.rawKey === 'Sub-Manufacturer' && a.fallback.operator === '??'));
  assert.ok(result.declarations.some(a => a.rawKey === 'PLM ID' && a.usageTypes.includes('filtre')));
  assert.ok(result.dynamics.some(a => a.keyExpression === 'key'));
  assert.ok(result.accesses.some(a => a.kind === 'finite-key-member-candidate' && a.rawKey === 'Model Name' && a.function === 'cpFilter'));
  assert.ok(result.dynamics.some(a => a.kind === 'dynamic-canonical-call'));
  assert.ok(result.dynamics.some(a => a.kind === 'object-or-iterable-spread'));
  const mutable = analyze("const KEYS=['PLM ID','Model Name'];function f(row){for(let i=0;i<2;i++)use(row[KEYS[i]]);}const key='PLM ID';function g(row,key){return row[key];}", 'resources/app/public/example.js');
  assert.equal(mutable.accesses.filter(a => a.kind === 'finite-key-member-candidate').length, 2, 'loop index must not collapse to its initial value');
  assert.ok(mutable.dynamics.some(a => a.function === 'g' && a.keyExpression === 'key'), 'parameter shadows outer const');
  // Registry semantics only; these are synthetic sentinels, not shadow equivalence.
  for (const mod of ['cp', 'orders']) for (const id of registry.moduleFields(mod)) {
    const binding = registry.bindingFor(mod, id);
    binding.keys.forEach(key => assert.equal(registry.value({ [key]: 'sentinel-' + id }, mod, id), 'sentinel-' + id));
    const [first, second] = binding.keys;
    if (second) {
      assert.equal(registry.value({ [first]: 0, [second]: 7 }, mod, id), 0);
      assert.equal(registry.value({ [first]: false, [second]: true }, mod, id), false);
      for (const empty of ['', null, undefined]) assert.equal(registry.value({ [first]: empty, [second]: 'fallback' }, mod, id), 'fallback');
      assert.equal(registry.value({ [first]: 'primary', [second]: 'secondary' }, mod, id), 'primary');
    }
  }
  console.log('PASS: full-test gate rejects weakening; AST detection and synthetic registry fallback sentinels');
}
const command = process.argv[2];
if (command === 'self-test') selfTest();
else if (['build', 'check'].includes(command)) {
  const review = JSON.parse(fs.readFileSync(path.join(here, 'reviewed-contracts.json'), 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(path.join(here, 'shadow-matrix.json'), 'utf8'));
  const actual = build(review);
  validate(actual, matrix);
  const encoded = encode(actual);
  if (command === 'build') fs.writeFileSync(path.join(here, 'field-inventory.json'), encoded);
  else assert.equal(fs.readFileSync(path.join(here, 'field-inventory.json'), 'utf8'), encoded, 'Inventory differs; inspect drift before rebuilding.');
  console.log(JSON.stringify(actual.summary));
} else { console.error('Usage: node --expose-internals docs/performance-program/phase-6a/inventory-tool.cjs build|check|self-test'); process.exitCode = 2; }
