'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const intake = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'intake-report.js'), 'utf8');

test('Overview INTAKE connection selection does not use scheduled refresh enablement as a health check', () => {
  const start = server.indexOf('function intakeConnection()');
  const end = server.indexOf('function intakeHorizon()', start);
  const block = server.slice(start, end);
  assert.match(block, /intakeConnectionSelector\.selectIntakeConnection/);
  assert.doesNotMatch(block, /refreshEnabled !== false/);
});

test('Refresh executes a capped server-side aggregate instead of a two-million-row Intake DB read', () => {
  assert.match(intake, /TOPN\(\$\{rowLimit\}/);
  assert.match(server, /maxRows: built\.maxRows/);
  assert.doesNotMatch(server, /maxRows: 2000000/);
});

test('Reset clears only the signed-in user snapshot, leaving connection metadata outside reset scope', () => {
  const start = server.indexOf("app.put('/api/intake/settings'");
  const end = server.indexOf("app.get('/api/intake/metadata'", start);
  const block = server.slice(start, end);
  assert.match(block, /intakeStore\.clearSnapshot\(req\.currentUser\.id\)/);
  assert.doesNotMatch(block, /saveModelConnections|writeModelConnections/);
});
