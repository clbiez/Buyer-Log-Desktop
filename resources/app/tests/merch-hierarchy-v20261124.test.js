'use strict';

/* Merch hiyerarşisi (Marka Müdürlüğü › MMYG › MAG) — elle bakım gerektirmeyen kaynak.
   Kullanıcı talebi: "MAG süzerken CU4E görüyorsam yanında MMYG adını ve marka
   müdürlüğünü göreyim; yarın bir şey değişirse veri bayat kalmasın, manuel
   güncelleme gerekmesin." Hiyerarşi her ASAS ayrıştırmasında satırlardan gözlenir,
   yayın anında öncekiyle birleştirilir; son görülen değer her zaman kazanır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../server/lib/merch-hierarchy');
const parse = require('../server/lib/parse');
const modelRefresh = require('../server/lib/model-refresh');
const modelFields = require('../server/lib/model-fields');

const REQUIRED = ['Sipariş Kod', 'Renk', 'Renk Kod', 'FOB Fiyatı', 'Üretici', 'Sezon', 'Model Adı', 'Orijinal Exfactory Merch Tarih', 'Ana Kumaş Mı'];
function asasRow(oc, mag, mmyg, name, directorate, extra = {}) {
  return {
    'Sipariş Kod': oc, Renk: 'Gri', 'Renk Kod': 'R' + oc, 'Net Alım Sipariş Miktarı': 10, 'FOB Fiyatı': 2,
    Üretici: 'Ü', Sezon: 'W26', 'Model Adı': 'M' + oc, 'Orijinal Exfactory Merch Tarih': '2026-01-01', 'Ana Kumaş Mı': 1,
    'Merch Alt Grup Kod': mag, 'Merch Marka Yaş Grup Kod': mmyg, 'Merch Marka Yaş Grup': name, 'Marka Müdürlükleri': directorate, ...extra,
  };
}

test('ayrıştırma MAG → MMYG → ad → müdürlük zincirini satırlardan çıkarır, çakışmayı saklamaz', () => {
  const parsed = parse.parseASASRows([
    asasRow(1, 'cu4e', 'CUW4', 'ERKEK ÇOCUK', 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ'),
    asasRow(2, 'CU4E', 'CUW4', 'ERKEK ÇOCUK', 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ'),
    asasRow(3, 'CU4E', 'CKW4', 'KIZ ÇOCUK', 'KIZ Md'),                       // veri hatası: azınlık
    asasRow(4, 'CK1B', 'CK1', 'KIZ BEBEK AKSESUAR', 'BEBEK MARKA DİREKTÖRLÜĞÜ'),
    asasRow(5, 'CK1K', 'CKC1', 'KIZ BEBEK AKSESUAR', 'ÇOCUK AKSESUAR MARKA DİREKTÖRLÜĞÜ'),
  ]);
  const h = parsed.merchHierarchy;
  assert.deepEqual(h.columns, { name: true, directorate: true });
  assert.equal(h.mag.CU4E.mmyg, 'CUW4', 'çoğunluk kazanır');
  assert.equal(h.mmyg.CUW4.name, 'ERKEK ÇOCUK');
  assert.ok(h.conflicts.some(c => c.kind === 'mag-mmyg' && c.code === 'CU4E' && c.values.length === 2));
  assert.ok(h.conflicts.some(c => c.kind === 'shared-name' && c.codes.join() === 'CK1,CKC1'), 'aynı adı taşıyan iki MMYG uyarılır');
  assert.equal(h.builtAt, null, 'ayrıştırma deterministik: zaman damgası yayında basılır');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.orders[0]._sourceFields, 'Merch Marka Yaş Grup'), false, 'ad her siparişe kopyalanmaz (snapshot baytı artmaz)');
  assert.equal(parsed.orders[0]._sourceFields['Marka Müdürlükleri'], 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ', 'mevcut kaynak alanları korunur');
  assert.deepEqual(H.describe(h, 'mag', 'cu4e'), { code: 'CU4E', mmyg: 'CUW4', mmygName: 'ERKEK ÇOCUK', directorate: 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ', stale: false });
});

test('ad sütunu yalnız birebir adla okunur; kod sütunu ad sanılmaz', () => {
  const rows = [asasRow(1, 'CU4E', 'CUW4', undefined, 'Md')].map(row => { const copy = { ...row }; delete copy['Merch Marka Yaş Grup']; return copy; });
  const h = parse.parseASASRows(rows).merchHierarchy;
  assert.equal(h.columns.name, false);
  assert.equal(h.mmyg.CUW4.name, '', '"Merch Marka Yaş Grup Kod" ad olarak alınmadı');
});

test('birleştirme: son yenileme kazanır, görülmeyen kodlar süreli tutulur, ad sütunu yoksa son bilinen ad korunur', () => {
  const day1 = H.merge(null, parse.parseASASRows([
    asasRow(1, 'CU4E', 'CUW4', 'ERKEK ÇOCUK', 'EÇ Md'), asasRow(2, 'OLD1', 'ST9', 'STANDART DIŞI', 'JOY Md'),
  ]).merchHierarchy, { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(day1.builtAt, '2026-01-01T00:00:00.000Z');
  assert.equal(day1.mag.CU4E.lastSeenAt, '2026-01-01T00:00:00.000Z');

  // Ertesi gün ASAS'ta CU4E başka bir MMYG'ye taşındı ve OLD1 artık gelmiyor.
  const day2 = H.merge(day1, parse.parseASASRows([asasRow(1, 'CU4E', 'CUX4', 'ERKEK GENÇ', 'EG Md')]).merchHierarchy, { now: '2026-01-02T00:00:00.000Z' });
  assert.equal(day2.mag.CU4E.mmyg, 'CUX4', 'elle güncelleme olmadan yeni ilişki');
  assert.equal(day2.mag.CU4E.stale, undefined);
  assert.equal(day2.mag.OLD1.mmyg, 'ST9', 'eski kod son bilinen değeriyle durur');
  assert.equal(day2.mag.OLD1.stale, true);

  // Saklama süresi dolunca eski kod düşer.
  const later = H.merge(day2, parse.parseASASRows([asasRow(1, 'CU4E', 'CUX4', 'ERKEK GENÇ', 'EG Md')]).merchHierarchy, { now: '2027-06-01T00:00:00.000Z' });
  assert.equal(later.mag.OLD1, undefined);

  // Kaynakta ad sütunu yoksa (ör. eşlenmemiş model) ad silinmez.
  const noNameRows = [asasRow(1, 'CU4E', 'CUX4', undefined, 'EG Md')].map(row => { const c = { ...row }; delete c['Merch Marka Yaş Grup']; return c; });
  const day3 = H.merge(day2, parse.parseASASRows(noNameRows).merchHierarchy, { now: '2026-01-03T00:00:00.000Z' });
  assert.equal(day3.mmyg.CUX4.name, 'ERKEK GENÇ');

  // Bu tur ASAS ayrıştırılmadıysa (yalnız LFL yenilemesi) hiyerarşi aynen korunur.
  assert.equal(H.merge(day3, null), day3);
});

test('eski snapshot yedeği: sipariş ve LFL satırlarından kod + müdürlük kurulur', () => {
  const h = H.fromRuntimeRows([{ merch: 'CU4E', ageGroup: 'CUW4' }], [{ mag: 'CU4C', mmyg: 'CUW4', brandDirectorate: 'EÇ Md' }], { at: '2026-01-01T00:00:00.000Z' });
  assert.equal(h.mag.CU4E.mmyg, 'CUW4');
  assert.equal(h.mmyg.CUW4.directorate, 'EÇ Md');
  assert.equal(h.mmyg.CUW4.name, '');
});

function asasConnection(over = {}) {
  const mapping = Object.fromEntries(REQUIRED.map(header => [header, { table: 'Siparis', name: header, kind: 'column' }]));
  mapping['Merch Marka Yaş Grup Kod'] = { table: 'Urun', name: 'Merch Marka Yaş Grup Kod', kind: 'column' };
  return { id: 'asas', role: 'asas', mode: 'auto', server: 's', catalog: 'c', mappingEnhancementScanVersion: 4,
    horizon: { table: 'Siparis' }, mapping, ...over };
}

test('model eşlemesi: MMYG adı bir kez, yalnız birebir adla ve MMYG kodunun tablosundan eklenir', async () => {
  const schema = { measures: [], columns: [
    { table: 'Siparis', name: 'Merch Marka Yaş Grup', kind: 'column' },     // farklı tablo: satır çoğaltabilir, alınmaz
    { table: 'Urun', name: 'Merch Marka Yaş Grup Kod', kind: 'column' },
    { table: 'Urun', name: 'Merch Marka Yaş Grup', kind: 'column' },
  ] };
  const item = asasConnection();
  let scans = 0;
  const result = await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => { scans += 1; return schema; } });
  assert.equal(scans, 1);
  assert.deepEqual(item.mapping[modelFields.MMYG_NAME_FIELD.header], { table: 'Urun', name: 'Merch Marka Yaş Grup', kind: 'column' });
  assert.equal(item.mappingEnhancementScanVersion, 5);
  assert.ok(result.warnings.some(w => /MMYG/.test(w)));
  // Tekrar taranmaz.
  await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => { scans += 1; return schema; } });
  assert.equal(scans, 1);
});

test('model eşlemesi: şema okunamazsa yenileme durmaz, tarama tekrarlanmaz; manuel DAX bağlantısına dokunulmaz', async () => {
  const item = asasConnection();
  const result = await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => { throw new Error('offline'); } });
  assert.equal(result.repaired, false);
  assert.equal(item.mapping[modelFields.MMYG_NAME_FIELD.header], undefined);
  assert.equal(item.mappingEnhancementScanVersion, 5);

  const manual = asasConnection({ mode: 'manual', query: 'EVALUATE X' });
  let scans = 0;
  await modelRefresh.ensureConnectionMapping(manual, { discoverSchema: async () => { scans += 1; return { columns: [], measures: [] }; } });
  assert.equal(scans, 0);
});

test('model eşlemesi: aynı tabloda yalnız kod sütunu varsa hiçbir şey eklenmez (içerme eşleşmesi yok)', async () => {
  const item = asasConnection();
  await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => ({ measures: [], columns: [
    { table: 'Urun', name: 'Merch Marka Yaş Grup Kod', kind: 'column' },
    { table: 'Urun', name: 'Merch Marka Yaş Grup Kod Eski', kind: 'column' },
  ] }) });
  assert.equal(item.mapping[modelFields.MMYG_NAME_FIELD.header], undefined);
});

test('LFL, ad sütunu geldiğinde MMYG kodunu yine kod sütunundan okur', () => {
  const lfl = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'lfl.js'), 'utf8');
  const aliases = lfl.match(/mmyg:\s*\[([^\]]+)\]/)[1];
  assert.ok(aliases.indexOf("'MERCH MARKA YAS GRUP KOD'") < aliases.indexOf("'MERCH MARKA YAS GRUP'"), 'birebir kod başlığı ad başlığından önce aranır');
});

test('yayın yolu: model, Excel ve klasör yenilemeleri hiyerarşiyi birleştirir; snapshot taşır; API okur', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /merchHierarchy: merchHierarchy\.merge\(runtime\.merchHierarchy, result\.merchHierarchy\)/);
  assert.match(server, /merchHierarchy: merchHierarchy\.merge\(runtime\.merchHierarchy, parsedAsas\.merchHierarchy\)/);
  assert.match(server, /result\.merchHierarchy = asasExcel\.merchHierarchy/);
  assert.match(server, /merchHierarchy: runtime\.merchHierarchy \|\| null/, 'snapshot kaydı');
  assert.match(server, /app\.get\('\/api\/merch-hierarchy'/);
  assert.match(server, /merchHierarchyVersion:/);
  const refresh = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'), 'utf8');
  assert.match(refresh, /merchHierarchy: merchHierarchy\.combine\(merchHierarchyParts\)/);
});
