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

/* PLM ID'si olmayan konsept modelde kullanıcının elle yüklediği görsel de
   yetkili kullanıcılara taşınmalıdır. PLM kimliği varsa o kullanılır (yukarıdaki
   sözleşme değişmez); yoksa görsel sahip kapsamlı satır kimliğiyle paylaşılır.
   Anahtar her zaman "collection:<owner>:" önekiyle kullanılır. */
function rowSharedImageIdentity(row) {
  const identity = rowImageIdentity(row);
  if (identity) return identity;
  const imageRef = firstValue(row, ['imgRef', 'imageRef', '_imageRef']);
  const recordId = firstValue(row, ['recordId', '_sharedRecordId', 'id']);
  const plmId = firstValue(row, ['plmId', 'plm', 'PLM ID', 'PLM Kod', 'PLM Code']);
  // A PLM image may live in the local imagemap without an explicit row imgRef.
  // The recipient still needs a row identity to request its owner-scoped image.
  if (plmId && recordId) return {
    imageRef, plmId,
    colourCode: firstValue(row, ['ccode', 'colourCode', 'colorCode', 'Renk Kodu', 'Colour Code', 'Color Code']),
    colour: firstValue(row, ['colour', 'color', 'Renk', 'Colour', 'Color']),
    recordId,
  };
  if (!imageRef || !recordId) return null;
  return { imageRef, plmId: '', colourCode: '', colour: '', recordId, rowKey: 'row:' + recordId };
}

function workspaceSharedImageItems(workspace) {
  const rows = Array.isArray(workspace && workspace.rows) ? workspace.rows : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const item = rowSharedImageIdentity(row);
    if (!item) continue;
    // Satır kimlikli öğede satır da anahtara girer: aynı görseli taşıyan iki
    // PLM'siz satırın her biri kendi görselini almalı.
    const key = [item.plmId, item.colourCode, item.colour, item.imageRef, item.rowKey || ''].join('|').toLocaleUpperCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sharedImageKey(item, plmKey) {
  return clean(plmKey) || clean(item && item.rowKey);
}

/* Model yenilemesi yalnızca sahibin gerçekten var olan Koleksiyon
 * satırlarını paylaşabilir. PLM/ASAS kaynak kimlikleri aynı yerel depoda
 * kalsa bile Koleksiyon dışındaki CP/Orders kayıtları aktarılmaz. */
function workspaceModelImageKeys(workspace, toCanonicalKey) {
  const keys = new Set();
  if (typeof toCanonicalKey !== 'function') return keys;
  for (const row of Array.isArray(workspace && workspace.rows) ? workspace.rows : []) {
    const plmId = firstValue(row, ['plmId', 'plm', 'PLM ID', 'PLM Kod', 'PLM Code']);
    if (!plmId) continue;
    const item = {
      plmId,
      colourCode: firstValue(row, ['ccode', 'colourCode', 'colorCode', 'Renk Kodu', 'Colour Code', 'Color Code']),
      colour: firstValue(row, ['colour', 'color', 'Renk', 'Colour', 'Color']),
    };
    const key = clean(toCanonicalKey(item));
    if (key) keys.add(key);
  }
  return keys;
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
  rowSharedImageIdentity,
  workspaceSharedImageItems,
  workspaceModelImageKeys,
  sharedImageKey,
  shouldPublishOwnerImages,
};
