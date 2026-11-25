'use strict';

/* FİYAT TALEBİ CİHAZLAR ARASI BİRLEŞİMİ — 20 KURULUM (v2026-11-25).

   `store:quotations.json` kopyaları yerel DB delta birleşiminde talep kimliğiyle,
   aynı talebin kopyaları `quotationLedger.mergeRequestCopies` ile birleşir.
   Not: bu sürümde eşler arası paylaşım kanalı (shared-sync-policy) fiyat
   taleplerini TAŞIMAZ; birleşim yerel DB'nin uzak delta yolunda çalışır ve
   kanal açıldığında yakınsamanın doğru olması gerekir.

   RED ile kanıtlanan kök nedenler:
   1) Talep alanları daha yeni kopyadan alınırken SATIR KÜMESİ de oradan
      alınıyordu: başka cihazda eşzamanlı eklenen üretici, satırları, girilen
      fiyatlar ve defter olayları kayboluyordu. İstemcide satır silen akış yoktur
      (drop bir işarettir), bu yüzden satırlar kimlikle birleşir.
   2) Satır değişikliği yoksa pazarlık turu (round/rounds) birleşmiyordu; başka
      cihazdaki sonraki not düzenlemesi yeni turu siliyordu.

   Özellikler: değişme, idempotentlik, emilim (birebir); birleşme ve rastgele
   sıralı/çift teslimli yakınsama (içerik; satır/üretici görüntü sırası hariç). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pricing-merge-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const ledger = require(path.join(ROOT, 'server', 'lib', 'quotation-ledger.js'));
const { createLocalDb } = require(path.join(ROOT, 'server', 'lib', 'local-db.js'));
const sim = require('./helpers/pricing-sim');

const DEVICES = 20;
const USERS = Array.from({ length: DEVICES }, (_, i) => ({ id: `user-${i}`, role: 'user', displayName: `Kullanıcı ${i}` }));
const T0 = '2026-11-25T07:00:00.000Z';
const merge = ledger.mergeRequestCopies;

function baseRequest(seed) {
  const models = Array.from({ length: 8 }, (_, i) => ({ modelKey: `kol:${seed}-${i + 1}`, rowId: i + 1, modelCode: `M-${i + 1}`, plmId: `P-${i + 1}`, targetPrice: '4,00' }));
  const items = models.slice(0, 4).map((model, i) => ({ id: `base-${seed}-${i + 1}`, ...model, manufacturer: 'Atölye A', price: '', approved: false, dropped: false, rev: 0, updatedAt: '', history: [] }));
  return store.normalizeRequest({ id: `q-${seed}`, source: 'collection', createdAt: T0, updatedAt: T0, ownerId: USERS[0].id, ownerName: USERS[0].displayName,
    manufacturers: [{ name: 'Atölye A' }], items, models: models.slice(4) });
}

/* Sunucunun yazdığı biçimde yerel bir değişiklik (ledger.applyLineChange,
   model başına tek onay, satır ekleme + bekleyen modeli düşürme, yeni tur). */
