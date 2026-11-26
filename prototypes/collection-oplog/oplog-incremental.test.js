'use strict';

/* AŞAMA 1 · İTERASYON 2–3 — artımlı motorun sınır doğrulamaları (geçici, üretim dışı).
 * Çalıştırma: node --test prototypes/collection-oplog/oplog-incremental.test.js */

const test = require('node:test');
const assert = require('node:assert/strict');
const inc = require('./oplog-incremental');

const owner = 'o';
// Cihaz kendi kayıtlarını 1'den boşluksuz numaralar; kimlik (cihaz, seq).
let seqs = new Map();
const batch = (device, user, ops, extra = {}) => { const seq = (seqs.get(device) || 0) + 1; seqs.set(device, seq); return { v: 1, owner, device, user, seq, opId: `${device}@${seq}`, hlc: [0, 0], deps: {}, ops, ...extra }; };
const vid = (b, i = 0) => `${b.device}@${b.seq}:${i}`;
const cvid = (b, field, i = 0) => `${b.device}@${b.seq}:${i}/${field}`;
function setup() {
  seqs = new Map();
  const create = batch('O', owner, [{ t: 'create', row: 'r1', fields: { not: '', buyer: '' } }, { t: 'create', row: 'r2', fields: { not: '', buyer: '' } }]);
  const grant = batch('O', owner, [{ t: 'grant', user: 'e', level: 'edit' }]);
  return { create, grant };
}
const ingestAll = (state, list) => { const seen = []; for (const b of list) { seen.push(b); inc.ingest(state, b, { owner, allBatches: () => seen }); } return state; };
const cell = (state, row, field) => inc.view(state).rows.get(row)?.fields[field];

test('aynı değere eşzamanlı yazım çakışma olarak sunulmaz; farklı değer çözülmemiş çakışmadır', () => {
  const { create, grant } = setup();
  const a = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'X', prev: [cvid(create, 'not')] }]);
  const b = batch('B', 'e', [{ t: 'set', row: 'r1', field: 'not', value: 'X', prev: [cvid(create, 'not')] }]);
  const c = batch('A', owner, [{ t: 'set', row: 'r2', field: 'not', value: 'P', prev: [cvid(create, 'not', 1)] }]);
  const d = batch('B', 'e', [{ t: 'set', row: 'r2', field: 'not', value: 'Q', prev: [cvid(create, 'not', 1)] }]);
  const state = ingestAll(inc.createState(), [create, grant, a, b, c, d]);
  const conflicts = inc.view(state).conflicts;
  assert.equal(cell(state, 'r1', 'not'), 'X');
  assert.ok(!conflicts.some(item => item.row === 'r1'), 'same result is not a user conflict');
  assert.deepEqual(conflicts.find(item => item.row === 'r2').values.sort(), ['P', 'Q'], 'different values: both kept, unresolved');
});

test('checkpoint + budama sonrası uzun çevrimdışı cihaz döner: düzenlemesi kaybolmaz, gördüğü eski sürüme göre eşzamanlı sayılır', () => {
  const { create, grant } = setup();
  const offline = batch('X', 'e', [{ t: 'set', row: 'r1', field: 'buyer', value: 'offline-edit', prev: [cvid(create, 'buyer')] }]);
  let prev = cvid(create, 'buyer');
  const online = [];
  for (let i = 0; i < 50; i++) { const b = batch('A', owner, [{ t: 'set', row: 'r1', field: 'buyer', value: `a${i}`, prev: [prev] }]); prev = vid(b); online.push(b); }
  const state = ingestAll(inc.createState(), [create, grant, ...online]);
  const checkpoint = JSON.parse(JSON.stringify(inc.snapshot(state)));
  // Budama: checkpoint öncesi kayıtlar artık yok; yeni cihaz yalnız checkpoint'ten açılır.
  const fresh = inc.restore(checkpoint);
  inc.ingest(fresh, offline, { owner, allBatches: () => [offline] });
  const view = inc.view(fresh);
  assert.equal(view.pending, 0, 'predecessor is known through the checkpoint, nothing waits forever');
  assert.deepEqual(view.conflicts.find(item => item.row === 'r1' && item.field === 'buyer').values.sort(), ['a49', 'offline-edit'], 'late edit kept as unresolved conflict, not lost and not silently winning');
});

