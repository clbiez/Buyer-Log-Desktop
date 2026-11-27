'use strict';
// TR ve YD royalty/hologram ayrı girilebilir; komisyon tarafın royalty'sine eklenir.
// Boş TR royalty/hologram YD değerini kullanır: eski kayıtların fiyatı değişmez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../public/business-rules');
const engine = require('../public/license-cards-engine');
const cards = require('../server/lib/license-cards');
const validators = require('../server/lib/resource-rule-service');
const parse = require('../server/lib/parse');

const base = { id: 'f1', license: 'Demo', licensor: 'Agency', opdStart: '', opdEnd: '', seasons: [], categories: [],
  royalty: 24.5, trCommission: 0, ydCommission: 0, hologramCost: 0.16 };

test('TR royalty ve TR hologram yalnız TR fiyatını belirler; YD değişmez', () => {
  const rule = { ...base, trRoyalty: 20, trHologramCost: 0.2 };
  assert.equal(rules.pricingRuleRoyaltyForCountry(rule, 'TR'), 20);
  assert.equal(rules.pricingRuleRoyaltyForCountry(rule, 'Bangladesh'), 24.5);
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'TR'), 20);
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'YD'), 24.5);
  assert.equal(rules.pricingRuleHologramForCountry(rule, 'TR'), 0.2);
  assert.equal(rules.pricingRuleHologramForCountry(rule, 'YD'), 0.16);
  assert.equal(rules.calculateFinalFobWithRule(255, rule, 'TR'), 318.95);
  assert.equal(rules.calculateFinalFobWithRule(255, rule, 'YD'), 337.91);
  assert.equal(rules.calculateSuppFobWithRule(318.95, rule, 'TR'), 255);
});

test('komisyon tarafın kendi royalty değerine eklenir', () => {
  const rule = { ...base, trRoyalty: 20, trCommission: 2, ydCommission: 1 };
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'TR'), 22);
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'YD'), 25.5);
});

test('boş TR royalty/hologram YD değerini kullanır; eski kayıt aynı hesaplanır', () => {
  for (const empty of [undefined, null, '']) {
    const rule = { ...base, trRoyalty: empty, trHologramCost: empty, trCommission: 24.5 };
    assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'TR'), 49);
    assert.equal(rules.pricingRuleHologramForCountry(rule, 'TR'), 0.16);
    assert.equal(rules.calculateFinalFobWithRule(251.65, rule, 'TR'), 493.59);
  }
  // Göç etmiş TR/YD hologram çifti korunur; açık TR hologramı ondan önce gelir.
  const legacy = { ...base, hologramCost: 0.057, legacyTrHologramCost: 0.079, legacyYdHologramCost: 0.057 };
  assert.equal(rules.pricingRuleHologramForCountry(legacy, 'TR'), 0.079);
  assert.equal(rules.pricingRuleHologramForCountry({ ...legacy, trHologramCost: 0.1 }, 'TR'), 0.1);
});

test('geçersiz TR değerleri sessizce YD değerine düşmez, hesap durur', () => {
  assert.equal(rules.calculateFinalFobWithRule(255, { ...base, trRoyalty: 150 }, 'TR'), null);
  assert.equal(rules.calculateFinalFobWithRule(255, { ...base, trRoyalty: 'x' }, 'TR'), null);
  assert.equal(rules.calculateFinalFobWithRule(255, { ...base, trHologramCost: -1 }, 'TR'), null);
  assert.equal(rules.calculateFinalFobWithRule(255, { ...base, trRoyalty: 150 }, 'YD'), 337.91);
});

test('sunucu kartı TR alanlarını saklar ve TR royalty + TR komisyon sınırını uygular', () => {
  let ov = cards.appendDiscovered({ pricingRules: [] }, [{ license: 'Demo', licensor: 'Agency' }]).overrides;
  const id = ov.licenseCards.items[0].id, token = cards.responseOf(ov, true).cards[0].editToken;
  const saved = cards.updateCard(ov, id, { editToken: token, profile: {}, rules: [{ ...base, trRoyalty: 20, trHologramCost: 0.2 }] }, validators);
  const stored = saved.overrides.pricingRules.find(r => r.id === 'f1');
  assert.equal(stored.trRoyalty, 20);
  assert.equal(stored.trHologramCost, 0.2);
  const clean = validators.normalizePricingRules(saved.overrides.pricingRules).find(r => r.id === 'f1');
  assert.equal(clean.trRoyalty, 20);
  assert.equal(clean.trHologramCost, 0.2);
  const fresh = cards.responseOf(saved.overrides, true).cards[0].editToken;
  for (const bad of [{ trRoyalty: 101 }, { trRoyalty: 90, trCommission: 20 }, { trHologramCost: -0.1 }, { trRoyalty: 'abc' }]) {
    assert.throws(() => cards.updateCard(saved.overrides, id, { editToken: fresh, profile: {}, rules: [{ ...base, ...bad }] }, validators), { code: 'LICENSE_RULES_INVALID' });
  }
  // YD tarafı yalnız YD royalty ile sınırlanır.
  assert.doesNotThrow(() => cards.updateCard(saved.overrides, id, { editToken: fresh, profile: {}, rules: [{ ...base, royalty: 90, trRoyalty: 10, trCommission: 50 }] }, validators));
  assert.equal(validators.normalizePricingRules([{ ...base, trRoyalty: 90, trCommission: 20 }]).length, 0);
});

