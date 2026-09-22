'use strict';

const collectionStatusCatalog = require('../../public/collection-status-catalog.js');

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteJsonAsync } = require('../user-data');
const { withFileLeaseSync, withFileLeaseAsync } = require('./shared-file-transaction');
const { readJsonWithValidatedBackup } = require('./safe-json-read');

const ROOT = path.join(SERVER_DATA_ROOT, 'collection-workspaces');
const MAX_ROWS = 100000;
const MAX_MANUFACTURERS = 2000;
const MAX_CUSTOM_COLUMNS = 80;

const SHARED_COLLECTION_OWNER = 'shared-collection';
function stableSharedRecordId(ownerId, row, index) {
  const seed = [String(ownerId || ''), String(row && row.id != null ? row.id : index), String(row && (row.plmId || row['PLM ID'] || '')), String(row && (row.ccode || row['Colour Code'] || ''))].join('|');
  return `cr_${crypto.createHash('sha256').update(seed).digest('hex').slice(0,24)}`;
}
function mergeUniqueObjects(target, items) {
  const seen = new Set(target.map(item => JSON.stringify(item)));
  for (const item of items || []) { const key = JSON.stringify(item); if (!seen.has(key)) { seen.add(key); target.push(item); } }
}
/* Legacy owner workspaces are migration evidence, never destroyed. The first
   Shared Hub activation creates one canonical Collection by unioning them into
   a new local workspace. Row ids are reassigned to prevent cross-owner id
   collisions; stable recordId/audit fields preserve provenance. */
function ensureSharedWorkspace(ownerIds = [], actorId = '') {
  const existing = loadWorkspace(SHARED_COLLECTION_OWNER);
  if (existing.initialized) return { workspace: existing, migrated: false, rows: existing.rows.length };
  const owners = [...new Set((Array.isArray(ownerIds) ? ownerIds : listOwnerIds()).map(safeId).filter(id => id && id !== SHARED_COLLECTION_OWNER))].sort();
  const rows = [], manufacturers = [], customColumns = [];
  let nextId = 1, migratedOwners = 0;
  const at = new Date().toISOString();
  for (const ownerId of owners) {
    const legacy = loadWorkspace(ownerId);
    if (!legacy.initialized) continue;
    migratedOwners += 1;
    mergeUniqueObjects(manufacturers, legacy.manufacturers);
    mergeUniqueObjects(customColumns, legacy.customColumns);
    legacy.rows.forEach((row, index) => {
      const recordId = String(row && row.recordId || row && row._sharedRecordId || stableSharedRecordId(ownerId, row, index));
      rows.push({ ...row, id: nextId++, recordId, createdBy: row.createdBy || ownerId, createdAt: row.createdAt || legacy._updatedAt || at, updatedBy: row.updatedBy || ownerId, updatedAt: row.updatedAt || legacy._updatedAt || at, _legacyOwnerId: ownerId, _legacyRowId: row && row.id != null ? String(row.id) : '' });
    });
  }
  const payload = { initialized: true, rows, manufacturers, customColumns, nextId, migratedFromOwners: owners, migrationActor: String(actorId || ''), migratedAt: at };
  const workspace = saveWorkspace(SHARED_COLLECTION_OWNER, payload, existing._revision);
  return { workspace, migrated: true, rows: rows.length, owners: migratedOwners };
}

/* Kişisel backup'lar Shared Collection geçişinden ÖNCE kullanıcıya ait ayrı
   workspace'i içerir. Shared Hub aktifken bu dosyayı tekrar ownerId'ye yazmak
   veriyi diskte geri getirir ama UI kanonik olarak shared-collection okuduğu
   için kullanıcı hiçbir şey görmez. Restore burada PAYLAŞILAN koleksiyona
   kayıpsız MERGE edilir; başka kullanıcıların satırları asla silinmez.

   Eşleşme sırası:
   1) migration provenance (_legacyOwnerId + _legacyRowId)
   2) stable recordId
   Böylece aynı backup ikinci kez uygulanırsa kopya üretmez; eski satır güncel
   backup içeriğiyle yenilenir. Shared id/recordId korunur. */
