'use strict';
/*
 * v4.16 — kalıcı manuel tarih revizyonu.
 *
 * v4.15'te revizyon yalnız tarayıcıda yaşıyordu; yenilemede ASAS'tan gelen tarih
 * manuel girişi siliyordu. Artık revizyon overrides.datemap'te kalıcı ve ASAS'tan
 * gelen ORİJİNAL tarih siparişin üstünde _asasEx/_asasRetail/_asasMb olarak
 * saklanıyor. Karşılaştırma, Ex-Factory renklendirmesi ve "eski → yeni" gösterimi
 * hep bu orijinale bakar.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const BLRevision = require(path.join(__dirname, '..', 'public', 'revision-display.js'));
const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

const d = (y, m, day) => new Date(y, m - 1, day);
const iso = value => {
  const p = x => String(x).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
};

function asasOrder(extra) {
  return Object.assign({
    ocode: 1234567, ex: d(2026, 8, 1), retail: d(2026, 10, 7), mb: d(2026, 9, 23),
  }, extra || {});
}

// ---------------------------------------------------------------------------
// Sunucu: revizyon kalıcı ve orijinal korunuyor
// ---------------------------------------------------------------------------

test('kaydedilmiş revizyon siparişe uygulanır, orijinal saklanır', () => {
  const [order] = parse.applyDateOverrides([asasOrder()], {
    datemap: { 1234567: { ex: '2026-09-02' } },
  });
  assert.strictEqual(iso(order.ex), '2026-09-02', 'revize tarih uygulanmalı');
  assert.strictEqual(iso(order._asasEx), '2026-08-01', 'ASAS orijinali saklanmalı');
  assert.strictEqual(iso(order.retail), '2026-10-07', 'revize edilmeyen alan değişmemeli');
});

test('model yenilemesi revizyonu ezmez', () => {
  // Yenileme sonrası ASAS yeni bir Ex-factory getiriyor; revizyon yine kazanır.
  const refreshed = asasOrder({ ex: d(2026, 8, 20) });
  const [order] = parse.applyDateOverrides([refreshed], {
    datemap: { 1234567: { ex: '2026-09-02' } },
  });
  assert.strictEqual(iso(order.ex), '2026-09-02');
  assert.strictEqual(iso(order._asasEx), '2026-08-20', 'temel, yenilemeden gelen değer olmalı');
});

test('revizyonu olmayan sipariş kopyalanmaz ve dokunulmaz', () => {
  const original = asasOrder();
  const [order] = parse.applyDateOverrides([original], { datemap: { 9999999: { ex: '2026-09-02' } } });
  assert.strictEqual(order, original);
});

test('geçersiz biçimli kayıt yok sayılır', () => {
  const [order] = parse.applyDateOverrides([asasOrder()], {
    datemap: { 1234567: { ex: 'bugün' } },
  });
  assert.strictEqual(iso(order.ex), '2026-08-01');
});

// ---------------------------------------------------------------------------
// İstemci: karşılaştırma temeli
// ---------------------------------------------------------------------------

function cpRow(extra) {
  return Object.assign({
    'Ex-factory': d(2026, 8, 1), _asasExFactory: d(2026, 8, 1),
    'Retail Date': d(2026, 10, 7), _asasRetailDate: d(2026, 10, 7),
    'In-Store (Model Budget)': d(2026, 9, 23), _asasInStore: d(2026, 9, 23),
    'Ex→Retail': 67, LT: 90, Priority: 'In Time',
  }, extra || {});
}

// Türev alanları taklit eden basit hesap (gerçekte applyFormulas).
function derive(row) {
  const ex = row['Ex-factory'], retail = row['Retail Date'];
  row['Ex→Retail'] = (ex && retail) ? Math.round((retail - ex) / 86400000) : '';
}

test('revizyon yoksa hiçbir hücrede ok çıkmaz', () => {
  const row = cpRow();
  const base = BLRevision.baselineRow(row, derive);
  assert.strictEqual(BLRevision.info(row, 'Ex-factory', base), null);
  assert.strictEqual(BLRevision.hasAny(row, base), false);
});

test('temel ASAS orijinalinden okunur — sayfa yenilense de ok korunur', () => {
  // Sunucudan gelen satır: Ex-factory revize, _asasExFactory orijinal.
  const row = cpRow({ 'Ex-factory': d(2026, 9, 2), 'Ex→Retail': 35 });
  const base = BLRevision.baselineRow(row, derive);
  const rev = BLRevision.info(row, 'Ex-factory', base);
  assert.ok(rev);
  assert.strictEqual(iso(rev.from), '2026-08-01');
  assert.strictEqual(iso(rev.to), '2026-09-02');
  // Türev alan da gölge satırdan hesaplanır: 67 → 35
  assert.deepStrictEqual(BLRevision.info(row, 'Ex→Retail', base), { from: 67, to: 35 });
});

test('değer orijinaline dönerse ok kaybolur', () => {
  const row = cpRow({ 'Ex-factory': d(2026, 9, 2) });
  assert.ok(BLRevision.info(row, 'Ex-factory', BLRevision.baselineRow(row, derive)));
  row['Ex-factory'] = d(2026, 8, 1);
  assert.strictEqual(BLRevision.info(row, 'Ex-factory', row._revBaseRow), null);
});

test('aynı günün farklı saatleri revizyon sayılmaz', () => {
  const row = cpRow({ 'Ex-factory': new Date(2026, 7, 1, 14, 30) });
  assert.strictEqual(BLRevision.info(row, 'Ex-factory', BLRevision.baselineRow(row, derive)), null);
});

test('revize edilen tarih alanları sunucu gövdesi için listelenir', () => {
  const row = cpRow({ 'Ex-factory': d(2026, 9, 2) });
  assert.deepStrictEqual(BLRevision.revisedDateKeys(row), ['Ex-factory']);
  row['Retail Date'] = d(2026, 11, 1);
  assert.deepStrictEqual(BLRevision.revisedDateKeys(row), ['Ex-factory', 'Retail Date']);
  row['Ex-factory'] = d(2026, 8, 1);
  row['Retail Date'] = d(2026, 10, 7);
  assert.deepStrictEqual(BLRevision.revisedDateKeys(row), [], 'orijinale dönenler listelenmemeli');
});

test('gölge satır önbelleği JSON çıktısını kirletmez', () => {
  const row = cpRow({ 'Ex-factory': d(2026, 9, 2) });
  BLRevision.baselineRow(row, derive);
  assert.strictEqual(JSON.parse(JSON.stringify(row))._revBaseRow, undefined);
});

// ---------------------------------------------------------------------------
// Tarih yazımı: Excel gibi
// ---------------------------------------------------------------------------

function loadKeyboardDateParser() {
  const html = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
  const match = html.match(/function parseKeyboardDateToISO\(value\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'parseKeyboardDateToISO bulunamadı');
  const toISODate = value => {
    const p = x => String(x).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  };
  return new Function('toISODate', `return (${match[0]})`)(toISODate);
}

test('yıl yazılmazsa içinde bulunduğumuz yıl kabul edilir', () => {
  const parseDate = loadKeyboardDateParser();
  const year = new Date().getFullYear();
  assert.strictEqual(parseDate('15.12'), `${year}-12-15`);
  assert.strictEqual(parseDate('15.12.'), `${year}-12-15`);
  assert.strictEqual(parseDate('1512'), `${year}-12-15`);
  assert.strictEqual(parseDate('5.3'), `${year}-03-05`);
});

test('tam yazılan biçimler çalışmaya devam eder', () => {
  const parseDate = loadKeyboardDateParser();
  assert.strictEqual(parseDate('15.12.26'), '2026-12-15');
  assert.strictEqual(parseDate('15/12/2026'), '2026-12-15');
  assert.strictEqual(parseDate('2026-12-15'), '2026-12-15');
  assert.strictEqual(parseDate('151226'), '2026-12-15');
});

test('boş giriş temizleme sayılır, geçersiz giriş reddedilir', () => {
  const parseDate = loadKeyboardDateParser();
  assert.strictEqual(parseDate(''), '', 'boş değer temizlemedir, hata değil');
  assert.strictEqual(parseDate('15.'), null);
  assert.strictEqual(parseDate('abc'), null);
  assert.strictEqual(parseDate('32.12.26'), null, 'geçersiz gün reddedilmeli');
  assert.strictEqual(parseDate('15.13'), null, 'geçersiz ay reddedilmeli');
});

// ---------------------------------------------------------------------------
// Depo: revizyonu kaydetme ve kaldırma
// ---------------------------------------------------------------------------

const db = require(path.join(__dirname, '..', 'server', 'db.js'));

test('tarih revizyonu kaydedilir', () => {
  const ov = { datemap: {} };
  db.applyDatePatch(ov, 1234567, { exFactory: '2026-09-02' });
  assert.deepStrictEqual(ov.datemap[1234567], { ex: '2026-09-02' });
});

test('null gönderimi revizyonu KALDIRIR — hücre orijinaline döner', () => {
  const ov = { datemap: { 1234567: { ex: '2026-09-02', retail: '2026-11-01' } } };
  db.applyDatePatch(ov, 1234567, { exFactory: null });
  assert.deepStrictEqual(ov.datemap[1234567], { retail: '2026-11-01' });
});

test('son revizyon da kaldırılınca sipariş kaydı tamamen silinir', () => {
  const ov = { datemap: { 1234567: { ex: '2026-09-02' } } };
  db.applyDatePatch(ov, 1234567, { exFactory: null, retailDate: null, inStoreDate: null });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(ov.datemap, 1234567), false);
});

test('gönderilmeyen alan mevcut revizyonu bozmaz', () => {
  const ov = { datemap: { 1234567: { ex: '2026-09-02' } } };
  db.applyDatePatch(ov, 1234567, { retailDate: '2026-11-01' });
  assert.deepStrictEqual(ov.datemap[1234567], { ex: '2026-09-02', retail: '2026-11-01' });
});

test('biçimsiz değer kaydedilmez', () => {
  const ov = { datemap: {} };
  db.applyDatePatch(ov, 1234567, { exFactory: '02.09.2026' });
  assert.strictEqual(ov.datemap[1234567], undefined);
});
