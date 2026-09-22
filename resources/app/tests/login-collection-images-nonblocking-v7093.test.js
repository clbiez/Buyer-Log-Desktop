'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');

function sliceBetween(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, 'start marker missing: ' + start);
  assert.ok(to > from, 'end marker missing: ' + end);
  return text.slice(from, to);
}

test('collection image synchronization is explicitly non-blocking for login', () => {
  const route = sliceBetween(
    SERVER,
    "app.post('/api/shared-hub/user-bootstrap'",
    "app.post('/api/shared-hub/initialize'"
  );

  assert.match(route, /if \(gate\.status !== 'ready'\)/, 'critical Shared Hub bootstrap must still gate sign-in');
  assert.match(route, /const userId = String\(req\.currentUser\.id\)/);
  assert.match(route, /userBootstrapReady\.add\(userId\)/);
  assert.match(route, /void syncAuthorizedCollectionImages\(userId\)\.then\(/);
  assert.match(route, /collectionImages:\{ status:'deferred', blocking:false/);
  assert.match(route, /ok:true, ready:true, offline:false/);
  assert.doesNotMatch(route, /COLLECTION_BOOTSTRAP_INCOMPLETE/);

  assert.ok(
    route.indexOf('userBootstrapReady.add(userId)') < route.indexOf('void syncAuthorizedCollectionImages(userId)'),
    'login readiness must be granted before optional image synchronization starts'
  );
});

test('login UI labels deferred collection images as background work and still proceeds', () => {
  const bootstrap = sliceBetween(
    LOGIN,
    'async function runUserBootstrap()',
    "$('loginForm').addEventListener('submit'"
  );
  const submit = sliceBetween(
    LOGIN,
    "$('loginForm').addEventListener('submit'",
    "$('hubSettingsBtn').addEventListener"
  );

  assert.match(bootstrap, /const imageDeferred = images\.blocking === false/);
  assert.match(bootstrap, /Arka planda · girişe engel değil/);
  assert.match(bootstrap, /status:'active'/);
  assert.match(submit, /await runUserBootstrap\(\)/);
  assert.match(submit, /location\.replace\('\/'\)/);
});

test('main application still requires completed critical user bootstrap readiness', () => {
  assert.match(SERVER, /if \(!profile \|\| !userBootstrapReady\.has\(String\(profile\.id\)\)\)/);
});