async function mergePersonalBackupIntoShared(ownerId, rawWorkspace, actorId = '') {
  const legacyOwnerId = safeId(ownerId);
  const incoming = normalizeWorkspace(legacyOwnerId, rawWorkspace);
  const actor = String(actorId || legacyOwnerId);
  let lastConflict = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = loadWorkspace(SHARED_COLLECTION_OWNER);
    const rows = (Array.isArray(current.rows) ? current.rows : []).map(row => ({ ...row }));
    const byRecordId = new Map();
    const byLegacy = new Map();
    rows.forEach((row, index) => {
      const recordId = String(row && row.recordId || '').trim();
      if (recordId) byRecordId.set(recordId, index);
      const sourceOwner = String(row && row._legacyOwnerId || '').trim();
      const sourceRow = String(row && row._legacyRowId || '').trim();
      if (sourceOwner && sourceRow) byLegacy.set(`${sourceOwner}|${sourceRow}`, index);
    });

    let nextId = Math.max(
      1,
      Number(current.nextId) || 1,
      1 + rows.reduce((max, row) => Math.max(max, Number(row && row.id) || 0), 0),
    );
    let added = 0, updated = 0;
    const at = new Date().toISOString();

    incoming.rows.forEach((sourceRow, sourceIndex) => {
      const legacyRowId = sourceRow && sourceRow.id != null ? String(sourceRow.id) : String(sourceIndex);
      const recordId = String(sourceRow && (sourceRow.recordId || sourceRow._sharedRecordId) || stableSharedRecordId(legacyOwnerId, sourceRow, sourceIndex));
      let targetIndex = byLegacy.get(`${legacyOwnerId}|${legacyRowId}`);
      if (targetIndex == null) targetIndex = byRecordId.get(recordId);

      if (targetIndex != null) {
        const existing = rows[targetIndex] || {};
        const restored = {
          ...sourceRow,
          id: existing.id,
          recordId: existing.recordId || recordId,
          _rev: Math.max(Number(existing._rev) || 0, Number(sourceRow && sourceRow._rev) || 0) + 1,
          createdBy: existing.createdBy || sourceRow.createdBy || legacyOwnerId,
          createdAt: existing.createdAt || sourceRow.createdAt || incoming._updatedAt || at,
          updatedBy: actor,
          updatedAt: at,
          _legacyOwnerId: legacyOwnerId,
          _legacyRowId: legacyRowId,
        };
        rows[targetIndex] = restored;
        byRecordId.set(restored.recordId, targetIndex);
        byLegacy.set(`${legacyOwnerId}|${legacyRowId}`, targetIndex);
        updated += 1;
        return;
      }

      if (rows.length >= MAX_ROWS) {
        const error = new Error('Kişisel backup Koleksiyon satırları Shared Collection kapasitesini aşıyor.');
        error.code = 'COLLECTION_RESTORE_CAPACITY_EXCEEDED';
        error.statusCode = 409;
        throw error;
      }
      const restored = {
        ...sourceRow,
        id: nextId++,
        recordId,
        _rev: Math.max(1, Number(sourceRow && sourceRow._rev) || 0),
        createdBy: sourceRow.createdBy || legacyOwnerId,
        createdAt: sourceRow.createdAt || incoming._updatedAt || at,
        updatedBy: actor,
        updatedAt: at,
        _legacyOwnerId: legacyOwnerId,
        _legacyRowId: legacyRowId,
      };
      const newIndex = rows.push(restored) - 1;
      byRecordId.set(recordId, newIndex);
      byLegacy.set(`${legacyOwnerId}|${legacyRowId}`, newIndex);
      added += 1;
    });

    const manufacturers = (Array.isArray(current.manufacturers) ? current.manufacturers : []).map(item => ({ ...item }));
    const customColumns = (Array.isArray(current.customColumns) ? current.customColumns : []).map(item => ({ ...item }));
    mergeUniqueObjects(manufacturers, incoming.manufacturers);
    mergeUniqueObjects(customColumns, incoming.customColumns);

    try {
      const result = await saveWorkspaceAsync(SHARED_COLLECTION_OWNER, {
        ...current,
        rows,
        manufacturers,
        customColumns,
        nextId,
      }, current._revision);
      const mirrored = await documents.mirror(documentId(SHARED_COLLECTION_OWNER), result.saved);
      if (mirrored && mirrored.ok === false) {
        const error = mirrored.error instanceof Error ? mirrored.error : new Error('Shared Collection yerel veritabanına aynalanamadı.');
        error.code = error.code || 'COLLECTION_RESTORE_MIRROR_FAILED';
        throw error;
      }
      return {
        workspace: result.saved,
        ownerId: SHARED_COLLECTION_OWNER,
        sourceOwnerId: legacyOwnerId,
        shared: true,
        incomingRows: incoming.rows.length,
        added,
        updated,
        totalRows: result.saved.rows.length,
      };
    } catch (error) {
      if (error && error.code === 'REVISION_CONFLICT' && attempt < 2) {
        lastConflict = error;
        continue;
      }
      throw error;
    }
  }
  throw lastConflict || Object.assign(new Error('Shared Collection restore tamamlanamadı.'), { code:'COLLECTION_RESTORE_FAILED', statusCode:409 });
}

/* ===================================================================
   LEGACY SHARED-COLLECTION RECOVERY

   Shared Hub bir donem Collection sahipligini tek "shared-collection"
   workspace'inde birlestiriyordu. Bu, recovery/backup sirasinda ayni modelin
   farkli kullanici kimliklerinden iki kez gelmesine ve Permissions
   katmaninin anlamsizlasmasina yol aciyordu.

   Yeni kanonik model tekrar owner-bazlidir. Bu helper eski ortak havuzu
   SILMEZ; yalnizca guvenli oldugu server tarafinda dogrulandiginda hedef
   owner workspace'ine kayipsiz ve idempotent bicimde konsolide eder.
   =================================================================== */
const RECOVERY_ROW_META_FIELDS = new Set([
  'id','recordId','_sharedRecordId','_rev','createdBy','createdAt','updatedBy','updatedAt',
  '_legacyOwnerId','_legacyRowId','_recoveredSourceKeys','_sharedCollectionImageUrl',
  'modelGroupId','variantId',
]);
const RECOVERY_ROW_IMAGE_FIELDS = new Set(['img','imgRef']);
function recoveryClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function recoveryValueEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}
function recoveryValueSignature(value) {
  if (recoveryValueEmpty(value)) return '';
  if (Array.isArray(value)) return '[' + value.map(recoveryValueSignature).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+recoveryValueSignature(value[key])).join(',') + '}';
  }
  return String(value).trim().toLocaleUpperCase('tr-TR');
}
function recoveryField(row, names) {
  for (const name of names) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, name)) continue;
    const value = row[name];
    if (!recoveryValueEmpty(value)) return value;
  }
  return '';
}
function recoveryRowIdentity(row) {
  const plm = recoveryField(row, ['plmId','PLM ID','plmID']);
  const model = recoveryField(row, ['modelKod','modelCode','modelName','Model Name','model']);
  const colourCode = recoveryField(row, ['colourCode','colorCode','C.Code','Colour Code','Color Code']);
  const colour = recoveryField(row, ['colour','color','Colour','Color']);
  const primary = plm || model;
  if (recoveryValueEmpty(primary)) return '';
  return [
    recoveryValueSignature(primary),
    recoveryValueSignature(model),
    recoveryValueSignature(colourCode || colour),
  ].join('\u001f');
}
function recoveryComparableKeys(row) {
  return Object.keys(row || {}).filter(key => !RECOVERY_ROW_META_FIELDS.has(key) && !RECOVERY_ROW_IMAGE_FIELDS.has(key)).sort();
}
function recoveryRowsCompatible(left, right) {
  const keys = new Set([...recoveryComparableKeys(left), ...recoveryComparableKeys(right)]);
  for (const key of keys) {
    const a = left && left[key], b = right && right[key];
    if (recoveryValueEmpty(a) || recoveryValueEmpty(b)) continue;
    if (recoveryValueSignature(a) !== recoveryValueSignature(b)) return false;
  }
  return true;
}
function recoveryRowFingerprint(row) {
  return recoveryComparableKeys(row)
    .filter(key => !recoveryValueEmpty(row[key]))
    .map(key => key + '=' + recoveryValueSignature(row[key]))
    .join('\u001e');
}
function recoverySourceKey(ownerId, row, index) {
  const record = String(row && (row.recordId || row._sharedRecordId) || '').trim();
  const legacyOwner = String(row && row._legacyOwnerId || '').trim();
  const legacyRow = String(row && row._legacyRowId || '').trim();
  const rawId = row && row.id != null ? String(row.id) : String(index);
  return [String(ownerId || ''), record || [legacyOwner, legacyRow].filter(Boolean).join(':') || rawId].join('|');
}
function mergeRecoveryRows(base, incoming, sourceKey = '') {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (key === 'id') continue;
    if (RECOVERY_ROW_META_FIELDS.has(key) && key !== '_rev') continue;
    if (recoveryValueEmpty(out[key]) && !recoveryValueEmpty(value)) out[key] = recoveryClone(value);
  }
  out._rev = Math.max(Number(base && base._rev) || 0, Number(incoming && incoming._rev) || 0);
  const sourceKeys = new Set([
    ...(Array.isArray(base && base._recoveredSourceKeys) ? base._recoveredSourceKeys : []),
    ...(Array.isArray(incoming && incoming._recoveredSourceKeys) ? incoming._recoveredSourceKeys : []),
  ].map(value => String(value || '')).filter(Boolean));
  if (sourceKey) sourceKeys.add(sourceKey);
  if (sourceKeys.size) out._recoveredSourceKeys = [...sourceKeys].slice(0, 200);
  return out;
}

