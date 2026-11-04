'use strict';
// License Royalty hesap doğruluğu + Lisans kartları sözleşme dönemi akışı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../public/business-rules');
const E = require('../public/license-cards-engine');
const parse = require('../server/lib/parse');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Royalty + komisyon toplamı ikili kayan nokta hatasıyla kuruş kaydırmaz', () => {
  const rule = { royalty: 0.1, trCommission: 0.2, ydCommission: 2.2, hologramCost: 0 };
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'TR'), 0.3);
  assert.equal(rules.pricingRuleEffectiveRoyalty(rule, 'China'), 2.3);
  // 25 × (1 − 0,3%) = 24,925 → yarım kuruş yukarı 24,93 (eskiden 24,92).
  assert.equal(rules.calculateSuppFobWithRule(25, rule, 'TR'), 24.93);
  assert.equal(rules.calculateSuppFobWithRule('25.00', { ...rule, royalty: 0.1, ydCommission: 2.2 }, 'YD'), 24.43);
  assert.equal(rules.calculateSuppFobWithRule('7.50', { royalty: 0.3, trCommission: 1.1, hologramCost: 0 }, 'TR'), 7.4);
  // Final FOB ⇄ Supp. FOB çevrimi aynı kesin oranı kullanır.
  const supp = rules.calculateSuppFobWithRule(25, rule, 'TR');
  assert.equal(rules.calculateFinalFobWithRule(supp, rule, 'TR'), 25.01);
  assert.equal(rules.pricingRuleRate(0.1 + 0.2), 0.3);
  // Gerçekçi sözleşme: %18,7 + TR %2,9 = %21,6; 1,47 ÷ 0,784 + 0,05 = 1,925 → 1,93 (eskiden 1,92).
  const realistic = { royalty: 18.7, trCommission: 2.9, ydCommission: 2, hologramCost: 0.05 };
  assert.equal(rules.calculateFinalFobWithRule('1.47', realistic, 'TR'), 1.93);
  assert.equal(rules.calculateFinalFobWithRule('1.68', { royalty: 10.2, trCommission: 0.2, hologramCost: 0.05 }, 'TR'), 1.93);
});

test('eski TR / Non-TR göçü komisyon farkını ondalık olarak saklar', () => {
  const [merged] = rules.migrateLicenseRoyaltyRules([
    { id: 'tr', countryGroup: 'TR', licensor: 'DEMO', license: 'DEMO', royalty: 21.1, hologramCost: 0.05 },
    { id: 'yd', countryGroup: 'Non-TR', licensor: 'DEMO', license: 'DEMO', royalty: 20, hologramCost: 0.05 },
  ]);
  assert.equal(merged.trCommission, 1.1);
  assert.equal(rules.pricingRuleEffectiveRoyalty(merged, 'TR'), 21.1);
});

test('sunucu CP Supp. FOB meta verisi v2 ülke komisyonunu ve efektif oranı taşır', () => {
  const rule = { id: 'r1', licensor: 'DEMO', license: 'DEMO', royalty: 18, trCommission: 3, ydCommission: 2, hologramCost: 0.05, legacyTrHologramCost: 0.079, opdStart: '2026-01-01', seasons: [] };
  const tr = parse.automaticRuleMeta(rule, true, 'Türkiye');
  assert.equal(tr.commissionGroup, 'TR');
  assert.equal(tr.countryGroup, 'TR');
  assert.equal(tr.commission, 3);
  assert.equal(tr.effectiveRoyalty, 21);
  assert.equal(tr.hologramCost, 0.079);
  assert.equal(tr.licensor, 'DEMO');
  assert.equal(tr.applied, true);
  const yd = parse.automaticRuleMeta(rule, false, 'China');
  assert.equal(yd.commissionGroup, 'YD');
  assert.equal(yd.effectiveRoyalty, 20);
  assert.equal(yd.hologramCost, 0.05);
});

