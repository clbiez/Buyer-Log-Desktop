'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shared-master-v977-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tempRoot, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(tempRoot, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(tempRoot, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(tempRoot, 'config.json');

const db = require('../server/db');
const emailGroups = require('../server/lib/email-groups-store');
const server = require('./helpers/server-source')();
const app = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const fx = fs.readFileSync(path.join(ROOT, 'public/fx.js'), 'utf8');
const emailGroupsClient = fs.readFileSync(path.join(ROOT, 'public/email-groups.js'), 'utf8');
const endeksmatik = fs.readFileSync(path.join(ROOT, 'server/lib/endeksmatik.js'), 'utf8');
const deltaStore = fs.readFileSync(path.join(ROOT, 'server/lib/delta-store.js'), 'utf8');
const endeksmatikApi = require('../server/lib/endeksmatik');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('FX is one shared master dataset for all users and retains the canonical revision', () => {
  const saved = db.saveFx({
    base: 'USD',
    currencies: ['EUR'],
    months: { '2026-09': { EUR: 0.91 } },
    sourceType: 'UPLOAD',
  }, 0, 'user-a');

  const seenByOtherUser = db.loadFx('user-b');
  assert.deepEqual(seenByOtherUser.currencies, ['EUR']);
  assert.deepEqual(seenByOtherUser.months, { '2026-09': { EUR: 0.91 } });
  assert.equal(seenByOtherUser._revision, saved._revision);
});

test('concurrent Transit edits to different routes are merged, while the same route conflicts deterministically', () => {
  const baseRules = [
    { id: 'route-a', exfStart: '', exfEnd: '', seasons: [], countries: ['China'], delType: 'sea', days: 30 },
    { id: 'route-b', exfStart: '', exfEnd: '', seasons: [], countries: ['Germany'], delType: 'road', days: 5 },
  ];
  const initial = db.replaceTransitRules(baseRules, 0);
  const aView = initial.rules.map(rule => ({ ...rule }));
  const bView = initial.rules.map(rule => ({ ...rule }));

  const aSaved = db.replaceTransitRules(aView.map(rule => rule.id === 'route-a' ? { ...rule, days: 34 } : rule), initial.revision, aView);
  const bSaved = db.replaceTransitRules(bView.map(rule => rule.id === 'route-b' ? { ...rule, days: 6 } : rule), initial.revision, bView);
  assert.deepEqual(Object.fromEntries(bSaved.rules.map(rule => [rule.id, rule.days])), { 'route-a': 34, 'route-b': 6 });

  const cView = initial.rules.map(rule => ({ ...rule }));
  assert.throws(() => db.replaceTransitRules(cView.map(rule => rule.id === 'route-a' ? { ...rule, days: 40 } : rule), initial.revision, cView), /değiş|revision|çakış/i);
});

test('concurrent E-Mail Group creates preserve different records', () => {
  const initial = emailGroups.saveStore(emailGroups.defaultStore());
  const actorA = { id: 'user-a', name: 'User A' };
  const actorB = { id: 'user-b', name: 'User B' };
  emailGroups.createRecord({ manufacturer: 'TEST SUPPLIER A', email: 'a@example.test' }, actorA, initial._revision);
  emailGroups.createRecord({ manufacturer: 'TEST SUPPLIER B', email: 'b@example.test' }, actorB, initial._revision);
  assert.deepEqual(emailGroups.loadStore().records.map(record => record.manufacturer).sort(), ['TEST SUPPLIER A', 'TEST SUPPLIER B']);
});

test('Endeksmatik snapshot is mirrored through the existing delta sync store', () => {
  assert.match(endeksmatik, /function attachDeltaStore\(store\)/);
  assert.match(endeksmatik, /documents\.read\(DOCUMENT_ID\)/);
  assert.match(endeksmatik, /documents\.mirror\(DOCUMENT_ID, toSharedDocument\(snapshot\)\)/);
  assert.match(endeksmatik, /function toSharedDocument\(snapshot\)/);
  assert.match(endeksmatik, /function fromSharedDocument\(document\)/);
  assert.match(server, /endeksmatik\.attachDeltaStore\(deltaStore\)/);
  assert.match(server, /endeksmatik\.seedMissing\(deltaStore\)/);
});

test('Endeksmatik upload returns the snapshot it just accepted when delta storage is authoritative', () => {
  assert.match(endeksmatik, /function publicStatusForSnapshot\(snapshot,usingDefault=false\)/);
  assert.match(endeksmatik, /return publicStatusForSnapshot\(snapshot,false\);/);
});

test('Endeksmatik upload waits for an authoritative delta write before it acknowledges success', () => {
  assert.match(deltaStore, /return Promise\.resolve\(store\.mirror\(collection, \{ \[id\]: toDocumentRecord\(value\) \}, options\)\)/);
  assert.match(endeksmatik, /const mirrored=await documents\.mirror\(DOCUMENT_ID, toSharedDocument\(snapshot\)\);/);
  // v7.0.172: üçüncü argüman (set etiketi/yükleyen) eklendi; await korunur.
  assert.match(server, /const status = await endeksmatik\.importWorkbookBuffer\(buffer, filename(?:, \{ label, actor \})?\);/);
});