/* target owner'in mevcut satirlari + ayni kisiye ait legacy owner workspaceleri
   + shared-collection satirlari birlestirilir.
   - Ayni sourceKey ikinci calismada tekrar eklenmez.
   - Tam ayni / yalniz bos alanlari farkli satirlar tek satirda birlesir.
   - Iki dolu alan birbiriyle celisiyorsa satirlar AYRI tutulur; veri kaybi yok.
   - Eski shared workspace silinmez. */
function recoverSharedWorkspaceIntoOwner(ownerId, { sourceOwnerIds = [], sharedSourceOwnerIds = null } = {}) {
  const targetOwnerId = String(ownerId || '').trim();
  if (!targetOwnerId || targetOwnerId === SHARED_COLLECTION_OWNER) {
    return { changed:false, recovered:false, reason:'invalid-target', ownerId:targetOwnerId };
  }
  const shared = loadWorkspace(SHARED_COLLECTION_OWNER);
  const aliases = [...new Set((Array.isArray(sourceOwnerIds) ? sourceOwnerIds : [])
    .map(value => String(value || '').trim())
    .filter(value => value && value !== targetOwnerId && value !== SHARED_COLLECTION_OWNER))];
  const aliasWorkspaces = aliases.map(owner => ({ ownerId:owner, workspace:loadWorkspace(owner) }))
    .filter(item => item.workspace && item.workspace.initialized && item.workspace.rows.length);
  const hasShared = Boolean(shared && shared.initialized && shared.rows.length);
  if (!hasShared && !aliasWorkspaces.length) {
    return { changed:false, recovered:false, reason:'no-legacy-data', ownerId:targetOwnerId };
  }

  const target = loadWorkspace(targetOwnerId);
  const completedRecovery = target && target._legacyRecovery && Number(target._legacyRecovery.ownerScopeVersion) >= 1;
  if (completedRecovery) {
    return {
      changed:false, recovered:true, reason:'already-recovered', ownerId:targetOwnerId,
      totalRows:Array.isArray(target.rows) ? target.rows.length : 0, aliases,
    };
  }
  const rows = [];
  const exact = new Map();
  const identities = new Map();
  const sourceIndex = new Map();
  const usedIds = new Set();
  let nextId = Math.max(1, Number(target.nextId) || 1);
  let duplicatesMerged = 0, added = 0, sourceRows = 0;

  function reserveId(preferred) {
    const numeric = Number(preferred);
    if (Number.isFinite(numeric) && numeric > 0 && !usedIds.has(String(numeric))) {
      usedIds.add(String(numeric)); nextId = Math.max(nextId, numeric + 1); return numeric;
    }
    while (usedIds.has(String(nextId))) nextId += 1;
    const id = nextId++; usedIds.add(String(id)); return id;
  }
  function register(index) {
    const row = rows[index];
    const fp = recoveryRowFingerprint(row);
    if (fp) exact.set(fp, index);
    const identity = recoveryRowIdentity(row);
    if (identity) {
      const bucket = identities.get(identity) || [];
      if (!bucket.includes(index)) bucket.push(index);
      identities.set(identity, bucket);
    }
    for (const key of Array.isArray(row && row._recoveredSourceKeys) ? row._recoveredSourceKeys : []) {
      if (key) sourceIndex.set(String(key), index);
    }
  }
  function absorb(rawRow, sourceOwner, sourcePosition, keepPreferredId) {
    sourceRows += 1;
    const incoming = recoveryClone(rawRow || {});
    const sourceKey = sourceOwner ? recoverySourceKey(sourceOwner, incoming, sourcePosition) : '';
    let match = sourceKey ? sourceIndex.get(sourceKey) : null;
    const fp = recoveryRowFingerprint(incoming);
    if (match == null && fp && exact.has(fp)) match = exact.get(fp);
    const identity = recoveryRowIdentity(incoming);
    if (match == null && identity) {
      const bucket = identities.get(identity) || [];
      match = bucket.find(index => recoveryRowsCompatible(rows[index], incoming));
    }
    if (match != null) {
      rows[match] = mergeRecoveryRows(rows[match], incoming, sourceKey);
      duplicatesMerged += 1;
      register(match);
      return;
    }
    incoming.id = reserveId(keepPreferredId ? incoming.id : null);
    if (sourceKey) {
      const keys = new Set(Array.isArray(incoming._recoveredSourceKeys) ? incoming._recoveredSourceKeys : []);
      keys.add(sourceKey); incoming._recoveredSourceKeys = [...keys].slice(0, 200);
    }
    const index = rows.push(incoming) - 1;
    if (sourceOwner) added += 1;
    register(index);
  }

  (target.rows || []).forEach((row, index) => absorb(row, '', index, true));
  for (const item of aliasWorkspaces) (item.workspace.rows || []).forEach((row, index) => absorb(row, item.ownerId, index, false));
  if (hasShared) {
    const restricted = Array.isArray(sharedSourceOwnerIds)
      ? new Set(sharedSourceOwnerIds.map(value => String(value || '').trim()).filter(Boolean))
      : null;
    (shared.rows || []).forEach((row, index) => {
      const legacyOwner = String(row && row._legacyOwnerId || '').trim();
      if (restricted && (!legacyOwner || !restricted.has(legacyOwner))) return;
      absorb(row, SHARED_COLLECTION_OWNER, index, false);
    });
  }

  const manufacturers = (target.manufacturers || []).map(recoveryClone);
  const customColumns = (target.customColumns || []).map(recoveryClone);
  for (const item of aliasWorkspaces) {
    mergeUniqueObjects(manufacturers, item.workspace.manufacturers);
    mergeUniqueObjects(customColumns, item.workspace.customColumns);
  }
  if (hasShared && !Array.isArray(sharedSourceOwnerIds)) {
    mergeUniqueObjects(manufacturers, shared.manufacturers);
    mergeUniqueObjects(customColumns, shared.customColumns);
  }

  const recoveryMarker = {
    ownerScopeVersion:1,
    completedAt:new Date().toISOString(),
    sourceAliases:aliases,
    sharedRevision:hasShared ? Number(shared._revision) || 0 : 0,
    sourceRows,
    duplicatesMerged,
  };
  const targetComparable = JSON.stringify({
    rows: target.rows || [], manufacturers: target.manufacturers || [], customColumns: target.customColumns || [], nextId: target.nextId,
  });
  const recoveredComparable = JSON.stringify({ rows, manufacturers, customColumns, nextId });
  const dataChanged = targetComparable !== recoveredComparable;
  const saved = saveWorkspace(targetOwnerId, { rows, manufacturers, customColumns, nextId, _legacyRecovery:recoveryMarker }, target._revision);
  return {
    changed:dataChanged, markerWritten:true, recovered:true, ownerId:targetOwnerId, sourceRows,
    added, duplicatesMerged, totalRows:saved.rows.length, aliases, workspace:saved,
  };
}

