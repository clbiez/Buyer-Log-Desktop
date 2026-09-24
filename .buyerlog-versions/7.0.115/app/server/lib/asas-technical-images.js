'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LOCAL_DATA_ROOT, atomicWriteJson } = require('../user-data');
const parse = require('./parse');

const STATE_FILE = path.join(LOCAL_DATA_ROOT, 'asas-technical-images.json');
const STATE_VERSION = 1;
const RETRY_MS = 24 * 60 * 60 * 1000;

function emptyState() { return { version: STATE_VERSION, initialCompleted: false, records: {}, updatedAt: null }; }
function loadState() {
  for (const file of [STATE_FILE, `${STATE_FILE}.bak`]) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value && typeof value === 'object') return { ...emptyState(), ...value, records: value.records && typeof value.records === 'object' ? value.records : {} };
    } catch (_) {}
  }
  return emptyState();
}
function saveState(value) {
  const next = { ...emptyState(), ...(value || {}), version: STATE_VERSION, updatedAt: new Date().toISOString() };
  atomicWriteJson(STATE_FILE, next);
  return next;
}

function urlHash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24); }
function technicalImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'pim.prod.lcwaikiki.com') return '';
    if (!/^\/productimageoperation\/service\/customer\/api\/(?:CoreNectumAttachmentOperation\/GetAttachment\/[^/?#]+|PLMImageOperation\/GetStyleImageById\/[^/?#]+)\/?$/i.test(url.pathname)) return '';
    return url.href;
  } catch (_) { return ''; }
}

function candidateKey(order) { return parse.plmImageKey(order && order.plm); }
function analyzeCandidatesFromOrders(orders) {
  const found = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    // PLM Kod, PIM servisindeki Style ID değildir. Kaynak Teknik Görsel alanı
    // yoksa PLM kodundan tahmini GetStyleImageById URL'si üretmek başka bir
    // modelin görselini bağlayabilir; yalnız ASAS'ın verdiği doğrulanmış link
    // kullanılmalıdır.
    const key = candidateKey(order), url = technicalImageUrl(order && order.technicalImageUrl);
    if (!key || !url) continue;
    const current = found.get(key);
    if (!current) {
      found.set(key, { candidate: { key, url, plmId: order.plm, colourCode: order.ccode, modelName: order.model || '' }, urls: new Set([url]) });
      continue;
    }
    current.urls.add(url);
  }
  const candidates = [], conflicts = [];
  for (const { candidate, urls } of found.values()) {
    if (urls.size === 1) candidates.push(candidate);
    else conflicts.push({ key:candidate.key, plmId:candidate.plmId, colourCode:candidate.colourCode, modelName:candidate.modelName, urls:[...urls] });
  }
  return { candidates, conflicts };
}
function candidatesFromOrders(orders) { return analyzeCandidatesFromOrders(orders).candidates; }

function storedImageUsable(overrides, candidate, getImage) {
  const map = overrides && overrides.imagemap;
  if (!parse.plmImageUsable(map, candidate.plmId)) return false;
  if (!getImage) return true;
  return parse.plmImageKeysFor(map, candidate.plmId).some(key => {
    const ref = String(map[key] || '').trim();
    return Boolean(ref && getImage(ref));
  });
}

