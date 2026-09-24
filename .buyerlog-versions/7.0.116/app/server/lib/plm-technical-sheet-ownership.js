'use strict';

const { normalizePlmId } = require('./plm-id');

function normalizeTechnicalSheetPlmId(value) {
  return normalizePlmId(value);
}

function canonicalTechnicalSheetKey(plmId) {
  const normalized = normalizeTechnicalSheetPlmId(plmId);
  return normalized ? `plm-tp-${normalized}` : '';
}

function plmIdFromCanonicalTechnicalSheetKey(key) {
  const value = String(key == null ? '' : key).trim();
  return value.startsWith('plm-tp-') ? normalizeTechnicalSheetPlmId(value.slice('plm-tp-'.length)) : '';
}

function languageOf(item) {
  return String(item && item.plmLanguage || 'en').trim().toLowerCase() || 'en';
}

/* Mutates only the metadata index. storedName is deliberately never changed,
   so migration neither copies nor deletes a user’s existing PDF. */
function resolveTechnicalSheetOwnership(index, plmIds, options = {}) {
  const fileExists = typeof options.fileExists === 'function' ? options.fileExists : () => true;
  const ids = [...new Set((Array.isArray(plmIds) ? plmIds : [])
    .map(normalizeTechnicalSheetPlmId).filter(Boolean))];
  const migrated = [];
  const conflicts = [];
  const statusByPlmId = {};
  const requestedIds = new Set(ids);
  const sheetsByPlmId = new Map(ids.map(plmId => [plmId, []]));
  (Array.isArray(index) ? index : []).forEach(item => {
    if (!item || item.plmSource !== 'technical-sheet') return;
    const plmId = normalizeTechnicalSheetPlmId(item.plmId);
    if (requestedIds.has(plmId)) sheetsByPlmId.get(plmId).push(item);
  });

  ids.forEach(plmId => {
    const canonicalKey = canonicalTechnicalSheetKey(plmId);
    const sheets = sheetsByPlmId.get(plmId) || [];
    const live = [];
    const stale = [];
    sheets.forEach(item => {
      let exists = false;
      try { exists = Boolean(fileExists(item)); } catch (_) { exists = false; }
      (exists ? live : stale).push(item);
    });
    const canonical = live.filter(item => item.modelKey === canonicalKey);
    const legacy = live.filter(item => item.modelKey !== canonicalKey);
    let conflict = null;

    if (canonical.length > 1) {
      conflict = { plmId, fileIds: canonical.map(item => item.id), code: 'PLM_TP_CANONICAL_CONFLICT' };
      conflicts.push(conflict);
    } else if (!canonical.length && legacy.length === 1) {
      legacy[0].modelKey = canonicalKey;
      canonical.push(legacy[0]);
      migrated.push({ plmId, id: legacy[0].id, language: languageOf(legacy[0]), modelKey: canonicalKey });
    } else if (!canonical.length && legacy.length > 1) {
      const languages = [...new Set(legacy.map(languageOf))].sort();
      conflict = {
        plmId,
        language: languages.length === 1 ? languages[0] : '',
        languages,
        fileIds: legacy.map(item => item.id),
        code: 'PLM_TP_LEGACY_CONFLICT',
      };
      conflicts.push(conflict);
    }

    const ready = !conflict && canonical.length === 1;
    const languages = ready ? [languageOf(canonical[0])] : [];
    const status = ready ? 'ready' : (conflict ? 'conflict' : (stale.length ? 'stale' : 'missing'));
    statusByPlmId[plmId] = { status, hasTechnicalSheet: ready, languages, conflict };
    if (status === 'stale') statusByPlmId[plmId].staleFileIds = stale.map(item => item.id);
  });

  return { migrated, conflicts, statusByPlmId };
}

module.exports = {
  normalizeTechnicalSheetPlmId,
  canonicalTechnicalSheetKey,
  plmIdFromCanonicalTechnicalSheetKey,
  resolveTechnicalSheetOwnership,
};
