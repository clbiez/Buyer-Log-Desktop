'use strict';
const previousPreparation = require('./module-projection-schema-base.cjs');
function definitions() {
  const first = JSON.parse('{"id":"cpx_demo_rate","label":"Sentetik oran","labelTr":"Sentetik oran","labelEn":"Synthetic rate","header":"__CPX_cpx_demo_rate","table":"DemoFact","name":"SyntheticRate","kind":"measure","folder":"","group":"","role":"asas","connectionId":"demo-connection","connectionName":"SYNTHETIC ONLY","dataType":"Double","sourceMetadata":{"dataType":"Double","formatString":"0.00%","rawZero":0,"rawFalse":false,"rawNull":null},"percentageScale":0,"__proto__":{"raw":"kept"},"constructor":"raw-value","customFlag":false}');
  const second = { ...previousPreparation.clone(previousPreparation.def), role: 'antrepo', data_type: 'Decimal', metadata: { raw: 'İğüş🌍\n"\\\ud800' }, scale: false };
  return [first, second];
}
function policy(extra = {}) { return { schemaSource: 'target', targetKnown: true, bindingsKnown: true, cpSchemaAllowed: true, ...extra }; }
function input(extra = {}) { return { module: 'orders', rows: [{ 'Order Code': '000123', '__CPX_cpx_demo_rate': 0, flag: false, nil: null }, { 'Order Code': '000123', '__CPX_cpx_demo_rate': false, later: '' }], modelColumns: definitions(), modelSchemaKnown: true, canExpose: true, scopePolicy: policy(), ...extra }; }
module.exports = { previousPreparation, definitions, policy, input };
