'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');
const { withFileLeaseSync } = require('./shared-file-transaction');
const ElementParts = require('../../public/checklist-components-engine');

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
function addAttachment(raw, actor, options = {}) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const encoded = String(item.base64 || '').replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
  if (!encoded) {
    const error = new Error('Attachment payload is empty.'); error.code = 'CHECKLIST_ATTACHMENT_EMPTY'; throw error;
  }
  return addAttachmentBuffer(Buffer.from(encoded, 'base64'), item, actor, options);
}
/* Test raporu aktarımı ekleri sunucuda zaten tampondadır; aynı depoya aynı
   adlandırma ve sınırlarla yazılır. */
function addAttachmentBuffer(buffer, raw, actor, options = {}) {
  const item = raw && typeof raw === 'object' ? raw : {};
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) {
    const error = new Error('Checklist attachment exceeds the 40 MB storage limit.'); error.code = 'CHECKLIST_ATTACHMENT_TOO_LARGE'; throw error;
  }
  const id = crypto.randomBytes(16).toString('hex');
  const addedAt = new Date().toISOString();
  const filename = attachmentDisplayName({ ...(item.context || {}), addedAt }, item.filename);
  fs.mkdirSync(ATTACHMENT_ROOT, { recursive: true });
  options.assertAuthority?.();
  atomicWriteJson(path.join(ATTACHMENT_ROOT, id + '.json'), { ownerId: actorInfo(actor).id, orderKey: options.orderKey || '', addedAt });
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
// Historical files have no staging owner. They remain readable only through
// an authorized durable answer/tombstone/event or test-report reference.
function attachmentOrders(id, store = read()) {
  const keys = new Set();
  for (const record of Object.values(store.answers).concat(Object.values(store.tombstones), store.events)) {
    if ((record.attachments || []).some(item => item.id === id)) keys.add(record.orderKey);
  }
  const reports = require('./test-reports/store').read();
  const Engine = require('../../public/test-report-engine');
  for (const [reportId, link] of Object.entries(reports.links)) {
    for (const target of Engine.reportLinks(link)) {
      if ((target.files || reports.reports[reportId]?.dosyalar || []).some(file => file.attachmentId === id)) keys.add(target.orderKey);
    }
  }
  return keys;
}
function attachmentAccess(actor, allowedOrderKeys) {
  const allowedIds = new Set(), checklist = read();
  for (const record of Object.values(checklist.answers).concat(Object.values(checklist.tombstones), checklist.events)) {
    if (allowedOrderKeys.has(record.orderKey)) for (const item of record.attachments || []) allowedIds.add(item.id);
  }
  const reports = require('./test-reports/store').read(), Engine = require('../../public/test-report-engine');
  for (const [reportId, link] of Object.entries(reports.links)) {
    for (const target of Engine.reportLinks(link)) {
      if (allowedOrderKeys.has(target.orderKey)) for (const file of target.files || reports.reports[reportId]?.dosyalar || []) allowedIds.add(file.attachmentId);
    }
  }
  return id => {
    if (!getAttachmentPath(id)) return false;
    if (allowedIds.has(id)) return true;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(ATTACHMENT_ROOT, String(id).toLowerCase() + '.json'), 'utf8'));
      return Boolean(meta.ownerId && meta.ownerId === actorInfo(actor).id && allowedOrderKeys.has(meta.orderKey));
    } catch (err) { if (err.code === 'ENOENT' || err instanceof SyntaxError) return false; throw err; }
  };
}
function canAccessAttachment(id, actor, allowedOrderKeys) {
  return allowedOrderKeys instanceof Set && attachmentAccess(actor, allowedOrderKeys)(id);
}
function deleteAttachment(id, options = {}) {
  return withFileLeaseSync(FILE, () => {
    options.assertAuthority?.();
    const fullPath = attachmentDiskPath(id);
    if (!fullPath || !fs.existsSync(fullPath)) return false;
    if (attachmentOrders(id).size) return false;
    options.assertAuthority?.();
    fs.unlinkSync(fullPath);
    fs.rmSync(path.join(ATTACHMENT_ROOT, String(id).toLowerCase() + '.json'), { force: true });
    return true;
  });
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
    if (['ordered', 'sipariş geçildi', 'siparis gecildi'].includes(raw)) return 'custom:ordered'; // i18n-ignore — import aliases
  // v7.221 — Pending (open) · Approved · Rejected · Not Required. Eski 'done'
  // kayıtları ve Excel değerleri 'approved' olarak okunur.
  if (['approved','approve','onaylandı','onaylandi','onaylı','onayli','done','completed','complete','tamam','tamamlandı','tamamlandi','yes','evet'].includes(raw)) return 'approved';
  if (['rejected','reject','reddedildi','red','ret','failed','fail','no','hayır','hayir'].includes(raw)) return 'rejected';
  if (['notrequired','not required','n a','na','gerekmiyor','gerek yok','uygulanmaz'].includes(raw)) return 'notRequired';
  if (['open','pending','açık','acik','bekliyor','beklemede','yeniden aç','yeniden ac'].includes(raw)) return 'open';
  // Canonical user-defined states are safe identifiers, never executable text.
  if (/^custom:[a-z0-9][a-z0-9-]{0,47}$/.test(String(value || '').trim())) return String(value).trim();
  return '';
}
function answerKey(orderKey, itemId) { return text(orderKey, 300) + '::' + text(itemId, 200); }
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