async function mirrorWorkspace(ownerId) {
  // The save worker has its own module graph and intentionally has no delta
  // store attachment; it writes the local compatibility file. Read THAT fresh
  // file here instead of loadWorkspace(), because in authoritative mode the
  // in-memory delta record may still be the pre-save value.
  const file = workspaceFile(ownerId);
  const raw = readJsonWithValidatedBackup(file, {
    fallback: () => defaultWorkspace(ownerId),
    normalize: value => normalizeWorkspace(ownerId, value),
    restore: value => atomicWriteJson(file, value),
  });
  const workspace = normalizeWorkspace(ownerId, raw);
  const result = await documents.mirror(documentId(ownerId), workspace);
  return { ...result, ownerId: String(ownerId || ''), revision: workspace._revision };
}

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || 'anonymous';
}
function workspaceFile(ownerId) { return path.join(ROOT, `${safeId(ownerId)}.json`); }
/* Delta motoruna taşınmış belgeler. Her çalışma alanı ayrı bir kayıt; kimlik
   veri köküne göreli yol olduğu için sahipler birbirine karışmaz. */
function documentId(ownerId) { return `collection-workspaces/${safeId(ownerId)}.json`; }
const { createDocumentApi } = require('./delta-store');
let documents = createDocumentApi(null);
function attachDeltaStore(store) { documents = createDocumentApi(store); return documents; }
function cleanObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalizeRows(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_ROWS).map(row => cleanObject(row));
}
function normalizeManufacturers(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_MANUFACTURERS).map(item => cleanObject(item));
}
function normalizeCustomColumns(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_CUSTOM_COLUMNS).map(item => cleanObject(item));
}
function normalizeStatusCatalog(value, rows) {
  return collectionStatusCatalog.normalize(value, { rowStatuses: normalizeRows(rows).map(row => row && row.durum) });
}
function defaultWorkspace(ownerId) {
  return {
    schemaVersion: 1,
    ownerId: String(ownerId || ''),
    initialized: false,
    rows: [],
    manufacturers: [],
    customColumns: [],
    statusCatalog: collectionStatusCatalog.seed(),
    nextId: 1,
    _legacyRecovery: {},
    _revision: 0,
    _updatedAt: null,
  };
}
function normalizeWorkspace(ownerId, raw) {
  const base = defaultWorkspace(ownerId);
  const rows = normalizeRows(raw && raw.rows);
  return ({
      ...base,
      ...cleanObject(raw),
      ownerId: String(ownerId || ''),
      initialized: raw && raw.initialized !== false,
      rows,
      manufacturers: normalizeManufacturers(raw && raw.manufacturers),
      customColumns: normalizeCustomColumns(raw && raw.customColumns),
      statusCatalog: normalizeStatusCatalog(raw && raw.statusCatalog, rows),
      nextId: Math.max(1, Number(raw && raw.nextId) || 1),
      _revision: Math.max(0, Number(raw && raw._revision) || 0),
    });
}
function loadWorkspace(ownerId) {
  // Delta yetkiliyse kayıt oradan; değilse ya da bilmiyorsa eski dosyadan.
  const fromDelta = documents.read(documentId(ownerId));
  if (fromDelta) return normalizeWorkspace(ownerId, fromDelta);
  const file = workspaceFile(ownerId);
  return readJsonWithValidatedBackup(file, {
    fallback: () => defaultWorkspace(ownerId),
    normalize: raw => normalizeWorkspace(ownerId, raw),
    restore: value => atomicWriteJson(file, value),
  });
}
function saveWorkspace(ownerId, payload, expectedRevision = null) {
  return withFileLeaseSync(workspaceFile(ownerId),()=>{
  const current = loadWorkspace(ownerId);
  if (expectedRevision != null && Number(expectedRevision) !== current._revision) {
    const error = new Error('Koleksiyon sayfası başka bir kullanıcı tarafından değiştirildi. Güncel sayfayı yeniden açın.');
    error.code = 'REVISION_CONFLICT';
    error.statusCode = 409;
    error.currentRevision = current._revision;
    error.expectedRevision = Number(expectedRevision);
    throw error;
  }
  fs.mkdirSync(ROOT, { recursive: true });
  const rows = normalizeRows(payload && payload.rows);
  const sourceCatalog = payload && Object.prototype.hasOwnProperty.call(payload, 'statusCatalog') ? payload.statusCatalog : current.statusCatalog;
  const saved = {
    schemaVersion: 1,
    ownerId: String(ownerId || ''),
    initialized: true,
    rows,
    manufacturers: normalizeManufacturers(payload && payload.manufacturers),
    customColumns: normalizeCustomColumns(payload && payload.customColumns),
    statusCatalog: normalizeStatusCatalog(sourceCatalog, rows),
    nextId: Math.max(Number(payload && payload.nextId) || 1, 1 + rows.reduce((max, row) => Math.max(max, Number(row && row.id) || 0), 0)),
    _legacyRecovery: cleanObject(payload && payload._legacyRecovery && Object.keys(payload._legacyRecovery).length ? payload._legacyRecovery : current._legacyRecovery),
    _revision: current._revision + 1,
    _updatedAt: new Date().toISOString(),
  };
  if (documents.writesLegacy) atomicWriteJson(workspaceFile(ownerId), saved);
  documents.mirror(documentId(ownerId), saved);
  return saved;
  });
}

