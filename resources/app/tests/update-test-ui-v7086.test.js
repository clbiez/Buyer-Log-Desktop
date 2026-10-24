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

test('user menu exposes App Update for every user; runtime availability is checked when opened', () => {
  assert.doesNotMatch(ui, /profile\.systemRole === 'moderator' \? `<button type="button" data-update-test>/);
  assert.match(ui, /<button type="button" data-update-test><svg[^>]*><use href="#i-download"\/><\/svg>\$\{esc\(tr\('Güncellemeleri Kontrol Et', 'Check for Updates'\)\)\}<\/button>/);
  assert.doesNotMatch(ui, /tr\('Güncelleme Testi', 'Update Test'\)/);
  assert.doesNotMatch(ui, /profile\.systemRole === 'moderator'\s*&&\s*window\.buyerLogDesktop/);
  assert.match(ui, /data-update-test[\s\S]*?openBuyerLogUpdateTest/);
  assert.doesNotMatch(updateUi, /user\.systemRole !== 'moderator'\) return/);
  assert.match(updateUi, /id="updateTestTitle">' \+ esc\(tr\('Güncellemeleri Kontrol Et','Check for Updates'\)\)/);
  assert.doesNotMatch(updateUi, /tr\('Güncelleme Testi','Update Test'\)/);
});

test('only moderators can pick the update channel; other users check STABLE without configure', () => {
  assert.match(updateUi, /moderator \? '<select data-update-channel>/);
  assert.match(updateUi, /if \(moderator && channel\) \{\s*const configured = await api\.configure/);
  assert.match(updateUi, /isModerator\(\) \? String\(status\.channel[\s\S]*?: 'STABLE'/);
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

test('Update Test UI polls updater status and renders live download stages', () => {
  assert.match(updateUi, /statusPollTimer = setInterval\(\(\) => \{ void refresh\(\)\.catch\(\(\)=>\{\}\); \}, 350\)/);
  assert.match(updateUi, /data-update-progress/);
  for (const step of ['check','download','verify','ready']) assert.match(updateUi,new RegExp('data-update-step="' + step + '"'));
  assert.match(updateUi, /UPDATE_AVAILABLE: 'download'/);
  assert.match(updateUi, /DOWNLOADING: 'download'/);
  assert.match(updateUi, /VERIFYING: 'verify'/);
  assert.match(updateUi, /READY_TO_INSTALL: 'ready'/);
});

test('Update Test UI is loaded before the user menu module in deferred UI', () => {
  assert.match(perf, /update-test-ui\.js\?rev=6','user-access-ui\.js\?rev=APP-UPDATE-V3/);
});


test('Update Test modal CSS keeps the dialog visible above the dimmed overlay', () => {
  assert.match(css, /\.updateTestOverlay\{[\s\S]*?position:fixed[\s\S]*?display:grid[\s\S]*?place-items:center/);
  assert.match(css, /\.updateTestCard\{[\s\S]*?width:min\(540px[\s\S]*?background:var\(--card\)[\s\S]*?color:var\(--ink\)[\s\S]*?display:block/);
  assert.match(css, /section\{display:none\}/);
  assert.match(css, /\.updateTestHead\{[\s\S]*?display:flex/);
  assert.match(css, /\.updateTestActions\{[\s\S]*?display:flex/);
});
