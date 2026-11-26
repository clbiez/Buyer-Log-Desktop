'use strict';

/* AŞAMA 1 · İTERASYON 2 — artımlı motorun sınır doğrulamaları (geçici, üretim dışı).
 * Çalıştırma: node --test prototypes/collection-oplog/oplog-incremental.test.js */

const test = require('node:test');
const assert = require('node:assert/strict');
const inc = require('./oplog-incremental');

const owner = 'o';
let n = 0;
const batch = (device, user, ops, extra = {}) => ({ v: 1, owner, device, user, seq: ++n, opId: `${device}-${n}`, hlc: [0, 0], deps: {}, ops, ...extra });
const vid = (b, i = 0) => `${b.opId}:${i}`;
const cvid = (b, field, i = 0) => `${b.opId}:${i}/${field}`;
function setup() {
  n = 0;
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
  assert.ok(inc.view(restored).quarantine.some(item => item.opId === after.opId && item.reason === 'after-revoke'));
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

test('uzun oturum: kalıcı durum geçmişle büyümez, yalnız kayıt kimliği kümesi yavaş büyür', () => {
  const { create, grant } = setup();
  const state = ingestAll(inc.createState(), [create, grant]);
  let prev = cvid(create, 'not');
  const sizes = [];
  for (let i = 1; i <= 20000; i++) {
    const b = batch('A', owner, [{ t: 'set', row: 'r1', field: 'not', value: `v${i}`, prev: [prev] }]);
    prev = vid(b); inc.ingest(state, b, { owner });
    if (i % 5000 === 0) { const cp = inc.snapshot(state); sizes.push({ edits: i, rowsBytes: JSON.stringify(cp.rows).length, appliedBytes: JSON.stringify(cp.applied).length }); }
  }
  // Satır durumu sabit (yalnız değer metninin uzunluğu kadar oynar: 'v5000' → 'v20000').
  assert.ok(Math.max(...sizes.map(s => s.rowsBytes)) - Math.min(...sizes.map(s => s.rowsBytes)) <= 4, `row state must not grow with history: ${JSON.stringify(sizes)}`);
  // Tek büyüme: uygulanmış kayıt kimlikleri (~9 bayt/düzenleme). Cihaz başına sınır değeriyle
  // (watermark) sıkıştırılması gerekir; bu iterasyonda yapılmadı — ölçülü açık.
  const perEdit = (sizes.at(-1).appliedBytes - sizes[0].appliedBytes) / 15000;
  assert.ok(perEdit > 0 && perEdit < 16, `applied-id growth per edit: ${perEdit.toFixed(1)} B`);
  assert.equal(inc.view(state).rows.get('r1').versions.not.length, 1, 'superseded versions are not retained');
});
