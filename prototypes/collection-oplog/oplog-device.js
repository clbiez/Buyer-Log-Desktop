'use strict';

/* AŞAMA 1 PROTOTİPİ — GEÇİCİ, ÜRETİM DIŞI. Cihaz çalışma zamanı.
 *
 * Tek fiziksel yazar: cihaz yalnız `<shared>/oplog/<owner>/<deviceId>/` altına,
 * benzersiz adlı (`<seq>-<opId>.json`) ve bir daha değişmeyen dosyalar yazar.
 * Ortak dosya, kilit, CAS ve tüm-belge yayımı yoktur.
 *
 * Kayıt durumları ayrıdır:
 *  local     — yerel günlükte kalıcı (atomik yazım); paylaşım erişilemese de kaybolmaz
 *  published — kendi paylaşım klasöründe (yazılıp yeniden okunarak doğrulandı)
 *  seen      — başka bir cihazın sonraki kaydı (deps) bunu kapsıyor
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { fold } = require('./oplog-engine');

async function atomicWrite(file, text, { exclusive = false } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (exclusive && fs.existsSync(file)) return false;
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { await fsp.writeFile(tmp, text, 'utf8'); await fsp.rename(tmp, file); }
  finally { await fsp.unlink(tmp).catch(() => {}); }
  return true;
}
async function readJsonDir(dir) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch (_) { return []; }
  const out = [];
  for (const name of names.filter(item => item.endsWith('.json'))) {
    try { out.push(JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'))); }
    catch (_) { /* yarım/bozuk dosya: yok sayılır, tekrar denenir */ }
  }
  return out;
}

function createDevice({ owner, user, localDir, getSharedRoot, policy = 'earliest-wins', now = () => Date.now() }) {
  const stateFile = path.join(localDir, 'device.json');
  const journalDir = path.join(localDir, 'journal');
  // Başka cihazlardan alınan değişmez kayıtların yerel kopyası: çevrimdışı yeniden
  // başlatmada da tam yerel durum kurulur (yerel öncelik).
  const receivedDir = path.join(localDir, 'received');
  let state = null;
  const known = new Map(); // opId -> batch
  let checkpoint = null;
  async function load() {
    if (state) return state;
    try { state = JSON.parse(await fsp.readFile(stateFile, 'utf8')); }
    catch (_) { state = { deviceId: crypto.randomUUID(), seq: 0, hlc: [0, 0] }; await atomicWrite(stateFile, JSON.stringify(state)); }
    for (const batch of await readJsonDir(journalDir)) known.set(batch.opId, batch);
    for (const batch of await readJsonDir(receivedDir)) if (batch && batch.opId && !known.has(batch.opId)) known.set(batch.opId, batch);
    return state;
  }
  const sharedDir = (root, device) => path.join(root, 'oplog', owner, device);
  function tick(remote) {
    const wall = now();
    let [w, c] = state.hlc;
    const r = remote || [0, 0];
    const m = Math.max(wall, w, r[0]);
    c = m === w && m === r[0] ? Math.max(c, r[1]) + 1 : m === w ? c + 1 : m === r[0] ? r[1] + 1 : 0;
    state.hlc = [m, c];
    return state.hlc;
  }
  function depsNow() {
    const deps = {};
    for (const batch of known.values()) deps[batch.device] = Math.max(deps[batch.device] || 0, batch.seq);
    return deps;
  }
  async function commit(ops) {
    await load();
    let maxRemote = [0, 0];
    for (const batch of known.values()) if (batch.hlc[0] > maxRemote[0] || (batch.hlc[0] === maxRemote[0] && batch.hlc[1] > maxRemote[1])) maxRemote = batch.hlc;
    state.seq += 1;
    const batch = { v: 1, owner, device: state.deviceId, user, seq: state.seq, opId: crypto.randomUUID(), hlc: [...tick(maxRemote)], deps: depsNow(), ops };
    // Önce yerel kalıcılık (durum + günlük), sonra paylaşım.
    await atomicWrite(stateFile, JSON.stringify(state));
    await atomicWrite(path.join(journalDir, `${String(batch.seq).padStart(8, '0')}-${batch.opId}.json`), JSON.stringify(batch));
    known.set(batch.opId, batch);
    await publishPending().catch(() => null);
    return batch;
  }
  async function publishPending() {
    await load();
    const root = await getSharedRoot();
    if (!root) return 0;
    let count = 0;
    for (const batch of known.values()) {
      if (batch.device !== state.deviceId) continue;
      const file = path.join(sharedDir(root, state.deviceId), `${String(batch.seq).padStart(8, '0')}-${batch.opId}.json`);
      if (fs.existsSync(file)) continue;
      await atomicWrite(file, JSON.stringify(batch), { exclusive: true });
      count += 1;
    }
    return count;
  }
  async function sync() {
    await load();
    await publishPending().catch(() => null);
    const root = await getSharedRoot();
    if (!root) return view();
    let devices = [];
    try { devices = await fsp.readdir(path.join(root, 'oplog', owner)); } catch (_) {}
    for (const device of devices) {
      if (device === 'checkpoints') continue;
      for (const batch of await readJsonDir(sharedDir(root, device))) {
        if (!batch || !batch.opId || known.has(batch.opId)) continue;
        await atomicWrite(path.join(receivedDir, `${batch.device}-${String(batch.seq).padStart(8, '0')}-${batch.opId}.json`), JSON.stringify(batch), { exclusive: true });
        known.set(batch.opId, batch);
      }
    }
    const cps = await readJsonDir(path.join(root, 'oplog', owner, 'checkpoints'));
    if (cps.length) checkpoint = cps.sort((a, b) => b.createdAt - a.createdAt)[0];
    return view();
  }
  function view() { return fold([...known.values()], { owner, policy, checkpoint }); }
  async function status(opId) {
    await load();
    const batch = known.get(opId);
    if (!batch) return 'unknown';
    const root = await getSharedRoot();
    const published = root && fs.existsSync(path.join(sharedDir(root, batch.device), `${String(batch.seq).padStart(8, '0')}-${batch.opId}.json`));
    const seen = [...known.values()].some(other => other.device !== batch.device && Number((other.deps || {})[batch.device] || 0) >= batch.seq);
    return seen ? 'seen' : published ? 'published' : 'local';
  }
  // Kullanıcı işlemleri: görünen tüm başları ezer (çakışmayı gören kullanıcı ikisini de görmüştür).
  async function setField(row, field, value) {
    const current = view().rows.get(row);
    if (!current) throw new Error(`row ${row} not visible`);
    return commit([{ t: 'set', row, field, value, prev: current.versions[field] || [] }]);
  }
  async function createRow(row, fields) { return commit([{ t: 'create', row, fields }]); }
  async function deleteRow(row) {
    const current = view().rows.get(row);
    if (!current) throw new Error(`row ${row} not visible`);
    return commit([{ t: 'delete', row, observed: { ...current.versions } }]);
  }
  async function permission(t, grantee, level = 'edit') { return commit([{ t, user: grantee, level }]); }
  return {
    load, commit, sync, view, status, setField, createRow, deleteRow, permission, publishPending,
    get deviceId() { return state && state.deviceId; }, known, stateFile, journalDir,
  };
}

module.exports = { createDevice, atomicWrite, readJsonDir };
