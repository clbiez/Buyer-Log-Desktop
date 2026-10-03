'use strict';

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { withFileLeaseSync } = require('./shared-file-transaction');

const FILE = path.join(SERVER_DATA_ROOT, 'checklist-supplier-sync.json');
const SCHEMA_VERSION = 1;
const MAX_ANSWERS = 250000;
const MAX_TOMBSTONES = 250000;
const MAX_DEFINITIONS = 500;
const MAX_EVENTS = 20000;

function text(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function iso(value) {
  const raw = text(value, 80);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}
function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: '', definitions: [], answers: {}, tombstones: {}, events: [] };
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function read() {
  try {
    if (!fs.existsSync(FILE)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const store = raw && typeof raw === 'object' ? raw : emptyStore();
    store.schemaVersion = SCHEMA_VERSION;
    store.revision = Number(store.revision) || 0;
    store.updatedAt = text(store.updatedAt, 80);
    store.definitions = Array.isArray(store.definitions) ? store.definitions.slice(0, MAX_DEFINITIONS) : [];
    store.answers = store.answers && typeof store.answers === 'object' ? store.answers : {};
    store.tombstones = store.tombstones && typeof store.tombstones === 'object' ? store.tombstones : {};
    store.events = Array.isArray(store.events) ? store.events.slice(-MAX_EVENTS) : [];
    return store;
  } catch (_) { return emptyStore(); }
}
function write(store) {
  store.schemaVersion = SCHEMA_VERSION;
  store.revision = (Number(store.revision) || 0) + 1;
  store.updatedAt = new Date().toISOString();
  const answerKeys = Object.keys(store.answers || {});
  if (answerKeys.length > MAX_ANSWERS) answerKeys.slice(0, answerKeys.length - MAX_ANSWERS).forEach(key => delete store.answers[key]);
  const tombKeys = Object.keys(store.tombstones || {});
  if (tombKeys.length > MAX_TOMBSTONES) tombKeys.slice(0, tombKeys.length - MAX_TOMBSTONES).forEach(key => delete store.tombstones[key]);
  if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWriteJson(FILE, store);
  return store;
}

function normalizeState(value) {
  const raw = text(value, 80).toLocaleLowerCase('tr-TR').replace(/[._-]+/g, ' ');
  if (!raw) return '';
  if (['done','completed','complete','tamam','tamamlandı','tamamlandi','yes','evet'].includes(raw)) return 'done';
  if (['notrequired','not required','n a','na','gerekmiyor','gerek yok','uygulanmaz'].includes(raw)) return 'notRequired';
  if (['open','pending','açık','acik','bekliyor','yeniden aç','yeniden ac'].includes(raw)) return 'open';
  return '';
}
function answerKey(orderKey, itemId) { return text(orderKey, 300) + '::' + text(itemId, 160); }
function actorInfo(actor) {
  return {
    id: text(actor && actor.id, 160),
    name: text(actor && (actor.displayName || actor.username || actor.name), 200),
  };
}
function cleanCondition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const field = text(raw.field, 200);
  const operator = text(raw.operator, 40);
  if (!field || !operator) return null;
  let value = raw.value;
  if (Array.isArray(value)) value = value.slice(0, 100).map(item => text(item, 300));
  else if (value && typeof value === 'object') value = text(JSON.stringify(value), 1000);
  else value = typeof value === 'number' || typeof value === 'boolean' ? value : text(value, 1000);
  return { field, operator, value };
}
function normalizeDefinition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 160);
  if (!id || raw.kind !== 'checklist' || raw.builtIn === true) return null;
  const conditions = (Array.isArray(raw.conditions) ? raw.conditions : []).slice(0, 12).map(cleanCondition).filter(Boolean);
  return {
    id, kind: 'checklist', builtIn: false, enabled: raw.enabled !== false,
    name: text(raw.name, 160), tr: text(raw.tr || raw.name, 160), en: text(raw.en || raw.name, 160),
    questionTr: text(raw.questionTr || raw.name, 300), questionEn: text(raw.questionEn || raw.name, 300),
    mode: raw.mode === 'formula' ? 'formula' : 'basic', formula: text(raw.formula, 4000),
    expressionVersion: Math.max(1, Number(raw.expressionVersion) || 1),
    conditions, match: raw.match === 'any' ? 'any' : 'all',
  };
}

