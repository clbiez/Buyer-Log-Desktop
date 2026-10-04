'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');
const { withFileLeaseSync } = require('./shared-file-transaction');

const FILE = path.join(SERVER_DATA_ROOT, 'checklist-supplier-sync.json');
const RECOVERY_FILE = path.join(SERVER_DATA_ROOT, 'checklist-supplier-sync.last-good.json');
const SCHEMA_VERSION = 1;
const MAX_ANSWERS = 250000;
const MAX_TOMBSTONES = 250000;
const MAX_DEFINITIONS = 500;
const MAX_EVENTS = 20000;
const ATTACHMENT_ROOT = path.join(SERVER_DATA_ROOT, 'checklist-attachments');
const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_ANSWER = 40;

function text(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}
function iso(value) {
  const raw = text(value, 80);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}
function safeSegment(value, max = 50) {
  return String(value == null ? '' : value)
    .replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max) || '-';
}
function safeExtension(filename) {
  const ext = path.extname(String(filename || '')).replace(/[^.A-Za-z0-9]+/g, '').slice(0, 12);
  return ext && ext !== '.' ? ext : '';
}
function attachmentDate(value) {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
function attachmentDisplayName(context, originalName) {
  const c = context && typeof context === 'object' ? context : {};
  const sequence = Math.max(1, Math.min(99, Number(c.sequence) || 1));
  const base = [
    safeSegment(c.orderCode, 28),
    safeSegment(c.plmId, 28),
    safeSegment(c.modelName, 48),
    safeSegment(c.colourCode, 28),
    safeSegment(c.checklistName, 42),
    safeSegment(c.checklistStatus, 28),
    attachmentDate(c.addedAt),
  ].join(' - ');
  return base + (sequence > 1 ? ' - ' + sequence : '') + safeExtension(originalName);
}
function attachmentDiskPath(id) {
  const token = String(id || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) return '';
  return path.join(ATTACHMENT_ROOT, token + '.bin');
}
function cleanAttachmentMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 80).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return {
    id,
    filename: text(raw.filename, 500),
    originalName: text(raw.originalName, 500),
    mimeType: text(raw.mimeType, 160) || 'application/octet-stream',
    size: Math.max(0, Math.min(MAX_ATTACHMENT_BYTES, Number(raw.size) || 0)),
    addedAt: text(raw.addedAt, 80),
  };
}
function addAttachment(raw, actor) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const encoded = String(item.base64 || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
  if (!encoded) {
    const error = new Error('Attachment payload is empty.'); error.code = 'CHECKLIST_ATTACHMENT_EMPTY'; throw error;
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
    const error = new Error('Checklist attachment exceeds the 40 MB storage limit.'); error.code = 'CHECKLIST_ATTACHMENT_TOO_LARGE'; throw error;
  }
  const id = crypto.randomBytes(16).toString('hex');
  const addedAt = new Date().toISOString();
  const filename = attachmentDisplayName({ ...(item.context || {}), addedAt }, item.filename);
  fs.mkdirSync(ATTACHMENT_ROOT, { recursive: true });
  atomicWriteBuffer(attachmentDiskPath(id), buffer);
  return {
    id, filename,
    originalName: safeSegment(item.filename || 'attachment', 500),
    mimeType: text(item.mimeType, 160) || 'application/octet-stream',
    size: buffer.length, addedAt,
    by: actorInfo(actor),
  };
}
function getAttachmentPath(id) {
  const fullPath = attachmentDiskPath(id);
  return fullPath && fs.existsSync(fullPath) ? fullPath : '';
}
function deleteAttachment(id) {
  const fullPath = attachmentDiskPath(id);
  if (!fullPath || !fs.existsSync(fullPath)) return false;
  const store = read();
  const referenced = Object.values(store.answers).concat(Object.values(store.tombstones), store.events)
    .some(record => (record.attachments || []).some(item => item.id === id));
  if (referenced) return false;
  fs.unlinkSync(fullPath);
  return true;
}
function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: '', definitions: [], answers: {}, tombstones: {}, events: [] };
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function read() {
  let raw;
  const exists = fs.existsSync(FILE), recoveryExists = fs.existsSync(RECOVERY_FILE);
  if (!exists && !recoveryExists) return emptyStore();
  const parse = filename => {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)
      || !Array.isArray(value.definitions)) throw new Error('Invalid checklist store structure.');
    return value;
  };
  try {
    raw = parse(FILE);
  } catch (error) {
    try { raw = parse(RECOVERY_FILE); }
    catch (_) { throw Object.assign(new Error('Checklist storage is unreadable; existing data was preserved.'), { code: 'CHECKLIST_STORE_UNREADABLE', statusCode: 503, cause: error }); }
  }
  {
    const store = raw && typeof raw === 'object' ? raw : emptyStore();
    store.schemaVersion = SCHEMA_VERSION;
    store.revision = Number(store.revision) || 0;
    store.updatedAt = text(store.updatedAt, 80);
    store.definitions = Array.isArray(store.definitions) ? store.definitions : [];
    store.answers = store.answers && typeof store.answers === 'object' ? store.answers : {};
    store.tombstones = store.tombstones && typeof store.tombstones === 'object' ? store.tombstones : {};
    store.events = Array.isArray(store.events) ? store.events.slice(-MAX_EVENTS) : [];
    return store;
  }
}
function write(store) {
  store.schemaVersion = SCHEMA_VERSION;
  store.revision = (Number(store.revision) || 0) + 1;
  store.updatedAt = new Date().toISOString();
  const answerKeys = Object.keys(store.answers || {});
  const tombKeys = Object.keys(store.tombstones || {});
  if (answerKeys.length > MAX_ANSWERS || tombKeys.length > MAX_TOMBSTONES) {
    throw Object.assign(new Error('Checklist capacity reached; existing records were preserved.'), { code: 'CHECKLIST_CAPACITY', statusCode: 507 });
  }
  if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  atomicWriteJson(RECOVERY_FILE, store);
  atomicWriteJson(FILE, store);
  return store;
}

