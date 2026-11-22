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

function cpRow(overrides, orderOverrides, iasOverrides) {
  const ov = { ...require('../server/db').defaultOverrides(), transitRules: rule, ...overrides };
  const map = parse.parseAntrepoRows([
    // Parsiyel 1: 20 gün önce yüklendi, planlı ETA +30 → aşama ETA +35.
    ias({ 'İthalat Dosya No': 'F1', 'Yükleme Talep Tarih': iso(-32), 'HANDOVER Tarihi': iso(-29), 'Fiili Yükleme Tarih': iso(-20), 'ETA Tarih': iso(30), ...(iasOverrides || {}) }), // i18n-ignore
    // Parsiyel 2: Handover 5 gün önce, henüz yüklenmedi → daha geç gelir.
    ias({ 'İthalat Dosya No': 'F2', 'Yükleme Talep Tarih': iso(-8), 'HANDOVER Tarihi': iso(-5), ...(iasOverrides || {}) }), // i18n-ignore
  ], ov);
  return parse.buildCPRowsFromASAS([{ ...order(), ...(orderOverrides || {}) }], map, ov)[0];
}
// Tamamı sevk edilmiş sipariş (üretimde kalan yok): teslimat sonucu aşama ETA'sını kullanabilir.
const SHIPPED = { qty: 200 };

test('satırda en geç gelecek parsiyel; alt detay parsiyel bazında; statik kural farkı', () => {
  const row = cpRow({ transitAnalysis: model() });
  const partials = row._logisticSegments.filter(s => s.kind === 'partial');
  assert.equal(partials.length, 2);
  assert.ok(partials.every(s => s.stage && s.stage.eta), 'her yoldaki parsiyelde aşama özeti');
  const latest = partials.map(s => s.stage).sort((a, b) => (a.eta < b.eta ? 1 : -1))[0];
  assert.equal(ord(row['Stage ETA']), Math.round(Date.parse(latest.eta) / DAY), 'satır = en geç parsiyel');
  assert.equal(row['Current Stage'], latest.code);
  assert.deepEqual(Object.keys(row._stageRun).sort(), ['code', 'days', 'from', 'mean', 'over', 'sigma', 'to']);
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
  assert.match(app, /\$\{hasStage\?cpLogisticStageHtml\(segment,row\):''\}/);
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
  const withModel = cpRow({ transitAnalysis: model() }, SHIPPED);
  assert.equal(typeof withModel._stageMaxSigma, 'number');
  assert.ok(withModel._stageProjection && withModel._stageProjection.etaMean);
  const a = CPR.analyzeOrder(withModel, ctx);
  assert.equal(a.etaSource, 'stage', 'CP teslimat sonucu aşama ETA\'sından');
  assert.equal(a.stageDelaySigma, withModel._stageMaxSigma);
  // Model yok: σ boş, kural eşleşmez, ETA eski yoldan.
  const plain = cpRow({}, SHIPPED);
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
  // IAS tahmini geç (+90; retail +60): model olmadan gecikecek görünür.
  const NO_ESTIMATE = { 'Tahmini Antrepo Giriş Tarihi': iso(90) }; // i18n-ignore
  const noModel = cpRow({ transitRules: longRule }, SHIPPED, NO_ESTIMATE);
  const before = CPR.analyzeOrder(noModel, { transitRules: longRule, settings });
  const withModel = cpRow({ transitRules: longRule, transitAnalysis: model() }, SHIPPED, NO_ESTIMATE);
  const after = CPR.analyzeOrder(withModel, { transitRules: longRule, settings });
  assert.equal(after.etaSource, 'stage');
  assert.equal(before.deliveryOutcome, 'EXPECTED_LATE', 'IAS tahmini: gecikecek');
  assert.equal(after.deliveryOutcome, 'ON_TRACK', 'aşama ETA: yetişir (durum iyileşmesi)');
  assert.ok(after.scheduleBufferDays > 5);
  assert.ok(withModel._stageVsRule > 0, 'statik ETA\'dan erken');
});

test('Buyer Log üretimi parsiyel (üretimde/eksik) önceki parsiyelin yükleme onayını göstermez', () => {
  const src = read('public/app-main.js');
  assert.match(src, /\$\{segment\.synthetic\?'—':\(fmtDate\(loadingApproval\)\|\|'—'\)\}/);
  assert.match(read('server/lib/parse.js'), /synthetic: syntheticSegmentKind\(segment\)/);
});

