'use strict';

/* AŞAMA 1 PROTOTİPİ testleri (geçici, üretim dışı; `npm test` kapsamında değil).
 * Çalıştırma: node --test prototypes/collection-oplog/oplog-prototype.test.js */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fold, makeCheckpoint } = require('./oplog-engine');
const { createDevice } = require('./oplog-device');

const OWNER = 'owner-a';

async function world(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oplog-proto-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  const online = new Map();
  let clock = 1_000_000;
  const make = (name, user, options = {}) => {
    online.set(name, true);
    return createDevice({ owner: OWNER, user, localDir: path.join(root, `local-${name}`), getSharedRoot: async () => (online.get(name) ? shared : ''), now: options.now || (() => (clock += 10)), ...options });
  };
  return { root, shared, online, make, setClock: value => { clock = value; } };
}
const value = (device, row, field) => { const r = device.view().rows.get(row); return r ? r.fields[field] : undefined; };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function listShared(shared) {
  const out = [];
  const base = path.join(shared, 'oplog', OWNER);
  if (!fs.existsSync(base)) return out;
  for (const device of fs.readdirSync(base)) for (const name of fs.readdirSync(path.join(base, device))) out.push({ device, name, file: path.join(base, device, name) });
  return out;
}
async function bootstrap(w) {
  const owner = w.make('owner', OWNER);
  const editor = w.make('editor', 'editor-1');
  await owner.load(); await editor.load();
  await owner.permission('grant', 'editor-1');
  for (let i = 1; i <= 5; i++) await owner.createRow(`r${i}`, { not: '', buyer: '' });
  await owner.sync(); await editor.sync();
  return { owner, editor };
}

test('tek fiziksel yazar: her cihaz yalnız kendi klasörüne yazar, yayımlanmış dosya bir daha değişmez', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  await editor.setField('r1', 'not', 'e1');
  await owner.setField('r1', 'buyer', 'o1');
  const before = new Map(listShared(w.shared).map(item => [item.file, sha(item.file)]));
  await owner.sync(); await editor.sync();
  await editor.setField('r2', 'not', 'e2'); await owner.sync(); await editor.sync();
  for (const item of listShared(w.shared)) {
    const batch = JSON.parse(fs.readFileSync(item.file, 'utf8'));
    assert.equal(batch.device, item.device, 'a file lives only in its author folder');
    if (before.has(item.file)) assert.equal(sha(item.file), before.get(item.file), 'published file is immutable');
  }
  assert.equal(value(owner, 'r1', 'not'), 'e1'); assert.equal(value(owner, 'r1', 'buyer'), 'o1');
  assert.deepEqual(owner.view().conflicts, [], 'different fields never conflict');
});

test('sırasız, tekrarlı ve kısmi teslim: durum yalnız kayıt kümesine bağlıdır', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  await editor.setField('r1', 'not', 'e1'); await owner.setField('r1', 'not', 'o1');
  await editor.sync(); await editor.setField('r1', 'not', 'e2'); await editor.deleteRow('r3');
  await owner.setField('r4', 'buyer', 'o4'); await owner.sync(); await editor.sync();
  const all = [...owner.known.values()];
  const canonical = result => JSON.stringify({
    rows: [...result.rows.entries()].map(([row, data]) => [row, Object.keys(data.fields).sort().map(field => [field, data.fields[field], [...data.versions[field]].sort()])]).sort(),
    conflicts: result.conflicts.map(item => [item.row, item.field, item.current, item.incoming]).sort(),
  });
  const reference = canonical(fold(all, { owner: OWNER }));
  for (let i = 0; i < 50; i++) {
    const shuffled = [...all, ...all.slice(0, i % all.length)].sort(() => Math.random() - 0.5);
    assert.equal(canonical(fold(shuffled, { owner: OWNER })), reference, 'order and duplicates do not change state');
  }
  // Eksik teslim: öncülü gelmemiş yazım bekletilir, kaybolmaz; öncül gelince uygulanır.
  const late = all.find(batch => batch.ops.some(op => op.t === 'set' && op.value === 'e2'));
  const prevBatch = all.find(batch => batch.ops.some(op => op.t === 'set' && op.value === 'e1'));
  const partial = fold(all.filter(batch => batch !== prevBatch), { owner: OWNER });
  assert.ok(partial.pending.some(item => item.id.startsWith(late.opId)), 'write with an undelivered predecessor is held, not applied out of order');
  assert.notEqual(partial.rows.get('r1').fields.not, 'e2');
});

