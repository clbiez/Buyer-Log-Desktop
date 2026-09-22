'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, 'missing start: ' + start);
  assert.ok(to > from, 'missing end: ' + end);
  return source.slice(from, to);
}

test('pending local Shared Hub changes cannot block authentication', () => {
  // The integrity guard may still protect first-time checkpoint merging, but it
  // must not live on the credential route.
  assert.match(SERVER, /SHARED_HUB_PENDING_CHANGES/);
  const loginRoute = block(SERVER, "app.post('/api/user-login'", "app.post('/api/user-logout'");
  assert.match(loginRoute, /return userAccess\.loginHandler\(req, res, next\)/);
  assert.doesNotMatch(loginRoute, /bootstrapStatusSnapshot|sharedHubStartupSettled|SHARED_HUB_PENDING_CHANGES|BOOTSTRAP_/);
});

test('bootstrap errors preserve local account login availability', () => {
  const bootstrap = block(SERVER, 'async function bootstrapSharedHub', "// Local auth starts first.");
  assert.match(bootstrap, /loginAllowed:localLoginAllowed/);
  assert.match(bootstrap, /bootstrapRequired:!hadLocalLoginSnapshot/);
  assert.match(bootstrap, /Yerel hesapla giriş yapılabilir; eşitleme daha sonra devam eder/);
});

test('login controls remain enabled while sync is starting, retrying or failed', () => {
  const gate = block(LOGIN, 'function loginGateReady()', 'function renderHubSteps()');
  const button = block(LOGIN, 'function renderLoginButton()', 'function selectExactFromCurrentSuggestions');
  assert.match(gate, /return true/);
  assert.match(button, /const controlsLocked = loginBusy/);
  assert.doesNotMatch(button, /hubStatus|gateReady|Senkronizasyon bekleniyor/);
});

test('successful credentials navigate immediately and sync bootstrap is background-only', () => {
  const submit = block(LOGIN, "$('loginForm').addEventListener('submit'", 'async function restoreLastUser()');
  assert.match(submit, /void runUserBootstrap\(\)/);
  assert.match(submit, /location\.replace\('\/'\)/);
  assert.ok(submit.indexOf('void runUserBootstrap();') < submit.indexOf("location.replace('/');"));
  assert.doesNotMatch(submit, /await runUserBootstrap\(\)/);
});

test('main workspace route only requires a valid authenticated session', () => {
  const root = block(SERVER, "app.get('/',", 'app.use(createStaticGzip');
  assert.match(root, /if \(!profile\)/);
  assert.doesNotMatch(root, /userBootstrapReady\.has|bootstrapStatusSnapshot|loginAllowed/);
});

test('user bootstrap acknowledges the session even when Shared Hub is not ready', () => {
  const route = block(SERVER, "app.post('/api/shared-hub/user-bootstrap'", "app.post('/api/shared-hub/initialize'");
  assert.ok(route.indexOf('userBootstrapReady.add(userId)') < route.indexOf("if (gate.status !== 'ready')"));
  assert.match(route, /if \(gate\.status !== 'ready'\)[\s\S]*ok:true, ready:true[\s\S]*syncDeferred:true/);
  assert.doesNotMatch(route, /res\.status\(423\)/);
});
