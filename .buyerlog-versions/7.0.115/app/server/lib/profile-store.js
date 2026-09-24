'use strict';

// Görünüm ve filtre profillerinin ortak, kullanıcı/tablo kapsamlı veri modeli.
// Dosya erişimi db.js'de kalır; bu modül yalnız normalizasyon ve seçim kurallarını
// merkezi tutar. Böylece eski profile dosyaları da aynı kurallarla yükseltilir.
const PROFILE_SCHEMA_VERSION = 2;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function pageOf(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  return asString(raw.tableId || raw.moduleId || raw.page || data.__page || data.page);
}

function itemTime(item) {
  const value = item && (item.updatedAt || item.createdAt);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recent(items) {
  return [...items].sort((a, b) => itemTime(b) - itemTime(a) || String(b.id).localeCompare(String(a.id)))[0] || null;
}

function pageItems(store, page) {
  const wanted = asString(page);
  return (store.items || []).filter(item => item && asString(item.tableId || item.moduleId || item.page || item.data && item.data.__page || item.data && item.data.page) === wanted);
}

function normalizedItem(raw, { userId = null } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const data = source.data && typeof source.data === 'object' ? clone(source.data) : {};
  const page = pageOf(source);
  if (page && !data.__page) data.__page = page;
  const id = asString(source.id) || `legacy-${Math.random().toString(36).slice(2)}`;
  return {
    ...clone(source),
    id,
    name: asString(source.name) || id,
    userId: asString(userId) || asString(source.userId) || null,
    moduleId: asString(source.moduleId) || page || null,
    tableId: asString(source.tableId) || page || null,
    isFavorite: Boolean(source.isFavorite),
    isDefault: Boolean(source.isDefault),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || source.createdAt || null,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    data,
  };
}

function normalizeProfileStore(raw, { userId = null, kind = 'profile' } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems
    .filter(item => item && asString(item.page || item.data && (item.data.page || item.data.__page)) !== 'appr')
    .map(item => normalizedItem(item, { userId }));
  const byId = new Map(items.map(item => [item.id, item]));
  const pages = [...new Set(items.map(pageOf).filter(Boolean))];
  const legacyFavoriteId = asString(source.favoriteId);
  const hasFavoriteMap = Boolean(source.favoriteByPage && typeof source.favoriteByPage === 'object');
  const rawFavoriteByPage = hasFavoriteMap ? source.favoriteByPage : {};
  const favoriteByPage = {};
  const lastUsedByPage = {};

  const rawLastUsed = source.lastUsedByPage && typeof source.lastUsedByPage === 'object' ? source.lastUsedByPage : {};
  pages.forEach(page => {
    const candidates = items.filter(item => pageOf(item) === page);
    const configured = asString(rawFavoriteByPage[page]);
    const legacyItem = legacyFavoriteId && byId.get(legacyFavoriteId);
    const flagged = candidates.find(item => item.isDefault || item.isFavorite);
    const selected = (configured && candidates.some(item => item.id === configured) && configured)
      || (legacyItem && pageOf(legacyItem) === page ? legacyFavoriteId : '')
      || (flagged && flagged.id)
      // A v2 map with no page entry explicitly means system default. Older
      // stores have no map, so their existing records are promoted once.
      || (!hasFavoriteMap && recent(candidates) && recent(candidates).id);
    if (selected) favoriteByPage[page] = selected;

    const used = asString(rawLastUsed[page]);
    if (used && candidates.some(item => item.id === used)) lastUsedByPage[page] = used;
  });

  items.forEach(item => {
    const page = pageOf(item);
    const favorite = Boolean(page && favoriteByPage[page] === item.id);
    item.isFavorite = favorite;
    item.isDefault = favorite;
  });
  const firstFavorite = pages.map(page => favoriteByPage[page]).find(Boolean) || null;
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    kind: asString(kind) || asString(source.kind) || 'profile',
    userId: asString(userId) || asString(source.userId) || null,
    favoriteByPage,
    lastUsedByPage,
    // Retained for old clients/backups. New code reads favoriteByPage.
    favoriteId: firstFavorite,
    items,
    _revision: Number.isInteger(Number(source._revision)) && Number(source._revision) >= 0 ? Number(source._revision) : 0,
    _updatedAt: source._updatedAt || null,
  };
}

