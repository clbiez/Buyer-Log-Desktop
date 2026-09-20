'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const ui = fs.readFileSync(path.join(ROOT,'public','user-access-ui.js'),'utf8');
const updateUi = fs.readFileSync(path.join(ROOT,'public','update-test-ui.js'),'utf8');
const perf = fs.readFileSync(path.join(ROOT,'public','perf-runtime.js'),'utf8');

test('moderator user menu exposes Update Test only for desktop updater sessions', () => {
  assert.match(ui, /profile\.systemRole === 'moderator'[\s\S]*?buyerLogDesktop[\s\S]*?data-update-test/);
  assert.match(ui, /data-update-test[\s\S]*?openBuyerLogUpdateTest/);
});

test('Update Test UI uses the existing updater bridge and shows decisive status fields', () => {
  assert.match(updateUi, /buyerLogDesktop[\s\S]*?updates/);
  assert.match(updateUi, /api\.status\(userId\(\)\)/);
  assert.match(updateUi, /api\.configure\(\{userId:userId\(\),enabled:true,channel:channel\.value\}\)/);
  assert.match(updateUi, /api\.check\(\{userId:userId\(\)\}\)/);
  assert.match(updateUi, /api\.restart\(\)/);
  for (const key of ['current','channel','latest','pending','state']) assert.match(updateUi,new RegExp('data-update-value="' + key + '"'));
  assert.match(updateUi, /pendingReady/);
});

test('Update Test UI is loaded before the user menu module in deferred UI', () => {
  assert.match(perf, /update-test-ui\.js\?rev=1','user-access-ui\.js\?rev=UPDATE-TEST-V1/);
});