function localOp(req, device, at, random, counters) {
  const user = USERS[device], roll = random();
  if (roll < 0.5 && req.items.length) {
    const index = sim.int(random, req.items.length), line = req.items[index];
    const kind = sim.pick(random, ['price', 'price', 'price', 'approve', 'unapprove', 'drop', 'undrop']);
    const patch = kind === 'price' ? { price: sim.price(random) }
      : kind === 'approve' ? (ledger.priceNumber(line.price) == null ? { price: sim.price(random), approved: true } : { approved: true })
        : kind === 'unapprove' ? { approved: false } : { dropped: kind === 'drop' };
    const result = ledger.applyLineChange(line, patch, user, { round: req.round || 1, at });
    if (!result.changed) return null;
    req.items[index] = { ...line, ...result.line };
    if (result.line.approved && !line.approved) {
      req.items = req.items.map(item => {
        if (item.id === line.id || item.modelKey !== line.modelKey || !item.approved) return item;
        const off = ledger.applyLineChange(item, { approved: false }, user, { round: req.round || 1, source: 'exclusive', at });
        return off.changed ? { ...item, ...off.line } : item;
      });
    }
    req.updatedAt = at;
    return { kind, line: line.id, ...patch };
  }
  if (roll < 0.72) {
    // Yeni üretici: bazen başka cihazın da eklediği ortak ad (aynı hücreye eşzamanlı ekleme).
    const shared = random() < 0.25;
    const name = shared ? `Ortak Atölye ${sim.int(random, 2)}` : `Atölye ${device}-${++counters[device]}`;
    if (!req.manufacturers.some(m => sim.mfrKey(m.name) === sim.mfrKey(name))) req.manufacturers.push({ name, email: '' });
    const seeds = new Map();
    [...req.items, ...(req.models || [])].forEach(item => { if (!seeds.has(item.modelKey)) seeds.set(item.modelKey, item); });
    const added = [];
    for (const [modelKey, seedItem] of seeds) {
      if (random() < 0.3 && added.length) continue;
      if (req.items.some(item => item.modelKey === modelKey && sim.mfrKey(item.manufacturer) === sim.mfrKey(name))) continue;
      const id = `line-${device}-${at}-${added.length}`;
      req.items.push(store.normalizeRequest({ items: [{ ...seedItem, id, manufacturer: name, price: '', approved: false, dropped: false, rev: 0, updatedAt: '', updatedBy: '', history: [] }] }).items[0]);
      added.push(id);
    }
    const lined = new Set(req.items.map(item => item.modelKey));
    req.models = (req.models || []).filter(model => !lined.has(model.modelKey));
    req.updatedAt = at;
    return { kind: 'add-manufacturer', name, added };
  }
  if (roll < 0.86) { req.note = `not ${device} ${at}`; req.updatedAt = at; return { kind: 'note' }; }
  const next = (req.round || 1) + 1;
  req.round = next;
  req.rounds = ledger.normalizeRounds([...(req.rounds || []), { n: next, at, by: user.id, byName: user.displayName, note: `tur ${next} / ${device}` }]);
  req.updatedAt = at;
  return { kind: 'round', n: next };
}

/* 20 cihaz ortak tabandan başlar; yerel değişiklik yapar ve rastgele eşlerle
   (gecikmeli, eski kopyayla, çift) dedikodu birleşimi yapar. */
function runReplicas(seed, operations) {
  const random = sim.seededRandom(seed), clock = sim.createClock(), log = [];
  const base = baseRequest(seed), replicas = Array.from({ length: DEVICES }, () => sim.clone(base));
  const history = Array.from({ length: DEVICES }, () => []), counters = Array(DEVICES).fill(0);
  for (let ordinal = 0; ordinal < operations; ordinal++) {
    const device = sim.int(random, DEVICES);
    if (random() < 0.22) {
      // Eşten gelen kopya: bazen o eşin daha eski bir anlık görüntüsü (gecikmeli teslim).
      const peer = sim.int(random, DEVICES), snapshots = history[peer];
      const incoming = snapshots.length && random() < 0.4 ? snapshots[sim.int(random, snapshots.length)] : replicas[peer];
      replicas[device] = merge(replicas[device], sim.clone(incoming));
      log.push({ ordinal, device, kind: 'merge', peer });
      continue;
    }
    const at = clock(device);
    const op = localOp(replicas[device], device, at, random, counters);
    if (op) {
      log.push({ ordinal, device, at, ...op });
      // Gecikmeli teslim için cihaz başına son birkaç anlık görüntü yeter (soak belleği sınırlı kalır).
      history[device].push(sim.clone(replicas[device]));
      if (history[device].length > 8) history[device].shift();
    }
  }
  return { base, replicas: replicas.map(item => store.normalizeRequest(item)), snapshots: history.flat(), log };
}

