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
  assert.deepEqual(Object.keys(row._stageRun).sort(), ['code', 'days', 'mean', 'over']);
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
  assert.match(app, /\{k:'Current Stage', label:'Current Stage', type:'stageRun', weight:14, group:'Lojistik', defaultHidden:true\}/);
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
