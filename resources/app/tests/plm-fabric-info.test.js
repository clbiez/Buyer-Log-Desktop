'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fabric = require('../server/lib/plm-fabric-info');
const parse = require('../server/lib/parse');

test('PLM mainFabricInfo: virgüllü iplik numarası bölünmeden çözülür (gerçek örnek 1)', () => {
  const raw = '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed';
  const out = fabric.parseMainFabricInfo(raw);
  assert.equal(out.raw, raw, 'ham değer her zaman korunur');
  assert.deepEqual([out.fabricCode.value, out.fabricCode.confidence], ['3859', 'EXACT']);
  assert.deepEqual([out.kumasTipi.value, out.kumasTipi.confidence, out.kumasTipi.canonical], ['Jersey', 'EXACT', 'SINGLE_JERSEY']);
  assert.deepEqual([out.iplikNo.value, out.iplikNo.count, out.iplikNo.unit, out.iplikNo.confidence], ['30 Ne Compact Combed', '30', 'Ne', 'EXACT']);
  assert.deepEqual([out.fabricWeight.value, out.fabricWeight.confidence], ['150 gsm', 'EXACT']);
  assert.deepEqual([out.karisim.key, out.karisim.confidence], ['COTTON:100', 'EXACT']);
  assert.equal(out.finish.value, 'Reactive Dyed');
  assert.equal(out.fabricCategory.confidence, 'UNKNOWN', 'metinde kategori yok; uydurulmaz');
  assert.deepEqual(out.unknownTokens, []);
});

test('PLM mainFabricInfo: kategori + Türkçe tip sözlükten çözülür (gerçek örnek 2)', () => {
  const out = fabric.parseMainFabricInfo('Orme,Süprem,150 gsm,100% Cotton');
  assert.deepEqual([out.fabricCategory.value, out.fabricCategory.canonical, out.fabricCategory.confidence], ['Orme', 'KNIT', 'EXACT']);
  assert.deepEqual([out.kumasTipi.value, out.kumasTipi.canonical, out.kumasTipi.confidence], ['Süprem', 'SINGLE_JERSEY', 'EXACT']);
  assert.equal(out.fabricWeight.value, '150 gsm');
  assert.equal(out.karisim.key, 'COTTON:100');
  assert.equal(out.iplikNo.confidence, 'UNKNOWN');
});

test('PLM mainFabricInfo: Kumaşçı ve Kumaşçı Ülkesi PLM metninde yoktur, her zaman UNKNOWN', () => {
  const out = fabric.parseMainFabricInfo('Orme,Süprem,150 gsm,100% Cotton');
  for (const name of ['fabricSupplier', 'fabricSupplierCountry']) {
    assert.equal(out[name].value, '');
    assert.equal(out[name].confidence, 'UNKNOWN');
    assert.equal(out[name].reason, 'not-in-plm');
  }
});

test('PLM mainFabricInfo: emin olunamayan değerler uydurulmaz', () => {
  const free = fabric.parseMainFabricInfo('Kumaş bilgisi yok ABC');
  assert.equal(free.kumasTipi.value, '', 'yapısız serbest metin kumaş tipi sayılmaz');
  assert.deepEqual(free.unknownTokens, ['Kumaş bilgisi yok ABC']);

  const inferred = fabric.parseMainFabricInfo('Dokuma, Poplin, %97 Pamuk %3 Elastan, 120 gr');
  assert.deepEqual([inferred.kumasTipi.value, inferred.kumasTipi.confidence], ['Poplin', 'INFERRED']);
  assert.deepEqual([inferred.fabricWeight.value, inferred.fabricWeight.confidence], ['120 gsm', 'INFERRED'], 'yalnız "gr" birimi kesin gsm değildir');
  assert.deepEqual([inferred.karisim.key, inferred.karisim.confidence], ['COTTON:97|ELASTANE:3', 'EXACT']);

  const partial = fabric.parseMainFabricInfo('Ribana 80% Cotton 15% Polyester');
  assert.equal(partial.karisim.confidence, 'INFERRED', 'toplam %100 değilse kesin sayılmaz');
  assert.ok(partial.warnings.includes('composition-total-not-100'));

  const twoWeights = fabric.parseMainFabricInfo('Süprem 150 gsm / Ribana 220 gsm');
  assert.equal(twoWeights.fabricWeight.value, '', 'hangi gramajın ana olduğu belirsiz');
  assert.ok(twoWeights.warnings.includes('multiple-weights'));

  for (const empty of ['', null, undefined]) {
    const out = fabric.parseMainFabricInfo(empty);
    for (const name of fabric.FIELDS) assert.equal(out[name].confidence, 'UNKNOWN');
  }
});

