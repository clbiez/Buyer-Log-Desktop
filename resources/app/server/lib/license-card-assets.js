'use strict';

/* License card images (covers, visual guides, symbols, template guides) live outside the
 * shared overrides store. Base64 images inside overrides.json made every read deep-copy and
 * every write rewrite tens of MB (store file, local-db snapshot/WAL, peer outbox) — the
 * whole application slowed down, not only License cards.
 *
 * Content-addressed and immutable:
 *   <server data>/license-card-assets/<sha256>.<ext>          local copy (served)
 *   <shared sync root>/BUYER_LOG_SYNC/license-card-assets/... distribution to other users
 *
 * Records keep only `/api/license-cards/assets/<sha256>.<ext>`. Same bytes → same name on
 * every device, so peers and repeated migrations never diverge. Until configured (unit
 * tests, tools) data URLs pass through unchanged.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const URL_PREFIX = '/api/license-cards/assets/';
const NAME_RE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const URL_RE = /^\/api\/license-cards\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/;
const DATA_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const SHARED_SUBDIR = path.join('BUYER_LOG_SYNC', 'license-card-assets');

let config = null;
function configure({ dir, getSharedSyncRoot = null } = {}) {
  config = dir ? { dir, getSharedSyncRoot } : null;
  if (config) fs.mkdirSync(dir, { recursive: true });
}
const isAssetUrl = value => typeof value === 'string' && URL_RE.test(value);
const nameOf = url => isAssetUrl(url) ? url.slice(URL_PREFIX.length) : '';

async function sharedDir() {
  if (!config || !config.getSharedSyncRoot) return '';
  try { const root = await config.getSharedSyncRoot(); return root ? path.join(root, SHARED_SUBDIR) : ''; } catch (_) { return ''; }
}
function writeAtomicSync(file, bytes) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, bytes);
  try { fs.renameSync(tmp, file); } catch (error) { try { fs.unlinkSync(tmp); } catch (_) {} if (!fs.existsSync(file)) throw error; }
}
// Best effort: the local copy is authoritative for this device; distribution retries on
// every later put/read and on the next migration.
async function distribute(name) {
  const dir = await sharedDir(); if (!dir) return false;
  try {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) return true;
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.copyFile(path.join(config.dir, name), tmp);
    await fsp.rename(tmp, target).catch(async error => { await fsp.unlink(tmp).catch(() => {}); if (!fs.existsSync(target)) throw error; });
    return true;
  } catch (_) { return false; }
}

// data URL → asset URL (writes the file once). Anything else is returned unchanged.
function externalizeImage(value) {
  if (!config || typeof value !== 'string') return value;
  const match = value.match(DATA_RE); if (!match) return value;
  const bytes = Buffer.from(match[2], 'base64');
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.${EXT[match[1]]}`, file = path.join(config.dir, name);
  if (!fs.existsSync(file)) writeAtomicSync(file, bytes);
  void distribute(name);
  return URL_PREFIX + name;
}
function externalizeAtlas(atlas) {
  if (!config || !atlas || typeof atlas !== 'object' || !atlas.license) return atlas;
  const out = { ...atlas, license: { ...atlas.license, cover: externalizeImage(atlas.license.cover) } };
  if (Array.isArray(atlas.visualLibrary)) out.visualLibrary = atlas.visualLibrary.map(item => item && item.data ? { ...item, data: externalizeImage(item.data) } : item);
  return out;
}

async function read(name) {
  if (!config || !NAME_RE.test(String(name || ''))) return null;
  const file = path.join(config.dir, name);
  try { const bytes = await fsp.readFile(file); void distribute(name); return { bytes, type: MIME[name.split('.').pop()] }; } catch (_) {}
  // Another user's image: fetch it once from the shared folder into the local store.
  const dir = await sharedDir(); if (!dir) return null;
  try {
    const bytes = await fsp.readFile(path.join(dir, name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0]) return null;
    writeAtomicSync(file, bytes);
    return { bytes, type: MIME[name.split('.').pop()] };
  } catch (_) { return null; }
}

// One pass over the stored license data: every inline image becomes an asset URL.
function externalizeOverrides(overrides) {
  if (!config || !overrides) return { changed: false, overrides };
  let changed = false;
  const state = overrides.licenseCards, templates = overrides.licenseStageTemplates;
  const items = state && Array.isArray(state.items) ? state.items.map(card => {
    const next = { ...card };
    if (card.processAtlas) next.processAtlas = externalizeAtlas(card.processAtlas);
    if (card.symbolDataUrl) next.symbolDataUrl = externalizeImage(card.symbolDataUrl);
    if (next.processAtlas !== card.processAtlas && JSON.stringify(next.processAtlas) !== JSON.stringify(card.processAtlas) || next.symbolDataUrl !== card.symbolDataUrl) { changed = true; return next; }
    return card;
  }) : null;
  const templateItems = templates && Array.isArray(templates.items) ? templates.items.map(item => {
    if (!item || !item.visual || !item.visual.data) return item;
    const data = externalizeImage(item.visual.data);
    if (data === item.visual.data) return item;
    changed = true; return { ...item, visual: { ...item.visual, data } };
  }) : null;
  if (!changed) return { changed: false, overrides, cards: [] };
  const next = { ...overrides };
  if (items) next.licenseCards = { ...state, items };
  if (templateItems) next.licenseStageTemplates = { ...templates, items: templateItems };
  return { changed: true, overrides: next, cards: items ? items.filter((card, i) => card !== state.items[i]) : [] };
}

module.exports = { URL_PREFIX, URL_RE, NAME_RE, configure, isAssetUrl, nameOf, externalizeImage, externalizeAtlas, externalizeOverrides, read, distribute };