function publicPayload(allowedOrderKeys) {
  const store = read();
  return {
    ok: true, schemaVersion: SCHEMA_VERSION, revision: store.revision, updatedAt: store.updatedAt,
    definitions: clone(store.definitions),
    ...Object.fromEntries(['answers', 'tombstones'].map(kind => [kind, clone(allowedOrderKeys
      ? Object.fromEntries(Object.entries(store[kind]).filter(([, record]) => allowedOrderKeys.has(record.orderKey)))
      : store[kind])])),
  };
}

function replaceDefinitions(definitions, actor, options = {}) {
  if (Array.isArray(definitions) && definitions.length > MAX_DEFINITIONS) throw Object.assign(new Error('Too many checklist definitions.'), { code: 'CHECKLIST_CAPACITY', statusCode: 507 });
  if (options.restoreSnapshot && (typeof options.assertAuthority !== 'function' || !Number.isSafeInteger(options.expectedRevision))) throw Object.assign(new Error('Checklist inverse requires a revision and authority guard.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
  const list = options.restoreSnapshot ? clone(definitions) : (Array.isArray(definitions) ? definitions : []).map(normalizeDefinition).filter(Boolean);
  const seen = new Set();
  const unique = options.restoreSnapshot ? list : list.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, MAX_DEFINITIONS);
  const who = actorInfo(actor);
  return withFileLeaseSync(FILE, () => {
    const store = read();
    options.assertAuthority?.();
    if (options.expectedRevision != null && store.revision !== options.expectedRevision) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    if (options.reserveWrites && (!Number.isSafeInteger(store.revision) || store.revision < 0 || store.revision > Number.MAX_SAFE_INTEGER - options.reserveWrites)) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    store.definitions = unique;
    store.events.push({ type: 'definitions', at: new Date().toISOString(), by: who, count: unique.length });
    options.assertAuthority?.();
    write(store);
    return { ok: true, revision: store.revision, updatedAt: store.updatedAt, definitions: clone(store.definitions) };
  });
}

// Trusted inverse snapshots originate in revision/owner-bound native receipts,
// never in a request body; preserve older metadata through the same writer.
function restoreDefinitionsSnapshot(definitions, actor, options = {}) {
  if (!Array.isArray(definitions)) throw Object.assign(new Error('Invalid checklist inverse.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
  return replaceDefinitions(definitions, actor, {...options, restoreSnapshot:true});
}

function entryReceipt(store,keys) {
  return {revision:store.revision,updatedAt:store.updatedAt,entries:JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key=>[key,{answer:store.answers[key]||null,tombstone:store.tombstones[key]||null}]))))};
}

