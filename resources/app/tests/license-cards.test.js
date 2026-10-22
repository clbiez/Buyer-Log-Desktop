'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cards = require('../server/lib/license-cards');
const registerRoutes = require('../server/routes/license-card-routes');

// Reuse the live pricing route's date/season/overlap validators without starting
// the application or loading ASAS credentials into the test process.
const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const helperSource = serverSource.slice(serverSource.indexOf('function normalizePricingRuleDate('), serverSource.indexOf("app.get('/api/landed-multipliers'"));
const validators = vm.runInNewContext(helperSource + '\n({normalizePricingRuleDate,normalizePricingRuleSeasons,pricingRuleSeasonSetsOverlap,pricingRuleDateRangesOverlap})',{require:require('node:module').createRequire(path.join(__dirname,'../server/server.js'))});
const copied = value => JSON.parse(JSON.stringify(value));
const rule = (id, opdStart, opdEnd, extra = {}) => ({ id, license: 'Marvel', licensor: 'DTR', royalty: 10, trCommission: 2, ydCommission: 3, hologramCost: 0.15, opdStart, opdEnd, seasons: [], ...extra });
function fixture(rules = []) {
  return cards.appendDiscovered({ _revision: 9, _revisions: { pricingRules: 3 }, pricingRules: rules }, [{ license: 'Marvel', licensor: 'DTR' }], '2026-01-01T00:00:00.000Z').overrides;
}

test('canonical ASAS pair discovery deduplicates casing and preserves distinct licensors', () => {
  const found = cards.discoverPairs({ module: 'cp', rows: [
    { License: 'Marvel', Licensor: 'DTR' }, { License: ' marvel ', Licensor: ' dtr ' },
    { License: 'Marvel', Licensor: 'Other' }, { License: '', Licensor: 'DTR' },
    { License: 'Disney', Licensor: 'DTR' }, { License: 'DISNEY', Licensor: 'DTR' },
  ] });
  assert.equal(found.length, 3);
  assert.deepEqual(found[1], { license: 'Marvel', licensor: 'Other' });
  assert.equal(cards.cardId('Disney', 'DTR'), cards.cardId('DISNEY', 'dtr'));
  assert.throws(() => cards.discoverPairs(null), { code: 'LICENSE_SOURCE_UNAVAILABLE' });
});

