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
  assert.match(read('public/license-atlas-shell.js'), /contracts:E\.currentContracts\(c\.rules\)/);
});

test('License Royalty Calculations kaydedilmemiş değişikliği sessizce atmaz ve eşleşme sayısını önbellekler', () => {
  const ui = read('public/license-royalty-commissions.js');
  assert.match(ui, /function requestClose\(\)\{if\(\(snapshot\(\)!==savedSnapshot\|\|formPending\(\)\)&&!confirm\(/);
  assert.match(ui, /'Discard unsaved License Royalty changes\?':'Kaydedilmemiş License Royalty değişiklikleri bırakılsın mı\?'/);
  assert.doesNotMatch(ui, /if\(e\.key==='Escape'\)modal\.remove\(\)/);
  assert.doesNotMatch(ui, /_rulesClose'\)\.forEach\(b=>b\.addEventListener\('click',\(\)=>modal\.remove\(\)\)\)/);
  assert.match(ui, /const counts=new Map\(working\.map\(r=>\[r\.id,matchCount\(r\)\]\)\)/);
  assert.match(ui, /countCache=new WeakMap\(\)/);
  assert.match(read('public/index.html'), /license-royalty-commissions\.js\?v=__BL_ASSET_VERSION__&rev=2/);
});

test('Lisans Atlası Buyer Log arayüz ölçeğini izler ve büyük karşılama alanını göstermez', () => {
  const css = read('public/license-atlas/integration.css');
  const shell = read('public/license-atlas-shell.js');
  const bridge = read('public/license-atlas/integration.js');
  assert.match(css, /body\{zoom:var\(--bl-density,1\)\}/);
  assert.match(css, /html body \.hero\{display:none\}/);
  assert.match(css, /\.cover\{height:52px\}/);
  assert.match(shell, /font-size:var\(--fs-base,12\.5px\)/);
  assert.match(shell, /attributeFilter:\['data-theme','data-font-step','style','lang'\]/);
  assert.match(bridge, /setProperty\('--bl-density',String\(Math\.min\(1\.3,Math\.max\(\.85,base\/12\.5\)\)\)\)/);
  assert.match(read('public/perf-runtime.js'), /'license-cards-engine\.js\?rev=2'.*'license-atlas-shell\.js\?rev=2','license-cards\.js\?rev=4'/);
});

test('yeni dönemin başlangıcı değişince otomatik kapatılan dönem onu izler (royalty boşluğu kalmaz)', () => {
  const cards = read('public/license-cards.js');
  const shell = read('public/license-atlas-shell.js');
  const bridge = read('public/license-atlas/integration.js');
  assert.match(cards, /S\.periodLink=next\.closed\.length\?\{id:next\.rule\.id,closed:next\.closed\}:null/);
  assert.match(cards, /function syncPeriod\(rule\)\{/);
  assert.match(cards, /previous\.opdEnd=end/);
  assert.match(cards, /return k==='opdStart'&&syncPeriod\(r\)\?businessHtml\(\):'';/);
  assert.match(shell, /if\(m\.action==='businessInput'\)\{const html=ctx\.businessInput\(m\);if\(html\)post\('business',\{html\}\);\}/);
  assert.match(bridge, /renderEditor\(true\);const body=overlay\.querySelector\('#drawerBody'\);if\(body\)body\.scrollTop=top;/);
});

test('kart görseli yüklenebilir: CSP blob önizlemesine izin verir, bildirim kaydetmeyi hatırlatır', () => {
  const html = read('public/license-atlas/index.html');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /img-src data: blob:; font-src data:;/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(html, /const objectURL=URL\.createObjectURL\(file\),img=new Image\(\);/);
  const bridge = read('public/license-atlas/integration.js');
  assert.match(bridge, /'Lisans görseli kaydedildi\.':txt\('Görsel eklendi\. Atlası kaydedin\.','Image added\. Save the atlas\.'\)/);
  assert.match(read('public/license-atlas/integration.css'), /\.license-card \.cover\.has-cover-image\{height:96px\}/);
});

test('Lisans Atlası Buyer Log arayüz dilini kullanır: Barlow, 30px alanlar, tema token’ları, tip ölçeği', () => {
  const css = read('public/license-atlas/integration.css');
  const shell = read('public/license-atlas-shell.js');
  const bridge = read('public/license-atlas/integration.js');
  // Fonts: same Barlow files/ranges as design.css, inlined because the sandbox only allows font-src data:.
  assert.match(shell, /function buyerLogFonts\(\)\{/);
  assert.match(shell, /rule\.type===CSSRule\.FONT_FACE_RULE&&\/Barlow\//);
  assert.match(shell, /<style id="bl-fonts">\$\{fonts\}<\/style><style id="bl-integration">\$\{css\}<\/style>/);
  for (const token of ['--ink2', '--acc-bg', '--acc-ink', '--on-acc', '--hair', '--line2', '--red']) assert.ok(shell.includes(`'${token}'`), token);
  assert.match(bridge, /setProperty\('--blt-'\+k\.slice\(2\),v\)/);
  // Type scale derived from every original rule, inserted before the integration layer.
  assert.match(bridge, /function buyerLogTypeScale\(\)\{/);
  assert.match(bridge, /if\(fw>=650\)decl\.push\('font-weight:600!important'\)/);
  assert.match(bridge, /\['bl-fonts','bl-integration'\]\.includes\(node\.id\)/);
  // Controls, buttons and labels match Buyer Log primitives.
  assert.match(css, /--bl-ctl:30px/);
  assert.match(css, /--bl-body-font:"Barlow"/);
  assert.match(css, /:root body :is\(#app,#overlayRoot\) :is\(input:not\(\[type=checkbox\]\)/);
  assert.match(css, /font:500 12px\/1\.2 var\(--bl-body-font\)!important/);
  assert.match(css, /font:500 10\.5px\/1\.3 var\(--bl-body-font\)!important;letter-spacing:\.06em!important;text-transform:uppercase/);
  assert.match(css, /\.map-choice-bar button\.selected\{background:var\(--bl-t-acc-bg\)!important/);
  assert.doesNotMatch(css.slice(css.indexOf('Buyer Log skin')), /#427f94|#39758a|#dceeed/);
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

test('üretici atlası seçilen lisanslarla aktarılır, Buyer Log görünümünü taşır; kütüphanede Licensor filtresi var', () => {
  const bridge = read('public/license-atlas/integration.js');
  const shell = read('public/license-atlas-shell.js');
  // Export picker: nothing preselected, only chosen ids are sent.
  assert.match(bridge, /supplierSelection=new Set\(\);supplierPicker\(\);return;/);
  assert.match(bridge, /send\('export',\{ids\}\)/);
  assert.match(bridge, /data-action="blPickExport" \$\{supplierSelection\.size\?'':'disabled'\}/);
  assert.match(shell, /if\(!ids\.size\)\{ctx\.showError\(T\('Aktarmak için en az bir lisans seçin\.','Select at least one license to export\.'\)\);return;\}/);
  assert.match(shell, /const selected=ctx\.data\.cards\.filter\(c=>ids\.has\(c\.id\)\)/);
  assert.match(shell, /exportSupplier\(Array\.isArray\(m\.ids\)/);
  // Supplier file: same fonts, skin, type scale and Buyer Log tokens; full-bleed card images.
  assert.match(bridge, /const html=supplierSkin\(tpl\.replace\('__PUBLIC_DATA__',payload\)\)/);
  assert.match(bridge, /<script>\(\$\{buyerLogTypeScale\.toString\(\)\}\)\(\);<\\\/script>/);
  assert.match(bridge, /--blt-acc:#3f6488/);
  assert.match(bridge, /\.license-card \.cover\.has-cover-image img\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover!important/);
  assert.ok(!bridge.includes('</script>'), 'integration.js is inlined into a <script>; it must not contain a closing tag');
  // Licensor filter in the License Library.
  assert.match(bridge, /id="blLicensorFilter"/);
  assert.match(bridge, /original\.cards\(grouped\(licenses\.filter\(matchesLicensor\)\)\)/);
  assert.match(bridge, /txt\('Tüm lisansörler','All licensors'\)/);
});
