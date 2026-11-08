'use strict';
// Kapat/iptal yolunun gerçek kural motoruyla seçimi ve fiyatı birlikte yenilemesi.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const E = require('../public/license-cards-engine'), rules = require('../public/business-rules');
const source = fs.readFileSync(path.join(__dirname, '../public/license-cards.js'), 'utf8');
function fixture(lang, sourceKey) {
  const fields = {}, quickNode = { html: '', set outerHTML(html) {
    this.html = html;
    for (const match of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) fields[match[1]] = { value: match[2] };
    fields.lcQuickStatus = { textContent: '' };
  } };
  const host = { getClientRects: () => [], querySelector: sel => sel === '.lcQuick' ? quickNode : null,
    set innerHTML(_) { assert.fail('close must not rebuild the list'); } };
  const window = { BLLicenseCardsEngine: E, BLBusinessRules: rules };
  const document = { getElementById: id => fields[id], activeElement: null, addEventListener() {} };
  vm.runInNewContext(source.replace('window.initLicenseCardsPage=', 'window.quickTest={S,act,ensureDraft,quickHtml,runQuick};window.initLicenseCardsPage='), { window, document, appLang: lang, Intl, CSS: { escape: v => v }, setTimeout });
  const f = window.quickTest;
  const original = { id: 'original', license: 'Demo Alpha', licensor: 'Demo Agency', royalty: 8, trCommission: 2, ydCommission: 2, hologramCost: .1, opdStart: '2020-01-01', opdEnd: '', seasons: [], categories: [] };
  const other = { ...original, id: 'other', license: 'Demo Beta', royalty: 12 };
  f.S.host = host;
  f.S.data = { canEdit: true, cards: [{ id: 'alpha', license: original.license, licensor: original.licensor, editToken: 'original', rules: [original] }], pricingRules: [original, other] };
  const amount = lang === 'tr' ? '100,00' : '100.00';
  f.S.quick = { source: sourceKey, values: { [sourceKey]: amount }, ruleId: original.id };
  const paint = () => { quickNode.outerHTML = f.quickHtml(); f.runQuick(); };
  const checkCalculation = rule => {
    const supp = sourceKey === 'supp' ? 100 : rules.calculateSuppFobWithRule(100, rule, sourceKey === 'tr' ? 'TR' : 'YD');
    const format = value => new Intl.NumberFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value);
    const expected = { supp: format(supp), yd: format(rules.calculateFinalFobWithRule(supp, rule, 'YD')), tr: format(rules.calculateFinalFobWithRule(supp, rule, 'TR')) };
    expected[sourceKey] = amount;
    assert.deepEqual({ ...f.S.quick.values }, expected);
    assert.equal(f.S.quick.source, sourceKey);
    assert.equal(fields[{ supp: 'lcQuickSupp', yd: 'lcQuickYd', tr: 'lcQuickTr' }[sourceKey]].value, amount);
    for (const [key, id] of Object.entries({ supp: 'lcQuickSupp', yd: 'lcQuickYd', tr: 'lcQuickTr' })) assert.equal(fields[id].value, expected[key]);
    assert.match(fields.lcQuickStatus.textContent, lang === 'tr' ? /Önizleme/ : /Preview/);
  };
  paint();
  return { f, original, other, quickNode, paint, checkCalculation };
}
for (const lang of ['tr', 'en']) for (const sourceKey of ['supp', 'yd', 'tr']) {
  test(`closing a royalty draft refreshes Quick FOB, preserving amount and valid selection (${lang}/${sourceKey})`, () => {
    const { f, original, quickNode, checkCalculation } = fixture(lang, sourceKey);
    const draft = f.ensureDraft('alpha'); draft.rules[0].royalty = 20; f.S.expanded = 'alpha';
    f.act({ dataset: { lcAct: 'closeEditor', id: 'alpha' } });
    assert.equal(f.S.quick.ruleId, original.id);
    assert.match(quickNode.html, /Royalty 20%/);
    assert.equal(f.S.drafts.get('alpha').rules[0].royalty, 20);
    checkCalculation(draft.rules[0]);
  });
  test(`cancelling a draft period removes its option and uses the existing fallback (${lang}/${sourceKey})`, () => {
    const { f, original, quickNode, paint, checkCalculation } = fixture(lang, sourceKey);
    const draft = f.ensureDraft('alpha'); draft.rules.push({ ...original, id: 'draft-period', royalty: 30 });
    f.S.quick.ruleId = 'draft-period'; paint(); checkCalculation(draft.rules[1]);
    f.S.expanded = 'alpha'; f.act({ dataset: { lcAct: 'cancelEditor', id: 'alpha' } });
    assert.equal(f.S.drafts.has('alpha'), false);
    assert.equal(f.S.quick.ruleId, original.id);
    assert.doesNotMatch(quickNode.html, /draft-period/);
    checkCalculation(original);
  });
}
test('closing an edited card preserves a different valid Quick FOB contract', () => {
  const { f, other, paint, checkCalculation } = fixture('en', 'yd');
  f.S.quick.ruleId = other.id; paint();
  f.ensureDraft('alpha').rules[0].royalty = 20; f.S.expanded = 'alpha';
  f.act({ dataset: { lcAct: 'closeEditor', id: 'alpha' } });
  assert.equal(f.S.quick.ruleId, other.id); checkCalculation(other);
});
test('cancelling the only available draft keeps the source amount and clears derived prices', () => {
  const { f, original, paint, quickNode } = fixture('tr', 'supp');
  f.S.data.pricingRules = [];
  f.S.data.cards[0].rules = [];
  f.ensureDraft('alpha').rules = [{ ...original, id: 'draft-only' }];
  f.S.quick.ruleId = 'draft-only'; paint(); f.S.expanded = 'alpha';
  f.act({ dataset: { lcAct: 'cancelEditor', id: 'alpha' } });
  assert.equal(f.S.quick.ruleId, '');
  assert.deepEqual({ ...f.S.quick.values }, { supp: '100,00', yd: '', tr: '' });
  assert.doesNotMatch(quickNode.html, /draft-only/);
});
