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
const { withFileLeaseAsync } = require('./shared-file-transaction');

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

function createCollectionReplication({ workspaces, permissions, getSharedSyncRoot = async () => '', stateFile = '', onTrace = null } = {}) {
  if (!workspaces || typeof workspaces.loadWorkspace !== 'function' || typeof workspaces.replaceWorkspaceReplica !== 'function') throw new Error('Collection workspace store is required.');
  if (!permissions || typeof permissions.accessLevel !== 'function') throw new Error('Collection permission store is required.');
  const trace = (event, detail) => { try { if (typeof onTrace === 'function') onTrace(event, detail); } catch (_) {} };
  const statePath = clean(stateFile);
  let volatileState = { version: REPLICATION_STATE_VERSION, owners: {} };
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
      state.owners[key] = { ...(state.owners[key] || {}), ...patch, ownerId: clean(ownerId), updatedAt: new Date().toISOString() };
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
  async function recordBase(ownerId, envelope, state = 'up-to-date', detail = {}) {
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
    return {
      ok: !conflict, ownerId: owner, state: current.state || 'unknown', code: current.code || null,
      message: current.message || null, remoteRevision: Number(current.remoteRevision) || 0,
      localRevision: Number(current.localRevision) || 0, updatedAt: current.updatedAt || null,
    };
  }
  async function root() { return clean(await getSharedSyncRoot()); }
  async function publishOwner(ownerId) {
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
  async function syncOwner(userId, ownerId) {
    const user = clean(userId), owner = clean(ownerId);
    if (!permissions.accessLevel(user, owner)) throw Object.assign(new Error('Bu Koleksiyon sayfasına erişim yetkiniz bulunmuyor.'), { code: 'COLLECTION_ACCESS_DENIED', statusCode: 403 });
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
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason: 'EQUAL_REVISION_DIVERGED', revision: localRevision });
      await recordConflict(owner, conflictError('COLLECTION_REPLICA_CONFLICT', 'Aynı revizyonda farklı Koleksiyon kopyaları bulundu.'), { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'EQUAL_REVISION_DIVERGED', conflict: true };
    }
    if (localRevision > remoteRevision) {
      if (base && base.baseEnvelopeSha256 === envelopeIdentity(envelope)) {
        // A previous process may have committed locally and crashed before the
        // remote publish. The CAS base proves this is a real descendant, so a
        // normal GET/sync can safely finish the interrupted publication.
        const publication = await publishOwner(owner);
        return { synced: false, published: Boolean(publication.published), ownerId: owner, revision: localRevision, reason: publication.reason || 'LOCAL_NEWER_PUBLISHED' };
      }
      const error = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Daha yeni yerel Koleksiyon kopyasının uzak sürümden türediği doğrulanamadı.');
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason:'LOCAL_NEWER_DIVERGED', localRevision, remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'LOCAL_NEWER_DIVERGED', conflict: true };
    }
    const pristineLocal = localRevision === 0 && local && local.initialized === false;
    const localUnchangedSinceBase = Boolean(base && base.baseWorkspaceSha256 === localWorkspaceSha256);
    if (!pristineLocal && !localUnchangedSinceBase) {
      const error = conflictError('COLLECTION_REPLICA_ANCESTRY_CONFLICT', 'Uzak Koleksiyon daha yeni ancak yerel kopyada da yayımlanmamış değişiklikler var.');
      trace('COLLECTION_REPLICA_CONFLICT', { ownerId: owner, userId: user, reason:'REMOTE_NEWER_LOCAL_DIRTY', localRevision, remoteRevision });
      await recordConflict(owner, error, { localRevision, remoteRevision });
      return { synced: false, ownerId: owner, revision: localRevision, reason: 'REMOTE_NEWER_LOCAL_DIRTY', conflict: true };
    }
    const result = await workspaces.replaceWorkspaceReplica(owner, envelope.workspace);
    if (result.applied) await recordBase(owner, envelope);
    else if (result.reason === 'LOCAL_NEWER') {
      const error = conflictError('COLLECTION_REPLICA_CONCURRENT_CHANGE', 'Koleksiyon senkronizasyonu sırasında yerel kopya değişti.');
      await recordConflict(owner, error, { localRevision: Number(result.workspace && result.workspace._revision) || localRevision, remoteRevision });
    }
    trace('COLLECTION_REPLICA_SYNCED', { ownerId: owner, userId: user, applied: result.applied, reason: result.reason || null });
    return { synced: Boolean(result.applied), ownerId: owner, revision: result.workspace && result.workspace._revision, reason: result.reason || null, conflict: result.reason === 'LOCAL_NEWER' };
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
  return { publishOwner, syncOwner, syncAuthorizedOwners, status, remoteWorkspaceFile };
}

module.exports = { REPLICATION_VERSION, REPLICATION_STATE_VERSION, LEGACY_DELTA_QUARANTINE_MARKER, collectionWorkspaceOwnerFromDelta, filterCollectionWorkspaceDeltas, quarantineLegacyCollectionDeltas, createCollectionReplication };