test('eşzamanlı aynı alan: tek çakışma kaydı; politika parametredir, kaybeden kaydedilir', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  w.online.set('editor', false);
  await owner.setField('r1', 'not', 'owner-first');
  await editor.setField('r1', 'not', 'editor-later');
  w.online.set('editor', true);
  await editor.sync(); await owner.sync();
  for (const device of [owner, editor]) {
    assert.equal(value(device, 'r1', 'not'), 'owner-first', 'earliest-wins (HLC) policy');
    assert.deepEqual(device.view().conflicts.map(item => item.incoming), ['editor-later']);
  }
  assert.equal(fold([...owner.known.values()], { owner: OWNER, policy: 'latest-wins' }).rows.get('r1').fields.not, 'editor-later');
  // Çakışmayı gören kullanıcının yazımı iki başı da ezer: çakışma kapanır.
  await owner.setField('r1', 'not', 'resolved'); await editor.sync();
  assert.equal(value(editor, 'r1', 'not'), 'resolved');
  assert.deepEqual(editor.view().conflicts, []);
});

test('silme: silenin görmediği eşzamanlı düzenleme varsa satır kalır ve bildirilir; görmüşse silinir', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  w.online.set('editor', false);
  await owner.deleteRow('r2');
  await editor.setField('r2', 'buyer', 'unseen-edit');
  w.online.set('editor', true);
  await editor.sync(); await owner.sync();
  assert.equal(value(owner, 'r2', 'buyer'), 'unseen-edit', 'concurrent edit keeps the row');
  assert.ok(owner.view().conflicts.some(item => item.row === 'r2' && item.field === '_deleted'));
  await owner.deleteRow('r2'); await editor.sync();
  assert.equal(editor.view().rows.has('r2'), false, 'a delete that saw every head removes the row');
});

test('yerel kalıcı ≠ yayımlanmış ≠ görülmüş; paylaşım yokken yazım kaybolmaz', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  w.online.set('editor', false);
  const batch = await editor.setField('r1', 'not', 'offline');
  assert.equal(await editor.status(batch.opId), 'local');
  const restarted = w.make('editor', 'editor-1'); w.online.set('editor', false);
  await restarted.load();
  assert.ok(restarted.known.has(batch.opId), 'local journal survives a restart');
  w.online.set('editor', true);
  await restarted.sync();
  assert.equal(await restarted.status(batch.opId), 'published');
  await owner.sync(); await owner.setField('r5', 'not', 'ack'); await restarted.sync();
  assert.equal(await restarted.status(batch.opId), 'seen');
  assert.equal(value(owner, 'r1', 'not'), 'offline');
});

test('yeniden kurulum: yeni cihaz kimliği; yayımlanmış kayıtlar kalır, eski cihazın dosyaları ezilmez', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  await editor.setField('r1', 'not', 'before-reinstall'); await editor.sync();
  const oldId = editor.deviceId;
  await fsp.rm(path.join(w.root, 'local-editor'), { recursive: true, force: true });
  const fresh = w.make('editor', 'editor-1');
  await fresh.sync();
  assert.notEqual(fresh.deviceId, oldId);
  assert.equal(value(fresh, 'r1', 'not'), 'before-reinstall');
  await fresh.setField('r1', 'not', 'after-reinstall'); await owner.sync();
  assert.equal(value(owner, 'r1', 'not'), 'after-reinstall');
  assert.deepEqual(owner.view().conflicts, [], 'the new installation saw the old value: no false conflict');
});

test('durum yedekten eski hâline döner: seq tekrar kullanılır, dosya ezilmez, çatal tespit edilir, veri kaybolmaz', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  const backup = await fsp.readFile(editor.stateFile, 'utf8');
  await editor.setField('r1', 'not', 'x1'); await editor.sync();
  await fsp.writeFile(editor.stateFile, backup);
  await fsp.rm(editor.journalDir, { recursive: true, force: true });
  const restored = w.make('editor', 'editor-1');
  await restored.sync();
  await restored.setField('r2', 'not', 'x2'); await owner.sync();
  assert.equal(value(owner, 'r1', 'not'), 'x1');
  assert.equal(value(owner, 'r2', 'not'), 'x2');
  assert.ok(owner.view().forks.length >= 1, 'rolled-back sequence is detected as a fork');
  const names = listShared(w.shared).filter(item => item.device === editor.deviceId).map(item => item.name);
  assert.equal(new Set(names).size, names.length);
});

