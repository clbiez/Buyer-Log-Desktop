'use strict';

/* KOLEKSİYON — RASTGELE İŞLEM SIRALARIYLA BULUT MODELİ (ADR-0001 Aşama 0)
 *
 * Beklenen sonuçları elle yazılmış senaryoların ötesinde: seed'li rastgele
 * sıralarla düzenleme, silme, senkron, yükleme, indirme, yeniden başlatma ve
 * kurulum kimliği kaybı üretilir. OneDrive modeli: tek bulut kopyası; bir
 * aynanın yüklemesi, aynanın son indirdiği sürüm hâlâ buluttaysa kabul edilir,
 * değilse bulut rastgele birini seçer ve kaybeden ayna bulut kopyasını alır
 * (yerinden edilme). Bulut, kabul ettiğinden daha eski bir sürümü sonradan
 * teslim etmez (sırasız teslim ayrı, bilinen sınır testinde). Belgelenen
 * OneDrive davranışında çakışan yüklemeyi yapan istemcinin dosyası -PC
 * kopyasına ayrılır, sunucu kopyası korunur [Muhtemel; bu testte doğrulanmadı].
 *
 * Oracle: her satırın tek sahibi (cihazı) vardır; yalnız sahibi düzenler ve
 * siler. Bu yüzden meşru çakışma yoktur ve son durum tektir:
 *  · sessiz kayıp yok (her hücre sahibinin son değeri),
 *  · yanlış silme yok (silinmeyen satır var), silinen satır geri gelmez,
 *  · yanlış çakışma kaydı yok, tüm kurulumlar yakınsar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { createCollectionReplication } = require('../server/lib/collection-replication');

const TIMEOUT_MS = process.platform === 'win32' ? 240000 : 90000;
const SEEDS = Array.from({ length: 12 }, (_, index) => 26201 + index);

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

async function runScenario(seed, { onTrace = null, onStep = null, staleUploadWins = 0 } = {}) {
  const sim = await createCollectionSimulation({ seed, devices: 6, rows: 24 });
  try {
    await sim.bootstrap();
    const random = seeded(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const names = ['a', 'b', 'c'];
    const devices = { a: sim.devices[0], b: sim.devices[2], c: sim.devices[3] };
    const rowsOf = { a: [1, 2, 3, 4, 5, 6, 7, 8], b: [9, 10, 11, 12, 13, 14, 15, 16], c: [17, 18, 19, 20, 21, 22, 23, 24] };
    const relative = path.relative(sim.hub, sim.workspaceFile());
    const mirror = {}, file = {}, stateFile = {}, replica = {}, downloaded = {};
    let cloud = await fsp.readFile(sim.workspaceFile(), 'utf8');
    const expected = new Map(); // rowId -> expected 'not' value; null = deleted
    const log = [];
    const make = name => createCollectionReplication({
      workspaces: devices[name].modules.workspaces, permissions: devices[name].permissions,
      getSharedSyncRoot: async () => mirror[name], stateFile: stateFile[name],
      onTrace: onTrace ? (event, detail) => onTrace(name, event, detail) : null,
    });
    for (const name of names) {
      mirror[name] = path.join(sim.root, `mirror-${name}`);
      file[name] = path.join(mirror[name], relative);
      stateFile[name] = path.join(devices[name].local, 'collection-replication-state.json');
      await fsp.mkdir(path.dirname(file[name]), { recursive: true });
      await fsp.writeFile(file[name], cloud);
      downloaded[name] = cloud;
      replica[name] = make(name);
    }
    const read = name => fsp.readFile(file[name], 'utf8');
    const dirty = async name => (await read(name)) !== downloaded[name];
    const ops = {
      async edit(name) {
        const rowId = pick(rowsOf[name].filter(id => expected.get(id) !== null));
        if (!rowId) return;
        const row = sim.rowOf(devices[name], rowId);
        if (!row) throw new Error(`seed ${seed}: owner ${name} lost its own row ${rowId}`);
        const value = `${name}-${log.length}`;
        await devices[name].modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, not: value }] });
        expected.set(rowId, value);
        await replica[name].publishOwner(OWNER).catch(() => null);
        return `edit ${name} ${rowId}=${value}`;
      },
      async remove(name) {
        const candidates = rowsOf[name].filter(id => expected.get(id) !== null);
        if (candidates.length < 3) return;
        const rowId = pick(candidates);
        const row = sim.rowOf(devices[name], rowId);
        if (!row) throw new Error(`seed ${seed}: owner ${name} lost its own row ${rowId}`);
        const result = await devices[name].modules.workspaces.applyRowChangesAsync(OWNER, { deletes: [{ id: row.id, _rev: row._rev }] });
        if (!result.changed) return;
        expected.set(rowId, null);
        await replica[name].publishOwner(OWNER).catch(() => null);
        return `delete ${name} ${rowId}`;
      },
      async sync(name) { await replica[name].syncOwner(devices[name].userId, OWNER).catch(() => null); return `sync ${name}`; },
      async upload(name) {
        if (!(await dirty(name))) return;
        const mine = await read(name);
        if (downloaded[name] === cloud || random() < staleUploadWins) { cloud = mine; downloaded[name] = cloud; return `upload ${name} accepted`; }
        await fsp.writeFile(file[name], cloud); // yerinden edildi
        downloaded[name] = cloud;
        return `upload ${name} displaced`;
      },
      async download(name) {
        if (await dirty(name)) return;
        await fsp.writeFile(file[name], cloud);
        downloaded[name] = cloud;
        return `download ${name}`;
      },
      async restart(name) { replica[name] = make(name); return `restart ${name}`; },
    };
    const weighted = ['edit', 'edit', 'edit', 'remove', 'sync', 'sync', 'sync', 'upload', 'upload', 'download', 'download', 'restart'];
    for (let step = 0; step < 60; step++) {
      const entry = await ops[pick(weighted)](pick(names));
      if (entry) { log.push(entry); if (onStep) onStep(entry); }
    }
    // Yerleşme: sırayla indir → senkron → yükle; bulut değişmeyene kadar.
    for (let round = 0; round < 8; round++) {
      const before = cloud;
      for (const name of names) {
        // Yüklenmemiş değişiklik eski bir bulut sürümü üstündeyse bulut kendi
        // kopyasını korur (yerinden edilme); güncelse aşağıda kabul edilir.
        if (!(await dirty(name)) || downloaded[name] !== cloud) { await fsp.writeFile(file[name], cloud); downloaded[name] = cloud; }
        await replica[name].syncOwner(devices[name].userId, OWNER);
        if (await dirty(name)) {
          if (downloaded[name] !== cloud) throw new Error(`seed ${seed}: settle produced a concurrent upload`);
          cloud = await read(name); downloaded[name] = cloud;
        }
      }
      if (cloud === before && round > 0) break;
    }
    const failures = [];
    for (const name of names) {
      const device = devices[name];
      for (const [rowId, value] of expected) {
        const row = sim.rowOf(device, rowId);
        if (value === null && row) failures.push(`${name}: deleted row ${rowId} came back`);
        if (value !== null && !row) failures.push(`${name}: row ${rowId} wrongly deleted`);
        if (value !== null && row && row.not !== value) failures.push(`${name}: row ${rowId} = ${row.not}, expected ${value}`);
      }
      const conflicts = await replica[name].listMergeConflicts([OWNER]);
      if (conflicts.length) failures.push(`${name}: ${conflicts.length} false conflict(s): ${JSON.stringify(conflicts.map(item => [item.rowId, item.field, item.incoming]))}`);
    }
    const workspaces = names.map(name => JSON.stringify(sim.workspaceOf(devices[name]).rows));
    if (new Set(workspaces).size !== 1) failures.push('installations did not converge');
    return { failures, log };
  } finally { await sim.close(); }
}

for (const seed of SEEDS) {
  test(`rastgele bulut sırası (seed ${seed}): sessiz kayıp, yanlış silme, geri gelen silme ve yanlış çakışma yok`, { timeout: TIMEOUT_MS }, async () => {
    const { failures, log } = await runScenario(seed);
    assert.deepEqual(failures, [], `seed ${seed}\n${log.join('\n')}`);
  });
}

/* BİLİNEN YAPISAL SINIR (yürütülmüş RED/TODO). Bulut, eski bir sürüm üstüne
   kurulmuş yüklemeyi kabul edip daha yenisini düşürürse kimsenin kopyasında
   olmayan bir kardeş dal oluşur. Bekleyen yayımı olmayan üçüncü cihaz kendi
   son tabanını bu dalın atası sanar ve dalda eksik olan alanları "uzakta
   değişti" kabul eder. Tüm-belge + tek taban üç yönlü birleşimde ortak ata
   bilinmediği için kapatılamaz; alan düzeyi nedensellik ya da cihaz başına
   değişmez olay günlüğü gerekir (ADR-0003). Ölçüm (40 seed, 2026-11-26):
   düzeltme öncesi 258 sessiz kayıp, Aşama 0 sonrası 2. */
test('düşmanca bulut: eski tabanlı yükleme kazanırsa kardeş dal kaybı', { todo: 'ortak ata gerektirir: alan düzeyi nedensellik / olay günlüğü (ADR-0003)', timeout: TIMEOUT_MS * 2 }, async () => {
  const failures = [];
  for (const seed of SEEDS) failures.push(...(await runScenario(seed, { staleUploadWins: 0.5 })).failures.map(item => `${seed} ${item}`));
  assert.deepEqual(failures, []);
});

module.exports = { runScenario };
