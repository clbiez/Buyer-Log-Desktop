'use strict';

const crypto = require('node:crypto');
const canonical = require('./canonical-fields');
const businessRules = require('../../public/business-rules');
const atlas = require('../../public/license-atlas-engine');

const PROFILE_LIMITS = Object.freeze({ workingNotes: 12000, contactName: 200, contactEmail: 320,
  portalUrl: 2048, portalUsername: 200, accessReference: 1000, artworkBrief: 6000 });
const MAX_SYMBOL_BYTES = 512 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => String(value == null ? '' : value).trim();
const pairKey = (license, licensor) => JSON.stringify([canonical.token(license), canonical.token(licensor)]);

function fail(code, message, statusCode = 400) {
  const error = new Error(message); error.code = code; error.statusCode = statusCode; throw error;
}
function revisionOf(overrides, section) { return Number(overrides && overrides._revisions && overrides._revisions[section]) || 0; }
function assertRevision(value, current, section) {
  if (value == null || value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    fail('REVISION_REQUIRED', 'Güncel revizyon zorunlu. / Current revision is required.');
  }
  if (Number(value) !== current) {
    const error = new Error('Veri değişti; yeniden yükleyin. / Data changed; reload before saving.');
    Object.assign(error, { code: 'REVISION_CONFLICT', statusCode: 409, expectedRevision: Number(value), currentRevision: current, revisionKey: section });
    throw error;
  }
}
function stateOf(overrides) {
  const state = overrides && overrides.licenseCards;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? { schemaVersion: 1, initialized: state.initialized === true, lastImportedAt: state.lastImportedAt || null, items: Array.isArray(state.items) ? state.items : [] }
    : { schemaVersion: 1, initialized: false, lastImportedAt: null, items: [] };
}
function cardId(license, licensor) { return 'license-' + crypto.createHash('sha256').update(pairKey(license, licensor)).digest('hex').slice(0, 24); }

// Pricing rules are also a canonical source. Materialize virtual pairs only on write.
function catalogue(overrides) {
  const items = clone(stateOf(overrides).items), known = new Set(items.map(c => pairKey(c.license,c.licensor)));
  for (const rule of overrides.pricingRules || []) {
    const license=text(rule.license), licensor=text(rule.licensor), key=pairKey(license,licensor);
    if (!license || !licensor || known.has(key)) continue;
    known.add(key);items.push({id:cardId(license,licensor),license,licensor,
      ...Object.fromEntries(Object.keys(PROFILE_LIMITS).map(field=>[field,''])),symbolDataUrl:''});
  }
  return items;
}

