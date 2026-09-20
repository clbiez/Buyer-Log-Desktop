'use strict';
/*
 * v4.32 regresyon testi — Backlog'da ASAS ↔ IAS satır eşleşmesi.
 *
 * Üç ayrı hata vardı, üçü de "başka bir siparişin/satırın bilgisi raporlanıyor"
 * şeklinde görünüyordu:
 *
 * 1) findAntrepoHit'in gevşek düzeyleri (renk tanımı / yalnız sipariş kodu),
 *    IAS tarafında Model Adı ve Renk Kodu DOLU olan kayıtları da aday alıyordu.
 *    IAS'ta yalnız "1234567 / TSHIRT A / C01" kaydı varsa, aynı siparişin
 *    "TSHIRT B / C02" satırı da bu kaydı yakalayıp Depoda statüsünü ve antrepo
 *    tarihini devralıyordu.
 *
 * 2) Pivot düğümleri yalnız SİPARİŞ KODU listesi taşıyordu; detay penceresi o
 *    kodlara ait bütün satırları getiriyordu. "Depoda" grubuna tıklayınca aynı
 *    siparişin Üretimde olan satırları da listede çıkıyordu.
 *
 * 3) buildBacklogTemplateRows, sipariş özeti ve CP satırlarını
 *    "sipariş kodu + RENK TANIMI" ile eşliyordu. Aynı siparişte aynı renk
 *    tanımına sahip iki model varsa biri diğerinin Ex-factory / Del. Type /
 *    Priority / Ant. Arrival değerlerini alıyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

const d = s => new Date(s + 'T00:00:00');
const overrides = { submap: {}, delmap: {}, suppfobmap: {}, notesmap: {}, licensormap: {}, transitRules: [], pricingRules: [] };

const base = {
  season: '26SS', countryRaw: 'MISIR', buyer: 'B', buyerGrup: 'BG', manufacturer: 'M', line: 'L',
  category: 'C', ozel: '', license: 'FCB', qty: 1000, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
  fob: 5, opd: d('2025-10-01'), ex: d('2026-01-10'), retail: d('2026-04-01'), mb: d('2026-04-15'),
  ageGroup: 'MG', merch: 'MA',
};
// Aynı sipariş kodu altında iki model. Renk TANIMI ikisinde de aynı ("SIYAH"),
// renk KODU farklı — kullanıcının bildirdiği gerçek durum.
function twoLineOrder() {
  return [
    { ...base, ocode: 1234567, model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH', kalan: 0 },
    { ...base, ocode: 1234567, model: 'TSHIRT B', ccode: 'C02', colour: 'SIYAH', ex: d('2026-02-20') },
  ];
}
// IAS yalnız ilk satırı döndürüyor.
function antrepoForFirstLineOnly() {
  const map = {};
  map[parse.orderLineKey(1234567, 'TSHIRT A', 'C01')] = {
    ocode: '1234567', model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH',
    statu: 'Depoda', arr: d('2026-03-01'), handover: null, vasita: 'Uçak', loadedQty: 1000, _ord: 1, _sourceRow: 1, _cpExtra: {},
  };
  return map;
}

test('IAS kaydı yalnız kendi satırına bağlanır; aynı siparişin diğer modeline sıçramaz', () => {
  const [lineA, lineB] = twoLineOrder();
  const map = antrepoForFirstLineOnly();

  const strict = { rule: 'order+model+ccode' };
  const hitA = parse.findAntrepoHit(map, lineA, strict);
  assert.ok(hitA, 'kendi satırı eşleşmeli');
  assert.strictEqual(hitA._matchLevel, 'line');
  assert.strictEqual(hitA.statu, 'Depoda');

  const hitB = parse.findAntrepoHit(map, lineB, strict);
  assert.strictEqual(hitB, null, 'başka modelin IAS kaydı bu satıra bağlanmamalı');
});

test('IAS tarafında model/renk kodu BOŞ ise hiçbir eşleşme kurulmaz', () => {
  const [lineA] = twoLineOrder();
  const map = {
    '1234567|SIYAH': {
      ocode: '1234567', model: '', ccode: '', colour: 'SIYAH',
      statu: 'Yol Operasyonları', arr: d('2026-03-05'), handover: null, vasita: 'Gemi', _ord: 1, _cpExtra: {},
    },
  };
  assert.strictEqual(parse.findAntrepoHit(map, lineA, { rule: 'auto' }), null);
});

test('çelişki kuralı: iki tarafın da dolu olduğu alanda fark varsa eşleşme yok', () => {
  assert.strictEqual(parse.antrepoEntryConflicts({ model: 'A', ccode: 'C01' }, { model: 'B', ccode: 'C01' }), true);
  assert.strictEqual(parse.antrepoEntryConflicts({ model: 'A', ccode: 'C01' }, { model: 'A', ccode: 'C02' }), true);
  assert.strictEqual(parse.antrepoEntryConflicts({ model: '', ccode: '' }, { model: 'A', ccode: 'C01' }), false);
  assert.strictEqual(parse.antrepoEntryConflicts({ model: 'A', ccode: '' }, { model: 'A', ccode: 'C01' }), false);
});

test('pivot düğümünün detayı yalnız o düğümdeki satırları döner', () => {
  const orders = twoLineOrder();
  const map = antrepoForFirstLineOnly();
  const opts = { groupBy: ['status'] };
  const report = parse.buildBacklogGrouped(orders, map, overrides, opts);

  const depodaIdx = report.tree.findIndex(n => n.label === 'Depoda');
  const uretimdeIdx = report.tree.findIndex(n => n.label === 'Üretimde');
  assert.ok(depodaIdx >= 0 && uretimdeIdx >= 0, 'iki grup da oluşmalı');
  assert.strictEqual(report.tree[depodaIdx].rows, 1);
  assert.strictEqual(report.tree[uretimdeIdx].rows, 1);

  const depoda = parse.buildBacklogDetailRows(orders, map, overrides, { ...opts, path: String(depodaIdx) });
  assert.strictEqual(depoda.length, 1);
  assert.strictEqual(depoda[0]['Model Adı'], 'TSHIRT A');
  // v5.83: detay satırlarının anahtarları Backlog başlık listesiyle aynı
  // ('GÜNCEL DURUM' değil 'GÜNCEL DURUM\n(STATUS)').
  assert.strictEqual(depoda[0]['GÜNCEL DURUM\n(STATUS)'], 'Depoda');

  const uretimde = parse.buildBacklogDetailRows(orders, map, overrides, { ...opts, path: String(uretimdeIdx) });
  assert.strictEqual(uretimde.length, 1);
  assert.strictEqual(uretimde[0]['Model Adı'], 'TSHIRT B');
  assert.strictEqual(uretimde[0]['GÜNCEL DURUM\n(STATUS)'], 'Üretimde');
});

test('pivot ağacı JSON yanıtında satır listesini taşımaz', () => {
  const orders = twoLineOrder();
  const report = parse.buildBacklogGrouped(orders, antrepoForFirstLineOnly(), overrides, { groupBy: ['status'] });
  const json = JSON.parse(JSON.stringify(report));
  assert.ok(!Object.prototype.hasOwnProperty.call(json.tree[0], '_list'));
  assert.ok(!Object.prototype.hasOwnProperty.call(json.tree[0], '_orderRefs'));
  assert.strictEqual(json.totalRows, 2);
});

test('düğüm yolu çözümlemesi istemcideki indekslemeyle aynı', () => {
  const tree = [{ label: 'A', children: [{ label: 'A1', children: null }, { label: 'A2', children: null }] }];
  assert.strictEqual(parse.backlogNodeAtPath(tree, '0').label, 'A');
  assert.strictEqual(parse.backlogNodeAtPath(tree, '0-1').label, 'A2');
  assert.strictEqual(parse.backlogNodeAtPath(tree, '0-9'), null);
  assert.strictEqual(parse.backlogNodeAtPath(tree, ''), null);
});

test('Backlog şablon satırları kendi sipariş özeti satırından beslenir', () => {
  const orders = twoLineOrder();
  const rows = parse.buildBacklogTemplateRows(orders, antrepoForFirstLineOnly(), overrides, {});
  const byModel = new Map(rows.map(r => [r['Model Adı'], r]));

  assert.strictEqual(byModel.get('TSHIRT A')['GÜNCEL DURUM\n(STATUS)'], 'Depoda');
  assert.strictEqual(byModel.get('TSHIRT B')['GÜNCEL DURUM\n(STATUS)'], 'Üretimde');

  // Depoda satırı gerçek antrepo tarihini, Üretimde satırı KENDİ Ex-factory'sinden
  // hesaplanan tahmini tarihi almalı. Eski anahtar yüzünden ikisi de aynı tarihi alıyordu.
  const arrivalA = byModel.get('TSHIRT A')['ANTREPO GİRİŞ TARİHİ'];
  const arrivalB = byModel.get('TSHIRT B')['ANTREPO GİRİŞ TARİHİ'];
  assert.strictEqual(arrivalA.getTime(), d('2026-03-01').getTime());
  assert.ok(arrivalB.getTime() !== arrivalA.getTime(), 'iki satır aynı antrepo tarihini paylaşmamalı');
  assert.ok(arrivalB.getTime() > d('2026-02-20').getTime(), 'kendi Ex-factory tarihinden hesaplanmalı');
});

/* --- v4.33: BİREBİR eşleşme kuralı --------------------------------------- *
 * Satır düzeyinde tanımlı (Model Adı + Renk Kodu dolu) bir IAS kaydı, üçlü
 * anahtar birebir tutmuyorsa hiçbir gevşek düzeyden bağlanamaz.               */

