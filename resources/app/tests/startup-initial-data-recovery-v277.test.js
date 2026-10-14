'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');

test('initial data request has a bounded lifetime without changing manual refresh lifetime', () => {
  const start = app.indexOf('async function loadFromServer(force, targets, options = {})');
  const dataFetch = app.indexOf("const res = await fetch(force ? '/api/refresh'", start);
  assert.ok(start >= 0 && dataFetch > start, 'startup request found');
  const request = app.slice(dataFetch, dataFetch + 1000);
  assert.match(request, /!force && options\.startup === true/);
  assert.match(request, /AbortSignal\.timeout\(30000\)/);
  assert.match(request, /signal:\s*!force/);
  assert.match(app, /INITIAL_DATA_ATTEMPT_FAILED/);
  assert.match(app, /INITIAL_DATA_ATTEMPT_READY/);
});

test('initial data retry passes explicit startup intent and preserves real data gate', async () => {
  const start = app.indexOf('async function loadInitialBuyerLogData()');
  const end = app.indexOf('function signalStartupReady()', start);
  assert.ok(start >= 0 && end > start, 'initial loader block found');
  const attempts = [], marks = [];
  const sandbox = {
    loadFromServer: async (...args) => {
      attempts.push(args);
      return attempts.length === 2;
    },
    setTimeout: callback => callback(),
    BLPerf: null,
    window: { BLPerf: { mark: (...args) => marks.push(args) } },
    appLang: 'en', setServerStatus: () => {}, showToast: () => {},
  };
  vm.runInNewContext(app.slice(start, end) + '\nthis.invoke=loadInitialBuyerLogData;', sandbox);
  assert.equal(await sandbox.invoke(), true);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0][0], false);
  assert.equal(attempts[0][2].startup, true);
  assert.equal(attempts[1][2].attempt, 2);
  assert.ok(marks.some(m => m[0] === 'INITIAL_DATA_ATTEMPT_READY'));
});

test('metadata-only initial response never spreads large CP source override maps', () => {
  const start = server.indexOf('async function buildResponse(');
  const end = server.indexOf("app.get('/api/data'", start);
  const block = server.slice(start, end);
  assert.ok(start >= 0 && end > start, 'response builder found');
  assert.match(block, /const overrides = startup \? sharedOverrides : \(\(\) => \{/);
  assert.match(block, /sourceOverrides\.submap/);
  assert.match(block, /sourceOverrides\.suppfobmap/);
  assert.match(block, /sourceOverrides\.suppfobmetamap/);
  assert.match(block, /cp: startup \? null/);
  assert.match(block, /orders: startup \? null/);
  assert.match(block, /currentUser: currentUser \? userAccess\.publicProfile\(currentUser\) : null/);
});

test('startup endpoint records begin/ready/failure without user or source data', () => {
  const start = server.indexOf("app.get('/api/data'");
  const end = server.indexOf("app.get('/api/page-projection/:module'", start);
  const route = server.slice(start, end);
  assert.match(route, /\[STARTUP_INITIAL_DATA\] request-start/);
  assert.match(route, /\[STARTUP_INITIAL_DATA\] response-ready/);
  assert.match(route, /\[STARTUP_INITIAL_DATA\] request-failed/);
  assert.doesNotMatch(route.slice(0, route.indexOf('// Hazır projection')), /currentUser\.(?:id|username|displayName)/);
});
