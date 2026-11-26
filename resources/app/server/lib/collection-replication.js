'use strict';

/* Eski genel delta alanına yanlışlıkla düşmüş Collection çalışma alanlarını
 * ayıklar. Yetkili sahipler de, emekli shared-collection havuzu da bu yoldan
 * uygulanmaz: yeni sahip-bazlı taşıma mekanizması tek iş verisi kaynağıdır. */

function collectionWorkspaceOwnerFromDelta(delta) {
  const id = String(delta && delta.id || '');
  const match = /^store:collection-workspaces\/([A-Za-z0-9_-]+)\.json$/.exec(id);
  return match ? match[1] : null;
}

function filterCollectionWorkspaceDeltas(deltas = []) {
  // Collection ownership is owner-based. Every Collection workspace—including
  // the legacy shared-collection recovery evidence—travels only through the
  // permission-aware owner replication path. Letting the retired shared pool
  // back into generic sync can resurrect it on another device after quarantine
  // and mix it into a later ownership recovery.
  return (Array.isArray(deltas) ? deltas : []).filter(delta => !collectionWorkspaceOwnerFromDelta(delta));
}

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync, replaceFileWithRetry } = require('./shared-file-transaction');

const REPLICATION_VERSION = 1;
const REPLICATION_STATE_VERSION = 1;
const LEGACY_DELTA_QUARANTINE_MARKER = 'collectionLegacyDeltaQuarantineV1';
const CAS_RACE_CODES = new Set(['COLLECTION_REPLICA_CONFLICT', 'COLLECTION_REPLICA_STALE', 'COLLECTION_REPLICA_ANCESTRY_CONFLICT']);
/* Kira altı birleşim hub kirasını uzatır. Ölçüm (Linux, 30.000 satır, 6,7 MB
   zarf): normal yayım kirası ~123 ms, kira altı birleşim +~1,08 sn (birleşim
   464 ms + yerel yazım 384 ms), yaklaşık 160 ms/MB. Başka makinelerin kira
   bekleme sınırı 3 sn olduğundan daha büyük zarfta yarışı kaybeden birleşim
   eski yolda (bekleyen yayım → sonraki yoklama) kalır. */
const MERGE_UNDER_LEASE_MAX_BYTES = 2 * 1024 * 1024;
function clean(value) { return String(value == null ? '' : value).trim(); }
function safeId(value) { return clean(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100); }
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function remoteWorkspaceFile(root, ownerId) { return path.join(path.resolve(root), 'BUYER_LOG_SYNC', 'collection-workspaces', 'v1', `${safeId(ownerId)}.json`); }
function envelopeChecksum(value) {
  // Keep the original v1 checksum byte-compatible so older Buyer Log clients
  // can still read a chained envelope. New clients additionally verify chainSha.
  return checksum({ version:value.version, ownerId:value.ownerId, workspace:value.workspace });
}
function envelopeChainChecksum(value) { return checksum({ sha256:value.sha256, parentSha256:value.parentSha256 || null }); }
function envelopeIdentity(value) { return clean(value && value.chainSha256) || clean(value && value.sha256); }
/* YAYIM KAPSAMA HARİTASI (ADR-0001 Aşama 0, version vector).
   Zarf, kurulum kimliği → o kurulumun bu kopyaya dahil olan son yayımının
   kimliği haritasını (`heads`) taşır. Değerler sayaç değil, içerik adresli
   zarf kimliğidir: yedekten dönme/yeniden kurulum bir sayacı geri sarıp
   yayımı "kapsanmış" gösteremez. Bir girdi yalnız o yayımın üzerine
   (CAS ile ya da üç yönlü birleşimle) kurulan zarfa aktarılır; birleşim uzak
   tarafın değişikliğini korur veya çakışma kaydına alır. Bu yüzden
   "kapsanmış" = verisi bu kopyada ya da bilinçli çakışma çözümünde.
   Geçmiş uzunluğuna bağlı sınır yoktur; boyut yayım yapan kurulum sayısıyla
   büyür (kurulum başına ~110 bayt) ve girdiler budanmaz: budanan girdi
   bekleyen yayımı temkinli tabana düşürürdü. Eski istemcilerin doğruladığı
   sha256/chainSha256 değişmez; harita kendi özetiyle doğrulanır, tutmazsa
   yok sayılır ve yalnız parentSha256 kalır (temkinli taraf). */
function envelopeHeadsChecksum(value) { return checksum({ chainSha256: value.chainSha256, heads: value.heads }); }
function envelopeHeads(value) {
  if (!value || !plainMap(value.heads) || value.headsSha256 !== envelopeHeadsChecksum(value)) return null;
  return value.heads;
}
function nextHeads(current, installationId, identity) {
  const out = {};
  for (const [key, value] of Object.entries(envelopeHeads(current) || {})) if (key !== installationId && typeof value === 'string' && clean(value)) out[key] = value;
  out[installationId] = identity;
  return out;
}
/* BEKLEYEN YAYIM. Bir cihazın yayımı, uzak kopyada onu kapsayan bir halef
   görülene kadar onaylanmış sayılmaz: ayrı aynada cihaz kendi dosyasını
   görür, bulut sonradan başka kopyayı seçebilir. Bekleyen yayımlar arasında
   yabancı bir birleşim olmaz (her yabancı birleşim kaydı temizler), bu yüzden
   bekleyen zincir ilk tabanın üstüne saf yerel değişikliklerdir. Saklanan:
   ilk taban (tam kopya) + her yayımın küçük değişiklik farkı. Uzak kopyanın
   kapsadığı yayımın tam tabanı böylece kesin kurulur; kapsanan yayım listede
   yoksa ilk taban kullanılır (o durumda da kesin: uzak kopya bekleyenlerin
   hiçbirini içermiyor). Kayıt bozulursa ilk tabana düşülür (temkinli). */
const CLEAR_PENDING_PUBLICATIONS = Object.freeze({ pendingLatest: null, pendingFirstBaseSha256: null, pendingFromEmpty: null, pendingChainBroken: null });
function coveredPublicationId(envelope, installationId) {
  const heads = envelopeHeads(envelope);
  return clean(heads && installationId ? heads[installationId] : '');
}
function hasPendingPublication(ownerStateValue) { return Boolean(clean(ownerStateValue && ownerStateValue.pendingLatest)); }
function coversLatest(ownerStateValue, envelope, installationId) {
  const latest = clean(ownerStateValue && ownerStateValue.pendingLatest);
  // Eski istemci haritayı düşürür ama parentSha256 zincirini sürdürür.
  return Boolean(latest) && (coveredPublicationId(envelope, installationId) === latest || clean(envelope && envelope.parentSha256) === latest);
}
function isOwnLatestPublication(ownerStateValue, envelope) {
  return hasPendingPublication(ownerStateValue) && envelopeIdentity(envelope) === clean(ownerStateValue.pendingLatest);
}
function publicationDisplaced(ownerStateValue, envelope, installationId) {
  if (!hasPendingPublication(ownerStateValue) || !envelope || isOwnLatestPublication(ownerStateValue, envelope)) return false;
  return !coversLatest(ownerStateValue, envelope, installationId);
}
function publicationConfirmed(ownerStateValue, envelope, installationId) {
  if (!hasPendingPublication(ownerStateValue) || !envelope || isOwnLatestPublication(ownerStateValue, envelope)) return false;
  return coversLatest(ownerStateValue, envelope, installationId);
}
/* Yayım farkı. _rev farklıysa satır farka girer; _rev eşitse içerik de
   karşılaştırılır: farklı dallardan gelen satırlar aynı _rev'de farklı içerik
   taşıyabilir (zincirin ilk farkı uzak kopyaya göre hesaplanır). Anahtar
   sırasına duyarlı karşılaştırma yalnız değişmemiş satırı fazladan ekleyebilir;
   fazladan satır zararsızdır (uygulanınca aynı durum), eksik satır kayıptır.
   Uygulama, farkı üreten yayımın tam durumunu önceki durumdan yeniden kurar. */
/* Tam eşitlik, string üretmeden: aynı anahtar kümesi ve her değer === ya da
   (iç içe nesnede) aynı JSON. Hiçbir farkı kaçırmaz; anahtar sırasına duyarsız. */