test('Endeksmatik cannot acknowledge a delta-only snapshot before its journal write resolves', async () => {
  let resolveMirror;
  const mirrorDone = new Promise(resolve => { resolveMirror = resolve; });
  endeksmatikApi.attachDeltaStore({
    isAuthoritative: true,
    writesLegacy: false,
    readAllSync: () => ({}),
    mirror: async () => { await mirrorDone; return { ok: true, count: 1 }; },
  });
  const save = endeksmatikApi.saveSnapshot({ schemaVersion: 1, months: ['202609'], fx: { '202609': 41.2 }, records: [], generatedAt: '2026-09-09T00:00:00.000Z' });
  let completed = false;
  void save.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  resolveMirror();
  const status = await save;
  assert.equal(status.generatedAt, '2026-09-09T00:00:00.000Z');
  endeksmatikApi.attachDeltaStore(null);
});

test('Endeksmatik reads the whole snapshot from one delta document field', () => {
  const snapshot = { schemaVersion: 1, months: ['202610'], fx: { '202610': 42.1 }, records: [], generatedAt: '2026-10-01T00:00:00.000Z' };
  endeksmatikApi.attachDeltaStore({
    isAuthoritative: true,
    writesLegacy: false,
    readAllSync: () => ({ snapshot: { snapshot } }),
    mirror: async () => ({ ok: true, count: 1 }),
  });
  assert.equal(endeksmatikApi.loadSnapshot({ force: true }).snapshot.generatedAt, snapshot.generatedAt);
  endeksmatikApi.attachDeltaStore(null);
});

test('a stale browser FX cache cannot overwrite a populated shared master dataset', () => {
  assert.match(fx, /serverHasValues/);
  assert.doesNotMatch(fx, /fxStamp\(local\)>fxStamp\(server\)/);
});

test('an offline FX edit is retained with its base revision and retried without bypassing conflicts', () => {
  assert.match(fx, /const FX_PENDING_KEY='buyerlog\.fx\.pending\.v1';/);
  assert.match(fx, /fxPendingWrite\(\{data:shaped,expectedRevision\}\)/);
  assert.match(fx, /requestSave\(pending\.data,pending\.expectedRevision\)/);
});

test('a queued FX edit is replayed after reconnect with its original revision', async () => {
  const values = new Map();
  let online = false;
  const context = {
    BLStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    window: { BL_CLIENT_ID: 'device-a', addEventListener() {}, dispatchEvent() {} },
    fetch: async (_url, options = {}) => {
      if (options.method === 'PUT') {
        if (!online) throw new TypeError('network unavailable');
        return { ok: true, statusText: 'OK', json: async () => ({ ...JSON.parse(options.body), _revision: 1 }) };
      }
      return { ok: true, json: async () => ({ base: 'USD', currencies: [], months: {}, _revision: 0 }) };
    },
    console, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, RegExp, Error, TypeError, Promise,
  };
  vm.createContext(context);
  vm.runInContext(fx, context);
  await context.window.BLFX.save({ base: 'USD', currencies: ['TRY'], months: { '2026-09': { TRY: 41.2 } } });
  assert.ok(values.get('buyerlog.fx.pending.v1'));
  online = true;
  await context.window.BLFX.load(true);
  assert.equal(values.get('buyerlog.fx.pending.v1'), undefined);
  assert.equal(context.window.BLFX.store._revision, 1);
});

test('shared master writes carry the existing client identity for audit and self-event handling', () => {
  assert.match(fx, /'X-Client-Id':window\.BL_CLIENT_ID/);
  assert.match(app, /'X-Client-Id':window\.BL_CLIENT_ID/);
  assert.match(emailGroupsClient, /'X-Client-Id':window\.BL_CLIENT_ID/);
});

test('all central master rule writes publish immediately to Shared Hub', () => {
  for (const entity of [
    'fx', 'endeksmatik', 'pricingRules', 'transitRules', 'nonDtrManufacturers',
    'landedMultipliers', 'freightRates', 'emailGroups', 'antrepoSourceMode',
    'asasSourceMode', 'lflSourceMode', 'antrepoMatchRule', 'modelConnections',
    'noteColumnDefs',
  ]) {
    assert.match(server, new RegExp(`publishSharedMasterChange\\('${entity}'`), `${entity} should publish a shared-master update`);
  }
});

test('master checkpoint publication waits for queued delta mirrors before sync/upload', () => {
  const deltaStoreSource = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'delta-store.js'), 'utf8');
  assert.match(deltaStoreSource, /async function flush\(\)/);
  assert.match(deltaStoreSource, /await mirrorTail\.catch\(\(\) => \{\}\)/);
  assert.match(server, /if \(typeof deltaStore\.flush === 'function'\) await deltaStore\.flush\(\)/);
});

test('Shared Hub master recovery announces repaired central rule categories to the running client', () => {
  assert.match(server, /function changedMasterEntities\(remoteRecords, localRecords, ids\)/);
  const block = server.slice(
    server.indexOf('function changedMasterEntities('),
    server.indexOf('function announceRecoveredMasterEntities('),
  );
  for (const entity of [
    'pricingRules', 'transitRules', 'nonDtrManufacturers', 'landedMultipliers',
    'freightRates', 'antrepoSourceMode', 'asasSourceMode', 'lflSourceMode',
    'noteColumnDefs', 'antrepoMatchRule', 'modelConnections', 'fx',
    'emailGroups', 'endeksmatik',
  ]) {
    assert.match(block, new RegExp(entity), `${entity} should be classified for announcement after master cache repair`);
  }
  assert.match(server, /announceRecoveredMasterEntities\(recoveredMasterEntities\)/);
});

test('active clients refresh shared master caches without a restart', () => {
  for (const entity of ['fx', 'endeksmatik', 'transitRules', 'emailGroups']) {
    assert.match(app, new RegExp(`changed\\.has\\('${entity}'`), `${entity} should have a remote-refresh path`);
  }
});