/* ===================================================================
   v7.21 — ASENKRON KAYDETME VE SATIR FARKI

   İki saha bulgusu bu bloğu doğurdu.

   1) OLAY DÖNGÜSÜ. saveWorkspace eşzamanlı kilit + eşzamanlı yazma
      kullanıyordu; 50.000 satırlık bir sayfada sunucu 237 ms boyunca
      hiçbir isteğe yanıt vermiyordu. saveWorkspaceAsync aynı işi yapar,
      aynı revizyon kontrolünü uygular, ama beklerken olay döngüsünü
      serbest bırakır.

   2) CANLI SENKRON. Eskiden kaydetme yalnız "bu sayfa değişti" diyordu;
      karşı ekran bunu alınca sayfayı BÜTÜNÜYLE yeniden yüklüyordu. Artık
      kaydetme sırasında eski ve yeni satırlar id bazında karşılaştırılıp
      DEĞİŞEN satırlar çıkarılır. Karşı ekran yalnız o satırları günceller.

   NOT: satır bazlı YAZMA ve satır bazlı revizyon bilinçli olarak bu
   sürümün dışında bırakıldı (kullanıcıyla kararlaştırıldı: önce 3+2, sonra
   1). Burada yazma birimi hâlâ bütün sayfa; değişen şey yazmanın bloke
   etmemesi ve karşı ekranın tam yeniden yükleme yapmaması.
   =================================================================== */

// Bir satırın kimliği id'sidir; id yoksa dizideki sırası son çaredir.
function rowKeyOf(row, index) {
  const id = row && row.id;
  return id == null || id === '' ? `#${index}` : `id:${String(id)}`;
}
// Yapısal değişiklikler (sütun listesi, üretici listesi) satır yamasıyla
// ifade edilemez; bu durumda karşı ekran sessizce hafif yeniden yükleme yapar.
function structuralChange(before, after) {
  return JSON.stringify(before.customColumns || []) !== JSON.stringify(after.customColumns || [])
    || JSON.stringify(before.manufacturers || []) !== JSON.stringify(after.manufacturers || [])
    || JSON.stringify(before.statusCatalog || []) !== JSON.stringify(after.statusCatalog || []);
}
/* Satır karşılaştırması SIĞ yapılır, JSON.stringify ile DEĞİL.

   İlk yazımda satır başına iki JSON.stringify kullanmıştım; 50.000 satırlık
   bir sayfada bu tek başına 273 ms sürüyordu — yani farkı hesaplamak,
   düzeltmeye çalıştığım kaydetme maliyetinin tamamına yakındı. Koleksiyon
   satırları düz nesnelerdir; anahtar sayısı ve değerleri karşılaştırmak hem
   doğru hem de ilk farkta çıktığı için çok daha ucuz.

   İç içe nesne taşıyan bir alan olursa (bugün yok) referans karşılaştırması
   onu "değişmiş" sayar: yanlış tarafa değil, GÜVENLİ tarafa düşer — fazladan
   bir satır yaması gönderilir, veri sapması olmaz. */
function shallowRowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const left = a[key], right = b[key];
    if (left === right) continue;
    // null/undefined ve sayı/metin karışıklığını değer bazında hoşgör.
    if (left == null && right == null) continue;
    if (typeof left === 'object' || typeof right === 'object') return false;
    return false;
  }
  return true;
}
const MAX_PATCH_ROWS = 500; // bundan büyük fark, yeniden yüklemeden ucuz değil
function diffWorkspaceRows(before, after) {
  if (structuralChange(before, after)) return null;
  const beforeRows = Array.isArray(before.rows) ? before.rows : [];
  const afterRows = Array.isArray(after.rows) ? after.rows : [];
  const beforeByKey = new Map();
  beforeRows.forEach((row, index) => beforeByKey.set(rowKeyOf(row, index), row));
  const changed = [], seen = new Set();
  afterRows.forEach((row, index) => {
    const key = rowKeyOf(row, index);
    seen.add(key);
    const previous = beforeByKey.get(key);
    if (!previous) { changed.push({ key, row, kind: 'added', index }); return; }
    if (!shallowRowEqual(previous, row)) changed.push({ key, row, kind: 'changed', index });
  });
  for (const [key] of beforeByKey) {
    if (!seen.has(key)) changed.push({ key, row: null, kind: 'removed' });
  }
  // Satır SIRASI değiştiyse yama yetmez: karşı ekranın sıralaması ayrışırdı.
  const removedKeys = new Set(changed.filter(item => item.kind === 'removed').map(item => item.key));
  const addedKeys = new Set(changed.filter(item => item.kind === 'added').map(item => item.key));
  const beforeOrder = beforeRows.map((row, index) => rowKeyOf(row, index)).filter(key => !removedKeys.has(key));
  const afterOrder = afterRows.map((row, index) => rowKeyOf(row, index)).filter(key => !addedKeys.has(key));
  if (beforeOrder.join(' ') !== afterOrder.join(' ')) return null;
  if (changed.length > MAX_PATCH_ROWS) return null;
  return changed;
}

