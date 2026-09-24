'use strict';

/* CoreNectum PLM derin bağlantıları.

   CoreNectum'un kullanıcıya görünen PLM Code değeri, style-overview URL'sindeki
   styleId ile aynı değildir. Bu depo, yetkili kullanıcının CoreNectum Style List
   çıktısından içe aktardığı PLM Code -> styleId eşleşmesini uygulama genelinde
   kalıcı tutar. Oturum çerezi, erişim anahtarı veya parola saklanmaz. */

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const { plmFingerprint, assertEventAmplification, buildPlmRunSummary } = require('./plm-sync-v2');

const FILE = path.join(SERVER_DATA_ROOT, 'plm-style-links.json');
const MAX_LINKS = 100000;
const COLLECTION = 'plm-style-link';

/* Delta motoruna geçişin ilk store'u. Bağlama enjekte edilir: sunucu açılışta
   attachDeltaStore ile bağlar, testler kendi sahtesini verir, hiç bağlanmazsa
   dosya bugünkü gibi tek başına çalışır. Faz sözleşmesi delta-store.js'te. */
let deltaStore = null;
function attachDeltaStore(store) { deltaStore = store || null; return deltaStore; }
const BASE_URL = 'https://corenectum.lcwaikiki.com/models-options/style-overview';

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeNumericId(value) {
  let text = clean(value, 80).replace(/^_+/, '').replace(/\.(?=\d{3}(?:\D|$))/g, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  if (!/^\d+$/.test(text)) return '';
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : '';
}

function styleUrl(styleId) {
  const id = normalizeNumericId(styleId);
  return id ? `${BASE_URL}?styleId=${id}&m=2` : '';
}

function emptyStore() {
  return { schemaVersion: 1, links: {}, _revision: 0, _updatedAt: null };
}

function normalizeLink(raw, fallbackPlmId = '') {
  const plmId = normalizeNumericId(raw && (raw.plmId ?? raw.plmCode) || fallbackPlmId);
  const styleId = normalizeNumericId(raw && raw.styleId);
  if (!plmId || !styleId) return null;
  return {
    plmId,
    styleId,
    styleName: clean(raw && raw.styleName, 300),
    specialCode: clean(raw && (raw.specialCode ?? raw.erpCode), 120),
    season: clean(raw && (raw.season ?? raw.seasonName), 120),
    updatedAt: clean(raw && raw.updatedAt, 80) || null,
    updatedBy: clean(raw && raw.updatedBy, 160),
    updatedById: clean(raw && raw.updatedById, 120),
  };
}

function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._revision = Math.max(0, Number(raw._revision) || 0);
  out._updatedAt = clean(raw._updatedAt, 80) || null;
  const entries = raw.links && typeof raw.links === 'object' && !Array.isArray(raw.links)
    ? Object.entries(raw.links).slice(0, MAX_LINKS)
    : [];
  for (const [plmId, value] of entries) {
    const link = normalizeLink(value, plmId);
    if (link) out.links[link.plmId] = link;
  }
  return out;
}

function loadLegacyStore() {
  return readJsonWithValidatedBackup(FILE, {
    fallback: emptyStore,
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}

function loadPlmStyleLinks() {
  const legacy = loadLegacyStore();
  // Delta yetkili değilse (shadow) eski dosya neyse odur.
  if (!deltaStore || !deltaStore.isAuthoritative) return legacy;
  const records = deltaStore.readAllSync(COLLECTION);
  // Delta boş ya da okunamadıysa eski dosyaya düşülür. Bu, geçiş sırasında
  // verinin görünmez olamayacağının garantisi: delta tarafında bir sorun,
  // kullanıcıya boş liste değil eski listeyi gösterir.
  if (!records) return legacy;
  const store = emptyStore();
  // Revizyon delta tarafında tutuluyorsa oradan; yoksa eski dosyadan. Böylece
  // delta-only fazında eski dosya hiç yazılmasa da sayaç ilerlemeye devam eder.
  const meta = deltaStore.readMetaSync(COLLECTION);
  store._revision = Math.max(Number(meta && meta.revision) || 0, Number(legacy._revision) || 0);
  store._updatedAt = (meta && meta.updatedAt) || legacy._updatedAt;
  for (const [plmId, value] of Object.entries(records)) {
    const link = normalizeLink(value, plmId);
    if (link) store.links[link.plmId] = link;
  }
  // Delta bir sebeple hiç geçerli kayıt üretmediyse yine eski dosya kazanır.
  return Object.keys(store.links).length ? store : legacy;
}

function publicLinks(store = loadPlmStyleLinks()) {
  return {
    links: Object.values(store.links).map(item => ({
      plmId: item.plmId,
      styleId: item.styleId,
      styleName: item.styleName,
      specialCode: item.specialCode,
      season: item.season,
      url: styleUrl(item.styleId),
    })),
    count: Object.keys(store.links).length,
    revision: store._revision,
    updatedAt: store._updatedAt,
  };
}

function upsertPlmStyleLinks(items, actor) {
  const store = loadPlmStyleLinks();
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let invalid = 0;
  const changedLinks = {};

  for (const raw of Array.isArray(items) ? items.slice(0, MAX_LINKS) : []) {
    const normalized = normalizeLink({
      ...raw,
      updatedAt: now,
      updatedBy: actor && (actor.displayName || actor.username || actor.id),
      updatedById: actor && actor.id,
    });
    if (!normalized) { invalid += 1; continue; }
    const current = store.links[normalized.plmId];
    if (!current) added += 1;
    else if (plmFingerprint(current) === plmFingerprint(normalized)) { unchanged += 1; continue; }
    else updated += 1;
    store.links[normalized.plmId] = normalized;
    changedLinks[normalized.plmId] = normalized;
  }

  if (Object.keys(store.links).length > MAX_LINKS) {
    const error = new Error(`PLM bağlantı sınırı aşıldı (${MAX_LINKS}).`);
    error.statusCode = 413;
    error.code = 'PLM_LINK_LIMIT';
    throw error;
  }
  const meaningfulChanges = added + updated;
  assertEventAmplification({ changedCount: meaningfulChanges, generatedEventCount: Object.keys(changedLinks).length });
  if (added || updated) {
    store._revision += 1;
    store._updatedAt = now;
    // Eski JSON önce ve KOŞULSUZ yazılır: shadow fazında yetkili olan odur ve
    // delta tarafındaki bir sorun kullanıcının içe aktarmasını düşüremez.
    if (!deltaStore || deltaStore.writesLegacy) atomicWriteJson(FILE, store);
    if (deltaStore) {
      // Ayna beklenmez ve sonucuna bakılmaz; delta-store hatayı kendi içinde
      // yutup raporlar.
      void Promise.resolve(deltaStore.mirror(COLLECTION, changedLinks, { userId: actor && actor.id })).catch(() => {});
      void Promise.resolve(deltaStore.writeMeta(COLLECTION, { revision: store._revision, updatedAt: store._updatedAt })).catch(() => {});
    }
  }
  return { ...publicLinks(store), added, updated, unchanged, invalid, runSummary: buildPlmRunSummary({ checked: added + updated + unchanged + invalid, changed: added + updated, added, updated, unchanged, deltaEvents: Object.keys(changedLinks).length }) };
}

module.exports = {
  COLLECTION,
  attachDeltaStore,
  MAX_LINKS,
  BASE_URL,
  normalizeNumericId,
  normalizeLink,
  normalizeStore,
  styleUrl,
  loadPlmStyleLinks,
  publicLinks,
  upsertPlmStyleLinks,
};