test('explicit discovery appends names while preserving existing metadata and dates', () => {
  const current = fixture(); current.licenseCards.items[0].workingNotes = 'Approved workflow';
  const refreshed = cards.appendDiscovered(current, [{ license: 'MARVEL', licensor: 'DTR' }, { license: 'Disney', licensor: 'DTR' }], '2026-03-01T00:00:00.000Z');
  assert.equal(refreshed.added, 1);
  assert.equal(refreshed.overrides.licenseCards.items[0].workingNotes, 'Approved workflow');
  assert.equal(refreshed.overrides.licenseCards.items[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(current.licenseCards.items.length, 1);
});

test('refresh resolves a uniquely known ASAS licensor without losing the existing card profile', () => {
  const current = cards.appendDiscovered({ _revisions: {} }, [{ license: 'New license', licensor: '' }]).overrides;
  const original = current.licenseCards.items[0]; original.workingNotes = 'Keep entered details';
  const updated = cards.appendDiscovered(current, [{ license: 'New license', licensor: 'New owner' }]);
  assert.equal(updated.added, 0);
  assert.equal(updated.overrides.licenseCards.items[0].id, original.id);
  assert.equal(updated.overrides.licenseCards.items[0].workingNotes, 'Keep entered details');
  assert.equal(updated.overrides.licenseCards.items[0].licensor, 'New owner');
  assert.equal(cards.discoverPairs([{ License: 'New license' }, { License: 'New license', Licensor: 'New owner' }]).length, 1);
  const ambiguous = cards.appendDiscovered(current, [{ license: 'New license', licensor: 'Owner A' }, { license: 'New license', licensor: 'Owner B' }]);
  assert.equal(ambiguous.overrides.licenseCards.items[0].licensor, '');
  assert.equal(ambiguous.added, 2);
});

test('card update preserves historical rates and unrelated license rules atomically', () => {
  const old = rule('old', '2025-01-01', '2025-12-31');
  const unrelated = rule('other', '', '', { license: 'Disney' });
  const current = fixture([old, unrelated]);
  const updated = cards.updateCard(current, current.licenseCards.items[0].id, { revision: 1, pricingRevision: 3,
    profile: { workingNotes: 'Monthly portal approval' }, rules: [rule('new', '2026-01-01', '', { trCommission: 4 })] }, validators);
  assert.equal(updated.overrides.pricingRules.length, 3);
  assert.deepEqual(updated.overrides.pricingRules[0], old);
  assert.deepEqual(updated.overrides.pricingRules[1], unrelated);
  assert.equal(updated.overrides._revisions.licenseCards, 2);
  assert.equal(updated.overrides._revisions.pricingRules, 4);
  assert.equal(updated.rulesChanged, true);
  assert.equal(current.licenseCards.items[0].workingNotes, '');
  const response = cards.responseOf(updated.overrides, true);
  assert.equal(response.cards[0].rules.length, 2);
});

test('profile-only edits preserve prices and pricing revision', () => {
  const current = fixture([rule('old', '', '')]);
  const updated = cards.updateCard(current, current.licenseCards.items[0].id, { revision: 1, profile: { artworkBrief: 'Minimal badge; await selection', portalUsername: 'buyer' } }, validators);
  assert.equal(updated.rulesChanged, false);
  assert.equal(updated.overrides._revisions.pricingRules, 3);
  assert.deepEqual(updated.overrides.pricingRules, current.pricingRules);
});

test('stale profile and price revisions fail without partially mutating the card', () => {
  const current = fixture(), id = current.licenseCards.items[0].id, snapshot = copied(current);
  assert.throws(() => cards.updateCard(current, id, { revision: 0, profile: {} }, validators), { code: 'REVISION_CONFLICT', revisionKey: 'licenseCards' });
  assert.throws(() => cards.updateCard(current, id, { profile: {} }, validators), { code: 'REVISION_REQUIRED' });
  assert.throws(() => cards.updateCard(current, id, { revision: 1, pricingRevision: 2, profile: { workingNotes: 'must not save' }, rules: [] }, validators), { code: 'REVISION_CONFLICT', revisionKey: 'pricingRules' });
  assert.deepEqual(current, snapshot);
});

test('invalid dates, bounds, overlaps and cross-license rule IDs are rejected', () => {
  const current = fixture([rule('old', '2025-01-01', '2025-12-31'), rule('other', '', '', { license: 'Disney' })]);
  const submit = incoming => cards.updateCard(current, current.licenseCards.items[0].id, { revision: 1, pricingRevision: 3, profile: {}, rules: incoming }, validators);
  for (const invalid of [rule('new', '2026-02-30', ''), rule('new', '2026-12-01', '2026-01-01'), rule('new', '2026-01-01', '', { royalty: 99 }), rule('new', '2026-01-01', '', { hologramCost: -1 }), rule('new', '2026-01-01', '', { royalty: true })]) assert.throws(() => submit([invalid]));
  assert.throws(() => submit([rule('new', '2025-12-31', '')]), { code: 'LICENSE_RULE_OVERLAP' });
  assert.throws(() => submit([rule('other', '2026-01-01', '')]), { code: 'LICENSE_RULE_SCOPE' });
  assert.throws(() => submit([rule('new', '2026-01-01', '', { license: 'Disney' })]), { code: 'LICENSE_RULE_SCOPE' });
  const split = fixture([rule('old', '2025-01-01', '', { trCommission: null, ydCommission: 2, seasons: ['Winter'] })]);
  assert.doesNotThrow(() => cards.updateCard(split, split.licenseCards.items[0].id, { revision: 1, pricingRevision: 3, profile: {}, rules: [rule('new', '2026-01-01', '', { trCommission: 2, ydCommission: null, seasons: ['Winter'] })] }, validators));
});

test('profile accepts safe portal metadata and rejects plaintext secret fields and unsafe symbols', () => {
  assert.deepEqual(cards.normalizeProfile({ portalUrl: 'https://portal.example.com', portalUsername: 'buyer', accessReference: 'Company password manager / license account' }), { portalUrl: 'https://portal.example.com', portalUsername: 'buyer', accessReference: 'Company password manager / license account' });
  for (const profile of [{ password: 'do not save' }, { portalUrl: 'javascript:alert(1)' }, { portalUrl: 'https://user:pass@example.com' }, { symbolDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, { workingNotes: 'x'.repeat(12001) }]) assert.throws(() => cards.normalizeProfile(profile));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  assert.equal(cards.validateSymbol(png), png);
  const bomb = Buffer.from(png.split(',')[1], 'base64'); bomb.writeUInt32BE(100000, 16);
  assert.throws(() => cards.validateSymbol('data:image/png;base64,' + bomb.toString('base64')), { code: 'LICENSE_SYMBOL_INVALID' });
});

function routeHarness(initial, publication = {}) {
  let store = copied(initial), reads = 0, commits = 0, sourceCalls = 0;
  const routes = new Map(), events = [], mirrored = [], audits = [];
  const guard = check => (req, res, next) => { if (check(req)) next(); else res.status(403).json({ code: 'DENIED' }); };
  const deps = { ...validators,
    loadOverrides: () => { reads++; return copied(store); },
    saveOverrides: (next, expected) => { assert.equal(expected, store._revision); commits++; store = { ...copied(next), _revision: expected + 1 }; return copied(store); },
    getLicenseDiscoveryRows: async () => { sourceCalls++; return { module: 'cp', rows: [{ License: 'Marvel', Licensor: 'DTR' }] }; },
    publishSharedMasterChange: (...args) => events.push(args), publishLicenseCardChange: async (...args) => {
      mirrored.push(args);
      if (publication.error) throw publication.error;
      return publication.result || { ok: true, pending: false };
    },
    userAccess: { requireAnyArea: () => guard(req => req.currentUser.area), requirePermission: () => guard(req => req.currentUser.edit), hasPermission: user => user.edit, appendAudit: (...args) => audits.push(args) },
  };
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (url, ...handlers) => routes.set(method + ' ' + url, handlers)]));
  registerRoutes(app, deps);
  return {
    state: () => ({ store, reads, commits, sourceCalls, events, mirrored, audits }),
    request: async (method, url, { user = { area: true, edit: false }, body = {}, id, headers = {} } = {}) => {
      const handlers = routes.get(method + ' ' + url), req = { currentUser: user, body, params: { id }, headers };
      const result = { status: 200, body: null, headers: {} }, res = { status: status => { result.status = status; return res; }, json: value => { result.body = value; return res; }, set: (key, value) => { result.headers[key] = value; return res; } };
      for (const handler of handlers) { let next = false; await handler(req, res, () => { next = true; }); if (!next) break; }
      return result;
    },
  };
}