function sameRowShallow(a, b) {
  if (a === b) return true;
  let count = 0;
  for (const key in a) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
    count += 1;
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    const x = a[key], y = b[key];
    if (x === y) continue;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
    if (!sameValue(x, y)) return false;
  }
  for (const key in b) if (Object.prototype.hasOwnProperty.call(b, key)) count -= 1;
  return count === 0;
}
function workspaceDelta(before, after) {
  const beforeList = Array.isArray(before && before.rows) ? before.rows : [];
  const afterList = Array.isArray(after && after.rows) ? after.rows : [];
  const beforeRows = new Map();
  for (const row of beforeList) beforeRows.set(mergeRowKey(row), row);
  const upserts = [], seen = new Set();
  let orderChanged = beforeList.length !== afterList.length;
  for (let index = 0; index < afterList.length; index++) {
    const row = afterList[index], key = mergeRowKey(row);
    seen.add(key);
    if (!orderChanged && mergeRowKey(beforeList[index]) !== key) orderChanged = true;
    const previous = beforeRows.get(key);
    if (!previous || mergeRowRevision(previous) !== mergeRowRevision(row) || !sameRowShallow(previous, row)) upserts.push(row);
  }
  const deletes = [];
  for (const key of beforeRows.keys()) if (!seen.has(key)) deletes.push(key);
  const meta = {}, metaDeletes = [];
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (key === 'rows') continue;
    if (!Object.prototype.hasOwnProperty.call(after || {}, key)) metaDeletes.push(key);
    else if (!sameValue((before || {})[key], after[key])) meta[key] = after[key];
  }
  // Sıra yalnız değiştiyse saklanır; değişmediyse önceki sıra korunur, yeni satırlar sona eklenir.
  return { order: orderChanged ? afterList.map(mergeRowKey) : null, upserts, deletes, meta, metaDeletes };
}
function applyWorkspaceDelta(before, delta) {
  const rows = new Map((Array.isArray(before && before.rows) ? before.rows : []).map(row => [mergeRowKey(row), row]));
  for (const key of delta.deletes || []) rows.delete(key);
  for (const row of delta.upserts || []) rows.set(mergeRowKey(row), row);
  const out = { ...(before || {}) };
  for (const key of delta.metaDeletes || []) delete out[key];
  Object.assign(out, delta.meta || {});
  out.rows = (Array.isArray(delta.order) ? delta.order : [...rows.keys()]).map(key => rows.get(key)).filter(Boolean);
  return out;
}

const OPTIONAL_SYNC_ERROR_CODES = new Set(['EPERM', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);

async function syncFileHandleBestEffort(handle) {
  try { await handle.sync(); }
  catch (error) {
    // Windows security filters / OneDrive-like providers can reject fsync even
    // when the write itself is valid. Preserve real I/O failures.
    if (!OPTIONAL_SYNC_ERROR_CODES.has(error && error.code)) throw error;
  }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await syncFileHandleBestEffort(handle);
    await handle.close();
    handle = null;

    // On Windows the destination can be held for a few milliseconds by
    // Defender, indexing or backup software. A single rename used to surface
    // EPERM to the UI even though the Collection itself was already saved.
    // Retry the atomic replace with bounded exponential backoff; the lease
    // above still serializes concurrent Buyer Log writers.
    await replaceFileWithRetry(temporary, file, { attempts: 8, baseDelayMs: 20 });
  } finally {
    if (handle) { try { await handle.close(); } catch (_) {} }
    try { await fsp.unlink(temporary); } catch (_) {}
  }
}

