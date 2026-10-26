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
    let value;
    if (!base && (l === undefined || r === undefined)) value = l === undefined ? r : l;
    else if (sameRowField(key, l, r) || (base && sameRowField(key, l, b))) value = r;
    else if (base && sameRowField(key, r, b)) value = l;
    else { value = r; conflicts.push({ rowId, field: key, current: r === undefined ? null : r, incoming: l === undefined ? null : l }); }
    if (value !== undefined) out[key] = value;
  }
  return out;
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
    nextId,
    _revision: Math.max(Number(local && local._revision) || 0, Number(remote && remote._revision) || 0) + 1,
    _updatedAt: new Date().toISOString(),
  };
  return { workspace, conflicts };
}

function createCollectionReplication({ workspaces, permissions, getSharedSyncRoot = async () => '', stateFile = '', onTrace = null, onApplied = null, trialPolicy = require('./update-trial-backend').createTrialWritePolicy() } = {}) {
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
      owners: raw && raw.owners && typeof raw.owners === 'object' && !Array.isArray(raw.owners) ? raw.owners : {},
    };
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
  async function recordBase(ownerId, envelope, state = 'up-to-date', detail = {}) {
    try { await writeBaseSnapshot(ownerId, envelope.workspace); }
    catch (error) { trace('COLLECTION_REPLICA_BASE_FAILED', { ownerId: clean(ownerId), error: error && error.message }); }
    return updateOwnerState(ownerId, {
      state, code: null, message: null,
      baseEnvelopeSha256: envelopeIdentity(envelope),
      baseWorkspaceSha256: checksum(envelope.workspace),
      remoteRevision: Number(envelope.workspace && envelope.workspace._revision) || 0,
      ...detail,
    });
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
      const write = await workspaces.replaceWorkspaceReplica(owner, envelope.workspace, { expectedSha256: checksum(local), force: true });
      if (!write || !write.applied) return { synced: false, merged: false, ownerId: owner, reason: 'LOCAL_CHANGED_DURING_MERGE', conflict: true };
      await recordBase(owner, envelope);
      return { synced: true, merged: false, ownerId: owner, revision: Number(envelope.workspace && envelope.workspace._revision) || 0, reason: 'READ_ONLY_ADOPTED' };
    }
    const state = await ownerState(owner);
    const base = await readBaseSnapshot(owner, state && state.baseWorkspaceSha256);
    const local = workspaces.loadWorkspace(owner);
    const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, envelope.workspace);
    const write = await workspaces.replaceWorkspaceReplica(owner, workspace, { expectedSha256: checksum(local) });
    if (!write || !write.applied) {
      await recordConflict(owner, conflictError('COLLECTION_REPLICA_CONCURRENT_CHANGE', 'Koleksiyon birleştirilirken yerel kopya değişti; bir sonraki senkronda yeniden denenecek.'));
      return { synced: false, merged: false, ownerId: owner, reason: 'LOCAL_CHANGED_DURING_MERGE', conflict: true };
    }
    await recordBase(owner, envelope);
    await recordMergeConflicts(owner, conflicts);
    trace('COLLECTION_REPLICA_MERGED', { ownerId: owner, revision: workspace._revision, conflicts: conflicts.length });
    let publication = null, publishError = null;
    try { publication = await publishOwnerCas(owner); }
    catch (error) { publishError = error; }
    return {
      synced: true, merged: true, ownerId: owner, revision: workspace._revision, conflicts: conflicts.length,
      published: Boolean(publication && publication.published), reason: publishError ? publishError.code || 'PUBLISH_FAILED' : 'MERGED',
    };
  }
  function publishOwner(ownerId) {
    return withOwnerOperation(ownerId, () => publishOwnerInternal(ownerId));
  }
  async function publishOwnerInternal(ownerId) {
    trialPolicy.assertConfirmed();
    try { return await publishOwnerCas(ownerId); }
    catch (error) {
      if (Number(error && error.statusCode) !== 409) throw error;
      const owner = clean(ownerId), sharedRoot = await root();
      const envelope = sharedRoot ? await readEnvelope(remoteWorkspaceFile(sharedRoot, owner), owner) : null;
      const merged = await reconcile(owner, envelope);
      if (!merged || !merged.merged) throw error;
      return merged;
    }
  }
  async function publishOwnerCas(ownerId) {
    const owner = clean(ownerId); if (!owner) throw Object.assign(new Error('Koleksiyon sahibi zorunludur.'), { code: 'COLLECTION_OWNER_REQUIRED' });
    const sharedRoot = await root();
    if (!sharedRoot) return { published: false, reason: 'not-configured' };
    const workspace = workspaces.loadWorkspace(owner);
    const localRevision = Number(workspace && workspace._revision) || 0;
    const localWorkspaceSha256 = checksum(workspace);
    const target = remoteWorkspaceFile(sharedRoot, owner);
    let published = true;
    let reason = null;
    let publishedEnvelope = null;
    try {
      await withFileLeaseAsync(target, async () => {
        const current = await readEnvelope(target, owner);
        if (current) {
          const remoteRevision = Number(current.workspace && current.workspace._revision) || 0;
          if (remoteRevision > localRevision) {
            throw conflictError('COLLECTION_REPLICA_STALE', 'Uzak Koleksiyon kopyası yerel kopyadan daha yeni.', { ownerId: owner, localRevision, remoteRevision });
          }
          if (remoteRevision === localRevision) {
            if (checksum(current.workspace) === localWorkspaceSha256) {
              published = false;
              reason = 'UP_TO_DATE';
              publishedEnvelope = current;
              return;
            }
            throw conflictError('COLLECTION_REPLICA_CONFLICT', 'Aynı revizyonda farklı Koleksiyon kopyaları bulundu.', { ownerId: owner, revision: localRevision });
          }
          // A larger local revision is not proof of ancestry: another offline
          // device may simply have produced more edits. The last envelope hash
          // observed by THIS device must still be the remote head (CAS).
          const base = await ownerState(owner);
          if (!base || base.baseEnvelopeSha256 !== envelopeIdentity(current)) {
            throw conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Yerel Koleksiyon kopyasının uzak sürümden türediği doğrulanamadı.', {
              ownerId: owner, localRevision, remoteRevision, remoteSha256: envelopeIdentity(current),
            });
          }
        }
        const envelope = { version: REPLICATION_VERSION, ownerId: owner, parentSha256: current ? envelopeIdentity(current) : null, workspace };
        envelope.sha256 = envelopeChecksum(envelope);
        envelope.chainSha256 = envelopeChainChecksum(envelope);
        await writeJson(target, envelope);
        publishedEnvelope = envelope;
      });
    } catch (error) {
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, reason: error.code || 'PUBLISH_FAILED', localRevision, remoteRevision: error.remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision: error.remoteRevision });
      throw error;
    }
    await recordBase(owner, publishedEnvelope);
    if (!published) return { published: false, ownerId: owner, revision: localRevision, reason, state: 'up-to-date' };
    trace('COLLECTION_REPLICA_PUBLISHED', { ownerId: owner, revision: localRevision });
    return { published: true, ownerId: owner, revision: localRevision, sha256: envelopeIdentity(publishedEnvelope), parentSha256: publishedEnvelope.parentSha256 };
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
      const merged = await reconcile(owner, envelope, { readOnly });
      if (merged) return merged;
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason: 'EQUAL_REVISION_DIVERGED', revision: localRevision });
      await recordConflict(owner, conflictError('COLLECTION_REPLICA_CONFLICT', 'Aynı revizyonda farklı Koleksiyon kopyaları bulundu.'), { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'EQUAL_REVISION_DIVERGED', conflict: true };
    }
    if (localRevision > remoteRevision) {
      if (base && base.baseEnvelopeSha256 === envelopeIdentity(envelope)) {
        // A previous process may have committed locally and crashed before the
        // remote publish. The CAS base proves this is a real descendant, so a
        // normal GET/sync can safely finish the interrupted publication.
        const publication = await publishOwnerInternal(owner);
        return { synced: Boolean(publication.merged), ...(publication.merged ? { merged:true } : {}), published: Boolean(publication.published), ownerId: owner, revision: Number(publication.revision) || localRevision, reason: publication.reason || 'LOCAL_NEWER_PUBLISHED' };
      }
      const merged = await reconcile(owner, envelope, { readOnly });
      if (merged) return merged;
      const error = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Daha yeni yerel Koleksiyon kopyasının uzak sürümden türediği doğrulanamadı.');
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason:'LOCAL_NEWER_DIVERGED', localRevision, remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'LOCAL_NEWER_DIVERGED', conflict: true };
    }
    const pristineLocal = localRevision === 0 && local && local.initialized === false;
    const localUnchangedSinceBase = Boolean(base && base.baseWorkspaceSha256 === localWorkspaceSha256);
    if (!pristineLocal && !localUnchangedSinceBase) {
      const merged = await reconcile(owner, envelope, { readOnly });
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
    if (typeof onApplied === 'function' && result && (result.synced || result.merged)) await onApplied(result);
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
        if (result && ['LOCAL_CHANGED','LOCAL_NEWER','LOCAL_CHANGED_DURING_MERGE'].includes(result.reason)) continue;
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

module.exports = { REPLICATION_VERSION, REPLICATION_STATE_VERSION, LEGACY_DELTA_QUARANTINE_MARKER, collectionWorkspaceOwnerFromDelta, filterCollectionWorkspaceDeltas, quarantineLegacyCollectionDeltas, createCollectionReplication, mergeCollectionWorkspaces };