test('GET imports exactly once and explicit refresh requires business-rule permission', async () => {
  const harness = routeHarness({ _revision: 0, _revisions: {}, pricingRules: [] });
  const first = await harness.request('get', '/api/license-cards');
  assert.equal(first.status, 200); assert.equal(first.body.cards.length, 1); assert.equal(first.body.canEdit, false);
  await harness.request('get', '/api/license-cards');
  assert.equal(harness.state().sourceCalls, 1); assert.equal(harness.state().commits, 1);
  assert.equal(harness.state().mirrored[0][1].cards.length, 1);
  const denied = await harness.request('post', '/api/license-cards/refresh');
  assert.equal(denied.status, 403); assert.equal(harness.state().sourceCalls, 1);
  const refreshed = await harness.request('post', '/api/license-cards/refresh', { user: { area: true, edit: true } });
  assert.equal(refreshed.body.added, 0); assert.equal(harness.state().sourceCalls, 2);
});

test('PUT guards permission and saves profile plus prices with a single commit', async () => {
  const harness = routeHarness(fixture()), id = harness.state().store.licenseCards.items[0].id;
  const body = { revision: 1, pricingRevision: 3, profile: { workingNotes: 'Approved' }, rules: [rule('new', '2026-01-01', '')] };
  assert.equal((await harness.request('put', '/api/license-cards/:id', { id, body })).status, 403);
  assert.equal(harness.state().commits, 0);
  const response = await harness.request('put', '/api/license-cards/:id', { id, body, user: { area: true, edit: true } });
  assert.equal(response.status, 200); assert.equal(harness.state().commits, 1);
  assert.equal(harness.state().store.licenseCards.items[0].workingNotes, 'Approved');
  assert.equal(harness.state().store.pricingRules.length, 1);
  assert.deepEqual(harness.state().events.map(event => event[0]), ['licenseCards', 'pricingRules']);
  assert.equal(harness.state().mirrored[0][1].contracts.length, 1);
  const stale = await harness.request('put', '/api/license-cards/:id', { id, body, user: { area: true, edit: true } });
  assert.equal(stale.status, 409); assert.equal(harness.state().commits, 1);
});

