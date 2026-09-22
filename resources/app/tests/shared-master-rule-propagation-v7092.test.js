'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CLIENT = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const DELTA = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'delta-store.js'), 'utf8');
const POLICY = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'shared-sync-policy.js'), 'utf8');

test('central business rules are classified as GLOBAL_MASTER sync data', () => {
  assert.match(POLICY, /pricingRules/);
  assert.match(POLICY, /transitRules/);
  assert.match(POLICY, /nonDtrManufacturers/);
  assert.match(POLICY, /landedMultipliers/);
  assert.match(POLICY, /freightRates/);
  assert.match(POLICY, /\^store:\(email-groups\|fx-rates\)\\\.json\$/);
  assert.match(POLICY, /\^endeksmatik:/);
});

test('every central rule write schedules immediate Master publication', () => {
  for (const entity of [
    'pricingRules','transitRules','nonDtrManufacturers','landedMultipliers','freightRates',
    'antrepoSourceMode','asasSourceMode','lflSourceMode','antrepoMatchRule','noteColumnDefs',
    'modelConnections','fx','endeksmatik','emailGroups',
  ]) {
    assert.match(SERVER, new RegExp(`publishSharedMasterChange\\('${entity}'`), `${entity} must publish Master immediately`);
  }
});

test('Master publication waits for queued delta mirrors before syncing to the Hub', () => {
  assert.match(DELTA, /async function flush\(\)/);
  assert.match(DELTA, /await mirrorTail\.catch/);
  assert.match(SERVER, /typeof deltaStore\.flush === 'function'/);
  assert.ok(SERVER.indexOf("deltaStore.flush") < SERVER.indexOf("syncSettings.syncOnce"));
});

test('recovered Master checkpoint announces rule changes to the running local client', () => {
  assert.match(SERVER, /function changedMasterEntities\(/);
  assert.match(SERVER, /function announceRecoveredMasterEntities\(/);
  assert.match(SERVER, /announceRecoveredMasterEntities\(recoveredMasterEntities\)/);
  for (const entity of ['pricingRules','transitRules','nonDtrManufacturers','landedMultipliers','freightRates','modelConnections']) {
    assert.match(SERVER, new RegExp(`changed\\.add\\('${entity}'\\)|changed\\.add\\("${entity}"\\)|'${entity}'`));
  }
});

test('active Buyer Log clients refresh all central runtime rule families', () => {
  for (const entity of [
    'transitRules','nonDtrManufacturers','landedMultipliers','freightRates',
    'antrepoSourceMode','asasSourceMode','lflSourceMode','antrepoMatchRule',
    'noteColumnDefs','modelConnections','systemSettings',
  ]) {
    assert.match(CLIENT, new RegExp(`['"]${entity}['"]`), `${entity} must be handled by live/poll refresh`);
  }
  assert.match(CLIENT, /loadFromServer\(false\)/);
  assert.match(CLIENT, /modelConnLoad\(\)/);
});
