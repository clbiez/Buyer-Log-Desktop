'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');

test('v7.13 login path is not starved by startup snapshot/page-cache warmup', () => {
  const startup = SERVER.slice(SERVER.indexOf('const httpServer = app.listen'), SERVER.indexOf("httpServer.on('error'"));
  assert.doesNotMatch(startup, /setTimeout\(\(\)=>warmPageProjectionCachesFromSnapshots\(/);
  assert.doesNotMatch(startup, /ensureDataLoaded\('moderator'\)\.catch\(err=>logRuntimeFailure\('startupModelRead'/);
  assert.match(startup, /kimlik doğrulama yolu MUTLAKA hafif kalır/);
});

test('v7.13 sign-in request recovers instead of spinning forever', () => {
  assert.match(LOGIN, /new AbortController\(\)/);
  assert.match(LOGIN, /LOGIN_TIMEOUT_MS = 15000/);
  assert.match(LOGIN, /setTimeout\(\(\) => controller\.abort\(\), LOGIN_TIMEOUT_MS\)/);
  assert.match(LOGIN, /signal: controller\.signal/);
  assert.match(LOGIN, /error && error\.name === 'AbortError'/);
  assert.match(LOGIN, /finally \{[\s\S]*loginBusy = false;[\s\S]*renderLoginButton\(\)/);
});
