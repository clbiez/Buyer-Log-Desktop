'use strict';

/*
 * #1079 WS6 · Lisans telif: Supp. FOB yazma dizini + turknorm belleği paritesi.
 *
 * license-royalty-commissions.js app-main.js içindeki gerçek fonksiyonlarla (kaynaktan
 * çıkarılır, stub yok) aynı vm bağlamında çalıştırılır. Anahtar kapalı (eski yol:
 * her güncellemede tüm satırlar taranır) ve açık (satırlar anahtara göre bir kez
 * dizinlenir) iki ayrı bağlamda aynı fixture ile koşulur; satırlar, override
 * haritaları ve sunucuya giden toplu yük kanonik hash olarak eşit olmalıdır.
 *
 *   BL_ROYALTY_PARITY_ROWS=2000,30000 BL_ROYALTY_PARITY_LOG=1 node --test tests/read-model-royalty-apply-parity.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { extractFunction } = require('./helpers/app-main-functions');

const ROOT = path.join(__dirname, '..');
const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const ROYALTY = fs.readFileSync(path.join(ROOT, 'public', 'license-royalty-commissions.js'), 'utf8');
const BUSINESS = require('../public/business-rules.js');
const CANONICAL = require('../public/canonical-fields.js');
const SIZES = String(process.env.BL_ROYALTY_PARITY_ROWS || '2000').split(',').map(Number).filter(n => n > 0);
const LOG = process.env.BL_ROYALTY_PARITY_LOG === '1';

const APP_FUNCTIONS = ['turknorm', 'lineKeyOfRow', 'lineIdentity', 'suppFobMetaForRow', 'hasManualSuppFob', 'importedSuppFob',
  'editableValuesEqual', 'toNum', 'norm', 'dateOrdinal', 'normalizePricingRuleDate', 'normalizePricingRuleSeasons',
  'pricingRuleSeasonMatches', 'pricingRuleSeasonLabel', 'pricingRuleDateRangeLabel', 'pricingRuleSeasonSetsOverlap', 'isSuppFobAutoCalculated', 'toISODate', 'coerceDateLoose', 'makeDateOnly'];
const APP_SOURCE = APP_FUNCTIONS.map(name => extractFunction(APP_MAIN, name)).join('\n');

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

// Sentetik CP + Order Summary satırları: tekrarlayan satır anahtarları, sayı/metin sipariş
// kodu, boş kod, iki listede ortak satır nesnesi ve Türkçe karakterli licensor/license.
function fixture(count) {
  const r = rng(count + 7);
  const licensors = ['ŞİRKET A', 'Şirket A ', 'LICENSOR B', 'DTR', 'çağ lisans'], licenses = ['DİSNEY', 'MARVEL', 'İnci', 'Lisans Ç'];
  const seasons = ['6W26', '6S26', '7W26'], countries = ['Turkey', 'Bangladesh', 'China', 'Türkiye'];
  const cp = [];
  for (let i = 0; i < count; i++) {
    const code = 4100000 + Math.floor(i / 3); // aynı sipariş kodunda 3 satır
    const sameLine = i % 17 === 0 && i > 0;    // tekrar eden satır anahtarı
    cp.push({
      _id: i, 'Order Code': i % 251 === 0 ? '' : (i % 2 ? code : String(code)),
      'Model Name': sameLine ? cp[i - 1]['Model Name'] : 'Model ' + (i % 900), 'C.Code': sameLine ? cp[i - 1]['C.Code'] : 'E' + (i % 7),
      OPD: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9), Country: pick(r, countries), Season: pick(r, seasons),
      Licensor: pick(r, licensors), License: pick(r, licenses), Category: pick(r, ['PIJAMA', 'TRIKO']),
      'FOB ($)': Math.round((3 + r() * 9) * 100) / 100, 'Supp. FOB': null,
      ...(i % 41 === 0 ? { _suppFobManual: true, 'Supp. FOB': 7.5 } : {}),
    });
  }
  const orderSummary = cp.filter((_, i) => i % 5 === 0).map((row, i) => (i % 2 ? row : { ...row, _id: 'os' + i }));
  return { cp, orderSummary };
}
const RULES = [
  { id: 'r1', licensor: 'ŞİRKET A', license: 'DİSNEY', seasons: ['6W26'], royalty: 10, trCommission: 2, ydCommission: 3, hologramCost: 0.04 },
  { id: 'r2', licensor: 'LICENSOR B', license: 'MARVEL', seasons: [], royalty: 8, trCommission: 1, ydCommission: null, hologramCost: 0 },
  { id: 'r3', licensor: 'çağ lisans', license: 'İnci', seasons: ['6S26', '7W26'], opdStart: '2026-02-01', opdEnd: '2026-08-31', royalty: 12, trCommission: 0, ydCommission: 2.5, hologramCost: 0.07 },
  { id: 'r4', licensor: 'ŞİRKET A', license: 'Lisans Ç', seasons: [], categories: ['PIJAMA'], royalty: 9, trCommission: 3, ydCommission: 3, hologramCost: 0.02 },
];

function makeContext(enabled, data) {
  const posted = [];
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Map, Set, RegExp, Promise, Error, Intl,
    BL_READ_MODEL_ROYALTY: enabled, SERVER_BACKED: true, appLang: 'tr', L: value => value, // etiket çevirisi: iki kolda aynı
    localStorage: { getItem: () => null }, BLBusinessRules: BUSINESS, BLCanonicalFields: CANONICAL,
    state: { cp: { rows: data.cp }, orderSummary: { rows: data.orderSummary }, overrides: { pricingRules: [], suppfobmap: {}, suppfobmetamap: {} }, licensorMerges: { split: [] } },
    commitActiveTableEditor() {}, saveLocalPricingRules() {}, showToast() {}, renderCP() {}, renderOverview() {}, markDirty() {},
    enqueueOverrideMutation: async (kind, url, init) => { posted.push([kind, url, JSON.parse(init.body)]); },
    document: { addEventListener() {}, querySelector: () => null, createElement: () => ({}) },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(APP_SOURCE + '\nvar normalizePricingRules,pricingRuleMatchesValues,pricingRuleMatchesRow,findSuppFobRule,pricingRulesOverlap,pricingRulesSameCondition,normalizeSuppFobMeta,automaticSuppFobRuleMeta,calculateSuppFobWithRule,calculateSuppFobFromRule,recalcSuppFobForRow,suppFobHoverText,applySuppFobRuleToMatchingOrders,applyAllSuppFobRules,kolPricingRuleDimensionMatches,kolFindPricingRuleForCountryGroup,kolFindPricingRule,kolTrLicenseRuleMissingText,kolPricingRuleTitle,kolComputeFobFromConfirmed,kolApplyRulePricing,kolLandedPriceWithRule,kolLandedPriceWithCosts,kolLandedCalc,endeksmatikRoyaltyRule;', ctx, { filename: 'app-main.js (seçili)' });
  vm.runInContext(ROYALTY, ctx, { filename: 'license-royalty-commissions.js' });
  ctx.state.overrides.pricingRules = ctx.normalizePricingRules(RULES);
  return { ctx, posted };
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}
function snapshot({ ctx, posted }) {
  const pickRow = r => [r._id, r['Supp. FOB'], r._suppFobRule, r._suppFobMeta, r._suppFobOverride, r._suppFobManual];
  return { cp: ctx.state.cp.rows.map(pickRow), os: ctx.state.orderSummary.rows.map(pickRow),
    map: ctx.state.overrides.suppfobmap, meta: ctx.state.overrides.suppfobmetamap, posted };
}

async function scenario(enabled, count) {
  const run = makeContext(enabled, fixture(count));
  const { ctx } = run, out = {};
  // 1) Kural kaydı sonrası satır yeniden hesabı (applyPricingRulesToLoadedRows ile aynı çağrı).
  let changed = 0; for (const rows of [ctx.state.cp.rows, ctx.state.orderSummary.rows]) for (const row of rows) if (ctx.recalcSuppFobForRow(row)) changed++;
  out.recalc = digest([changed, snapshot(run)]);
  // 2) Tek kural "Uygula".
  out.applyOne = digest([await ctx.applySuppFobRuleToMatchingOrders(ctx.state.overrides.pricingRules.find(r => r.id === 'r1')), snapshot(run)]);
  // 3) Tüm kuralları uygula.
  out.applyAll = digest([await ctx.applyAllSuppFobRules(RULES), snapshot(run)]);
  out.updates = run.posted.map(p => p[2].items.length);
  return out;
}

for (const count of SIZES) {
  test(`royalty Supp. FOB yeniden hesap ve Uygula: anahtar kapalı = açık (${count} satır)`, async () => {
    const t0 = Date.now(); const legacy = await scenario(false, count); const t1 = Date.now(); const fast = await scenario(true, count); const t2 = Date.now();
    if (LOG) console.log(`[royalty-parity] ${count}: legacy ${t1 - t0} ms, fast ${t2 - t1} ms`, JSON.stringify({ legacy, fast }));
    assert.ok(legacy.updates.every(n => n > 0), 'fixture her senaryoda güncelleme üretmeli');
    assert.deepEqual(fast, legacy);
  });
}

test('anahtar varsayılan açık; localStorage "0" ve window=false geri dönüş yolunu seçer', () => {
  assert.match(ROYALTY, /ROYALTY_FAST_STORAGE_KEY='buyerlog\.readModel\.royalty\.v1'/);
  assert.match(ROYALTY, /getItem\(ROYALTY_FAST_STORAGE_KEY\)!=='0'/);
  assert.match(ROYALTY, /typeof window\.BL_READ_MODEL_ROYALTY==='boolean'/);
  // Uygula yolları ortak yazıcıyı kullanır; satır × güncelleme taraması yalnız geri dönüş dalında kalır.
  assert.equal((ROYALTY.match(/writeSuppFobUpdates\(updates\);/g) || []).length, 2);
});

test('mutasyon kontrolü: yazıcı dizini yanlış anahtarla kurulursa parite bozulur', async () => {
  const broken = ROYALTY.replace("const k=keyOf(r),list=index.get(k)", "const k=String(r['Order Code']),list=index.get(k)");
  assert.notEqual(broken, ROYALTY);
  const data = fixture(600);
  const a = makeContext(false, fixture(600));
  const ctx = { ...a };
  const legacy = await a.ctx.applyAllSuppFobRules(RULES);
  const b = makeContext(true, data);
  vm.runInContext(broken, b.ctx, { filename: 'license-royalty-commissions.broken.js' });
  b.ctx.state.overrides.pricingRules = b.ctx.normalizePricingRules(RULES);
  const mutated = await b.ctx.applyAllSuppFobRules(RULES);
  assert.equal(mutated, legacy, 'güncelleme sayısı aynı kalır');
  assert.notEqual(digest(snapshot(b)), digest(snapshot(ctx)), 'satır yazımı farklı olmalı');
});
