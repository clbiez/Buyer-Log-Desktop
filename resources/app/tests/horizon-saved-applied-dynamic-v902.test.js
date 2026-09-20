'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-horizon-v902-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const preferences = require('../server/lib/user-preferences');
const horizonFields = require('../server/lib/horizon-fields');
const modelHorizon = require('../server/lib/modelHorizon');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('saved and applied Horizon are independent and applied state can be persisted', () => {
  const saved = { table: 'ASAS', groups: [{ conditions: [{ field: 'Status', op: 'in', values: ['Confirmed'] }] }] };
  const applied = { table: 'ASAS', groups: [{ conditions: [{ field: 'Status', op: 'in', values: ['Old'] }] }] };

  preferences.saveHorizon('buyer', 'orders', saved, { connectionId: 'asas-main', role: 'asas' });
  preferences.saveAppliedHorizon('buyer', 'orders', applied, { connectionId: 'asas-main', role: 'asas' });

  assert.deepEqual(preferences.getHorizon('buyer', 'orders').byConnection['asas-main'], saved);
  assert.deepEqual(preferences.getAppliedHorizon('buyer', 'orders').byConnection['asas-main'], applied);
  assert.notDeepEqual(preferences.getHorizon('buyer', 'orders'), preferences.getAppliedHorizon('buyer', 'orders'));
});

test('ASAS schema columns become dynamic Horizon fields with inferred filter types', () => {
  const fields = horizonFields.fromSchema({ columns: [
    { table: 'ASAS Orders', name: 'Status', kind: 'column', dataType: 'string' },
    { table: 'ASAS Orders', name: 'In Store Month', kind: 'column', dataType: 'date' },
    { table: 'ASAS Orders', name: 'Quantity', kind: 'column', dataType: 'double' },
    { table: 'ASAS Orders', name: 'Is Active', kind: 'column', dataType: 'boolean' },
  ] });

  assert.equal(fields.find(field => field.name === 'Status').type, 'text');
  assert.equal(fields.find(field => field.name === 'In Store Month').type, 'date');
  assert.equal(fields.find(field => field.name === 'Quantity').type, 'number');
  assert.equal(fields.find(field => field.name === 'Is Active').type, 'boolean');
});

test('boolean Horizon values use boolean DAX literals and match boolean rows', () => {
  const horizon = { table: 'ASAS', groups: [{ conditions: [
    { table: 'ASAS', field: 'Is Active', name: 'Is Active', op: 'in', valueType: 'boolean', values: ['true'] },
  ] }] };
  assert.equal(horizonFields.filterRows([
    { _sourceFields: { 'Is Active': true } },
    { _sourceFields: { 'Is Active': false } },
  ], horizon).length, 1);
  assert.match(modelHorizon.buildHorizonFilter(horizon).expression, /IN \{ TRUE\(\) \}/);
});

test('Horizon API and editor keep saved settings separate from the last applied settings', () => {
  assert.match(serverSource, /savedHorizon\s*:/);
  assert.match(serverSource, /appliedHorizon\s*:/);
  assert.match(serverSource, /discoverSchema/);
  /* v7.81 — "kaydedilen" ile "uygulanan" ufku ayrı tutan arayüz
     (horizon-editor.js) kaldırıldı: kişisel ufuk katmanı yok artık.
     Ayrımın SUNUCU tarafı duruyor ve korunan karar da oydu. */
  assert.match(serverSource, /savedHorizon/);
});