function resolveFavoriteId(store, page) {
  const normalized = normalizeProfileStore(store, { userId: store && store.userId, kind: store && store.kind });
  const items = pageItems(normalized, page);
  if (!items.length) return null;
  const configured = asString(normalized.favoriteByPage[asString(page)]);
  if (configured && items.some(item => item.id === configured)) return configured;
  const defaultItem = items.find(item => item.isDefault || item.isFavorite);
  if (defaultItem) return defaultItem.id;
  const lastUsed = asString(normalized.lastUsedByPage[asString(page)]);
  if (lastUsed && items.some(item => item.id === lastUsed)) return lastUsed;
  return null;
}

function withFavoriteFlags(store, favoriteByPage) {
  const next = { ...store, favoriteByPage: { ...favoriteByPage } };
  next.items = (store.items || []).map(item => {
    const page = pageOf(item);
    const selected = Boolean(page && next.favoriteByPage[page] === item.id);
    return { ...item, isFavorite: selected, isDefault: selected, schemaVersion: PROFILE_SCHEMA_VERSION };
  });
  next.favoriteId = Object.values(next.favoriteByPage).find(Boolean) || null;
  next.schemaVersion = PROFILE_SCHEMA_VERSION;
  return next;
}

function setFavorite(store, id) {
  const normalized = normalizeProfileStore(store, { userId: store && store.userId, kind: store && store.kind });
  const wanted = asString(id);
  const item = normalized.items.find(candidate => candidate.id === wanted);
  if (!item) throw new Error('Profil bulunamadı: ' + wanted);
  const page = pageOf(item);
  return withFavoriteFlags(normalized, { ...normalized.favoriteByPage, [page]: wanted });
}

function markUsed(store, id) {
  const normalized = normalizeProfileStore(store, { userId: store && store.userId, kind: store && store.kind });
  const item = normalized.items.find(candidate => candidate.id === asString(id));
  if (!item) return normalized;
  const page = pageOf(item);
  return { ...normalized, lastUsedByPage: { ...normalized.lastUsedByPage, [page]: item.id } };
}

function removeProfile(store, id) {
  const normalized = normalizeProfileStore(store, { userId: store && store.userId, kind: store && store.kind });
  const wanted = asString(id);
  const removed = normalized.items.find(item => item.id === wanted);
  if (!removed) return normalized;
  const page = pageOf(removed);
  const next = {
    ...normalized,
    items: normalized.items.filter(item => item.id !== wanted),
    lastUsedByPage: { ...normalized.lastUsedByPage },
    favoriteByPage: { ...normalized.favoriteByPage },
  };
  if (next.lastUsedByPage[page] === wanted) delete next.lastUsedByPage[page];
  if (next.favoriteByPage[page] === wanted || !next.items.some(item => item.id === next.favoriteByPage[page])) {
    const remaining = pageItems(next, page);
    // Another explicit default wins first; otherwise the last used valid item.
    // If neither exists, the empty favorite map means system default.
    const anotherDefault = remaining.find(item => item.isDefault || item.isFavorite);
    const lastUsed = asString(next.lastUsedByPage[page]);
    const fallback = anotherDefault?.id
      || (lastUsed && remaining.some(item => item.id === lastUsed) ? lastUsed : '')
      || null;
    if (fallback) next.favoriteByPage[page] = fallback;
    else delete next.favoriteByPage[page];
  }
  return withFavoriteFlags(next, next.favoriteByPage);
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  pageOf,
  pageItems,
  normalizeProfileStore,
  resolveFavoriteId,
  setFavorite,
  markUsed,
  removeProfile,
};