test('lisans kartında yeni dönem güncel oranları kopyalar ve açık önceki dönemi bir gün önce kapatır', () => {
  const card = { license: 'NORTH STAR', licensor: 'Demo Licensing' };
  const general = [
    { id: 'open', license: card.license, licensor: card.licensor, opdStart: '2026-01-01', opdEnd: '', seasons: [], royalty: 12, trCommission: 2, ydCommission: 3, hologramCost: 0.15 },
    { id: 'old', license: card.license, licensor: card.licensor, opdStart: '2025-01-01', opdEnd: '2025-12-31', seasons: [], royalty: 9, trCommission: 1, ydCommission: 2, hologramCost: 0.1 },
  ];
  const next = E.nextContractPeriod(general, card, '2026-10-21', 'new-rule');
  assert.equal(next.rules[0].id, 'new-rule');
  assert.deepEqual({ start: next.rule.opdStart, end: next.rule.opdEnd, royalty: next.rule.royalty, tr: next.rule.trCommission, yd: next.rule.ydCommission, hologram: next.rule.hologramCost, seasons: next.rule.seasons },
    { start: '2026-10-21', end: '', royalty: 12, tr: 2, yd: 3, hologram: 0.15, seasons: [] });
  assert.deepEqual(next.closed, ['open']);
  assert.equal(next.rules.find(r => r.id === 'open').opdEnd, '2026-10-20');
  assert.equal(next.rules.find(r => r.id === 'old').opdEnd, '2025-12-31');
  assert.equal(general[0].opdEnd, '', 'input rules are not mutated');

  // Sezon kapsamlı sözleşmelerde yalnız kopyalanan kapsam kapatılır.
  const seasonal = [
    { id: 'ss', opdStart: '2026-01-01', opdEnd: '', seasons: ['SS26'], royalty: 12, trCommission: 2, ydCommission: 3, hologramCost: 0.15 },
    { id: 'aw', opdStart: '2026-03-01', opdEnd: '', seasons: ['AW26'], royalty: 9, trCommission: null, ydCommission: 1, hologramCost: 0.1 },
  ];
  const scoped = E.nextContractPeriod(seasonal, card, '2026-10-21', 'aw-next');
  assert.deepEqual(scoped.rule.seasons, ['AW26']);
  assert.equal(scoped.rule.royalty, 9);
  assert.equal(scoped.rule.trCommission, null);
  assert.equal(scoped.rule.ydCommission, 1);
  assert.deepEqual(scoped.closed, ['aw']);
  assert.equal(scoped.rules.find(r => r.id === 'ss').opdEnd, '');
});

test('ilk dönem sıfır royalty ile kaydedilmez; bugün başlayan dönem kapatılmaz', () => {
  const card = { license: 'NEW', licensor: 'Demo' };
  const first = E.nextContractPeriod([], card, '2026-10-21', 'first');
  assert.equal(first.rule.royalty, null);
  assert.equal(first.rule.trCommission, 0);
  assert.equal(first.rule.ydCommission, 0);
  const sameDay = E.nextContractPeriod([{ id: 'today', opdStart: '2026-10-21', opdEnd: '', seasons: [], royalty: 5, trCommission: 1, ydCommission: 1, hologramCost: 0 }], card, '2026-10-21', 'again');
  assert.deepEqual(sameDay.closed, []);
  assert.equal(E.previousDay('2026-03-01'), '2026-02-28');
  assert.equal(E.previousDay('2024-03-01'), '2024-02-29');
});

test('kart özeti bugün geçerli tüm sezon kapsamlarını gösterir', () => {
  const list = [
    { id: 'ss', opdStart: '2026-01-01', seasons: ['SS26'], royalty: 5 },
    { id: 'aw', opdStart: '2026-02-01', seasons: ['AW26'], royalty: 7 },
    { id: 'old', opdStart: '2025-01-01', opdEnd: '2025-12-31', royalty: 3 },
  ];
  assert.deepEqual(E.currentContracts(list, '2026-10-21').map(r => r.id), ['aw', 'ss']);
  assert.deepEqual(E.currentContracts([list[2]], '2026-10-21').map(r => r.id), ['old']);
  assert.deepEqual(E.currentContracts([], '2026-10-21'), []);
});

