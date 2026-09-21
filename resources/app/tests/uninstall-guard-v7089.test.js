'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'BuyerLog-Uninstall-Temiz-Kurulum.cmd'), 'utf8');

test('clean uninstall requires Shared Hub verification before deletion', () => {
  assert.match(script, /DOGURLAMA BASARILI/);
  assert.match(script, /BUYERLOG-SIL/);
  assert.match(script, /Shared Hub.*ASLA SILINMEZ/i);
  assert.match(script, /pendingCount\(\)/);
  assert.match(script, /unacknowledgedCount/);
});

test('clean uninstall verifies critical shared recovery surfaces', () => {
  assert.match(script, /readMaster\(/);
  assert.match(script, /readBusiness\(/);
  assert.match(script, /pricingRules/);
  assert.match(script, /transitRules/);
  assert.match(script, /landedMultipliers/);
  assert.match(script, /freightRates/);
  assert.match(script, /fx-rates/);
  assert.match(script, /endeksmatik:/);
  assert.match(script, /personal-backups/);
  assert.match(script, /model-images/);
  assert.match(script, /Central IAM/);
});

test('clean uninstall does not target the configured Shared Hub for removal', () => {
  const deleteLines = script.split(/\r?\n/).filter(line => /rmdir|del \/q|reg delete/i.test(line));
  assert.ok(deleteLines.length > 0);
  assert.equal(deleteLines.some(line => /sharedSyncRoot|hubRoot|buyerlog-hub/i.test(line)), false);
});

test('clean uninstall cleans portable and known user-level Buyer Log paths only after approval', () => {
  assert.match(script, /rmdir \/s \/q "%ROOT%"/i);
  assert.match(script, /%APPDATA%\\Buyer Log/);
  assert.match(script, /%LOCALAPPDATA%\\BuyerLog/);
  assert.match(script, /%LOCALAPPDATA%\\Programs\\Buyer Log/);
});