function foldAll(random, copies) {
  // Rastgele sıra + %20 çift teslim + ara birleşimler (ağaç biçiminde).
  const queue = sim.shuffle(random, copies.concat(copies.filter(() => random() < 0.2)));
  while (queue.length > 1) {
    const a = queue.splice(sim.int(random, queue.length), 1)[0], b = queue.splice(sim.int(random, queue.length), 1)[0];
    queue.push(random() < 0.5 ? merge(a, b) : merge(b, a));
  }
  return queue[0];
}

function lineTime(item) { return String(item.updatedAt || ''); }

for (const seed of sim.SEEDS) {
  test(`20 kurulum: aynı talebin kopyaları değişmeli/idempotent/birleşmeli birleşir ve kayıpsız yakınsar (seed ${seed})`, async () => {
    const operations = sim.scale(900);
    const { base, replicas, snapshots, log } = runReplicas(seed, operations);
    await sim.withRepro('pricing-merge', seed, log, async () => {
      const random = sim.seededRandom(seed ^ 0x5eed);
      const pool = replicas.concat(snapshots.filter(() => random() < 0.05));
      for (let i = 0; i < sim.scale(120); i++) {
        const a = sim.pick(random, pool), b = sim.pick(random, pool), c = sim.pick(random, pool);
        const ab = merge(a, b);
        assert.deepEqual(ab, merge(b, a), 'değişme: merge(a,b) = merge(b,a)');
        assert.deepEqual(merge(ab, ab), ab, 'idempotent: merge(m,m) = m');
        assert.deepEqual(merge(ab, b), ab, 'emilim: aynı kopyanın ikinci teslimi sonucu değiştirmez');
        assert.deepEqual(sim.canonicalRequest(merge(ab, c)), sim.canonicalRequest(merge(a, merge(b, c))), 'birleşme: (a·b)·c = a·(b·c)');
      }
      const results = [0, 1, 2].map(k => foldAll(sim.seededRandom(seed + k), replicas));
      assert.deepEqual(sim.canonicalRequest(results[1]), sim.canonicalRequest(results[0]), 'farklı teslim sırası aynı sonuca yakınsar');
      assert.deepEqual(sim.canonicalRequest(results[2]), sim.canonicalRequest(results[0]), 'çift teslim sonucu değiştirmez');
      const final = results[0];

      // Hiçbir cihazın satırı/defter olayı/turu kaybolmaz.
      const finalLines = new Map(final.items.map(item => [item.id, item]));
      const cells = new Map();
      for (const copy of replicas) for (const item of copy.items) {
        const cell = `${item.modelKey}\u0000${sim.mfrKey(item.manufacturer)}`;
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push(item);
      }
      for (const [cell, lines] of cells) {
        const stateful = lines.filter(item => item.price || item.approved || item.dropped || item.history.length);
        const survivors = final.items.filter(item => `${item.modelKey}\u0000${sim.mfrKey(item.manufacturer)}` === cell);
        assert.ok(survivors.length >= 1, `hücre kaybolmamalı: ${cell}`);
        for (const item of stateful) assert.ok(finalLines.has(item.id), `fiyat/onay/drop taşıyan satır kaybolmamalı: ${item.id}`);
      }
      for (const item of final.items) {
        const copies = replicas.map(copy => copy.items.find(entry => entry.id === item.id)).filter(Boolean);
        const latest = copies.reduce((best, entry) => (lineTime(entry) > lineTime(best) ? entry : best));
        assert.equal(item.price, latest.price, `${item.id}: en yeni satır değişikliğinin fiyatı`);
        assert.equal(item.approved, latest.approved, `${item.id}: en yeni satır değişikliğinin onayı`);
        assert.equal(item.dropped, latest.dropped, `${item.id}: en yeni satır değişikliğinin drop durumu`);
        const events = ledger.normalizeHistory(copies.flatMap(entry => entry.history)).map(event => event.id);
        assert.deepEqual(item.history.map(event => event.id), events, `${item.id}: defter bütün cihazların olaylarını tutar (sınır: ${ledger.MAX_HISTORY})`);
      }
      const maxRound = Math.max(...replicas.map(copy => copy.round || 1));
      assert.equal(final.round, maxRound, 'en yüksek pazarlık turu korunur');
      assert.deepEqual(final.rounds.map(round => round.n), ledger.normalizeRounds(replicas.flatMap(copy => copy.rounds)).map(round => round.n), `bütün turlar korunur (sınır: ${ledger.MAX_ROUNDS})`);
      const names = new Set(replicas.flatMap(copy => copy.items.map(item => sim.mfrKey(item.manufacturer))));
      assert.deepEqual(new Set(final.manufacturers.map(m => sim.mfrKey(m.name))), names, 'satırı olan her üretici talepte listelenir');
      const lined = new Set(final.items.map(item => item.modelKey));
      assert.deepEqual(final.models.map(m => m.modelKey), base.models.map(m => m.modelKey).filter(key => !lined.has(key)), 'bekleyen modeller = satırı açılmamış modeller');
      const newest = replicas.reduce((best, copy) => (String(copy.updatedAt) > String(best.updatedAt) ? copy : best));
      assert.equal(final.note, newest.note, 'talep alanları en yeni kopyadan gelir');
    });
  });
}

