'use strict';

/* AŞAMA 1 PROTOTİPİ · İTERASYON 2 — ARTIMLI, SAATSİZ (GEÇİCİ, ÜRETİM DIŞI)
 *
 * Tam katlamanın (oplog-engine.fold) yerini alacak artımlı uygulayıcı. Hedef:
 * geçmiş büyüdükçe bellek, açılış ve hesaplama maliyeti büyümesin.
 *
 *  · Nedensel tamponlama: bir kayıt, dayandığı tüm sürümler (prev / observed)
 *    uygulanmış olmadan uygulanmaz. Geç gelen öncül tamponu çözer; sonuç teslim
 *    sırasından bağımsızdır (aynı küme → aynı durum).
 *  · Kompakt durum: hücre başına yalnız BAŞ sürümler {id, value}; ezilen
 *    sürümler tutulmaz (geçmiş yok). Silinen satır işaret olarak kalır.
 *  · SAATSİZ: hiçbir karar duvar saatine/HLC'ye bakmaz. Eşzamanlı başlar korunur,
 *    hücre `conflict:true` olur ve kullanıcı çözene kadar çözülmemiş kalır.
 *    Görüntülenecek değer yalnız yakınsama için, sürüm kimliğinin özetine göre
 *    seçilir; bu bir "kazanan" iddiası değildir (sahte kesinlik üretilmez).
 *  · Tekilleştirme: uygulanmış kayıt kimlikleri. (Ölçek sınırı README'de.)
 */

const crypto = require('crypto');
const displayKey = id => crypto.createHash('sha1').update(String(id)).digest('hex');

function createState() {
  return {
    rows: new Map(),        // row -> { deleted:null|{observed:Set}, cells: Map(field -> heads:[{id,value}]) }
    // Sürüm kimliği `${opId}:${index}`: "sürüm biliniyor mu" = "kaydı uygulandı mı".
    // Sürüm başına küme tutulmaz (geçmişle büyümez); yalnız kayıt kimlikleri.
    applied: new Set(),     // uygulanmış kayıt kimlikleri — tekilleştirme
    rejected: new Set(),    // kesin reddedilmiş (geri alma sonrası) — ona dayananlar onu yok sayar
    held: new Set(),        // geçici karantina (izin henüz yok) — ona dayananlar bekler
    waitingIds: new Set(),  // tamponda bekleyen kayıtlar (tekrarlı teslim çift sayılmaz)
    waiting: new Map(),     // eksik kayıt kimliği -> [bekleyen işlem]
    pendingCount: 0,
    grants: new Set(), revokes: new Map(),
    quarantine: [],
  };
}

function cellOf(state, row, field) {
  const r = state.rows.get(row);
  return r ? r.cells.get(field) : undefined;
}

// Durumu bekleyen öncül olmadan uygulanabilir mi?
const batchOf = versionId => String(versionId).split(':')[0];
function missingDeps(state, deps) { return deps.map(batchOf).filter(opId => !state.applied.has(opId) && !state.rejected.has(opId)); }

function applySet(state, op, id) {
  const r = state.rows.get(op.row);
  if (!r) return false;
  const heads = r.cells.get(op.field) || [];
  const prev = new Set(op.prev || []);
  const next = heads.filter(h => !prev.has(h.id));
  next.push({ id, value: op.value });
  r.cells.set(op.field, next);
  // Silinmiş satıra, silenin görmediği yeni sürüm: satır geri gelir ve bildirilir (mevcut politika).
  if (r.deleted) { r.resurrected = true; r.deleted = null; }
  return true;
}
function applyDelete(state, op) {
  const r = state.rows.get(op.row);
  if (!r || r.deleted) return;
  const observed = new Set(Object.values(op.observed || {}).flat());
  // Silenin görmediği baş var mı? Tamponlama gereği observed'in hepsi biliniyor; görülmemiş
  // bir baş ancak eşzamanlı yazımdır.
  const unseen = [];
  for (const [field, heads] of r.cells) for (const h of heads) if (!observed.has(h.id)) unseen.push({ field, id: h.id });
  if (unseen.length) { r.deleteConflict = unseen; return; }
  r.deleted = { observed };
}

function authorized(state, batch, owner) {
  if (batch.user === owner) return true;
  if (!state.grants.has(batch.user)) return false;
  const cuts = state.revokes.get(batch.user);
  return !cuts || cuts.every(deps => Number(deps[batch.device] || 0) >= batch.seq);
}

