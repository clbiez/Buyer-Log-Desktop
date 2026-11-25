'use strict';

/* KOLEKSİYON — 20 KURULUMLU SENKRON SAĞLIĞI (hedefli senaryolar)
 *
 * Her senaryo tests/helpers/collection-sync-sim.js ile gerçek izin deposu,
 * gerçek replikasyon ve cihaz başına ayrı yüklenmiş gerçek Koleksiyon çalışma
 * alanı modülü kullanır; cihazlar yalnız ortak hub klasöründen konuşur.
 *
 * Korunan regresyonlar:
 *  · Eşzamanlı yazarlar (CAS yarışı) kaydı reddetmez, sahte "aynı revizyonda
 *    farklı kopya" hatası göstermez ve tek-iki yoklama turunda yakınsar.
 *  · Erişimi geri alınan / izleyiciye düşürülen düzenleyicinin çevrimdışı
 *    yazısı, bağlantı gelince canlı yoklamayla sahibin kopyasına YAYIMLANMAZ;
 *    geri almadan önceki yazısı korunur.
 *  · Aynı modelde farklı üreticilere girilen fiyatlar (pricing/pricingSent
 *    haritası) birlikte korunur; aynı üretici için çakışma tanımlı kalır.
 *  · Aynı alana eşzamanlı yazımda tek değere yakınsanır, kaybeden değer
 *    sessizce kaybolmaz (çakışma kaydı).
 *  · Silme + başka cihazda düzenleme; çevrimdışı eski kopya; bozuk JSON,
 *    yarım geçici dosya ve OneDrive çakışma kopyası.
 *  · 20 cihazdan eşzamanlı izin değişikliği tek belgede kayıpsız birleşir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { mergeCollectionWorkspaces, createCollectionReplication } = require('../server/lib/collection-replication');
const { findConflictCopies } = require('../server/lib/onedrive-conflict-copies');

const TIMEOUT_MS = process.platform === 'win32' ? 90000 : 20000;

async function simulation(t, options) {
  const sim = await createCollectionSimulation(options);
  t.after(() => sim.close());
  try { await sim.bootstrap(); }
  catch (error) { await sim.writeFailureLog(error); throw error; }
  return sim;
}
async function guarded(sim, body) {
  try { return await body(); }
  catch (error) { await sim.writeFailureLog(error); throw error; }
}
function writersOf(sim) { return sim.devices.filter(item => item.role === 'owner' || item.role === 'edit'); }

test('12 eşzamanlı yazar: kayıt sahte çakışma döndürmez ve en fazla iki turda kayıpsız yakınsar', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25111, devices: 20 });
  await guarded(sim, async () => {
    const writers = writersOf(sim);
    assert.equal(writers.length, 12);
    const results = await sim.runTick(writers.map((device, index) => () => sim.edit(device, OWNER, index + 1, { not: `note-${device.index}` })));
    for (const [index, result] of results.entries()) {
      assert.equal(result.status, 'applied');
      const replication = result.result.replication;
      assert.equal(replication.ok, true, `device ${writers[index].index}: ${JSON.stringify(replication)}`);
      assert.notEqual(replication.publicationPending, true, `device ${writers[index].index}: publication left pending`);
    }
    const rounds = await sim.settle({ rounds: 6 });
    assert.ok(await sim.convergedNow(), 'installations converge');
    assert.ok(rounds <= 2, `convergence needed ${rounds} poll rounds`);
    const hub = (await sim.remoteEnvelope()).workspace.rows;
    for (const [index, device] of writers.entries()) assert.equal(hub.find(row => row.id === index + 1).not, `note-${device.index}`);
    for (const device of sim.devices) if (device.role !== 'none') assert.deepEqual(await sim.openConflicts(device), [], `false conflict on ${device.index}`);
    assert.deepEqual((await sim.quietRound()).work, [], 'settled installations do no extra read/publish work');
  });
});

test('erişimi geri alınan düzenleyicinin çevrimdışı yazısı yayımlanmaz; önceki yazısı korunur', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25112, devices: 20 });
  await guarded(sim, async () => {
    const owner = sim.devices[0], laptop = sim.devices[1], editor = sim.devices[2];
    assert.equal((await sim.edit(editor, OWNER, 3, { not: 'editor-before-revoke' })).status, 'applied');
    await sim.settle();
    sim.setOnline(editor, false);
    // Önbellekteki eski yetkiyle yerel kayıt kabul edilir; ağ yok, yayım bekler.
    assert.equal((await sim.edit(editor, OWNER, 4, { not: 'editor-offline-after-revoke' })).status, 'applied');
    await sim.revoke(owner, editor.userId);
    assert.equal((await sim.edit(laptop, OWNER, 5, { fob: '4,25' })).status, 'applied');
    sim.setOnline(editor, true);
    // Canlı yoklama, kullanıcı hiçbir API çağrısı yapmadan önce çalışır.
    await sim.poll(editor);
    await sim.settle();
    const hub = (await sim.remoteEnvelope()).workspace.rows;
    assert.equal(hub.find(row => row.id === 4).not, '', 'revoked editor write must not reach the owner workspace');
    assert.equal(hub.find(row => row.id === 3).not, 'editor-before-revoke', 'earlier accepted write is preserved');
    assert.equal(hub.find(row => row.id === 5).fob, '4,25');
    for (const device of sim.devices.filter(item => item.role !== 'none' && item !== editor)) {
      assert.equal(sim.rowOf(device, 4).not, '', `device ${device.index} adopted a revoked write`);
      assert.equal(sim.rowOf(device, 3).not, 'editor-before-revoke');
    }
    assert.equal((await sim.edit(editor, OWNER, 6, { not: 'editor-online-after-revoke' })).status, 'denied');
    assert.equal((await sim.open(editor, OWNER)).status, 403);
    assert.equal((await sim.remoteEnvelope()).workspace.rows.find(row => row.id === 6).not, '');
  });
});

test('çevrimiçi yazımla eşzamanlı geri alma: geri alma bittikten sonra başlayan yazı reddedilir, kabul edilenler kalır', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25122, devices: 20 });
  await guarded(sim, async () => {
    const owner = sim.devices[0], editor = sim.devices[4], other = sim.devices[5];
    // Düzenleyici art arda yazarken sahip erişimi geri alır; başka bir düzenleyici de yazar.
    const burst = (async () => { const out = []; for (let i = 0; i < 6; i++) out.push({ i, result: await sim.edit(editor, OWNER, 11 + i, { buyer: `burst-${i}` }) }); return out; })();
    const revoked = sim.revoke(owner, editor.userId);
    const parallel = sim.edit(other, OWNER, 20, { line: 'other-editor' });
    const [writes] = await Promise.all([burst, revoked, parallel]);
    const after = [];
    for (let i = 0; i < 3; i++) after.push(await sim.edit(editor, OWNER, 17 + i, { buyer: `after-${i}` }));
    assert.ok(after.every(item => item.status === 'denied'), 'writes started after the revoke completed are denied');
    await sim.poll(editor);
    await sim.settle();
    const hub = (await sim.remoteEnvelope()).workspace.rows;
    for (const { i, result } of writes) {
      const value = hub.find(row => row.id === 11 + i).buyer;
      if (result.status === 'applied' && result.result.replication.ok) assert.equal(value, `burst-${i}`, `accepted write ${i} must not be lost`);
      if (result.status === 'denied') assert.notEqual(value, `burst-${i}`);
    }
    for (let i = 0; i < 3; i++) assert.notEqual(hub.find(row => row.id === 17 + i).buyer, `after-${i}`);
    assert.equal(hub.find(row => row.id === 20).line, 'other-editor');
    assert.ok(await sim.convergedNow());
  });
});

test('izleyiciye düşürülen düzenleyicinin çevrimdışı yazısı yayımlanmaz; yerel kopya uzak kopyayı benimser', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25113, devices: 20 });
  await guarded(sim, async () => {
    const owner = sim.devices[0], editor = sim.devices[3];
    assert.equal((await sim.edit(editor, OWNER, 7, { targetPrice: '2,10' })).status, 'applied');
    await sim.settle();
    sim.setOnline(editor, false);
    assert.equal((await sim.edit(editor, OWNER, 8, { targetPrice: '9,99' })).status, 'applied');
    await sim.grant(owner, editor.userId, 'view');
    sim.setOnline(editor, true);
    await sim.poll(editor);
    await sim.settle();
    assert.equal((await sim.remoteEnvelope()).workspace.rows.find(row => row.id === 8).targetPrice, '');
    assert.equal(sim.rowOf(editor, 8).targetPrice, '', 'viewer cache adopts the owner copy');
    assert.equal(sim.rowOf(editor, 7).targetPrice, '2,10');
    assert.ok(await sim.convergedNow());
  });
});

test('fiyat haritası: aynı modelde farklı üreticilere giren iki cihazın fiyatı birlikte korunur', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25114, devices: 20 });
  await guarded(sim, async () => {
    const [a, b, c] = [sim.devices[2], sim.devices[3], sim.devices[4]];
    for (const device of [a, b, c]) sim.setOnline(device, false);
    await sim.edit(a, OWNER, 9, { pricing: { 'Mfr Alfa': '4,10' }, pricingSent: { 'Mfr Alfa': true } });
    await sim.edit(b, OWNER, 9, { pricing: { 'Mfr Beta': '3,95' }, pricingSent: { 'Mfr Beta': true } });
    await sim.edit(c, OWNER, 9, { confirmedManufacturer: 'Mfr Beta' });
    for (const device of [a, b, c]) sim.setOnline(device, true);
    await sim.runTick([a, b, c].map(device => () => sim.poll(device)));
    await sim.settle({ rounds: 6 });
    assert.ok(await sim.convergedNow());
    for (const device of sim.devices.filter(item => item.role !== 'none')) {
      const row = sim.rowOf(device, 9);
      assert.deepEqual(row.pricing, { 'Mfr Alfa': '4,10', 'Mfr Beta': '3,95' }, `device ${device.index}`);
      assert.deepEqual(row.pricingSent, { 'Mfr Alfa': true, 'Mfr Beta': true }, `device ${device.index}`);
      assert.equal(row.confirmedManufacturer, 'Mfr Beta');
      assert.deepEqual(await sim.openConflicts(device), [], `false conflict on ${device.index}`);
    }
  });
});

test('fiyat haritası birleşimi: aynı üretici çakışması tanımlı kalır, diğer üreticiler korunur', () => {
  const ws = (revision, rows) => ({ schemaVersion: 1, ownerId: OWNER, initialized: true, _revision: revision, rows, manufacturers: [], customColumns: [], statusCatalog: [], nextId: 10 });
  const base = ws(5, [{ id: 1, _rev: 5, pricing: { A: '1,00', B: '2,00', D: '9,00' } }]);
  const local = ws(6, [{ id: 1, _rev: 6, pricing: { A: '1,50', B: '2,00', C: '3,00' } }]);
  const remote = ws(6, [{ id: 1, _rev: 6, pricing: { A: '1,70', B: '2,20', D: '9,00' } }]);
  const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, remote);
  assert.deepEqual(workspace.rows[0].pricing, { A: '1,70', B: '2,20', C: '3,00' }, 'remote wins the same manufacturer; local add and delete survive');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'pricing');
  assert.deepEqual(conflicts[0].current, { A: '1,70', B: '2,20', C: '3,00' });
  assert.deepEqual(conflicts[0].incoming, { A: '1,50', B: '2,20', C: '3,00' }, 'choosing the local value keeps every other manufacturer');
  // Taban yoksa iki yönlü: yalnız bir tarafta olan üretici alınır, farklı değer çakışır.
  const twoWay = mergeCollectionWorkspaces(null, local, remote);
  assert.deepEqual(twoWay.workspace.rows[0].pricing, { A: '1,70', B: '2,20', C: '3,00', D: '9,00' });
  assert.deepEqual(twoWay.conflicts.map(item => item.field), ['pricing']);
  // Harita olmayan eski/bozuk değer bütün alan kuralına düşer.
  const legacy = mergeCollectionWorkspaces(ws(5, [{ id: 1, _rev: 5, pricing: '' }]), ws(6, [{ id: 1, _rev: 6, pricing: { A: '1' } }]), ws(6, [{ id: 1, _rev: 6, pricing: '' }]));
  assert.deepEqual(legacy.workspace.rows[0].pricing, { A: '1' });
  assert.deepEqual(legacy.conflicts, []);
});

test('aynı alana eşzamanlı yazım: tek değere yakınsar, kaybeden değerler çakışma olarak kalır', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25115, devices: 20 });
  await guarded(sim, async () => {
    const writers = writersOf(sim);
    const results = await sim.runTick(writers.map(device => () => sim.edit(device, OWNER, 5, { targetPrice: `${device.index},00` })));
    await sim.settle({ rounds: 6 });
    assert.ok(await sim.convergedNow());
    const final = (await sim.remoteEnvelope()).workspace.rows.find(row => row.id === 5).targetPrice;
    const applied = writers.filter((_, index) => results[index].status === 'applied').map(device => `${device.index},00`);
    assert.ok(applied.includes(final), `final value ${final} was written by a device`);
    const recorded = new Set((await Promise.all(sim.devices.map(device => sim.openConflicts(device)))).flat().filter(item => item.field === 'targetPrice').map(item => item.incoming));
    const silentlyLost = applied.filter(value => value !== final && !recorded.has(value));
    assert.deepEqual(silentlyLost, [], 'every losing write is kept as a conflict');
  });
});

test('silme ile başka cihazdaki düzenleme: düzenleme korunur ve bildirilir; çevrimdışı eski kopya silinen satırı diriltmez', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25116, devices: 20 });
  await guarded(sim, async () => {
    const [owner, laptop, a, b, c] = sim.devices;
    sim.setOnline(a, false);
    assert.equal((await sim.remove(a, OWNER, 2)).status, 'applied');
    assert.equal((await sim.edit(b, OWNER, 2, { not: 'edited-elsewhere' })).status, 'applied');
    sim.setOnline(a, true);
    await sim.poll(a);
    await sim.settle();
    for (const device of sim.devices.filter(item => item.role !== 'none')) assert.equal(sim.rowOf(device, 2) && sim.rowOf(device, 2).not, 'edited-elsewhere', `device ${device.index}`);
    const deletions = (await Promise.all(sim.devices.map(device => sim.openConflicts(device)))).flat().filter(item => item.field === '_deleted');
    assert.equal(deletions.length, 1, 'delete-vs-edit is reported once');
    assert.equal(a.modules.recycleBin.loadBin(OWNER).entries.length, 1, 'deleting device keeps a recoverable copy');

    sim.setOnline(c, false);
    assert.equal((await sim.edit(c, OWNER, 9, { not: 'offline-c' })).status, 'applied');
    assert.equal((await sim.remove(owner, OWNER, 3)).status, 'applied');
    assert.equal((await sim.edit(laptop, OWNER, 4, { colour: 'Navy' })).status, 'applied');
    await sim.settle();
    sim.setOnline(c, true);
    await sim.poll(c);
    await sim.settle();
    for (const device of sim.devices.filter(item => item.role !== 'none')) {
      assert.equal(sim.rowOf(device, 3), null, `device ${device.index}: deleted row resurrected`);
      assert.equal(sim.rowOf(device, 4).colour, 'Navy', `device ${device.index}: newer value overwritten by stale copy`);
      assert.equal(sim.rowOf(device, 9).not, 'offline-c');
    }
  });
});

test('bozuk nihai JSON, yarım geçici dosya ve OneDrive kopyası benimsenmez; yerel kayıt kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25117, devices: 20 });
  await guarded(sim, async () => {
    const file = sim.workspaceFile();
    const good = await fsp.readFile(file);
    const copy = JSON.parse(good.toString('utf8'));
    copy.workspace = { ...copy.workspace, _revision: copy.workspace._revision + 500, rows: [] };
    await fsp.writeFile(file.replace(/\.json$/, '-DESKTOP-AB12.json'), JSON.stringify(copy));
    await fsp.writeFile(`${file}.4242.partial.tmp`, good.subarray(0, 40));
    await fsp.writeFile(file, good.subarray(0, good.length >> 1));
    const editor = sim.devices[5];
    const saved = await sim.edit(editor, OWNER, 10, { not: 'saved-during-corruption' });
    assert.equal(saved.status, 'applied', 'local save succeeds');
    assert.equal(saved.result.replication.ok, false, 'publication failure is reported, not hidden');
    const opened = await sim.open(sim.devices[6], OWNER);
    assert.equal(opened.status, 200);
    assert.equal(opened.workspace.rows.length, 24, 'corrupt remote is never adopted');
    assert.deepEqual(await sim.poll(sim.devices[7]), []);
    await fsp.writeFile(file, good);
    await sim.settle();
    assert.ok(await sim.convergedNow());
    for (const device of sim.devices.filter(item => item.role !== 'none')) {
      assert.equal(sim.rowOf(device, 10).not, 'saved-during-corruption');
      assert.equal(sim.workspaceOf(device).rows.length, 24, `device ${device.index} adopted the conflict copy`);
    }
    const names = await fsp.readdir(path.dirname(file));
    assert.deepEqual(findConflictCopies(names).map(item => item.name), [`${path.basename(file, '.json')}-DESKTOP-AB12.json`], 'Moderator sees the side file');
  });
});

test('20 cihazdan eşzamanlı izin değişikliği kayıpsız birleşir; bozuk izin belgesi yetki genişletmez', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25118, devices: 20 });
  await guarded(sim, async () => {
    const before = JSON.parse(await fsp.readFile(sim.permissionsFile(), 'utf8'));
    // COLLECTIONS.MANAGE yetkili aktörler: her cihaz başka bir kullanıcının iznini değiştirir.
    const results = await Promise.all(sim.devices.map((device, index) => {
      const grantee = sim.devices[(index % 18) + 2].userId;
      return index % 3 === 2
        ? device.permissions.removeGrant({ ownerId: OWNER, granteeId: grantee, actorId: device.userId })
        : device.permissions.setGrant({ ownerId: OWNER, granteeId: grantee, level: index % 3 ? 'view' : 'edit', actorId: device.userId });
    }));
    const hub = JSON.parse(await fsp.readFile(sim.permissionsFile(), 'utf8'));
    const changed = results.filter(item => item.changed).length;
    assert.equal(hub.revision, before.revision + changed, 'every accepted mutation advanced the single document once');
    assert.equal(new Set(results.filter(item => item.changed).map(item => item.revision)).size, changed, 'no two writers produced the same revision');
    assert.equal(hub.audit.length, before.audit.length + changed);
    // Her cihaz aynı belgeye yakınsar.
    await Promise.all(sim.devices.map(device => device.permissions.sync()));
    const grants = sim.devices.map(device => JSON.stringify(device.permissions.outgoing(OWNER).map(item => [item.granteeId, item.level]).sort()));
    assert.equal(new Set(grants).size, 1);
    // Bozuk hub belgesi: okuma başarısız, yerel doğrulanmış önbellek korunur,
    // yazım reddedilir ve hiçbir yetkisiz kullanıcı erişim kazanmaz.
    const outsider = sim.devices.find(item => item.role === 'none' && !item.permissions.accessLevel(item.userId, OWNER));
    await fsp.writeFile(sim.permissionsFile(), '{"grants":[{"ownerId":');
    await assert.rejects(outsider.permissions.sync());
    await assert.rejects(sim.devices[0].permissions.setGrant({ ownerId: OWNER, granteeId: outsider.userId, level: 'edit', actorId: OWNER }));
    assert.equal(outsider.permissions.accessLevel(outsider.userId, OWNER), null);
    assert.equal((await sim.open(outsider, OWNER)).status, 403);
  });
});

/* Bilinen tasarım sınırı (docs/ai/SHARED_FOLDER_WRITERS.md, "Çok yazarlı"):
   ayrı OneDrive aynalarında iki cihaz aynı tabandan aynı anda yayımlarsa
   sağlayıcı birini `<sahip>-<PC>.json` kopyasına ayırır. Kaybeden cihazın
   birleşim tabanı kendi (yerinden edilmiş) yayımıdır; bu nedenle kendi
   düzenlemesini "zaten tabanda" sayar ve uzak kopyayı benimser — düzenleme
   çakışma kaydı bile olmadan düşer. Düzeltme zarf soy zinciri (ör. son N
   kimlik) gerektirir: protokol işi. Bu test hedef davranışı yürütülmüş
   RED/TODO olarak tutar; geçmesi yakınsama kanıtı değildir. */
