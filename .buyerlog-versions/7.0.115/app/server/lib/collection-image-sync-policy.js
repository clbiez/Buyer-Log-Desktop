'use strict';

const COLLECTION_SCOPE = 'koleksiyon';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function scopeUsesSharedImages(scope) {
  return clean(scope).toLocaleLowerCase('tr-TR') === COLLECTION_SCOPE;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value != null && clean(value)) return clean(value);
  }
  return '';
}

function rowImageIdentity(row) {
  if (!row || typeof row !== 'object') return null;
  const imageRef = firstValue(row, ['imgRef', 'imageRef', '_imageRef']);
  const plmId = firstValue(row, ['plmId', 'plm', 'PLM ID', 'PLM Kod', 'PLM Code']);
  if (!imageRef || !plmId) return null;
  return {
    imageRef,
    plmId,
    colourCode: firstValue(row, ['ccode', 'colourCode', 'colorCode', 'Renk Kodu', 'Colour Code', 'Color Code']),
    colour: firstValue(row, ['colour', 'color', 'Renk', 'Colour', 'Color']),
    recordId: firstValue(row, ['recordId', '_sharedRecordId', 'id']),
  };
}

function workspaceImageItems(workspace) {
  const rows = Array.isArray(workspace && workspace.rows) ? workspace.rows : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const item = rowImageIdentity(row);
    if (!item) continue;
    const key = [item.plmId, item.colourCode, item.colour, item.imageRef].join('|').toLocaleUpperCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function shouldPublishOwnerImages(outgoingGrants, ownerId) {
  const owner = clean(ownerId);
  return Boolean(owner && (Array.isArray(outgoingGrants) ? outgoingGrants : []).some(grant =>
    clean(grant && grant.ownerId) === owner &&
    ['view', 'edit'].includes(clean(grant && grant.level).toLowerCase())
  ));
}

module.exports = {
  COLLECTION_SCOPE,
  scopeUsesSharedImages,
  rowImageIdentity,
  workspaceImageItems,
  shouldPublishOwnerImages,
};
