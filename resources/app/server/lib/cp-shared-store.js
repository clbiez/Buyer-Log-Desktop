'use strict';

/* ===================================================================
   CP SHARED BUSINESS RECORDS

   overrides.json is kept as the compatibility/local projection because the
   renderer and existing business logic already consume its maps. The shared
   sync owner, however, is a flat record per CP order-line identity so two
   users editing different rows/fields do not race on one giant map.

   Model images are intentionally NOT part of this store. They are shared by
   model-image-distribution/shared-image-store and remain independently lazy.
   =================================================================== */

const COLLECTION = 'cp-order';
const FIELDS = Object.freeze({
  notes: 'notesmap',
  noteColumns: 'noteColumnValues',
  subManufacturer: 'submap',
  licensor: 'licensormap',
  suppFob: 'suppfobmap',
  suppFobMeta: 'suppfobmetamap',
  delivery: 'delmap',
  dates: 'datemap',
  shortage: 'shortagemap',
  importance: 'importancemap',
});

let deltaStore = null;

function attachDeltaStore(store) { deltaStore = store || null; return deltaStore; }
function attached() { return Boolean(deltaStore); }
function authoritative() { return Boolean(deltaStore && deltaStore.isAuthoritative); }

function own(obj, key) { return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key)); }
function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}
function actorIdOf(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const value = actor.id != null ? actor.id : actor.userId;
  return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function legacyKeys(overrides) {
  const set = new Set();
  for (const mapName of Object.values(FIELDS)) {
    const map = overrides && overrides[mapName];
    if (!map || typeof map !== 'object') continue;
    for (const key of Object.keys(map)) if (String(key || '').trim()) set.add(String(key));
  }
  return [...set];
}

function fieldValue(overrides, id, field) {
  const mapName = FIELDS[field], map = overrides && overrides[mapName];
  if (!map || typeof map !== 'object' || !own(map, id)) return undefined;
  return clone(map[id]);
}

function recordFromOverrides(overrides, id) {
  const out = {};
  for (const field of Object.keys(FIELDS)) {
    const value = fieldValue(overrides, id, field);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function noteTextPresent(notes, field) {
  return Boolean(notes && typeof notes === 'object' && (String(notes[field] == null ? '' : notes[field]).trim() || String(notes[field+'Html']||'').trim()));
}
function notesExplicitlyCleared(notes) {
  if (!notes || typeof notes !== 'object') return false;
  const touched = own(notes, 'Notes') || own(notes, 'EkNot');
  return touched && !noteTextPresent(notes, 'Notes') && !noteTextPresent(notes, 'EkNot');
}
function sharedNotesValue(overrides, id) {
  const notes = fieldValue(overrides, id, 'notes');
  // Both note text fields are blank: this is an explicit user deletion, not
  // "missing data". Persist a field tombstone so pre-wipe/business recovery
  // cannot treat the blank object as a gap and restore an older note.
  return notesExplicitlyCleared(notes) ? null : (notes ?? null);
}
function legacyNoteTombstoneProjection() {
  // The legacy renderer falls back from order+model+colour to the old
  // order-code key. Deleting the line key would therefore resurrect that old
  // fallback. Keep an explicit blank line-level projection to shadow it.
  return { Notes:'', EkNot:'', NotesAt:'', EkNotAt:'' };
}

/* Build ONLY fields touched by an ordinary order patch. Full-record mirrors
   would be unsafe: an offline client could unknowingly overwrite an unrelated
   field that another user changed meanwhile. */
function patchFromOrderPatch(overrides, id, patch) {
  const out = {};
  if (patch && patch.notes && typeof patch.notes === 'object') out.notes = sharedNotesValue(overrides, id);
  if (patch && patch.noteColumns && typeof patch.noteColumns === 'object') out.noteColumns = fieldValue(overrides, id, 'noteColumns') ?? null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'subManufacturer')) out.subManufacturer = fieldValue(overrides, id, 'subManufacturer') ?? null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'licensor')) out.licensor = fieldValue(overrides, id, 'licensor') ?? null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'suppFob')) {
    out.suppFob = fieldValue(overrides, id, 'suppFob') ?? null;
    out.suppFobMeta = fieldValue(overrides, id, 'suppFobMeta') ?? null;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'delType')) out.delivery = fieldValue(overrides, id, 'delivery') ?? null;
  if (patch && patch.dates && typeof patch.dates === 'object') out.dates = fieldValue(overrides, id, 'dates') ?? null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'shortage')) out.shortage = fieldValue(overrides, id, 'shortage') ?? null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'importance')) out.importance = fieldValue(overrides, id, 'importance') ?? null;
  return out;
}

