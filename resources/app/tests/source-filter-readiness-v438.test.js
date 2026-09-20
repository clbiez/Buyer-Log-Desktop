'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectSourceFilterReadiness } = require('../server/lib/source-filter-readiness');

function autoConnection(scopes) {
  return { id: 'asas-main', role: 'asas', mode: 'auto', refreshEnabled: true, scopes };
}
function scope(targets, horizon) {
  return { enabled: true, targets, horizon };
}
function conditionHorizon(values = ['W6']) {
  return {
    table: 'ASAS',
    groups: [{
      id: 'g1',
      conditions: [{ table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }],
    }],
  };
}

test('v4.38 blocks unfiltered ASAS scopes', () => {
  const status = inspectSourceFilterReadiness([
    autoConnection([scope(['cp', 'orders', 'backlog', 'lfl'], { table: 'ASAS' })]),
  ]);
  assert.equal(status.ready, false);
  assert.deepEqual(status.missingTargets, ['cp', 'orders', 'backlog', 'lfl']);
});

test('v4.38 accepts a complete condition only for the covered target', () => {
  const status = inspectSourceFilterReadiness([
    autoConnection([
      scope(['cp'], conditionHorizon(['W6'])),
      scope(['backlog'], { table: 'ASAS' }),
    ]),
  ], ['cp', 'backlog']);
  assert.equal(status.ready, false);
  assert.deepEqual(status.filteredTargets, ['cp']);
  assert.deepEqual(status.missingTargets, ['backlog']);
});

test('v4.38 rejects an unfinished condition with no selected value', () => {
  const status = inspectSourceFilterReadiness([
    autoConnection([scope(['cp'], conditionHorizon([]))]),
  ], ['cp']);
  assert.equal(status.ready, false);
  assert.deepEqual(status.missingTargets, ['cp']);
});

test('v4.38 accepts legacy season horizon and bounded manual query', () => {
  const legacy = inspectSourceFilterReadiness([
    autoConnection([scope(['cp'], { table: 'ASAS', seasonTable: 'ASAS', seasonField: 'Sezon', seasons: ['W6'] })]),
  ], ['cp']);
  assert.equal(legacy.ready, true);

  const manual = inspectSourceFilterReadiness([
    { id: 'manual', role: 'asas', mode: 'manual', refreshEnabled: true, query: 'EVALUATE FILTER(...)', scopes: [scope(['lfl'], {})] },
  ], ['lfl']);
  assert.equal(manual.ready, true);
});

test('v4.38 UI contains source-filter routing, timer and refresh animation hooks', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

  assert.match(html, /openDataSourceAndFilters\(\{target(?::[^}]+)?\}\)/);
  assert.match(html, /data-source-timer/);
  assert.match(html, /Veriler ekranlara yükleniyor/);
  assert.match(html, /veri hacmine göre bekleme süresi uzayabilir/i);
  assert.match(css, /buyerLogRefreshSpin/);
  assert.match(css, /refreshStagesOverlay/);
  assert.match(server, /loadFromModels\(id, \['lfl'\]\)/);
});