// Source rows must have an existing canonical module binding; header guesses are forbidden.
function discoverPairs(input) {
  const envelope = Array.isArray(input) ? { rows: input, module: 'cp' } : input || {};
  if (!Array.isArray(envelope.rows)) fail('LICENSE_SOURCE_UNAVAILABLE', 'ASAS kaynağı hazır değil. / ASAS source is not ready.', 503);
  const found = new Map();
  for (const entry of envelope.rows) {
    const row = entry && entry.row || entry, module = entry && entry.module || envelope.module || 'cp';
    const license = text(canonical.canonicalValue(row, module, 'license'));
    const licensor = text(canonical.canonicalValue(row, module, 'licensor'));
    if (!license || !canonical.token(license)) continue;
    if (license.length > 200 || licensor.length > 200) continue;
    const key = pairKey(license, licensor);
    if (!found.has(key)) found.set(key, { license, licensor });
  }
  const pairs = [...found.values()], assignedLicenses = new Set(pairs.filter(pair => pair.licensor).map(pair => canonical.token(pair.license)));
  return pairs.filter(pair => pair.licensor || !assignedLicenses.has(canonical.token(pair.license)));
}
// Same Licensor precedence as the CP rows: a Licensor picked manually in CP for
// the order line (licensormap) > ASAS Licensor > License Royalty contract /
// catalogue. Ignoring the manual choice left such licenses without a licensor.
function discoveryRowsFromOrders(sources, overrides, parse) {
  const pairs = new Map(), licensormap = overrides && overrides.licensormap || {};
  const add = (license, licensor) => { license = text(license); licensor = text(licensor); if (license) pairs.set(pairKey(license, licensor), { License: license, Licensor: licensor }); };
  for (const rows of sources || []) for (const row of Array.isArray(rows) ? rows : []) {
    const license = canonical.canonicalValue(row, 'cp', 'license');
    if (!text(license)) continue;
    const manual = parse.overrideHas(licensormap, row) ? text(parse.overrideGet(licensormap, row)) : '';
    const sourceLicensor = text(canonical.canonicalValue(row, 'cp', 'licensor'));
    add(license, manual || sourceLicensor || parse.pricingLicensorForLicense(license, overrides && overrides.pricingRules));
  }
  for (const rule of overrides && overrides.pricingRules || []) add(rule.license, rule.licensor);
  return [...pairs.values()];
}
const hasCardData = card => Boolean(card.processAtlas || card.symbolDataUrl || Object.keys(PROFILE_LIMITS).some(field => text(card[field])));
// A licensor-less placeholder from an earlier import is superseded once the same
// license has a card with a real licensor; keep it only if someone stored data on it.
function visibleCatalogue(overrides) {
  const items = catalogue(overrides);
  const assigned = new Set(items.filter(card => text(card.licensor)).map(card => canonical.token(card.license)));
  return items.filter(card => text(card.licensor) || !assigned.has(canonical.token(card.license)) || hasCardData(card));
}
function appendDiscovered(overrides, pairs, now = new Date().toISOString()) {
  const state = clone(stateOf(overrides)), known = new Set(state.items.map(card => pairKey(card.license, card.licensor)));
  // A licensor typed manually keeps the card's licensor-less id; ASAS still reporting the
  // license without a licensor must not recreate a second card with that id.
  const ids = new Set(state.items.map(card => card.id));
  const assigned = new Map();
  for (const pair of pairs.filter(pair => pair.licensor)) {
    const key = canonical.token(pair.license); if (!assigned.has(key)) assigned.set(key, []);
    assigned.get(key).push(pair);
  }
  // ASAS can populate a previously missing Licensor later. Resolve only a
  // unique pair; retain the stable card ID and all manually entered details.
  for (const card of state.items.filter(card => !card.licensor)) {
    const candidates = assigned.get(canonical.token(card.license)) || [];
    if (candidates.length !== 1 || known.has(pairKey(candidates[0].license, candidates[0].licensor))) continue;
    known.delete(pairKey(card.license, card.licensor));
    card.licensor = candidates[0].licensor; card.updatedAt = now;
    known.add(pairKey(card.license, card.licensor));
  }
  let added = 0;
  for (const pair of pairs) {
    const key = pairKey(pair.license, pair.licensor);
    if (known.has(key) || ids.has(cardId(pair.license, pair.licensor))) continue;
    known.add(key); ids.add(cardId(pair.license, pair.licensor)); added++;
    state.items.push({ id: cardId(pair.license, pair.licensor), license: pair.license, licensor: pair.licensor,
      ...Object.fromEntries(Object.keys(PROFILE_LIMITS).map(field => [field, ''])), symbolDataUrl: '', createdAt: now, updatedAt: now });
  }
  state.initialized = true; state.lastImportedAt = now;
  const next = { ...overrides, licenseCards: state, _revisions: { ...(overrides._revisions || {}), licenseCards: revisionOf(overrides, 'licenseCards') + 1 } };
  return { overrides: next, added };
}

