'use strict';

/* AŞAMA 1 PROTOTİPİ — GEÇİCİ, ÜRETİM DIŞI (ADR-0001). Uygulamaya bağlanmaz.
 *
 * Saf katlama (fold): Koleksiyon durumu, cihazların değişmez kayıt
 * kümelerinin deterministik fonksiyonudur. Teslim sırası, tekrarlı teslim ve
 * dosya zamanları sonucu değiştirmez; yalnız KÜME değişirse durum değişir.
 *
 * Kayıt (batch): { v, owner, device, user, seq, opId, hlc:[wall,counter], deps:{device:seq}, ops:[] }
 * İşlemler:
 *  set    { t:'set', row, field, value, prev:[versionId] }  — gördüğü başları ezer
 *  create { t:'create', row, fields:{} }                    — satır kimliği küresel benzersiz
 *  delete { t:'delete', row, observed:{ field:[versionId] } } — silenin gördüğü sürümler
 *  grant/revoke { t:'grant'|'revoke', user, level }         — yalnız sahip
 * Sürüm kimliği: `${opId}:${index}` (içerik adresli değil; benzersiz ve değişmez).
 *
 * Nedensellik sayaçla değil, her yazımın ezdiği sürümlerle (prev) izlenir;
 * eşzamanlılık "biri diğerini görmedi" demektir. Eşzamanlı aynı alan
 * yazımında kazanan POLİTİKA parametresidir (ürün kararı); kaybeden çakışma
 * kaydına düşer. Silme + silenin görmediği eşzamanlı düzenleme: satır kalır ve
 * bildirilir (mevcut Buyer Log politikası).
 */

function hlcCompare(a, b) { return (a[0] - b[0]) || (a[1] - b[1]); }
const POLICIES = {
  // "Önce kaydedilen kalır" kuralının yayım yarışı olmayan deterministik karşılığı.
  'earliest-wins': (a, b) => hlcCompare(a.hlc, b.hlc) || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0) || (a.id < b.id ? -1 : 1),
  'latest-wins': (a, b) => -POLICIES['earliest-wins'](a, b),
};

