'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
const login = fs.readFileSync(path.join(APP, 'public', 'select-user.html'), 'utf8');
const distribution = fs.readFileSync(path.join(APP, 'server', 'lib', 'model-image-distribution.js'), 'utf8');

test('Shared Hub startup continues fully but never gates authenticated login', () => {
  assert.match(server, /await syncSettings\.syncOnce\(\)/);
  assert.match(server, /await deltaStore\.hydrate\(\)/);
  assert.match(server, /await hydrateBusinessCheckpointIfNeeded\(\)/);
  assert.match(server, /await collectionPermissionsReady/);
  assert.match(server, /completed:false/);
  assert.match(server, /completed:true/);
  const loginRoute = server.slice(server.indexOf("app.post('/api/user-login'"), server.indexOf("app.post('/api/user-logout'"));
  assert.doesNotMatch(loginRoute, /BOOTSTRAP_IN_PROGRESS|BOOTSTRAP_NOT_READY/);
  assert.doesNotMatch(login, /Senkronizasyon bekleniyor/);
  assert.match(login, /void runUserBootstrap\(\)/);
  assert.ok(login.indexOf('void runUserBootstrap();') < login.indexOf("location.replace('/');"));
});

test('main workspace requires authentication only; all sync layers are non-blocking', () => {
  assert.match(server, /const userBootstrapReady = new Set\(\)/);
  assert.match(server, /const userId = String\(req\.currentUser\.id\)/);
  assert.match(server, /userBootstrapReady\.add\(userId\)/);
  assert.match(server, /if \(gate\.status !== 'ready'\)[\s\S]{0,600}ok:true, ready:true/);
  assert.match(server, /void syncAuthorizedCollectionImages\(userId\)\.then/);
  assert.match(server, /collectionImages:\{ status:'deferred', blocking:false/);
  assert.doesNotMatch(server, /COLLECTION_BOOTSTRAP_INCOMPLETE/);
  const rootRoute = server.slice(server.indexOf("app.get('/',"), server.indexOf('app.use(createStaticGzip', server.indexOf("app.get('/',")));
  assert.match(rootRoute, /if \(!profile\)/);
  assert.doesNotMatch(rootRoute, /userBootstrapReady\.has/);
  assert.match(rootRoute, /redirect\(302, '\/select-user'\)/);
});

test('Shared Hub image transport is Collection-only and owner namespaced', () => {
  assert.match(server, /canonicalKey: 'collection:' \+ owner \+ ':'/);
  assert.match(server, /sourceIdentityPrefix:'collection:'/);
  assert.match(server, /dropNonMatching:true/);
  assert.match(server, /allowShared: false/);
  assert.match(server, /model-images\/shared\/sync'[\s\S]{0,180}requireArea\('koleksiyon'\)/);
  assert.match(server, /collectionWorkspaceWithLocalImages/);
  assert.match(server, /_sharedCollectionImageUrl/);
  assert.doesNotMatch(server, /replaceWorkspaceReplica\(owner, \{ \.\.\.workspace, rows:nextRows \}\)/);
  assert.match(distribution, /options\.allowShared !== false/);
});

test('receiver-local Collection image URLs never enter persistent workspace data or global image registry', () => {
  const app = fs.readFileSync(path.join(APP, 'public', 'app-main.js'), 'utf8');
  assert.match(app, /function kolPersistableRow\(row\)/);
  assert.match(app, /delete next\._sharedCollectionImageUrl/);
  assert.match(app, /rows:kolRows\.map\(kolPersistableRow\)/);
  assert.match(app, /if\(row&&row\._sharedCollectionImageUrl\)continue/);
  assert.match(app, /sharedCollectionImageSource=String\(r&&r\._sharedCollectionImageUrl\|\|''\)/);
});

test('CP and Orders do not hydrate model images from Shared Hub', () => {
  assert.match(server, /scopeUsesSharedImages\(plmJobScope\(req\)\)/);
  assert.match(server, /allowShared: false/);
  assert.doesNotMatch(server, /model-images\/shared\/sync'[\s\S]{0,220}requireAnyArea\([^\n]*cp[^\n]*orders/);
});