function rasterDimensions(bytes, mime) {
  if (mime === 'png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mime === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      }
      offset += length;
    }
  }
  if (mime === 'webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (kind === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
  }
  return null;
}
function validateSymbol(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_SYMBOL_BYTES / 3) * 4 + 40) fail('LICENSE_SYMBOL_INVALID', 'Sembol en fazla 512 KB olabilir. / Symbol must be at most 512 KB.');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4) fail('LICENSE_SYMBOL_INVALID', 'PNG, JPEG veya WebP sembol yükleyin. / Upload a PNG, JPEG or WebP symbol.');
  const bytes = Buffer.from(match[2], 'base64'), dimensions = rasterDimensions(bytes, match[1]);
  if (bytes.length > MAX_SYMBOL_BYTES || bytes.toString('base64') !== match[2] || !dimensions || dimensions.some(side => side < 1 || side > 2048)) {
    fail('LICENSE_SYMBOL_INVALID', 'Geçersiz sembol; en fazla 2048×2048 piksel. / Invalid symbol; maximum 2048×2048 pixels.');
  }
  return value;
}
function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('LICENSE_PROFILE_INVALID', 'Kart bilgileri zorunlu. / Card profile is required.');
  const out = {};
  for (const [field, value] of Object.entries(profile)) {
    if (field === 'processAtlas') { out[field] = atlas.normalize(value); continue; }
    if (field === 'symbolDataUrl') { out[field] = validateSymbol(value); continue; }
    if (!Object.hasOwn(PROFILE_LIMITS, field)) fail('LICENSE_PROFILE_FIELD', 'Desteklenmeyen kart alanı. / Unsupported card field.');
    if (value != null && typeof value !== 'string') fail('LICENSE_PROFILE_INVALID', 'Kart alanı metin olmalı. / Card field must be text.');
    const normalized = text(value);
    if (normalized.length > PROFILE_LIMITS[field]) fail('LICENSE_PROFILE_INVALID', 'Kart alanı çok uzun. / Card field is too long.');
    if (field === 'portalUrl' && normalized) {
      let url; try { url = new URL(normalized); } catch (_) { fail('LICENSE_PORTAL_INVALID', 'Geçerli portal adresi girin. / Enter a valid portal URL.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('LICENSE_PORTAL_INVALID', 'Portal adresi HTTP(S) olmalı ve parola içermemeli. / Portal URL must use HTTP(S) and contain no credentials.');
    }
    out[field] = normalized;
  }
  return out;
}

function normalizeRules(incoming, card, deps) {
  if (!Array.isArray(incoming) || incoming.length > 500 || incoming.some(rule => !rule || typeof rule !== 'object' || Array.isArray(rule))) fail('LICENSE_RULES_INVALID', 'Geçerli kural dizisi zorunlu. / A valid rules array is required.');
  const rules = businessRules.migrateLicenseRoyaltyRules(incoming);
  const numeric = value => ['number', 'string'].includes(typeof value) ? Number(value) : NaN;
  const nullableNumber = value => value == null || text(value) === '' ? null : numeric(value);
  const requiredNumber = value => value == null || text(value) === '' ? NaN : numeric(value);
  return rules.map(raw => {
    if ((raw.license && pairKey(raw.license, raw.licensor || card.licensor) !== pairKey(card.license, card.licensor)) || (raw.licensor && canonical.token(raw.licensor) !== canonical.token(card.licensor))) fail('LICENSE_RULE_SCOPE', 'Kural bu lisans ve lisansöre ait olmalı. / Rule must belong to this license and licensor.');
    const date = field => {
      const value = text(raw[field]), normalized = deps.normalizePricingRuleDate(value);
      if (value && !normalized) fail('LICENSE_RULE_DATE', 'Geçerli OPD tarihi girin. / Enter a valid OPD date.');
      return normalized;
    };
    const rule = { id: text(raw.id) || 'license-rule-' + crypto.randomUUID(), opdStart: date('opdStart'), opdEnd: date('opdEnd'),
      seasons: deps.normalizePricingRuleSeasons(raw.seasons != null ? raw.seasons : raw.season), license: card.license, licensor: card.licensor,
      royalty: requiredNumber(raw.royalty), trCommission: nullableNumber(raw.trCommission), ydCommission: nullableNumber(raw.ydCommission), hologramCost: requiredNumber(raw.hologramCost),
      legacyTrHologramCost: nullableNumber(raw.legacyTrHologramCost), legacyYdHologramCost: nullableNumber(raw.legacyYdHologramCost),
      legacyRuleIds: Array.isArray(raw.legacyRuleIds) ? raw.legacyRuleIds.map(String).filter(Boolean) : [], migratedFromCountrySplit: raw.migratedFromCountrySplit === true };
    const commissions = [rule.trCommission, rule.ydCommission].filter(value => value != null);
    if (!card.licensor || rule.id.length > 200 || rule.seasons.length > 100 || rule.seasons.some(season => season.length > 200)
      || (rule.opdStart && rule.opdEnd && rule.opdStart > rule.opdEnd)
      || !Number.isFinite(rule.royalty) || rule.royalty < 0 || rule.royalty > 100
      || !commissions.length || commissions.some(value => !Number.isFinite(value) || value < 0 || value + rule.royalty > 100)
      || !Number.isFinite(rule.hologramCost) || rule.hologramCost < 0
      || [rule.legacyTrHologramCost, rule.legacyYdHologramCost].some(value => value != null && (!Number.isFinite(value) || value < 0))) {
      fail('LICENSE_RULES_INVALID', 'Kural oranları veya tarih aralığı geçersiz. / Invalid rule rates or date range.');
    }
    return rule;
  });
}
function mergeRules(existing, incoming, card, deps) {
  const cardKey = pairKey(card.license, card.licensor), ids = new Set();
  for (const rule of incoming) {
    if (ids.has(rule.id)) fail('LICENSE_RULE_ID', 'Kural kimliği tekrarlanamaz. / Rule IDs must be unique.');
    ids.add(rule.id);
    if (existing.some(previous => text(previous.id) === rule.id && pairKey(previous.license, previous.licensor) !== cardKey)) fail('LICENSE_RULE_SCOPE', 'Kural kimliği başka bir lisansa ait. / Rule ID belongs to another license.');
  }
  // Omitted historical rules and every unrelated license remain intact.
  const merged = existing.filter(rule => !ids.has(text(rule.id))).concat(incoming);
  const associated = merged.filter(rule => pairKey(rule.license, rule.licensor) === cardKey);
  for (let i = 0; i < associated.length; i++) for (let j = i + 1; j < associated.length; j++) {
    const a = associated[i], b = associated[j], sameCountry = (a.trCommission != null && b.trCommission != null) || (a.ydCommission != null && b.ydCommission != null);
    if (sameCountry && deps.pricingRuleSeasonSetsOverlap(a, b) && deps.pricingRuleDateRangesOverlap(a, b)) fail('LICENSE_RULE_OVERLAP', 'Aynı ülke ve sezon için OPD aralıkları çakışamaz. / OPD periods cannot overlap for the same country and season.');
  }
  return merged;
}
// Scope optimistic edits to the opened card and its contracts. Import timestamps
// and changes to unrelated cards/rates must not invalidate an editor.
function editToken(card, rules) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const profile = Object.fromEntries([...Object.keys(PROFILE_LIMITS), 'symbolDataUrl', 'processAtlas'].map(key => [key, card[key] || '']));
  const contracts = rules.filter(rule => pairKey(rule.license, rule.licensor) === pairKey(card.license, card.licensor)).map(stable);
  contracts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash('sha256').update(JSON.stringify(stable({ id: card.id, license: card.license, licensor: card.licensor, profile, contracts }))).digest('hex');
}
function updateCard(overrides, id, body, deps, now = new Date().toISOString()) {
  const state = clone(stateOf(overrides));
  if(!state.items.some(card=>card.id===id)){const virtual=catalogue(overrides).find(card=>card.id===id);if(virtual)state.items.push(virtual);}
  const index = state.items.findIndex(card => card.id === id);
  if (index < 0) fail('LICENSE_CARD_NOT_FOUND', 'Lisans kartı bulunamadı. / License card not found.', 404);
  const scoped = Object.hasOwn(body, 'editToken');
  if (scoped) {
    if (typeof body.editToken !== 'string' || body.editToken !== editToken(state.items[index], overrides.pricingRules || [])) {
      fail('REVISION_CONFLICT', 'Açılan kart değişti; güncel kaydı açın. / The opened card changed; open the current record.', 409);
    }
  } else assertRevision(body.revision != null ? body.revision : body.expectedRevision, revisionOf(overrides, 'licenseCards'), 'licenseCards');
  const profile = body.profile == null ? Object.fromEntries(Object.entries(body).filter(([key]) => !['revision','expectedRevision','pricingRevision','expectedPricingRevision','rules','editToken'].includes(key))) : body.profile;
  const normalized = normalizeProfile(profile);
  if (normalized.processAtlas) normalized.processAtlas = linkTemplates(normalized.processAtlas, templatesOf(overrides).items);
  state.items[index] = { ...state.items[index], ...normalized, updatedAt: now };
  const next = { ...overrides, licenseCards: state, _revisions: { ...(overrides._revisions || {}), licenseCards: revisionOf(overrides, 'licenseCards') + 1 } };
  let rulesChanged = false;
  if (Object.hasOwn(body, 'rules')) {
    if (!scoped) assertRevision(body.pricingRevision != null ? body.pricingRevision : body.expectedPricingRevision, revisionOf(overrides, 'pricingRules'), 'pricingRules');
    const existing = Array.isArray(overrides.pricingRules) ? overrides.pricingRules : [];
    const rules = mergeRules(existing, normalizeRules(body.rules, state.items[index], deps), state.items[index], deps);
    rulesChanged = JSON.stringify(existing) !== JSON.stringify(rules);
    if (rulesChanged) { next.pricingRules = rules; next._revisions.pricingRules = revisionOf(overrides, 'pricingRules') + 1; }
  }
  return { overrides: next, card: state.items[index], rulesChanged };
}
// Manual licensor. A licensor-less card may be assigned one (its stable id is kept);
// any card may get a sibling row for another licensor, optionally copying its details
// and map. Renaming an existing licensor is not offered: peers identify a card by its
// license × licensor pair and reject a changed pair (license-card-sync).
function setLicensor(overrides, id, body, now = new Date().toISOString()) {
  const state = clone(stateOf(overrides));
  if (!state.items.some(card => card.id === id)) { const virtual = catalogue(overrides).find(card => card.id === id); if (virtual) state.items.push(virtual); }
  const index = state.items.findIndex(card => card.id === id);
  if (index < 0) fail('LICENSE_CARD_NOT_FOUND', 'Lisans kartı bulunamadı. / License card not found.', 404);
  const card = state.items[index];
  if (typeof body?.editToken !== 'string' || body.editToken !== editToken(card, overrides.pricingRules || [])) fail('REVISION_CONFLICT', 'Açılan kart değişti; güncel kaydı açın. / The opened card changed; open the current record.', 409);
  const licensor = text(body.licensor);
  if (!licensor || licensor.length > 200) fail('LICENSE_LICENSOR_INVALID', 'Geçerli bir lisansör girin. / Enter a valid licensor.');
  if (state.items.some(item => pairKey(item.license, item.licensor) === pairKey(card.license, licensor))) fail('LICENSE_LICENSOR_EXISTS', 'Bu lisans için bu lisansörün satırı zaten var. / This license already has a row for this licensor.', 409);
  let result;
  if (body.mode === 'add') {
    result = { id: cardId(card.license, licensor), license: card.license, licensor, ...Object.fromEntries(Object.keys(PROFILE_LIMITS).map(field => [field, ''])), symbolDataUrl: '', createdAt: now, updatedAt: now };
    if (body.copy === true) {
      for (const field of [...Object.keys(PROFILE_LIMITS), 'symbolDataUrl']) result[field] = card[field] || '';
      if (card.processAtlas) { result.processAtlas = clone(card.processAtlas); result.processAtlas.license.agency = licensor; result.processAtlas = atlas.normalize(result.processAtlas); }
    }
    state.items.push(result);
  } else {
    if (text(card.licensor)) fail('LICENSE_LICENSOR_LOCKED', 'Lisansörü olan satır değiştirilemez; başka lisansör için satır ekleyin. / A row with a licensor cannot be renamed; add a row for the other licensor.');
    card.licensor = licensor; card.updatedAt = now;
    if (card.processAtlas?.license) card.processAtlas = atlas.normalize({ ...clone(card.processAtlas), license: { ...card.processAtlas.license, agency: licensor } });
    result = card;
  }
  const next = { ...overrides, licenseCards: state, _revisions: { ...(overrides._revisions || {}), licenseCards: revisionOf(overrides, 'licenseCards') + 1 } };
  return { overrides: next, card: result };
}