function normalizeState(value) {
  const raw = text(value, 80).toLocaleLowerCase('tr-TR').replace(/[._-]+/g, ' ');
  if (!raw) return '';
  // v7.221 — Pending (open) · Approved · Rejected · Not Required. Eski 'done'
  // kayıtları ve Excel değerleri 'approved' olarak okunur.
  if (['approved','approve','onaylandı','onaylandi','onaylı','onayli','done','completed','complete','tamam','tamamlandı','tamamlandi','yes','evet'].includes(raw)) return 'approved';
  if (['rejected','reject','reddedildi','red','ret','failed','fail','no','hayır','hayir'].includes(raw)) return 'rejected';
  if (['notrequired','not required','n a','na','gerekmiyor','gerek yok','uygulanmaz'].includes(raw)) return 'notRequired';
  if (['open','pending','açık','acik','bekliyor','beklemede','yeniden aç','yeniden ac'].includes(raw)) return 'open';
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
    // Custom checklist definitions default to reusable approval scope. An
    // explicit per-PO choice remains authoritative.
    approvalScope: raw.approvalScope === 'order' ? 'order' : 'option',
    evidenceFields: {
      reportNumber: Boolean(raw.evidenceFields && raw.evidenceFields.reportNumber === true),
      actualDate: Boolean(raw.evidenceFields && raw.evidenceFields.actualDate === true),
      attachments: Boolean(raw.evidenceFields && raw.evidenceFields.attachments === true),
    },
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
  if (Array.isArray(definitions) && definitions.length > MAX_DEFINITIONS) throw Object.assign(new Error('Too many checklist definitions.'), { code: 'CHECKLIST_CAPACITY', statusCode: 507 });
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
  if (Array.isArray(entries) && entries.length > 100000) throw Object.assign(new Error('Too many checklist changes in one request.'), { code: 'CHECKLIST_CAPACITY', statusCode: 413 });
  const input = Array.isArray(entries) ? entries : [];
  const who = actorInfo(actor);
  const source = text(options.source || 'buyer_log', 80) || 'buyer_log';
  return withFileLeaseSync(FILE, () => {
    const store = read();
    let updated = 0, cleared = 0, skipped = 0, conflicts = 0;
    const changedKeys = [], rejectedAt = {};
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
      const previousEvidence = previous || tomb;
      // Supplier Excel carries the export timestamp as baseAt. Only an imported
      // supplier workbook is conflict-gated by that old snapshot. An explicit CP
      // edit is a live Buyer Log action and must not be discarded merely because
      // its client baseline is older; normal "at" ordering below still prevents
      // an actually older live event from overwriting a newer one.
      if (source === 'supplier_excel' && baseAt && previousAt && previousAt > baseAt) { conflicts += 1; continue; }
      // Apply the same ordering to Pending as every other status: a late beacon
      // or offline retry must never clear a more recent answer.
      if (previousAt && previousAt > at) { skipped += 1; rejectedAt[key] = previousAt; continue; }
      if (Array.isArray(raw.attachments) && (raw.attachments.length > MAX_ATTACHMENTS_PER_ANSWER
        || raw.attachments.some(item => !cleanAttachmentMeta(item)))) {
        throw Object.assign(new Error('Invalid or oversized checklist attachment list; existing evidence was preserved.'), { code: 'CHECKLIST_EVIDENCE_INVALID', statusCode: 400 });
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'attachments') && !Array.isArray(raw.attachments)) throw Object.assign(new Error('Checklist attachments must be an array.'), { code: 'CHECKLIST_EVIDENCE_INVALID', statusCode: 400 });
      if (String(raw.note || '').length > 2000 || String(raw.reportNumber || '').length > 300) throw Object.assign(new Error('Checklist evidence exceeds the allowed field length.'), { code: 'CHECKLIST_EVIDENCE_INVALID', statusCode: 400 });
      const common = {
        key, orderKey, itemId, at, by: text(raw.by || who.name || who.id, 200),
        byId: who.id, source: text(raw.source || source, 80), loadDate: text(raw.loadDate, 40) || null,
        note: String(Object.prototype.hasOwnProperty.call(raw, 'note') ? raw.note || '' : previousEvidence && previousEvidence.note || '').slice(0, 2000),
        supplier: text(raw.supplier, 300), itemLabel: text(raw.itemLabel, 200),
        reportNumber: Object.prototype.hasOwnProperty.call(raw, 'reportNumber') ? text(raw.reportNumber, 300) : text(previousEvidence && previousEvidence.reportNumber, 300),
        actualDate: Object.prototype.hasOwnProperty.call(raw, 'actualDate') ? text(raw.actualDate, 40) : text(previousEvidence && previousEvidence.actualDate, 40),
        attachments: (Object.prototype.hasOwnProperty.call(raw, 'attachments')
          ? (Array.isArray(raw.attachments) ? raw.attachments : [])
          : (Array.isArray(previousEvidence && previousEvidence.attachments) ? previousEvidence.attachments : []))
          .slice(0, MAX_ATTACHMENTS_PER_ANSWER).map(cleanAttachmentMeta).filter(Boolean),
      };
      if (state === 'open') {
        delete store.answers[key];
        store.tombstones[key] = { ...common, state: 'open', ...(raw.deleted === true ? { deleted: true } : {}) };
        store.events.push({ type: 'answer-opened', ...common, previousState: previous && previous.state || '' });
        cleared += 1; changedKeys.push(key);
        continue;
      }
      store.answers[key] = { ...common, state };
      delete store.tombstones[key];
      store.events.push({ type: 'answer-upserted', ...common, state, previousState: previous && previous.state || '' });
      updated += 1; changedKeys.push(key);
    }
    write(store);
    return { ok: true, revision: store.revision, updatedAt: store.updatedAt, updated, cleared, skipped, conflicts, changedKeys, rejectedAt };
  });
}

module.exports = {
  FILE, ATTACHMENT_ROOT, SCHEMA_VERSION, MAX_ATTACHMENT_BYTES,
  normalizeState, answerKey, normalizeDefinition, publicPayload, replaceDefinitions, applyEntries,
  addAttachment, getAttachmentPath, deleteAttachment, cleanAttachmentMeta, attachmentDisplayName,
  _read: read,
};