test('budama sonrası geç ve eksik kayıt: öncülü gelmeyen bekler (kaybolmaz), gelince uygulanır; tekrarlı teslim etkisiz', () => {
  const { create, grant } = setup();
  const missing = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'm1', prev: [cvid(create, 'not')] }]);
  const dependent = batch('B', 'e', [{ t: 'set', row: 'r1', field: 'not', value: 'm2', prev: [vid(missing)] }]);
  const state = ingestAll(inc.createState(), [create, grant]);
  const restored = inc.restore(JSON.parse(JSON.stringify(inc.snapshot(state))));
  for (let i = 0; i < 3; i++) inc.ingest(restored, dependent, { owner, allBatches: () => [dependent] });
  assert.equal(inc.view(restored).pending, 1, 'waiting write counted once');
  assert.equal(cell(restored, 'r1', 'not'), '');
  inc.ingest(restored, missing, { owner, allBatches: () => [dependent, missing] });
  assert.equal(inc.view(restored).pending, 0);
  assert.equal(cell(restored, 'r1', 'not'), 'm2', 'delivered predecessor releases the dependent; causal order respected');
  assert.deepEqual(inc.view(restored).conflicts, []);
});

test('yetki geri alma yeniden kurulumu checkpoint\'ten başlar: budanmış geçmiş gerekmez; checkpoint içindekiler korunur', () => {
  const { create, grant } = setup();
  const before = batch('E', 'e', [{ t: 'set', row: 'r1', field: 'not', value: 'in-checkpoint', prev: [cvid(create, 'not')] }]);
  const state = ingestAll(inc.createState(), [create, grant, before]);
  const checkpoint = JSON.parse(JSON.stringify(inc.snapshot(state)));
  const restored = inc.restore(checkpoint);
  const after = batch('E', 'e', [{ t: 'set', row: 'r2', field: 'not', value: 'after-checkpoint', prev: [cvid(create, 'not', 1)] }]);
  // Geri alan yalnız checkpoint'e kadarki kayıtları görmüştü.
  const revoke = batch('O', owner, [{ t: 'revoke', user: 'e' }], { deps: { E: before.seq } });
  const retained = [after]; // budama sonrası elde kalan kayıtlar
  inc.ingest(restored, after, { owner, allBatches: () => retained });
  retained.push(revoke);
  inc.ingest(restored, revoke, { owner, allBatches: () => retained });
  assert.equal(restored.rebuilds, 1, 'rebuild happened from the checkpoint with only retained batches');
  assert.equal(cell(restored, 'r1', 'not'), 'in-checkpoint', 'checkpoint = owner acceptance, kept');
  assert.equal(cell(restored, 'r2', 'not'), '', 'write the revoker had not seen is not applied');
  assert.ok(inc.view(restored).quarantine.some(item => item.key === inc.keyOf(after) && item.reason === 'after-revoke'));
});

test('bozuk ya da yarım aktarılmış checkpoint reddedilir', () => {
  const { create, grant } = setup();
  const checkpoint = JSON.parse(JSON.stringify(inc.snapshot(ingestAll(inc.createState(), [create, grant]))));
  const tampered = JSON.parse(JSON.stringify(checkpoint)); tampered.rows[0][2][0][1][0][1] = 'tampered';
  assert.throws(() => inc.restore(tampered), { code: 'CHECKPOINT_CORRUPT' });
  const truncated = JSON.parse(JSON.stringify(checkpoint)); truncated.rows = truncated.rows.slice(0, 1);
  assert.throws(() => inc.restore(truncated), { code: 'CHECKPOINT_CORRUPT' });
  assert.throws(() => inc.restore(null), { code: 'CHECKPOINT_CORRUPT' });
  assert.doesNotThrow(() => inc.restore(checkpoint));
});

test('atomiklik ve tekrar uygulanmama: checkpoint\'in içerdiği kayıtlar yeniden gelirse durum değişmez', () => {
  const { create, grant } = setup();
  const edits = [batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'v1', prev: [cvid(create, 'not')] }])];
  edits.push(batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'v2', prev: [vid(edits[0])] }, { t: 'set', row: 'r2', field: 'buyer', value: 'b2', prev: [cvid(create, 'buyer', 1)] }]));
  const state = ingestAll(inc.createState(), [create, grant, ...edits]);
  const before = JSON.stringify(inc.snapshot(state));
  const restored = inc.restore(JSON.parse(before));
  ingestAll(restored, [create, grant, ...edits, ...edits]);
  assert.equal(JSON.stringify(inc.snapshot(restored)), before, 'replaying already-applied batches is a no-op');
  assert.equal(cell(restored, 'r2', 'buyer'), 'b2', 'multi-op batch applied as a whole');
});