test('sipariş meta royalty değeri satırın tarafındaki royalty olur', () => {
  const rule = { ...base, trRoyalty: 20, trCommission: 1, trHologramCost: 0.2 };
  const tr = parse.automaticRuleMeta(rule, true, 'Türkiye'), yd = parse.automaticRuleMeta(rule, true, 'Bangladesh');
  assert.deepEqual([tr.royalty, tr.effectiveRoyalty, tr.hologramCost], [20, 21, 0.2]);
  assert.deepEqual([yd.royalty, yd.effectiveRoyalty, yd.hologramCost], [24.5, 24.5, 0.16]);
});

test('kart motoru boş TR alanını devralınan değerle gösterir ve doğrular', () => {
  assert.deepEqual(engine.RATE_FIELDS, ['trRoyalty', 'royalty', 'trCommission', 'ydCommission', 'trHologramCost', 'hologramCost']);
  assert.equal(engine.rateInput(base, 'trRoyalty'), null);
  assert.equal(engine.rateValue(base, 'trRoyalty'), 24.5);
  assert.equal(engine.rateValue(base, 'trHologramCost'), 0.16);
  assert.equal(engine.rateValue({ ...base, trRoyalty: 20 }, 'trRoyalty'), 20);
  assert.equal(engine.rateError({ ...base, trRoyalty: 20 }), '');
  assert.equal(engine.rateError({ ...base, trRoyalty: 101 }), 'tr-royalty');
  assert.equal(engine.rateError({ ...base, trRoyalty: NaN }), 'tr-royalty');
  assert.equal(engine.rateError({ ...base, trRoyalty: 90, trCommission: 20 }), 'commission');
  assert.equal(engine.rateError({ ...base, royalty: 90, trRoyalty: 10, trCommission: 50 }), '');
  assert.equal(engine.rateError({ ...base, trHologramCost: -1 }), 'tr-hologram');
  const migrated = { ...base, hologramCost: 0.057, legacyTrHologramCost: 0.079, legacyYdHologramCost: 0.057 };
  assert.equal(engine.rateInput(migrated, 'trHologramCost'), 0.079);
  engine.adoptLegacyHologram(migrated);
  assert.deepEqual([migrated.hologramCost, migrated.trHologramCost, 'legacyTrHologramCost' in migrated, 'legacyYdHologramCost' in migrated], [0.057, 0.079, false, false]);
  assert.equal(rules.pricingRuleHologramForCountry(migrated, 'TR'), 0.079);
  const rows = engine.rows([{ id: 'c', license: 'Demo', licensor: 'Agency', rules: [{ ...base, trRoyalty: 5 }] }, { id: 'd', license: 'Other', licensor: 'Agency', rules: [base] }], { sort: { key: 'trRoyalty', dir: 'asc' } });
  assert.deepEqual(rows.map(r => r.id), ['c', 'd']);
});

test('lisans kartı TR/YD royalty, komisyon ve hologram kolonlarını iki dilde gösterir', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'license-cards.js'), 'utf8');
  assert.match(ui, /\['trRoyalty','TR royalty','TR royalty','%'\],\['royalty','YD royalty','Intl royalty','%'\],\['trCommission','TR kom\.','TR comm\.','%'\],\['ydCommission','YD kom\.','Intl comm\.','%'\],\['trHologramCost','TR hologram','TR hologram','\$'\],\['hologramCost','YD hologram','Intl hologram','\$'\]/);
  assert.match(ui, /RATE_COLS\.map\(\(\[key,,,suffix\]\)=>rateCell\(row,d,key,suffix\)\)/);
  assert.match(ui, /RATE_COLS\.map\(\(\[key,,,suffix\]\)=>num\(key,suffix\)\)/);
  assert.match(ui, /RATE_COLS\.map\(\(\[key,tr,en,suffix\]\)=>rate\(key,T\(tr,en\),suffix\)\)/);
  assert.match(ui, /E\.adoptLegacyHologram\(/);
  assert.match(ui, /Boş bırakılırsa YD değeri kullanılır\.','When empty, the international value is used\./);
});
