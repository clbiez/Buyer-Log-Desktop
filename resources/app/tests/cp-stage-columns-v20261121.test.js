'use strict';

// CP / Siparişler aşama tahmini (yalnız bilgi).
// Gerçek talep: statik ETA farkı Ex→Retail hücresinde ikinci satır; % sütunu yok;
// satırda en geç gelecek parsiyel; alt detay parsiyel bazında; yeni sütunlar
// varsayılan gizli, kullanıcı Sütunlar listesinden açar. Hiçbir uyarı/öncelik değişmez.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse.js');
const SM = require('../public/transit-stage-model.js');

const DAY = 86400000;
const now = new Date();
const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const iso = offset => new Date(todayUtc + offset * DAY).toISOString().slice(0, 10);
const ord = value => Math.round(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY);
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function model() {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    const s = -200 + i * 4;
    list.push({ country: 'Hindistan', vehicle: 'Gemi', arrived: true, loadingRequest: iso(s), handover: iso(s + 3), cutOff: iso(s + 7),
      actualLoading: iso(s + 9), eta: iso(s + 49), summaryDeclaration: iso(s + 50), warehouseApproval: iso(s + 51), transitDeclaration: iso(s + 52), warehouseEntry: iso(s + 54) });
  }
  return SM.buildModel(list, { today: iso(0) });
}
const order = () => ({
  ocode: 93001, _matchOcode: '93001', model: 'MODEL-CP', ccode: 'C1', colour: 'BLACK', qty: 300, kalan: 100, antrepo: 0, merkezSevkeHazirKalan: 0,
  fob: 5, plm: '', ozel: '', manufacturer: 'MF', season: '26SS', category: 'K', merch: 'MAG', ageGroup: 'A', buyerGrup: 'BG', countryRaw: 'HINDISTAN',
  license: '', productDescription: '', ex: new Date(todayUtc - 30 * DAY), retail: new Date(todayUtc + 60 * DAY), mb: new Date(todayUtc + 75 * DAY),
  opd: new Date(todayUtc - 90 * DAY), shipConf: null, buyer: 'B', line: 'L',
});
const ias = over => ({ 'Sipariş Kod': 93001, 'Ürün Adı': 'MODEL-CP', 'Renk Kod': 'C1', 'Renk Tanım': 'BLACK', 'Supplier Portal Statü': 'Yolda', // i18n-ignore
  'Vasita Tanim': 'Gemi', 'Yükleme Toplam Adet': 100, 'Tahmini Antrepo Giriş Tarihi': iso(40), ...over }); // i18n-ignore
