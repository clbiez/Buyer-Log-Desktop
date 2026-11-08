'use strict';

// Internal projection metadata: flags below must come from trusted server policy.
// This module does not authorize callers and never reads HTTP input itself.
const { types } = require('node:util');
const schema = require('../../public/module-projection-schema');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function legacyRegisteredDefinitions(definitions) {
  // The valid JSON path is the exact legacy syncCpModelColumns registration:
  // filter(d => d && d.header && d.label).map(d => ({...d})). Guard accessors,
  // proxies and malformed arrays first; never invoke hooks to inspect metadata.
  if (types.isProxy(definitions) || !Array.isArray(definitions) || Object.getPrototypeOf(definitions) !== Array.prototype || definitions.length > 32768) return null;
  if (Reflect.ownKeys(definitions).length !== definitions.length + 1) return null;
  for (let index = 0; index < definitions.length; index++) {
    const item = Object.getOwnPropertyDescriptor(definitions, String(index));
    if (!item || !item.enumerable || !own(item, 'value')) return null;
    const definition = item.value;
    if (typeof definition === 'function') return null;
    if (definition == null || typeof definition !== 'object') continue;
    if (types.isProxy(definition) || Array.isArray(definition) || ![Object.prototype, null].includes(Object.getPrototypeOf(definition))) return null;
    for (const key of Reflect.ownKeys(definition)) {
      const descriptor = Object.getOwnPropertyDescriptor(definition, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !own(descriptor, 'value')) return null;
    }
  }
  return definitions.filter(d=>d&&d.header&&d.label).map(d=>({...d}));
}
function buildModuleSchemas({ data, cpRows, ordersRows, sameRows, sameAntrepo }) {
  const result = { cp: null, orders: null };
  if (!Array.isArray(cpRows) && !Array.isArray(ordersRows)) return result;
  // data.cpAllowed is deliberately absent: it is a broader compute switch.
  const cpGrant = data.moduleSchemaExposureCp === true
    && data.moduleSchemaTargetKnownCp === true
    && data.moduleSchemaBindingsKnownCp === true;
  if (!cpGrant) return result;
  const rawDefinitions = data.cpModelColumns;
  if (types.isProxy(rawDefinitions) || !Array.isArray(rawDefinitions)) return result;
  const definitions = legacyRegisteredDefinitions(rawDefinitions);
  if (definitions === null) return result;
  const common = { modelColumns: definitions, modelSchemaKnown: true, canExpose: true };
  if (Array.isArray(cpRows)) result.cp = schema.build({
    ...common, module: 'cp', rows: cpRows,
    scopePolicy: { schemaSource: 'target', targetKnown: true, bindingsKnown: true, cpSchemaAllowed: true },
  });
  if (Array.isArray(ordersRows)
    && data.moduleSchemaExposureOrders === true
    && data.moduleSchemaTargetKnownOrders === true
    && data.moduleSchemaBindingsKnownOrders === true
    && sameAntrepo === true && typeof sameRows === 'function' && sameRows() === true) {
    result.orders = schema.build({
      ...common, module: 'orders', rows: ordersRows,
      scopePolicy: { schemaSource: 'shared-cp', targetKnown: true, bindingsKnown: true, cpSchemaAllowed: true, sameRows: true, sameAntrepo: true },
    });
  }
  return result;
}
module.exports = { buildModuleSchemas };
