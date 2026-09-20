'use strict';
/*
 * v4.18 — revizyonu silince orijinale TAM dönüş, ve Ex→Retail köprüsünün korunması.
 *
 * İki hata:
 *  1) Revize edilen Ex→Retail hücresinde köprü bağlantısı siliniyordu; revizyon
 *     gösterimi düz metin üretiyordu.
 *  2) Manuel tarih silindiğinde Ex→Retail orijinal değerine dönmüyor, bir gün
 *     sapıyordu. Kök neden karışık tip ve gün bazına indirgenmemiş temel:
 *     canlı tarih Date, ASAS orijinali metin olarak geliyordu (v4.16'da _asas*
 *     alanları canlandırma listesine eklenmemişti) ve saat bileşeni taşıyan bir
 *     tarih yerel saate çevrilirken bir gün kayabiliyordu.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));
const BLRevision = require(path.join(__dirname, '..', 'public', 'revision-display.js'));
const BLBusinessRules = require(path.join(__dirname, '..', 'public', 'business-rules.js'));

const EMPTY_OVERRIDES = {
  notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {},
  delmap: {}, licensormap: {}, pricingRules: [], transitRules: [],
};

function asasOrder(ex) {
  return {
    ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH',
    season: 'W6', countryRaw: 'MISIR', manufacturer: 'X', license: 'HARRY POTTER',
    category: 'KAZAK', qty: 100, kalan: 100, fob: 5,
    opd: new Date(2026, 0, 1), ex, retail: new Date(2026, 2, 17),
    mb: new Date(2026, 2, 3), merkezSevkeHazirKalan: 0,
  };
}

function cpRow(orders) {
  return parse.buildCPRowsFromASAS(orders, {}, EMPTY_OVERRIDES)[0];
}

test('revizyon yokken Ex→Retail orijinal değerdir', () => {
  const row = cpRow([asasOrder(new Date(2026, 0, 1))]);
  assert.strictEqual(row['Ex→Retail'], 75);
});

test('revizyon uygulanınca Ex→Retail doğru düşer', () => {
  const orders = parse.applyDateOverrides([asasOrder(new Date(2026, 0, 1))], {
    datemap: { 1234567: { ex: '2026-01-03' } },
  });
  assert.strictEqual(cpRow(orders)['Ex→Retail'], 73);
});

test('temel, saat bileşeni taşıyan ASAS tarihinde bile gün bazına iner', () => {
  // Model verisinde tarih UTC gece yarısı olarak gelebiliyor; yerel saate
  // çevrilirken gün kaymamalı.
  for (const raw of [new Date(Date.UTC(2026, 0, 1)), new Date(2026, 0, 1)]) {
    const orders = parse.applyDateOverrides([asasOrder(raw)], {
      datemap: { 1234567: { ex: '2026-01-03' } },
    });
    const row = cpRow(orders);
    const base = row._asasExFactory;
    assert.ok(base instanceof Date, 'temel gerçek bir tarih olmalı');
    assert.strictEqual(base.getFullYear(), 2026);
    assert.strictEqual(base.getMonth(), 0);
    assert.strictEqual(base.getDate(), 1, 'temel bir gün ileri kaymamalı');
  }
});

test('revizyon silinince Ex→Retail TAM olarak orijinaline döner', () => {
  const orders = parse.applyDateOverrides([asasOrder(new Date(2026, 0, 1))], {
    datemap: { 1234567: { ex: '2026-01-03' } },
  });
  const row = cpRow(orders);
  assert.strictEqual(row['Ex→Retail'], 73, 'önce revize hâli');

  // Hücrenin boşaltılması: canlı değer temele geri konur (istemcideki davranış).
  row['Ex-factory'] = BLRevision.baselineDate(row, 'Ex-factory');
  const flags = BLBusinessRules.computePriorityFlags({
    exFactory: row['Ex-factory'], retailDate: row['Retail Date'],
    inStoreDate: row['In-Store (Model Budget)'], status: row.STATUS,
  }, parse.dateOrdinal);
  assert.strictEqual(flags.exr, 75, '74 değil, tam olarak 75 olmalı');
  assert.strictEqual(BLRevision.info(row, 'Ex-factory', BLRevision.baselineRow(row, () => {})), null,
    'orijinale dönünce revizyon oku kalmamalı');
});

test('temel tarih alanları istemcide canlandırma listesinde', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  const match = html.match(/const CP_DATE_KEYS = \[[^\]]*\]/);
  assert.ok(match, 'CP_DATE_KEYS bulunamadı');
  assert.ok(/CP_BASELINE_DATE_KEYS/.test(match[0]),
    'ASAS orijinalleri de canlandırılmalı, yoksa satırda Date ile metin karışır');
  const baseline = html.match(/const CP_BASELINE_DATE_KEYS = \[[^\]]*\]/);
  for (const key of ['_asasExFactory', '_asasRetailDate', '_asasInStore']) {
    assert.ok(baseline[0].includes(key), `${key} canlandırılmalı`);
  }
});

test('Ex→Retail revizyon gösterimi köprüyü koruyor', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  const branch = html.slice(html.indexOf("if(c.k==='Ex→Retail'){"), html.indexOf("if(c.k==='LT'){"));
  assert.ok(branch.includes('SHIP_URL(oc)'), 'köprü üretimi kalmalı');
  assert.ok(/revisionHtml\(c\.k, rev, /.test(branch),
    'revize hâlde de bir çizici verilmeli; aksi halde bağlantı düz metne dönüyor');
});

test('hücre boşaltılınca geri konan değer gün bazlı tarihe çevriliyor', () => {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  assert.ok(html.includes("next = toDateOnly(BLRevision.baselineDate(row,key))"),
    'Ex-factory boşaltmasında temel gün bazına indirgenmeli');
  assert.ok(html.includes("d = toDateOnly(BLRevision.baselineDate(row,key))"),
    'Retail/In-Store boşaltmasında da aynısı geçerli');
});
