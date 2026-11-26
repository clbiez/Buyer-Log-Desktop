'use strict';

/* KOLEKSİYON — BEKLEYEN YAYIM MEKANİZMASININ SINIRLARI (ADR-0001 Aşama 0)
 *
 * Yerinden edilen yayım düzeltmesinin doğruluk sınırları. Her senaryo ya
 * düzenlemenin korunduğunu ya da çakışma olarak raporlandığını, ayrıca
 * gereksiz (yanlış) çakışma üretilmediğini denetler:
 *  · Uzun çevrimdışı: başka cihazlar 32'den fazla yayım yapar.
 *  · Yayım yarıda kesilir (hub yazımı düşer) ve uygulama yeniden başlar.
 *  · OneDrive eski bir sürümü yenisinden sonra teslim eder (sırasız teslim).
 *  · Üç cihaz aynı tabandan eşzamanlı yayımlar; birleşimler de çakışır.
 *  · Eski istemci yeni zarf alanlarını (yayım geçmişi) siler.
 *  · Kurulum kimliği: yeniden başlatma, kopyalanan veri klasörü, yeniden
 *    kurulum (durum kaybı), yedekten eski durum dosyası, taban yazım hatası.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { createCollectionReplication } = require('../server/lib/collection-replication');

const TIMEOUT_MS = process.platform === 'win32' ? 120000 : 30000;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

async function simulation(t, options) {
  const sim = await createCollectionSimulation(options);
  t.after(() => sim.close());
  await sim.bootstrap();
  return sim;
}

/* Her cihaz kendi OneDrive aynasına yazar; `deliver` bulutun bir aynadaki
   dosyayı başka aynaya taşımasıdır (displace: hedefin dosyası -PC kopyasına). */
async function mirrors(sim, devices) {
  const relative = path.relative(sim.hub, sim.workspaceFile());
  const out = { file: {}, replica: {}, stateFile: {} };
  for (const [name, device] of Object.entries(devices)) {
    const mirror = path.join(sim.root, `mirror-${name}`);
    out.file[name] = path.join(mirror, relative);
    out.stateFile[name] = path.join(device.local, 'collection-replication-state.json');
    await fsp.mkdir(path.dirname(out.file[name]), { recursive: true });
    await fsp.copyFile(sim.workspaceFile(), out.file[name]);
    out.replica[name] = createCollectionReplication({
      workspaces: device.modules.workspaces, permissions: device.permissions,
      getSharedSyncRoot: async () => mirror, stateFile: out.stateFile[name],
    });
  }
  out.restart = (name, options = {}) => {
    out.replica[name] = createCollectionReplication({
      workspaces: devices[name].modules.workspaces, permissions: devices[name].permissions,
      getSharedSyncRoot: async () => path.dirname(path.dirname(path.dirname(path.dirname(out.file[name])))), stateFile: out.stateFile[name],
      ...options,
    });
  };
  out.write = async (name, rowId, fields) => {
    const device = devices[name];
    const row = sim.rowOf(device, rowId);
    await device.modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, ...fields }] });
    return out.replica[name].publishOwner(OWNER);
  };
  out.deliver = async (from, to, { displace = true } = {}) => {
    if (displace) await fsp.writeFile(out.file[to].replace(/\.json$/, `-PC${to.toUpperCase()}.json`), await fsp.readFile(out.file[to]));
    await fsp.copyFile(out.file[from], out.file[to]);
  };
  out.sync = name => out.replica[name].syncOwner(devices[name].userId, OWNER);
  out.conflicts = name => out.replica[name].listMergeConflicts([OWNER]);
  out.envelope = async name => JSON.parse(await fsp.readFile(out.file[name], 'utf8'));
  return out;
}

test('uzun çevrimdışı: başka cihaz 40 yayım yaptıktan sonra onaylanmış yayım yanlış çakışma ve silinen satırın geri gelmesini üretmez', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26121, devices: 6 });
  const owner = sim.devices[0], editor = sim.devices[2];
  assert.equal((await sim.edit(editor, OWNER, 4, { not: 'editor' })).status, 'applied');
  assert.equal((await sim.edit(editor, OWNER, 6, { not: 'editor-6' })).status, 'applied');
  sim.setOnline(editor, false);
  await sim.poll(owner);
  assert.equal((await sim.edit(owner, OWNER, 4, { not: 'owner-final' })).status, 'applied');
  assert.equal((await sim.remove(owner, OWNER, 6)).status, 'applied');
  for (let i = 0; i < 40; i++) assert.equal((await sim.edit(owner, OWNER, 10, { not: `owner-${i}` })).status, 'applied');
  sim.setOnline(editor, true);
  await sim.poll(editor);
  assert.equal(sim.rowOf(editor, 4).not, 'owner-final', 'later owner edit wins without conflict');
  assert.equal(sim.rowOf(editor, 6), null, 'row deleted after the editor change must not come back');
  assert.equal(sim.rowOf(editor, 10).not, 'owner-39');
  assert.deepEqual(await sim.openConflicts(editor), [], 'no false conflict after a long offline period');
  await sim.settle();
  assert.ok(await sim.convergedNow());
});