async function saveWorkspaceAsync(ownerId, payload, expectedRevision = null) {
  return withFileLeaseAsync(workspaceFile(ownerId), async () => {
    const current = loadWorkspace(ownerId);
    if (expectedRevision != null && Number(expectedRevision) !== current._revision) {
      const error = new Error('Koleksiyon sayfası başka bir kullanıcı tarafından değiştirildi. Güncel sayfayı yeniden açın.');
      error.code = 'REVISION_CONFLICT';
      error.statusCode = 409;
      error.currentRevision = current._revision;
      error.expectedRevision = Number(expectedRevision);
      throw error;
    }
    await fsp.mkdir(ROOT, { recursive: true });
    const rows = normalizeRows(payload && payload.rows);
    const sourceCatalog = payload && Object.prototype.hasOwnProperty.call(payload, 'statusCatalog') ? payload.statusCatalog : current.statusCatalog;
    const saved = {
      schemaVersion: 1,
      ownerId: String(ownerId || ''),
      initialized: true,
      rows,
      manufacturers: normalizeManufacturers(payload && payload.manufacturers),
      customColumns: normalizeCustomColumns(payload && payload.customColumns),
      statusCatalog: normalizeStatusCatalog(sourceCatalog, rows),
      nextId: Math.max(Number(payload && payload.nextId) || 1, 1 + rows.reduce((max, row) => Math.max(max, Number(row && row.id) || 0), 0)),
      _legacyRecovery: cleanObject(payload && payload._legacyRecovery && Object.keys(payload._legacyRecovery).length ? payload._legacyRecovery : current._legacyRecovery),
      _revision: current._revision + 1,
      _updatedAt: new Date().toISOString(),
    };
    const rowPatches = diffWorkspaceRows(current, saved);
    await atomicWriteJsonAsync(workspaceFile(ownerId), saved);
    return { saved, rowPatches };
  });
}

/* ===================================================================
   v7.22 — SATIR BAZLI YAZMA VE SATIR BAZLI REVİZYON

   Saha bulgusu (v7.20 incelemesinde ölçüldü): revizyon kontrolü BÜTÜN SAYFA
   bazındaydı. A 1. satırı, B 900. satırı düzenlediğinde — aralarında hiçbir
   çakışma olmamasına rağmen — B'nin yazması REVISION_CONFLICT ile reddediliyor,
   istemci güncel sürümü yükleyip B'nin girişini atıyordu. Birebir çalıştırıldı:
   B'nin notu diskte yoktu.

   ÇÖZÜM: kilit birimi satır olur.

     · Her satır kendi _rev'ini taşır. Bir satırın yazılması yalnız O SATIRIN
       revizyonu beklenenle aynıysa kabul edilir. Farklı satırlara yazan iki
       kullanıcı artık birbirini engellemez.
     · Çakışan satır SESSİZCE EZİLMEZ ve sessizce atılmaz: sunucudaki güncel
       hâliyle birlikte çağırana bildirilir, kullanıcıya adıyla gösterilir.
     · SİLME, satırın yokluğundan çıkarılmaz — açık bir silme kaydı olarak
       gelir. (v7.20 incelemesinde "kullanıcı başına ayrı dosya" fikrini
       reddetme sebebim buydu: ayrı dosyalarda bir satırın yokluğu ile
       silinmiş olması ayırt edilemez.)

   NEYE SATIR BAZLI DAVRANILMAZ: sütun listesi, üretici listesi ve satır
   SIRASI satıra ait değildir; bunlar hâlâ sayfa revizyonuyla kilitlenir.
   Böyle bir değişiklik nadirdir ve kilidi hak eder.

   YAZMA BİRİMİ hâlâ tek dosyadır — tek gerçek kaydı korunur, dolayısıyla
   silme ve sıralama belirsizleşmez. Değişen şey, İSTEMCİDEN SUNUCUYA GELEN
   yükün ve çakışma biriminin satıra inmesi.
   =================================================================== */

function rowId(row) {
  const id = row && row.id;
  return id == null || id === '' ? '' : String(id);
}
// Eski dosyalar _rev taşımaz; ilk yazmada sessizce 0'dan başlatılırlar.
function rowRev(row) { return Math.max(0, Number(row && row._rev) || 0); }
function structureSignature(workspace) {
  return JSON.stringify({
    columns: workspace.customColumns || [],
    manufacturers: workspace.manufacturers || [],
    statusCatalog: workspace.statusCatalog || [],
  });
}

/* Satır bazlı değişiklikleri uygular.

   change = {
     baseRevision,            // yalnız yapısal değişiklik varsa zorunlu
     upserts: [{ ...row, _rev }],   // _rev: istemcinin dayandığı satır revizyonu
     deletes: [{ id, _rev }],
     structure: { manufacturers?, customColumns?, order? },  // isteğe bağlı
     nextId,
   }

   Döner: { saved, applied, conflicts, rowPatches } */