test('birebir kural: IAS kaydında renk kodu farklıysa renk tanımından bağlanmaz', () => {
  const order = { ...base, ocode: 1234567, model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH' };
  const map = {
    // Aynı sipariş + aynı model + aynı renk TANIMI, fakat FARKLI renk kodu.
    [parse.orderLineKey(1234567, 'TSHIRT A', 'C77')]: {
      ocode: '1234567', model: 'TSHIRT A', ccode: 'C77', colour: 'SIYAH',
      statu: 'Depoda', arr: d('2026-03-01'), handover: null, vasita: 'Uçak', loadedQty: 1000, _ord: 1, _sourceRow: 1, _cpExtra: {},
    },
  };
  assert.strictEqual(parse.findAntrepoHit(map, order, { rule: 'auto' }), null);
});

test('birebir kural: sipariş kodunda tek IAS kaydı olsa bile başka satıra bağlanmaz', () => {
  const order = { ...base, ocode: 1234567, model: 'TSHIRT B', ccode: 'C02', colour: 'LACIVERT' };
  const map = antrepoForFirstLineOnly();
  const diag = {};
  assert.strictEqual(parse.findAntrepoHit(map, order, { rule: 'auto', diag }), null);
  assert.strictEqual(diag.unmatched, 1, 'birebir anahtar bulunamadığı teşhiste sayılmalı');
});

test('ASAS satırında renk kodu boşsa eşleşme kurulmaz ve teşhiste sayılır', () => {
  const order = { ...base, ocode: 1234567, model: 'TSHIRT A', ccode: '', colour: 'SIYAH' };
  const map = antrepoForFirstLineOnly();
  const diag = {};
  assert.strictEqual(parse.findAntrepoHit(map, order, { rule: 'auto', diag }), null);
  assert.strictEqual(diag.targetIncomplete, 1);
});

test('birebir eşleşen satır teşhiste gevşek sayılmaz', () => {
  const [lineA] = twoLineOrder();
  const diag = {};
  const hit = parse.findAntrepoHit(antrepoForFirstLineOnly(), lineA, { rule: 'auto', diag });
  assert.strictEqual(hit._matchLevel, 'line');
  assert.ok(!diag.targetIncomplete);
  assert.ok(!diag.unmatched);
});

test('kumaş kaydı da birebir kurala tabi', () => {
  const entries = {
    [parse.orderLineKey(1234567, 'TSHIRT A', 'C01')]: {
      ocode: 1234567, model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH', karisim: '%100 PAMUK',
    },
  };
  const orders = [
    { ...base, ocode: 1234567, model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH' },
    { ...base, ocode: 1234567, model: 'TSHIRT B', ccode: 'C02', colour: 'SIYAH' },
  ];
  const applied = parse.applyFabricEntries(orders, entries);
  assert.strictEqual(applied[0].karisim, '%100 PAMUK');
  assert.ok(!applied[1].karisim, 'başka satırın kumaş bilgisi sıçramamalı');
});

/* --- v4.34: IAS'ta model sütununun adı 'Ürün Adı' ------------------------ *
 * ASAS 'Model Adı' → IAS 'Ürün Adı'. Takma ad listesi olmadan otomatik eşleme
 * bu alanı bulamıyor, sorgu model adını hiç getirmiyor ve üçlü anahtar
 * kurulamadığı için eşleşme renk tanımına düşüyordu.                        */
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));

