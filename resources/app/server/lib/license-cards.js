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
function appendDiscovered(overrides, pairs, now = new Date().toISOString()) {
  const state = clone(stateOf(overrides)), known = new Set(state.items.map(card => pairKey(card.license, card.licensor)));
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
    if (known.has(key)) continue;
    known.add(key); added++;
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
  state.items[index] = { ...state.items[index], ...normalizeProfile(profile), updatedAt: now };
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
function responseOf(overrides, canEdit) {
  const state = stateOf(overrides), rules = Array.isArray(overrides.pricingRules) ? overrides.pricingRules : [];
  const byPair = new Map();
  for (const rule of rules) { const key = pairKey(rule.license, rule.licensor); if (!byPair.has(key)) byPair.set(key, []); byPair.get(key).push(rule); }
  return { cards: catalogue(overrides).map(card => ({ ...card, editToken: editToken(card, rules), rules: byPair.get(pairKey(card.license, card.licensor)) || [] })),
    pricingRules: rules, revision: revisionOf(overrides, 'licenseCards'), pricingRevision: revisionOf(overrides, 'pricingRules'), initialized: state.initialized,
    lastImportedAt: state.lastImportedAt, canEdit: Boolean(canEdit) };
}

module.exports = { PROFILE_LIMITS, MAX_SYMBOL_BYTES, pairKey, cardId, stateOf, catalogue, revisionOf, assertRevision, discoverPairs, appendDiscovered, validateSymbol, normalizeProfile, normalizeRules, mergeRules, updateCard, responseOf };
