'use strict';

/* DEL. TYPE / EX-FACTORY ARTIMLI GÜNCELLEME (2026-11-28; ADR-0003 §6N / §6O.d, İş 2)
 *
 * Kök neden: applyIncrementalProjectionPatch Del. Type / Ex-factory yamasında satırın _logisticSegments'ini yeniden
 * kurmuyordu (§6G.2). P1 düzeltmesi (#1241) bu yüzden bu yamaları artımlı-güvensiz saydı: tam projeksiyon kurulumu,
 * diğer istemcilere mode:reload, since jetonu düşmüş tam cp/computed ve sekme başına tam yeniden yükleme (§6N).
 *
 * Bu test artımlı yolun sonucunu TAM KURULUMLA (buildSharedOrderProjectionRowsFromASAS, override'lar güncel)
 * satırın bütün alanlarında karşılaştırır. Beklenen değer artımlı fonksiyondan geçmez. Projeksiyon satırları önbellekte
 * JSON olarak durduğu için iki taraf da JSON'dan geçirilir. Priority yalnız CP'de ve aynı gün hesaplanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');
const { applyIncrementalProjectionPatch } = require('../server/lib/projection-row-patch');

const TRANSIT_RULES = [{ id: 'r-gemi', delType: 'Gemi', days: 70 }, { id: 'r-ucak', delType: 'Uçak', days: 15 }, { id: 'r-tir', delType: 'TIR', days: 20 }];
const overrides = () => ({ antrepoMatchConfig: parse.defaultAntrepoMatchConfig(), submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {}, pricingRules: [], transitRules: TRANSIT_RULES, datemap: {} });
const asas = (extra = {}) => ({ 'Sipariş Kod': '4100001', 'Model Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk': 'SİYAH', 'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 3000, 'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6', 'Buyer Grup (TR)': 'BG', 'Siparişin Üretildiği Ülke': 'BANGLADES', 'Orijinal Exfactory Merch Tarih': '2026-11-01', 'Retail Depo Tarih Yıl Ay Gün': '2027-06-01', 'Model Bütçe Tarih Yıl Ay Gün': '2027-06-15', ...extra });
let seq = 0;
const ias = (status, qty, arrival, vehicle, handover = '') => {
  seq += 1;
  return { 'Sipariş Kod': '4100001', 'Ürün Ad': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH', 'Supplier Portal Statü': status, 'Tahmini Antrepo Giriş Tarihi': arrival, 'HANDOVER Tarihi': handover, 'Vasita Tanim': vehicle, 'Yükleme Toplam Adet': qty, 'Net Alım Sipariş Miktarı': 10000, 'İthalat Dosya No': `IMP-${seq}`, 'Konteyner No': `CONT-${seq}` };
};
const KEY = parse.rowLineKey({ 'Order Code': 4100001, 'Model Name': 'MODEL-1', 'C.Code': 'C01' });
const json = value => JSON.parse(JSON.stringify(value));

// Tam kurulum (CP + Siparişler) — tek doğru.
function fullBuild(ov, { order = {}, iasRows = [] } = {}) {
  const orders = parse.parseASASRows([asas(order)], ov.antrepoMatchConfig).orders;
  const map = iasRows.length ? parse.parseAntrepoRows(iasRows, ov.antrepoMatchConfig) : {};
  const shared = parse.buildSharedOrderProjectionRowsFromASAS(parse.applyDateOverrides(orders, ov), map, ov);
  return { cp: json(shared.cp[0]), orders: json(shared.orders[0]) };
}
// Yama → override (kayıt yolunun yazdığı değer) ve canlı/önbellek yaması.
function overridesAfter(ov, patch) {
  const next = { ...ov, delmap: { ...ov.delmap }, datemap: { ...ov.datemap } };
  if (Object.prototype.hasOwnProperty.call(patch, 'delType')) {
    if (patch.delType == null) delete next.delmap[KEY]; else next.delmap[KEY] = patch.delType;
  }
  if (patch.dates && Object.prototype.hasOwnProperty.call(patch.dates, 'exFactory')) next.datemap[KEY] = { ...(next.datemap[KEY] || {}), ex: patch.dates.exFactory };
  return next;
}
function incremental(row, patch, ov, includePriority) {
  const copy = json(row);
  applyIncrementalProjectionPatch(copy, { model: 'MODEL-1', ccode: 'C01', ...patch }, ov, includePriority, {});
  return json(copy);
}
const ORDER_KEY = '4100001';
/* Tarih değerleri projeksiyonda iki biçimde durabilir: tam kurulum Date'i (JSON'da ISO zaman damgası, yerel gece
   yarısı), artımlı tarih yaması gün metni ('YYYY-MM-DD'; Retail / In-Store yamalarında da bugün böyle). Okuyucular
   (coerceDateLoose) ikisini aynı yerel güne çevirir; karşılaştırma bu yüzden yerel gün değeriyle yapılır. */
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayValue = value => (typeof value === 'string' && ISO_STAMP.test(value) ? localDay(new Date(value))
  : Array.isArray(value) ? value.map(dayValue)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dayValue(v)])) : value);
function differingKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(dayValue(a[key])) !== JSON.stringify(dayValue(b[key]))).sort();
}
function assertIncrementalEqualsFull(spec, patch, label) {
  const ov0 = overrides();
  if (spec.initial) Object.assign(ov0, spec.initial(ov0));
  const before = fullBuild(ov0, spec);
  const ov1 = overridesAfter(ov0, patch);
  const truth = fullBuild(ov1, spec);
  for (const [module, includePriority] of [['cp', true], ['orders', false]]) {
    const got = incremental(before[module], patch, ov1, includePriority);
    assert.deepEqual(differingKeys(got, truth[module]), [], `${label} · ${module}: artımlı ≠ tam kurulum`);
  }
  return truth;
}

const SCENARIOS = {
  'yalnız üretim': {},
  'üretim + yolda': { iasRows: [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20')] },
  'üretim + depoda': { iasRows: [ias('Depoda', 4000, '2026-11-15', 'Uçak', '2026-10-30')] },
  'miktar-0 Üretimde parsiyel + üretim': { iasRows: [ias('Üretimde', 0, '2026-12-03', 'TIR')] },
  'kıtlık + yolda': { iasRows: [ias('Yol Operasyonları', 9300, '2027-01-03', 'Uçak', '2026-12-20')] },
  'kıtlık + depoda': { iasRows: [ias('Depoda', 9300, '2026-11-10', 'Uçak', '2026-10-28')] },
  'tam yüklü (bakiye yok) yolda + depoda': { iasRows: [ias('Yol Operasyonları', 5000, '2026-12-20', 'Gemi', '2026-12-01'), ias('Depoda', 4800, '2026-11-10', 'Uçak', '2026-10-25')] },
  'yükleme onaylı (otomatik Ex-factory) + yolda': { order: { 'Buying Son Onay Tarihi': '20261110' }, iasRows: [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '')] },
};

for (const [name, spec] of Object.entries(SCENARIOS)) {
  test(`Del. Type yaması artımlı = tam kurulum · ${name}`, () => {
    assertIncrementalEqualsFull(spec, { delType: 'Uçak' }, `${name} · Uçak`);
    assertIncrementalEqualsFull(spec, { delType: 'TIR' }, `${name} · TIR`);
  });
}

for (const name of ['yalnız üretim', 'üretim + yolda', 'üretim + depoda', 'miktar-0 Üretimde parsiyel + üretim', 'kıtlık + yolda', 'tam yüklü (bakiye yok) yolda + depoda']) {
  test(`Ex-factory yaması artımlı = tam kurulum · ${name}`, () => {
    assertIncrementalEqualsFull(SCENARIOS[name], { dates: { exFactory: '2026-12-15' } }, `${name} · 15.12`);
    // Geri alma: ASAS değerine dönüş de açık tarihle gelir.
    assertIncrementalEqualsFull(SCENARIOS[name], { dates: { exFactory: '2026-11-01' } }, `${name} · geri alma`);
  });
}

test('Del. Type önceden kayıtlıyken yeni değer / kaynağa dönüş (null) artımlı = tam kurulum', () => {
  const initial = () => ({ delmap: { [KEY]: 'Uçak' } });
  for (const [name, spec] of Object.entries({ 'yalnız üretim': SCENARIOS['yalnız üretim'], 'üretim + yolda': SCENARIOS['üretim + yolda'] })) {
    assertIncrementalEqualsFull({ ...spec, initial }, { delType: 'TIR' }, `${name} · Uçak → TIR`);
    assertIncrementalEqualsFull({ ...spec, initial }, { delType: null }, `${name} · Uçak → kaynağa dön`);
  }
});

test('Del. Type + Ex-factory aynı yamada artımlı = tam kurulum', () => {
  assertIncrementalEqualsFull(SCENARIOS['üretim + yolda'], { delType: 'Uçak', dates: { exFactory: '2026-12-15' } }, 'birlikte');
});

test('birincil segment bir IAS parsiyeline geçiyorsa artımlı yeniden kurulum güvenli tam kuruluma düşer', () => {
  // Üretimde parsiyel (yüklü 2.000 adet) ile üretim bakiyesi aynı aşamada: en erken varış birincil. Ex-factory ileri
  // alınınca üretim bakiyesinin varışı parsiyelinkini geçer → birincil IAS parsiyeline döner; IAS ek alanları özetten
  // yeniden kurulamaz.
  const spec = { iasRows: [ias('Üretimde', 2000, '2027-01-20', 'TIR')] };
  const ov0 = overrides();
  const row = fullBuild(ov0, spec).cp;
  const result = parse.refreshCpLogisticRow(json(row), { dates: { exFactory: '2026-12-15' } }, { transitRules: TRANSIT_RULES });
  assert.deepEqual([result.ok, result.reason], [true, undefined], 'birincil değişmiyor (üretim bakiyesi önde kalır)');
  const flip = parse.refreshCpLogisticRow({ ...json(row), 'Ex-factory': '2027-02-01' }, { dates: { exFactory: '2027-02-01' } }, { transitRules: TRANSIT_RULES });
  assert.deepEqual([flip.ok, flip.reason], [false, 'primary-ias-change']);
});

test('kaynağa dönüşte sipariş anahtarındaki Del. Type geçerli olur (satır → sipariş → Gemi), artımlı = tam kurulum', () => {
  // Sipariş düzeyinde TIR, satırda Uçak kayıtlı; satır kaynağa dönünce (null) değer sipariş anahtarından gelir.
  const initial = () => ({ delmap: { [KEY]: 'Uçak', [ORDER_KEY]: 'TIR' } });
  for (const name of ['yalnız üretim', 'üretim + yolda', 'tam yüklü (bakiye yok) yolda + depoda']) {
    const truth = assertIncrementalEqualsFull({ ...SCENARIOS[name], initial }, { delType: null }, `${name} · sipariş anahtarı`);
    if (name === 'yalnız üretim') assert.equal(truth.cp['Del. Type'], 'TIR');
  }
});

test('aynı siparişin iki rengi: yama yalnız eşleşen renge uygulanır, iki satır da tam kurulumla aynı', () => {
  const { projectionPatchMatches } = require('../server/lib/projection-row-patch');
  const iasRow = ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20');
  const build = ov => {
    const orders = parse.parseASASRows([asas(), asas({ 'Renk Kod': 'C02', 'Renk': 'BEYAZ' })], ov.antrepoMatchConfig).orders;
    const map = parse.parseAntrepoRows([iasRow], ov.antrepoMatchConfig);
    return json(parse.buildSharedOrderProjectionRowsFromASAS(parse.applyDateOverrides(orders, ov), map, ov).cp);
  };
  for (const patch of [{ delType: 'TIR' }, { dates: { exFactory: '2026-12-15' } }, { delType: null }]) {
    const ov0 = overrides();
    ov0.delmap[KEY] = 'Uçak';
    const before = build(ov0);
    const ov1 = overridesAfter(ov0, patch);
    const truth = build(ov1);
    const item = { orderCode: 4100001, patch: { model: 'MODEL-1', ccode: 'C01', ...patch } };
    const got = before.map(row => {
      const copy = json(row);
      if (projectionPatchMatches(copy, item)) applyIncrementalProjectionPatch(copy, item.patch, ov1, true, {});
      return json(copy);
    });
    for (let i = 0; i < truth.length; i += 1) assert.deepEqual(differingKeys(got[i], truth[i]), [], `${JSON.stringify(patch)} · ${truth[i]['C.Code']}`);
    assert.equal(truth.length, 2);
  }
});