async function readEnvelope(file, ownerId) {
  let raw;
  try { raw = JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
  if (!raw || raw.version !== REPLICATION_VERSION || clean(raw.ownerId) !== clean(ownerId) || !raw.workspace || typeof raw.workspace !== 'object') {
    throw Object.assign(new Error('Collection replikasyon belgesi geçersiz.'), { code: 'COLLECTION_REPLICA_INVALID' });
  }
  const expected = envelopeChecksum(raw);
  if (raw.sha256 !== expected) throw Object.assign(new Error('Collection replikasyon belgesi doğrulanamadı.'), { code: 'COLLECTION_REPLICA_CHECKSUM' });
  if (Object.prototype.hasOwnProperty.call(raw, 'parentSha256') && raw.chainSha256 !== envelopeChainChecksum(raw)) {
    throw Object.assign(new Error('Collection replikasyon soy zinciri doğrulanamadı.'), { code: 'COLLECTION_REPLICA_CHAIN_CHECKSUM' });
  }
  return raw;
}

/* Eski genel delta deposunda kalan Collection kayıtları, yeni erişim modelinde
 * hiçbir zaman aktif Collection verisi olarak okunmaz. Bu geçiş sahibin gerçek
 * çalışma alanı dosyasına dokunmaz. Doğrulanmış kanonik dosya ve bekleyen
 * yerel değişiklik yoksa yalnız eski kopya silinir; aksi halde kayıt, normal
 * API/delta akışından görünmeyen recovery bölümüne taşınır. */
async function quarantineLegacyCollectionDeltas({ localDb, workspaceFileForOwner, onTrace = null } = {}) {
  if (!localDb || typeof localDb.transaction !== 'function') throw new Error('Local DB transaction desteği zorunludur.');
  if (typeof workspaceFileForOwner !== 'function') throw new Error('Collection workspace dosya çözümleyicisi zorunludur.');
  /* Tamamlanmış geçiş tam yazma transaction'ı açmaz: transaction() her
     çağrıda bütün anlık görüntüyü yeniden yazar. Her açılışta çalışan bu
     kontrol büyük DB'de (ölçüm: 309 MB) diskte ~3x DB yazımı ve onlarca saniye
     DB kirası/olay döngüsü kilidi üretiyordu. İşaret transaction içinde yine
     denetlenir; aradaki yarış yalnız işi bir kez daha atlatır. */
  const current = typeof localDb.read === 'function' ? await localDb.read() : null;
  const done = current && current.migrations && current.migrations[LEGACY_DELTA_QUARANTINE_MARKER];
  if (done) {
    const outcome = { ...done, skipped: true };
    try { if (typeof onTrace === 'function') onTrace('COLLECTION_LEGACY_DELTA_QUARANTINED', outcome); } catch (_) {}
    return outcome;
  }
  const outcome = await localDb.transaction(async state => {
    state.migrations = state.migrations && typeof state.migrations === 'object' ? state.migrations : {};
    if (state.migrations[LEGACY_DELTA_QUARANTINE_MARKER]) return { ...state.migrations[LEGACY_DELTA_QUARANTINE_MARKER], skipped: true };
    const recordKeys = Object.keys(state.records || {});
    const tombstoneKeys = Object.keys(state.tombstones || {});
    const journalKeys = (state.journal || []).map(item => String(item && item.id || ''));
    const conflictKeys = (state.conflicts || []).map(item => String(item && item.id || ''));
    const ids = [...new Set([...recordKeys, ...tombstoneKeys, ...journalKeys, ...conflictKeys])].filter(id => collectionWorkspaceOwnerFromDelta({ id }));
    const recovery = state.collectionReplicationRecovery && typeof state.collectionReplicationRecovery === 'object'
      ? state.collectionReplicationRecovery : { version: 1, entries: {} };
    recovery.entries = recovery.entries && typeof recovery.entries === 'object' ? recovery.entries : {};
    let removed = 0, quarantined = 0, pending = 0;
    for (const id of ids) {
      const ownerId = collectionWorkspaceOwnerFromDelta({ id });
      const journal = (state.journal || []).filter(item => String(item && item.id || '') === id);
      const conflicts = (state.conflicts || []).filter(item => String(item && item.id || '') === id);
      const hasPendingMutation = journal.some(item => !item.uploaded);
      let hasCanonicalWorkspace = false;
      try { hasCanonicalWorkspace = fs.existsSync(workspaceFileForOwner(ownerId)); } catch (_) {}
      const safeToRemove = hasCanonicalWorkspace && !hasPendingMutation && conflicts.length === 0;
      const legacy = {
        ownerId,
        record: state.records && state.records[id],
        tombstone: state.tombstones && state.tombstones[id],
        journal,
        conflicts,
        quarantinedAt: new Date().toISOString(),
        reason: hasPendingMutation ? 'UNSYNCED_LOCAL_MUTATION' : hasCanonicalWorkspace ? 'CONFLICT_REQUIRES_RECOVERY' : 'CANONICAL_WORKSPACE_UNVERIFIED',
      };
      delete state.records[id];
      delete state.tombstones[id];
      state.journal = (state.journal || []).filter(item => String(item && item.id || '') !== id);
      state.conflicts = (state.conflicts || []).filter(item => String(item && item.id || '') !== id);
      if (safeToRemove) removed += 1;
      else {
        recovery.entries[id] = legacy;
        quarantined += 1;
        if (hasPendingMutation) pending += 1;
      }
    }
    recovery.updatedAt = new Date().toISOString();
    state.collectionReplicationRecovery = recovery;
    const result = { at: recovery.updatedAt, inspected: ids.length, removed, quarantined, pending, status: 'active-delta-retired' };
    state.migrations[LEGACY_DELTA_QUARANTINE_MARKER] = result;
    return result;
  });
  try { if (typeof onTrace === 'function') onTrace('COLLECTION_LEGACY_DELTA_QUARANTINED', outcome); } catch (_) {}
  return outcome;
}

/* ÜÇ YÖNLÜ KOLEKSİYON BİRLEŞİMİ.
   Karşılıklı düzenleme yetkisi olan iki kullanıcı aynı Koleksiyonu iki cihazda
   eşzamanlı değiştirdiğinde tüm belgeyi seçmek bir tarafın işini kaybettirir,
   hiç seçmemek ise kopyaları kalıcı olarak ayırır. Cihazın gördüğü son uzak
   kopya (taban) ile satır ve alan bazında birleştirilir:
   - yalnız bir tarafın değiştirdiği alan o tarafın değerini alır;
   - aynı alan iki tarafta farklı değiştiyse ÖNCE yayımlanan (uzak) değer kalır,
     yerel değer sessizce kaybolmaz: çakışma olarak döner;
   - bir tarafta silinip diğerinde değiştirilen satır korunur ve bildirilir;
   - aynı yeni satır kimliği iki cihazda farklı model için kullanıldıysa yerel
     satır yeni kimlik alır, ikisi de korunur. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function sameValue(a, b) { return stableJson(a) === stableJson(b); }
const canonicalFields = require('./canonical-fields');
const emptyTextKeys = new Set(canonicalFields.moduleFields('collection')
  .filter(id => ['text', 'code'].includes(canonicalFields.field(id).type))
  .map(id => canonicalFields.bindingFor('collection', id).keys[0]));
function sameRowField(key, a, b) {
  // Renderer hydration fills absent optional text with ''. That normalization
  // is not a competing edit. Financial/manual and nested override intent keep
  // their existing exact comparison semantics.
  if (emptyTextKeys.has(key) && (a == null || a === '') && (b == null || b === '')) return true;
  return sameValue(a, b);
}
/* Üretici başına fiyat haritaları (pricing: {üretici: fiyat}, pricingSent:
   {üretici: true}) tek bir değer değildir. İki kullanıcı aynı modelde farklı
   üreticilere fiyat girdiğinde haritayı bütün olarak karşılaştırmak birinin
   fiyatını bütün cihazlarda düşürüyordu. Bu alanlar üretici anahtarı düzeyinde
   aynı üç yönlü kuralla birleşir; aynı üretici iki tarafta farklı değiştiyse
   önce yayımlanan (uzak) değer kalır, yerel değer çakışma olarak döner ve
   çakışmanın "yerel" seçeneği diğer üreticileri korur. Harita olmayan
   (eski/bozuk) değer bütün alan kuralına düşer. */
// _plmValues: PLM alanı başına son görülen PLM değeri; alan bazında birleşir.
const KEYED_ROW_MAPS = new Set(['pricing', 'pricingSent', '_plmValues']);
function plainMap(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function mapOrAbsent(value) { return value == null || plainMap(value); }
function mergeKeyedRowMap(hasBase, base, local, remote) {
  const b = plainMap(base) ? base : {}, l = plainMap(local) ? local : {}, r = plainMap(remote) ? remote : {};
  const value = {}, losing = new Map();
  for (const key of new Set([...Object.keys(r), ...Object.keys(l), ...Object.keys(b)])) {
    const lv = l[key], rv = r[key], bv = b[key];
    let next;
    if (!hasBase && (lv === undefined || rv === undefined)) next = lv === undefined ? rv : lv;
    else if (sameValue(lv, rv) || (hasBase && sameValue(lv, bv))) next = rv;
    else if (hasBase && sameValue(rv, bv)) next = lv;
    else { next = rv; losing.set(key, lv); }
    if (next !== undefined) value[key] = next;
  }
  return { value, losing };
}
/* Çakışmada "benim değerim" seçimi. Harita çakışması yalnız kaybeden üretici
   anahtarlarını satırın GÜNCEL haritasına uygular: kayıttan sonra değişen
   diğer üreticiler ve aynı satırdaki başka bir harita çakışmasının çözümü
   ezilmez. Diğer alanlar ve eski kayıtlar bütün alan kuralını korur. */
function applyConflictIncoming(row, conflict) {
  const next = { ...(row || {}) };
  const field = clean(conflict && conflict.field);
  const entries = conflict && conflict.mapEntries, deletes = conflict && conflict.mapDeletes;
  if (KEYED_ROW_MAPS.has(field) && (plainMap(entries) || Array.isArray(deletes)) && mapOrAbsent(next[field])) {
    const map = { ...(plainMap(next[field]) ? next[field] : {}) };
    for (const [mapKey, value] of Object.entries(plainMap(entries) ? entries : {})) map[mapKey] = value;
    for (const mapKey of Array.isArray(deletes) ? deletes : []) delete map[String(mapKey)];
    next[field] = map;
    return next;
  }
  if (conflict.incoming == null) delete next[field]; else next[field] = conflict.incoming;
  return next;
}
function mergeRowKey(row) { const id = row && row.id; return id == null || id === '' ? '' : String(id); }
function mergeRowRevision(row) { return Math.max(0, Number(row && row._rev) || 0); }
function rowContent(row) { const out = { ...(row || {}) }; delete out._rev; return out; }
function rowsByKey(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) { const key = mergeRowKey(row); if (key && !map.has(key)) map.set(key, row); }
  return map;
}
function mergeRowFields(base, local, remote, rowId, conflicts) {
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base || {})]);
  for (const key of keys) {
    const l = local[key], r = remote[key], b = base ? base[key] : undefined;
    if (KEYED_ROW_MAPS.has(key) && mapOrAbsent(l) && mapOrAbsent(r) && mapOrAbsent(b) && (plainMap(l) || plainMap(r))) {
      const merged = mergeKeyedRowMap(Boolean(base), b, l, r);
      if (merged.losing.size) {
        const incoming = { ...merged.value }, mapEntries = {}, mapDeletes = [];
        for (const [mapKey, lost] of merged.losing) {
          if (lost === undefined) { delete incoming[mapKey]; mapDeletes.push(mapKey); }
          else { incoming[mapKey] = lost; mapEntries[mapKey] = lost; }
        }
        conflicts.push({ rowId, field: key, current: { ...merged.value }, incoming, mapEntries, mapDeletes });
      }
      out[key] = merged.value;
      continue;
    }
    let value;
    if (!base && (l === undefined || r === undefined)) value = l === undefined ? r : l;
    else if (sameRowField(key, l, r) || (base && sameRowField(key, l, b))) value = r;
    else if (base && sameRowField(key, r, b)) value = l;
    else { value = r; conflicts.push({ rowId, field: key, current: r === undefined ? null : r, incoming: l === undefined ? null : l }); }
    if (value !== undefined) out[key] = value;
  }
  return out;
}
function mergeSetting(base, local, remote) {
  const value = item => (Array.isArray(item) ? item : []);
  return sameValue(value(local), value(base)) ? value(remote) : value(local);
}
function mergeKeyedList(base, local, remote) {
  if (sameValue(local, remote) || sameValue(local, base)) return remote;
  if (sameValue(remote, base)) return local;
  const keyOf = item => (item && typeof item === 'object' ? clean(item.k || item.id || item.name) : '') || stableJson(item);
  const out = Array.isArray(remote) ? [...remote] : [];
  const seen = new Set(out.map(keyOf));
  for (const item of Array.isArray(local) ? local : []) { const key = keyOf(item); if (!seen.has(key)) { out.push(item); seen.add(key); } }
  return out;
}
function mergeCollectionWorkspaces(base, local, remote) {
  const conflicts = [];
  // Taban yoksa (eski sürümden kalan ayrışma) hiçbir satır silinmiş sayılmaz ve
  // aynı kimlik aynı model kabul edilir; farklı alanlar çakışma olarak döner.
  const hasBase = Boolean(base);
  const baseRows = rowsByKey(base && base.rows), localRows = rowsByKey(local && local.rows), remoteRows = rowsByKey(remote && remote.rows);
  const numericIds = [...baseRows.keys(), ...localRows.keys(), ...remoteRows.keys()].map(Number).filter(Number.isFinite);
  let nextId = Math.max(Number(local && local.nextId) || 1, Number(remote && remote.nextId) || 1, (numericIds.length ? Math.max(...numericIds) : 0) + 1);
  const rows = [];
  for (const r of Array.isArray(remote && remote.rows) ? remote.rows : []) {
    const key = mergeRowKey(r);
    const l = key ? localRows.get(key) : null, b = key ? baseRows.get(key) : null;
    if (!key || !l) {
      if (l == null && b && !sameValue(rowContent(b), rowContent(r))) {
        conflicts.push({ rowId: key, field: '_deleted', current: 'uzakta değiştirildi', incoming: 'yerelde silindi' });
        rows.push(r);
      } else if (!(l == null && b)) rows.push(r);
      continue;
    }
    if (hasBase && !b && !sameValue(rowContent(l), rowContent(r))) { rows.push(r); continue; } // kimlik çakışması: yerel satır aşağıda yeni kimlik alır
    const merged = mergeRowFields(b ? rowContent(b) : null, rowContent(l), rowContent(r), key, conflicts);
    merged._rev = sameValue(merged, rowContent(l)) ? mergeRowRevision(l) : Math.max(mergeRowRevision(l), mergeRowRevision(r)) + 1;
    rows.push(merged);
  }
  for (const l of Array.isArray(local && local.rows) ? local.rows : []) {
    const key = mergeRowKey(l);
    if (!key) continue;
    const r = remoteRows.get(key), b = baseRows.get(key);
    if (r) {
      if (hasBase && !b && !sameValue(rowContent(l), rowContent(r))) rows.push({ ...l, id: nextId++, _rev: mergeRowRevision(l) + 1 });
      continue;
    }
    if (b) {
      if (!sameValue(rowContent(b), rowContent(l))) {
        conflicts.push({ rowId: key, field: '_deleted', current: 'uzakta silindi', incoming: 'yerelde değiştirildi' });
        rows.push(l);
      }
      continue;
    }
    rows.push(l);
  }
  const workspace = {
    ...(remote || {}),
    rows,
    manufacturers: mergeKeyedList(base && base.manufacturers, local && local.manufacturers, remote && remote.manufacturers),
    customColumns: mergeKeyedList(base && base.customColumns, local && local.customColumns, remote && remote.customColumns),
    statusCatalog: mergeKeyedList(base && base.statusCatalog, local && local.statusCatalog, remote && remote.statusCatalog),
    // Owner-level setting: a local change since the merge base wins over an unchanged remote.
    lflCountryExclusions: mergeSetting(base && base.lflCountryExclusions, local && local.lflCountryExclusions, remote && remote.lflCountryExclusions),
    nextId,
    _revision: Math.max(Number(local && local._revision) || 0, Number(remote && remote._revision) || 0) + 1,
    _updatedAt: new Date().toISOString(),
  };
  return { workspace, conflicts };
}