test('PLM mainFabricInfo: iplik birim önde/arkada ve kat sayısı karşılaştırması', () => {
  const out = fabric.parseMainFabricInfo('Ribana 180gsm 95% Cotton 5% Elastane Ne 30/1');
  assert.deepEqual([out.iplikNo.count, out.iplikNo.unit, out.iplikNo.confidence], ['30/1', 'Ne', 'EXACT']);
  assert.equal(fabric.yarnKey('30/1 Ne'), fabric.yarnKey('30,Ne Compact Combed'));
  assert.notEqual(fabric.yarnKey('30/2 Ne'), fabric.yarnKey('30 Ne'));
});

test('ASAS ↔ PLM karşılaştırması alan bazında eşleşti / farklı / PLM\'de yok sayar', () => {
  const asas = [
    { ocode: 1, model: 'M1', ccode: 'C1', plm: '1001', fabricCategory: 'Örme', fabricSupplier: 'Demo Mill', fabricSupplierCountry: 'Türkiye',
      kumasTipi: 'Single Jersey', iplikNo: '30/1 Ne', fabricWeight: '150', karisim: '%100 Pamuk' },
    // Aynı sipariş kimliği tekrar sayılmaz.
    { ocode: 1, model: 'M1', ccode: 'C1', plm: '1001', kumasTipi: 'Single Jersey' },
    { ocode: 2, model: 'M2', ccode: 'C2', plm: '1002', fabricCategory: 'Örme', kumasTipi: 'Ribana', iplikNo: '', fabricWeight: '160 gsm', karisim: '95% Cotton 5% Elastane' },
    { ocode: 3, model: 'M3', ccode: 'C3', plm: '9999', kumasTipi: 'Süprem', fabricWeight: '150' },
  ];
  const plm = [
    { plmId: '1001', fabric: '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed' },
    { plmId: '1002', fabric: 'Orme,Süprem,150 gsm,100% Cotton' },
  ];
  const report = fabric.compareFabricSources(asas, plm);
  assert.equal(report.orders, 3);
  assert.equal(report.withPlmFabric, 2);
  assert.equal(report.fields.kumasTipi.MATCH, 1);
  assert.equal(report.fields.kumasTipi.DIFFERENT, 1);
  assert.equal(report.fields.kumasTipi.PLM_MISSING, 1);
  assert.equal(report.fields.fabricWeight.MATCH, 1);
  assert.equal(report.fields.fabricWeight.DIFFERENT, 1);
  assert.equal(report.fields.karisim.MATCH, 1);
  assert.equal(report.fields.karisim.DIFFERENT, 1);
  assert.equal(report.fields.iplikNo.MATCH, 1);
  assert.equal(report.fields.fabricCategory.MATCH, 1, 'Örme (ASAS) = Orme (PLM)');
  assert.equal(report.fields.fabricSupplier.NOT_IN_PLM, 3);
  assert.equal(report.fields.fabricSupplier.matchRate, null);
  assert.equal(report.fields.kumasTipi.matchRate, 50);
  const sample = report.differenceSamples.find(item => item.field === 'kumasTipi');
  assert.equal(sample.plmRaw, 'Orme,Süprem,150 gsm,100% Cotton', 'farklılık örneği ham PLM metnini taşır');
  // Girdiler değiştirilmez.
  assert.equal(asas[0].kumasTipi, 'Single Jersey');
});

test('ASAS Refresh kumaş satır çoğalması fabricHeaderInfo içinde ölçülür', () => {
  const base = { 'Sipariş Kod': 100, 'Model Adı': 'M', 'Renk Kod': 'C', 'Renk': 'R', 'Net Alım Sipariş Miktarı': 10, 'FOB Fiyatı': 1, 'Üretici': 'U', 'Sezon': 'S' };
  const rows = [
    { ...base, 'Ana Kumaş Mı': 1, 'Kumaş Tipi': 'Süprem' },
    { ...base, 'Ana Kumaş Mı': 0, 'Kumaş Tipi': 'Ribana' },
    { ...base, 'Ana Kumaş Mı': 0, 'Kumaş Tipi': 'Tül' }, // i18n-ignore
  ];
  const parsed = parse.parseASASRows(rows);
  assert.equal(parsed.orders.length, 1);
  assert.equal(parsed.orders[0].kumasTipi, 'Süprem', 'mevcut ana kumaş davranışı değişmez');
  assert.equal(parsed.fabricHeaderInfo.sourceRowCount, 3);
  assert.equal(parsed.fabricHeaderInfo.orderIdentityCount, 1);
  assert.equal(parsed.fabricHeaderInfo.rowsPerOrderIdentity, 3);
});

test('karşılaştırma endpoint\'i salt okunur ve yetkili alanla korunur', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = src.indexOf("app.get('/api/diagnostics/fabric-source-comparison'");
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('\n});', start));
  assert.match(block, /userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(block, /plmFabricInfo\.compareFabricSources/);
  assert.doesNotMatch(block, /save|write|patch|replace/i);
});
