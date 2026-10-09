'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../server/lib/collection-image-sync-policy');
const leases = require('../server/lib/model-image-refresh-leases');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

test('kişisel CP/Orders ve paylaşılmamış Koleksiyon 1.000 görselde dahi ağ kilidi açmaz', async () => {
  for (const ownerId of ['', 'u1']) {
    let networkCalls = 0;
    const requests = Array.from({ length: 1000 }, (_, i) => ({ key: 'plm:' + i }));
    const result = await leases.acquireCollectionRefreshLeases(requests, {
      ownerId, eligibleKeys: new Set(), available: async () => { networkCalls++; return true; },
      acquire: async () => { networkCalls++; throw new Error('SMB should not be touched'); },
    });
    assert.equal(networkCalls, 0);
    assert.equal(result.held.length, requests.length);
    assert.equal(result.protectedCount, 0);
    assert.equal((await result.release()).released, 0);
  }
  assert.match(source, /eligibleSharedKeys = collectionShareableImageKeys\(req\.currentUser\.id, plmJobScope\(req\)\)/);
  assert.match(source, /if \(!modelImageDistribution\.status\(\)\.pendingPublish\) return/);
});

test('Koleksiyon kapsamı sadece erişim verilmiş sahibin gerçek PLM satırlarıdır', () => {
  const workspace = { rows: [
    { id:1, plmId:'101', ccode:'RED', colour:'Red' },
    { id:2, 'PLM ID':'102', 'Renk Kodu':'BLU', Renk:'Blue' },
    { id:3, colour:'No PLM', imgRef:'ci_manual' },
  ] };
  const keys = policy.workspaceModelImageKeys(workspace, row => 'plm:' + row.plmId + ':' + row.colourCode);
  assert.deepEqual([...keys].sort(), ['plm:101:RED', 'plm:102:BLU']);
  assert.equal(policy.shouldPublishOwnerImages([{ownerId:'a',granteeId:'b',level:'view'}],'a'), true);
  assert.equal(policy.shouldPublishOwnerImages([{ownerId:'a',granteeId:'b',level:'none'}],'a'), false);
  const implicit = policy.workspaceSharedImageItems(workspace);
  assert.equal(implicit.length, 2, 'imgRef olmadan da kayıtlı PLM modeli paylaşılan güncellemeyi alabilir');
  assert.equal(implicit[0].imageRef, '');
  assert.match(source, /collectionShareableImageKeys\(owner, 'koleksiyon'\)/);
  assert.match(source, /COLLECTION_ACCESS_DENIED/);
});

for (const size of [129, 500, 1000]) {
  test(size + ' model / yavaş OneDrive: kira edinme ve bırakma 8 eşzamanlıyı geçmez', async () => {
    const items = Array.from({ length: size }, (_, i) => ({ key: 'plm:' + i }));
    const eligibleKeys = new Set(items.map(item => item.key));
    let activeAcquires = 0, peakAcquires = 0, activeReleases = 0, peakReleases = 0;
    let obtained = 0, released = 0, availableCalls = 0;
    const keys = new Set();
    const started = Date.now();
    const result = await leases.acquireCollectionRefreshLeases(items, {
      ownerId:'owner-1', eligibleKeys, concurrency:8,
      available: async () => { availableCalls++; return true; },
      acquire: async key => {
        keys.add(key);
        activeAcquires++; peakAcquires = Math.max(peakAcquires, activeAcquires);
        await wait(3);
        activeAcquires--;
        obtained++;
        return { acquired:true, release: async () => {
          activeReleases++; peakReleases = Math.max(peakReleases, activeReleases);
          await wait(3);
          activeReleases--; released++;
        } };
      },
    });
    assert.equal(availableCalls, 1);
    assert.equal(result.held.length, size);
    assert.equal(result.protectedCount, size);
    assert.equal(result.busy.length, 0);
    assert.equal(keys.size, size);
    assert.ok([...keys].every(key => key.startsWith('collection:owner-1:')));
    const report = await result.release();
    assert.deepEqual(report, {released:size,errors:0});
    assert.equal(obtained, size);
    assert.equal(released, size);
    assert.ok(peakAcquires >= 2 && peakAcquires <= 8, String(peakAcquires));
    assert.ok(peakReleases >= 2 && peakReleases <= 8, String(peakReleases));
    // A lax guard against accidentally reverting to sequential OneDrive calls.
    assert.ok(Date.now()-started < size*5 + 700, 'unexpected serial wait');
  });
}

test('başka kullanıcı kilidi almışsa atlanır; bir release hatası diğerlerini bloke etmez', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ key: 'plm:' + i }));
  const released = [];
  const run = await leases.acquireCollectionRefreshLeases(items, {
    ownerId:'a',eligibleKeys:new Set(items.map(item=>item.key)),available:async()=>true,
    acquire: async (_, item) => item.key === 'plm:5'
      ? {acquired:false}
      : {acquired:true,release:async()=>{released.push(item.key);if(item.key==='plm:7')throw Error('simulated SMB error');}},
  });
  assert.equal(run.busy.length, 1);
  assert.equal(run.held.length, 19);
  assert.deepEqual(await run.release(), {released:19,errors:1});
  assert.equal(released.length, 19);
});

test('iki paylaşılmış Koleksiyon aynı PLM için farklı sahip anahtarı kullanır', async () => {
  const seen = [];
  for (const ownerId of ['owner-a','owner-b']) {
    const run = await leases.acquireCollectionRefreshLeases([{key:'plm:123'}], {
      ownerId,eligibleKeys:new Set(['plm:123']),available:async()=>true,
      acquire:async key=>{seen.push(key);return {acquired:true,release:async()=>{}};},
    });
    await run.release();
  }
  assert.deepEqual(seen, ['collection:owner-a:plm:123','collection:owner-b:plm:123']);
});
