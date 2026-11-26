'use strict';

/* KOLEKSİYON — YERİNDEN EDİLEN YAYIM (ADR-0001 Aşama 0)
 *
 * Ayrı OneDrive aynalarında iki cihaz aynı tabandan yayımlarsa sağlayıcı
 * birini `<sahip>-<PC>.json` kopyasına ayırır. Kaybeden cihaz eskiden kendi
 * (yerinden edilmiş) yayımını birleşim tabanı sayıyor, kendi düzenlemesini
 * "zaten tabanda" kabul ediyor ve uzak kopyayı benimsiyordu: düzenleme çakışma
 * kaydı bile olmadan düşüyordu.
 *
 * Korunan sözleşme:
 *  · Yayım, uzak zincirde bir halef tarafından onaylanana kadar "beklemede"
 *    sayılır; kendi dosyasını görmek onay değildir (geç yerinden edilme).
 *  · Bekleyen yayım varken onu soyunda taşımayan uzak kopya, yayımdan önceki
 *    tabanla birleştirilir; düzenleme korunur ya da çakışma olarak raporlanır.
 *  · Yayım kapsama haritası (heads, version vector) eski istemcilerin
 *    sha256/chainSha256 doğrulamasını değiştirmez; doğrulanamayan harita yok
 *    sayılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { createCollectionReplication } = require('../server/lib/collection-replication');

const TIMEOUT_MS = process.platform === 'win32' ? 90000 : 20000;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

async function mirrored(t, seed) {
  const sim = await createCollectionSimulation({ seed, devices: 4 });
  t.after(() => sim.close());
  await sim.bootstrap();
  const [a, , b] = sim.devices;
  const relative = path.relative(sim.hub, sim.workspaceFile());
  const mirrors = { a: path.join(sim.root, 'mirror-a'), b: path.join(sim.root, 'mirror-b') };
  for (const mirror of Object.values(mirrors)) {
    await fsp.mkdir(path.dirname(path.join(mirror, relative)), { recursive: true });
    await fsp.copyFile(sim.workspaceFile(), path.join(mirror, relative));
  }
  const replicaFor = (device, mirror) => createCollectionReplication({
    workspaces: device.modules.workspaces, permissions: device.permissions,
    getSharedSyncRoot: async () => mirror, stateFile: path.join(device.local, 'collection-replication-state.json'),
  });
  const replica = { a: replicaFor(a, mirrors.a), b: replicaFor(b, mirrors.b) };
  const write = async (device, rep, rowId, fields) => {
    const row = sim.rowOf(device, rowId);
    await device.modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, ...fields }] });
    return rep.publishOwner(OWNER);
  };
  const file = { a: path.join(mirrors.a, relative), b: path.join(mirrors.b, relative) };
  // Bulut A'yı seçer: B'nin yayımı çakışma kopyasına ayrılır, iki ayna da A olur.
  const displaceBWithA = async () => {
    await fsp.writeFile(file.b.replace(/\.json$/, '-PCB.json'), await fsp.readFile(file.b));
    await fsp.copyFile(file.a, file.b);
  };
  const readEnvelope = async which => JSON.parse(await fsp.readFile(file[which], 'utf8'));
  return { sim, a, b, replica, write, file, displaceBWithA, readEnvelope };
}

async function keptOrReported(ctx, device, rep, rowId, value) {
  const kept = ctx.sim.rowOf(device, rowId).not === value;
  const reported = (await rep.listMergeConflicts([OWNER])).some(item => item.incoming === value);
  return kept || reported;
}

test('ayrı OneDrive aynaları: yerinden edilen yayım korunur ve iki cihaz yakınsar', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await mirrored(t, 26111);
  const { sim, a, b, replica, write, file } = ctx;
  assert.equal((await write(a, replica.a, 3, { not: 'mirror-a' })).published, true);
  assert.equal((await write(b, replica.b, 4, { not: 'mirror-b' })).published, true);
  await ctx.displaceBWithA();
  await replica.b.syncOwner(b.userId, OWNER);
  await fsp.copyFile(file.b, file.a);
  await replica.a.syncOwner(a.userId, OWNER);
  for (const device of [a, b]) {
    assert.equal(sim.rowOf(device, 3).not, 'mirror-a', `device ${device.index} keeps A`);
    assert.equal(sim.rowOf(device, 4).not, 'mirror-b', `device ${device.index} keeps displaced B`);
  }
  assert.deepEqual(await replica.a.listMergeConflicts([OWNER]), [], 'no false conflict on A');
  assert.deepEqual(await replica.b.listMergeConflicts([OWNER]), [], 'no false conflict on B');
});

test('geç yerinden edilme: kendi yayımını gördükten sonra ezilen düzenleme yine kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await mirrored(t, 26112);
  const { b, replica, write } = ctx;
  assert.equal((await write(ctx.a, replica.a, 3, { not: 'mirror-a' })).published, true);
  assert.equal((await write(b, replica.b, 4, { not: 'mirror-b' })).published, true);
  // B kendi aynasında kendi yayımını görür (UP_TO_DATE); bulut sonra karar verir.
  await replica.b.syncOwner(b.userId, OWNER);
  await ctx.displaceBWithA();
  await replica.b.syncOwner(b.userId, OWNER);
  assert.ok(await keptOrReported(ctx, b, replica.b, 4, 'mirror-b'), 'late-displaced edit must survive or be reported');
});

test('uzak kopya daha yüksek revizyonda ezerse değişmemiş görünen yerel kopya körlemesine benimsenmez', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await mirrored(t, 26113);
  const { b, replica, write } = ctx;
  assert.equal((await write(ctx.a, replica.a, 3, { not: 'mirror-a-1' })).published, true);
  assert.equal((await write(ctx.a, replica.a, 5, { not: 'mirror-a-2' })).published, true);
  assert.equal((await write(b, replica.b, 4, { not: 'mirror-b' })).published, true);
  await ctx.displaceBWithA();
  await replica.b.syncOwner(b.userId, OWNER);
  assert.equal(ctx.sim.rowOf(b, 3).not, 'mirror-a-1');
  assert.equal(ctx.sim.rowOf(b, 5).not, 'mirror-a-2');
  assert.ok(await keptOrReported(ctx, b, replica.b, 4, 'mirror-b'), 'displaced edit must survive a higher remote revision');
});

test('doğrulanamayan kapsama haritası yayımı onaylamış sayılmaz', { timeout: TIMEOUT_MS }, async t => {
  const ctx = await mirrored(t, 26114);
  const { b, replica, write, file } = ctx;
  assert.equal((await write(ctx.a, replica.a, 3, { not: 'mirror-a' })).published, true);
  assert.equal((await write(b, replica.b, 4, { not: 'mirror-b' })).published, true);
  const displacedId = (await ctx.readEnvelope('b')).chainSha256;
  await ctx.displaceBWithA();
  // Bozuk/sahte harita: B'nin yayımını kapsadığını iddia eder ama özeti tutmaz.
  const { installationId } = JSON.parse(await fsp.readFile(path.join(b.local, 'collection-replication-state.json'), 'utf8'));
  assert.ok(installationId);
  const forged = await ctx.readEnvelope('b');
  forged.heads = { ...(forged.heads || {}), [installationId]: displacedId };
  forged.headsSha256 = '0'.repeat(64);
  await fsp.writeFile(file.b, JSON.stringify(forged));
  await replica.b.syncOwner(b.userId, OWNER);
  assert.ok(await keptOrReported(ctx, b, replica.b, 4, 'mirror-b'), 'forged ancestry must not confirm a displaced publication');
});

test('kapsama haritalı zarf eski istemci doğrulamasını değiştirmez ve halef yayımı kapsar', { timeout: TIMEOUT_MS }, async t => {
  const sim = await createCollectionSimulation({ seed: 26115, devices: 4 });
  t.after(() => sim.close());
  await sim.bootstrap();
  const [owner, , editor] = sim.devices;
  assert.equal((await sim.edit(editor, OWNER, 4, { not: 'editor' })).status, 'applied');
  const first = JSON.parse(await fsp.readFile(sim.workspaceFile(), 'utf8'));
  await sim.poll(owner);
  assert.equal((await sim.edit(owner, OWNER, 5, { not: 'owner' })).status, 'applied');
  const second = JSON.parse(await fsp.readFile(sim.workspaceFile(), 'utf8'));
  // Eski istemci yalnız bu iki özeti doğrular (collection-replication v1).
  for (const envelope of [first, second]) {
    assert.equal(envelope.sha256, sha({ version: envelope.version, ownerId: envelope.ownerId, workspace: envelope.workspace }));
    assert.equal(envelope.chainSha256, sha({ sha256: envelope.sha256, parentSha256: envelope.parentSha256 || null }));
  }
  assert.equal(second.headsSha256, sha({ chainSha256: second.chainSha256, heads: second.heads }));
  const heads = Object.values(second.heads);
  assert.ok(heads.includes(first.chainSha256), 'successor covers the editor publication');
  assert.ok(heads.includes(second.chainSha256), 'publisher covers itself');
  assert.equal(heads.length, 2, 'one entry per publishing installation, not per publication');
  await sim.settle();
  assert.ok(await sim.convergedNow());
  for (const device of sim.devices) if (device.role !== 'none') assert.deepEqual(await sim.openConflicts(device), [], `false conflict on ${device.index}`);
});
