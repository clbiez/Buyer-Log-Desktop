'use strict';
// Buyer Log, ASAS sipariş adedinin IAS parsiyelleriyle karşılanmayan kısmı için
// kendisi satır açar (Üretimde / Eksik Yükleme / Depoda). Bu satırlar kaynak
// siparişin kopyasıdır: sipariş düzeyindeki HİÇBİR alan (Sezon, Buyer, tarihler,
// kimlikler…) boş ya da farklı gelemez. Kullanıcı raporu: Backlog'da sezonu boş
// görünen satırların Buyer Log'un açtığı satırlar olduğundan şüphelenildi.
process.env.TZ = 'Europe/Istanbul';

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');
const Snapshot = require('../server/lib/model-snapshot');

const STATUS = 'GÜNCEL DURUM\n(STATUS)';
// ASAS'ta sipariş düzeyinde tanımlı, her Backlog satırında aynı olması gereken alanlar.
const ORDER_LEVEL = [
  'Sezon', 'Sipariş Yerleştirme MerchTarih', 'Siparişin Üretildiği Ülke', 'Buyer', 'Buyer Grup (TR)', 'Lisans',
  'Üretici', 'Line', 'Ürün Klasman', 'Sipariş Kod', 'Özel Kod 1', 'Model Adı', 'Renk Kod', 'Renk',
  'Orijinal Exfactory Merch Tarih', 'Retail Depo Tarih Yıl Ay Gün', 'Model Bütçe Tarih Yıl Ay Gün',
  'Net Alım Sipariş Miktarı', 'FOB Fiyatı', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
];
const REQUIRED = ORDER_LEVEL.filter(header => header !== 'Lisans');

function ov() {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
  };
}
function asas(code, extra = {}) {
  return {
    'Merch Marka Yaş Grup Kod': 'CUW4', 'Merch Alt Grup Kod': 'CU4E', 'Sezon': 'W6', 'Siparişin Üretildiği Ülke': 'MYANMAR',
    'Üretici': 'NANJING WINSON GARMENT CO.,LTD', 'Buyer': 'ASLI AKZEREN', 'Buyer Grup (TR)': 'DIŞ GİYİM', 'Lisans': '',
    'Sipariş Yerleştirme MerchTarih': '20260205', 'Line': 'EKM DG YD1 LINE', 'Ürün Klasman': 'NAYLON PUFFER',
    'Sipariş Kod': code, 'Özel Kod 1': 'W63153Z4', 'Model Adı': 'KBN,KABI-YD', 'Renk Kod': 'CVL', 'Renk': 'NEW BLACK',
    'Orijinal Exfactory Merch Tarih': '20260615', 'Retail Depo Tarih Yıl Ay Gün': '20260914', 'Model Bütçe Tarih Yıl Ay Gün': '20260928',
    'Plm Kod': '1116262', 'Net Alım Sipariş Miktarı': 9624, 'Kalan Alım Sipariş Miktarı': 1980, 'FOB Fiyatı': 6,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 1980,
    ...extra,
  };
}
function ias(code, qty, extra = {}) {
  return {
    'Sipariş Kod': code, 'Ürün Ad': 'KBN,KABI-YD', 'Renk Kod': 'CVL', 'Renk Tanım': 'NEW BLACK',
    'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-08-11', 'HANDOVER Tarihi': '2026-06-17',
    'Vasita Tanim': 'Gemi', 'Yükleme Toplam Adet': qty,
    ...extra,
  };
}
// 1288118 · CVL gerçek örneği: 9.624 sipariş, 4.875 + 2.769 IAS → 1.980 Üretimde.
const SCENARIOS = [
  { name:'üretim bakiyesi (Üretimde)', code:1288118, asas:{}, ias:[4875, 2769], status:'Üretimde', synthetic:'production' },
  { name:'%10 altı bakiye (Eksik Yükleme)', code:1288119, asas:{ 'Kalan Alım Sipariş Miktarı':600 }, ias:[4875, 4149], status:'Eksik Yükleme', synthetic:'shortage' },
  { name:'pasif sipariş bakiyesi (Depoda)', code:1288120, asas:{ 'Kalan Alım Sipariş Miktarı':0, 'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo':0 }, ias:[4875, 2769], status:'Depoda', synthetic:'warehouse' },
  { name:'hiç IAS yok (tamamı Üretimde)', code:1288121, asas:{ 'Kalan Alım Sipariş Miktarı':9624 }, ias:[], status:'Üretimde', synthetic:'production' },
];