/* ---- Stage templates: one shared definition, applied to every linked stage. ---- */
const MAX_TEMPLATES = 60;
const TEMPLATE_VISUAL = id => 'tpl-' + id;
const TEMPLATE_ADDRESS = templateId => id => `tpl-${templateId}-${id}`;
function templatesOf(overrides) {
  const t = overrides && overrides.licenseStageTemplates;
  const deleted = t && t.deleted && typeof t.deleted === 'object' && !Array.isArray(t.deleted) ? t.deleted : {};
  return t && Array.isArray(t.items) ? { items: t.items, updatedAt: t.updatedAt || '', deleted } : { items: [], updatedAt: '', deleted };
}
function normalizeTemplate(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('LICENSE_TEMPLATE_INVALID', 'Geçerli bir aşama taslağı gerekli. / A valid stage template is required.');
  const id = text(raw.id) || 'stage-template-' + crypto.randomUUID(), name = text(raw.name);
  if (id.length > 200 || !name || name.length > 120) fail('LICENSE_TEMPLATE_INVALID', 'Taslak adı 1–120 karakter olmalı. / Template name must be 1–120 characters.');
  let normalized;
  try { normalized = atlas.normalizeStage(raw.stage || {}, Array.isArray(raw.addresses) ? raw.addresses : []); }
  catch (_) { fail('LICENSE_TEMPLATE_INVALID', 'Taslak aşaması geçersiz. / The template stage is invalid.'); }
  const stage = normalized.stage; delete stage.templateId; delete stage.visualGuideId;
  const used = new Set((stage.submissions || []).map(route => route.addressId).filter(Boolean));
  let visual = null;
  if (raw.visual && raw.visual.data) {
    const checked = atlas.normalize({ license: { stages: [] }, visualLibrary: [{ id: 'v', name: text(raw.visual.name).slice(0, 200), data: raw.visual.data }] }).visualLibrary[0];
    visual = { name: checked.name, data: checked.data };
  }
  return { id, name, stage, addresses: normalized.addresses.filter(address => used.has(address.id)), visual, updatedAt: now };
}
// Template content replaces the stage; its id, on/off state and link stay.
function applyTemplate(stage, template, processAtlas) {
  const license = processAtlas.license, own = TEMPLATE_ADDRESS(template.id);
  const next = { ...clone(template.stage), id: stage.id, enabled: stage.enabled !== false, templateId: template.id };
  // Template addresses live under their own ids, so a template save never overwrites an
  // address the license edits for its other steps.
  next.submissions = (next.submissions || []).map(route => ({ ...route, addressId: route.addressId ? own(route.addressId) : '' }));
  license.addresses = Array.isArray(license.addresses) ? license.addresses : [];
  for (const address of template.addresses || []) {
    const copy = { ...clone(address), id: own(address.id) }, at = license.addresses.findIndex(item => item.id === copy.id);
    if (at < 0) license.addresses.push(copy); else license.addresses[at] = copy;
  }
  processAtlas.visualLibrary = Array.isArray(processAtlas.visualLibrary) ? processAtlas.visualLibrary : [];
  const visualId = TEMPLATE_VISUAL(template.id), at = processAtlas.visualLibrary.findIndex(item => item.id === visualId);
  if (template.visual) {
    const entry = { id: visualId, name: template.visual.name, data: template.visual.data };
    if (at < 0) processAtlas.visualLibrary.push(entry); else processAtlas.visualLibrary[at] = entry;
    next.visualGuideId = visualId;
  } else next.visualGuideId = '';
  return next;
}
function pruneTemplateVisuals(processAtlas) {
  const used = new Set((processAtlas.license.stages || []).map(stage => stage.visualGuideId).filter(Boolean));
  processAtlas.visualLibrary = (processAtlas.visualLibrary || []).filter(item => !item.id.startsWith('tpl-') || used.has(item.id));
  const routed = new Set((processAtlas.license.stages || []).flatMap(stage => (stage.submissions || []).map(route => route.addressId)).filter(Boolean));
  processAtlas.license.addresses = (processAtlas.license.addresses || []).filter(item => !String(item.id).startsWith('tpl-') || routed.has(item.id));
}
// A linked stage always carries its template's current content, whatever the client sent.
function linkTemplates(processAtlas, templates) {
  const stages = processAtlas?.license?.stages;
  if (!Array.isArray(stages) || !stages.some(stage => stage.templateId)) return processAtlas;
  const next = clone(processAtlas), byId = new Map(templates.map(item => [item.id, item]));
  next.license.stages = next.license.stages.map(stage => {
    if (!stage.templateId) return stage;
    const template = byId.get(stage.templateId);
    if (template) return applyTemplate(stage, template, next);
    const local = { ...stage }; delete local.templateId; return local;
  });
  pruneTemplateVisuals(next);
  try { return atlas.normalize(next); }
  catch (_) { fail('LICENSE_ATLAS_INVALID', 'Harita taslaklarla 2 MB sınırını aşıyor. / The map exceeds 2 MB with its templates.'); }
}
// Re-applies (or, for a removed template, unlinks) every stage that uses templateId.
function propagateTemplate(state, templateId, template, now) {
  const changed = [];
  for (const card of state.items) {
    const stages = card.processAtlas?.license?.stages;
    if (!Array.isArray(stages) || !stages.some(stage => stage.templateId === templateId)) continue;
    const next = clone(card.processAtlas);
    next.license.stages = next.license.stages.map(stage => {
      if (stage.templateId !== templateId) return stage;
      if (template) return applyTemplate(stage, template, next);
      const local = { ...stage }; delete local.templateId; return local;
    });
    pruneTemplateVisuals(next);
    let normalized;
    try { normalized = atlas.normalize(next); }
    catch (_) { fail('LICENSE_ATLAS_INVALID', `Taslak ${card.license} haritasını 2 MB sınırının üzerine çıkarıyor. / The template pushes the ${card.license} map over 2 MB.`); }
    if (JSON.stringify(normalized) !== JSON.stringify(card.processAtlas)) { card.processAtlas = normalized; card.updatedAt = now; changed.push(card); }
  }
  return changed;
}
function saveTemplate(overrides, body, now = new Date().toISOString()) {
  const current = templatesOf(overrides), template = normalizeTemplate(body?.template, now);
  const existing = current.items.find(item => item.id === template.id);
  if (existing && body.expectedUpdatedAt !== existing.updatedAt) fail('REVISION_CONFLICT', 'Taslak başka biri tarafından değiştirildi; yeniden açın. / The template changed elsewhere; reopen it.', 409);
  if (!existing && current.items.length >= MAX_TEMPLATES) fail('LICENSE_TEMPLATE_LIMIT', 'En fazla 60 aşama taslağı tutulabilir. / Up to 60 stage templates are kept.');
  if (current.items.some(item => item.id !== template.id && text(item.name).toLocaleLowerCase('tr') === template.name.toLocaleLowerCase('tr'))) fail('LICENSE_TEMPLATE_NAME', 'Bu adla bir taslak zaten var. / A template with this name already exists.', 409);
  const items = existing ? current.items.map(item => item.id === template.id ? template : item) : [...current.items, template];
  const state = clone(stateOf(overrides)), changed = propagateTemplate(state, template.id, template, now);
  const deleted = { ...current.deleted }; delete deleted[template.id];
  const next = { ...overrides, licenseCards: state, licenseStageTemplates: { items, updatedAt: now, deleted },
    _revisions: { ...(overrides._revisions || {}), licenseCards: revisionOf(overrides, 'licenseCards') + 1 } };
  return { overrides: next, template, cards: changed };
}
function deleteTemplate(overrides, id, body, now = new Date().toISOString()) {
  const current = templatesOf(overrides), existing = current.items.find(item => item.id === id);
  if (!existing) fail('LICENSE_TEMPLATE_NOT_FOUND', 'Aşama taslağı bulunamadı. / Stage template not found.', 404);
  if (body?.expectedUpdatedAt !== existing.updatedAt) fail('REVISION_CONFLICT', 'Taslak başka biri tarafından değiştirildi; yeniden açın. / The template changed elsewhere; reopen it.', 409);
  const state = clone(stateOf(overrides)), changed = propagateTemplate(state, id, null, now);
  const deleted = Object.fromEntries(Object.entries({ ...current.deleted, [id]: now }).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 200));
  const next = { ...overrides, licenseCards: state, licenseStageTemplates: { items: current.items.filter(item => item.id !== id), updatedAt: now, deleted },
    _revisions: { ...(overrides._revisions || {}), licenseCards: revisionOf(overrides, 'licenseCards') + 1 } };
  return { overrides: next, cards: changed };
}
/* ---- Licensor name merges ("ERMODA" ≡ "ERMODA UK LTD"): automatic by name key; the
   user can split a wrong merge. Entries are per key with a timestamp (newest wins). ---- */
