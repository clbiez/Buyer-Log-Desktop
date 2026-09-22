'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const policy = require('../server/lib/shared-sync-policy');
const { createDeltaStore } = require('../server/lib/delta-store');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('program-wide business rules are classified as Shared Hub Master data', () => {
  const state = {
    records: {
      'store:overrides.json': {
        pricingRules:[{id:'royalty'}],
        transitRules:[{id:'road'}],
        nonDtrManufacturers:['SUP'],
        landedMultipliers:{tr:1.05,overseas:1.11},
        freightRates:{rates:[{id:'air'}]},
        antrepoMatchRule:'rule',
        antrepoMatchConfig:{conditions:[{left:'a',right:'b'}]},
        antrepoSourceMode:'database',
        asasSourceMode:'database',
        lflSourceMode:'excel',
        noteColumnDefs:[{id:'note',label:'Note'}],
        notesmap:{order:{Notes:'business row state'}},
        storeRevisionMeta:{revision:9},
      },
      'store:fx-rates.json': { months:{'202609':{TRY:42}}, storeRevisionMeta:{revision:3} },
      'endeksmatik:snapshot': { snapshot:{generatedAt:'2026-09-22T00:00:00.000Z',records:[['x']]} },
    },
  };
  const master = policy.masterRecordsFromState(state);
  assert.ok(master['store:overrides.json']);
  assert.equal(master['store:overrides.json'].pricingRules.length, 1);
  assert.equal(master['store:overrides.json'].transitRules.length, 1);
  assert.deepEqual(master['store:overrides.json'].nonDtrManufacturers, ['SUP']);
  assert.equal(master['store:overrides.json'].notesmap, undefined);
  assert.ok(master['store:fx-rates.json']);
  assert.ok(master['endeksmatik:snapshot']);
});

test('every central rule editor immediately schedules Shared Master publication', () => {
  for (const entity of [
    'pricingRules','transitRules','nonDtrManufacturers','landedMultipliers','freightRates',
    'fx','endeksmatik','antrepoMatchRule','antrepoSourceMode','asasSourceMode','lflSourceMode',
    'noteColumnDefs','modelConnections',
  ]) {
    assert.match(SERVER, new RegExp(`publishSharedMasterChange\\('${entity}'`), `${entity} must publish to Shared Master`);
  }
});

test('Master publication waits for queued delta mirrors before SYNC upload', () => {
  assert.match(SERVER, /typeof deltaStore\.flush === 'function'\) await deltaStore\.flush\(\)/);
  const flushPos = SERVER.indexOf("typeof deltaStore.flush === 'function'");
  const syncPos = SERVER.indexOf('await syncSettings.syncOnce()', flushPos);
  assert.ok(flushPos >= 0 && syncPos > flushPos);
});

test('delta flush does not resolve before the queued local journal write', async () => {
  let release;
  const localDb = {
    queuePatches: async items => new Promise(resolve => { release = () => resolve({ count:items.length }); }),
    read: async () => ({ records:{} }),
    tombstone: async () => ({}),
  };
  const store = createDeltaStore({ localDb, mode:'delta' });
  const mirror = store.mirror('store', { 'overrides.json':{ pricingRules:[{id:'r'}] } });
  await new Promise(resolve => setImmediate(resolve));
  let flushed = false;
  const flushing = store.flush().then(() => { flushed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(flushed, false);
  assert.equal(typeof release, 'function');
  release();
  await mirror;
  await flushing;
  assert.equal(flushed, true);
});

test('SYNC checkpoint repair announces changed Master entities to the running client', () => {
  assert.match(SERVER, /function changedMasterEntities\(/);
  assert.match(SERVER, /announceRecoveredMasterEntities\(recoveredMasterEntities\)/);
  assert.match(SERVER, /liveEvents\.notifyChange\(entity, null, \{ source:'shared-hub-sync' \}\)/);
});

test('running clients reload all central rule families after Shared Hub recovery', () => {
  for (const entity of [
    'nonDtrManufacturers','landedMultipliers','freightRates','antrepoMatchRule',
    'antrepoSourceMode','asasSourceMode','lflSourceMode','noteColumnDefs','modelConnections','systemSettings',
  ]) {
    assert.match(APP, new RegExp(entity), `${entity} must have a live refresh path`);
  }
  assert.match(APP, /refreshSharedMasterClient\(payload\.area\)/);
  assert.match(APP, /loadFromServer\(false\)/);
});

test('DTR policy remains derived from the shared Non-DTR manufacturer list', () => {
  assert.ok(policy.MASTER_OVERRIDE_FIELDS.has('nonDtrManufacturers'));
  assert.equal(policy.MASTER_OVERRIDE_FIELDS.has('dtrManufacturers'), false);
});
