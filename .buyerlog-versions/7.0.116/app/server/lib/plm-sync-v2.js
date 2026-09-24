'use strict';

const crypto = require('crypto');

const PLM_FIELD_OWNERSHIP = Object.freeze({
  PLM_OWNED: Object.freeze(['plmId', 'styleId', 'styleName', 'specialCode', 'season', 'url', 'plmLink', 'plmImage', 'plmDocuments', 'files', 'imageSource', 'sourceRevision']),
  BUYER_LOG_OWNED: Object.freeze(['buyerNotes', 'notes', 'manualPricing', 'confirmedManufacturer', 'confirmedFob', 'confirmedFOB', 'userTags', 'permissions', 'manualOverrides', 'targetPrice']),
  DERIVED: Object.freeze(['bestPrice', 'landedPrice', 'variance', 'status']),
});

function normalizeScalar(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    // PLM file/reference lists are order-insensitive. Primitive arrays can be
    // safely sorted; object arrays keep order unless they expose a stable id.
    if (normalized.every(item => item == null || ['string','number','boolean'].includes(typeof item))) {
      return normalized.slice().sort((a, b) => String(a).localeCompare(String(b)));
    }
    if (normalized.every(item => item && typeof item === 'object' && (item.id || item.url || item.path || item.name))) {
      return normalized.slice().sort((a, b) => String(a.id || a.url || a.path || a.name).localeCompare(String(b.id || b.url || b.path || b.name)));
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === 'updatedAt' || key === 'updatedBy' || key === 'updatedById') continue;
      const normalized = canonicalize(value[key]);
      out[key] = normalized;
    }
    return out;
  }
  return normalizeScalar(value);
}

function stableStringify(value) { return JSON.stringify(canonicalize(value)); }
function fingerprint(value) { return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex'); }
function plmFingerprint(record) {
  const source = {};
  const keys = PLM_FIELD_OWNERSHIP.PLM_OWNED;
  for (const key of keys) if (record && Object.prototype.hasOwnProperty.call(record, key)) source[key] = record[key];
  return fingerprint(source);
}

function equalMeaningful(a, b) { return stableStringify(a) === stableStringify(b); }

function diffPlmRecords(previous = {}, next = {}) {
  const added = [], updated = [], removed = [], unchanged = [];
  const ids = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  for (const id of ids) {
    const before = previous && previous[id], after = next && next[id];
    if (before == null && after != null) { added.push({ id, value: after }); continue; }
    if (before != null && after == null) { removed.push({ id, value: before }); continue; }
    if (plmFingerprint(before) === plmFingerprint(after)) unchanged.push({ id, value: after });
    else updated.push({ id, before, value: after });
  }
  return { added, updated, removed, unchanged, changedCount: added.length + updated.length + removed.length };
}

function assertEventAmplification({ changedCount = 0, generatedEventCount = 0, absoluteFloor = 500, multiplier = 5 } = {}) {
  const changed = Math.max(0, Number(changedCount) || 0);
  const generated = Math.max(0, Number(generatedEventCount) || 0);
  if (!changed && generated) {
    const error = new Error('PLM_SYNC_EVENT_AMPLIFICATION_DETECTED');
    error.code = 'PLM_SYNC_EVENT_AMPLIFICATION_DETECTED';
    error.changedCount = changed; error.generatedEventCount = generated; throw error;
  }
  const safeMax = Math.max(changed * Math.max(1, Number(multiplier) || 5), Math.max(1, Number(absoluteFloor) || 500));
  if (generated > safeMax) {
    const error = new Error('PLM_SYNC_EVENT_AMPLIFICATION_DETECTED');
    error.code = 'PLM_SYNC_EVENT_AMPLIFICATION_DETECTED';
    error.changedCount = changed; error.generatedEventCount = generated; error.safeMax = safeMax; throw error;
  }
  return { ok: true, changedCount: changed, generatedEventCount: generated, ratio: changed ? generated / changed : 0, safeMax };
}

function buildPlmRunSummary(input = {}) {
  const summary = {
    checked: Number(input.checked) || 0,
    changed: Number(input.changed) || 0,
    unchanged: Number(input.unchanged) || 0,
    added: Number(input.added) || 0,
    removed: Number(input.removed) || 0,
    imagesDownloaded: Number(input.imagesDownloaded) || 0,
    documentsDownloaded: Number(input.documentsDownloaded) || 0,
    failed: Number(input.failed) || 0,
    deltaEvents: Number(input.deltaEvents) || 0,
  };
  summary.amplificationRatio = summary.changed ? summary.deltaEvents / summary.changed : 0;
  return summary;
}

function mergePlmOwned(previous = {}, incoming = {}, { allowEmptyDeletes = false } = {}) {
  const out = { ...(previous || {}) };
  for (const key of PLM_FIELD_OWNERSHIP.PLM_OWNED) {
    if (!Object.prototype.hasOwnProperty.call(incoming || {}, key)) continue;
    const value = incoming[key];
    const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
    if (empty && !allowEmptyDeletes && previous && previous[key] != null && previous[key] !== '' && (!Array.isArray(previous[key]) || previous[key].length)) continue;
    out[key] = value;
  }
  return out;
}

module.exports = {
  PLM_FIELD_OWNERSHIP, canonicalize, stableStringify, fingerprint, plmFingerprint,
  equalMeaningful, diffPlmRecords, assertEventAmplification, buildPlmRunSummary, mergePlmOwned,
};