test('uzun oturum: kalıcı durum geçmişle büyümez; tekilleştirme cihaz sayısıyla sınırlı', () => {
  const { create, grant } = setup();
  const state = ingestAll(inc.createState(), [create, grant]);
  let prev = cvid(create, 'not');
  const sizes = [];
  for (let i = 1; i <= 20000; i++) {
    const b = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: `v${i}`, prev: [prev] }]);
    prev = vid(b); inc.ingest(state, b, { owner });
    if (i % 5000 === 0) { const cp = inc.snapshot(state); sizes.push({ edits: i, rowsBytes: JSON.stringify(cp.rows).length, dedupeBytes: JSON.stringify(cp.devices).length }); }
  }
  const spread = key => Math.max(...sizes.map(s => s[key])) - Math.min(...sizes.map(s => s[key]));
  // Satır durumu ve tekilleştirme sabit; yalnız sayıların basamakları oynar ('v5000' → 'v20000').
  assert.ok(spread('rowsBytes') <= 8, `row state must not grow with history: ${JSON.stringify(sizes)}`);
  assert.ok(spread('dedupeBytes') <= 4, `dedupe state must not grow with history: ${JSON.stringify(sizes)}`);
  assert.equal(inc.view(state).rows.get('r1').versions.not.length, 1, 'superseded versions are not retained');
});

test('sırasız teslim: aynı cihazın ileri kaydı sınırı ilerletmez, öncülü gelince sırayla uygulanır', () => {
  const { create, grant } = setup();
  const b1 = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'a1', prev: [cvid(create, 'not')] }]);
  const b2 = batch('A', owner, [{ t: 'set', row: 'r2', field: 'not', value: 'a2', prev: [cvid(create, 'not', 1)] }]);
  const b3 = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'a3', prev: [vid(b1)] }]);
  const state = ingestAll(inc.createState(), [create, grant, b3, b2, b3, b2]);
  assert.equal(cell(state, 'r2', 'not'), '', 'b2 has no causal dependency but must not jump the device order');
  assert.equal(inc.view(state).pending, 2, 'each waiting record counted once despite duplicates');
  assert.equal(inc.snapshot(state).devices.find(([d]) => d === 'A'), undefined, 'floor is the contiguous prefix, not the highest seq seen');
  inc.ingest(state, b1, { owner });
  assert.equal(cell(state, 'r1', 'not'), 'a3');
  assert.equal(cell(state, 'r2', 'not'), 'a2');
  assert.equal(inc.view(state).pending, 0);
  assert.equal(inc.snapshot(state).devices.find(([d]) => d === 'A')[1], 3);
});

test('kalıcı eksik kayıt: ardılları sessizce uygulanmaz, görünür bekleme olur', () => {
  const { create, grant } = setup();
  const b1 = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'a1', prev: [cvid(create, 'not')] }]);
  batch('A', owner, [{ t: 'set', row: 'r1', field: 'buyer', value: 'lost', prev: [cvid(create, 'buyer')] }]); // hiç teslim edilmez
  const b3 = batch('A', owner, [{ t: 'set', row: 'r2', field: 'not', value: 'a3', prev: [cvid(create, 'not', 1)] }]);
  const state = ingestAll(inc.createState(), [create, grant, b1, b3]);
  assert.equal(cell(state, 'r2', 'not'), '', 'a record after a gap is not applied as if the gap were empty');
  assert.equal(inc.view(state).pending, 1);
  // Checkpoint bekleyen kaydı taşır: budama sonrası da kaybolmaz.
  const restored = inc.restore(JSON.parse(JSON.stringify(inc.snapshot(state))));
  assert.equal(inc.view(restored).pending, 1);
});