/* Tarih revizyonunda yalnız kullanıcının gerçekten yazdığı tarihler
   (ex/retail/mb) alt alan olarak bildirilir. Eşler aynı satırın farklı
   tarihlerini eşzamanlı revize ettiğinde ikisi de korunur; biçimsiz (yok
   sayılan) değer bildirilmez, yazarın eski değeri başkasının revizyonunu ezmez. */
const DATE_SUBFIELDS = Object.freeze({ exFactory: 'ex', retailDate: 'retail', inStoreDate: 'mb' });
function subfieldsFromOrderPatch(patch) {
  const dates = patch && patch.dates;
  if (!dates || typeof dates !== 'object') return null;
  const list = Object.entries(DATE_SUBFIELDS).filter(([incoming]) => {
    if (!own(dates, incoming)) return false;
    const value = dates[incoming];
    return value == null || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
  }).map(([, stored]) => stored);
  return list.length ? { dates: list } : null;
}

async function mirrorPatch(id, patch, { actor = null, subfields = null } = {}) {
  const key = String(id == null ? '' : id).trim();
  const clean = patch && typeof patch === 'object' ? patch : {};
  if (!deltaStore || !key || !Object.keys(clean).length) return { mirrored: 0, ok: true, skipped: true };
  return deltaStore.mirror(COLLECTION, { [key]: clean }, { userId: actorIdOf(actor), ...(subfields ? { subfields } : {}) });
}

function mirrorPatchDetached(id, patch, options) {
  void mirrorPatch(id, patch, options).catch(() => {});
}

async function seedFromOverrides(overrides, { actor = null } = {}) {
  if (!deltaStore) return { seeded: 0, ids: [] };
  const entries = {};
  for (const id of legacyKeys(overrides)) {
    const record = recordFromOverrides(overrides, id);
    if (Object.keys(record).length) entries[id] = record;
  }
  if (!Object.keys(entries).length) return { seeded: 0, ids: [] };
  const result = await deltaStore.seedMissing(COLLECTION, entries, { userId: actorIdOf(actor) });
  return result || { seeded: 0, ids: [] };
}

/* Incoming/shared records are projected back into the legacy map shape. A
   null field is an explicit field tombstone; an absent field means “this
   shared record has no opinion about that map”. */
function overlay(overrides) {
  if (!authoritative()) return overrides;
  const records = deltaStore.readAllSync(COLLECTION);
  if (!records) return overrides;
  for (const mapName of Object.values(FIELDS)) {
    if (!overrides[mapName] || typeof overrides[mapName] !== 'object') overrides[mapName] = {};
  }
  for (const [id, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object') continue;
    for (const [field, mapName] of Object.entries(FIELDS)) {
      if (!own(record, field)) continue;
      const value = record[field];
      if (value == null) {
        if (field === 'notes') overrides[mapName][id] = legacyNoteTombstoneProjection();
        else delete overrides[mapName][id];
      } else overrides[mapName][id] = clone(value);
    }
  }
  return overrides;
}

function readAllSync() {
  return deltaStore ? (deltaStore.readAllSync(COLLECTION) || {}) : {};
}

module.exports = {
  COLLECTION, FIELDS, attachDeltaStore, attached, authoritative, legacyKeys,
  recordFromOverrides, patchFromOrderPatch, subfieldsFromOrderPatch, mirrorPatch, mirrorPatchDetached,
  notesExplicitlyCleared, legacyNoteTombstoneProjection,
  seedFromOverrides, overlay, readAllSync,
};
