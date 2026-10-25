'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-checklist-auth-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
const express = require('express');
const store = require('../server/lib/checklist-supplier-store');
const reports = require('../server/lib/test-reports/store');
const register = require('../server/routes/checklist-supplier-routes');
const profiles = {
  a: { id: 'a', displayName: 'Buyer A', enabled: true },
  b: { id: 'b', displayName: 'Buyer B', enabled: true },
  view: { id: 'view', enabled: true },
  moderator: { id: 'moderator', enabled: true, manageBusinessRules: true },
};
const orderA = '1001|MODEL-A|01', orderB = '1002|MODEL-B|02';
const metadata = key => ({ orderCode: key.split('|')[0], modelName: key.split('|')[1], colourCode: key.split('|')[2] });
const all = new Map([orderA, orderB].map(key => [key, metadata(key)]));
let revoked = false, resolveHook = () => {}, guardHook = () => {};
function allowed(profile, { write = false } = {}) {
  guardHook();
  if (revoked || write && profile.id === 'view') return new Map();
  return profile.id === 'moderator' ? all : new Map([[profile.id === 'b' ? orderB : orderA, metadata(profile.id === 'b' ? orderB : orderA)]]);
}
const app = express();
app.use((req, _res, next) => { req.currentUser = profiles[req.headers['x-test-user'] || 'a']; next(); });
register(app, {
  express, checklistSupplierStore: store,
  automationError: (res, err) => res.status(err.statusCode || 500).json({ code: err.code, error: err.message }),
  userAccess: {
    requireAnyArea: () => (_req, _res, next) => next(),
    profileById: id => profiles[id], hasArea: (profile, area) => !profile.areas || profile.areas.includes(area),
    hasPermission: (profile, permission) => Boolean(profile[permission]), appendAudit: () => {},
  },
  authorizedOrders: async (profile, options) => { const result = allowed(profile, options); await resolveHook(); return result; },
  authorizedOrdersNow: allowed,
});
let server, base;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
test.beforeEach(() => { revoked = false; resolveHook = () => {}; guardHook = () => {}; });
async function call(url = '', { user = 'a', method = 'GET', body } = {}) {
  const response = await fetch(base + '/api/checklist-supplier' + url, {
    method, headers: { 'x-test-user': user, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (response.headers.get('content-type') || '').includes('json') ? await response.json() : await response.text() };
}
const entry = (orderKey, extra = {}) => ({ orderKey, itemId: 'fabric', state: 'approved', at: '2026-10-24T00:00:00Z', ...extra });
const post = (entries, user = 'a', source = 'buyer_log') => call('/answers', { user, method: 'POST', body: { entries, source } });
function bytes() { return fs.existsSync(store.FILE) ? fs.readFileSync(store.FILE, 'utf8') : ''; }

test('HTTP reads filter answers and tombstones to live record scope', async () => {
  await store.applyEntries([entry(orderA), entry(orderB), entry(orderB, { itemId: 'cleared', state: 'open' })], profiles.moderator);
  const result = await call();
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.answers), [orderA + '::fabric']);
  assert.deepEqual(result.body.tombstones, {});
  assert.deepEqual(Object.keys((await call('', { user: 'b' })).body.answers), [orderB + '::fabric']);
});
test('foreign, nonexistent, view-only and mixed batches are rejected without writes', async () => {
  const before = bytes();
  for (const [entries, user] of [[ [entry(orderB)], 'a' ], [ [entry('missing')], 'moderator' ], [ [entry(orderA)], 'view' ], [ [entry(orderA), entry(orderB)], 'a' ]]) {
    assert.equal((await post(entries, user)).status, 403);
    assert.equal(bytes(), before);
  }
});
test('authority is rechecked after asynchronous preparation and inside the write lease', async () => {
  const before = bytes();
  resolveHook = () => { revoked = true; };
  assert.equal((await post([entry(orderA)])).status, 403);
  assert.equal(bytes(), before);
  revoked = false; resolveHook = () => {};
  // Change current scope at the guard invoked by the actual store, after route validation.
  let checks = 0;
  guardHook = () => { if (++checks >= 3) revoked = true; };
  assert.equal((await post([entry(orderA)])).status, 403);
  assert.equal(bytes(), before);
});
test('global definitions require current business-rule permission, including at commit', async () => {
  const body = { definitions: [{ id: 'demo', kind: 'checklist', name: 'Demo' }] };
  const before = bytes();
  assert.equal((await call('/definitions', { method: 'POST', body })).status, 403);
  assert.equal(bytes(), before);
  assert.equal((await call('/definitions', { user: 'moderator', method: 'POST', body })).status, 200);
});
test('attachment staging, download, linking and delete enforce owner and live order scope', async () => {
  const upload = await call('/attachments', { method: 'POST', body: { filename: 'synthetic.txt', base64: Buffer.from('synthetic evidence').toString('base64'), context: { ...metadata(orderA), orderKey: orderA } } });
  assert.equal(upload.status, 200);
  const attachment = upload.body.attachment, url = '/attachments/' + attachment.id;
  assert.equal((await call(url)).status, 200);
  assert.equal((await call(url, { user: 'b' })).status, 404);
  assert.equal((await call(url, { user: 'b', method: 'DELETE' })).status, 404);
  const before = bytes();
  assert.equal((await post([entry(orderB, { attachments: [attachment] })], 'b')).status, 403);
  assert.equal(bytes(), before);
  assert.equal((await post([entry(orderA, { attachments: [attachment] })])).status, 200);
  assert.equal((await call(url, { method: 'DELETE' })).body.deleted, false, 'referenced evidence is retained');
  revoked = true;
  assert.equal((await call(url)).status, 404, 'staging ownership cannot override revoked order access');
});
test('legacy attachments require authorized answer or test-report linkage; ambiguous files are preserved', async () => {
  const orphan = store.addAttachmentBuffer(Buffer.from('legacy'), { filename: 'legacy.txt' }, profiles.a);
  fs.rmSync(path.join(store.ATTACHMENT_ROOT, orphan.id + '.json'), { force: true });
  assert.equal((await call('/attachments/' + orphan.id)).status, 404);
  assert.ok(store.getAttachmentPath(orphan.id));
  reports.commit([{ report: { talepNo: '4400001', dosyalar: [] }, orderKey: orderA, itemId: 'fabric' }], {}, profiles.a);
  const reportState = reports.read();
  reportState.links['4400001'].files = reportState.links['4400001'].targets[0].files = [{ attachmentId: orphan.id }];
  fs.writeFileSync(reports.FILE, JSON.stringify(reportState));
  assert.equal((await call('/attachments/' + orphan.id)).status, 200);
  assert.equal((await call('/attachments/' + orphan.id, { user: 'b' })).status, 404);
  assert.equal((await call('/attachments/' + orphan.id, { method: 'DELETE' })).body.deleted, false);
});
test('authorized supplier import retains conflict timestamps and server-derived audit identity', async () => {
  const imported = await post([entry(orderA, { itemId: 'import', by: 'Forged Buyer', source: 'forged', baseAt: '2026-10-23T00:00:00Z' })], 'a', 'supplier_excel');
  assert.equal(imported.status, 200);
  const saved = store._read().answers[orderA + '::import'];
  assert.equal(saved.by, 'Buyer A'); assert.equal(saved.byId, 'a'); assert.equal(saved.source, 'supplier_excel');
  assert.equal((await post([entry(orderA, { itemId: 'import', state: 'rejected', baseAt: '2026-10-23T00:00:00Z' })], 'a', 'supplier_excel')).body.conflicts, 1);
});

