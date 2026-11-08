'use strict';

// Hazırlık fixture'ı; uygulama/DB/test çalıştırmaz. Tüm değerler sentetiktir.
const clone = value => JSON.parse(JSON.stringify(value));
const rawKey = '__MODEL_DEMO_ÜretimOranı';
const def = Object.freeze({
  id: 'demo-model-rate', header: rawKey,
  label: 'Demo rate', labelTr: 'Demo oranı', labelEn: 'Demo rate', group: 'Database',
  table: 'DemoFact', name: 'SyntheticRate', dataType: 'Double', percentageScale: 'fraction',
  sourceMetadata: { dataType: 'Double', formatString: '0.00%' },
});
function scope(id, targets, seasons = ['6W26']) {
  return { id, targets, enabled: true, horizon: { table: 'DemoFact', seasons } };
}
function connection(id, scopes, columns = [def], extras = {}) {
  return { id, name: 'DEMO ' + id, role: 'asas', server: 'synthetic.invalid', catalog: 'DemoOnly',
    refreshEnabled: true, scopes: clone(scopes), cpColumns: clone(columns), ...extras };
}
const sameScope = [connection('shared', [scope('shared-cp-orders', ['cp', 'orders'])])];
const separateScopes = [connection('split', [scope('cp-only', ['cp'], ['6W26']), scope('orders-only', ['orders'], ['6S26'])])];
const distinctConnections = [
  connection('cp-private', [scope('private-cp', ['cp'])], [{ ...def, id: 'private-cost', header: '__CP_PRIVATE_COST', label: 'CP private cost' }]),
  connection('orders-public', [scope('shared-orders', ['cp', 'orders'], ['6S26'])], [{ ...def, id: 'orders-rate', header: '__ORDERS_RATE', label: 'Orders rate' }]),
];
const ordersOnlyProfile = { id: 'synthetic-orders-user', accessAreas: ['orders'], permissions: { orders: true, cp: false } };
const layout = {
  order: ['Season', rawKey, '__personalOrderNote', 'note_demo', 'formula_orders'],
  hidden: ['note_demo'], widths: { [rawKey]: 188 },
  filters: { [rawKey]: { selected: ['0.25'] }, Season: { selected: ['6W26'] } },
  formulas: [{ id: 'formula_orders', tableKey: 'orders', expression: '[FOB] * 2', label: 'Orders only' }],
};
function metadata(module, modelColumns, contextKey = 'ctx-demo', sourceKey = 'source-' + module) {
  return { version: 1, module, contextKey, sourceKey, modelColumns: clone(modelColumns) };
}

module.exports = { clone, rawKey, def, scope, connection, sameScope, separateScopes, distinctConnections,
  ordersOnlyProfile, layout, metadata,
  // These configurations need an explicit legacy-shadow decision, not silent field removal.
  semanticDecisionCases: [
    { name: 'Excel mode with configured DB labels', sourceMode: 'excel', items: sameScope },
    { name: 'Disabled saved DB connection labels', sourceMode: 'database', items: [connection('disabled', [scope('off', ['cp','orders'])], [def], { refreshEnabled: false })] },
    { name: 'Separate Orders-only scope omits CP custom query fields', sourceMode: 'database', items: separateScopes },
    { name: 'Antrepo metadata requires actual row-key provenance', sourceMode: 'database', items: [connection('warehouse', [scope('warehouse-orders', ['orders'])], [def], { role: 'antrepo' })] },
  ],
};
