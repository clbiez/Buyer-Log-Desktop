'use strict';
// Internal server opt-in only. This describes current metadata; worker scope/row checks still apply.
const { types } = require('node:util');
const OFF = Object.freeze({ collectModuleSchemas: false, moduleSchemaExposureCp: false, moduleSchemaTargetKnownCp: false,
  moduleSchemaBindingsKnownCp: false, moduleSchemaExposureOrders: false, moduleSchemaTargetKnownOrders: false,
  moduleSchemaBindingsKnownOrders: false });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function data(value) {
  return value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key); return typeof key === 'string' && d.enumerable && own(d, 'value');
    });
}
function array(value, maximum) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) { const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d?.enumerable || !own(d, 'value')) return false; }
  return true;
}
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
function columns(value) {
  return array(value, 512) && value.every(column => data(column) && ['id','header','label','name'].every(k => text(column[k]))
    && ['table','kind','folder'].every(k => typeof column[k] === 'string' && column[k].length <= 512));
}
function columnBinding(value) { return JSON.stringify(value.map(c => [c.id,c.header,c.label,c.table,c.name,c.kind,c.folder])); }
function connection(value, modelScopes) {
  if (!data(value) || !text(value.id) || !text(value.role) || typeof value.refreshEnabled !== 'boolean'
    || !text(value.server) || !text(value.catalog) || !Number.isSafeInteger(value._configVersion) || value._configVersion < 0
    || !columns(value.cpColumns) || !array(value.scopes, 128)) return false;
  // Do not use the model-refresh legacy empty-scope recovery as proof of a known target.
  if (value.refreshEnabled && !value.scopes.length) return false;
  const allowed = modelScopes.allowedTargets(value.role);
  return value.scopes.every(scope => data(scope) && text(scope.id) && typeof scope.enabled === 'boolean'
    && array(scope.targets, 16) && scope.targets.every(target => typeof target === 'string' && allowed.includes(target))
    && new Set(scope.targets).size === scope.targets.length && data(scope.horizon));
}
const targetNames = (item, scopes) => [...scopes.scopeByTarget(item.scopes).keys()].sort().join('\0');

function moduleSchemaParams(context, { hasArea, modelRefresh, modelScopes } = {}) {
  // collect is a private fifth-argument decision in the proposed caller, never parts/HTTP input.
  if (!data(context) || context.collect !== true || context.task !== 'projections'
    || !array(context.modules, 2) || !context.modules.length || new Set(context.modules).size !== context.modules.length
    || !context.modules.every(module => module === 'cp' || module === 'orders')) return OFF;
  const flags = { ...OFF, collectModuleSchemas: true };
  try {
    if (typeof hasArea !== 'function' || !data(context.profile) || !text(context.profile.id) || context.profile.enabled === false || context.profile.status !== 'ACTIVE') return Object.freeze(flags);
    flags.moduleSchemaExposureCp = hasArea(context.profile, 'cp') === true;
    if (!flags.moduleSchemaExposureCp) return Object.freeze(flags); // Orders cannot expose CP-derived definitions when CP is denied.
    flags.moduleSchemaExposureOrders = hasArea(context.profile, 'orders') === true;
    if (!data(context.sourceModes) || context.sourceModes.asas !== 'database' || context.sourceModes.antrepo !== 'database') return Object.freeze(flags);
    if (!modelRefresh || !modelScopes || typeof modelRefresh.selectRefreshConnections !== 'function'
      || typeof modelRefresh.resolveRoleTargets !== 'function' || typeof modelScopes.allowedTargets !== 'function'
      || typeof modelScopes.scopeByTarget !== 'function') return Object.freeze(flags);
    const store = context.connections, effective = context.effectiveConnections;
    if (!data(store) || !Number.isSafeInteger(store.revision) || store.revision < 0 || !array(store.items, 128)
      || !array(effective, 128) || effective.length !== store.items.length
      || !store.items.every(item => connection(item, modelScopes)) || !effective.every(item => connection(item, modelScopes))
      || new Set(store.items.map(item => item.id)).size !== store.items.length
      || new Set(effective.map(item => item.id)).size !== effective.length) return Object.freeze(flags);
    for (const base of store.items) {
      const item = effective.find(item => item.id === base.id);
      if (!item || ['role','refreshEnabled','server','catalog','_configVersion'].some(key => item[key] !== base[key])
        || columnBinding(item.cpColumns) !== columnBinding(base.cpColumns)
        || targetNames(item, modelScopes) !== targetNames(base, modelScopes)) return Object.freeze(flags);
    }
    // Reuse the real target resolver, including current ordering; never invent an independent registry.
    const selected = modelRefresh.selectRefreshConnections(effective, { includeAsas: false, includeAntrepo: false });
    const asas = modelRefresh.resolveRoleTargets(selected.asasList, 'asas'), antrepo = modelRefresh.resolveRoleTargets(selected.antrepoList, 'antrepo');
    if (asas.conflicts.length || antrepo.conflicts.length) return Object.freeze(flags);
    const cp = asas.claimed.get('cp'), orders = asas.claimed.get('orders'), cpAntrepo = antrepo.claimed.get('cp'), ordersAntrepo = antrepo.claimed.get('orders');
    flags.moduleSchemaTargetKnownCp = Boolean(cp && cp.item.role === 'asas');
    flags.moduleSchemaTargetKnownOrders = Boolean(orders && orders.item.role === 'asas');
    const cpOwners = [cp?.item, cpAntrepo?.item].filter(Boolean), headers = new Set();
    // Legacy cpModelColumns flattens ALL connections. Do not silently filter inactive/out-of-target definitions to get a grant.
    flags.moduleSchemaBindingsKnownCp = flags.moduleSchemaTargetKnownCp && store.items.every(item => item.cpColumns.every(column => {
      if (!item.refreshEnabled || !['asas','antrepo'].includes(item.role) || !cpOwners.some(owner => owner.id === item.id)
        || headers.has(column.header)) return false;
      headers.add(column.header); return true;
    }));
    flags.moduleSchemaBindingsKnownOrders = flags.moduleSchemaBindingsKnownCp && flags.moduleSchemaTargetKnownOrders
      && orders.item.id === cp.item.id && (ordersAntrepo?.item.id || null) === (cpAntrepo?.item.id || null);
    return Object.freeze(flags);
  } catch (_) { return Object.freeze({ ...OFF, collectModuleSchemas: true }); }
}
module.exports = { moduleSchemaParams };