const IAS_COLUMNS = ['İthalat Dosya No', 'Konteyner No', 'Sipariş Kod', 'Ürün Adı', 'Renk Kod', 'Renk Tanım', 'Supplier Portal Statü',
  'Tahmini Antrepo Giriş Tarihi', 'HANDOVER Tarihi', 'Vasita Tanim', 'Yükleme Toplam Adet', 'Net Alım Sipariş Miktarı'];

test('IAS sütunları otomatik eşlenirken Ürün Adı, Model Adı alanına bağlanır', () => {
  const auto = modelFields.autoMapColumns('antrepo', IAS_COLUMNS);
  assert.strictEqual(auto.mapping['Model Adı'], 'Ürün Adı');
  assert.strictEqual(auto.mapping['Renk Kod'], 'Renk Kod');
  assert.strictEqual(auto.mapping['Sipariş Kod'], 'Sipariş Kod');
  assert.deepStrictEqual(modelFields.missingRequired('antrepo', auto.mapping), []);
});

test('model şeması taranırken de Ürün Adı sütunu bulunur', () => {
  const schema = {
    measures: [{ table: 'Ithalat', name: 'HANDOVER Tarihi', kind: 'measure' }],
    columns: IAS_COLUMNS.filter(c => c !== 'HANDOVER Tarihi').map(name => ({ table: 'Siparis Bilgileri', name, kind: 'column' })),
  };
  const auto = modelFields.autoMapSchema('antrepo', schema);
  assert.strictEqual(auto.mapping['Model Adı'] && auto.mapping['Model Adı'].name, 'Ürün Adı');
});

