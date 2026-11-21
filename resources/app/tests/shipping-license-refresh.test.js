'use strict';
// Nakliye Kıyaslama: Royalty & Hologram bazı modellerde uygulanıp bazılarında
// uygulanmıyordu. Kök neden: lisans alanları yalnız aktarım anında yazılıyordu;
// CP'den gelen satırlar hiç almıyor, Koleksiyon'dan eski sürümde gelen satırlar
// model yeniden gönderilmeden güncellenmiyordu. Bu test alanların kaynaktaki
// güncel sözleşmeden türetildiğini ve yurt içi FOB'a yansıdığını sabitler.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Engine = require('../public/shipping-engine');
const Business = require('../public/business-rules');
const Canonical = require('../public/canonical-fields');

const src = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const pick = name => {
  const match = src.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} bulunamadı`);
  return match[0];
};
const keysDecl = src.match(/const SHIP_LICENSE_KEYS=\[[^\]]*\];/);

const RULE = { id: 'r1', licensor: 'NBA', license: 'NBA', royalty: 30, trCommission: 5, ydCommission: 7.5, hologramCost: 0.09 };
const norm = v => String(v ?? '').trim();
const turknorm = v => norm(v).toLocaleUpperCase('tr-TR');

function context({ rules = [RULE], cpRows = [], kolRows = [], mapCollectionRowToShip = () => null } = {}) {
  const patches = [];
  const ctx = {
    window: { BLCanonicalFields: Canonical, BLBusinessRules: Business },
    state: { overrides: { pricingRules: rules }, cp: { rows: cpRows } },
    kolRows, shipRows: [], norm, turknorm, mapCollectionRowToShip,
    collectionShippingModelKey: Engine.collectionShippingModelKey,
    findSuppFobRule: (opd, country, season, licensor, license) => rules.find(rule =>
      turknorm(rule.licensor) === turknorm(licensor) && turknorm(rule.license) === turknorm(license)
      && Business.pricingRuleCommissionForCountry(rule, country) != null) || null,
    patchShipRow: (id, patch) => patches.push({ id, patch }),
  };
  vm.createContext(ctx);
  vm.runInContext([keysDecl[0], ...['shipLicenseFieldsFromCpRow', 'shipLicenseSourceIndex', 'shipOrderCodeKey', 'shipLicenseFieldsFromSource', 'refreshShipLicenseFromSources'].map(pick)].join('\n'), ctx);
  return { ctx, patches };
}
const cpRow = (extra = {}) => ({ 'Order Code': '1.359.318', Licensor: 'NBA', License: 'NBA', Country: 'Bangladesh', Season: 'S7', OPD: '2026-07-09', ...extra });
const computeDeps = { coerceDateLoose: v => new Date(v), toNum: v => { const n = Number(v); return isNaN(n) ? null : n; }, toISODate: () => '', days: {}, multipliers: { tr: 1, overseas: 1 }, methods: [] };

test('CP kaynaklı satır güncel sözleşmeden YD notu ve TR royalty alır; yurt içi FOB royalty içerir', () => {
  const { ctx, patches } = context({ cpRows: [cpRow()] });
  const row = { _shipId: 's1', orderCode: 1359318, fob: 3.89, trFiyatTl: 150, kur: 50 };
  assert.equal(ctx.refreshShipLicenseFromSources([row]), 1);
  assert.equal(row.ydRoyaltyPct, 37.5);
  assert.equal(row.ydHologramCost, 0.09);
  assert.equal(row.trRoyaltyPct, 35);
  assert.equal(row.trHologramCost, 0.09);
  assert.equal(row._trLicenseRuleMissing ?? null, null);
  assert.deepEqual(patches.map(p => p.id), ['s1']);
  Engine.compute(row, computeDeps);
  assert.ok(Math.abs(row.trFiyatUsd - (150 / 50 / 0.65 + 0.09)) < 1e-9, 'yurt içi FOB royalty + hologram içerir');
  assert.equal(row.ydFiyatUsd, 3.89, 'yurt dışı FOB zaten lisans dahil gelir; yeniden eklenmez');
});

test('değişmeyen satır yeniden yazılmaz', () => {
  const { ctx, patches } = context({ cpRows: [cpRow()] });
  const row = { _shipId: 's1', orderCode: '1359318' };
  ctx.refreshShipLicenseFromSources([row]);
  assert.equal(ctx.refreshShipLicenseFromSources([row]), 0);
  assert.equal(patches.length, 1);
});

test('TR komisyonu olmayan sözleşmede yurt içi maliyet royaltysiz hesaplanmaz', () => {
  const rules = [{ ...RULE, trCommission: null }];
  const { ctx } = context({ rules, cpRows: [cpRow()] });
  const row = { _shipId: 's1', orderCode: 1359318, trFiyatTl: 150, kur: 50 };
  ctx.refreshShipLicenseFromSources([row]);
  assert.equal(row._trLicenseRuleMissing, true);
  assert.equal(row.ydRoyaltyPct, 37.5);
  Engine.compute(row, computeDeps);
  assert.equal(row.trFiyatUsd, '');
});

test('DTR siparişte eski lisans alanları temizlenir', () => {
  const { ctx } = context({ cpRows: [cpRow({ Licensor: 'DTR' })] });
  const row = { _shipId: 's1', orderCode: 1359318, ydRoyaltyPct: 37.5, ydHologramCost: 0.09 };
  ctx.refreshShipLicenseFromSources([row]);
  assert.equal(row.ydRoyaltyPct, null);
  assert.equal(row.ydHologramCost, null);
});

test('eski Koleksiyon satırı Koleksiyondaki modelin güncel lisansını alır', () => {
  const kol = { plmId: 'P9', modelKod: 'NBA SHORT 2', modelGroupRole: 'parent' };
  const { ctx } = context({ kolRows: [kol], mapCollectionRowToShip: () => ({ trRoyaltyPct: 35, trHologramCost: 0.09, ydRoyaltyPct: 37.5, ydHologramCost: 0.09 }) });
  const row = { _shipId: 's2', _sourceModule: 'collection', _modelKey: 'PLM:P9', fob: 4.33 };
  ctx.refreshShipLicenseFromSources([row]);
  assert.equal(row.ydRoyaltyPct, 37.5);
  assert.equal(row.trRoyaltyPct, 35);
});

test('kaynak veya kural listesi yüklenmemişse satıra dokunulmaz', () => {
  const stale = { _shipId: 's1', orderCode: 1359318, trRoyaltyPct: 35 };
  const noRules = context({ rules: [], cpRows: [cpRow()] });
  assert.equal(noRules.ctx.refreshShipLicenseFromSources([stale]), 0);
  const noSource = context({ cpRows: [] });
  assert.equal(noSource.ctx.refreshShipLicenseFromSources([stale]), 0);
  assert.equal(stale.trRoyaltyPct, 35);
  const unresolved = context({ cpRows: [cpRow({ Licensor: '' })] });
  assert.equal(unresolved.ctx.refreshShipLicenseFromSources([stale]), 0);
});

test('Nakliye tablosu çizilmeden önce lisans alanları kaynaktan tazelenir', () => {
  const body = src.match(/function renderShipTable\(\)\{[\s\S]*?shipRows\.forEach\(computeShipFormulas\);/)[0];
  assert.match(body, /refreshShipLicenseFromSources\(\);\s*shipRows\.forEach\(computeShipFormulas\);/);
});