test('yedekten geri dönen cihaz: aynı kimlikle farklı geçmiş sessizce kabul edilmez', () => {
  const { create, grant } = setup();
  // Gerçek geçmiş: X@1..X@3. Zincir üretici tarafından taşınır.
  const real = [];
  let chain = '';
  for (let i = 1; i <= 3; i++) { const b = batch('X', owner, [{ t: 'set', row: 'r1', field: 'buyer', value: `real${i}`, prev: [i === 1 ? cvid(create, 'buyer') : vid(real[i - 2])] }]); b.prevChain = chain; chain = b.chain = inc.chainNext(chain, b); real.push(b); }
  // Yedekten dönüş: cihaz X@1 durumuna döner ve X@2'yi farklı içerikle yeniden üretir.
  seqs.set('X', 1);
  let forkChain = real[0].chain;
  const forked = value => { const b = batch('X', owner, [{ t: 'set', row: 'r2', field: 'buyer', value, prev: [cvid(create, 'buyer', 1)] }]); b.prevChain = forkChain; forkChain = b.chain = inc.chainNext(forkChain, b); return b; };
  const fork2 = forked('fork2'), fork3 = forked('fork3'), fork4 = forked('fork4');
  // Alıcı 1 gerçek geçmişi görmüş: X@2' sınır içinde; X@3' sınırda → içerik farkı; X@4' zincir uyuşmazlığı.
  const seen = ingestAll(inc.createState(), [create, grant, ...real, fork2, fork3, fork4]);
  const reasons = inc.view(seen).forks.map(f => `${f.key}:${f.reason}`);
  assert.ok(reasons.includes('X@3:same-seq-different-content'), JSON.stringify(reasons));
  assert.ok(reasons.includes('X@4:chain-mismatch'), JSON.stringify(reasons));
  assert.equal(cell(seen, 'r2', 'buyer'), '', 'forked history is quarantined, not applied');
  // Alıcı 2 önce çatalı görür, sonra gerçeği: yine işaretlenir.
  const other = ingestAll(inc.createState(), [create, grant, real[0], fork2, real[1]]);
  assert.ok(inc.view(other).forks.some(f => f.key === 'X@2' && f.reason === 'same-seq-different-content'));
  // Cihaz tarafı kapı: kendi kimliği için yerel seq'inden ileri kanıt görürse yayımlamaz.
  assert.deepEqual(inc.publishGate({ localSeq: 1, hubMaxSeq: 3 }), { ok: false, reason: 'restored-device', evidence: 3 });
  assert.deepEqual(inc.publishGate({ localSeq: 1, hubMaxSeq: 0, checkpointFloor: 3 }), { ok: false, reason: 'restored-device', evidence: 3 }, 'evidence survives pruning via checkpoint floor');
  assert.deepEqual(inc.publishGate({ localSeq: 1 }), { ok: false, reason: 'no-evidence' }, 'offline: do not publish blind');
  assert.deepEqual(inc.publishGate({ localSeq: 3, hubMaxSeq: 3 }), { ok: true });
});

test('yeniden kurulum: yeni cihaz kimliği 1\'den başlar, eski cihazın sınırı korunur', () => {
  const { create, grant } = setup();
  const old = batch('OLD', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'old', prev: [cvid(create, 'not')] }]);
  const fresh = batch('NEW', owner, [{ t: 'set', row: 'r1', field: 'not', value: 'new', prev: [vid(old)] }]);
  const state = ingestAll(inc.createState(), [create, grant, old, fresh]);
  const restored = inc.restore(JSON.parse(JSON.stringify(inc.snapshot(state))));
  ingestAll(restored, [old, fresh]);
  assert.equal(cell(restored, 'r1', 'not'), 'new');
  assert.deepEqual(inc.view(restored).conflicts, [], 're-delivered old-device record is not applied twice');
});

test('checkpoint istisnaları budamadan sağ çıkar: izin bekleyen ve öncül bekleyen kayıt sonra uygulanır', () => {
  const { create, grant } = setup(); // izin (O@2) checkpoint'ten SONRA teslim edilir
  const early = batch('E', 'e', [{ t: 'set', row: 'r1', field: 'not', value: 'before-grant', prev: [cvid(create, 'not')] }]);
  const missing = batch('A', owner, [{ t: 'set', row: 'r2', field: 'not', value: 'm', prev: [cvid(create, 'not', 1)] }]);
  const blocked = batch('B', owner, [{ t: 'set', row: 'r2', field: 'not', value: 'after-m', prev: [vid(missing)] }]);
  const state = ingestAll(inc.createState(), [create, early, blocked]);
  const cp = JSON.parse(JSON.stringify(inc.snapshot(state)));
  assert.equal(inc.canPrune(cp, early), false, 'held record must not be pruned');
  assert.equal(inc.canPrune(cp, blocked), false, 'blocked record must not be pruned');
  assert.equal(inc.canPrune(cp, create), true);
  assert.equal(inc.canPrune(cp, missing), false, 'never-seen record is not prunable');
  const restored = inc.restore(cp); // budama: early ve blocked dosyaları artık yok sayılsa bile checkpoint taşır
  ingestAll(restored, [grant, missing]);
  assert.equal(cell(restored, 'r1', 'not'), 'before-grant');
  assert.equal(cell(restored, 'r2', 'not'), 'after-m');
  assert.equal(inc.view(restored).pending, 0);
});

