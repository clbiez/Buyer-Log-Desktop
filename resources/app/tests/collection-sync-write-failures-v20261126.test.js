'use strict';

/* KOLEKSİYON — YAZIM HATALARINDA BEKLEYEN ZİNCİR (ADR-0001 Aşama 0, bağımsız inceleme F1/F4/F5)
 *
 * Bağımsız ikinci model incelemesi, "temkinli taraf: kayıp yok" iddiasının yazım
 * hatalarında geçersiz olduğunu yeniden üretilebilir senaryolarla gösterdi:
 *  F1 · hub yazımı düşünce zincir kalıcı "kırık" sayılıyor, eski ilk tabana düşülüyor;
 *       başka cihazın bilinçli geri alması (A→B→A) sessizce kayboluyordu.
 *  F4 · taban dosyasının bekleyen-ilk-tabana taşınması düşünce hata yutuluyordu;
 *       bekleyen silme, yerinden edilince sessizce geri geliyordu.
 *  F5 · günlüğe yarım yazılmış son satır sonraki kayıtları erişilmez kılıyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { createCollectionReplication } = require('../server/lib/collection-replication');

const TIMEOUT_MS = process.platform === 'win32' ? 120000 : 30000;

async function setup(t, seed) {
  const sim = await createCollectionSimulation({ seed, devices: 4 });
  t.after(() => sim.close());
  await sim.bootstrap();
  const [a, , b] = sim.devices;
  const rel = path.relative(sim.hub, sim.workspaceFile());
  const dir = { a: path.join(sim.root, 'ma'), b: path.join(sim.root, 'mb') };
  const file = { a: path.join(dir.a, rel), b: path.join(dir.b, rel) };
  for (const m of Object.values(dir)) { await fsp.mkdir(path.dirname(path.join(m, rel)), { recursive: true }); await fsp.copyFile(sim.workspaceFile(), path.join(m, rel)); }
  const stateFile = { a: path.join(a.local, 'mirror-replication-state.json'), b: path.join(b.local, 'mirror-replication-state.json') }; // temiz durum: önyükleme zinciri yok
  const replica = {
    a: createCollectionReplication({ workspaces: a.modules.workspaces, permissions: a.permissions, getSharedSyncRoot: async () => dir.a, stateFile: stateFile.a }),
    b: createCollectionReplication({ workspaces: b.modules.workspaces, permissions: b.permissions, getSharedSyncRoot: async () => dir.b, stateFile: stateFile.b }),
  };
  const device = { a, b };
  const write = async (name, rowId, fields) => {
    const row = sim.rowOf(device[name], rowId);
    await device[name].modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, ...fields }] });
    return replica[name].publishOwner(OWNER).catch(error => ({ error: error.code || error.message }));
  };
  const remove = async (name, rowId) => {
    const row = sim.rowOf(device[name], rowId);
    await device[name].modules.workspaces.applyRowChangesAsync(OWNER, { deletes: [{ id: row.id, _rev: row._rev }] });
    return replica[name].publishOwner(OWNER).catch(error => ({ error: error.code || error.message }));
  };
  const failRenameTo = async (target, body) => {
    const original = fsp.rename;
    fsp.rename = async (from, to) => { if (target(path.resolve(to))) throw Object.assign(new Error('simulated write failure'), { code: 'EIO' }); return original(from, to); };
    try { return await body(); } finally { fsp.rename = original; }
  };
  await replica.a.syncOwner(a.userId, OWNER); await replica.b.syncOwner(b.userId, OWNER);
  return { sim, a, b, file, stateFile, replica, write, remove, failRenameTo };
}

test('F1 · hub yazımı düştükten sonra zincir sürer: başka cihazın bilinçli geri alması kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await setup(t, 26501);
  const { sim, a, b, file, replica, write } = ctx;
  const original = sim.rowOf(a, 3).not;
  const failed = await ctx.failRenameTo(target => target === path.resolve(file.a), () => write('a', 3, { not: 'A-X1' }));
  assert.ok(failed.error, 'the first publication does not land');
  assert.equal((await write('a', 3, { not: 'A-X2' })).published, true);
  await fsp.copyFile(file.a, file.b); // B, X2'yi alır
  assert.equal((await write('a', 5, { not: 'A-X3' })).published, true);
  await replica.b.syncOwner(b.userId, OWNER);
  assert.equal(sim.rowOf(b, 3).not, 'A-X2');
  assert.equal((await write('b', 3, { not: original })).published, true); // B bilerek geri alır
  await fsp.copyFile(file.b, file.a); // bulut B'yi seçer, A yerinden edilir
  await replica.a.syncOwner(a.userId, OWNER);
  await fsp.copyFile(file.a, file.b); await replica.b.syncOwner(b.userId, OWNER);
  for (const device of [a, b]) {
    assert.equal(sim.rowOf(device, 3).not, original, 'B saw A-X2 and reverted it: the revert must win');
    assert.equal(sim.rowOf(device, 5).not, 'A-X3');
  }
  assert.deepEqual(await replica.a.listMergeConflicts([OWNER]), [], 'no conflict: the revert causally followed A-X2');
});

test('F4 · taban dosyası bekleyen ilk tabana taşınamazsa yayım güvenli kalır: bekleyen silme geri gelmez', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await setup(t, 26502);
  const { sim, a, file, replica, write, remove } = ctx;
  const result = await ctx.failRenameTo(target => target.endsWith('.pending-first.json'), () => remove('a', 7));
  assert.ok(result.published || result.error, 'publish either lands safely or is cancelled');
  assert.equal((await write('b', 8, { not: 'B8' })).published, true);
  await fsp.copyFile(file.b, file.a); // A yerinden edilir
  await replica.a.syncOwner(a.userId, OWNER);
  assert.equal(sim.rowOf(a, 7), null, 'the pending delete must not be resurrected');
  assert.equal(sim.rowOf(a, 8).not, 'B8');
  assert.deepEqual(await replica.a.listMergeConflicts([OWNER]), []);
});

test('F5 · günlüğe yarım yazılmış son satır sonraki kayıtları erişilmez kılmaz', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await setup(t, 26503);
  const { sim, a, b, file, stateFile, replica, write } = ctx;
  assert.equal((await write('a', 4, { not: 'a1' })).published, true);
  // Süreç günlük eklemesi sırasında öldü: son satır yarım kaldı (yayımı hiç inmedi).
  const log = path.join(`${stateFile.a}.bases`, 'owner-ayse.pending-log.jsonl');
  await fsp.appendFile(log, '{"id":"half-written","delta":{"upse');
  assert.equal((await write('a', 5, { not: 'a2' })).published, true);
  await fsp.copyFile(file.a, file.b); // B, a2'yi kapsayan kopyayı alır
  assert.equal((await write('a', 6, { not: 'a3' })).published, true);
  await replica.b.syncOwner(b.userId, OWNER);
  assert.equal((await write('b', 4, { not: '' })).published, true); // B, a1'i bilerek geri alır
  await fsp.copyFile(file.b, file.a);
  await replica.a.syncOwner(a.userId, OWNER);
  assert.equal(sim.rowOf(a, 4).not, '', 'revert that saw a1 wins');
  assert.equal(sim.rowOf(a, 5).not, 'a2');
  assert.equal(sim.rowOf(a, 6).not, 'a3');
  assert.deepEqual(await replica.a.listMergeConflicts([OWNER]), []);
});

test('F5 · satır ekleme/silme farkı tüm satır sırasını taşımaz', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await setup(t, 26504);
  const { stateFile, remove } = ctx;
  assert.ok((await remove('a', 9)).published);
  const log = path.join(`${stateFile.a}.bases`, 'owner-ayse.pending-log.jsonl');
  const entries = (await fsp.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(entries.at(-1).delta.order, null, 'a delete keeps the relative order: no full order array');
});