function applyOp(state, batch, op, index, owner) {
  const id = `${batch.opId}:${index}`;
  if (op.t === 'create') {
    if (!state.rows.has(op.row)) state.rows.set(op.row, { deleted: null, cells: new Map() });
    const r = state.rows.get(op.row);
    for (const [field, value] of Object.entries(op.fields || {})) {
      const vid = `${id}/${field}`;
      r.cells.set(field, [...(r.cells.get(field) || []), { id: vid, value }]);
    }
    return [];
  }
  if (op.t === 'set') { applySet(state, op, id); return [id]; }
  if (op.t === 'delete') { applyDelete(state, op); return []; }
  return [];
}

function depsOfOp(op) {
  if (op.t === 'set') return op.prev || [];
  if (op.t === 'delete') return Object.values(op.observed || {}).flat();
  return [];
}

/* Yetki varış sırasına bağlı olamaz (artımlı motorun ilk sürümünde 100 karıştırmanın
   93'ü farklı sonuç verdi). İzin sonradan gelirse o kullanıcının "izin yok"
   karantinası yeniden denenir; geri alma sonradan gelir ve kesimin ötesinde
   uygulanmış kayıt varsa durum, yetki kayıtları önce olmak üzere yeniden kurulur
   (nadir olay). Kayıtları yeniden kurulum için çağıran sağlar (diskteki dosyalar):
   motor geçmişi bellekte tutmaz. */
function rebuild(state, { owner, allBatches }) {
  const batches = [...allBatches()];
  // Yeniden kurulum en son checkpoint'ten başlar: budanmış geçmişe ihtiyaç yoktur.
  // Checkpoint, sahibin o ana kadarki kaydı kabulüdür; geç gelen geri alma onun
  // içine giremez, yalnız checkpoint sonrası kayıtları etkiler.
  const fresh = state.baseCheckpoint ? restore(state.baseCheckpoint) : createState();
  const isPermission = b => b.user === owner && b.ops.some(op => op.t === 'grant' || op.t === 'revoke');
  for (const b of batches.filter(isPermission)) ingest(fresh, b, { owner, allBatches });
  for (const b of batches.filter(b => !isPermission(b))) ingest(fresh, b, { owner, allBatches });
  Object.assign(state, fresh);
  state.rebuilds = (state.rebuilds || 0) + 1;
}
/* Bir kaydı uygula ya da tampona al. Uygulanan her sürüm, onu bekleyenleri çözer. */
function ingest(state, batch, { owner, allBatches = null }) {
  if (!batch || batch.owner !== owner || state.applied.has(batch.opId) || state.rejected.has(batch.opId) || state.held.has(batch.opId)) return;
  if (state.waitingIds.has(batch.opId)) return;
  if (batch.user === owner) {
    let needsRebuild = false;
    for (const op of batch.ops) {
      if (op.t === 'grant' && !state.grants.has(op.user)) {
        state.grants.add(op.user);
        const retry = state.quarantine.filter(item => item.user === op.user && item.reason === 'no-grant');
        state.quarantine = state.quarantine.filter(item => !retry.includes(item));
        for (const item of retry) { state.held.delete(item.opId); state.deferredRetry = [...(state.deferredRetry || []), item.batch]; }
      }
      if (op.t === 'revoke') {
        if (!state.revokes.has(op.user)) state.revokes.set(op.user, []);
        const cut = batch.deps || {};
        state.revokes.get(op.user).push(cut);
        if ((state.appliedBy && state.appliedBy.get(op.user) || []).some(b => Number(cut[b.device] || 0) < b.seq)) needsRebuild = true;
      }
    }
    if (needsRebuild && allBatches) { rebuild(state, { owner, allBatches }); return; }
  }
  if (!authorized(state, batch, owner)) {
    const reason = state.grants.has(batch.user) ? 'after-revoke' : 'no-grant';
    (reason === 'no-grant' ? state.held : state.rejected).add(batch.opId);
    state.quarantine.push({ opId: batch.opId, user: batch.user, reason, batch });
    // Kesin ret: onu bekleyenler artık onu yok sayarak ilerleyebilir.
    if (reason === 'after-revoke') releaseWaiters(state, batch.opId, { owner, allBatches });
    return;
  }
  if (batch.user !== owner) {
    // Geri alma kesimi denetimi için yazar başına (cihaz, seq) — kayıt nesnesi değil, iki alan.
    if (!state.appliedBy) state.appliedBy = new Map();
    if (!state.appliedBy.has(batch.user)) state.appliedBy.set(batch.user, []);
    state.appliedBy.get(batch.user).push({ device: batch.device, seq: batch.seq });
  }
  // Kayıt bütün olarak bekler: işlemlerinden birinin öncülü eksikse hiçbiri uygulanmaz
  // (kayıt içi sıra korunur, yarım uygulanmış kayıt olmaz).
  const missing = [...new Set(batch.ops.flatMap(op => missingDeps(state, depsOfOp(op))).filter(opId => opId !== batch.opId))];
  if (missing.length) {
    if (!state.waitingIds.has(batch.opId)) { state.waitingIds.add(batch.opId); state.pendingCount += 1; }
    for (const opId of missing) { if (!state.waiting.has(opId)) state.waiting.set(opId, new Set()); state.waiting.get(opId).add(batch); }
    return;
  }
  state.applied.add(batch.opId);
  batch.ops.forEach((op, index) => applyOp(state, batch, op, index, owner));
  if (state.deferredRetry && state.deferredRetry.length) { const list = state.deferredRetry; state.deferredRetry = []; for (const b of list) ingest(state, b, { owner, allBatches }); }
  releaseWaiters(state, batch.opId, { owner, allBatches });
}
function releaseWaiters(state, opId, options) {
  const waiters = state.waiting.get(opId);
  if (!waiters) return;
  state.waiting.delete(opId);
  for (const w of waiters) {
    // Başka eksik öncüller için de bekliyor olabilir.
    let stillWaiting = false;
    for (const set of state.waiting.values()) if (set.has(w)) { stillWaiting = true; break; }
    if (stillWaiting) continue;
    state.pendingCount -= 1;
    state.waitingIds.delete(w.opId);
    ingest(state, w, options);
  }
}