function applyRowChanges(current, change) {
  const upserts = Array.isArray(change && change.upserts) ? change.upserts : [];
  const deletes = Array.isArray(change && change.deletes) ? change.deletes : [];
  const structure = change && change.structure && typeof change.structure === 'object' ? change.structure : null;

  const rows = (Array.isArray(current.rows) ? current.rows : []).map(row => ({ ...row }));
  const indexById = new Map();
  rows.forEach((row, index) => { const id = rowId(row); if (id) indexById.set(id, index); });

  const applied = [], conflicts = [];
  const nextRev = rowRev({ _rev: current._revision }) + 1; // yeni satır revizyonu sayfa revizyonuyla ilerler

  for (const incoming of upserts) {
    const id = rowId(incoming);
    if (!id) { conflicts.push({ id: null, reason: 'missing-id', current: null }); continue; }
    const index = indexById.get(id);
    if (index == null) {
      // Yeni satır. Aynı id sunucuda YOKSA ekleme kabul edilir.
      const row = { ...incoming, _rev: nextRev };
      rows.push(row);
      indexById.set(id, rows.length - 1);
      applied.push({ id, kind: 'added', row });
      continue;
    }
    const stored = rows[index];
    const expected = rowRev(incoming);
    if (rowRev(stored) !== expected) {
      // GERÇEK çakışma: aynı satır, bu istemci okuduğundan beri değişmiş.
      // Ezme yok, sessiz atma yok — güncel hâliyle birlikte bildirilir.
      conflicts.push({ id, reason: 'row-revision', current: stored, expectedRev: expected, currentRev: rowRev(stored) });
      continue;
    }
    const row = { ...incoming, _rev: rowRev(stored) + 1 };
    rows[index] = row;
    applied.push({ id, kind: 'changed', row });
  }

  const removedIds = new Set();
  for (const item of deletes) {
    const id = rowId(item);
    if (!id) continue;
    const index = indexById.get(id);
    if (index == null) { applied.push({ id, kind: 'removed' }); continue; } // zaten yok: istenen sonuç sağlanmış
    const stored = rows[index];
    const expected = rowRev(item);
    /* Silme de satır revizyonuna tabidir: birisi o satırı bu arada
       düzenlediyse silme sessizce uygulanmaz.

       DİKKAT: revizyonun VERİLMEMİŞ olmasıyla SIFIR olması aynı şey değildir.
       v7.21 ve öncesinden kalan satırlar _rev taşımaz ve revizyonları 0'dır;
       "0 ise kontrol etme" demek, tam da o eski satırlarda silmeyi denetimsiz
       bırakmak olurdu. Bu yüzden alanın VARLIĞINA bakılır. */
    const hasExpected = item && Object.prototype.hasOwnProperty.call(item, '_rev') && item._rev != null;
    if (hasExpected && rowRev(stored) !== expected) {
      conflicts.push({ id, reason: 'row-revision-delete', current: stored, expectedRev: expected, currentRev: rowRev(stored) });
      continue;
    }
    removedIds.add(id);
    applied.push({ id, kind: 'removed' });
  }
  /* ATOMİK PARTİ (Excel içe aktarma).

     Normal düzenleme yolunda çakışmayan satırların yazılıp çakışanların
     raporlanması DOĞRU davranıştır: iki kişinin ayrı satırlara yazması
     birbirini engellememeli. Ama onaylanmış bir içe aktarma planı TEK bir
     işlemdir — 150. satırda çakışma çıkarsa 1–149 sessizce "başarılı"
     sayılamaz. `atomic` isteyen çağıran için tek bir çakışma bile bütün
     partiyi düşürür ve dosyaya HİÇBİR ŞEY yazılmaz. */
  if (change && change.atomic === true && conflicts.length) {
    const error = new Error('İçe aktarma sırasında bazı satırlar başka bir kullanıcı tarafından değiştirilmiş. Hiçbir satır yazılmadı.');
    error.code = 'COLLECTION_ATOMIC_CONFLICT';
    error.statusCode = 409;
    error.currentRevision = current._revision;
    error.conflicts = conflicts;
    throw error;
  }
  const survivors = removedIds.size ? rows.filter(row => !removedIds.has(rowId(row))) : rows;

  let ordered = survivors;
  let structureChanged = false;
  const saved = {
    schemaVersion: 1,
    ownerId: current.ownerId,
    initialized: true,
    rows: ordered,
    manufacturers: current.manufacturers || [],
    customColumns: current.customColumns || [],
    statusCatalog: normalizeStatusCatalog(current.statusCatalog, survivors),
    nextId: current.nextId || 1,
    _legacyRecovery: cleanObject(current._legacyRecovery),
    _revision: current._revision,
    _updatedAt: current._updatedAt,
  };

  if (structure) {
    // Yapısal değişiklik satıra ait değildir; sayfa revizyonuyla kilitlenir.
    if (change.baseRevision != null && Number(change.baseRevision) !== Number(current._revision)) {
      const error = new Error('Koleksiyon sayfasının sütun/üretici düzeni başka bir kullanıcı tarafından değiştirildi. Güncel sayfayı yeniden açın.');
      error.code = 'STRUCTURE_REVISION_CONFLICT';
      error.statusCode = 409;
      error.currentRevision = current._revision;
      throw error;
    }
    if (Array.isArray(structure.manufacturers)) saved.manufacturers = normalizeManufacturers(structure.manufacturers);
    if (Array.isArray(structure.customColumns)) saved.customColumns = normalizeCustomColumns(structure.customColumns);
    if (Array.isArray(structure.statusCatalog)) saved.statusCatalog = normalizeStatusCatalog(structure.statusCatalog, saved.rows);
    if (Array.isArray(structure.order)) {
      // Sıra yalnız VERİLEN id'lerle yeniden dizilir; listede olmayan satırlar
      // DÜŞÜRÜLMEZ, sonuna eklenir. Sessiz satır kaybı olmaz (§142).
      const wanted = structure.order.map(String);
      const byId = new Map(saved.rows.map(row => [rowId(row), row]));
      const next = [];
      for (const id of wanted) { const row = byId.get(id); if (row) { next.push(row); byId.delete(id); } }
      for (const row of byId.values()) next.push(row);
      saved.rows = next;
    }
    structureChanged = structureSignature(saved) !== structureSignature(current)
      || (Array.isArray(structure.order) && saved.rows.map(rowId).join(' ') !== survivors.map(rowId).join(' '));
  }

  const changed = applied.length > 0 || structureChanged;
  if (changed) {
    saved._revision = Number(current._revision || 0) + 1;
    saved._updatedAt = new Date().toISOString();
  }
  saved.rows = normalizeRows(saved.rows);
  const maxRowId = saved.rows.reduce((max, row) => Math.max(max, Number(row && row.id) || 0), 0);
  saved.nextId = Math.max(Number(change && change.nextId) || 1, Number(current.nextId) || 1, maxRowId + 1);

  // Canlı yayın için yama: uygulanan satırlar. Yapısal değişiklikte yama
  // yetmez (karşı ekranın sütunları/sırası ayrışırdı) → yeniden yükleme.
  const rowPatches = structureChanged ? null : applied.map(item => (
    item.kind === 'removed'
      ? { key: `id:${item.id}`, kind: 'removed', row: null }
      : { key: `id:${item.id}`, kind: item.kind, row: item.row }
  ));

  return { saved, applied, conflicts, rowPatches, changed };
}