test('pazarlık turu: başka cihazın sonraki ilgisiz düzenlemesi yeni turu silmez', () => {
  const base = baseRequest('round');
  const a = sim.clone(base), b = sim.clone(base);
  a.round = 2; a.rounds = [{ n: 2, at: '2026-11-25T09:00:00.000Z', by: 'user-1', byName: 'Kullanıcı 1', note: 'ikinci tur' }]; a.updatedAt = '2026-11-25T09:00:00.000Z';
  b.note = 'B notu'; b.updatedAt = '2026-11-25T09:05:00.000Z';
  for (const merged of [merge(a, b), merge(b, a)]) {
    assert.equal(merged.note, 'B notu');
    assert.equal(merged.round, 2, 'tur geri gitmez');
    assert.deepEqual(merged.rounds.map(round => round.n), [2]);
  }
  // Aynı tur iki cihazda eşzamanlı açıldıysa seçim sıradan bağımsızdır (ilk açılış).
  const c = sim.clone(base); c.round = 2; c.rounds = [{ n: 2, at: '2026-11-25T09:01:00.000Z', by: 'user-2', byName: 'Kullanıcı 2', note: 'diğer' }]; c.updatedAt = '2026-11-25T09:01:00.000Z';
  assert.deepEqual(merge(merge(a, b), c).rounds, merge(a, merge(c, b)).rounds);
  assert.equal(merge(merge(a, b), c).rounds[0].note, 'ikinci tur');
});

test('eşzamanlı üretici ekleme: iki cihazın satırları, fiyatları ve defterleri korunur', () => {
  const base = baseRequest('mfr');
  const a = sim.clone(base), b = sim.clone(base);
  const atA = '2026-11-25T09:00:00.000Z', atB = '2026-11-25T09:10:00.000Z';
  a.manufacturers.push({ name: 'Atölye X' });
  const priced = ledger.applyLineChange({ price: '', approved: false, dropped: false, history: [], rev: 0 }, { price: '5,10' }, USERS[1], { at: atA }).line;
  a.items.push({ ...base.items[0], id: 'x-1', manufacturer: 'Atölye X', ...priced });
  a.updatedAt = atA;
  b.manufacturers.push({ name: 'Atölye Y' });
  b.items.push({ ...base.items[0], id: 'y-1', manufacturer: 'Atölye Y', price: '', history: [], rev: 0, updatedAt: '' });
  b.updatedAt = atB;
  for (const merged of [merge(a, b), merge(b, a)]) {
    assert.deepEqual(merged.items.map(item => item.id).sort(), [...base.items.map(item => item.id), 'x-1', 'y-1'].sort());
    assert.equal(merged.items.find(item => item.id === 'x-1').price, '5,10', 'A cihazının fiyatı kaybolmaz');
    assert.equal(merged.items.find(item => item.id === 'x-1').history.length, 1, 'A cihazının defter olayı kaybolmaz');
    assert.deepEqual(merged.manufacturers.map(m => m.name).sort(), ['Atölye A', 'Atölye X', 'Atölye Y']);
  }
  // Aynı üretici iki cihazda eklendiyse durumsuz fazlalık satır tek hücreye iner; fiyatlı satır kalır.
  const c = sim.clone(a); c.items = c.items.filter(item => item.id !== 'x-1'); c.items.push({ ...base.items[0], id: 'x-0', manufacturer: 'atölye  x', price: '', history: [], rev: 0, updatedAt: '' }); c.updatedAt = atB;
  const both = merge(a, c);
  assert.deepEqual(both.items.filter(item => item.modelKey === base.items[0].modelKey && sim.mfrKey(item.manufacturer) === sim.mfrKey('Atölye X')).map(item => item.id), ['x-1']);
});

