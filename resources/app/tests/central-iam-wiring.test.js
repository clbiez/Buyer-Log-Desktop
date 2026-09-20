'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('central IAM is feature-flagged and exposes health, refresh, migration and bulk routes', () => {
  const example = JSON.parse(read('config.example.json'));
  const server = read('server/server.js');

  assert.equal(example.centralIamEnabled, false);
  for (const route of [
    '/api/iam/health',
    '/api/iam/refresh',
    '/api/iam/migration/dry-run',
    '/api/iam/initialize',
    '/api/iam/users/bulk',
  ]) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
});

test('sessions carry IAM invalidation revisions and management UI surfaces sync state', () => {
  const access = read('server/lib/user-access.js');
  const management = read('public/user-management.js');
  const clientAccess = read('public/user-access-ui.js');

  assert.match(access, /credentialRevision/);
  assert.match(access, /accessRevision/);
  assert.match(management, /Read-only \/ offline/);
  assert.match(management, /expectedRevision/);
  assert.match(clientAccess, /bl:iam-revision-available/);
});


