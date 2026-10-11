'use strict';

/* Koleksiyon kumaş kartları: kumaş kodu → kısa özet (TR + EN) + ayrıntı.
 *
 * PLM "Main Fabric Information" metni satırda olduğu gibi kalır (veri kaybı
 * yok); bu sözlük yalnız GÖRÜNÜMÜ kısaltır. Kart bir kez oluşturulduktan
 * sonra aynı kodlu her model onu kullanır; LCW AI'a tekrar sorulmaz.
 * Sözlük, PLM çeviri sözlüğü (plm-translations.js) gibi tüm Koleksiyon
 * kullanıcıları için ortaktır ve revizyonla korunur. */
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { RevisionConflictError, expectedNumber } = require('../db');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const { withFileLeaseSync } = require('./shared-file-transaction');

const FILE = path.join(SERVER_DATA_ROOT, 'fabric-cards.json');
const MAX_CARDS = 20000;
const SUMMARY_MAX = 80;
const DETAIL_MAX = 200;
const RAW_MAX = 4000;
const DETAIL_FIELDS = Object.freeze(['category', 'type', 'yarn', 'weight', 'composition', 'finish', 'sustainability']);
const SOURCES = new Set(['ai', 'rule', 'manual']);

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeCode(value) {
  const text = clean(value, 20);
  return /^\d{3,12}$/.test(text) ? text : '';
}
function actorName(actor) { return clean(actor && (actor.displayName || actor.username || actor.id), 160); }
function emptyStore() {
  return { schemaVersion: 1, cards: {}, _revision: 0, _updatedAt: null };
}
function normalizeCard(raw, fallbackCode = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const code = normalizeCode(raw.code || fallbackCode);
  const summary = clean(raw.summary, SUMMARY_MAX);
  if (!code || !summary) return null;
  const details = {};
  for (const key of DETAIL_FIELDS) details[key] = clean(raw.details && raw.details[key], DETAIL_MAX);
  const source = clean(raw.summarySource, 20);
  return {
    code,
    summary,
    summaryEn: clean(raw.summaryEn, SUMMARY_MAX),
    details,
    summarySource: SOURCES.has(source) ? source : 'manual',
    raw: clean(raw.raw, RAW_MAX),
    createdAt: clean(raw.createdAt, 80) || null,
    createdBy: clean(raw.createdBy, 160),
    updatedAt: clean(raw.updatedAt, 80) || null,
    updatedBy: clean(raw.updatedBy, 160),
  };
}
function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._revision = Math.max(0, Number(raw._revision) || 0);
  out._updatedAt = raw._updatedAt || null;
  const cards = raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards) ? raw.cards : {};
  for (const [key, item] of Object.entries(cards).slice(0, MAX_CARDS)) {
    const card = normalizeCard(item, key);
    if (card) out.cards[card.code] = card;
  }
  return out;
}
function loadFabricCards() {
  return readJsonWithValidatedBackup(FILE, {
    fallback: emptyStore,
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}
function publicCards(store = loadFabricCards()) {
  return { cards: Object.values(store.cards).map(card => ({ ...card, details: { ...card.details } })), revision: store._revision, updatedAt: store._updatedAt };
}
function checkRevision(store, expectedRevision) {
  const wanted = expectedNumber(expectedRevision);
  if (wanted != null && wanted !== store._revision) throw new RevisionConflictError('Kumaş kartları', wanted, store._revision); // i18n-ignore
}
function persist(store) {
  store._revision += 1;
  store._updatedAt = new Date().toISOString();
  atomicWriteJson(FILE, store);
}

/* Kartları ekler/günceller. onlyMissing=true ise mevcut kart EZİLMEZ
   (otomatik oluşturma başka kullanıcının düzenlemesini bozmasın). */
function upsertFabricCards(items, actor, expectedRevision = null, { onlyMissing = false, assertAuthority } = {}) {
  return withFileLeaseSync(FILE, () => {
  assertAuthority?.();
  const store = loadFabricCards();
  checkRevision(store, expectedRevision);
  const now = new Date().toISOString(), by = actorName(actor);
  let updated = 0, skipped = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const card = normalizeCard(item);
    if (!card) { skipped += 1; continue; }
    const current = store.cards[card.code];
    if (current && onlyMissing) { skipped += 1; continue; }
    if (!current && Object.keys(store.cards).length >= MAX_CARDS) { skipped += 1; continue; }
    if (current && current.summary === card.summary && current.summaryEn === card.summaryEn && current.summarySource === card.summarySource
      && DETAIL_FIELDS.every(key => current.details[key] === card.details[key]) && (current.raw === card.raw || !card.raw)) { skipped += 1; continue; }
    store.cards[card.code] = {
      ...card,
      raw: card.raw || (current && current.raw) || '',
      createdAt: current && current.createdAt || now,
      createdBy: current && current.createdBy || by,
      updatedAt: now,
      updatedBy: by,
    };
    updated += 1;
  }
  if (updated) { assertAuthority?.(); persist(store); }
  return { ...publicCards(store), updated, skipped };
  });
}
function deleteFabricCard(code, actor, expectedRevision = null, { assertAuthority } = {}) {
  return withFileLeaseSync(FILE, () => {
  assertAuthority?.();
  const store = loadFabricCards();
  checkRevision(store, expectedRevision);
  const key = normalizeCode(code);
  if (!key || !store.cards[key]) return { ...publicCards(store), deleted: false };
  delete store.cards[key];
  assertAuthority?.(); persist(store);
  return { ...publicCards(store), deleted: true, deletedBy: actorName(actor) };
  });
}

// Trusted service inverse: target records only, same native lease/CAS. This
// entry point is never exposed as raw store data or a caller-selected function.
function restoreFabricCards(before, expectedRevision, { assertAuthority } = {}) {
  return withFileLeaseSync(FILE, () => {
    assertAuthority?.();
    const store=loadFabricCards(); checkRevision(store,expectedRevision);
    if (expectedNumber(expectedRevision)==null || !before || Array.isArray(before) || Object.keys(before).length>50) throw new TypeError('Invalid fabric inverse');
    for (const [code,record] of Object.entries(before)) {
      if (normalizeCode(code)!==code || record && normalizeCard(record)?.code!==code) throw new TypeError('Invalid fabric inverse');
      if (record===null) delete store.cards[code];
      else store.cards[code]=normalizeCard(record);
    }
    assertAuthority?.(); persist(store); return publicCards(store);
  });
}

module.exports = { FILE, DETAIL_FIELDS, SUMMARY_MAX, MAX_CARDS, normalizeCode, normalizeCard, normalizeStore, loadFabricCards, publicCards, upsertFabricCards, deleteFabricCard, restoreFabricCards };
