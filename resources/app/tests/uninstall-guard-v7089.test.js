'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'BuyerLog-Uninstall-Temiz-Kurulum.cmd'), 'utf8');
const marker = '//__BUYERLOG_PREWIPE_JS__';
const js = script.slice(script.lastIndexOf(marker) + marker.length);

test('clean uninstall verifier is parseable and fail-closed', () => {
  assert.ok(script.includes(marker));
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(script, /SILME IPTAL EDILDI/);
  assert.match(script, /BUYER LOG SIL/);
  assert.match(script, /DELETE-READY\.json/);
  assert.match(script, /SYNC_NOT_CLEAN/);
  assert.match(script, /PERSONAL_BACKUPS_INCOMPLETE/);
});

test('clean uninstall verifies critical shared recovery surfaces', () => {
  for (const value of [
    'Central IAM', 'pricingRules', 'transitRules', 'nonDtrManufacturers',
    'landedMultipliers', 'freightRates', 'fx', 'endeksmatik',
    'settings', 'collection', 'cp', 'personal-backups', 'Full System Backup',
  ]) assert.ok(script.includes(value), value);
});

test('clean uninstall preserves Shared Hub and removes local Buyer Log surfaces only after approval', () => {
  assert.match(script, /ORTAK AG KLASORUNE DOKUNULMAZ/);
  assert.match(script, /Current installation root/);
  assert.match(script, /Roaming AppData Buyer Log/);
  assert.match(script, /Local AppData BuyerLog/);
  assert.match(script, /Local Programs Buyer Log/);
  assert.match(script, /attrib -r -s -h/);
  assert.doesNotMatch(script, /powershell\.exe\s+-/i);
});