function applyEntries(entries, actor, options = {}) {
  if (Array.isArray(entries) && entries.length > 100000) throw Object.assign(new Error('Too many checklist changes in one request.'), { code: 'CHECKLIST_CAPACITY', statusCode: 413 });
  const input = Array.isArray(entries) ? entries : [];
  const who = actorInfo(actor);
  const source = text(options.source || 'buyer_log', 80) || 'buyer_log';
  return withFileLeaseSync(FILE, () => {
    options.assertAuthority?.();
    const store = read();
    if (options.reserveWrites && (!Number.isSafeInteger(store.revision) || store.revision < 0 || store.revision > Number.MAX_SAFE_INTEGER - options.reserveWrites)) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    if (options.expectedRevision != null && store.revision !== options.expectedRevision) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    const pendingRosters = new Map();
    for (const entry of input) {
      if (!entry || entry.itemId !== '@set-components') continue;
      const order = text(entry.orderKey, 300), key = answerKey(order, '@set-components');
      const previous = store.answers[key] || store.tombstones[key];
      if (entry.deleted === true) throw Object.assign(new Error('Existing set parts must be preserved.'), {code:'CHECKLIST_COMPONENTS_INVALID',statusCode:409});
      const previousAt = previous && text(previous.at, 80), at = iso(entry.at), baseAt = text(entry.baseAt, 80);
      // A stale/skipped roster cannot authorize a new part in the same batch.
      if (previousAt && (previousAt > at || (source === 'supplier_excel' && baseAt && previousAt > baseAt))) continue;
      if (normalizeState(entry.state) !== 'open' || !Number.isInteger(entry.componentCount) || entry.componentCount < 2 || entry.componentCount > 26) throw Object.assign(new Error('Invalid set component count.'), {code:'CHECKLIST_COMPONENTS_INVALID',statusCode:400});
      pendingRosters.set(order, Math.max(pendingRosters.get(order) || 0, entry.componentCount));
    }
    // Validate every part against the saved roster or a roster in this same
    // transaction before applying any effects. Ordering inside a batch is irrelevant.
    for (const entry of input) {
      const part = entry && String(entry.itemId || '').match(/~part~([A-Z])$/);
      if (!part) continue;
      const order = text(entry.orderKey, 300), rosterKey = answerKey(order, '@set-components');
      const saved = store.answers[rosterKey] || store.tombstones[rosterKey];
      const count = Math.max(saved && saved.componentCount || 0, pendingRosters.get(order) || 0);
      if (!Number.isInteger(count) || count < 2 || count > 26 || part[1].charCodeAt(0) - 64 > count) throw Object.assign(new Error('Define the set roster before updating a component.'), {code:'CHECKLIST_COMPONENTS_INVALID',statusCode:400});
    }
    let updated = 0, cleared = 0, skipped = 0, conflicts = 0;
    const changedKeys = [], rejectedAt = {};
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') { skipped += 1; continue; }
      const orderKey = text(raw.orderKey, 300);
      const itemId = text(raw.itemId, 200);
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
      const componentCount = Object.prototype.hasOwnProperty.call(raw, 'componentCount') ? raw.componentCount : previousEvidence && previousEvidence.componentCount;
      if (componentCount != null && (itemId !== '@set-components' || !Number.isInteger(componentCount) || componentCount < 2 || componentCount > 26)) throw Object.assign(new Error('Invalid set component count.'), { code:'CHECKLIST_COMPONENTS_INVALID', statusCode:400 });
      if (itemId === '@set-components' && previousEvidence && previousEvidence.componentCount > componentCount) throw Object.assign(new Error('Existing set parts must be preserved.'), { code:'CHECKLIST_COMPONENTS_INVALID', statusCode:409 });
      // v7.0.290 — bileşen sonuçları (Main Fabric / Neck RIB …); gönderilmezse korunur.
      if (Object.prototype.hasOwnProperty.call(raw, 'elements') && raw.elements != null && !Array.isArray(raw.elements)) throw Object.assign(new Error('Checklist components must be an array.'), { code: 'CHECKLIST_EVIDENCE_INVALID', statusCode: 400 });
      let elements = ElementParts.normalizeElements(Object.prototype.hasOwnProperty.call(raw, 'elements') ? raw.elements : previousEvidence && previousEvidence.elements, value => normalizeState(value) || 'open');
      // Bileşen listesi gönderilmeden tek durum yazılırsa (hücre / araç) durum
      // bütün korunan bileşenlere uygulanır; genel durum ve bileşenler çelişmez.
      if (!Object.prototype.hasOwnProperty.call(raw, 'elements') && elements.length
        && ElementParts.elementsState(elements, value => value === 'approved' || value === 'notRequired') !== state) {
        elements = elements.map(item => ({ ...item, state }));
      }
      const common = {
        ...(componentCount != null ? {componentCount} : {}),
        ...(elements.length ? {elements} : {}),
        key, orderKey, itemId, at, by: text(options.serverIdentity ? who.name || who.id : raw.by || who.name || who.id, 200),
        byId: who.id, source: text(options.serverIdentity ? source : raw.source || source, 80), loadDate: text(raw.loadDate, 40) || null,
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
    options.assertAuthority?.();write(store);
    const result = { ok: true, revision: store.revision, updatedAt: store.updatedAt, updated, cleared, skipped, conflicts, changedKeys, rejectedAt };
    return options.receipt ? options.receipt(result,entryReceipt(store,changedKeys)) : result;
  });
}

function restoreEntries(receipt, actor, options = {}) {
  return withFileLeaseSync(FILE, () => {
    options.assertAuthority?.();
    const store = read();
    if (options.reserveWrites && (!Number.isSafeInteger(store.revision) || store.revision < 0 || store.revision > Number.MAX_SAFE_INTEGER - options.reserveWrites)) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    if (store.revision !== receipt.expectedRevision) throw Object.assign(new Error('Checklist revision changed.'), {code:'CHECKLIST_REVISION_CONFLICT',statusCode:409});
    for(const [key, previous] of Object.entries(receipt.entries)) {
      if(previous.answer == null) delete store.answers[key]; else store.answers[key] = previous.answer;
      if(previous.tombstone == null) delete store.tombstones[key]; else store.tombstones[key] = previous.tombstone;
    }
    store.events.push({type:'agent-answer-undo',at:new Date().toISOString(),by:actorInfo(actor),keys:Object.keys(receipt.entries)});
    options.assertAuthority?.();write(store);const result={verified:true,revision:store.revision};
    return options.receipt ? options.receipt(result,entryReceipt(store,Object.keys(receipt.entries))) : result;
  });
}
module.exports = {
  FILE, ATTACHMENT_ROOT, SCHEMA_VERSION, MAX_ATTACHMENT_BYTES,
  normalizeState, answerKey, normalizeDefinition, publicPayload, replaceDefinitions, restoreDefinitionsSnapshot, applyEntries, restoreEntries,
  addAttachment, addAttachmentBuffer, getAttachmentPath, deleteAttachment, canAccessAttachment, attachmentAccess, cleanAttachmentMeta, attachmentDisplayName,
  _read: read,
};
