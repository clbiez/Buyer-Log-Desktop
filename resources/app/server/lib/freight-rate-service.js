'use strict';

const Freight = require('../../public/freight-calc');
const { hash, error } = require('./agent-office-store');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const fingerprint = value => hash(JSON.stringify(ordered(value)));

// Extracted from the native PUT handler; numerical validation is shared.
function validateSettings(raw) {
  const fail = message => { throw Object.assign(new Error(message), { code: 'FREIGHT_INVALID', statusCode: 400 }); };
  const rates = Array.isArray(raw && raw.rates) ? raw.rates : null;
  if (!rates || !rates.length) fail('En az bir navlun ücreti tanımlanmalıdır.');
  if (rates.length > 20) fail('En fazla 20 navlun ücreti tanımlanabilir.');
  for (const item of rates) {
    const rate = Number(item && item.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) fail('Her navlun birim ücreti 0 ile 1000 arasında pozitif bir sayı olmalıdır.');
    if (!String(item && item.label || '').trim()) fail('Her navlun satırının bir adı olmalıdır.');
    if (!Freight.MODES.includes(item && item.mode)) fail('Navlun tipi yalnız Uçak veya Gemi+Uçak olabilir.');
  }
  const factor = Number(raw && raw.volumetricFactor);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) fail('Hacimsel ağırlık katsayısı 0 ile 1000 arasında pozitif bir sayı olmalıdır.');
  const landedMultiplier = Number(raw && raw.landedMultiplier);
  if (!Number.isFinite(landedMultiplier) || landedMultiplier <= 0 || landedMultiplier > 10) fail('Landed çarpanı 0 ile 10 arasında pozitif bir sayı olmalıdır.');
  const carton = raw && raw.carton;
  for (const key of ['cartonL', 'cartonH', 'cartonW']) {
    const side = Number(carton && carton[key]);
    if (!Number.isFinite(side) || side <= 0 || side > 1000) fail('Varsayılan koli ölçüleri 0 ile 1000 cm arasında olmalıdır.');
  }
  return Freight.normalizeSettings({ rates, volumetricFactor: factor, landedMultiplier, carton });
}

function ownerImpact(store, before, next) {
  let changed = 0, incompleteBefore = 0, incompleteAfter = 0;
  const samples = [];
  for (const row of store.rows) {
    const oldInput = Freight.inputsForRow(row, before), newInput = Freight.inputsForRow(row, next);
    const oldValue = Freight.calculate(oldInput, before), newValue = Freight.calculate(newInput, next);
    if (Freight.missingFields(oldInput).length) incompleteBefore++;
    if (Freight.missingFields(newInput).length) incompleteAfter++;
    if (fingerprint(oldValue) === fingerprint(newValue)) continue;
    changed++;
    if (samples.length < 20) samples.push({ id: String(row._shipId || '').slice(0, 160), modelName: String(row.styleName || '').slice(0, 240),
      before: oldValue.results, after: newValue.results, missingBefore: Freight.missingFields(oldInput), missingAfter: Freight.missingFields(newInput) });
  }
  return { shared: true, evaluatedOwnerRecords: store.rows.length, changedOwnerRecords: changed, incompleteBefore, incompleteAfter,
    samples, samplesTruncated: changed > samples.length, otherOwnerImpact: 'not-read', storedLandedPricesChanged: false };
}

function createFreightRateService({ db }) {
  const read = () => { const ov = db.loadOverrides(); return { freight: Freight.normalizeSettings(ov.freightRates), revision: Number(ov._revisions.freightRates) || 0 }; };
  const snapshot = ctx => db.mutateSharedResource('freightRates', () => { ctx.assertAuthority(); return read(); });
  async function preview(raw, ctx) {
    const next = validateSettings(raw);
    // Agent plans cannot silently drop duplicate routes during normalization.
    if (next.rates.length !== raw.rates.length) throw error('OFFICE_TOOL_SCHEMA', 422);
    return db.mutateShipping(ctx.ownerId, () => db.mutateSharedResource('freightRates', () => {
      ctx.assertAuthority();
      const before = read(), store = db.loadShipping(ctx.ownerId);
      return { ...before, fingerprint: fingerprint(before.freight), next, ownerFingerprint: fingerprint(store), impact: ownerImpact(store, before.freight, next) };
    }));
  }
  async function commit(next, expected, ctx) {
    return db.mutateSharedResource('freightRates', async lease => {
      const current = read();
      if (expected?.revision != null && current.revision !== expected.revision) throw new db.RevisionConflictError('Navlun ücretleri', expected.revision, current.revision, 'freightRates');
      if (expected?.fingerprint && fingerprint(current.freight) !== expected.fingerprint) throw error('OFFICE_PREVIEW_CHANGED', 409);
      const guard = () => {
        ctx.assertAuthority();
        if (expected?.ownerFingerprint && fingerprint(db.loadShipping(ctx.ownerId)) !== expected.ownerFingerprint) throw error('OFFICE_PREVIEW_CHANGED', 409);
      };
      guard();
      const saved = db.replaceFreightRates(next, current.revision, { ...lease, assertAuthority: guard,
        ...(expected?.ownerFingerprint ? { guardDocumentIds: [db.shippingDocumentId(ctx.ownerId)] } : {}) });
      await lease.commit();
      const actual = read();
      if (actual.revision !== saved.revision || fingerprint(actual.freight) !== fingerprint(next)) throw error('OFFICE_RESOURCE_VERIFY_FAILED', 409);
      ctx.assertAuthority();
      return { verified: true, ...actual, fingerprint: fingerprint(actual.freight) };
    });
  }
  const replace = (raw, expected, ctx) => commit(validateSettings(raw), expected, ctx);
  // Only the adapter's immutable owner backup reaches this native inverse.
  const restore = (before, expected, ctx) => {
    const canonical = Freight.normalizeSettings(before);
    if (fingerprint(canonical) !== fingerprint(before)) throw error('OFFICE_ROLLBACK_INVALID', 409);
    return commit(canonical, expected, ctx);
  };
  return { snapshot, preview, replace, restore };
}
module.exports = { createFreightRateService, validateSettings, ownerImpact, fingerprint };