test('hub yazımı yarıda kalır ve uygulama yeniden başlar: bekleyen düzenleme kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26122, devices: 6 });
  const m = await mirrors(sim, { a: sim.devices[0], b: sim.devices[2] });
  assert.equal((await m.write('a', 3, { not: 'a-before' })).published, true);
  await m.deliver('a', 'b', { displace: false });
  await m.sync('b');
  // B'nin yayımı sırasında hub hedefi yazılamaz (ör. kilitli/çevrimdışı paylaşım).
  const saved = await fsp.readFile(m.file.b);
  await fsp.rm(m.file.b); await fsp.mkdir(m.file.b); await fsp.writeFile(path.join(m.file.b, 'blocker'), 'x');
  await assert.rejects(m.write('b', 4, { not: 'b-pending' }));
  await fsp.rm(m.file.b, { recursive: true, force: true }); await fsp.writeFile(m.file.b, saved);
  // Bu arada A yeni bir sürüm yayımlar; bulut onu B'ye teslim eder.
  assert.equal((await m.write('a', 5, { not: 'a-after' })).published, true);
  await m.deliver('a', 'b', { displace: false });
  m.restart('b');
  await m.sync('b');
  await m.deliver('b', 'a', { displace: false });
  await m.sync('a');
  for (const name of ['a', 'b']) {
    const device = name === 'a' ? sim.devices[0] : sim.devices[2];
    assert.equal(sim.rowOf(device, 3).not, 'a-before', `${name} keeps a-before`);
    assert.equal(sim.rowOf(device, 5).not, 'a-after', `${name} keeps a-after`);
    assert.equal(sim.rowOf(device, 4).not, 'b-pending', `${name} keeps the interrupted edit`);
  }
  assert.deepEqual(await m.conflicts('b'), []);
});

/* BİLİNEN SINIR (yürütülmüş RED/TODO): Aşama 0'dan ÖNCE de vardı (düzeltme öncesi
   modülle doğrulandı). Taban daha yeni bir sürümken eski sürüm gelirse üç yönlü
   birleşim eski değeri "uzakta değişti" sayar. Kapsama haritası içerik adreslidir;
   aynı kurulumun iki yayımını sıralamaz (sayaç kullanılmaz: geri sarılabilir). */
test('sırasız teslim: eski sürüm yenisinden sonra gelirse yeni düzenleme geri alınmaz', { todo: 'ortak ata / yayım sırası gerektirir (ADR-0003)', timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26123, devices: 6 });
  const m = await mirrors(sim, { a: sim.devices[0], b: sim.devices[2] });
  assert.equal((await m.write('a', 3, { not: 'a1' })).published, true);
  const first = await fsp.readFile(m.file.a);
  assert.equal((await m.write('a', 5, { not: 'a2' })).published, true);
  await m.deliver('a', 'b', { displace: false });
  await m.sync('b');
  assert.equal(sim.rowOf(sim.devices[2], 5).not, 'a2');
  await fsp.writeFile(m.file.b, first); // bulut eski sürümü geç teslim eder
  await m.sync('b');
  assert.equal(sim.rowOf(sim.devices[2], 3).not, 'a1');
  assert.equal(sim.rowOf(sim.devices[2], 5).not, 'a2', 'stale delivery must not revert a newer edit');
});

