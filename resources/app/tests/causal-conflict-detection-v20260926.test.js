'use strict';

/* Aynı tekil alanın (ör. aynı CP notu) iki cihazda eşzamanlı değiştirilmesi.

   Hata: çakışma "uzak olayın taban revizyonu < yerel alan revizyonu" ile
   algılanıyordu. Cihaz sayaçları bağımsız ilerler; sayacı ileride olan cihazın
   olayı, yerel değişikliği HİÇ görmemiş olsa bile "sıralı düzenleme" sanılıyor
   ve çakışma uyarısı olmadan son yazan kazanıyordu.

   Çözüm (nedensellik): her olay yazıldığı andaki sürüm vektörünü taşır
   (hangi cihazdan hangi sıraya kadar değişiklik alınmıştı), her alan son
   yazanını (cihaz + sıra) tutar. Uzak olayı yazan cihaz alanın son yazımını
   görmemişse gerçek eşzamanlılıktır → çakışma. Vektör taşımayan eski sürüm
   olayları eski kuralla değerlendirilir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

function devices(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-causal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    a: createLocalDb(path.join(dir, 'a', 'L.db')),
    b: createLocalDb(path.join(dir, 'b', 'L.db')),
  };
}
async function deliver(from, to, sinceSequence = 0) {
  const state = await from.read();
  for (const event of state.journal.filter(item => item.localSequence > sinceSequence)) await to.applyDelta(event);
  return state.localSequence;
}
async function raiseClock(db, count) {
  for (let i = 0; i < count; i += 1) await db.queuePatch({ id: `cp-order:${900 + i}`, patch: { notes: { Notes: `başka ${i}` } } });
}

test('sayacı ileride olan cihaz, görmediği yerel notu çakışmasız ezemez', async t => {
  const { a, b } = devices(t);
  await raiseClock(b, 30);                                              // B'nin sayacı çok ileride
  await a.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'ilk' } } });
  let aSeq = await deliver(a, b);                                       // B kaydı yüksek sayaçla alır
  await a.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'A notu' } } }); // A yazar, B henüz görmedi
  await b.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'B notu' } } }); // B eşzamanlı yazar
  const bState = await b.read();
  await b.read();
  const bEvent = bState.journal[bState.journal.length - 1];
  await a.applyDelta(bEvent);
  const aState = await a.read();
  const open = aState.conflicts.filter(item => !item.resolved && item.id === 'cp-order:1' && item.field === 'notes');
  assert.equal(open.length, 1, 'eşzamanlı yazım çakışma olarak açılmalı');
  assert.equal(aState.records['cp-order:1'].notes.Notes, 'A notu', 'yerel değer sessizce ezilmemeli');
  // B tarafı da A'nın olayını alınca çakışmayı görür (simetrik).
  await deliver(a, b, aSeq);
  const bOpen = (await b.read()).conflicts.filter(item => !item.resolved && item.id === 'cp-order:1' && item.field === 'notes');
  assert.equal(bOpen.length, 1);
});

test('karşı cihaz yerel yazımı gördükten sonra yazdıysa sıralı düzenlemedir: çakışma yok', async t => {
  const { a, b } = devices(t);
  await raiseClock(a, 25);                                              // A'nın sayacı ileride
  await a.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'A notu' } } });
  await deliver(a, b);                                                  // B, A'nın notunu aldı
  await b.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'B düzeltti' } } });
  const bState = await b.read();
  await a.applyDelta(bState.journal[bState.journal.length - 1]);
  const aState = await a.read();
  assert.equal(aState.conflicts.filter(item => !item.resolved).length, 0);
  assert.equal(aState.records['cp-order:1'].notes.Notes, 'B düzeltti');
});

test('olay yazıldığı andaki sürüm vektörünü taşır; vektörsüz eski olay eski kuralla işlenir', async t => {
  const { a, b } = devices(t);
  await a.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'A' } } });
  await deliver(a, b);
  await b.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'B' } } });
  const event = (await b.read()).journal.slice(-1)[0];
  const aDevice = (await a.read()).deviceId;
  assert.ok(event.seen && Number(event.seen[aDevice]) >= 1, 'B olayı A’dan aldıklarını bildirir');
  // Eski sürüm (vektörsüz) olay: eski taban kuralı geçerli, davranış değişmez.
  const legacy = { ...event, eventId: 'legacy-1', seen: undefined, sha256: undefined, baseRevision: 999 };
  delete legacy.seen; delete legacy.sha256;
  await a.applyDelta(legacy);
  assert.equal((await a.read()).records['cp-order:1'].notes.Notes, 'B');
});

test('checkpoint onarımıyla alınan değer sürüm vektörüne eklenir: sonraki yazım sahte çakışma üretmez', async t => {
  // s6'da bulundu: Zeynep moderatörün yol süresini olay değil checkpoint ile aldı;
  // sonraki yazımı "moderatörü görmeden" sayılıp moderatörde sahte çakışma açıyordu.
  const policy = require('../server/lib/shared-sync-policy');
  const { a, b } = devices(t);
  await a.queuePatch({ id: 'store:overrides.json', patch: { transitRules: [{ id: 'mod' }] } });
  const aRecord = (await a.read()).records['store:overrides.json'];
  const master = policy.masterRecordsFromState({ records: { 'store:overrides.json': aRecord } })['store:overrides.json'];
  assert.ok(master._fieldWriters && master._fieldWriters.transitRules, 'checkpoint kaydı son yazanı taşır');
  await b.queuePatch({ id: 'store:overrides.json', patch: { transitRules: [] } });
  await b.transaction(async next => {
    next.records['store:overrides.json'] = policy.mergeCheckpointRecord(next.records['store:overrides.json'], master);
    next.causalKnowledge = policy.mergeKnowledge(next.causalKnowledge, policy.checkpointWriterKnowledge({ x: master }));
  });
  await b.queuePatch({ id: 'store:overrides.json', patch: { transitRules: [{ id: 'mod' }, { id: 'zeynep' }] } });
  const event = (await b.read()).journal.slice(-1)[0];
  await a.applyDelta(event);
  const aState = await a.read();
  assert.equal(aState.conflicts.filter(item => !item.resolved).length, 0);
  assert.deepEqual(aState.records['store:overrides.json'].transitRules.map(item => item.id), ['mod', 'zeynep']);
});
