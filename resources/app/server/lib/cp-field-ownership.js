'use strict';

// Saf karar; sipariş sahipliği Moderatör-ASAS orderAccess + doğrulanmış IAM'den.
const crypto = require('node:crypto');
const { identityKeys } = require('./iam-core');
const { orderCodeOfKey } = require('./override-scope');

function clean(value) { return String(value == null ? '' : value).trim(); }
function norm(value) { return clean(value).toLocaleUpperCase('tr-TR'); }
function createOwnershipResolver(orderAccess, profiles = []) {
  const identities = new Map(), legacyNames = new Map();
  function add(map, key, profile) {
    if (!key || !profile || !clean(profile.id)) return;
    if (!map.has(key)) map.set(key, new Map());
    map.get(key).set(clean(profile.id), profile);
  }
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile) continue;
    for (const key of identityKeys(profile.stableIds)) add(identities, key, profile);
    // buyerDirectoryEntries ile aynı legacy kimlik yolu; keyfi scope/hiyerarşi yok.
    add(legacyNames, norm(profile.username || profile.displayName), profile);
  }
  function resolveBuyer(name) {
    const normalized = norm(name);
    if (!normalized) return null;
    const buyerId = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
    const matches = new Map();
    for (const key of identityKeys({ buyerId, sourceId: `asas-buyer:${buyerId}` })) {
      for (const [id, profile] of identities.get(key) || []) matches.set(id, profile);
    }
    if (!matches.size) for (const [id, profile] of legacyNames.get(normalized) || []) matches.set(id, profile);
    return matches.size === 1 ? [...matches.values()][0] : null;
  }
  function forRows(actor, rows) {
    const userId = clean(actor && actor.userId), systemRole = clean(actor && actor.systemRole);
    if (systemRole === 'moderator') return { allowed: true, known: true, moderator: true, ownerUserIds: [], ownerNames: [], reason: 'moderator' };
    if (!Array.isArray(rows) || !rows.length) return { allowed: true, known: false, ownerUserIds: [], ownerNames: [], reason: 'unknown-order' };
    const owners = rows.map(row => resolveBuyer(row && row.buyer));
    if (owners.some(owner => !owner)) return { allowed: true, known: false, ownerUserIds: [], ownerNames: rows.map(row => clean(row && row.buyer)).filter(Boolean), reason: 'unknown-owner' };
    const ownerUserIds = [...new Set(owners.map(owner => clean(owner.id)))];
    const ownerNames = [...new Set(rows.map(row => clean(row && row.buyer)))];
    // Eski sipariş-bazlı anahtar tüm ASAS satırlarına uygulanır: hepsi aynı kişiye ait olmalı.
    if (!userId) return { allowed:true, known:false, authorityKnown:true, ownerUserIds, ownerNames, reason:'unknown-user' };
    const allowed = ownerUserIds.every(id => id === userId);
    return { allowed, known: true, authorityKnown:true, ownerUserIds, ownerNames, reason: allowed ? 'owner' : 'foreign-owner' };
  }
  const resolve = actor => {
    const id = clean(actor && actor.recordId).replace(/^cp-order:/, ''), code = orderCodeOfKey(id);
    const result = forRows(actor, code == null ? [] : orderAccess && orderAccess[String(code)]);
    // orderAccess yalnız buyer/kapsam taşır; model/renk eşlemesi yoktur.
    // Çok sahipli siparişin kanonik satırını keyfi bir kişiye bağlamayız.
    if (id.includes('|') && result.authorityKnown && !result.moderator && result.ownerUserIds.length > 1) {
      return { ...result, allowed:true, known:false, authorityKnown:false, reason:'unknown-line-owner', orderCode:code };
    }
    return { ...result, orderCode: code };
  };
  resolve.forRows = forRows;
  return resolve;
}
function ownershipFor(actor, orderAccess, profiles) { return createOwnershipResolver(orderAccess, profiles)(actor); }
function isOwnerWrite(actor, orderAccess, profiles) { return ownershipFor(actor, orderAccess, profiles).allowed; }

module.exports = { createOwnershipResolver, ownershipFor, isOwnerWrite };