test('üç cihaz aynı tabandan yayımlar, birleşimleri de çakışır: üç düzenleme de kalır', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26124, devices: 6 });
  const devices = { a: sim.devices[0], b: sim.devices[2], c: sim.devices[3] };
  const m = await mirrors(sim, devices);
  assert.equal((await m.write('a', 3, { not: 'a' })).published, true);
  assert.equal((await m.write('b', 4, { not: 'b' })).published, true);
  assert.equal((await m.write('c', 5, { not: 'c' })).published, true);
  // Bulut A'yı seçer; B ve C yerinden edilir, ikisi de A ile birleştirip yayımlar.
  await m.deliver('a', 'b'); await m.deliver('a', 'c');
  await m.sync('b'); await m.sync('c');
  // İki birleşim de çakışır: bulut C'yi seçer, B yine yerinden edilir.
  await m.deliver('c', 'b'); await m.deliver('c', 'a', { displace: false });
  await m.sync('b');
  await m.deliver('b', 'a', { displace: false }); await m.deliver('b', 'c', { displace: false });
  await m.sync('a'); await m.sync('c');
  for (const [name, device] of Object.entries(devices)) {
    for (const [rowId, value] of [[3, 'a'], [4, 'b'], [5, 'c']]) assert.equal(sim.rowOf(device, rowId).not, value, `${name} row ${rowId}`);
    assert.deepEqual(await m.conflicts(name), [], `no false conflict on ${name}`);
  }
});

test('eski istemci yayım geçmişini silerse düzenleme kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26125, devices: 6 });
  const m = await mirrors(sim, { a: sim.devices[0], b: sim.devices[2] });
  assert.equal((await m.write('b', 4, { not: 'b' })).published, true);
  await m.deliver('b', 'a', { displace: false });
  await m.sync('a');
  assert.equal((await m.write('a', 3, { not: 'a' })).published, true);
  // Eski istemci (v1) A'nın kopyasına kendi düzenlemesini ekler ve zarfı yalnız
  // v1 alanlarıyla yeniden yazar: yeni yayım geçmişi alanları düşer.
  const current = await m.envelope('a');
  const workspace = JSON.parse(JSON.stringify(current.workspace));
  const row = workspace.rows.find(item => item.id === 7);
  row.not = 'legacy'; row._rev = (Number(row._rev) || 0) + 1; workspace._revision += 1;
  const legacy = { version: current.version, ownerId: current.ownerId, parentSha256: current.chainSha256, workspace };
  legacy.sha256 = sha({ version: legacy.version, ownerId: legacy.ownerId, workspace });
  legacy.chainSha256 = sha({ sha256: legacy.sha256, parentSha256: legacy.parentSha256 });
  await fsp.writeFile(m.file.a, JSON.stringify(legacy));
  await m.deliver('a', 'b', { displace: false });
  await m.sync('b');
  const b = sim.devices[2];
  assert.equal(sim.rowOf(b, 3).not, 'a');
  assert.equal(sim.rowOf(b, 7).not, 'legacy');
  const kept = sim.rowOf(b, 4).not === 'b' || (await m.conflicts('b')).some(item => item.incoming === 'b');
  assert.ok(kept, 'edit must survive a legacy writer that dropped the publication history');
});

const installationOf = async file => JSON.parse(await fsp.readFile(file, 'utf8')).installationId;
const keptOrReported = async (m, name, device, rowId, value) => device && ((await m.conflicts(name)).some(item => item.incoming === value) || m.sim.rowOf(device, rowId).not === value);

test('kurulum kimliği yeniden başlatmada korunur; veri klasörü başka bilgisayara kopyalanınca yenilenir', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26126, devices: 6 });
  const a = sim.devices[0], b = sim.devices[2];
  const m = await mirrors(sim, { a, b });
  assert.equal((await m.write('b', 4, { not: 'b-1' })).published, true);
  const first = await installationOf(m.stateFile.b);
  m.restart('b');
  assert.equal((await m.write('b', 4, { not: 'b-2' })).published, true);
  assert.equal(await installationOf(m.stateFile.b), first, 'restart keeps the installation id');
  assert.equal((await m.envelope('b')).heads[first], (await m.envelope('b')).chainSha256);
  m.restart('b', { getInstallationFingerprint: () => 'another-computer' });
  assert.equal((await m.write('b', 5, { not: 'b-3' })).published, true);
  const copied = await installationOf(m.stateFile.b);
  assert.notEqual(copied, first, 'a copied data folder gets its own installation id');
  const heads = (await m.envelope('b')).heads;
  assert.equal(heads[copied], (await m.envelope('b')).chainSha256);
  assert.ok(heads[first], 'the old installation entry is kept (never pruned)');
  await m.deliver('b', 'a', { displace: false });
  await m.sync('a');
  assert.equal(sim.rowOf(a, 4).not, 'b-2');
  assert.equal(sim.rowOf(a, 5).not, 'b-3');
  assert.deepEqual(await m.conflicts('a'), []);
});