test('failed peer publication retains profile/contracts in an atomic durable outbox and signals pending', async () => {
  const harness = routeHarness(fixture(), { result: { ok: false, pending: true } });
  const id = harness.state().store.licenseCards.items[0].id;
  const response = await harness.request('put', '/api/license-cards/:id', { id, user: { id: 'authorized-editor', area: true, edit: true },
    body: { revision: 1, pricingRevision: 3, profile: { workingNotes: 'Retained offline' }, rules: [rule('pending-rule', '2026-01-01', '')] } });
  assert.equal(response.status, 200); assert.equal(response.body.syncPending, true);
  assert.equal(harness.state().commits, 1);
  assert.equal(harness.state().store.licenseCards.items[0].workingNotes, 'Retained offline');
  assert.ok(Object.keys(harness.state().store.licenseCardOutbox).length);
  const serialized = JSON.stringify(harness.state().store.licenseCardOutbox);
  assert.ok(serialized.includes('pending-rule')); assert.ok(serialized.includes('Retained offline')); assert.ok(serialized.includes('authorized-editor'));
  assert.equal((await harness.request('get', '/api/license-cards')).body.syncPending, true);
});

test('an initial import keeps discovered cards pending when the transport throws', async () => {
  const harness = routeHarness({ _revision: 0, _revisions: {}, pricingRules: [] }, { error: new Error('Hub offline') });
  const response = await harness.request('get', '/api/license-cards', { user: { id: 'reader', area: true, edit: false } });
  assert.equal(response.status, 200); assert.equal(response.body.syncPending, true);
  assert.equal(response.body.cards.length, 1); assert.equal(harness.state().commits, 1);
  assert.ok(JSON.stringify(harness.state().store.licenseCardOutbox).includes('Marvel'));
});