test('yalnız alternatif fiyatı olan satır fazlalık sayılmaz; aynı hücrede korunur', () => {
  const base = baseRequest('opt');
  const a = sim.clone(base), b = sim.clone(base);
  a.items.push({ ...base.items[0], id: 'o-2', manufacturer: 'Atölye Z', price: '', history: [], rev: 1, updatedAt: '', options: [{ id: 'opt-1', label: 'Opsiyon', price: '3,30', note: '' }] });
  a.updatedAt = '2026-11-25T09:00:00.000Z';
  b.items.push({ ...base.items[0], id: 'o-1', manufacturer: 'Atölye Z', price: '', history: [], rev: 0, updatedAt: '' });
  b.updatedAt = '2026-11-25T09:05:00.000Z';
  for (const merged of [merge(a, b), merge(b, a)]) {
    const cell = merged.items.filter(item => item.modelKey === base.items[0].modelKey && item.manufacturer === 'Atölye Z');
    assert.deepEqual(cell.map(item => item.id), ['o-2'], 'alternatif fiyat taşıyan satır kalır, boş kopya düşer');
  }
});

test('üretici yeniden adlandırma: eski ad birleşimle geri gelmez', () => {
  const base = baseRequest('rename');
  const renamed = sim.clone(base);
  renamed.manufacturers = [{ name: 'Atölye Yeni' }];
  renamed.items = renamed.items.map(item => ({ ...item, manufacturer: 'Atölye Yeni' }));
  renamed.updatedAt = '2026-11-25T09:00:00.000Z';
  for (const merged of [merge(base, renamed), merge(renamed, base)]) {
    assert.deepEqual(merged.manufacturers.map(m => m.name), ['Atölye Yeni']);
    assert.ok(merged.items.every(item => item.manufacturer === 'Atölye Yeni'));
  }
});

/* Gerçek yerel DB motoru: 20 kurulum, karışık sıralı, gecikmeli ve çift
   teslim, saklama süresi dolan talebin silme izi. */