test('ham sonuçta sütun adı Ürün Adı ise de model okunur ve üçlü anahtar kurulur', () => {
  const rows = [
    ['Sipariş Kod', 'Ürün Adı', 'Renk Kod', 'Renk Tanım', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Yükleme Toplam Adet', 'Net Alım Sipariş Miktarı'],
    ['1234567', 'TSHIRT A', 'C01', 'SIYAH', 'Depoda', '2026-03-01', 1000, 1000],
    ['1234567', 'TSHIRT B', 'C02', 'SIYAH', 'Yol Operasyonları', '2026-03-20', 1000, 1000],
  ];
  const map = parse.parseAntrepoRows(rows.slice(1).map(r => Object.fromEntries(rows[0].map((h, i) => [h, r[i]]))));
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.resolved.model, 'Ürün Adı', 'model sütunu çözülmeli');
  assert.strictEqual(meta.lineKeyRows, 2, 'her satırda üçlü anahtar kurulmalı');

  const orders = twoLineOrder();
  const hitA = parse.findAntrepoHit(map, orders[0], { rule: 'order+model+ccode' });
  const hitB = parse.findAntrepoHit(map, orders[1], { rule: 'order+model+ccode' });
  assert.strictEqual(hitA._matchLevel, 'line');
  assert.strictEqual(hitA.statu, 'Depoda');
  assert.strictEqual(hitB._matchLevel, 'line');
  assert.strictEqual(hitB.statu, 'Yol Operasyonları');
});

test('ASAS Model Adı alanı da Ürün Adı sütununu tanır', () => {
  const auto = modelFields.autoMapColumns('asas', ['Sipariş Kod', 'Ürün Adı', 'Renk', 'Renk Kod',
    'Net Alım Sipariş Miktarı', 'FOB Fiyatı', 'Üretici', 'Sezon', 'Orijinal Exfactory Merch Tarih', 'Ürün Klasman']);
  assert.strictEqual(auto.mapping['Model Adı'], 'Ürün Adı');
  assert.strictEqual(auto.mapping['Ürün Klasman'], 'Ürün Klasman');
});

test('kimlik alanı beklenmedik bir sütuna bağlıysa uyarı üretilir', () => {
  const wrong = { 'Sipariş Kod': 'Sipariş Kod', 'Model Adı': 'Marka Tanım', 'Renk Kod': 'Renk Kod' };
  const suspects = modelFields.suspectIdentityMappings('antrepo', wrong);
  assert.strictEqual(suspects.length, 1);
  assert.strictEqual(suspects[0].header, 'Model Adı');

  const right = { 'Sipariş Kod': 'Sipariş Kod', 'Model Adı': 'Ürün Adı', 'Renk Kod': 'Renk Kod' };
  assert.deepStrictEqual(modelFields.suspectIdentityMappings('antrepo', right), []);
});
