'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const ui = fs.readFileSync(path.join(ROOT,'public','user-access-ui.js'),'utf8');
const updateUi = fs.readFileSync(path.join(ROOT,'public','update-test-ui.js'),'utf8');
const perf = fs.readFileSync(path.join(ROOT,'public','perf-runtime.js'),'utf8');
const css = fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

test('moderator user menu always exposes Update Test; runtime availability is checked when opened', () => {
  assert.match(ui, /profile\.systemRole === 'moderator'[\s\S]*?data-update-test/);
  assert.doesNotMatch(ui, /profile\.systemRole === 'moderator'\s*&&\s*window\.buyerLogDesktop/);
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


test('Update Test modal CSS keeps the dialog visible above the dimmed overlay', () => {
  assert.match(css, /\.updateTestOverlay\{[\s\S]*?position:fixed[\s\S]*?display:grid[\s\S]*?place-items:center/);
  assert.match(css, /\.updateTestCard\{[\s\S]*?width:min\(540px[\s\S]*?background:var\(--card\)[\s\S]*?color:var\(--ink\)[\s\S]*?display:block/);
  assert.match(css, /section\{display:none\}/);
  assert.match(css, /\.updateTestHead\{[\s\S]*?display:flex/);
  assert.match(css, /\.updateTestActions\{[\s\S]*?display:flex/);
});
