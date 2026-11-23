'use strict';

/* MODEL YENİLEME AYRIŞTIRMASI ANA İŞ PARÇACIĞINI KİLİTLEMEZ (8.0.12 saha kaydı).
 *
 * 62 bin satırlık moderatör verisinde yenileme sırasında 8,8 sn'lik ana iş
 * parçacığı duraklaması ölçüldü. Kök nedenler:
 *   1) Antrepo eşleştirme yapılandırması findAntrepoHit(s) /
 *      dynamicAntrepoMatchKey / buildAntrepoLookup içinde HER SATIRDA yeniden
 *      normalleştiriliyor ve imzası yeniden hesaplanıyordu.
 *   2) LFL tekilleştirme anahtarı satır başına 20 alanı önbelleksiz turknorm'dan
 *      geçiriyordu.
 *   3) ASAS / LFL / IAS ayrıştırması tek senkron blokta çalışıyordu.
 *
 * Sözleşme: çıktı birebir aynıdır; yapılandırma bir kez hazırlanır ve paylaşılır;
 * yenileme ayrıştırması olay döngüsüne düzenli döner. Worker/compute havuzu
 * kullanılmaz (#1148 geri alındı).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const lfl = require(path.join(ROOT, 'server', 'lib', 'lfl.js'));
const modelRefresh = require(path.join(ROOT, 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(ROOT, 'server', 'lib', 'model-fields.js'));

const CUSTOM_CONFIG = {
  version: 2,
  conditions: [
    { id: 'ocode', operands: [{ role: 'asas', header: 'Sipariş Kod' }, { role: 'antrepo', header: 'Sipariş Kod' }] },
    { id: 'model', operands: [{ role: 'asas', header: 'Model Adı' }, { role: 'antrepo', header: 'Ürün Ad' }] },
    { id: 'ccode', operands: [{ role: 'asas', header: 'Renk Kod' }, { role: 'antrepo', header: 'Renk Kod' }] },
  ],
};

function asasRecords(count) {
  const out = [];
  for (let k = 0; out.length < count; k++) {
    const base = {
      'Sipariş Kod': 4000000 + k, 'Model Adı': `MDL ${k % 97} Örgü`, 'Renk Kod': `R${k % 11}`, 'Renk': `Gri ${k % 11}`,
      'Net Alım Sipariş Miktarı': k % 13 ? 100 + k : 0, 'Kalan Alım Sipariş Miktarı': k % 3 ? 40 : 0, 'Antrepoya Giren Miktar': 5,
      'FOB Fiyatı': 2 + (k % 9) / 10, 'Plm Kod': String(700000 + (k % 400)), 'Üretici': `Üretici ${k % 17} A.Ş.`,
      'Sezon': k % 2 ? 'W6' : 'S6', 'Ürün Klasman': k % 2 ? 'KAZAK' : 'HIRKA', 'Merch Alt Grup Kod': `MAG${k % 5}`,
      'Merch Marka Yaş Grup Kod': `MMYG${k % 4}`, 'Buyer Grup (TR)': k % 29 ? 'Kadın Triko' : 'YARDIM',
      'Siparişin Üretildiği Ülke': ['TÜRKİYE', 'ÇİN', 'BANGLADEŞ'][k % 3], 'Lisans': k % 4 ? '' : 'Disney', 'Lisansör': '',
      'Ürün Tanım': `Tanım ${k % 23}`, 'Orijinal Exfactory Merch Tarih': k % 7 ? `2026-0${1 + (k % 9)}-1${k % 9}` : '',
      'Retail Depo Tarih Yıl Ay Gün': `2026-0${1 + (k % 9)}-2${k % 8}`, 'Buyer': `Alıcı ${k % 6}`, 'Line': `Line ${k % 3}`,
      'Marka Müdürlükleri': `Marka ${k % 2}`,
    };
    const fabrics = 1 + (k % 3);
    for (let f = 0; f < fabrics && out.length < count; f++) {
      out.push({ ...base, 'Ana Kumaş Mı': f === 0 ? 1 : 0, 'Kumaş Kategorisi': `Kat ${f}`, 'Kumaşçı Ülkesi': 'ÇİN',
        'Kumaşçı': `Kumaşçı ${k % 8}`, 'Kumaş Tipi': `Tip ${k % 4}`, 'İplik No': '30/2', 'Gramaj': String(180 + (k % 7)), 'Karışım': '%100 Pamuk' });
    }
  }
  return out;
}
function iasRecords(count) {
  const out = [];
  for (let k = 0; out.length < count; k++) {
    if (k % 3 === 0) continue;
    out.push({ 'İthalat Dosya No': `D${k}`, 'Sipariş Kod': 4000000 + k, 'Model Adı': `MDL ${k % 97} Örgü`, 'Renk Kod': `R${k % 11}`,
      'Supplier Portal Statü': ['Depoda', 'Yolda', 'Üretimde'][k % 3], 'Tahmini Antrepo Giriş Tarihi': `2026-0${1 + (k % 9)}-15`,
      'Yükleme Toplam Adet': 50 });
  }
  return out;
}
const counter = () => {
  const state = { count: 0 };
  state.yieldControl = () => { state.count += 1; return new Promise(resolve => setImmediate(resolve)); };
  return state;
};
// Bütçe 0'a yakın: her yield noktasında olay döngüsüne dönmeye zorlar.
const forced = state => ({ budgetMs: 1e-9, yieldControl: state.yieldControl });

test('işbirlikçi ASAS / LFL / IAS ayrıştırması senkron sürümle birebir aynı çıktıyı verir ve yield eder', async () => {
  const records = asasRecords(3000);
  for (const rule of [undefined, CUSTOM_CONFIG]) {
    const state = counter();
    const asyncAsas = await parse.parseASASRowsAsync(records.map(r => ({ ...r })), rule, forced(state));
    assert.equal(JSON.stringify(asyncAsas), JSON.stringify(parse.parseASASRows(records.map(r => ({ ...r })), rule)));
    assert.ok(state.count > 0, 'ASAS ayrıştırması olay döngüsüne dönmeli');
  }

  const lflState = counter();
  const asyncLfl = await lfl.parseLFLRowsAsync(records.map(r => ({ ...r })), 'Test', forced(lflState));
  assert.equal(JSON.stringify(asyncLfl), JSON.stringify(lfl.parseLFLRows(records.map(r => ({ ...r })), 'Test')));
  assert.ok(asyncLfl.rows.length > 0 && lflState.count > 0);

  const ias = iasRecords(2000);
  const iasState = counter();
  const asyncMap = await parse.parseAntrepoRowsAsync(ias.map(r => ({ ...r })), CUSTOM_CONFIG, forced(iasState));
  const syncMap = parse.parseAntrepoRows(ias.map(r => ({ ...r })), CUSTOM_CONFIG);
  assert.equal(JSON.stringify(asyncMap), JSON.stringify(syncMap));
  assert.equal(JSON.stringify(parse.antrepoParseMeta(asyncMap)), JSON.stringify(parse.antrepoParseMeta(syncMap)));
  assert.ok(iasState.count > 0);
});

test('LFL boş/null ve seyrek girişte eski davranışı korur (turknorm belleği null ile boş metni karıştırmaz)', () => {
  const rows = asasRecords(30);
  rows[3] = { ...rows[3], 'Lisans': null, 'Lisansör': 'null' };
  const sparse = rows.slice();
  delete sparse[5];
  const parsed = lfl.parseLFLRows(sparse, 'Test');
  assert.ok(parsed.rows.length > 0);
  assert.equal(parsed.rows.find(row => row.sourceRow === 7), undefined, 'boşluk satırı (kayıt 5 → kaynak satır 7) atlanır');
  const nullRow = parsed.rows.find(row => row.licensor === 'null');
  assert.ok(nullRow, '"null" metni gerçek değer olarak kalır');
  assert.equal(nullRow.dtrType, 'NON-DTR');
});

test('eşleştirme yapılandırması bir kez hazırlanır, paylaşılır ve dondurulur; genel API taze nesne döndürmeye devam eder', () => {
  const raw = JSON.parse(JSON.stringify(CUSTOM_CONFIG));
  const prepared = parse.prepareAntrepoMatchConfig(raw);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), JSON.parse(JSON.stringify(parse.normalizeAntrepoMatchConfig(raw))));
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.conditions[0].operands[0]), 'paylaşılan yapılandırma derin dondurulur');
  assert.equal(Object.isFrozen(raw) || Object.isFrozen(raw.conditions[0]), false, 'girdi nesnesi dondurulmaz');
  assert.equal(parse.prepareAntrepoMatchConfig(prepared), prepared, 'hazır yapılandırma kimlikle geri döner');
  assert.equal(parse.prepareAntrepoMatchConfig(raw), prepared, 'aynı girdi nesnesi yeniden normalleştirilmez');
  assert.equal(parse.prepareAntrepoMatchConfig(JSON.parse(JSON.stringify(raw))), prepared, 'aynı içerik aynı hazır yapılandırmayı paylaşır');

  const fresh = parse.normalizeAntrepoMatchConfig(raw);
  assert.notEqual(fresh, prepared);
  assert.equal(Object.isFrozen(fresh), false, 'genel normalize çıktısı değiştirilebilir kalır');

  // Girdi sonradan değişirse eski hazır sonuç kullanılmaz.
  raw.conditions.pop();
  const changed = parse.prepareAntrepoMatchConfig(raw);
  assert.notEqual(changed, prepared);
  assert.equal(changed.conditions.length, 2);
  assert.equal(parse.antrepoMatchConfigSignature(raw), parse.antrepoMatchConfigSignature(parse.normalizeAntrepoMatchConfig(raw)));
  assert.equal(parse.isDefaultAntrepoMatchConfig(raw), false);
  assert.equal(parse.isDefaultAntrepoMatchConfig(null), true);

  // JSON'da kayıpsız olmayan girdi (Date) önbelleğe alınmaz ama doğru normalleştirilir.
  const when = new Date(Date.UTC(2026, 0, 2));
  const lossy = { version: 2, conditions: [{ id: 'x', operands: [{ role: 'asas', header: when }, { role: 'antrepo', header: 'H' }] }] };
  const lossyPrepared = parse.prepareAntrepoMatchConfig(lossy);
  assert.equal(lossyPrepared.conditions[0].operands[0].header, String(when));
  const twin = { version: 2, conditions: [{ id: 'x', operands: [{ role: 'asas', header: when.toISOString() }, { role: 'antrepo', header: 'H' }] }] };
  assert.equal(parse.prepareAntrepoMatchConfig(twin).conditions[0].operands[0].header, when.toISOString());
});

test('findAntrepoHit(s) ve dinamik anahtar, ham / normalize / hazır yapılandırmayla aynı sonucu verir', () => {
  const orders = parse.parseASASRows(asasRecords(400), CUSTOM_CONFIG).orders;
  const map = parse.parseAntrepoRows(iasRecords(300), CUSTOM_CONFIG);
  const variants = [CUSTOM_CONFIG, parse.normalizeAntrepoMatchConfig(CUSTOM_CONFIG), parse.prepareAntrepoMatchConfig(CUSTOM_CONFIG), { antrepoMatchConfig: CUSTOM_CONFIG }];
  const expected = orders.map(order => JSON.stringify([
    parse.findAntrepoHit(map, order, { rule: variants[0] }),
    parse.findAntrepoHits(map, order, { rule: variants[0] }),
    parse.dynamicAntrepoMatchKey(order, 'asas', variants[0]),
  ]));
  assert.ok(expected.some(text => !text.startsWith('[null')), 'fixture eşleşme içermeli');
  for (const rule of variants.slice(1)) {
    orders.forEach((order, index) => {
      const key = rule.antrepoMatchConfig ? parse.dynamicAntrepoMatchKey(order, 'asas', rule.antrepoMatchConfig) : parse.dynamicAntrepoMatchKey(order, 'asas', rule);
      assert.equal(JSON.stringify([parse.findAntrepoHit(map, order, { rule }), parse.findAntrepoHits(map, order, { rule }), key]), expected[index]);
    });
  }
});

const M = 'Model Özellikleri', T = 'Siparis Bilgileri';
function asasItem() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: M, name: field.header, kind: 'column' };
  return { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['S6', 'W6'], groups: [] }, mapping };
}
function iasItem() {
  const mapping = {};
  for (const header of ['İthalat Dosya No', 'Sipariş Kod', 'Model Adı', 'Renk Kod', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet']) {
    mapping[header] = { table: ['Sipariş Kod', 'Model Adı', 'Renk Kod'].includes(header) ? T : 'Ithalat', name: header === 'Model Adı' ? 'Ürün Ad' : header, kind: 'column' };
  }
  return { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'IASv2', refreshEnabled: true, horizon: { table: T, groups: [] }, mapping };
}

test('loadFromModelConnections ayrıştırma sırasında olay döngüsüne döner ve sonuç senkron ayrıştırmayla aynıdır', async () => {
  const asasRows = asasRecords(2500), iasRows = iasRecords(1500);
  const state = counter();
  const result = await modelRefresh.loadFromModelConnections([asasItem(), iasItem()], {
    targets: ['cp', 'orders', 'backlog', 'priceanalysis', 'lfl'], columnType: false,
    discoverSchema: async () => ({ columns: [], measures: [] }),
    cooperativeParse: forced(state),
    runModelRows: async plan => {
      const rows = (/'Ithalat'/.test(plan.query) ? iasRows : asasRows).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    },
  });
  assert.ok(state.count >= 10, `ayrıştırma aşamaları yield etmeli (görülen: ${state.count})`);
  assert.ok(result.asasOrders.length > 0 && Object.keys(result.antrepoMap).length > 0 && result.lflRows.length > 0);
  // Model sonucu sorgu katmanından geçer; kıyas, ayrıştırıcıya giden aynı satırlarla yapılır.
  assert.equal(JSON.stringify(result.asasOrders), JSON.stringify(parse.parseASASRows(result.runs[0].rows).orders));
  const syncLfl = lfl.parseLFLRows(result.runs[0].rows, modelRefresh.connectionLabel(asasItem()));
  assert.equal(JSON.stringify(result.lflRows), JSON.stringify(syncLfl.rows));
  assert.equal(JSON.stringify(result.lflMeta), JSON.stringify(lfl.withFabricDimensions(syncLfl.meta, syncLfl.rows)));
  assert.equal(JSON.stringify(result.antrepoMap), JSON.stringify(parse.parseAntrepoRows(result.runs[1].rows)));
});