test('uzun ters sırada teslim yığını taşırmaz', () => {
  const { create, grant } = setup();
  const list = [];
  let prev = cvid(create, 'not');
  for (let i = 0; i < 20000; i++) { const b = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: `v${i}`, prev: [prev] }]); prev = vid(b); list.push(b); }
  const state = ingestAll(inc.createState(), [create, grant, ...list.reverse()]);
  assert.equal(cell(state, 'r1', 'not'), 'v19999');
  assert.equal(inc.view(state).pending, 0);
});

/* Rastgele çok cihazlı senaryo: yerel motorlar kısmi teslimle nedensel geçerli kayıtlar
   üretir (eşzamanlı yazım, aynı değer, silme, izinden önce gelen kayıt). Tam küme her
   teslim sırasında, tekrarlarla ve yarıda checkpoint→açılışla aynı duruma ulaşmalı. */
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
function randomScenario(seed) {
  const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
  setup(); // yalnız sayaçları sıfırlar; kayıtlar aşağıda üretilir
  seqs = new Map();
  const all = [], rows = ['r0', 'r1', 'r2', 'r3'], fields = ['f0', 'f1', 'f2'];
  all.push(batch('O', owner, rows.map(row => ({ t: 'create', row, fields: Object.fromEntries(fields.map(f => [f, ''])) }))));
  all.push(batch('O', owner, [{ t: 'grant', user: 'e', level: 'edit' }]));
  const users = { A: owner, B: owner, C: 'e', D: 'e' };
  const local = Object.fromEntries(Object.keys(users).map(d => [d, { state: inc.createState(), seen: new Set() }]));
  const deliver = (d, b) => { if (local[d].seen.has(b.opId)) return; local[d].seen.add(b.opId); inc.ingest(local[d].state, b, { owner }); };
  for (let step = 0; step < 120; step++) {
    const d = pick(Object.keys(users)), L = local[d];
    for (const b of all) if (b.device === d || r() < 0.4) deliver(d, b);
    const row = pick(rows), lr = L.state.rows.get(row);
    if (!lr || lr.deleted) continue;
    let b;
    if (r() < 0.07) b = batch(d, users[d], [{ t: 'delete', row, observed: Object.fromEntries([...lr.cells].map(([f, h]) => [f, h.map(x => x.id)])) }]);
    else {
      const ops = [];
      for (let k = 0, n = r() < 0.2 ? 2 : 1; k < n; k++) { const f = pick(fields); if (!ops.some(o => o.field === f)) ops.push({ t: 'set', row, field: f, value: r() < 0.25 ? 'same' : `${d}${step}`, prev: lr.cells.get(f).map(x => x.id) }); }
      b = batch(d, users[d], ops);
    }
    all.push(b); deliver(d, b);
  }
  return { all, r };
}
const heads = s => JSON.stringify(inc.snapshot(s).rows.map(([row, del, cells]) => [row, !!del, cells.map(([f, h]) => [f, h.map(x => `${x[0]}=${JSON.stringify(x[1])}`).sort()]).sort()]).sort());

test('rastgele senaryo: teslim sırası, tekrar ve yarıda checkpoint sonucu değiştirmez; tam teslimde bekleyen kalmaz', () => {
  const failures = [];
  for (let seed = 1; seed <= 12; seed++) {
    const { all, r } = randomScenario(seed);
    const ordered = inc.createState(); for (const b of all) inc.ingest(ordered, b, { owner });
    const expected = heads(ordered);
    for (let k = 0; k < 5; k++) {
      const list = [...all, ...all.filter(() => r() < 0.3)];
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const s = inc.createState(); for (const b of list) inc.ingest(s, b, { owner });
      if (heads(s) !== expected || inc.view(s).pending) failures.push(`seed ${seed} shuffle ${k}`);
      const half = Math.floor(list.length / 2), first = inc.createState(); for (const b of list.slice(0, half)) inc.ingest(first, b, { owner });
      const resumed = inc.restore(JSON.parse(JSON.stringify(inc.snapshot(first)))); for (const b of list.slice(half)) inc.ingest(resumed, b, { owner });
      if (heads(resumed) !== expected || inc.view(resumed).pending) failures.push(`seed ${seed} checkpoint ${k}`);
    }
  }
  assert.deepEqual(failures, []);
});
