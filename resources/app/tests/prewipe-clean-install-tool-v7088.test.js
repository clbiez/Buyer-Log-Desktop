'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'scripts', 'BuyerLog-Tam-Temiz-Kurulum.cmd');
const script = fs.readFileSync(file, 'utf8');
const marker = '//__BUYERLOG_PREWIPE_JS__';
const js = script.slice(script.lastIndexOf(marker) + marker.length);

test('pre-wipe tool has a parseable embedded Node verifier', () => {
  assert.ok(script.includes(marker));
  assert.doesNotThrow(() => new vm.Script(js));
});

test('pre-wipe tool is fail-closed before destructive cleanup', () => {
  assert.match(script, /SILME IPTAL EDILDI/);
  assert.match(script, /BUYER LOG SIL/);
  assert.match(script, /DELETE-READY\.json/);
  assert.match(script, /IAM_SEMANTIC_MISMATCH/);
  assert.match(script, /SYNC_NOT_CLEAN/);
  assert.match(script, /MASTER_FIELD_MISMATCH/);
  assert.match(script, /MASTER_FX_MISSING/);
  assert.match(script, /MASTER_ENDEKSMATIK_MISSING/);
  assert.match(script, /requireType: 'full'/);
});

test('critical master coverage includes company business settings', () => {
  for (const key of [
    'pricingRules', 'transitRules', 'nonDtrManufacturers', 'landedMultipliers',
    'freightRates', 'fx', 'endeksmatik', 'settings', 'collection', 'cp',
  ]) assert.ok(script.includes(key), key);
});

test('cleanup removes only local Buyer Log-owned locations and preserves Shared Hub', () => {
  assert.match(script, /ORTAK AG KLASORUNE DOKUNULMAZ/);
  assert.match(script, /Current installation root/);
  assert.match(script, /Roaming AppData Buyer Log/);
  assert.match(script, /Local AppData BuyerLog/);
  assert.match(script, /\.buyerlog-versions|Current installation root/);
  assert.match(script, /attrib -r -s -h/);
  assert.doesNotMatch(script, /powershell\.exe\s+-/i);
});