async function applyRowChangesAsync(ownerId, change) {
  return withFileLeaseAsync(workspaceFile(ownerId), async () => {
    const current = loadWorkspace(ownerId);
    const result = applyRowChanges(current, change);
    // Hiçbir şey uygulanmadıysa (hepsi çakıştı) dosyaya dokunma: gereksiz
    // yazma, gereksiz revizyon artışı ve gereksiz canlı olay üretmez.
    if (result.changed) await atomicWriteJsonAsync(workspaceFile(ownerId), result.saved);
    return result;
  });
}

// Sahip-bazlı replikasyon uzak, yetkili belgenin yerel kopyasını yalnızca
// daha yeni/eşit revizyonla yazar. Yerelde daha yeni bir değişiklik varsa bu
// fonksiyon onu ezmez; çağıran bu durumu senkron çakışması olarak ele alır.
async function replaceWorkspaceReplica(ownerId, raw) {
  return withFileLeaseAsync(workspaceFile(ownerId), async () => {
    const current = loadWorkspace(ownerId);
    const incoming = normalizeWorkspace(ownerId, raw);
    if (Number(current._revision) > Number(incoming._revision)) return { applied: false, reason: 'LOCAL_NEWER', workspace: current };
    await fsp.mkdir(ROOT, { recursive: true });
    await atomicWriteJsonAsync(workspaceFile(ownerId), incoming);
    return { applied: true, workspace: incoming };
  });
}

/* ===================================================================
   v10.90 — KOLEKSİYON SATIRLARINDAKİ GÖRSEL SAHİPLİĞİNİN SIFIRLANMASI

   Koleksiyon satırı görseli iki alanda taşır: imgRef (kalıcı depodaki
   ci_ kimliği) ve img (çözümlenmiş URL, ya da sunucu deposu yokken
   geriye uyumluluk için gömülü data URL'i). İkisinin de tek işi "bu
   satır şu anda şu görsele sahip" demektir.

   "Tüm Görselleri Sil" depoyu boşalttığında bu alanlar temizlenmezse
   satır hâlâ /api/collection-images/ci_xxx çözer, 404 alır ve hücrede
   kırık görsel simgesi kalır. PLM ID, Colour Code, fiyat, not gibi iş
   alanlarına dokunulmaz.
   =================================================================== */
const ROW_IMAGE_FIELDS = ['img', 'imgRef'];
function rowImageRefCount(row) {
  return ROW_IMAGE_FIELDS.reduce((total, field) => total + (String(row && row[field] == null ? '' : row[field]).trim() ? 1 : 0), 0);
}
function listOwnerIds() {
  const ids = new Set();
  try {
    for (const name of fs.readdirSync(ROOT)) if (name.endsWith('.json')) ids.add(name.slice(0, -'.json'.length));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const prefix = 'collection-workspaces/';
  for (const id of documents.keys(prefix)) {
    if (id.endsWith('.json')) ids.add(id.slice(prefix.length, -'.json'.length));
  }
  return [...ids];
}
function countRowImages() {
  let rows = 0, refs = 0;
  for (const ownerId of listOwnerIds()) {
    for (const row of loadWorkspace(ownerId).rows) {
      const count = rowImageRefCount(row);
      if (count) { rows += 1; refs += count; }
    }
  }
  return { rows, refs };
}
function clearAllRowImages() {
  let workspaces = 0, rows = 0, refs = 0;
  for (const ownerId of listOwnerIds()) {
    const current = loadWorkspace(ownerId);
    let touched = 0, touchedRefs = 0;
    const nextRows = current.rows.map(row => {
      const count = rowImageRefCount(row);
      if (!count) return row;
      touched += 1; touchedRefs += count;
      return { ...row, img: '', imgRef: '' };
    });
    // Görseli olmayan çalışma alanı hiç yazılmaz: boş sistemde yeniden
    // çalıştırmak revizyonu boşuna artırmaz ve işlem idempotent kalır.
    if (!touched) continue;
    saveWorkspace(ownerId, { ...current, rows: nextRows }, current._revision);
    workspaces += 1; rows += touched; refs += touchedRefs;
  }
  return { workspaces, rows, refs };
}

module.exports = {
  attachDeltaStore,
  listOwnerIds, countRowImages, clearAllRowImages,
  loadWorkspace, saveWorkspace, saveWorkspaceAsync, diffWorkspaceRows,
  applyRowChanges, applyRowChangesAsync, rowRev, rowId,
  defaultWorkspace, normalizeStatusCatalog, safeId, workspaceFile, replaceWorkspaceReplica, MAX_PATCH_ROWS,
  SHARED_COLLECTION_OWNER, ensureSharedWorkspace, mergePersonalBackupIntoShared, recoverSharedWorkspaceIntoOwner, mirrorWorkspace,
  recoveryRowIdentity, recoveryRowsCompatible, recoveryRowFingerprint,
};