test('yeniden kurulum (durum dosyası kaybı) bekleyen yerinden edilmiş düzenlemeyi kaybettirmez', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26127, devices: 6 });
  const a = sim.devices[0], b = sim.devices[2];
  const m = await mirrors(sim, { a, b }); m.sim = sim;
  assert.equal((await m.write('a', 3, { not: 'a' })).published, true);
  assert.equal((await m.write('b', 4, { not: 'b' })).published, true);
  await m.deliver('a', 'b');
  await fsp.rm(m.stateFile.b, { force: true });
  await fsp.rm(`${m.stateFile.b}.bases`, { recursive: true, force: true });
  m.restart('b');
  await m.sync('b');
  assert.equal(sim.rowOf(b, 3).not, 'a');
  assert.ok(await keptOrReported(m, 'b', b, 4, 'b'), 'edit survives a lost replication state');
  for (let id = 1; id <= 24; id++) assert.ok(sim.rowOf(b, id), `row ${id} must not be wrongly deleted`);
});

test('durum dosyası yedekten eski hâline dönerse yeni yerinden edilmiş düzenleme kaybolmaz', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26128, devices: 6 });
  const a = sim.devices[0], b = sim.devices[2];
  const m = await mirrors(sim, { a, b }); m.sim = sim;
  const backup = path.join(sim.root, 'b-state-backup');
  await fsp.mkdir(backup, { recursive: true });
  await fsp.copyFile(m.stateFile.b, path.join(backup, 'state.json')).catch(() => {});
  await fsp.cp(`${m.stateFile.b}.bases`, path.join(backup, 'bases'), { recursive: true }).catch(() => {});
  assert.equal((await m.write('b', 4, { not: 'b-1' })).published, true);
  await m.deliver('b', 'a', { displace: false });
  await m.sync('a');
  assert.equal((await m.write('a', 3, { not: 'a-1' })).published, true);
  await m.deliver('a', 'b', { displace: false });
  await m.sync('b');
  assert.equal((await m.write('b', 5, { not: 'b-2' })).published, true);
  assert.equal((await m.write('a', 6, { not: 'a-2' })).published, true);
  await m.deliver('a', 'b');
  // Yalnız replikasyon durumu (ve tabanları) eski yedeğe döner; çalışma alanı güncel kalır.
  await fsp.rm(`${m.stateFile.b}.bases`, { recursive: true, force: true });
  await fsp.copyFile(path.join(backup, 'state.json'), m.stateFile.b).catch(() => fsp.rm(m.stateFile.b, { force: true }));
  await fsp.cp(path.join(backup, 'bases'), `${m.stateFile.b}.bases`, { recursive: true }).catch(() => {});
  m.restart('b');
  await m.sync('b');
  for (const [rowId, value] of [[3, 'a-1'], [4, 'b-1'], [6, 'a-2']]) assert.equal(sim.rowOf(b, rowId).not, value, `row ${rowId}`);
  assert.ok(await keptOrReported(m, 'b', b, 5, 'b-2'), 'edit survives a rolled-back replication state');
  for (let id = 1; id <= 24; id++) assert.ok(sim.rowOf(b, id), `row ${id} must not be wrongly deleted`);
});

test('yayımdan sonra taban yazımı düşerse bekleyen zincir yine kesin tabanla birleşir', { timeout: TIMEOUT_MS }, async t => {
  const sim = await simulation(t, { seed: 26129, devices: 6 });
  const a = sim.devices[0], b = sim.devices[2];
  const m = await mirrors(sim, { a, b });
  assert.equal((await m.write('b', 4, { not: 'b-1' })).published, true);
  await m.deliver('b', 'a', { displace: false });
  await m.sync('a');
  const baseFile = path.resolve(`${m.stateFile.b}.bases`, 'owner-ayse.json');
  const originalRename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (path.resolve(to) === baseFile && !String(from).includes('pending')) throw Object.assign(new Error('simulated base write failure'), { code: 'EIO' });
    return originalRename(from, to);
  };
  try {
    assert.equal((await m.write('b', 4, { not: 'b-2' })).published, true);
    assert.equal((await m.write('b', 5, { not: 'b-3' })).published, true);
  } finally { fsp.rename = originalRename; }
  // A, B'nin ilk yayımını (b-1) görmüş ve onun üstüne yayımlar; bulut A'yı seçer.
  assert.equal((await m.write('a', 3, { not: 'a-1' })).published, true);
  await m.deliver('a', 'b');
  await m.sync('b');
  assert.equal(sim.rowOf(b, 3).not, 'a-1');
  assert.equal(sim.rowOf(b, 4).not, 'b-2', 'sequential own edit is not demoted to a conflict');
  assert.equal(sim.rowOf(b, 5).not, 'b-3');
  assert.deepEqual(await m.conflicts('b'), [], 'no false conflict when the base snapshot write failed');
});