test('unified royalty keeps drafts on card navigation and caches match counts', () => {
  const ui=read('public/license-cards.js'),app=read('public/app-main.js');
  assert.match(ui,/drafts:new Map\(\)/);assert.match(ui,/only the card's/);
  assert.match(ui,/current\.editToken!==d\.editToken/);
  assert.match(app,/matchCache=new Map\(\)/);assert.match(app,/self\.matchCache\.has\(key\)/);
  assert.match(read('public/license-royalty-commissions.js'),/switchTab\('licensecards'\)/);
});

test('lisans keşfi CP’de elle seçilen Licensor’ı kullanır; lisansörsüz eski yer tutucu gizlenir', () => {
  const cards = require('../server/lib/license-cards');
  const orders = [
    { ocode: 1001, model: 'M1', ccode: 'C1', license: 'Sanrio', licensor: '' },
    { ocode: 1002, model: 'M2', ccode: 'C2', license: 'Bluey', licensor: '' },
    { ocode: 1003, model: 'M3', ccode: 'C3', license: 'Marvel', licensor: '' },
    { ocode: 1004, model: 'M4', ccode: 'C4', license: 'Capyfun', licensor: 'ASAS LIC' },
  ];
  const licensormap = { [parse.overrideKeyOf(orders[0])]: 'Demo Rights' };
  const rows = cards.discoveryRowsFromOrders([orders], { licensormap, pricingRules: [{ license: 'Bluey', licensor: 'Demo Studio', royalty: 5, trCommission: 0, ydCommission: 0, hologramCost: 0, opdStart: '2026-01-01' }] }, parse);
  const licensorOf = license => rows.filter(r => r.License === license).map(r => r.Licensor);
  assert.deepEqual(licensorOf('Sanrio'), ['Demo Rights'], 'manual CP licensor');
  assert.deepEqual(licensorOf('Bluey'), ['Demo Studio'], 'royalty contract');
  assert.deepEqual(licensorOf('Marvel'), ['DTR'], 'catalogue');
  assert.deepEqual(licensorOf('Capyfun'), ['ASAS LIC'], 'ASAS source');

  // An empty-licensor card from an earlier import no longer shows once the license has a licensor.
  let state = cards.appendDiscovered({ _revisions: {}, pricingRules: [] }, [{ license: 'Sanrio', licensor: '' }]).overrides;
  state = { ...state, pricingRules: [{ id: 'r', license: 'Sanrio', licensor: 'Demo Rights', royalty: 5, trCommission: 0, ydCommission: 0, hologramCost: 0 }] };
  assert.deepEqual(cards.responseOf(state, true).cards.map(c => [c.license, c.licensor]), [['Sanrio', 'Demo Rights']]);
  // …unless someone stored data on it.
  state.licenseCards.items[0].workingNotes = 'keep me';
  assert.equal(cards.responseOf(state, true).cards.length, 2);
  // A license with no licensor anywhere keeps its single card.
  const lone = cards.appendDiscovered({ _revisions: {}, pricingRules: [] }, [{ license: 'Unknown', licensor: '' }]).overrides;
  assert.equal(cards.responseOf(lone, true).cards.length, 1);
  assert.match(read('server/server.js'), /discoveryRowsFromOrders\(sources,overrides,parseLib\)/);
});


test('new period scope and date edits reconcile only matching predecessor scopes', () => {
  const ui=read('public/license-cards.js');assert.match(ui,/previous\.opdEnd=E\.periodEnd\(original,r\)/);
  const old={id:'old',opdStart:'2026-01-01',opdEnd:'',seasons:[],categories:[],trCommission:2,ydCommission:4};
  const next={...old,id:'next',opdStart:'2026-11-04'};
  assert.equal(E.periodEnd(old,next),'2026-11-03');
  for(const patch of [{categories:['Home']},{seasons:['Summer']},{trCommission:null}]){
    assert.equal(E.periodEnd(old,{...next,...patch}), '');assert.equal(E.periodEnd(old,{...next,...patch,opdStart:'2027-01-01'}),'');
  }
  assert.equal(E.periodEnd({...old,opdEnd:'2026-06-01'},next),'2026-06-01');
});