test('card edit tokens permit unrelated card/rate changes but reject changes to the opened card atomically', () => {
  let current = fixture([rule('opened', '', ''), rule('other', '', '', { license: 'Disney' })]);
  const opened = cards.responseOf(current, true).cards[0];
  assert.match(opened.editToken, /^[a-f0-9]{64}$/);
  current = cards.appendDiscovered(current, [{ license: 'Disney', licensor: 'DTR' }]).overrides;
  current.pricingRules[1].royalty = 15; current._revisions.pricingRules++;
  const body = { revision: 1, pricingRevision: 3, editToken: opened.editToken, profile: { workingNotes: 'My draft' }, rules: [{ ...opened.rules[0], royalty: 12 }] };
  const updated = cards.updateCard(current, opened.id, body, validators);
  assert.equal(updated.overrides.pricingRules.find(r => r.id === 'other').royalty, 15);
  assert.equal(updated.card.workingNotes, 'My draft');
  assert.throws(() => cards.updateCard(updated.overrides, opened.id, body, validators), { code: 'REVISION_CONFLICT' });
  const remote = copied(current); remote.pricingRules[0].royalty = 18;
  const snapshot = copied(remote);
  assert.throws(() => cards.updateCard(remote, opened.id, body, validators), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(remote, snapshot);
  assert.throws(() => cards.updateCard(current, opened.id, {...body, editToken: ''}, validators), {code:'REVISION_CONFLICT'});
});

test('card tokens ignore import bookkeeping and rule object key order', () => {
  const current = fixture([rule('opened', '', '')]), before = cards.responseOf(current, true).cards[0];
  const refreshed = cards.appendDiscovered(current, []).overrides;
  refreshed.licenseCards.items[0].updatedAt = '2026-10-19';
  refreshed.pricingRules[0] = Object.fromEntries(Object.entries(refreshed.pricingRules[0]).reverse());
  assert.equal(cards.responseOf(refreshed, true).cards[0].editToken, before.editToken);
});

test('HTTP request client identity reaches both profile and pricing notifications', async () => {
  const harness = routeHarness(fixture()), id = harness.state().store.licenseCards.items[0].id;
  const response = await harness.request('put', '/api/license-cards/:id', {id, user:{id:'editor',area:true,edit:true}, headers:{'x-client-id':'editing-tab'}, body:{revision:1,pricingRevision:3,profile:{workingNotes:'Saved'},rules:[rule('new','','')]}});
  assert.equal(response.status, 200);
  assert.equal(harness.state().events.length, 2);
  for(const event of harness.state().events)assert.equal(event[1].headers['x-client-id'], 'editing-tab');
});

test('licensor and stage-template routes are guarded, commit once and report what changed', async () => {
  const harness = routeHarness(fixture()), edit = { area: true, edit: true }, id = harness.state().store.licenseCards.items[0].id;
  const token = () => cards.responseOf(harness.state().store, true).cards.find(card => card.id === id).editToken;
  const add = { editToken: token(), licensor: 'Second Owner', mode: 'add', copy: true };
  assert.equal((await harness.request('put', '/api/license-cards/:id/licensor', { id, body: add })).status, 403);
  const added = await harness.request('put', '/api/license-cards/:id/licensor', { id, body: add, user: edit });
  assert.equal(added.status, 200); assert.ok(added.body.cardId && added.body.cardId !== id);
  assert.equal(harness.state().audits.at(-1)[1], 'LICENSE_CARD_LICENSOR');
  const locked = await harness.request('put', '/api/license-cards/:id/licensor', { id, body: { editToken: token(), licensor: 'Other' }, user: edit });
  assert.equal(locked.status, 400); assert.equal(locked.body.code, 'LICENSE_LICENSOR_LOCKED');
  const template = { id: 'tpl-route', name: 'Route template', stage: { title: 'PPS', approver: 'LCW', submissions: [] } };
  assert.equal((await harness.request('post', '/api/license-cards/stage-templates', { body: { template } })).status, 403);
  const saved = await harness.request('post', '/api/license-cards/stage-templates', { body: { template }, user: edit });
  assert.equal(saved.status, 200); assert.equal(saved.body.propagated, 0); assert.equal(saved.body.stageTemplates[0].name, 'Route template');
  assert.ok(harness.state().mirrored.some(call => call[1] && call[1].stageTemplates), 'templates are published to peers');
});
