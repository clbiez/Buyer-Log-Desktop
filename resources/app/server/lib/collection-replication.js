'use strict';

/* Eski genel delta alanına yanlışlıkla düşmüş Collection çalışma alanlarını
 * ayıklar. Yetkili sahipler de bu yoldan uygulanmaz: yeni sahip-bazlı taşıma
 * mekanizması tek iş verisi kaynağıdır. */

function collectionWorkspaceOwnerFromDelta(delta) {
  const id = String(delta && delta.id || '');
  const match = /^store:collection-workspaces\/([A-Za-z0-9_-]+)\.json$/.exec(id);
  return match ? match[1] : null;
}

function filterCollectionWorkspaceDeltas(deltas = []) {
  // Legacy owner-scoped workspaces use the compatibility replica and must not
  // leak into the generic delta channel. The Shared Hub architecture has one
  // canonical Collection document; that document intentionally travels through
  // the local-first delta/outbox path so UI writes never wait for SMB.
  return (Array.isArray(deltas) ? deltas : []).filter(delta => {
    const ownerId = collectionWorkspaceOwnerFromDelta(delta);
    return !ownerId || ownerId === 'shared-collection';
  });
}

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync } = require('./shared-file-transaction');

const REPLICATION_VERSION = 1;
const LEGACY_DELTA_QUARANTINE_MARKER = 'collectionLegacyDeltaQuarantineV1';
function clean(value) { return String(value == null ? '' : value).trim(); }
function safeId(value) { return clean(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100); }
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }
function remoteWorkspaceFile(root, ownerId) { return path.join(path.resolve(root), 'BUYER_LOG_SYNC', 'collection-workspaces', 'v1', `${safeId(ownerId)}.json`); }

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fsp.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await fsp.rename(temporary, file);
  } finally { try { await fsp.unlink(temporary); } catch (_) {} }
}

async function readEnvelope(file, ownerId) {
  let raw;
  try { raw = JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error && error.code === 'ENOENT') return null; throw error; }
  if (!raw || raw.version !== REPLICATION_VERSION || clean(raw.ownerId) !== clean(ownerId) || !raw.workspace || typeof raw.workspace !== 'object') {
    throw Object.assign(new Error('Collection replikasyon belgesi geçersiz.'), { code: 'COLLECTION_REPLICA_INVALID' });
  }
  const expected = checksum({ version: raw.version, ownerId: raw.ownerId, workspace: raw.workspace });
  if (raw.sha256 !== expected) throw Object.assign(new Error('Collection replikasyon belgesi doğrulanamadı.'), { code: 'COLLECTION_REPLICA_CHECKSUM' });
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

function createCollectionReplication({ workspaces, permissions, getSharedSyncRoot = async () => '', onTrace = null } = {}) {
  if (!workspaces || typeof workspaces.loadWorkspace !== 'function' || typeof workspaces.replaceWorkspaceReplica !== 'function') throw new Error('Collection workspace store is required.');
  if (!permissions || typeof permissions.accessLevel !== 'function') throw new Error('Collection permission store is required.');
  const trace = (event, detail) => { try { if (typeof onTrace === 'function') onTrace(event, detail); } catch (_) {} };
  async function root() { return clean(await getSharedSyncRoot()); }
  async function publishOwner(ownerId) {
    const owner = clean(ownerId); if (!owner) throw Object.assign(new Error('Koleksiyon sahibi zorunludur.'), { code: 'COLLECTION_OWNER_REQUIRED' });
    const sharedRoot = await root();
    if (!sharedRoot) return { published: false, reason: 'not-configured' };
    const workspace = workspaces.loadWorkspace(owner);
    const envelope = { version: REPLICATION_VERSION, ownerId: owner, workspace };
    envelope.sha256 = checksum(envelope);
    const target = remoteWorkspaceFile(sharedRoot, owner);
    await withFileLeaseAsync(target, async () => { await writeJson(target, envelope); });
    trace('COLLECTION_REPLICA_PUBLISHED', { ownerId: owner, revision: workspace._revision });
    return { published: true, ownerId: owner, revision: workspace._revision };
  }
  async function syncOwner(userId, ownerId) {
    const user = clean(userId), owner = clean(ownerId);
    if (!permissions.accessLevel(user, owner)) throw Object.assign(new Error('Bu Koleksiyon sayfasına erişim yetkiniz bulunmuyor.'), { code: 'COLLECTION_ACCESS_DENIED', statusCode: 403 });
    const sharedRoot = await root();
    if (!sharedRoot) return { synced: false, reason: 'not-configured' };
    const source = remoteWorkspaceFile(sharedRoot, owner);
    const envelope = await readEnvelope(source, owner);
    if (!envelope) return { synced: false, reason: 'not-published' };
    const result = await workspaces.replaceWorkspaceReplica(owner, envelope.workspace);
    trace('COLLECTION_REPLICA_SYNCED', { ownerId: owner, userId: user, applied: result.applied, reason: result.reason || null });
    return { synced: Boolean(result.applied), ownerId: owner, revision: result.workspace && result.workspace._revision, reason: result.reason || null };
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
  return { publishOwner, syncOwner, syncAuthorizedOwners, remoteWorkspaceFile };
}

module.exports = { REPLICATION_VERSION, LEGACY_DELTA_QUARANTINE_MARKER, collectionWorkspaceOwnerFromDelta, filterCollectionWorkspaceDeltas, quarantineLegacyCollectionDeltas, createCollectionReplication };
