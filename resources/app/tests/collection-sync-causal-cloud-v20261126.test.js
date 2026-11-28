'use strict';

/* KOLEKSİYON — NEDENSELLİK DENETİMLİ RASTGELE BULUT MODELİ (ADR-0001 Aşama 0)
 *
 * Tek sahipli modelin (collection-sync-randomized-cloud) ötesinde: birden çok
 * cihaz aynı satırın aynı ya da farklı alanlarını düzenler, satır siler,
 * yayım yarıda kesilir, uygulama yeniden başlar. Meşru çakışmalar oluşur; bu
 * yüzden oracle beklenen değeri değil, NEDENSELLİĞİ denetler. Her yazım,
 * yazıldığı anda o cihazda gördüğü (üzerine yazdığı) değeri kaydeder; değerler
 * benzersizdir, böylece "w2, w1'i gördü" ilişkisi kesin bilinir.
 *
 * Mevcut çakışma politikası (eşzamanlı aynı alan: önce yayımlanan kalır, diğeri
 * çakışma kaydına düşer; silme + eşzamanlı düzenleme: satır kalır) DEĞİŞTİRİLMEZ,
 * yalnız şu ihlaller sayılır:
 *  · sessiz kayıp: eşzamanlı ve üstüne yazılmamış bir değer ne son değer ne çakışmada;
 *  · yeni değerin düşmesi: son değer, kaybeden değerin nedensel atasıysa;
 *  · yanlış çakışma: kazanan, kaybedeni görmüşken (nedensel) çakışma kaydı;
 *  · silinen satırın geri gelmesi: silen cihazın görmediği eşzamanlı düzenleme yokken;
 *  · silmenin düzenlemeyi yutması: silenin görmediği düzenleme varken satır yok;
 *  · yanlış silme; yakınsamama.
 * Test kapsamı garanti kapsamı değildir: model, kuralları ve seed'leri kadar kanıttır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const { createCollectionReplication } = require('../server/lib/collection-replication');

const TIMEOUT_MS = process.platform === 'win32' ? 240000 : 90000;
const SEEDS = Array.from({ length: Number(process.env.BUYERLOG_CAUSAL_SEEDS || 10) }, (_, index) => 26401 + index);
const FIELDS = ['not', 'buyer'];

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

async function runCausalScenario(seed, { staleUploadWins = 0, steps = 70, rows: rowCount = 10, onStep = null, onTrace = null } = {}) {
  const sim = await createCollectionSimulation({ seed, devices: 6, rows: rowCount });
  try {
    await sim.bootstrap();
    const random = seeded(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const names = ['a', 'b', 'c'];
    const devices = { a: sim.devices[0], b: sim.devices[2], c: sim.devices[3] };
    const relative = path.relative(sim.hub, sim.workspaceFile());
    const mirror = {}, file = {}, stateFile = {}, replica = {}, downloaded = {};
    let cloud = await fsp.readFile(sim.workspaceFile(), 'utf8');
    const writes = []; // { rowId, field, value, prev, device }
    const deletions = new Map(); // rowId -> { device, observed: { field: value } }
    const initial = new Map();
    for (let id = 1; id <= rowCount; id++) for (const field of FIELDS) initial.set(`${id}|${field}`, String(sim.rowOf(devices.a, id)[field] ?? ''));
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
    const localRows = name => sim.workspaceOf(devices[name]).rows;
    async function edit(name, { interrupted = false } = {}) {
      const rows = localRows(name);
      if (!rows.length) return null;
      const row = pick(rows), field = pick(FIELDS);
      const value = `${name}${log.length}${field[0]}`;
      writes.push({ rowId: Number(row.id), field, value, prev: String(row[field] ?? ''), device: name });
      await devices[name].modules.workspaces.applyRowChangesAsync(OWNER, { upserts: [{ ...row, [field]: value }] });
      if (interrupted) {
        // Yayım tam hub yazımında (atomik yeniden adlandırma) düşer: zarf okunmuş,
        // bekleyen kayıt işaretlenmiş, ama yeni zarf inmemiştir. (Hedefi dizine
        // çevirmek okumada düşer ve bu yolu hiç çalıştırmazdı — bağımsız inceleme F2.)
        const original = fsp.rename, target = path.resolve(file[name]);
        fsp.rename = async (from, to) => { if (path.resolve(to) === target) throw Object.assign(new Error('simulated hub write failure'), { code: 'EIO' }); return original(from, to); };
        try { await replica[name].publishOwner(OWNER).catch(() => null); } finally { fsp.rename = original; }
      } else await replica[name].publishOwner(OWNER).catch(() => null);
      return `${interrupted ? 'edit!' : 'edit'} ${name} ${row.id}.${field}=${value}`;
    }
    const ops = {
      edit: name => edit(name),
      interrupted: name => edit(name, { interrupted: true }),
      async remove(name) {
        const rows = localRows(name).filter(row => !deletions.has(Number(row.id)));
        if (rows.length < Math.ceil(rowCount / 2)) return null;
        const row = pick(rows);
        const result = await devices[name].modules.workspaces.applyRowChangesAsync(OWNER, { deletes: [{ id: row.id, _rev: row._rev }] });
        if (!result.changed) return null;
        deletions.set(Number(row.id), { device: name, observed: Object.fromEntries(FIELDS.map(field => [field, String(row[field] ?? '')])) });
        await replica[name].publishOwner(OWNER).catch(() => null);
        return `delete ${name} ${row.id}`;
      },
      async sync(name) { await replica[name].syncOwner(devices[name].userId, OWNER).catch(() => null); return `sync ${name}`; },
      async upload(name) {
        if (!(await dirty(name))) return null;
        const mine = await read(name);
        if (downloaded[name] === cloud || random() < staleUploadWins) { cloud = mine; downloaded[name] = cloud; return `upload ${name} accepted`; }
        await fsp.writeFile(file[name], cloud);
        downloaded[name] = cloud;
        return `upload ${name} displaced`;
      },
      async download(name) {
        if (await dirty(name)) return null;
        await fsp.writeFile(file[name], cloud); downloaded[name] = cloud;
        return `download ${name}`;
      },
      async restart(name) { replica[name] = make(name); return `restart ${name}`; },
    };
    const weighted = ['edit', 'edit', 'edit', 'edit', 'interrupted', 'remove', 'sync', 'sync', 'sync', 'upload', 'upload', 'download', 'download', 'restart'];
    for (let step = 0; step < steps; step++) {
      const entry = await ops[pick(weighted)](pick(names));
      if (entry) { log.push(entry); if (onStep) onStep(entry, { sim, devices }); }
    }
    for (let round = 0; round < 10; round++) {
      const before = cloud;
      for (const name of names) {
        if (!(await dirty(name)) || downloaded[name] !== cloud) { await fsp.writeFile(file[name], cloud); downloaded[name] = cloud; }
        await replica[name].syncOwner(devices[name].userId, OWNER);
        if (await dirty(name)) { cloud = await read(name); downloaded[name] = cloud; }
        if (onStep) onStep(`settle ${round} ${name}`, { sim, devices });
      }
      if (cloud === before && round > 0) break;
    }

    // ---- Oracle
    const failures = [];
    const conflicts = [];
    for (const name of names) for (const item of await replica[name].listMergeConflicts([OWNER])) conflicts.push({ ...item, device: name });
    const byCell = new Map();
    for (const w of writes) { const key = `${w.rowId}|${w.field}`; if (!byCell.has(key)) byCell.set(key, []); byCell.get(key).push(w); }
    const writeOf = (key, value) => (byCell.get(key) || []).find(w => w.value === value) || null;
    // value'nun nedensel ataları (o değeri yazan cihazın gördüğü zincir).
    const ancestors = (key, value) => {
      const out = new Set();
      let w = writeOf(key, value);
      while (w && !out.has(w.prev)) { out.add(w.prev); w = writeOf(key, w.prev); }
      return out;
    };
    const finalRows = new Map(localRows('a').map(row => [Number(row.id), row]));
    const reported = (key, value) => conflicts.some(item => `${Number(item.rowId)}|${item.field}` === key && String(item.incoming) === value);
    for (let rowId = 1; rowId <= rowCount; rowId++) {
      const row = finalRows.get(rowId);
      const deletion = deletions.get(rowId);
      const rowWrites = writes.filter(w => w.rowId === rowId);
      const unseenByDeleter = deletion ? rowWrites.filter(w => w.value !== deletion.observed[w.field] && !ancestors(`${rowId}|${w.field}`, deletion.observed[w.field]).has(w.value)) : [];
      if (!row) {
        if (!deletion) failures.push(`row ${rowId} wrongly deleted`);
        else {
          // Silenin görmediği ama eşzamanlı alan çakışmasını kaybedip çakışma kaydına
          // düşmüş (bildirilmiş) düzenleme yutulmuş sayılmaz: silen, kazanan durumu gördü.
          // Üzerine yazılmış değer (zincirin ucu ayrıca denetlenir) yutulmuş sayılmaz (bağımsız inceleme F3).
          const supersededByOther = w => rowWrites.some(other => other !== w && other.field === w.field && ancestors(`${rowId}|${w.field}`, other.value).has(w.value));
          const swallowed = unseenByDeleter.filter(w => !reported(`${rowId}|${w.field}`, w.value) && !supersededByOther(w));
          if (swallowed.length) failures.push(`delete swallowed concurrent edit(s) on row ${rowId}: ${swallowed.map(w => w.value).join(',')}`);
        }
        continue;
      }
      if (deletion && !unseenByDeleter.length) failures.push(`deleted row ${rowId} came back without a concurrent edit`);
      for (const field of FIELDS) {
        const key = `${rowId}|${field}`;
        const finalValue = String(row[field] ?? '');
        if (!writeOf(key, finalValue) && finalValue !== initial.get(key)) failures.push(`${key}: unknown final value ${finalValue}`);
        const finalAncestors = ancestors(key, finalValue);
        const seenByDeleter = value => Boolean(deletion) && (value === deletion.observed[field] || ancestors(key, deletion.observed[field]).has(value));
        for (const w of byCell.get(key) || []) {
          if (w.value === finalValue || finalAncestors.has(w.value)) continue; // son değer ya da onun gördüğü
          if (seenByDeleter(w.value)) continue; // silen cihaz bu değeri görüp bilerek attı
          // Başka bir yazım bu değeri gördüyse (üzerine yazdıysa) kaybı meşrudur; zincirin ucu ayrıca denetlenir.
          if ((byCell.get(key) || []).some(other => other !== w && ancestors(key, other.value).has(w.value))) continue;
          if (ancestors(key, w.value).has(finalValue)) { failures.push(`${key}: newer ${w.value} lost to its ancestor ${finalValue}${reported(key, w.value) ? ' (reported)' : ''}`); continue; }
          if (!reported(key, w.value)) failures.push(`${key}: silent loss of concurrent ${w.value}`);
        }
      }
    }
    for (const item of conflicts) {
      if (!FIELDS.includes(item.field)) continue;
      const key = `${Number(item.rowId)}|${item.field}`;
      if (ancestors(key, String(item.current)).has(String(item.incoming))) failures.push(`${item.device}: false conflict ${key} kept ${item.current} which had seen ${item.incoming}`);
      if (ancestors(key, String(item.incoming)).has(String(item.current))) failures.push(`${item.device}: conflict demoted newer ${item.incoming} under its ancestor ${item.current}`);
    }
    // Yeni satır yaratılmaz: fazladan kimlik bir satırın çoğaltıldığını gösterir.
    for (const [rowId, row] of finalRows) if (rowId > rowCount) failures.push(`row duplicated as ${rowId}: ${FIELDS.map(field => `${field}=${row[field] ?? ''}`).join(' ')}`);
    const states = names.map(name => JSON.stringify(localRows(name).map(row => [row.id, ...FIELDS.map(field => row[field])])));
    if (new Set(states).size !== 1) failures.push('installations did not converge');
    return { failures, log, writes: writes.length, deletions: deletions.size, conflicts: conflicts.length };
  } finally { await sim.close(); }
}

/* Bilinen sınır: silinip eşzamanlı düzenlenen ve geri gelen satırın silinme
   öncesi hâli taban olarak bilinmez; iki yönlü birleşir. Sonuç sessiz kayıp
   değil, çakışma kaydıdır (yanlış çakışma ya da yeni değerin çakışmaya düşmesi).
   Tüm-belge modelinde bu duruma yeni durum eklenmez; Aşama 1 (olay günlüğü +
   silme işaretleri) yapısal olarak hedefler. */
