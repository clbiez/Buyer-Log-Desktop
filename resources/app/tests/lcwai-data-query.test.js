'use strict';
/* Doğal dil veri sorgusu: LCW AI planlar, Buyer Log doğrular ve TÜM kayıtlar
   üzerinde deterministik hesaplar. Rakamlar modelden gelmez. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../public/lcwai-data-query.js');

const d = (y, m, day) => new Date(y, m - 1, day);
function orders() {
  const rows = [];
  const plan = [
    // season, mag, country, buying group, qty, OPD, MB(in-store), order code
    ['W6', 'CU4E', 'TÜRKİYE', 'Kids', 100, d(2026, 1, 10), d(2026, 8, 5), 'PO1'],
    ['W6', 'CU4E', 'BANGLADEŞ', 'Kids', 200, d(2026, 1, 20), d(2026, 8, 20), 'PO2'],
    ['W6', 'CU4E', 'BANGLADEŞ', 'Kids', 50, d(2026, 2, 3), d(2026, 8, 20), 'PO2'],
    ['W6', 'CU4E', 'MISIR', 'Woman', 300, d(2026, 2, 3), d(2026, 9, 1), 'PO3'],
    ['W6', 'CU4E', 'ÇİN', 'Woman', 400, d(2026, 2, 14), d(2026, 9, 12), 'PO4'],
    ['W6', 'CU4E', 'ÇİN', 'Dış Giyim', 500, d(2026, 2, 14), d(2026, 9, 12), 'PO5'],
    ['W6', 'CU4E', 'FAS', 'Man', 600, d(2026, 3, 1), d(2026, 9, 30), 'PO6'],
    ['W6', 'BX2A', 'ÇİN', 'Man', 700, d(2026, 3, 1), d(2026, 9, 30), 'PO7'],
    ['S7', 'CU4E', 'ÇİN', 'Man', 800, d(2026, 6, 1), d(2027, 2, 1), 'PO8'],
    ['W6', 'CU4E', 'HİNDİSTAN', 'Yüzme', 900, d(2026, 3, 9), d(2026, 10, 2), 'PO9'],
    ['W6', 'CU4E', 'HİNDİSTAN', 'Man', 1000, null, d(2026, 10, 2), 'PO10'],
  ];
  for (const [season, mag, country, bg, qty, opd, mb, code] of plan) rows.push({ Season: season, 'Merch Alt Grup Kod': mag, Country: country, 'Buyer Grup (TR)': bg, 'Order Quantity': qty, OPD: opd, 'In-Store (Model Budget)': mb, 'Order Code': code, Line: 'Line A' });
  const fmt = v => (v instanceof Date ? `${String(v.getDate()).padStart(2, '0')}.${String(v.getMonth() + 1).padStart(2, '0')}.${v.getFullYear()}` : v == null ? '' : typeof v === 'number' ? v.toLocaleString('tr-TR') : String(v));
  const col = (key, label, type) => ({ key, label, type, readValue: row => fmt(row[key]), rawValue: row => row[key] });
  const columns = [
    col('Season', 'Season', 'ro'), col('Merch Alt Grup Kod', 'Merch Alt Grup', 'ro'), col('Country', 'Country', 'ro'),
    col('Buyer Grup (TR)', 'Buying Group', 'ro'), col('Order Quantity', 'Order Qty', 'int'), col('OPD', 'OPD', 'date'),
    col('In-Store (Model Budget)', 'In-Store', 'instoreEdit'), col('Order Code', 'Order Code', 'ordercode'), col('Line', 'Line', 'ro'),
  ];
  return Q.createDataset({ id: 'orders', label: 'Siparişler', screen: 'orders', rows, columns, scope: 'all' });
}

test('alan türleri sütun türü ve kanonik kayıttan çıkar; şema eş anlamlıları ve örnek değerleri taşır', () => {
  const ds = orders();
  const kind = id => ds.fields.find(f => f.id === id).kind;
  assert.equal(kind('Order Quantity'), 'number');
  assert.equal(kind('In-Store (Model Budget)'), 'date');
  assert.equal(kind('Season'), 'text');
  assert.equal(kind('Order Code'), 'text', 'kimlik kodu sayı gibi toplanmaz');
  const schema = Q.schemaText([ds]);
  assert.match(schema, /DATASET "orders"/);
  assert.match(schema, /"In-Store \(Model Budget\)" \| date \| inStore \| aka: [^\n]*MB/, 'MB eş anlamlısı model bütçe tarihine bağlı');
  assert.match(schema, /"Season" \| text \| season[^\n]*values: "W6"/);
  assert.match(schema, /"Order Quantity" \| number \| orderQuantity[^\n]*range: 50 … 1000/);
});

test('kullanıcının örnek isteği: MAG CU4E, W6, ülke ve buying group hariç; MB ayına göre Buying Group pivotu', () => {
  const ds = orders();
  const plan = {
    dataset: 'orders',
    filters: [
      { field: 'MAG', op: 'in', values: ['cu4e'] },
      { field: 'Season', op: 'in', values: ['w6'] },
      { field: 'Country', op: 'not_in', values: ['Türkiye', 'Mısır', 'Fas'] },
      { field: 'Buying Group', op: 'not_in', values: ['Dış Giyim', 'Yuzme'] },
    ],
    rows: [{ field: 'MB', bucket: 'month' }],
    columns: [{ field: 'Buying Group' }],
    measures: [{ agg: 'sum', field: 'Order Quantity' }],
  };
  const norm = Q.normalizeSpec(JSON.stringify(plan), [ds]);
  assert.equal(norm.ok, true, norm.errors.join());
  assert.equal(norm.clarify, null);
  assert.deepEqual(norm.spec.filters.map(f => [f.field, f.op, f.values]), [
    ['Merch Alt Grup Kod', 'in', ['CU4E']],
    ['Season', 'in', ['W6']],
    ['Country', 'not_in', ['TÜRKİYE', 'MISIR', 'FAS']],
    ['Buyer Grup (TR)', 'not_in', ['Dış Giyim', 'Yüzme']],
  ]);
  const result = Q.execute(norm.spec, ds);
  // Kalan: PO2 (2 satır, 08), PO4 (09), PO10 (10) → BANGLADEŞ Kids 250 / ÇİN Woman 400 / HİNDİSTAN Man 1000
  assert.equal(result.matched, 4);
  assert.deepEqual(result.columns.map(c => c.label), ['In-Store (ay)', 'Kids', 'Man', 'Woman', 'Toplam']);
  assert.deepEqual(result.rows, [['2026-08', 250, null, null, 250], ['2026-09', null, null, 400, 400], ['2026-10', null, 1000, null, 1000]]);
  assert.deepEqual(result.total, ['Toplam', 250, 1000, 400, 1650]);
  const lines = Q.describe(norm.spec, ds, result, 'tr').join('\n');
  assert.match(lines, /Merch Alt Grup = CU4E/);
  assert.match(lines, /Country ≠ TÜRKİYE, MISIR, FAS/);
  assert.match(lines, /Eşleşen: 4 \/ 11 kayıt/);
  assert.ok(norm.notes.some(note => /“Yuzme” → “Yüzme”/.test(note)), 'Türkçe karakter düzeltmesi kullanıcıya gösterilir');
});

test('dağınık istek: sipariş geçme (OPD) ayı × model bütçe ayı, W6; boş tarih ayrı satırda kalır', () => {
  const ds = orders();
  const norm = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'Sezon', values: 'W6' }], rows: [{ field: 'Sipariş geçme tarihi', bucket: 'month' }], columns: [{ field: 'model bütçe', bucket: 'month' }], measures: [{ agg: 'count_distinct', field: 'PO' }] }, [ds]);
  assert.equal(norm.ok, true, norm.errors.join());
  const result = Q.execute(norm.spec, ds);
  assert.equal(result.matched, 10);
  assert.deepEqual(result.rows.map(r => r[0]), ['2026-01', '2026-02', '2026-03', '(boş)']);
  assert.deepEqual(result.columns.map(c => c.label).slice(0, 2), ['OPD (ay)', '2026-08']);
  // Ocak: PO1 (08), PO2 (08) → 2 farklı PO; Şubat: PO2(08), PO3(09), PO4(09), PO5(09)
  assert.deepEqual(result.rows[0].slice(0, 3), ['2026-01', 2, null]);
  assert.deepEqual(result.rows[1].slice(0, 3), ['2026-02', 1, 3]);
  assert.equal(result.total.at(-1), 9, 'toplam farklı PO sayısı tüm eşleşen kayıtlardan yeniden hesaplanır (toplanmaz)');
});

test('eşleşmeyen "dahil et" değeri sessizce yok sayılmaz: benzer değerlerle soru sorulur', () => {
  const ds = orders();
  const norm = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'MAG', values: ['ZZ9Q'] }], rows: ['Season'], measures: [{ agg: 'sum', field: 'Order Quantity' }] }, [ds]);
  assert.ok(norm.clarify, 'soru üretilir');
  assert.match(norm.clarify.question, /“ZZ9Q” değerini Merch Alt Grup alanında bulamadım/);
  assert.ok(norm.clarify.options.length >= 1);
});

test('yazım hatası ve yanlış alan: tek adaylı düzeltme uygulanır ve not edilir', () => {
  const ds = orders();
  const typo = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'Country', values: ['Bangldeş'] }], measures: [{ agg: 'sum', field: 'Order Quantity' }] }, [ds]);
  assert.deepEqual(typo.spec.filters[0].values, ['BANGLADEŞ']);
  assert.equal(Q.execute(typo.spec, ds).rows[0][0], 250, 'gruplamasız tek toplam');
  const wrongField = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'Line', values: ['CU4E'] }], measures: [{ agg: 'count' }] }, [ds]);
  assert.equal(wrongField.spec.filters[0].field, 'Merch Alt Grup Kod');
  assert.ok(wrongField.notes.some(n => /Merch Alt Grup alanında bulundu/.test(n)));
});

test('hariç tutulan değer veride yoksa yalnız uyarı yazılır; ülke adları kodla eşleşir', () => {
  const ds = orders();
  const norm = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'Country', op: 'exclude', values: ['Turkey', 'Egypt', 'Atlantis'] }], rows: ['Country'], measures: [{ agg: 'sum', field: 'Order Quantity' }] }, [ds]);
  assert.equal(norm.clarify, null);
  assert.deepEqual(norm.spec.filters[0].values, ['TÜRKİYE', 'MISIR']);
  assert.ok(norm.notes.some(n => /“Atlantis” Country alanında bulunamadı; hariç tutma/.test(n)));
});

test('yapısal hatalar LCW AI düzeltmesi için raporlanır', () => {
  const ds = orders();
  assert.deepEqual(Q.normalizeSpec('not json', [ds]).errors, ['spec-not-json']);
  const bad = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'Uydurma Alan', values: ['x'] }], measures: [{ agg: 'sum', field: 'Season' }] }, [ds]);
  assert.ok(bad.errors.includes('unknown-field:filter:Uydurma Alan'));
  assert.ok(bad.errors.includes('agg-needs-number:sum:Season'));
});

test('tarih aralığı, dönem filtresi, liste modu, sıralama ve limit', () => {
  const ds = orders();
  const between = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'OPD', op: 'between', from: '2026-02', to: 'mart 2026' }], measures: [{ agg: 'count' }] }, [ds]);
  assert.equal(between.spec.filters[0].from, '2026-02-01');
  assert.equal(between.spec.filters[0].to, '2026-03-31');
  assert.equal(Q.execute(between.spec, ds).rows[0][0], 7);
  const period = Q.normalizeSpec({ dataset: 'orders', filters: [{ field: 'MB', values: ['09.2026'] }], list: ['Order Code', 'Order Quantity'], sort: { by: 'Order Quantity', dir: 'desc' }, limit: 2 }, [ds]);
  const list = Q.execute(period.spec, ds);
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.rows, [['PO7', 700], ['PO6', 600]]);
  const top = Q.normalizeSpec({ dataset: 'orders', rows: ['Country'], measures: [{ agg: 'sum', field: 'Order Quantity' }], sort: { by: 0, dir: 'desc' }, limit: 1 }, [ds]);
  const topResult = Q.execute(top.spec, ds);
  assert.deepEqual(topResult.rows, [['ÇİN', 2400]]);
  assert.equal(topResult.total[1], 5550, 'limitli sonuçta toplam yine tüm eşleşenlerdir');
});

test('Markdown ve Excel çıktısı hesaplanmış değerleri birebir taşır', () => {
  const ds = orders();
  const norm = Q.normalizeSpec({ dataset: 'orders', rows: ['Country'], measures: [{ agg: 'sum', field: 'Order Quantity' }] }, [ds]);
  const result = Q.execute(norm.spec, ds);
  const md = Q.toMarkdown(result, { lang: 'tr' });
  assert.match(md, /\| ÇİN \| 2\.400 \|/);
  assert.match(md, /\| \*\*Toplam\*\* \| 5\.550 \|/);
  const wb = Q.toWorkbook(result, { title: 'Test', lines: Q.describe(norm.spec, ds, result) });
  assert.equal(wb.sheets[0].columns[1].type, 'number');
  assert.deepEqual(wb.sheets[0].rows.at(-1), ['Toplam', 5550]);
  assert.ok(wb.notes[0].startsWith('Veri: Siparişler'));
});

test('değer ayrıştırma: TR/EN sayı biçimi, Excel seri tarihi, dönemler', () => {
  assert.equal(Q.parseNumber('1.234,5'), 1234.5);
  assert.equal(Q.parseNumber('1,234.5'), 1234.5);
  assert.equal(Q.parseNumber('12.000'), 12000, 'TR binlik ayırıcı');
  assert.equal(Q.parseNumber('PO1'), null);
  assert.equal(Q.parseDate(46000), '2025-12-09');
  assert.equal(Q.parseDate('2026-03-05T00:00:00.000Z'), '2026-03-05');
  assert.equal(Q.parseDate('31.02.2026'), '', 'geçersiz gün');
  assert.deepEqual(Q.periodOf('2026 Q3'), { bucket: 'quarter', key: '2026-Q3' });
  assert.equal(Q.bucketOf('2026-01-01', 'week'), '2026-W01');
});

test('serbest yazım: veri isteği ve ekran sezgisi Türkçe karakter ve yazım hatasına dayanıklı', () => {
  assert.equal(Q.looksLikeDataRequest('günaydın bana ay bazlı sıparıs gecme tarıhlerını / model butce ayına göre w6 da cıkarabılır mısın'), true);
  assert.deepEqual(Q.screensIn('sıparıslerden W6 toplamı'), ['orders']);
  assert.equal(Q.looksLikeDataRequest('Bu maili daha profesyonel yaz'), false);
  assert.equal(Q.looksLikeDataRequest('kaç sipariş var'), true);
});