function licensorMergesOf(overrides) {
  const raw = overrides && overrides.licensorMerges, entries = raw && raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries) ? raw.entries : {};
  return { entries, updatedAt: (raw && raw.updatedAt) || '', split: Object.keys(entries).filter(key => entries[key] && entries[key].split === true && !entries[key].source).sort() };
}
function setLicensorMerge(overrides, body, now = new Date().toISOString()) {
  const current = licensorMergesOf(overrides);
  let key, entry;
  if (body && Object.hasOwn(body, 'source')) {
    // Stable source identity: a manual alias can be remapped or undone without
    // modifying a card's licensor, price rule, contract, or supplier atlas.
    const source=text(body.source),target=text(body.target);
    if (!source || !target || source.length>200 || target.length>200 || typeof body.split!=='boolean'
        || businessRules.turkNorm(source)===businessRules.turkNorm(target))
      fail('LICENSE_MERGE_INVALID','İki farklı lisansör seçin. / Select two different licensors.');
    const available=new Set(catalogue(overrides).map(card=>businessRules.turkNorm(card.licensor)).filter(Boolean));
    if (!available.has(businessRules.turkNorm(source)) || !available.has(businessRules.turkNorm(target)))
      fail('LICENSE_MERGE_INVALID','Lisansörlerden biri bulunamadı. / One of the licensors was not found.');
    key='m:'+crypto.createHash('sha256').update(businessRules.turkNorm(source)).digest('hex').slice(0,24);
    if (body.split===true && (!current.entries[key] || businessRules.turkNorm(current.entries[key].target)!==businessRules.turkNorm(target)))
      fail('LICENSE_MERGE_INVALID','Manuel birleştirme bulunamadı. / Manual merge was not found.');
    entry={source,target,split:body.split,at:now};
  } else {
    key=businessRules.licensorMergeKey(body && body.key);
    if (!key || key.length>200 || typeof body.split!=='boolean')
      fail('LICENSE_MERGE_INVALID','Geçerli bir lisansör birleştirmesi gerekli. / A valid licensor merge is required.');
    entry={split:body.split,at:now};
  }
  const entries=Object.fromEntries(Object.entries({ ...current.entries, [key]:entry })
    .sort((a,b)=>String(b[1].at).localeCompare(String(a[1].at))).slice(0,500));
  const revisions=overrides._revisions||{};
  // Royalty matching uses these aliases; trigger all pricing consumers to recalculate.
  const next={...overrides,licensorMerges:{entries,updatedAt:now},_revisions:{...revisions,
    licenseCards:revisionOf(overrides,'licenseCards')+1,pricingRules:revisionOf(overrides,'pricingRules')+1}};
  return {overrides:next,licensorMerges:licensorMergesOf(next)};
}
function responseOf(overrides, canEdit) {
  const state = stateOf(overrides), rules = Array.isArray(overrides.pricingRules) ? overrides.pricingRules : [];
  const byPair = new Map();
  for (const rule of rules) { const key = pairKey(rule.license, rule.licensor); if (!byPair.has(key)) byPair.set(key, []); byPair.get(key).push(rule); }
  return { cards: visibleCatalogue(overrides).map(card => ({ ...card, editToken: editToken(card, rules), rules: byPair.get(pairKey(card.license, card.licensor)) || [] })),
    pricingRules: rules, revision: revisionOf(overrides, 'licenseCards'), pricingRevision: revisionOf(overrides, 'pricingRules'), initialized: state.initialized,
    lastImportedAt: state.lastImportedAt, stageTemplates: templatesOf(overrides).items, licensorMerges: { split: licensorMergesOf(overrides).split, entries: licensorMergesOf(overrides).entries }, canEdit: Boolean(canEdit) };
}

module.exports = { PROFILE_LIMITS, MAX_SYMBOL_BYTES, pairKey, cardId, stateOf, catalogue, visibleCatalogue, discoveryRowsFromOrders, setLicensor, templatesOf, licensorMergesOf, setLicensorMerge, normalizeTemplate, applyTemplate, linkTemplates, propagateTemplate, saveTemplate, deleteTemplate, revisionOf, assertRevision, discoverPairs, appendDiscovered, validateSymbol, normalizeProfile, normalizeRules, mergeRules, updateCard, responseOf };
