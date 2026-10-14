'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function refreshRoute() {
  // The async source policy lives in the shared native start that the route delegates to.
  const start = SERVER.indexOf('function startNativeRefresh(');
  assert.ok(SERVER.indexOf("app.post('/api/refresh'") > start, 'route follows the shared native start');
  const end = SERVER.indexOf("app.post('/api/overrides/batch'", start);
  assert.ok(start >= 0 && end > start, 'refresh route bulunmalı');
  return SERVER.slice(start, end);
}

test('dashboard refresh respects all configured source modes', () => {
  const route = refreshRoute();
  assert.match(route, /const refreshOverrides\s*=\s*loadOverrides\(\)/);
  assert.match(route, /selectedAsasMode\s*=\s*refreshOverrides\.asasSourceMode\s*===\s*'database'\s*\?\s*'database'\s*:\s*'excel'/);
  assert.match(route, /selectedLflMode\s*=\s*refreshOverrides\.lflSourceMode\s*===\s*'database'\s*\?\s*'database'\s*:\s*'excel'/);
  assert.match(route, /selectedAntrepoMode\s*=\s*\['database',\s*'dashboard'\]\.includes\(refreshOverrides\.antrepoSourceMode\)/);
  assert.match(route, /sourcePolicy:\{asasMode:selectedAsasMode,antrepoMode:selectedAntrepoMode,lflMode:selectedLflMode\}/);
});

test('refresh route no longer forces ASAS and LFL to database', () => {
  const route = refreshRoute();
  assert.doesNotMatch(route, /sourcePolicy:\{asasMode:'database',antrepoMode:[^,]+,lflMode:'database'\}/);
});