// v20261122 — "-6 g geç" yanlış okunuyordu: işaretsiz yön; fark kalemleri
// tooltip'te ve toplamı farka eşit; depoya girmiş parsiyelde gerçekleşen süre.
test('statiğe göre fark kalemlere ayrılır; kalemlerin toplamı farka eşittir', () => {
  const row = cpRow({ transitAnalysis: model() });
  for (const seg of row._logisticSegments.filter(s => s.stage)) {
    const st = seg.stage;
    assert.ok(st.why, 'fark özeti');
    const late = (st.why.base - st.why.ruleDays) + st.why.items.reduce((a, i) => a + i.days, 0);
    assert.equal(late, -st.vsRule, JSON.stringify(st.why));
    assert.equal(st.why.ruleDays, 70);
  }
  assert.deepEqual(row._stageWhy, row._logisticSegments.filter(s => s.stage).sort((a, b) => (a.stage.eta < b.stage.eta ? 1 : -1))[0].stage.why);
  const p1 = row._logisticSegments.find(s => s.stage && s.stage.plan === 'eta').stage;
  assert.ok(p1.why.items.some(i => i.kind === 'plan'), 'planlı ETA kalemi');
});

test('antrepoya girmiş parsiyel: gerçekleşen süre sunucuda hesaplanmaz (CP kurulum maliyeti yok); segment Handover ve antrepo tarihini taşır', () => {
  const ov = { ...require('../server/db').defaultOverrides(), transitRules: rule, transitAnalysis: model() };
  const map = parse.parseAntrepoRows([
    ias({ 'İthalat Dosya No': 'F9', 'Supplier Portal Statü': 'Depoda', 'HANDOVER Tarihi': iso(-80), 'Tahmini Antrepo Giriş Tarihi': iso(-20) }), // i18n-ignore
  ], ov);
  const row = parse.buildCPRowsFromASAS([order()], map, ov)[0];
  const seg = row._logisticSegments.find(s => s.kind === 'partial' && s.partialNo != null);
  assert.ok(seg && seg.handover && seg.arrival, 'istemci hesabı için tarihler segmentte');
  assert.equal(seg.stage, undefined, 'depodaki parsiyelde tahmin yok');
  assert.equal(seg.realized, undefined);
  const app = read('public/app-main.js');
  assert.match(app, /const cpRealizedCache=new WeakMap\(\);/);
  assert.match(app, /value=\{days,basis,start,ruleBasis:rule\?ruleBasis:null,basisMissing,handover:segment\.handover,entry,entrySource,ruleDays,vsRule:ruleDays!=null\?ruleDays-days:null\};/);
  assert.match(app, /const entry=segment\.entry\|\|segment\.arrival,entrySource=segment\.entry\?'actual':'ias';/);
  // Gerçekleşen giriş sütunu yok: entry boş, istemci IAS tahminine düşer ve bunu yazar.
  assert.equal(seg.entry, null);
  const ov2 = { ...require('../server/db').defaultOverrides(), transitRules: rule };
  const map2 = parse.parseAntrepoRows([
    ias({ 'İthalat Dosya No': 'F9', 'Supplier Portal Statü': 'Depoda', 'HANDOVER Tarihi': iso(-80), 'Tahmini Antrepo Giriş Tarihi': iso(-20), 'Antrepo Giriş Tarih': iso(-22) }), // i18n-ignore
  ], ov2);
  const seg2 = parse.buildCPRowsFromASAS([order()], map2, ov2)[0]._logisticSegments.find(s => s.kind === 'partial' && s.partialNo != null);
  assert.equal(seg2.entry.toISOString ? seg2.entry.toISOString().slice(0, 10) : seg2.entry, iso(-22), 'gerçekleşen giriş tarihi tahminden önceliklidir');
  assert.match(app, /resolveTransitDaysForValues\(segment\.delType,segment\.handover,row&&row\.Season,row&&row\.Country,segment\.status,true,rules\)/);
});

test('istemci: işaretsiz yön metni, fark tooltip\'i ve gerçekleşen hücre', () => {
  const app = read('public/app-main.js');
  assert.match(app, /n>0\?\(en\?`\$\{n\} d early`:`\$\{n\} g erken`\):\(en\?`\$\{-n\} d late`:`\$\{-n\} g geç`\)/);
  assert.match(app, /title="\$\{escapeHtml\(cpStageWhyText\(n,r\._stageWhy\)\)\}"/);
  assert.match(app, /const done=st\?null:cpSegmentRealized\(row,segment\);\n  if\(done\)return cpLogisticRealizedHtml\(done\);/);
  assert.match(app, /segments\.some\(segment=>segment&&\(segment\.stage\|\|cpSegmentRealized\(row,segment\)\)\)/);
});