async function syncAsasTechnicalImages(options = {}) {
  const state = loadState();
  const analysis = analyzeCandidatesFromOrders(options.orders), candidates = analysis.candidates;
  const overrides = options.overrides || {};
  const now = Date.now(), pending = [];
  const replaceExisting = options.mode === 'all' || options.replaceExisting === true;
  const forceRetry = options.forceRetry === true;
  const requestedKeys = options.keys instanceof Set ? options.keys : null;
  const conflictFailures = analysis.conflicts.filter(candidate => !requestedKeys || requestedKeys.has(candidate.key)).map(candidate => {
    const failure = { plmId:candidate.plmId, colourCode:candidate.colourCode, code:'ASAS_TECHNICAL_IMAGE_AMBIGUOUS', error:`Aynı PLM Kod için ${candidate.urls.length} farklı Teknik Görsel bağlantısı bulundu; yanlış görsel bağlanmaması için kayıt atlandı.` };
    state.records[candidate.key] = { status:'failed', urlHash:urlHash(candidate.urls.slice().sort().join('|')), attempts:Number(state.records[candidate.key] && state.records[candidate.key].attempts || 0) + 1, lastError:failure.error, retryAt:now + RETRY_MS, updatedAt:new Date().toISOString() };
    return failure;
  });
  for (const candidate of candidates) {
    if (requestedKeys && !requestedKeys.has(candidate.key)) continue;
    const record = state.records[candidate.key] || null;
    const usable = storedImageUsable(overrides, candidate, options.getImage);
    if (!replaceExisting && usable) continue;
    if (!forceRetry && record && record.status === 'failed' && Number(record.retryAt) > now) continue;
    pending.push(candidate);
  }
  if (!pending.length) {
    if (conflictFailures.length) saveState(state);
    return { mode: replaceExisting?'all':'missing', candidates: candidates.length + analysis.conflicts.length, requested: conflictFailures.length, saved: 0, failed: conflictFailures.length, failedItems:conflictFailures, images:[], overrides };
  }

  const collected = await options.collect(pending);
  const images = collected && collected.images instanceof Map ? collected.images : new Map();
  const failures = collected && collected.failures instanceof Map ? collected.failures : new Map();
  const links = [], stored = [], replacedRefs = [], failedItems=[...conflictFailures];
  for (const candidate of pending) {
    const image = images.get(candidate.key);
    if (!image || !image.base64 || !image.mimeType) {
      const failure = failures.get(candidate.key) || { code: 'ASAS_TECHNICAL_IMAGE_MISSING', error: 'Teknik Resim yanıtı alınamadı.' };
      state.records[candidate.key] = { status: 'failed', urlHash: urlHash(candidate.url), attempts: Number(state.records[candidate.key] && state.records[candidate.key].attempts || 0) + 1, lastError: String(failure.error || failure.code || '').slice(0, 300), retryAt: now + RETRY_MS, updatedAt: new Date().toISOString() };
      failedItems.push({plmId:candidate.plmId,colourCode:candidate.colourCode,code:failure.code||'ASAS_TECHNICAL_IMAGE_MISSING',error:String(failure.error||failure.code||'')});
      continue;
    }
    const oldRef = String(parse.plmImageRef(overrides.imagemap, { plm: candidate.plmId, ccode: '' }) || '').trim();
    const saved = options.saveImage({ rowId: `asas:${candidate.key}`, filename: image.filename || `asas-${candidate.plmId}.jpg`, mimeType: image.mimeType, base64: image.base64 });
    stored.push(saved.id);
    if (replaceExisting && oldRef && oldRef !== saved.id) replacedRefs.push(oldRef);
    links.push({ plmId: candidate.plmId, colourCode: '', imageRef: saved.id });
    state.records[candidate.key] = { status: 'saved', urlHash: urlHash(candidate.url), imageRef: saved.id, attempts: Number(state.records[candidate.key] && state.records[candidate.key].attempts || 0) + 1, updatedAt: new Date().toISOString() };
  }

  let patched = null;
  try { if (links.length) patched = options.patchLinks(links); }
  catch (error) { stored.forEach(ref => { try { options.deleteImage(ref); } catch (_) {} }); throw error; }
  if (patched && patched.overrides) options.onOverrides && options.onOverrides(patched.overrides);
  const activeMap = patched && patched.overrides && patched.overrides.imagemap || overrides.imagemap || {};
  const activeRefs = new Set(Object.values(activeMap).map(value => String(value || '').trim()).filter(Boolean));
  replacedRefs.forEach(ref => { if (!activeRefs.has(ref)) { try { options.deleteImage(ref); } catch (_) {} } });
  saveState(state);
  return { mode: replaceExisting?'all':'missing', candidates: candidates.length + analysis.conflicts.length, requested: pending.length + conflictFailures.length, saved: links.length, failed: pending.length + conflictFailures.length - links.length, failedItems, images: links, overrides: patched && patched.overrides || overrides };
}

module.exports = { STATE_FILE, STATE_VERSION, RETRY_MS, technicalImageUrl, analyzeCandidatesFromOrders, candidatesFromOrders, loadState, saveState, syncAsasTechnicalImages };