function fold(batches, { owner, policy = 'earliest-wins', checkpoint = null, keepDeleted = false } = {}) {
  const order = POLICIES[policy];
  if (!order) throw new Error(`unknown policy ${policy}`);
  // 1) Tekilleştir; çatal (aynı cihaz + seq, farklı kayıt: geri sarılmış durum) tespit et.
  const byOp = new Map(), bySlot = new Map(), forks = [];
  for (const batch of batches) {
    if (!batch || batch.owner !== owner || byOp.has(batch.opId)) continue;
    byOp.set(batch.opId, batch);
    const slot = `${batch.device}#${batch.seq}`;
    if (bySlot.has(slot) && bySlot.get(slot) !== batch.opId) forks.push({ device: batch.device, seq: batch.seq });
    else bySlot.set(slot, batch.opId);
  }
  const forkedDevices = new Set(forks.map(item => item.device));
  // 2) Yetki: sahip her zaman; diğer yazar ancak geçerli izinle. Geri alma, geri alanın
  //    GÖRDÜĞÜ kayıtlarla (deps) belirlenir, saatle değil: görülmemiş kayıt incelemeye.
  const grants = new Map(), revokes = new Map();
  // Budanmış yetki kayıtları checkpoint'te taşınır: budama yetki durumunu değiştirmez.
  for (const user of (checkpoint && checkpoint.grants) || []) grants.set(user, true);
  for (const [user, cuts] of Object.entries((checkpoint && checkpoint.revokes) || {})) revokes.set(user, [...cuts]);
  for (const batch of byOp.values()) {
    if (batch.user !== owner) continue;
    for (const op of batch.ops) {
      if (op.t === 'grant' && op.level === 'edit') grants.set(op.user, true);
      if (op.t === 'revoke') { if (!revokes.has(op.user)) revokes.set(op.user, []); revokes.get(op.user).push(batch.deps || {}); }
    }
  }
  const quarantine = [];
  const authorized = batch => {
    if (batch.user === owner) return true;
    if (!grants.get(batch.user)) return false;
    const cuts = revokes.get(batch.user);
    if (!cuts) return true;
    // Çatallı cihazda seq tek anlamlı değildir: temkinli taraf.
    if (forkedDevices.has(batch.device)) return false;
    return cuts.every(deps => Number(deps[batch.device] || 0) >= batch.seq);
  };
  const valid = [];
  for (const batch of byOp.values()) {
    if (authorized(batch)) valid.push(batch);
    else quarantine.push({ opId: batch.opId, device: batch.device, user: batch.user, reason: grants.get(batch.user) ? 'after-revoke' : 'no-grant' });
  }
  // 3) Sürümler ve "ezilen" ilişkisi.
  const versions = new Map(); // id -> { id, row, field, value, prev, hlc, device, batch }
  const creates = new Map(), deletes = [];
  for (const batch of valid) batch.ops.forEach((op, index) => {
    const id = `${batch.opId}:${index}`;
    if (op.t === 'set') versions.set(id, { id, row: op.row, field: op.field, value: op.value, prev: op.prev || [], hlc: batch.hlc, device: batch.device });
    else if (op.t === 'create') {
      creates.set(op.row, { id, hlc: batch.hlc, device: batch.device });
      for (const [field, value] of Object.entries(op.fields || {})) versions.set(`${id}/${field}`, { id: `${id}/${field}`, row: op.row, field, value, prev: [], hlc: batch.hlc, device: batch.device });
    } else if (op.t === 'delete') deletes.push({ id, row: op.row, observed: op.observed || {}, hlc: batch.hlc, device: batch.device });
  });
  // Checkpoint tabanı: budanmış geçmişin başları (sürüm kimlikleriyle korunur).
  const ancientCovered = id => {
    if (!checkpoint) return false;
    const [opId] = String(id).split(':');
    const slot = checkpoint.included && checkpoint.included[opId];
    return Boolean(slot);
  };
  if (checkpoint) {
    for (const v of checkpoint.heads || []) if (!versions.has(v.id)) versions.set(v.id, { ...v, prev: [] });
    for (const row of checkpoint.rows || []) if (!creates.has(row)) creates.set(row, { id: `checkpoint:${row}`, hlc: [0, 0], device: '' });
    // Silme işareti budanmaz: silinen satırın son başları ve silenin gördüğü sürümler
    // korunur; budanmış geçmişten sonra gelen geç düzenleme silmeyle sessizce kaybolmaz.
    for (const [row, tomb] of Object.entries(checkpoint.tombstones || {})) {
      if (!creates.has(row)) creates.set(row, { id: `checkpoint:${row}`, hlc: [0, 0], device: '' });
      for (const v of tomb.heads || []) if (!versions.has(v.id)) versions.set(v.id, { ...v, prev: [] });
      deletes.push({ id: `checkpoint-delete:${row}`, row, observed: tomb.observed || {}, hlc: [0, 0], device: '' });
    }
  }
  // Bilinmeyen öncül: henüz teslim edilmemiş olabilir → bekletilir (kayıp değil).
  // Checkpoint'in kapsadığı (budanmış eski) öncül → eski sayılır, sürüm baş olur.
  const pending = [];
  for (const v of [...versions.values()]) {
    const missing = v.prev.filter(id => !versions.has(id) && !ancientCovered(id));
    if (missing.length) { versions.delete(v.id); pending.push({ id: v.id, missing }); }
  }
  // Bekletilenin ardılları da bekletilir (zincir).
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of [...versions.values()]) if (v.prev.some(id => !versions.has(id) && !ancientCovered(id))) { versions.delete(v.id); pending.push({ id: v.id, missing: v.prev }); changed = true; }
  }
  const superseded = new Set();
  for (const v of versions.values()) for (const id of v.prev) superseded.add(id);
  const ancestorsOf = id => {
    const out = new Set(), stack = [id];
    while (stack.length) { const cur = versions.get(stack.pop()); if (!cur) continue; for (const p of cur.prev) if (!out.has(p)) { out.add(p); stack.push(p); } }
    return out;
  };
  // 4) Alan kayıtçıları: başlar = ezilmemiş sürümler.
  const cells = new Map();
  for (const v of versions.values()) {
    if (superseded.has(v.id)) continue;
    const key = `${v.row}\u0000${v.field}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(v);
  }
  const rows = new Map(), conflicts = [];
  for (const [row] of creates) rows.set(row, { id: row, fields: {}, versions: {} });
  for (const [, heads] of cells) {
    heads.sort(order);
    const winner = heads[0];
    if (!rows.has(winner.row)) continue; // satırı yaratan kayıt yok/karantinada
    const target = rows.get(winner.row);
    target.fields[winner.field] = winner.value;
    target.versions[winner.field] = heads.map(item => item.id);
    for (const loser of heads.slice(1)) conflicts.push({ row: winner.row, field: winner.field, current: winner.value, incoming: loser.value, currentVersion: winner.id, incomingVersion: loser.id });
  }
  // 5) Silme: silenin görmediği bir baş varsa satır kalır ve bildirilir.
  for (const del of deletes) {
    const target = rows.get(del.row);
    if (!target || target.deleted) continue;
    const unseen = [];
    for (const [field, heads] of Object.entries(target.versions)) {
      const seen = new Set();
      for (const id of [].concat(del.observed[field] || [])) { seen.add(id); for (const a of ancestorsOf(id)) seen.add(a); }
      for (const head of heads) if (!seen.has(head)) unseen.push({ field, version: head });
    }
    if (!unseen.length) { target.deleted = true; target.deletedObserved = del.observed; }
    else conflicts.push({ row: del.row, field: '_deleted', current: 'eşzamanlı düzenleme korundu', incoming: 'silme', unseen });
  }
  if (!keepDeleted) for (const [row, value] of [...rows]) if (value.deleted) rows.delete(row);
  return { rows, conflicts, quarantine, pending, forks, versionCount: versions.size, versionsById: versions, grants: [...grants.keys()], revokes: Object.fromEntries(revokes) };
}

/* Checkpoint: katlanmış kümenin özeti. Kapsadığı kayıtlar yazarlarınca
   budanabilir. Başlar (kaybedenler dahil) ve silme işaretleri korunur. */
function makeCheckpoint(batches, options) {
  const result = fold(batches, options);
  const included = {};
  for (const batch of batches) if (batch && batch.owner === options.owner && !result.quarantine.some(item => item.opId === batch.opId)) included[batch.opId] = true;
  for (const item of result.pending) delete included[String(item.id).split(':')[0]];
  // Önceki checkpoint'in kapsadıkları da kapsanmış sayılır (zincir).
  if (options.checkpoint) Object.assign(included, options.checkpoint.included || {});
  const heads = [], rows = [], tombstones = {};
  const full = foldWithDeleted(batches, options);
  for (const [row, value] of full.rows) {
    const rowHeads = [];
    for (const ids of Object.values(value.versions)) for (const id of ids) rowHeads.push(full.versionsById.get(id));
    if (value.deleted) tombstones[row] = { heads: rowHeads, observed: value.deletedObserved || {} };
    else { rows.push(row); heads.push(...rowHeads); }
  }
  return { owner: options.owner, createdAt: Date.now(), included, heads, rows, tombstones, grants: full.grants, revokes: full.revokes };
}
function foldWithDeleted(batches, options) {
  // fold'un silinenleri de döndüren iç sürümü (checkpoint için): tekrar katlayıp
  // silme kararını işaretle birlikte saklar.
  const base = fold(batches, { ...options, keepDeleted: true });
  return base;
}

module.exports = { fold, makeCheckpoint, POLICIES, hlcCompare };
