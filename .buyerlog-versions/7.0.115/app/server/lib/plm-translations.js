'use strict';

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { RevisionConflictError, expectedNumber } = require('../db');
const { readJsonWithValidatedBackup } = require('./safe-json-read');

const FILE = path.join(SERVER_DATA_ROOT, 'plm-translations.json');
const FIELDS = new Set(['category', 'line', 'license']);
const MAX_RULES_PER_FIELD = 5000;

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}
function keyOf(value) {
  return clean(value).toLocaleUpperCase('tr-TR')
    .replace(/[İI]/g, 'I').replace(/Ş/g, 'S').replace(/Ç/g, 'C')
    .replace(/Ö/g, 'O').replace(/Ü/g, 'U').replace(/Ğ/g, 'G')
    .replace(/\s+/g, ' ').trim();
}
function emptyStore() {
  return { schemaVersion: 1, fields: { category: {}, line: {}, license: {} }, _revision: 0, _updatedAt: null };
}
function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._revision = Math.max(0, Number(raw._revision) || 0);
  out._updatedAt = raw._updatedAt || null;
  for (const field of FIELDS) {
    const src = raw.fields && raw.fields[field] && typeof raw.fields[field] === 'object' && !Array.isArray(raw.fields[field]) ? raw.fields[field] : {};
    const entries = Object.entries(src).slice(0, MAX_RULES_PER_FIELD);
    for (const [storedKey, item] of entries) {
      const source = clean(item && item.source || storedKey), target = clean(item && item.target);
      const key = keyOf(source);
      if (!key || !target) continue;
      out.fields[field][key] = {
        source,
        target,
        approvedAt: clean(item && item.approvedAt, 80) || null,
        approvedBy: clean(item && item.approvedBy, 160),
        approvedById: clean(item && item.approvedById, 120),
      };
    }
  }
  return out;
}
function loadPlmTranslations() {
  return readJsonWithValidatedBackup(FILE, {
    fallback: emptyStore,
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}
function publicRules(store = loadPlmTranslations()) {
  const rules = { category: [], line: [], license: [] };
  for (const field of FIELDS) rules[field] = Object.values(store.fields[field]).map(item => ({ ...item }));
  return { rules, revision: store._revision, updatedAt: store._updatedAt };
}
function upsertPlmTranslations(items, actor, expectedRevision = null) {
  const store = loadPlmTranslations();
  const wanted = expectedNumber(expectedRevision);
  if (wanted != null && wanted !== store._revision) {
    throw new RevisionConflictError('PLM çeviri sözlüğü', wanted, store._revision);
  }
  let updated = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const field = clean(raw && raw.field, 30).toLowerCase();
    if (!FIELDS.has(field)) continue;
    const source = clean(raw && raw.source), target = clean(raw && raw.target), key = keyOf(source);
    if (!source || !target || !key) continue;
    const current = store.fields[field][key];
    if (current && current.target === target && current.source === source) continue;
    store.fields[field][key] = {
      source,
      target,
      approvedAt: new Date().toISOString(),
      approvedBy: clean(actor && (actor.displayName || actor.username || actor.id), 160),
      approvedById: clean(actor && actor.id, 120),
    };
    updated += 1;
  }
  if (updated) {
    store._revision += 1;
    store._updatedAt = new Date().toISOString();
    atomicWriteJson(FILE, store);
  }
  return { ...publicRules(store), updated };
}

module.exports = { loadPlmTranslations, publicRules, upsertPlmTranslations, keyOf };