test('yetki geri alma saate değil gördüklerine bağlıdır: saati geri alınmış cihazın iptal sonrası yazımı uygulanmaz', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  await editor.setField('r1', 'not', 'before-revoke'); await owner.sync();
  w.online.set('editor', false);
  await owner.permission('revoke', 'editor-1');
  // Düzenleyici iptali görmedi ve saati çok geride: HLC iptalden "önce" görünür.
  const lagging = w.make('editor', 'editor-1', { now: () => 5 }); w.online.set('editor', false);
  await lagging.load();
  await lagging.setField('r2', 'not', 'after-revoke');
  w.online.set('editor', true);
  await lagging.sync(); await owner.sync();
  assert.equal(value(owner, 'r1', 'not'), 'before-revoke', 'writes the revoker had seen stay valid');
  assert.equal(value(owner, 'r2', 'not'), '', 'write the revoker had not seen is not applied');
  assert.ok(owner.view().quarantine.some(item => item.reason === 'after-revoke'), 'it goes to the owner review queue, not silently dropped');
});

test('checkpoint + budama: yeni cihaz aynı durumu kurar; budanmış geçmişten sonra gelen geç düzenleme silmeyle kaybolmaz', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  await editor.setField('r1', 'not', 'e1'); await owner.setField('r2', 'buyer', 'o2');
  w.online.set('editor', false);
  const offlineEdit = await editor.setField('r3', 'buyer', 'late'); // görülmeyecek
  await owner.deleteRow('r3');
  await owner.sync();
  const before = owner.view();
  const checkpoint = makeCheckpoint([...owner.known.values()], { owner: OWNER });
  await fsp.mkdir(path.join(w.shared, 'oplog', OWNER, 'checkpoints'), { recursive: true });
  await fsp.writeFile(path.join(w.shared, 'oplog', OWNER, 'checkpoints', 'cp1.json'), JSON.stringify(checkpoint));
  // Yazarlar, checkpoint'in kapsadığı kendi dosyalarını budar.
  for (const item of listShared(w.shared)) if (item.device !== 'checkpoints') {
    const batch = JSON.parse(fs.readFileSync(item.file, 'utf8'));
    if (checkpoint.included[batch.opId]) fs.unlinkSync(item.file);
  }
  const newcomer = w.make('newcomer', OWNER);
  const fresh = await newcomer.sync();
  assert.deepEqual([...fresh.rows.keys()].sort(), [...before.rows.keys()].sort());
  for (const [row, data] of before.rows) assert.deepEqual(fresh.rows.get(row).fields, data.fields, `row ${row}`);
  // Çevrimdışı düzenleyici döner: düzenlemesi budanmış silmeyle sessizce yok olmaz.
  w.online.set('editor', true);
  await editor.sync(); await newcomer.sync();
  assert.equal(value(newcomer, 'r3', 'buyer'), 'late', 'late edit after pruning keeps the deleted row');
  assert.ok(newcomer.view().conflicts.some(item => item.row === 'r3' && item.field === '_deleted'));
  void offlineEdit;
});

test('determinizm: tam değişimden sonra tüm cihazlar aynı durumu üretir', async t => {
  const w = await world(t);
  const { owner, editor } = await bootstrap(w);
  const third = w.make('third', 'editor-1'); await third.sync();
  for (const device of [owner, editor, third]) w.online.set(device === owner ? 'owner' : device === editor ? 'editor' : 'third', false);
  await owner.setField('r1', 'not', 'o'); await editor.setField('r1', 'not', 'e'); await third.setField('r1', 'not', 't');
  await editor.deleteRow('r4'); await third.setField('r4', 'buyer', 't4');
  for (const name of ['owner', 'editor', 'third']) w.online.set(name, true);
  for (let i = 0; i < 2; i++) for (const device of [owner, editor, third]) await device.sync();
  const snapshot = device => JSON.stringify({ rows: [...device.view().rows.entries()].map(([k, v]) => [k, v.fields]).sort(), conflicts: device.view().conflicts.map(item => [item.row, item.field, item.current, item.incoming]).sort() });
  assert.equal(snapshot(owner), snapshot(editor));
  assert.equal(snapshot(owner), snapshot(third));
  assert.equal(owner.view().conflicts.filter(item => item.field === 'not').length, 2, 'three concurrent writers: one winner, two recorded');
});
