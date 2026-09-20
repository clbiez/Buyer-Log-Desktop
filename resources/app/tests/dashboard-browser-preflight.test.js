'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

function bodyBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing ${endNeedle}`);
  return source.slice(start, end);
}

test('Dashboard browser preflight happens before ASAS/model loading', () => {
  const body = bodyBetween(SERVER, 'async function performRefresh(', '\nfunction ');
  const preflight = body.indexOf('ensureDashboardSession');
  const load = body.indexOf('loadFromModels');
  assert.ok(preflight > -1, 'performRefresh must preflight the Dashboard browser session');
  assert.ok(preflight < load, 'Dashboard preflight must happen before long ASAS/model loading');
});

test('Dashboard import consumes the preflight session through the shared manager', () => {
  const body = bodyBetween(SERVER, 'async function loadAntrepoFromDashboard(', '\nasync function ');
  assert.match(body, /await browserIntegrationManager\.ensureDashboardSession\(id, \{ session:options\.dashboardSession \}\)/);
  assert.doesNotMatch(body, /agentBrowserConnector\.openPowerBiImportDashboardSession/);
});

test('active Edge connection path never launches a managed profile', () => {
  const body = bodyBetween(CONNECTOR, 'async function connectPreferredEdge(', '\nfunction openExistingEdgeDebugSetup');
  assert.doesNotMatch(body, /launchManagedEdge|managedFallbackEnabled|user-data-dir/);
  assert.doesNotMatch(body, /PLM Link ve Görsellerini Bul/i);
});

test('existing Edge prerequisite distinguishes a closed browser from missing consent', () => {
  const body = bodyBetween(CONNECTOR, 'async function connectPreferredEdge(', '\nfunction openExistingEdgeDebugSetup');
  assert.match(body, /EDGE_NOT_RUNNING/);
  assert.match(CONNECTOR, /function edgeProcessRunning\(\)/);
});