test('ayrı OneDrive aynaları: yerinden edilen eşzamanlı yayım sessizce kaybolmamalı', { todo: 'zarf soy zinciri gerektirir (protokol işi)', timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 25119, devices: 4 });
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
  const replicaA = replicaFor(a, mirrors.a), replicaB = replicaFor(b, mirrors.b);
  const write = async (device, replica, rowId, fields) => {
    const row = sim.rowOf(device, rowId);
    await device.modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, ...fields }] });
    return replica.publishOwner(OWNER);
  };
  assert.equal((await write(a, replicaA, 3, { not: 'mirror-a' })).published, true);
  assert.equal((await write(b, replicaB, 4, { not: 'mirror-b' })).published, true);
  // Bulut A'yı önce aldı: B'nin yayımı çakışma kopyasına ayrılır, ana dosya A olur.
  const fileA = path.join(mirrors.a, relative), fileB = path.join(mirrors.b, relative);
  const displaced = await fsp.readFile(fileB);
  await fsp.writeFile(fileB.replace(/\.json$/, '-PCB.json'), displaced);
  await fsp.copyFile(fileA, fileB);
  await replicaB.syncOwner(b.userId, OWNER);
  await fsp.copyFile(fileB, fileA);
  await replicaA.syncOwner(a.userId, OWNER);
  const kept = sim.rowOf(a, 4).not === 'mirror-b' && sim.rowOf(b, 4).not === 'mirror-b';
  const reported = (await replicaB.listMergeConflicts([OWNER])).some(item => item.incoming === 'mirror-b');
  assert.ok(kept || reported, 'displaced edit must survive or be reported as a conflict');
});