/* Görünüm: hücre başına değer + çakışma işareti. Saat yok; birden çok baş varsa
   görüntülenecek değer sürüm kimliği özetiyle seçilir ve çakışma açık kalır. */
function view(state) {
  const rows = new Map(), conflicts = [];
  for (const [row, r] of state.rows) {
    if (r.deleted) continue;
    const fields = {}, versions = {};
    for (const [field, heads] of r.cells) {
      const ordered = [...heads].sort((a, b) => (displayKey(a.id) < displayKey(b.id) ? -1 : 1));
      fields[field] = ordered[0].value;
      versions[field] = heads.map(h => h.id);
      // Aynı değere ulaşan eşzamanlı yazımlar kullanıcıya çakışma olarak sunulmaz.
      const distinct = [...new Set(ordered.map(h => JSON.stringify(h.value)))];
      if (distinct.length > 1) conflicts.push({ row, field, values: ordered.map(h => h.value), unresolved: true });
    }
    if (r.deleteConflict || r.resurrected) conflicts.push({ row, field: '_deleted', unresolved: true });
    rows.set(row, { id: row, fields, versions });
  }
  return { rows, conflicts, pending: state.pendingCount, quarantine: state.quarantine };
}

/* Kompakt checkpoint: yalnız baş sürümler ve silme işaretleri + uygulanmış kayıt kimlikleri. */
function snapshot(state) {
  const rows = [];
  for (const [row, r] of state.rows) rows.push([row, r.deleted ? [...r.deleted.observed] : null, [...r.cells].map(([field, heads]) => [field, heads.map(h => [h.id, h.value])])]);
  const body = { v: 2, rows, applied: [...state.applied], rejected: [...state.rejected], grants: [...state.grants], revokes: [...state.revokes] };
  // Bozuk/yarım aktarılmış checkpoint açılışta tespit edilir (özet tutmazsa reddedilir).
  return { ...body, sha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
function restore(cp) {
  const { sha256, ...body } = cp || {};
  if (!cp || body.v !== 2 || crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') !== sha256) {
    throw Object.assign(new Error('checkpoint corrupt or incomplete'), { code: 'CHECKPOINT_CORRUPT' });
  }
  const state = createState();
  state.baseCheckpoint = cp;
  for (const [row, deleted, cells] of cp.rows) {
    const r = { deleted: deleted ? { observed: new Set(deleted) } : null, cells: new Map() };
    for (const [field, heads] of cells) r.cells.set(field, heads.map(([id, value]) => ({ id, value })));
    state.rows.set(row, r);
  }
  for (const id of cp.applied) state.applied.add(id);
  for (const id of cp.rejected || []) state.rejected.add(id);
  for (const u of cp.grants) state.grants.add(u);
  for (const [u, cuts] of cp.revokes) state.revokes.set(u, cuts);
  return state;
}

module.exports = { createState, ingest, view, snapshot, restore, rebuild };