test('Partial View: Ex→Retail ikinci satırı grubun kendi parsiyellerinden; depoda gerçekleşen süre', () => {
  const app = read('public/app-main.js');
  assert.match(app, /function cpStageShiftHtml\(r\)\{\n  if\(r&&r\._partialViewActive\)return cpPartialViewShiftHtml\(r\);/);
  assert.match(app, /const text=`✓ \$\{d\.days\}/);
  assert.match(app, /copy\['Stage ETA'\]=live\?coerceDateLoose\(live\.stage\.eta\):null;/);
  // partialViewRows satır kopyasına yalnız grubun segmentlerini koyar.
  assert.match(app, /_logisticSegments:segments,/);
});

test('üretimde kalan miktar varken sipariş teslimat sonucu sevk edilmiş parsiyelin aşama ETA\'sını almaz', () => {
  // order(): 300 adet, 200 sevk edildi, 100 üretimde.
  const row = cpRow({ transitAnalysis: model() });
  assert.ok(row._logisticProductionQty > 0);
  assert.ok(row['Stage ETA'], 'bilgi sütunu yine en geç yoldaki parsiyeli gösterir');
  assert.equal(row._stageProjection, null, 'sipariş ETA\'sı kalan miktara bağlı');
  const a = CPR.analyzeOrder(row, { transitRules: rule, settings: { targetType: 'retail', requireTransitRule: true } });
  assert.notEqual(a.etaSource, 'stage');
});

test('motor: geçmişte kalmış IAS tahmini varış sayılmaz; üretim satırı aşama ETA\'sı almaz', () => {
  const Engine = require('../public/backlog-delivery-engine.js');
  const today = Math.round(todayUtc / DAY);
  const isoOf = o => new Date(todayUtc + o * DAY).toISOString().slice(0, 10);
  const proj = { etaMean: isoOf(45), etaP80: isoOf(50), anchor: 'handover', currentStage: '2', openOverrunDays: 20, overrunSigma: 5, stages: [] };
  const base = { 'GÜNCEL DURUM\n(STATUS)': 'Yolda', 'ANTREPO GİRİŞ TARİHİ': isoOf(-10), RETAIL: isoOf(30) }; // i18n-ignore
  const F = Engine.FIELDS;
  const make = (status, meta) => ({ [F.status]: status, [F.antrepo]: isoOf(-10), [F.retail]: isoOf(30), [F.revisedLoad]: isoOf(-40), [F.plannedLoad]: isoOf(-40), [F.delType]: 'Gemi',
    _backlogExcel: { transitDays: 70, transitRule: true, actualAntrepoDate: isoOf(-10), handoverDate: isoOf(-40), stageProjection: proj, ...meta } });
  void base;
  const transit = Engine.analyzeOrder(make('Yolda'), { today, dateOrdinal: Engine.defaultOrdinal });
  assert.equal(transit.etaSource, 'stage', 'tahmini tarih geçmiş ama parsiyel yolda');
  assert.equal(transit.eta, today + 45);
  assert.equal(transit.deliveryOutcome, 'EXPECTED_LATE');
  const prod = Engine.analyzeOrder(make('Üretimde', { actualAntrepoDate: null }), { today, dateOrdinal: Engine.defaultOrdinal }); // i18n-ignore
  assert.notEqual(prod.etaSource, 'stage');
  assert.equal(prod.stageOverrunDays, null);
});

test('koşan aralık tek aşamaya denk gelmiyorsa etiket numarasız (Handover ≠ Cut Off)', () => {
  const app = read('public/app-main.js');
  assert.match(app, /return `\$\{spanDiffers\?'':`\$\{run\.code\}\. `\}\$\{label\}/);
  const bda = read('public/backlog-delivery-analysis.js');
  assert.match(bda, /stageCurrent: p\.currentStage \? stageRunLabel\(p\) : ''/);
});

test('CP fark özeti sıra dışı IAS tarihini not olarak taşır; istemci notu yazar', () => {
  const ov = { ...require('../server/db').defaultOverrides(), transitRules: rule, transitAnalysis: model() };
  const map = parse.parseAntrepoRows([
    ias({ 'İthalat Dosya No': 'F7', 'Supplier Portal Statü': 'Yükleme Operasyonları', 'Yükleme Talep Tarih': iso(-25), 'HANDOVER Tarihi': iso(-20), 'Cut Off Tarih': iso(-31) }), // i18n-ignore
  ], ov);
  const row = parse.buildCPRowsFromASAS([order()], map, ov)[0];
  const st = row._logisticSegments.find(s => s.stage).stage;
  assert.equal(st.why.ignored[0].milestone, 'cutOff');
  assert.ok(!st.why.items.some(i => i.kind === 'done' && i.actual < 0));
  assert.match(read('public/app-main.js'), /tutarsız IAS tarihi hesaba katılmadı/);
});