const rule = [{ id: 'sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function cpRow(overrides) {
  const ov = { ...require('../server/db').defaultOverrides(), transitRules: rule, ...overrides };
  const map = parse.parseAntrepoRows([
    // Parsiyel 1: 20 gün önce yüklendi, planlı ETA +30 → aşama ETA +35.
    ias({ 'İthalat Dosya No': 'F1', 'Yükleme Talep Tarih': iso(-32), 'HANDOVER Tarihi': iso(-29), 'Fiili Yükleme Tarih': iso(-20), 'ETA Tarih': iso(30) }), // i18n-ignore
    // Parsiyel 2: Handover 5 gün önce, henüz yüklenmedi → daha geç gelir.
    ias({ 'İthalat Dosya No': 'F2', 'Yükleme Talep Tarih': iso(-8), 'HANDOVER Tarihi': iso(-5) }), // i18n-ignore
  ], ov);
  return parse.buildCPRowsFromASAS([order()], map, ov)[0];
}

test('satırda en geç gelecek parsiyel; alt detay parsiyel bazında; statik kural farkı', () => {
  const row = cpRow({ transitAnalysis: model() });
  const partials = row._logisticSegments.filter(s => s.kind === 'partial');
  assert.equal(partials.length, 2);
  assert.ok(partials.every(s => s.stage && s.stage.eta), 'her yoldaki parsiyelde aşama özeti');
  const latest = partials.map(s => s.stage).sort((a, b) => (a.eta < b.eta ? 1 : -1))[0];
  assert.equal(ord(row['Stage ETA']), Math.round(Date.parse(latest.eta) / DAY), 'satır = en geç parsiyel');
  assert.equal(row['Current Stage'], latest.code);
  assert.deepEqual(Object.keys(row._stageRun).sort(), ['code', 'days', 'mean', 'over', 'sigma']);
  // Statik ölçüt: Handover + 70 gün (tanımlı kural) − aşama ETA'sı.
  const p1 = partials.find(s => s.stage.eta === partials.map(x => x.stage.eta).sort()[0]).stage;
  assert.equal(typeof p1.vsRule, 'number');
  assert.equal(row._stageVsRule, latest.vsRule);
  // Yalnız bilgi: Ex→Retail ve risk alanları aşama modelinden bağımsız.
  const plain = cpRow({});
  for (const key of ['Ex→Retail', 'Ant. Arrival', 'STATUS', 'Priority']) assert.deepEqual(row[key], plain[key], key);
});

test('model yoksa veya kural tanımsızsa alanlar boş/yok; varsayılan gün ölçüt sayılmaz', () => {
  const none = cpRow({});
  assert.equal(none['Stage ETA'], null);
  assert.equal(none['Current Stage'], '');
  assert.equal(none._stageRun, null);
  assert.ok(none._logisticSegments.every(s => !s.stage));
  const noRule = cpRow({ transitAnalysis: model(), transitRules: [] });
  assert.ok(noRule['Stage ETA']);
  assert.equal(noRule._stageVsRule, null);
});

test('istemci sözleşmesi: sütunlar varsayılan gizli, Ex→Retail ikinci satırı, alt detay sütunu, TR/EN', () => {
  const app = read('public/app-main.js');
  assert.match(app, /\{k:'Stage ETA', label:'Stage ETA', type:'date', weight:9, group:'Lojistik', defaultHidden:true\}/);
  assert.match(app, /\{k:'Current Stage', label:'Current Stage', type:'stageRun', weight:26, group:'Lojistik', defaultHidden:true\}/);
  assert.doesNotMatch(app, /k:'Zamanında|onTimeProbability/, '% sütunu yok');
  assert.match(app, /function initColState\(cols\)\{ return \{ order: cols\.map\(c=>c\.k\), hidden:new Set\(cols\.filter\(c=>c\.defaultHidden\)\.map\(c=>c\.k\)\)/);
  assert.match(app, /hideUnseenDefaultHiddenColumns\(t,saved\[t\]\.order\);/);
  assert.match(app, /const shift=cpStageShiftHtml\(r\);/);
  assert.match(app, /'Stage ETA':'Aşama ETA',\n  'Current Stage':'Koşan Aşama',/);
  assert.match(app, /'Stage ETA':'Stage ETA',\n  'Current Stage':'Current Stage',/);
  assert.match(app, /\$\{hasStage\?cpLogisticStageHtml\(segment\):''\}/);
  // Excel/pano metni: Ex→Retail sayısı değişmez (ikinci satır yalnız HTML).
  assert.match(app, /if\(c\.type==='num'\)\{ if\(c\.k==='Ex→Retail' && cf\) return cf\.exr==null\?'':String\(cf\.exr\);/);
  assert.match(app, /const CP_RM_CLIENT_TYPES=new Set\(\['formula','cpImage','privateNote','stageRun'\]\);/);
});

// v20261121b — Aşama tahmini Priority Rules ile paralel: σ koşul alanı ve
// aşama ETA'sına göre teslimat sonucu (erken ilerleyen sipariş On Track olur).
const CPR = require('../public/cp-readiness-engine.js');
const RULES = require('../public/cp-rules-engine.js');

test('aşama modeli σ saklar; koşan aşamanın gecikmesi σ cinsinden ölçülür', () => {
  const m = model();
  const g = m.groups.find(x => x.scope === 'country');
  assert.ok(Number.isFinite(g.stages['1'].sd), 'aşama standart sapması');
  assert.equal(SM.normalizeModel(JSON.parse(JSON.stringify(m))).groups[0].stages['1'].sd, g.stages['1'].sd);
  // Handover 3 gün ortalamalı aşamada 25 gündür bekleyen parsiyel: σ belirgin.
  const late = SM.project({ loadingRequest: iso(-25) }, { model: m, country: 'Hindistan', vehicle: 'Gemi', today: iso(0) });
  assert.ok(late.overrunSigma >= 2, `σ=${late.overrunSigma}`);
  // Planlı ETA gelecekte: gecikme yok.
  const sailing = SM.project({ loadingRequest: iso(-30), handover: iso(-27), cutOff: iso(-23), actualLoading: iso(-20), eta: iso(25) }, { model: m, country: 'Hindistan', vehicle: 'Gemi', today: iso(0) });
  assert.equal(sailing.overrunSigma, 0);
});

test('CP: @deliveryOutcome aşama ETA\'sını kullanır; @stageDelaySigma kuralı Priority\'yi yükseltir; model yoksa boş', () => {
  const ruleSet = RULES.normalizeRules([
    { id: 'stage-sigma', kind: 'priority', name: 'Aşama gecikmesi', enabled: true, target: 'ACTION_TODAY', // i18n-ignore
      conditions: [{ field: '@stageDelaySigma', operator: 'gte', value: 1 }] },
  ]);
  const settings = { targetType: 'retail', requireTransitRule: true };
  const ctx = { transitRules: rule, settings };
  // Yoldaki parsiyeli olan sipariş + kayıtlı model.
  const withModel = cpRow({ transitAnalysis: model() });
  assert.equal(typeof withModel._stageMaxSigma, 'number');
  assert.ok(withModel._stageProjection && withModel._stageProjection.etaMean);
  const a = CPR.analyzeOrder(withModel, ctx);
  assert.equal(a.etaSource, 'stage', 'CP teslimat sonucu aşama ETA\'sından');
  assert.equal(a.stageDelaySigma, withModel._stageMaxSigma);
  // Model yok: σ boş, kural eşleşmez, ETA eski yoldan.
  const plain = cpRow({});
  const b = CPR.analyzeOrder(plain, ctx);
  assert.notEqual(b.etaSource, 'stage');
  assert.equal(b.stageDelaySigma, null);
  assert.equal(RULES.applyPriorityRules({ ...b, sourceRow: plain }, ruleSet).matched.length, 0, 'boş σ koşulu karşılamaz');
  // σ ≥ 1 olan sipariş kuralla Bugün Aksiyon olur.
  const delayed = { ...a, stageDelaySigma: 2.5, sourceRow: withModel };
  assert.equal(RULES.applyPriorityRules(delayed, ruleSet).priority, 'ACTION_TODAY');
  assert.ok(RULES.DERIVED_FIELDS.some(f => f.id === '@stageDelaySigma' && f.numeric && f.meaning.tr && f.meaning.en));
  assert.ok(RULES.DERIVED_FIELDS.some(f => f.id === '@stageVsRuleDays' && f.numeric));
});

test('durum iyileşmesi: statik kurala göre gecikecek sipariş aşama ETA\'sıyla yetişiyorsa On Track', () => {
  // Statik kural 200 gün → Handover + 200 retail\'i (+60) kaçırır; aşama modeli +35 der.
  const longRule = [{ id: 'sea-long', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 200 }];
  const settings = { targetType: 'retail', requireTransitRule: true };
  const noModel = cpRow({ transitRules: longRule });
  const before = CPR.analyzeOrder(noModel, { transitRules: longRule, settings });
  const withModel = cpRow({ transitRules: longRule, transitAnalysis: model() });
  const after = CPR.analyzeOrder(withModel, { transitRules: longRule, settings });
  assert.equal(after.etaSource, 'stage');
  assert.equal(before.deliveryOutcome, 'EXPECTED_LATE', 'statik kural: gecikecek');
  assert.equal(after.deliveryOutcome, 'ON_TRACK', 'aşama ETA: yetişir (durum iyileşmesi)');
  assert.ok(after.scheduleBufferDays > 5);
  assert.ok(withModel._stageVsRule > 0, 'statik ETA\'dan erken');
});

test('Buyer Log üretimi parsiyel (üretimde/eksik) önceki parsiyelin yükleme onayını göstermez', () => {
  const src = read('public/app-main.js');
  assert.match(src, /\$\{segment\.synthetic\?'—':\(fmtDate\(loadingApproval\)\|\|'—'\)\}/);
  assert.match(read('server/lib/parse.js'), /synthetic: syntheticSegmentKind\(segment\)/);
});
