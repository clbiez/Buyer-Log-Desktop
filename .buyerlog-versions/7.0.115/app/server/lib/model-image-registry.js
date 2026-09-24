'use strict';

const {
  normalizePlmImageId,
  normalizeCpImageColourCode,
  plmImageKey,
  plmColourImageKey,
} = require('./parse');

/* Canonical model-image identity. A PLM-only key is legacy migration data;
   coloured model reads/writes always require PLM ID + Colour Code. */
function identity(plmId, colourCode = '') {
  const plm = normalizePlmImageId(plmId);
  const colour = normalizeCpImageColourCode(colourCode);
  return { plmId: plm, colourCode: colour, key: plm && colour ? plmColourImageKey(plm, colour) : '' };
}

function resolveRef(imagemap, plmId, colourCode) {
  const item = identity(plmId, colourCode);
  if (!item.key || !imagemap || !Object.prototype.hasOwnProperty.call(imagemap, item.key)) return '';
  return String(imagemap[item.key] == null ? '' : imagemap[item.key]).trim();
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const value = item || {};
    const normalized = identity(value.plmId, value.colourCode);
    return {
      ...value,
      plmId: normalized.plmId || value.plmId,
      colourCode: normalized.colourCode,
      imageRef: value.imageRef == null ? '' : String(value.imageRef).trim(),
    };
  });
}

function migrationReport(imagemap) {
  const map = imagemap && typeof imagemap === 'object' ? imagemap : {};
  const entries = Object.entries(map);
  const canonical = entries.filter(([key]) => /^plm:[^|]+\|colour:.+$/i.test(key));
  const legacy = entries.filter(([key]) => /^plm:[^|]+$/i.test(key));
  const empty = entries.filter(([, ref]) => String(ref == null ? '' : ref).trim() === '');
  return { total: entries.length, canonical: canonical.length, legacy: legacy.length, tombstones: empty.length, canonicalNonEmpty: canonical.filter(([, ref]) => String(ref == null ? '' : ref).trim() !== '').length };
}

module.exports = { identity, resolveRef, normalizeItems, migrationReport, legacyKey: plmImageKey, canonicalKey: plmColourImageKey };