const KNOWN_LIMIT = /\(reported\)$|false conflict|conflict demoted newer/;
const strict = failures => failures.filter(item => !KNOWN_LIMIT.test(item));

/* Senaryo seed'e göre deterministiktir: aynı seed aynı hata listesini ve aynı izi
   (log) üretir. Bu yüzden seed başına TEK koşu, katı denetim ile bilinen sınır
   (todo) testine paylaştırılır; seed, adım, cihaz ve doğrulamalar değişmez.
   Önceden todo testi aynı 10 senaryoyu birebir yeniden koşuyordu (dosya süresinin
   yarısı; Windows tam regresyonunun kritik yolu). Varsayım aşağıdaki determinizm
   testiyle sınanır: varsayım bozulursa test düşer ve paylaşım kaldırılmalıdır. */
const scenarioRuns = new Map();
function scenarioOnce(seed) {
  if (!scenarioRuns.has(seed)) scenarioRuns.set(seed, runCausalScenario(seed));
  return scenarioRuns.get(seed);
}

for (const seed of SEEDS) {
  test(`nedensel bulut sırası (seed ${seed}): sessiz kayıp, yanlış silme, çoğaltma, gereksiz geri gelme yok`, { timeout: TIMEOUT_MS }, async () => {
    const { failures, log } = await scenarioOnce(seed);
    assert.deepEqual(strict(failures), [], `seed ${seed}\n${log.join('\n')}`);
  });
}

test('nedensel bulut: geri gelen satırda çakışma kaydına düşen yeni değer / yanlış çakışma', { todo: 'silme öncesi satır tabanı gerektirir: Aşama 1 olay günlüğü (ADR-0001)', timeout: TIMEOUT_MS * 2 }, async () => {
  const known = [];
  for (const seed of SEEDS) known.push(...(await scenarioOnce(seed)).failures.filter(item => KNOWN_LIMIT.test(item)).map(item => `${seed} ${item}`));
  assert.deepEqual(known, []);
});

test('nedensel bulut senaryosu deterministik: aynı seed yeniden koşulunca hata listesi ve iz birebir aynı (paylaşılan koşu varsayımı)', { timeout: TIMEOUT_MS }, async () => {
  const seed = SEEDS[0];
  const shared = await scenarioOnce(seed);
  const fresh = await runCausalScenario(seed);
  assert.deepEqual(fresh.failures, shared.failures);
  assert.deepEqual(fresh.log, shared.log);
  assert.equal(fresh.writes, shared.writes);
  assert.equal(fresh.conflicts, shared.conflicts);
});

module.exports = { runCausalScenario };