for (const seed of sim.SEEDS.slice(0, sim.SOAK ? sim.SEEDS.length : 1)) {
  test(`yerel DB delta birleşimi: 20 kurulum aynı sonuca yakınsar, silinen talep geri gelmez (seed ${seed})`, { timeout: process.platform === 'win32' ? 120000 : 60000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pricing-ldb-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const random = sim.seededRandom(seed), clock = sim.createClock(), log = [], counters = Array(DEVICES).fill(0);
    const id = 'store:quotations.json';
    const devices = Array.from({ length: DEVICES }, (_, i) => createLocalDb(path.join(root, `device-${i}`, 'BuyerLogLocal.db')));
    const deviceIds = await Promise.all(devices.map(async db => (await db.read()).deviceId));
    const live = baseRequest(`ldb-${seed}`), expired = { ...baseRequest(`old-${seed}`), id: `q-old-${seed}`, updatedAt: '2024-01-01T00:00:00.000Z' };
    const readRequests = async db => (((await db.read()).records[id] || {}).requests || []);
    const readDeleted = async db => (((await db.read()).records[id] || {}).deletedRequests || {});
    const inbox = devices.map(() => []);
    async function publish(device) {
      const pending = await devices[device].pending();
      for (const item of pending) {
        const delta = { id: item.id, eventId: item.eventId, patch: item.patch, revision: item.revision, baseRevision: item.baseRevision, deviceId: deviceIds[device] };
        for (let target = 0; target < DEVICES; target++) if (target !== device) {
          inbox[target].push(delta);
          if (random() < 0.15) inbox[target].push(delta); // çift teslim
        }
      }
      await devices[device].markSynced(pending.map(item => item.eventId));
    }
    async function deliver(target, all = false) {
      // Kalan teslimatın bir kısmı sonraki tura gecikir; sıra karışıktır.
      const ready = sim.shuffle(random, inbox[target]);
      const now = all ? ready : ready.filter(() => random() < 0.6);
      inbox[target] = all ? [] : ready.filter(delta => !now.includes(delta));
      for (let i = 0; i < now.length; i += 12) await devices[target].applyDeltas(now.slice(i, i + 12));
    }
    await sim.withRepro('pricing-localdb', seed, log, async () => {
      await devices[0].queuePatch({ id, patch: { requests: [live, expired], deletedRequests: {} } });
      await publish(0);
      for (let target = 1; target < DEVICES; target++) await deliver(target, true);
      const rounds = sim.scale(3);
      for (let round = 0; round < rounds; round++) {
        for (let device = 0; device < DEVICES; device++) {
          const requests = sim.clone(await readRequests(devices[device])), deleted = sim.clone(await readDeleted(devices[device]));
          const index = requests.findIndex(item => item.id === live.id);
          if (index < 0) continue;
          const at = clock(device);
          if (round === 1 && device === 0) {
            // Saklama süresi dolan talep bu cihazda silinir; iz zamanı kaydın son zamanından yenidir.
            const kept = requests.filter(item => item.id !== expired.id);
            deleted[expired.id] = at;
            await devices[device].queuePatch({ id, patch: { requests: kept, deletedRequests: deleted } });
            log.push({ round, device, at, kind: 'retention-delete' });
          } else {
            const op = localOp(requests[index], device, at, random, counters);
            requests[index] = store.normalizeRequest(requests[index]);
            await devices[device].queuePatch({ id, patch: { requests, deletedRequests: deleted } });
            log.push({ round, device, at, ...(op || { kind: 'noop' }) });
          }
          await publish(device);
        }
        for (let target = 0; target < DEVICES; target++) await deliver(target, round === rounds - 1);
      }
      for (let target = 0; target < DEVICES; target++) await deliver(target, true);
      const finals = await Promise.all(devices.map(readRequests));
      const reference = sim.canonicalRequests(finals[0]);
      for (let device = 1; device < DEVICES; device++) assert.deepEqual(sim.canonicalRequests(finals[device]), reference, `cihaz ${device} aynı sonuca yakınsamalı`);
      for (const list of finals) assert.equal(list.some(item => item.id === expired.id), false, 'silme izi olan talep geri gelmez');
      const deletedMaps = await Promise.all(devices.map(readDeleted));
      for (const map of deletedMaps) assert.ok(map[expired.id], 'silme izi her cihaza ulaşır');
      const final = finals[0].find(item => item.id === live.id);
      const added = log.filter(entry => entry.kind === 'add-manufacturer').flatMap(entry => entry.added);
      const finalIds = new Set(final.items.map(item => item.id));
      const priced = log.filter(entry => entry.kind === 'price').map(entry => entry.line);
      for (const lineId of priced) assert.ok(finalIds.has(lineId), `fiyat girilen satır kaybolmamalı: ${lineId}`);
      const cells = new Set(final.items.map(item => `${item.modelKey}\u0000${sim.mfrKey(item.manufacturer)}`));
      for (const entry of log.filter(item => item.kind === 'add-manufacturer' && item.added.length)) {
        assert.ok([...cells].some(cell => cell.endsWith(`\u0000${sim.mfrKey(entry.name)}`)), `eklenen üretici kaybolmamalı: ${entry.name}`);
      }
      assert.ok(added.length > 0 && priced.length > 0, 'senaryo üretici ekleme ve fiyat girişi içermeli');
    });
  });
}
