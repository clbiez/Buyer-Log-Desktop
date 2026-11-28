'use strict';

/* CP PAYLAŞILAN ALANLAR — YAZAR EL DEĞİŞTİRİR (ADR-0001 §14 simülasyon kapısı, 2026-11-28)
 *
 * sync-simulation-v20261009 rastgele üreticisinde her (sipariş, alan) çiftini tek cihaz yazar;
 * yazarın cihaz değiştirdiği nedensel zincir yalnız 2 cihazlı tek örnekle sınanıyordu. Burada
 * PEER_CP_FIELDS'in (dates, subManufacturer, suppFob, suppFobMeta, importance) her biri için
 * yazar her turda başka cihaza geçer. Yazar önceki değeri gördükten sonra yazar (nedensel), ama:
 *  · aynı cihazın iki paketi (ara + son değer) ayrı yayımlanır ve aktarımda sırasız/yinelenen/
 *    yarım teslim edilir (MirrorReplicator: gecikme 1–5 tik, %12 yinelenen, %10 yarım .tmp);
 *  · bir turda OneDrive -PC çakışma kopyası ile bozuk nihai paket enjekte edilir;
 *  · cihaz saatleri ±1 saat kaymıştır (mevcut HLC testi ±10 dk).
 * Beklenen (mevcut politika, değiştirilmez): her cihazda her alanın nedensel son değeri, açık
 * çakışma yok, paylaşılan özet tek, notlar cihazda yerel kalır. Not ve Del. Type politikası
 * bu testin konusu değildir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createSimulation } = require('./helpers/sync-sim');
const appRoot = process.env.BUYERLOG_SYNC_SIM_APP_ROOT || path.resolve(__dirname, '..');
const policy = require(path.join(appRoot, 'server/lib/shared-sync-policy'));
const { computeSharedDigest } = require(path.join(appRoot, 'server/lib/sync-health'));

const TIMEOUT_MS = process.platform === 'win32' ? 240000 : 60000;
const DEVICES = 4, ORDERS = 4, ROUNDS = 5;
const FIELDS = [...policy.PEER_CP_FIELDS];
const HOUR = 3600000;

function valueFor(field, round, order, step) {
  const n = round * 100 + order * 10 + step;
  if (field === 'suppFob') return n / 100 + 1;
  if (field === 'dates') return { ex: `2026-12-${String((n % 28) + 1).padStart(2, '0')}` };
  if (field === 'suppFobMeta') return { source: `handoff-${n}`, at: new Date(Date.UTC(2026, 10, 28) + n).toISOString() };
  if (field === 'importance') return n % 2 ? 'high' : 'normal';
  return `SUB-HO-${n}`;
}

async function runHandoff(seed) {
  const base = Date.UTC(2026, 10, 28);
  // ±1 saat: 0 → -60 dk, 3 → +60 dk. Nedensel olarak sonraki yazım daha eski saat taşıyabilir.
  const skew = index => Math.round((index * 2 * HOUR) / (DEVICES - 1)) - HOUR;
  const sim = await createSimulation({ seed, devices: DEVICES, clock: index => base + skew(index) });
  try {
    await sim.syncRound(); await sim.replicator.flush();
    const expected = new Map();
    const localNotes = new Map();
    let eventNo = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const writes = sim.devices.map(() => [[], []]);
      for (let order = 0; order < ORDERS; order++) {
        for (const [fieldIndex, field] of FIELDS.entries()) {
          const writer = (round + order + fieldIndex) % DEVICES;
          const id = `cp-order:HANDOFF-${order}`;
          for (const step of [0, 1]) {
            const value = valueFor(field, round, order, step);
            writes[writer][step].push({ id, patch: { [field]: value }, at: new Date(base + skew(writer) + eventNo).toISOString(), eventId: `handoff-${seed}-${eventNo++}`, userId: `user-${writer}` });
            if (step === 1) expected.set(`${id}\0${field}`, value);
          }
        }
      }
      // Her cihazın ara ve son değeri iki ayrı yayım; ikisi de yoldayken alım yapılır.
      for (const step of [0, 1]) {
        await Promise.all(sim.devices.map((device, index) => (writes[index][step].length ? device.db.queuePatches(writes[index][step]) : null)));
        await sim.syncRound(); await sim.replicator.capture();
      }
      const noteDevice = round % DEVICES, noteId = `cp-order:HANDOFF-NOTE-${noteDevice}`;
      await sim.devices[noteDevice].db.queuePatch({ id: noteId, patch: { notes: { Notes: `yerel-${round}` } } });
      localNotes.set(noteDevice, { id: noteId, value: `yerel-${round}` });
      await sim.replicator.step(); await sim.syncRound();
      if (round === 2) { await sim.replicator.flush(); await sim.injectProviderArtifacts(); }
      await sim.settle();
    }
    const states = await Promise.all(sim.devices.map(device => device.db.read()));
    const failures = [];
    const digests = states.map(computeSharedDigest);
    if (new Set(digests.map(item => item.sharedHash)).size !== 1) failures.push('paylaşılan özetler farklı');
    for (const [index, state] of states.entries()) {
      const open = state.conflicts.filter(item => !item.resolved);
      if (open.length) failures.push(`cihaz ${index}: ${open.length} açık çakışma ${JSON.stringify(open.map(item => [item.id, item.field])).slice(0, 200)}`);
      for (const [key, value] of expected) {
        const [id, field] = key.split('\0');
        const got = state.records[id] && state.records[id][field];
        if (JSON.stringify(got) !== JSON.stringify(value)) failures.push(`cihaz ${index}: ${id}.${field} = ${JSON.stringify(got)}, beklenen ${JSON.stringify(value)}`);
      }
      for (const [owner, note] of localNotes) {
        const got = state.records[note.id] && state.records[note.id].notes;
        if (owner === index && (!got || got.Notes !== note.value)) failures.push(`cihaz ${index}: yerel not kayboldu`);
        if (owner !== index && got !== undefined) failures.push(`cihaz ${index}: cihaz ${owner} notu sızdı`);
      }
    }
    return { failures, metrics: { ...sim.replicator.metrics }, digest: digests[0].sharedHash };
  } finally { await sim.close(); }
}

for (const seed of [28101, 28102, 28103]) {
  test(`CP paylaşılan alanlar el değiştiren yazar (seed ${seed}): son değer her cihazda, çakışma yok, not yerel`, { timeout: TIMEOUT_MS }, async t => {
    const { failures, metrics } = await runHandoff(seed);
    t.diagnostic(JSON.stringify(metrics));
    assert.deepEqual(failures, []);
    // Aktarım modeli gerçekten sırasız, yinelenen, yarım ve -PC teslim üretmiş olmalı.
    assert.ok(metrics.reorderedDeliveries > 0, 'sırasız teslim');
    assert.ok(metrics.duplicateDeliveries > 0, 'yinelenen teslim');
    assert.ok(metrics.partialWrites > 0, 'yarım yazım');
    assert.ok(metrics.conflictCopies > 0, '-PC çakışma kopyası');
  });
}

module.exports = { runHandoff };
