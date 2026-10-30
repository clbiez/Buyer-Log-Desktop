'use strict';

// Refresh menu / shared-view regression: cached scopes are not a reliable source
// of ASAS linked membership after users switch views or complete partial refreshes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const targets = ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'];
const defaults = ['orders', 'backlog', 'lfl', 'priceanalysis'];
const section = (s, begin, end) => {
  const a = s.indexOf(begin);
  const b = s.indexOf(end, a + begin.length);
  assert.ok(a !== -1 && b > a, 'Expected source section: ' + begin);
  return s.slice(a, b);
};

test('server menu membership and refresh expansion share current ASAS settings', () => {
  const config = { items: [{ role: 'asas', refreshEnabled: true, linkedTargets: ['orders', 'lfl'] }] };
  const context = {
    loadModelConnections: () => config,
    LINKED_TARGETS: defaults,
    linkedTargetsOf: item => item.linkedTargets,
    withRefreshTargets: (requested, linked) =>
      [...new Set([...requested, ...(requested.some(t => linked.includes(t)) ? linked : [])])],
  };
  vm.createContext(context);
  vm.runInContext(section(server, 'function configuredRefreshMembers() {', 'const cpCoverage'),
    context);
  assert.deepEqual(Array.from(context.configuredRefreshMembers()), ['orders', 'lfl']);
  assert.deepEqual(Array.from(context.refreshTargetsFor(['lfl'])), ['lfl', 'orders']);
  assert.deepEqual(Array.from(context.refreshTargetsFor(['cp'])), ['cp']);

  config.items[0].linkedTargets = ['cp', 'backlog'];
  assert.deepEqual(Array.from(context.configuredRefreshMembers()), ['cp', 'backlog']);
  assert.deepEqual(Array.from(context.refreshTargetsFor(['cp'])), ['cp', 'backlog']);
  config.items[0].linkedTargets = [];
  assert.deepEqual(Array.from(context.configuredRefreshMembers()), [],
    'Explicitly unlinked modules must remain unlinked');
  config.items = [];
  assert.deepEqual(Array.from(context.configuredRefreshMembers()), defaults,
    'Legacy missing source falls back to defaults');
});

test('client ignores stale shared view/snapshot and uses fresh server membership', async () => {
  let membership = ['orders', 'lfl'];
  const context = {
    ALL_REFRESH_TARGETS: targets, DEFAULT_LINKED_REFRESH_TARGETS: defaults,
    appLang: 'tr',
    state: { modelScopes: [{ target: 'cp', sharedFilter: true }] },
    fetch: async () => ({ ok: true, json: async () => ({ linkedTargets: membership }) }),
    renderHorizonBadges: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    section(app, 'let authoritativeLinkedRefreshTargets=null;', 'function withLinkedRefreshTargets'),
    context);
  assert.deepEqual(Array.from(context.linkedRefreshMembers()), defaults);
  await context.syncLinkedRefreshMembers();
  assert.deepEqual(Array.from(context.linkedRefreshMembers()), membership,
    'Stale sharedFilter snapshot must not join CP to the linked group');
  membership = ['cp', 'backlog'];
  await context.syncLinkedRefreshMembers();
  assert.deepEqual(Array.from(context.linkedRefreshMembers()), membership,
    'Saved configuration updates must be read without refreshing data');
  membership = [];
  await context.syncLinkedRefreshMembers();
  assert.deepEqual(Array.from(context.linkedRefreshMembers()), []);
});

test('server errors do not silently show an incorrect group or start a refresh', async () => {
  const context = {
    ALL_REFRESH_TARGETS: targets, DEFAULT_LINKED_REFRESH_TARGETS: defaults,
    appLang: 'tr', renderHorizonBadges: () => {},
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Erişim engellendi' }) }),
  };
  vm.createContext(context);
  vm.runInContext(
    section(app, 'let authoritativeLinkedRefreshTargets=null;', 'function withLinkedRefreshTargets'),
    context);
  await assert.rejects(context.syncLinkedRefreshMembers(), /Erişim engellendi/);
  const load = section(app, 'async function loadFromServer(force, targets){', 'const refreshTimerKey=');
  assert.match(load, /if\(force&&Array\.isArray\(targets\)&&targets\.length\)/);
  assert.match(load, /await syncLinkedRefreshMembers\(\)/);
  assert.match(load, /catch\(error\)[\s\S]*?return false;/);
});

test('menu waits for canonical configuration and ignores stale timestamp strings', () => {
  const menu = section(app, 'async function openTopRefreshMenu(anchor){', '// Yenileme sürerken aynı düğmeye tekrar basmak');
  assert.match(menu, /await syncLinkedRefreshMembers\(\)/);
  assert.match(menu, /requestSequence!==topRefreshMenuSequence/);
  assert.match(menu, /const members=linkedRefreshMembers\(\)/);
  assert.match(menu, /map\(value=>new Date\(value\)\.getTime\(\)\)\.filter\(Number\.isFinite\)/);
  assert.match(menu, /if\(!times\.length\)/);
  // v2026-10-30: "Diğer modüller + CP" satırı bütün modülleri kapsar; ayrı "Tümü" yok.
  assert.match(menu, /options\.push\(\['linked',/);
  assert.doesNotMatch(menu, /options\.push\(\['all'/);
  assert.match(server, /app\.get\('\/api\/refresh-targets', userAccess\.requireArea\('source'\)/);
  assert.match(server, /Cache-Control', 'no-store, no-cache, must-revalidate'/);
});
