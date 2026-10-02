'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const UPDATER = fs.readFileSync(path.join(ROOT, 'electron', 'update', 'updater.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');
const LOGIN_CSS = fs.readFileSync(path.join(ROOT, 'public', 'giris.css'), 'utf8');

test('startup update check begins immediately and does not wait for renderer/login', () => {
  const scheduleStart = MAIN.indexOf('function scheduleUpdateChecks()');
  const scheduleEnd = MAIN.indexOf('/* --------------------------------------------------------- pencere durumu */', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  const schedule = MAIN.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /void runUpdateCheck\(\{manual:false\}\)\.catch/);
  assert.doesNotMatch(schedule, /setTimeout\([^\n]*runUpdateCheck/);

  const readyStart = MAIN.indexOf('app.whenReady().then(async () => {');
  const readyEnd = MAIN.indexOf("process.on('uncaughtException'", readyStart);
  const ready = MAIN.slice(readyStart, readyEnd);
  assert.ok(ready.indexOf('scheduleUpdateChecks();') >= 0);
  assert.ok(ready.indexOf('scheduleUpdateChecks();') < ready.indexOf('await startBuyerLog();'));

  const rendererHookStart = MAIN.indexOf('onFirstRendererReady: () => {');
  const rendererHookEnd = MAIN.indexOf('},\n  });', rendererHookStart);
  assert.doesNotMatch(MAIN.slice(rendererHookStart, rendererHookEnd), /scheduleUpdateChecks\(\)/);
});

test('startup delay defaults to zero for new configurations', () => {
  assert.match(CONFIG, /"startupDelayMs": 0/);
  assert.match(UPDATER, /startupDelayMs:Math\.max\(0,Number\(local\.startupDelayMs\?\?base\.startupDelayMs\?\?0\)\|\|0\)/);
});

test('login screen surfaces update availability before authentication', () => {
  assert.match(LOGIN, /id="startupUpdateNotice"/);
  assert.match(LOGIN, /Güncelleme Mevcut/);
  assert.match(LOGIN, /window\.buyerLogDesktop && window\.buyerLogDesktop\.updates/);
  assert.match(LOGIN, /api\.status\(''\)/);
  assert.match(LOGIN, /api\.onStatus/);
  assert.match(LOGIN, /setInterval\(\(\) => \{ void refresh\(\); \}, 350\)/);
  assert.match(LOGIN_CSS, /\.startupUpdateNotice\{/);
  assert.match(LOGIN_CSS, /\.startupUpdateNotice\[hidden\]/);
});

test('TEST channel is re-checked once a user is signed in (startup check runs before login as STABLE)', () => {
  const scheduleStart = MAIN.indexOf('function scheduleUpdateChecks()');
  const scheduleEnd = MAIN.indexOf('/* --------------------------------------------------------- pencere durumu */', scheduleStart);
  const schedule = MAIN.slice(scheduleStart, scheduleEnd);
  assert.match(schedule, /watchSignedInTestChannel\(\)/);
  const watchStart = MAIN.indexOf('function watchSignedInTestChannel()');
  assert.ok(watchStart >= 0);
  const watch = MAIN.slice(watchStart, MAIN.indexOf('\n}\n', watchStart));
  assert.match(watch, /cfg\.channel!=='test'/);
  assert.match(watch, /currentRendererUserId\(\)/);
  assert.match(watch, /runUpdateCheck\(\{manual:false,userId\}\)/);
  assert.match(watch, /clearInterval\(updateSignInTimer\)/);
});