function createCollectionReplication({ workspaces, permissions, getSharedSyncRoot = async () => '', stateFile = '', onTrace = null, onApplied = null, trialPolicy = require('./update-trial-backend').createTrialWritePolicy(), mergeUnderLeaseMaxBytes = MERGE_UNDER_LEASE_MAX_BYTES, getInstallationFingerprint = () => require('./installation-fingerprint').installationFingerprint() } = {}) {
  if (!workspaces || typeof workspaces.loadWorkspace !== 'function' || typeof workspaces.replaceWorkspaceReplica !== 'function') throw new Error('Collection workspace store is required.');
  if (!permissions || typeof permissions.accessLevel !== 'function') throw new Error('Collection permission store is required.');
  const trace = (event, detail) => { try { if (typeof onTrace === 'function') onTrace(event, detail); } catch (_) {} };
  const statePath = clean(stateFile);
  let volatileState = { version: REPLICATION_STATE_VERSION, owners: {} };
  const volatileBases = new Map();
  const remoteStamps = new Map();
  // A remote envelope and its local merge base belong to one operation. Without
  // this owner-local queue a concurrent publisher can advance the base while an
  // older pull is suspended, making new accepted fields look unchanged.
  const ownerOperations = new Map();
  function withOwnerOperation(ownerId, operation) {
    const key = clean(ownerId);
    const previous = ownerOperations.get(key) || Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.catch(() => {});
    ownerOperations.set(key, tail);
    void tail.then(() => { if (ownerOperations.get(key) === tail) ownerOperations.delete(key); });
    return result;
  }
  function normalizeState(raw) {
    return {
      version: REPLICATION_STATE_VERSION,
      ...(raw && clean(raw.installationId) ? { installationId: clean(raw.installationId), installationFingerprint: clean(raw.installationFingerprint) } : {}),
      owners: raw && raw.owners && typeof raw.owners === 'object' && !Array.isArray(raw.owners) ? raw.owners : {},
    };
  }
  /* KURULUM KİMLİĞİ: yayım kapsama haritasının anahtarı. Bu kurulumun durum
     dosyasında kalıcıdır ve bilgisayar + kullanıcı parmak izine bağlıdır: veri
     klasörü başka bir bilgisayara kopyalanırsa yeni kimlik üretilir, iki
     kurulum aynı girdiyi paylaşmaz. Kimlik değişince eski bekleyen yayım
     kapsanmamış görünür ve temkinli tabanla birleşir (kayıp yok). */
  let installationIdValue = '';
  async function installationId() {
    if (installationIdValue) return installationIdValue;
    let fingerprint = '';
    try { fingerprint = clean(getInstallationFingerprint()); } catch (_) {}
    const ensure = async () => {
      const state = await readState();
      if (!state.installationId || (fingerprint && state.installationFingerprint && state.installationFingerprint !== fingerprint)) {
        state.installationId = crypto.randomUUID();
        state.installationFingerprint = fingerprint;
        if (statePath) await writeJson(statePath, state); else volatileState = state;
      }
      return state.installationId;
    };
    installationIdValue = statePath ? await withFileLeaseAsync(statePath, ensure) : await ensure();
    return installationIdValue;
  }
  async function readState() {
    if (!statePath) return normalizeState(volatileState);
    try { return normalizeState(JSON.parse(await fsp.readFile(statePath, 'utf8'))); }
    catch (error) { if (error && error.code === 'ENOENT') return normalizeState(null); throw error; }
  }
  async function updateOwnerState(ownerId, patch) {
    const key = safeId(ownerId);
    const update = async () => {
      const state = await readState();
      const current = state.owners[key] || {};
      const next = typeof patch === 'function' ? patch(current) : patch;
      state.owners[key] = { ...current, ...next, ownerId: clean(ownerId), updatedAt: new Date().toISOString() };
      if (statePath) await writeJson(statePath, state); else volatileState = state;
      return state.owners[key];
    };
    return statePath ? withFileLeaseAsync(statePath, update) : update();
  }
  async function ownerState(ownerId) { return (await readState()).owners[safeId(ownerId)] || null; }
  async function recordConflict(ownerId, error, detail = {}) {
    try {
      return await updateOwnerState(ownerId, {
        state: Number(error && error.statusCode) === 409 ? 'conflict' : 'error',
        code: error.code || 'COLLECTION_REPLICA_CONFLICT', message: error.message,
        ...detail,
      });
    } catch (stateError) {
      trace('COLLECTION_REPLICA_STATE_FAILED', { ownerId: clean(ownerId), error: stateError && stateError.message });
      return null;
    }
  }
  /* Taban: bu cihazın gördüğü son uzak kopya. Üç yönlü birleşim için içerik
     saklanır; özet (baseWorkspaceSha256) tutmazsa taban yok sayılır. */
  function baseFile(ownerId) { return statePath ? path.join(`${statePath}.bases`, `${safeId(ownerId)}.json`) : ''; }
  async function readBaseSnapshot(ownerId, expectedSha256) {
    if (!clean(expectedSha256)) return null;
    let value = null;
    const file = baseFile(ownerId);
    if (!file) value = volatileBases.has(safeId(ownerId)) ? JSON.parse(volatileBases.get(safeId(ownerId))) : null;
    else { try { value = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (_) { value = null; } }
    return value && checksum(value) === expectedSha256 ? value : null;
  }
  async function writeBaseSnapshot(ownerId, workspace) {
    const file = baseFile(ownerId);
    if (!file) { volatileBases.set(safeId(ownerId), JSON.stringify(workspace)); return; }
    if (await readBaseSnapshot(ownerId, checksum(workspace))) return;
    await writeJson(file, workspace);
  }
  /* Bekleyen yayım tabanları. Yayım kirası altında yeni bir tam kopya yazmak
     büyük zarfta kirayı uzatırdı: CAS doğrulanmış tabanın dosyası yalnız
     yeniden adlandırılır (yayımdan sonra normal taban zaten yeniden yazılır).
     Okuma içerik özetiyle yapılır ve üç dosyaya da bakar: yeniden adlandırma
     kesilmiş olsa bile doğru içerik bulunur; bulunamazsa taban yok sayılır
     (iki yönlü birleşim: satır düşmez, farklı alan çakışma olur). */
  function pendingFirstFile(ownerId) { return statePath ? path.join(`${statePath}.bases`, `${safeId(ownerId)}.pending-first.json`) : ''; }
  function pendingLogFile(ownerId) { return statePath ? path.join(`${statePath}.bases`, `${safeId(ownerId)}.pending-log.jsonl`) : ''; }
  async function readPendingFirst(ownerId, expectedSha256) {
    const sha = clean(expectedSha256);
    if (!sha) return null;
    if (!statePath) {
      for (const key of [`${safeId(ownerId)}.pending-first`, safeId(ownerId)]) {
        const raw = volatileBases.get(key);
        const value = raw ? JSON.parse(raw) : null;
        if (value && checksum(value) === sha) return value;
      }
      return null;
    }
    // Yeniden adlandırma kesilmiş olabilir: taban dosyası hâlâ o içerikte olabilir.
    for (const file of [pendingFirstFile(ownerId), baseFile(ownerId)]) {
      try {
        const value = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (checksum(value) === sha) return value;
      } catch (_) {}
    }
    return null;
  }
  async function readPendingLog(ownerId) {
    let raw = '';
    if (!statePath) raw = volatileBases.get(`${safeId(ownerId)}.pending-log`) || '';
    else { try { raw = await fsp.readFile(pendingLogFile(ownerId), 'utf8'); } catch (_) { raw = ''; } }
    const entries = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { const entry = JSON.parse(line); if (entry && clean(entry.id) && entry.delta) entries.push(entry); }
      catch (_) { break; } // yarım kalmış son satır: önceki kayıtlar geçerli
    }
    return entries;
  }
  async function appendPendingLog(ownerId, entry, { reset = false } = {}) {
    const line = `${JSON.stringify(entry)}\n`;
    if (!statePath) {
      const key = `${safeId(ownerId)}.pending-log`;
      volatileBases.set(key, (reset ? '' : volatileBases.get(key) || '') + line);
      return;
    }
    const file = pendingLogFile(ownerId);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    if (reset) await writeTextAtomic(file, line);
    else await fsp.appendFile(file, line, 'utf8');
  }
  async function writeTextAtomic(file, text) {
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try { await fsp.writeFile(temporary, text, 'utf8'); await replaceFileWithRetry(temporary, file, { attempts: 8, baseDelayMs: 20 }); }
    finally { await fsp.unlink(temporary).catch(() => {}); }
  }
  async function moveBaseToPendingFirst(ownerId) {
    if (!statePath) {
      const raw = volatileBases.get(safeId(ownerId));
      if (raw) volatileBases.set(`${safeId(ownerId)}.pending-first`, raw);
      return;
    }
    try { await replaceFileWithRetry(baseFile(ownerId), pendingFirstFile(ownerId), { attempts: 4, baseDelayMs: 20 }); }
    catch (error) { trace('COLLECTION_REPLICA_PENDING_BASE_FAILED', { ownerId: clean(ownerId), error: error && (error.code || error.message) }); }
  }
  async function dropPendingBases(ownerId) {
    if (!statePath) { volatileBases.delete(`${safeId(ownerId)}.pending-first`); volatileBases.delete(`${safeId(ownerId)}.pending-log`); return; }
    for (const file of [pendingFirstFile(ownerId), pendingLogFile(ownerId)]) await fsp.unlink(file).catch(() => {});
  }
  /* Uzak kopyanın kapsadığı bekleyen yayımın tam durumu = ilk taban + o
     yayıma kadarki farklar. Kapsanan yayım listede yoksa ilk taban. */
  async function pendingBaseFor(owner, state, coveredId) {
    // İlk yayım (uzak kopya yokken) zinciri boş durumdan başlatır: taban,
    // boş çalışma alanına farklar uygulanarak kesin kurulur.
    const first = state && state.pendingFromEmpty ? {} : await readPendingFirst(owner, state && state.pendingFirstBaseSha256);
    if (!first || !coveredId || (state && state.pendingChainBroken)) return state && state.pendingFromEmpty ? null : first;
    const entries = await readPendingLog(owner);
    const index = entries.findIndex(entry => clean(entry.id) === coveredId);
    if (index < 0) return first;
    let workspace = first;
    for (const entry of entries.slice(0, index + 1)) workspace = applyWorkspaceDelta(workspace, entry.delta);
    return workspace;
  }
  async function mergeBaseFor(owner, envelope) {
    const state = await ownerState(owner);
    const me = await installationId();
    if (publicationDisplaced(state, envelope, me)) {
      const coveredId = coveredPublicationId(envelope, me) || clean(envelope && envelope.parentSha256);
      trace('COLLECTION_REPLICA_PUBLICATION_DISPLACED', { ownerId: owner, remoteSha256: envelopeIdentity(envelope), coveredSha256: coveredId || null });
      return { base: await pendingBaseFor(owner, state, coveredId), displaced: true };
    }
    return { base: await readBaseSnapshot(owner, state && state.baseWorkspaceSha256), displaced: false };
  }
  const PRESERVED_PER_OWNER = 5;
  async function preserveReadOnlyLocal(owner, local) {
    if (!statePath || !local || local.initialized === false) return null;
    const dir = `${statePath}.readonly-preserved`, prefix = `${safeId(owner)}-`;
    const file = path.join(dir, `${prefix}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`);
    await writeJson(file, { version: 1, ownerId: owner, preservedAt: new Date().toISOString(), reason: 'READ_ONLY_ADOPTED', workspace: local });
    trace('COLLECTION_REPLICA_LOCAL_PRESERVED', { ownerId: owner, file: path.basename(file) });
    try {
      const old = (await fsp.readdir(dir)).filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
      for (const name of old.slice(0, Math.max(0, old.length - PRESERVED_PER_OWNER))) await fsp.unlink(path.join(dir, name)).catch(() => {});
    } catch (_) {}
    return file;
  }
  async function recordBase(ownerId, envelope, state = 'up-to-date', detail = {}) {
    try { await writeBaseSnapshot(ownerId, envelope.workspace); }
    catch (error) { trace('COLLECTION_REPLICA_BASE_FAILED', { ownerId: clean(ownerId), error: error && error.message }); }
    const baseWorkspaceSha256 = checksum(envelope.workspace);
    const me = await installationId();
    // Bekleyen yayım yalnız onu kapsayan bir halefle onaylanır; kendi dosyasını
    // yeniden görmek onay değildir (geç yerinden edilme).
    let cleared = false;
    const result = await updateOwnerState(ownerId, current => {
      const next = {
        state, code: null, message: null,
        baseEnvelopeSha256: envelopeIdentity(envelope),
        baseWorkspaceSha256,
        remoteRevision: Number(envelope.workspace && envelope.workspace._revision) || 0,
        ...(publicationConfirmed(current, envelope, me) ? CLEAR_PENDING_PUBLICATIONS : {}),
        ...detail,
      };
      cleared = hasPendingPublication(current) && !hasPendingPublication({ ...current, ...next });
      return next;
    });
    if (cleared) await dropPendingBases(ownerId);
    return result;
  }
  function conflictError(code, message, detail = {}) {
    return Object.assign(new Error(message), { code, statusCode: 409, ...detail });
  }
  async function status(ownerId) {
    const owner = clean(ownerId);
    const current = await ownerState(owner);
    if (!current) return { ok: true, ownerId: owner, state: 'unknown' };
    const conflict = current.state === 'conflict' || current.state === 'error';
    const mergeConflicts = openMergeConflicts(current).length;
    const mergeMessage = mergeConflicts
      ? `Başka bir kullanıcı aynı alanları eşzamanlı değiştirdi; ${mergeConflicts} alanda önce kaydedilen değer korundu. Sizin değerleriniz Senkron çakışmalarında bekliyor.`
      : null;
    return {
      ok: !conflict, ownerId: owner, state: current.state || 'unknown', code: current.code || null,
      message: current.message || mergeMessage, mergeConflicts, remoteRevision: Number(current.remoteRevision) || 0,
      localRevision: Number(current.localRevision) || 0, updatedAt: current.updatedAt || null,
    };
  }
  async function root() { return clean(await getSharedSyncRoot()); }
  function openMergeConflicts(ownerStateValue) {
    return (ownerStateValue && Array.isArray(ownerStateValue.mergeConflicts) ? ownerStateValue.mergeConflicts : []).filter(item => item && !item.resolved);
  }
  async function recordMergeConflicts(owner, conflicts) {
    if (!conflicts.length) return;
    const at = new Date().toISOString();
    const items = conflicts.map(item => ({
      conflictId: `collection:${crypto.randomUUID()}`, type: 'collection-field', ownerId: owner,
      id: `collection:${owner}:${item.rowId}`, rowId: item.rowId, field: item.field,
      current: item.current, incoming: item.incoming, at, resolved: false,
      ...(item.mapEntries || item.mapDeletes ? { mapEntries: item.mapEntries || {}, mapDeletes: item.mapDeletes || [] } : {}),
    }));
    await updateOwnerState(owner, current => ({ mergeConflicts: [...openMergeConflicts(current), ...items].slice(-200) }));
  }
  async function listMergeConflicts(ownerIds) {
    const state = await readState();
    const allowed = new Set((Array.isArray(ownerIds) ? ownerIds : []).map(safeId));
    return Object.entries(state.owners).filter(([key]) => allowed.has(key)).flatMap(([, value]) => openMergeConflicts(value));
  }
  /* choice 'incoming': kaybeden (bu cihazdaki) değer bilinçli olarak yeniden
     yazılır; yazmayı çağıran yapar (yetki + satır revizyonu sunucuda denetlenir).
     'current': korunmuş değer kalır. */
  async function resolveMergeConflict(conflictId, choice, apply) {
    trialPolicy.assertConfirmed();
    const id = clean(conflictId);
    const state = await readState();
    const entry = Object.values(state.owners).find(value => openMergeConflicts(value).some(item => item.conflictId === id));
    if (!entry) throw Object.assign(new Error('Koleksiyon çakışması bulunamadı.'), { code: 'COLLECTION_CONFLICT_NOT_FOUND', statusCode: 404 });
    const conflict = openMergeConflicts(entry).find(item => item.conflictId === id);
    if (choice === 'incoming' && typeof apply === 'function') await apply(conflict);
    await updateOwnerState(entry.ownerId, current => ({
      mergeConflicts: (Array.isArray(current.mergeConflicts) ? current.mergeConflicts : []).map(item => item.conflictId === id
        ? { ...item, resolved: true, resolvedAt: new Date().toISOString(), resolution: choice === 'incoming' ? 'incoming' : 'current' }
        : item).filter(item => !item.resolved || item.conflictId === id).slice(-200),
    }));
    return { ...conflict, resolved: true, resolution: choice === 'incoming' ? 'incoming' : 'current' };
  }
  /* Ayrışan kopyayı son ortak tabanla birleştirir, yerel olarak yazar (yerel
     kopya bu arada değiştiyse yazmaz) ve birleşik kopyayı yayımlar. Taban
     yoksa (eski sürümde ayrışmış kopya) iki yönlü birleşim yapılır: satırların
     hiçbiri düşmez, farklı alanlarda uzak değer kalır ve yerel değer çakışma
     olarak saklanır. Kopyalar kalıcı ayrışmada takılı kalmaz. */
  async function reconcile(owner, envelope, { readOnly = false } = {}) {
    if (!envelope) return null;
    if (readOnly) {
      // İzleyicinin meşru yerel değişikliği olamaz: ayrışan kopya önbellektir,
      // uzak kopya benimsenir (birleştirip yayımlamak silinmiş satırları geri getirirdi).
      const local = workspaces.loadWorkspace(owner);
      // İzleyiciye düşürülmüş eski düzenleyicinin yayımlanmamış yerel kopyası
      // yayımlanmaz ama sessizce de yok edilmez: önce yerel kurtarma dosyasına
      // alınır. Kopya yazılamazsa benimseme yapılmaz (kayıp yerine bayat önbellek).
      const ownerStateValue = await ownerState(owner);
      if (!(ownerStateValue && ownerStateValue.baseWorkspaceSha256 === checksum(local))) {
        try { await preserveReadOnlyLocal(owner, local); }
        catch (error) {
          trace('COLLECTION_REPLICA_LOCAL_PRESERVE_FAILED', { ownerId: owner, error: error && (error.code || error.message) });
          return { synced: false, merged: false, ownerId: owner, reason: 'LOCAL_PRESERVE_FAILED', conflict: true };
        }
      }
      const write = await workspaces.replaceWorkspaceReplica(owner, envelope.workspace, { expectedSha256: checksum(local), force: true });
      if (!write || !write.applied) return { synced: false, merged: false, ownerId: owner, reason: 'LOCAL_CHANGED_DURING_MERGE', conflict: true };
      await recordBase(owner, envelope);
      return { synced: true, merged: false, ownerId: owner, revision: Number(envelope.workspace && envelope.workspace._revision) || 0, reason: 'READ_ONLY_ADOPTED' };
    }
    const { base, displaced } = await mergeBaseFor(owner, envelope);
    const local = workspaces.loadWorkspace(owner);
    const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, envelope.workspace);
    const write = await workspaces.replaceWorkspaceReplica(owner, workspace, { expectedSha256: checksum(local) });
    if (!write || !write.applied) {
      await recordConflict(owner, conflictError('COLLECTION_REPLICA_CONCURRENT_CHANGE', 'Koleksiyon birleştirilirken yerel kopya değişti; bir sonraki senkronda yeniden denenecek.'));
      return { synced: false, merged: false, ownerId: owner, reason: 'LOCAL_CHANGED_DURING_MERGE', conflict: true };
    }
    // Yerinden edilen yayımın düzenlemeleri artık yerelde, yeni uzak tabanın
    // üstünde duruyor: bekleyen yayım kaydı işini bitirdi.
    await recordBase(owner, envelope, 'up-to-date', displaced ? CLEAR_PENDING_PUBLICATIONS : {});
    await recordMergeConflicts(owner, conflicts);
    trace('COLLECTION_REPLICA_MERGED', { ownerId: owner, revision: workspace._revision, conflicts: conflicts.length });
    let publication = null, publishError = null;
    try { publication = await publishOwnerCas(owner); }
    catch (error) { publishError = error; }
    return {
      synced: true, merged: true, ownerId: owner, revision: workspace._revision, conflicts: conflicts.length,
      published: Boolean(publication && publication.published), reason: publishError ? publishError.code || 'PUBLISH_FAILED' : 'MERGED',
      ...(publishError ? { ok:false, publicationPending:true, state:'error', code:publishError.code || 'PUBLISH_FAILED', message:publishError.message } : {}),
    };
  }
  /* CAS YARIŞI. Birleşim uzak kopya kirası dışında hesaplanır; aynı anda
     başka bir cihaz yayımlarsa birleşik kopyanın CAS denetimi düşer. Eskiden
     bu kopya bir sonraki 5 sn'lik yoklamayı bekliyor, kaydeden kullanıcıya
     sahte "aynı revizyonda farklı kopya" hatası dönüyor ve K eşzamanlı yazar
     her turda yalnız bir kazananla K turda yakınsıyordu (ölçüm: 20 kurulum,
     12 yazar → 10 tur). Yarışı kaybeden birleşim bir kez, güncel uzak kopyayla
     kira ALTINDA yeniden yapılır: her kira sırası bir yayım üretir. Düşük
     çekişmeli normal yol değişmez. Kilit zaman aşımı (SHARED_WRITE_BUSY),
     bozuk uzak kopya ve bu arada değişen yerel kopya beklemede kalır. */
  async function reconcileUntilPublished(owner, envelope, options = {}) {
    const result = await reconcile(owner, envelope, options);
    if (!(result && result.merged && result.publicationPending && CAS_RACE_CODES.has(result.code))) return result;
    try {
      const sharedRoot = await root();
      const size = sharedRoot ? (await fsp.stat(remoteWorkspaceFile(sharedRoot, owner)).catch(() => null)) : null;
      if (!size || size.size > mergeUnderLeaseMaxBytes) {
        trace('COLLECTION_REPLICA_MERGE_UNDER_LEASE_SKIPPED', { ownerId: owner, bytes: size ? size.size : null });
        return result;
      }
      const publication = await publishOwnerCas(owner, { mergeUnderLease: true });
      return {
        synced: true, merged: true, ownerId: owner, revision: Number(publication.revision) || result.revision,
        conflicts: (Number(result.conflicts) || 0) + (Number(publication.conflicts) || 0),
        published: Boolean(publication.published), reason: 'MERGED',
      };
    } catch (error) {
      return { ...result, code: error.code || result.code, reason: error.code || result.reason, message: error.message || result.message };
    }
  }
  /* YAYIM YETKİSİ. Canlı yoklama izin önbelleğini tazelemez. Sahibi olmadığı
     bir Koleksiyonun yayımlanmamış yerel değişikliği yayımlanmadan (ya da
     birleştirilip yayımlanmadan) önce erişim ortak izin belgesinden yeniden
     doğrulanır: erişimi geri alınmış veya izleyiciye düşürülmüş bir
     düzenleyicinin eski önbellek yetkisiyle çevrimdışı yaptığı yazım sahibin
     kopyasına ulaşmaz. Yalnız yayım gerekirken çalışır; güncel kopyada ek
     okuma yoktur. İzin belgesi okunamazsa yayım bekletilir (fail-closed). */
  async function confirmPublishAccess(user, owner) {
    if (user === owner || typeof permissions.sync !== 'function') return permissions.accessLevel(user, owner);
    try { await permissions.sync(); }
    catch (_) {
      throw Object.assign(new Error('Koleksiyon yetkisi ortak klasörden doğrulanamadı; yerel değişiklik yayımlanmadı. / Collection access could not be verified from the shared folder; the local change was not published.'), { code: 'COLLECTION_ACCESS_UNVERIFIED', statusCode: 503 });
    }
    return permissions.accessLevel(user, owner);
  }
  function publishOwner(ownerId) {
    return withOwnerOperation(ownerId, () => publishOwnerInternal(ownerId));
  }
  async function publishOwnerInternal(ownerId) {
    trialPolicy.assertConfirmed();
    try { return await publishOwnerCas(ownerId); }
    catch (error) {
      // Local acceptance can precede a failed publish. Restoring the exact old
      // envelope need not change its stamp: the next live poll must still retry.
      remoteStamps.delete(clean(ownerId));
      if (Number(error && error.statusCode) !== 409) throw error;
      const owner = clean(ownerId), sharedRoot = await root();
      const envelope = sharedRoot ? await readEnvelope(remoteWorkspaceFile(sharedRoot, owner), owner) : null;
      const merged = await reconcileUntilPublished(owner, envelope);
      if (!merged || !merged.merged) throw error;
      return merged;
    }
  }
  /* Kira altında birleşim (yalnız CAS yarışını kaybeden birleşimin tek
     yedek denemesi). Taban, bu cihazın son birleştirdiği uzak kopyadır; yerel
     kopya bu arada değiştiyse yazılmaz ve yayım beklemede kalır. Kilit sırası
     hub → yerel çalışma alanı → replikasyon durumu; ters yön yoktur. */
  async function mergeWithinLease(owner, current) {
    const { base, displaced } = await mergeBaseFor(owner, current);
    const local = workspaces.loadWorkspace(owner);
    const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, current.workspace);
    const write = await workspaces.replaceWorkspaceReplica(owner, workspace, { expectedSha256: checksum(local) });
    const changed = () => conflictError('COLLECTION_REPLICA_CONCURRENT_CHANGE', 'Koleksiyon birleştirilirken yerel kopya değişti; bir sonraki senkronda yeniden denenecek.', { ownerId: owner });
    if (!write || !write.applied) throw changed();
    // reconcile() ile aynı sıra: birleşim yerelde yazıldığı anda taban ve
    // çakışmalar kaydedilir. Ardından hub yazımı düşerse kaybeden yerel değer
    // çakışma kaydında kalır ve sonraki senkron doğru tabanla devam eder.
    await recordBase(owner, current, 'up-to-date', displaced ? CLEAR_PENDING_PUBLICATIONS : {});
    await recordMergeConflicts(owner, conflicts);
    // Yayımlanan kopya yerel deponun gerçek içeriğidir. Birleşimin üzerine
    // eklenmiş yerel kayıt (daha yüksek revizyon) onun soyundandır; daha düşük
    // revizyon birleşimin yazılmadığını gösterir ve yayımlanmaz.
    const reloaded = workspaces.loadWorkspace(owner);
    if ((Number(reloaded && reloaded._revision) || 0) < (Number(workspace && workspace._revision) || 0)) throw changed();
    return { workspace: reloaded, conflicts };
  }
  /* Hub yazımından ÖNCE kaydedilir: yazım düşerse bekleyen kayıt, uzak kopyayı
     yayımdan önceki tabanla birleştirtir (o taban zaten uzak kopyadır) ve
     kesilen yayımın düzenlemesi kaybolmaz. İlk bekleyen yayımda CAS
     doğrulanmış taban dosyası ilk taban olur (yeniden adlandırma, tam yazım
     yok); sonraki her yayım yalnız küçük farkını günlüğe ekler. */
  async function markPendingPublication(owner, current, identity, workspace) {
    const prior = await ownerState(owner) || {};
    const fresh = !hasPendingPublication(prior);
    if (fresh) {
      const baseMatchesCurrent = Boolean(current && prior.baseEnvelopeSha256 === envelopeIdentity(current) && clean(prior.baseWorkspaceSha256));
      let firstSha = null;
      if (current && !baseMatchesCurrent) {
        if (statePath) await writeJson(pendingFirstFile(owner), current.workspace);
        else volatileBases.set(`${safeId(owner)}.pending-first`, JSON.stringify(current.workspace));
        firstSha = checksum(current.workspace);
      } else if (current) firstSha = clean(prior.baseWorkspaceSha256);
      await appendPendingLog(owner, { id: identity, delta: workspaceDelta(current ? current.workspace : null, workspace) }, { reset: true });
      await updateOwnerState(owner, { pendingLatest: identity, pendingFirstBaseSha256: firstSha, pendingFromEmpty: current ? null : true, pendingChainBroken: null });
      if (baseMatchesCurrent) await moveBaseToPendingFirst(owner);
      return;
    }
    // Zincir yalnız kendi son yayımımızın üstüne uzar. Aksi (beklenmeyen) durumda
    // farklar artık o zinciri temsil etmez: ilk tabana düşülür (temkinli).
    const chained = Boolean(current) && envelopeIdentity(current) === clean(prior.pendingLatest);
    if (chained) await appendPendingLog(owner, { id: identity, delta: workspaceDelta(current.workspace, workspace) });
    await updateOwnerState(owner, { pendingLatest: identity, ...(chained ? {} : { pendingChainBroken: true }) });
  }
  async function publishOwnerCas(ownerId, { mergeUnderLease = false } = {}) {
    const owner = clean(ownerId); if (!owner) throw Object.assign(new Error('Koleksiyon sahibi zorunludur.'), { code: 'COLLECTION_OWNER_REQUIRED' });
    const sharedRoot = await root();
    if (!sharedRoot) return { published: false, reason: 'not-configured' };
    let workspace = workspaces.loadWorkspace(owner);
    let localRevision = Number(workspace && workspace._revision) || 0;
    const localWorkspaceSha256 = checksum(workspace);
    const target = remoteWorkspaceFile(sharedRoot, owner);
    let published = true;
    let reason = null;
    let publishedEnvelope = null;
    let merge = null;
    try {
      await withFileLeaseAsync(target, async () => {
        const current = await readEnvelope(target, owner);
        if (current) {
          const remoteRevision = Number(current.workspace && current.workspace._revision) || 0;
          let race = null;
          if (remoteRevision > localRevision) {
            race = conflictError('COLLECTION_REPLICA_STALE', 'Uzak Koleksiyon kopyası yerel kopyadan daha yeni.', { ownerId: owner, localRevision, remoteRevision });
          } else if (remoteRevision === localRevision) {
            if (checksum(current.workspace) === localWorkspaceSha256) {
              published = false;
              reason = 'UP_TO_DATE';
              publishedEnvelope = current;
              return;
            }
            race = conflictError('COLLECTION_REPLICA_CONFLICT', 'Aynı revizyonda farklı Koleksiyon kopyaları bulundu.', { ownerId: owner, revision: localRevision });
          } else {
            // A larger local revision is not proof of ancestry: another offline
            // device may simply have produced more edits. The last envelope hash
            // observed by THIS device must still be the remote head (CAS).
            const base = await ownerState(owner);
            if (!base || base.baseEnvelopeSha256 !== envelopeIdentity(current)) {
              race = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Yerel Koleksiyon kopyasının uzak sürümden türediği doğrulanamadı.', {
                ownerId: owner, localRevision, remoteRevision, remoteSha256: envelopeIdentity(current),
              });
            }
          }
          if (race) {
            if (!mergeUnderLease) throw race;
            merge = await mergeWithinLease(owner, current);
            workspace = merge.workspace;
            localRevision = Number(workspace && workspace._revision) || 0;
          }
        }
        const envelope = { version: REPLICATION_VERSION, ownerId: owner, parentSha256: current ? envelopeIdentity(current) : null, workspace };
        envelope.sha256 = envelopeChecksum(envelope);
        envelope.chainSha256 = envelopeChainChecksum(envelope);
        envelope.heads = nextHeads(current, await installationId(), envelope.chainSha256);
        envelope.headsSha256 = envelopeHeadsChecksum(envelope);
        // Hub yazımından ÖNCE: yazım düşerse bekleyen kayıt, uzak kopyayı
        // yayımdan önceki tabanla birleştirtir (o taban zaten uzak kopyadır).
        await markPendingPublication(owner, current, envelopeIdentity(envelope), workspace);
        await writeJson(target, envelope);
        publishedEnvelope = envelope;
      });
    } catch (error) {
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, reason: error.code || 'PUBLISH_FAILED', localRevision, remoteRevision: error.remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision: error.remoteRevision });
      throw error;
    }
    await recordBase(owner, publishedEnvelope);
    if (merge) {
      trace('COLLECTION_REPLICA_MERGED', { ownerId: owner, revision: localRevision, conflicts: merge.conflicts.length, underLease: true });
    }
    if (!published) return { published: false, ownerId: owner, revision: localRevision, reason, state: 'up-to-date' };
    trace('COLLECTION_REPLICA_PUBLISHED', { ownerId: owner, revision: localRevision });
    return { published: true, ownerId: owner, revision: localRevision, sha256: envelopeIdentity(publishedEnvelope), parentSha256: publishedEnvelope.parentSha256, ...(merge ? { merged: true, conflicts: merge.conflicts.length } : {}) };
  }
  async function syncOwnerInternal(userId, ownerId) {
    const user = clean(userId), owner = clean(ownerId);
    const level = permissions.accessLevel(user, owner);
    const readOnly = user !== owner && level !== 'edit';
    if (!level) throw Object.assign(new Error('Bu Koleksiyon sayfasına erişim yetkiniz bulunmuyor.'), { code: 'COLLECTION_ACCESS_DENIED', statusCode: 403 });
    if(!trialPolicy.isConfirmed())return {synced:false,paused:true,ownerId:owner,reason:'UPDATE_TRIAL_VERIFYING'};
    const sharedRoot = await root();
    if (!sharedRoot) return { synced: false, reason: 'not-configured' };
    const source = remoteWorkspaceFile(sharedRoot, owner);
    const envelope = await readEnvelope(source, owner);
    if (!envelope) return { synced: false, reason: 'not-published' };
    const local = workspaces.loadWorkspace(owner);
    const localRevision = Number(local && local._revision) || 0;
    const remoteRevision = Number(envelope.workspace && envelope.workspace._revision) || 0;
    const localWorkspaceSha256 = checksum(local);
    const remoteWorkspaceSha256 = checksum(envelope.workspace);
    const base = await ownerState(owner);
    // Aşağıdaki üç dal yerel değişikliği yayımlayabilir: sahibi olmayan
    // düzenleyicinin yetkisi önce ortak izin belgesinden doğrulanır.
    let publishReadOnly = readOnly;
    const authorizePublication = async () => {
      if (publishReadOnly || user === owner) return;
      const confirmed = await confirmPublishAccess(user, owner);
      if (!confirmed) {
        trace('COLLECTION_REPLICA_ACCESS_REVOKED', { ownerId: owner, userId: user });
        throw Object.assign(new Error('Bu Koleksiyon sayfasına erişim yetkiniz bulunmuyor.'), { code: 'COLLECTION_ACCESS_DENIED', statusCode: 403 });
      }
      if (confirmed !== 'edit') publishReadOnly = true;
    };
    if (localRevision === remoteRevision) {
      const sameContent = localWorkspaceSha256 === remoteWorkspaceSha256;
      if (sameContent) {
        await recordBase(owner, envelope);
        return { synced: false, ownerId: owner, revision: localRevision, reason: 'UP_TO_DATE', state: 'up-to-date' };
      }
      // Revision alone is not a conflict token: two offline devices can both
      // produce revision N with different edits. Replacing either copy here
      // silently loses data, so keep the local copy and surface a deterministic
      // conflict for recovery/merge tooling.
      await authorizePublication();
      const merged = await reconcileUntilPublished(owner, envelope, { readOnly: publishReadOnly });
      if (merged) return merged;
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason: 'EQUAL_REVISION_DIVERGED', revision: localRevision });
      await recordConflict(owner, conflictError('COLLECTION_REPLICA_CONFLICT', 'Aynı revizyonda farklı Koleksiyon kopyaları bulundu.'), { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'EQUAL_REVISION_DIVERGED', conflict: true };
    }
    if (localRevision > remoteRevision) {
      await authorizePublication();
      if (!publishReadOnly && base && base.baseEnvelopeSha256 === envelopeIdentity(envelope)) {
        // A previous process may have committed locally and crashed before the
        // remote publish. The CAS base proves this is a real descendant, so a
        // normal GET/sync can safely finish the interrupted publication.
        const publication = await publishOwnerInternal(owner);
        return { synced: Boolean(publication.merged), ...(publication.merged ? { merged:true } : {}), published: Boolean(publication.published), ownerId: owner, revision: Number(publication.revision) || localRevision, reason: publication.reason || 'LOCAL_NEWER_PUBLISHED' };
      }
      const merged = await reconcileUntilPublished(owner, envelope, { readOnly: publishReadOnly });
      if (merged) return merged;
      const error = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Daha yeni yerel Koleksiyon kopyasının uzak sürümden türediği doğrulanamadı.');
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason:'LOCAL_NEWER_DIVERGED', localRevision, remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'LOCAL_NEWER_DIVERGED', conflict: true };
    }
    const pristineLocal = localRevision === 0 && local && local.initialized === false;
    // Yerinden edilmiş yayımda taban kendi yayımımızdır: yerel kopya "değişmemiş"
    // görünür ama düzenlemeleri uzak kopyada yoktur. Körlemesine benimseme kayıptır.
    const localUnchangedSinceBase = Boolean(base && base.baseWorkspaceSha256 === localWorkspaceSha256) && !publicationDisplaced(base, envelope, await installationId());
    if (!pristineLocal && !localUnchangedSinceBase) {
      await authorizePublication();
      const merged = await reconcileUntilPublished(owner, envelope, { readOnly: publishReadOnly });
      if (merged) return merged;
      const error = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Uzak Koleksiyon daha yeni ancak yerel kopyada da yayımlanmamış değişiklikler var.');
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason:'REMOTE_NEWER_LOCAL_DIRTY', localRevision, remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'REMOTE_NEWER_LOCAL_DIRTY', conflict: true };
    }
    // The local file can change while the pull awaits its lease. Revision alone
    // cannot protect that newer write when the remote revision is equal/higher.
    const result = await workspaces.replaceWorkspaceReplica(owner, envelope.workspace, { expectedSha256: localWorkspaceSha256 });
    if (result.applied) await recordBase(owner, envelope);
    else if (result.reason === 'LOCAL_NEWER' || result.reason === 'LOCAL_CHANGED') {
      const error = conflictError('COLLECTION_REPLICA_CONCURRENT_CHANGE', 'Koleksiyon senkronizasyonu sırasında yerel kopya değişti.');
      await recordConflict(owner, error, { localRevision: Number(result.workspace && result.workspace._revision) || localRevision, remoteRevision });
    }
    trace('COLLECTION_REPLICA_SYNCED', { ownerId: owner, userId: user, applied: result.applied, reason: result.reason || null });
    return { synced: Boolean(result.applied), ownerId: owner, revision: result.workspace && result.workspace._revision, reason: result.reason || null, conflict: result.reason === 'LOCAL_NEWER' || result.reason === 'LOCAL_CHANGED' };
  }
  async function syncOwner(userId, ownerId) {
    const result = await withOwnerOperation(ownerId, () => syncOwnerInternal(userId, ownerId));
    // Reads can import a replica before the periodic poll sees its stamp.
    // Notify at the actual application boundary, whichever caller imported it.
    if (typeof onApplied === 'function' && result && (result.synced || result.merged || result.published)) await onApplied(result);
    return result;
  }
  /* Canlı görünürlük: uzak kopya dosyası değişmediyse (mtime+boyut) okunmaz;
     değiştiyse eşitlenir. Uygulanan/birleşen sahipler döner. */
  async function pollOwners(userId, ownerIds) {
    if(!trialPolicy.isConfirmed())return [];
    const sharedRoot = await root();
    if (!sharedRoot) return [];
    const changed = [];
    for (const ownerId of Array.isArray(ownerIds) ? ownerIds : []) {
      const owner = clean(ownerId);
      let stat;
      try { stat = await fsp.stat(remoteWorkspaceFile(sharedRoot, owner)); } catch (_) { continue; }
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (remoteStamps.get(owner) === stamp) continue;
      try {
        const result = await syncOwner(userId, owner);
        if (result && (result.publicationPending || ['LOCAL_CHANGED','LOCAL_NEWER','LOCAL_CHANGED_DURING_MERGE'].includes(result.reason))) continue;
        remoteStamps.set(owner, stamp);
        if (result && (result.synced || result.merged)) changed.push({ ownerId: owner, revision: result.revision });
      } catch (error) { trace('COLLECTION_REPLICA_POLL_FAILED', { ownerId: owner, error: error && (error.code || error.message) }); }
    }
    return changed;
  }
  async function syncAuthorizedOwners(userId) {
    const user = clean(userId);
    const owners = permissions.effectiveOwners(user).map(item => item.ownerId);
    const results = [];
    for (const ownerId of owners) {
      try { results.push(await syncOwner(user, ownerId)); }
      catch (error) { results.push({ synced: false, ownerId, error: error.code || error.message }); }
    }
    return { ownerIds: owners, results };
  }
  return { publishOwner, syncOwner, syncAuthorizedOwners, pollOwners, status, remoteWorkspaceFile, listMergeConflicts, resolveMergeConflict };
}

module.exports = { REPLICATION_VERSION, REPLICATION_STATE_VERSION, LEGACY_DELTA_QUARANTINE_MARKER, collectionWorkspaceOwnerFromDelta, filterCollectionWorkspaceDeltas, quarantineLegacyCollectionDeltas, createCollectionReplication, mergeCollectionWorkspaces, applyConflictIncoming };
