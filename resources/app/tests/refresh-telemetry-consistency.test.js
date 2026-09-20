'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const REFRESH = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-refresh.js'), 'utf8');
const POWERSHELL = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'ModelQuery.ps1'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('refresh source loading is split into explicit wall-clock stages', () => {
  const load = SERVER.slice(SERVER.indexOf('async function loadFromModels'), SERVER.indexOf('async function yieldToEventLoopEvery'));
  assert.match(load, /markSourcePhase\('source-setup'\)/);
  assert.match(load, /markSourcePhase\('database'\)/);
  assert.match(load, /markSourcePhase\('antrepo-excel-refresh'\)/);
  assert.match(load, /markSourcePhase\('antrepo-excel-parse'\)/);
  assert.match(load, /markSourcePhase\('source-processing'\)/);
  assert.doesNotMatch(load, /markSourcePhase\('querying'\)/);
});

test('provider timing separates connection wait from actual server execution', () => {
  assert.match(POWERSHELL, /connectionOpenMs/);
  assert.match(POWERSHELL, /executeMs/);
  assert.match(POWERSHELL, /writeMs/);
  assert.match(POWERSHELL, /overheadMs/);
  assert.match(POWERSHELL, /retryMs/);

  const query = REFRESH.slice(REFRESH.indexOf('async function queryConnectionRows'), REFRESH.indexOf('function resolveRoleTargets'));
  assert.match(query, /connectionOpenMs: Number\(result\.connectionOpenMs\)/);
  assert.match(query, /const overheadMs = Number\(result\.overheadMs\)/);
  assert.match(query, /retryMs: Number\(result\.retryMs\)/);
});

test('refresh telemetry logs operations and exposes them through job status', () => {
  const telemetrySources = `${SERVER}\n${REFRESH}`;
  assert.match(SERVER, /\[\$\{timestamp\}\] \[\$\{connection\}\] \[\$\{operation\}\] START/);
  assert.match(SERVER, /END duration=\$\{durationMs\}/);
  assert.match(SERVER, /operations: Array\.isArray\(job\.operations\)/);
  assert.match(telemetrySources, /['"]query['"]/);
  assert.match(telemetrySources, /['"]connection-open['"]/);
  assert.match(telemetrySources, /['"]wait['"]/);
  assert.match(telemetrySources, /['"]save['"]/);
  assert.match(telemetrySources, /['"]cache['"]/);
});

test('refresh panel no longer calls the whole source load a server query', () => {
  const labels = new Function(`${APP.slice(APP.indexOf('const REFRESH_PHASE_LABELS'), APP.indexOf('function refreshPhaseLabel'))}; return REFRESH_PHASE_LABELS;`)();
  assert.equal(labels.querying, undefined);
  assert.equal(labels.database.en, 'Database operations');
  assert.equal(labels['antrepo-excel-refresh'].en, 'Antrepo Excel refresh');
  assert.equal(labels['antrepo-excel-parse'].en, 'Antrepo Excel parse');

  const body = APP.slice(APP.indexOf('function renderRefreshStagesBody'), APP.indexOf('function openRefreshStagesModal'));
  assert.match(body, /refreshSeconds\(t\.connectionOpenMs\)/);
  assert.match(body, /refreshSeconds\(t\.retryMs\)/);
  assert.match(body, /refreshSeconds\(t\.overheadMs\)/);
});

test('shared Antrepo runs are deduplicated before totals and persistence', () => {
  assert.match(REFRESH, /const uniqueRuns = values => \[\.\.\.new Map\(/);
  assert.match(REFRESH, /queryFingerprint/);
  assert.match(REFRESH, /antrepoRuns = uniqueRuns\(antrepoRuns\)/);
});

test('optional ASAS mapping discovery is persisted as a one-time migration', () => {
  const DB = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  assert.match(DB, /mappingEnhancementScanVersion/);
  assert.match(REFRESH, /mappingEnhancementScanVersion/);
  assert.match(REFRESH, /mappingEnhancementScanVersion\s*<\s*1/);
});