test('malformed attachment lists and invalid/future event times fail before any batch effect', async () => {
  const before = bytes();
  for (const extra of [{ attachments: {} }, { at: 'invalid' }, { at: '2999-01-01' }]) {
    assert.equal((await post([entry(orderA), entry(orderA, extra)])).status, 400);
    assert.equal(bytes(), before);
  }
});
test('revoked global capability fails at the final in-lease check', async () => {
  const before = bytes(), original = store.replaceDefinitions;
  store.replaceDefinitions = (definitions, actor, options) => original(definitions, actor, { ...options, assertAuthority: () => {
    profiles.moderator.manageBusinessRules = false;
    options.assertAuthority();
  } });
  try {
    assert.equal((await call('/definitions', { user: 'moderator', method: 'POST', body: { definitions: [] } })).status, 403);
    assert.equal(bytes(), before);
  } finally { profiles.moderator.manageBusinessRules = true; store.replaceDefinitions = original; }
});

test('attachment write area revocation during preparation cannot fall back to overview', async () => {
  resolveHook = () => { profiles.a.areas = ['overview']; };
  try {
    const before = fs.readdirSync(store.ATTACHMENT_ROOT).sort();
    assert.equal((await call('/attachments', { method: 'POST', body: { filename: 'blocked.txt', base64: 'eA==', context: { orderKey: orderA } } })).status, 403);
    assert.deepEqual(fs.readdirSync(store.ATTACHMENT_ROOT).sort(), before);
  } finally { delete profiles.a.areas; }
});