function publicPayload() {
  const store = read();
  return {
    ok: true, schemaVersion: SCHEMA_VERSION, revision: store.revision, updatedAt: store.updatedAt,
    definitions: clone(store.definitions), answers: clone(store.answers), tombstones: clone(store.tombstones),
  };
}

function replaceDefinitions(definitions, actor) {
  const list = (Array.isArray(definitions) ? definitions : []).map(normalizeDefinition).filter(Boolean);
  const seen = new Set();
  const unique = list.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, MAX_DEFINITIONS);
  const who = actorInfo(actor);
  return withFileLeaseSync(FILE, () => {
    const store = read();
    store.definitions = unique;
    store.events.push({ type: 'definitions', at: new Date().toISOString(), by: who, count: unique.length });
    write(store);
    return { ok: true, revision: store.revision, updatedAt: store.updatedAt, definitions: clone(store.definitions) };
  });
}

function applyEntries(entries, actor, options = {}) {
  const input = Array.isArray(entries) ? entries.slice(0, 100000) : [];
  const who = actorInfo(actor);
  const source = text(options.source || 'buyer_log', 80) || 'buyer_log';
  return withFileLeaseSync(FILE, () => {
    const store = read();
    let updated = 0, cleared = 0, skipped = 0, conflicts = 0;
    const changedKeys = [];
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') { skipped += 1; continue; }
      const orderKey = text(raw.orderKey, 300);
      const itemId = text(raw.itemId, 160);
      const state = normalizeState(raw.state);
      if (!orderKey || !itemId || !state) { skipped += 1; continue; }
      const key = answerKey(orderKey, itemId);
      const at = iso(raw.at);
      const baseAt = text(raw.baseAt, 80);
      const previous = store.answers[key];
      const tomb = store.tombstones[key];
      const previousAt = previous ? String(previous.at || '') : tomb ? String(tomb.at || '') : '';
      // Supplier Excel carries the export timestamp as baseAt. If Buyer Log was
      // changed after that export, the stale workbook must not overwrite it.
      if (baseAt && previousAt && previousAt > baseAt) { conflicts += 1; continue; }
      const common = {
        key, orderKey, itemId, at, by: text(raw.by || who.name || who.id, 200),
        byId: who.id, source: text(raw.source || source, 80), loadDate: text(raw.loadDate, 40) || null,
        note: text(raw.note, 2000), supplier: text(raw.supplier, 300), itemLabel: text(raw.itemLabel, 200),
      };
      if (state === 'open') {
        if (!previous && store.tombstones[key] && String(store.tombstones[key].at || '') >= at) { skipped += 1; continue; }
        delete store.answers[key];
        store.tombstones[key] = { ...common, state: 'open' };
        store.events.push({ type: 'answer-opened', ...common, previousState: previous && previous.state || '' });
        cleared += 1; changedKeys.push(key);
        continue;
      }
      if (previousAt && previousAt > at) { skipped += 1; continue; }
      store.answers[key] = { ...common, state };
      delete store.tombstones[key];
      store.events.push({ type: 'answer-upserted', ...common, state, previousState: previous && previous.state || '' });
      updated += 1; changedKeys.push(key);
    }
    write(store);
    return { ok: true, revision: store.revision, updatedAt: store.updatedAt, updated, cleared, skipped, conflicts, changedKeys };
  });
}

module.exports = {
  FILE, SCHEMA_VERSION, normalizeState, answerKey, normalizeDefinition, publicPayload, replaceDefinitions, applyEntries, _read: read,
};