function build(transform = x => x) {
  const overrides = ov();
  const asasRows = SCENARIOS.map(s => asas(s.code, s.asas));
  const iasRows = SCENARIOS.flatMap(s => s.ias.map(qty => ias(s.code, qty)));
  let orders = parse.parseASASRows(asasRows, overrides.antrepoMatchConfig).orders;
  let map = parse.parseAntrepoRows(iasRows, overrides.antrepoMatchConfig);
  ({ orders, map } = transform({ orders, map }));
  return parse.buildBacklogTemplateRows(orders, map, overrides, {});
}
const value = v => (v instanceof Date ? v.toISOString() : v);

function assertSyntheticRowsComplete(rows) {
  for (const scenario of SCENARIOS) {
    const own = rows.filter(row => Number(row['Sipariş Kod']) === scenario.code);
    const synthetic = own.filter(row => row._partial && row._partial.synthetic);
    const partials = own.filter(row => row._partial && !row._partial.synthetic);
    assert.equal(synthetic.length, 1, `${scenario.name}: Buyer Log tam olarak bir bakiye satırı açar`);
    const row = synthetic[0];
    assert.equal(row[STATUS], scenario.status, scenario.name);
    assert.equal(row._partial.synthetic, scenario.synthetic, `${scenario.name}: satır Buyer Log bakiyesi olarak işaretli`);
    assert.equal(row._partial.partialNo, null, `${scenario.name}: IAS parsiyel numarası almaz`);
    assert.equal(row._partial.sourceRow, null, `${scenario.name}: IAS kaynak satırı yoktur`);
    assert.equal(partials.length, scenario.ias.length, `${scenario.name}: gerçek IAS satırları ayrı kalır`);
    assert.equal(row.Adet + partials.reduce((t, p) => t + p.Adet, 0), 9624, `${scenario.name}: satırların toplamı sipariş adedi`);
    for (const header of REQUIRED) {
      const v = row[header];
      assert.ok(v !== undefined && v !== null && v !== '', `${scenario.name}: "${header.replace(/\n/g, ' ')}" boş olamaz`);
    }
    assert.equal(row.Sezon, 'W6');
    assert.equal(row.Buyer, 'ASLI AKZEREN');
    // Buyer Log'un açtığı satır ile gerçek IAS satırları sipariş düzeyinde birebir aynıdır.
    for (const partial of partials) {
      for (const header of ORDER_LEVEL) {
        assert.deepEqual(value(row[header]), value(partial[header]), `${scenario.name}: "${header.replace(/\n/g, ' ')}" IAS satırıyla aynı olmalı`);
      }
    }
  }
}

test('Buyer Log\'un açtığı bakiye satırları siparişin bütün alanlarını taşır', () => {
  assertSyntheticRowsComplete(build());
});

test('soğuk açılışta (model snapshot\'ından geri yüklenen veri) de aynı satırlar birebir aynı', () => {
  const live = build();
  const cold = build(({ orders, map }) => {
    const stored = JSON.parse(JSON.stringify(Snapshot.compactSnapshotPayload({ asasOrders:orders, antrepoMap:map }).value));
    const hydrated = Snapshot.expandSnapshotPayload(stored);
    Snapshot.reviveSnapshotDates(hydrated);
    return { orders:hydrated.asasOrders, map:hydrated.antrepoMap };
  });
  assertSyntheticRowsComplete(cold);
  assert.deepEqual(cold.map(row => ORDER_LEVEL.map(h => value(row[h]))), live.map(row => ORDER_LEVEL.map(h => value(row[h]))));
});

test('CP lojistik akışında ASAS\'ta kapanmış bakiye parsiyel gibi adlandırılmaz', () => {
  const APP = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  assert.match(APP, /if\(segment\.synthetic==='warehouse'\) return appLang==='en'\?'Closed in ASAS · no IAS record'/);
  const PARSE = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server', 'lib', 'parse.js'), 'utf8');
  assert.equal((PARSE.match(/synthetic: syntheticSegmentKind\(segment\)/g) || []).length, 2, 'CP segmentleri ve Backlog satırları aynı işareti taşır');
});
