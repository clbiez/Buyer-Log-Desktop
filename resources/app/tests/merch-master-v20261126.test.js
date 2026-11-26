'use strict';

/* Model geneli merch eşlemesi. Kullanıcı bulgusu: Ufuk birkaç MAG ile sınırlıyken
   widget ve Ufuk listelerindeki diğer kodlar "No mapping" kalıyordu; "haritalandırılmamış
   etiketleri nasıl haritalandıracağım?" Elle tablo yerine ASAS bağlantısının mevcut
   eşlemesiyle Ufuk'suz küçük bir SUMMARIZE sorgusu, arka planda ve kısıtlı aralıkla. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../server/lib/merch-master');
const H = require('../server/lib/merch-hierarchy');

const col = (table, name) => ({ table, name, kind: 'column' });
function asas(mapping, over = {}) {
  return { id: 'asas', role: 'asas', server: 's', catalog: 'c', horizon: { table: 'Siparis' }, mapping, ...over };
}

test('sorgu: tek tabloda doğrudan, farklı tablolarda Ufuk (fact) tablosu üzerinden özetlenir; Ufuk filtresi yok', () => {
  const same = M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col('Urun', 'MAG'), 'Merch Marka Yaş Grup Kod': col('Urun', 'MMYG'), 'Merch Marka Yaş Grup': col('Urun', 'MMYG Ad') }));
  assert.equal(same.query, `EVALUATE SELECTCOLUMNS(SUMMARIZE('Urun', 'Urun'[MAG], 'Urun'[MMYG], 'Urun'[MMYG Ad]), "mag", 'Urun'[MAG], "mmyg", 'Urun'[MMYG], "name", 'Urun'[MMYG Ad])`);
  assert.deepEqual(same.columns, ['mag', 'mmyg', 'name']);
  const cross = M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col('Urun', 'MAG'), 'Merch Marka Yaş Grup Kod': col('Urun', 'MMYG'), 'Marka Müdürlükleri': col('Marka', 'Müdürlük') }));
  assert.match(cross.query, /^EVALUATE SELECTCOLUMNS\(SUMMARIZE\('Siparis', /);
  assert.doesNotMatch(cross.query, /FILTER|TREATAS|Sezon/i, 'Ufuk koşulu eklenmez');
  const noFact = M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col('Urun', 'MAG'), 'Merch Marka Yaş Grup Kod': col('Urun', 'MMYG'), 'Marka Müdürlükleri': col('Marka', 'M') }, { horizon: {} }));
  assert.deepEqual(noFact.columns, ['mag', 'mmyg'], 'fact tablosu yoksa başka tablodaki sütun atlanır');
  assert.equal(M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col('Urun', 'MAG') })).query, null);
  assert.match(M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col('A', 'MAG'), 'Merch Marka Yaş Grup Kod': col('B', 'MMYG') }, { horizon: {} })).reason, /farklı tablolarda/);
  const quoted = M.buildMasterQuery(asas({ 'Merch Alt Grup Kod': col("O'Tab", 'A]B'), 'Merch Marka Yaş Grup Kod': col("O'Tab", 'C') }));
  assert.match(quoted.query, /'O''Tab'\[A]]B]/, 'DAX kaçışı');
});

test('satırlar hiyerarşiye çevrilir (sütun sırası SELECTCOLUMNS sırası)', () => {
  const h = M.hierarchyFromRows([{ '[mag]': 'BGA', '[mmyg]': 'BGA8', '[name]': 'KADIN AYAKKABI', '[directorate]': 'AYAKKABI Md' }, ['CU4E', 'CUW4', 'ERKEK ÇOCUK', 'EÇ Md']], ['mag', 'mmyg', 'name', 'directorate'], { at: '2026-11-26T00:00:00.000Z' });
  assert.equal(h.mag.BGA.mmyg, 'BGA8');
  assert.equal(h.mmyg.CUW4.name, 'ERKEK ÇOCUK');
  assert.equal(h.source, 'model');
  assert.equal(h.builtAt, '2026-11-26T00:00:00.000Z');
});

test('birleştirme: kullanıcının taze gözlemi kazanır, model eksik kodları ve boş adı tamamlar, eski kayıt modeli ezmez', () => {
  const master = M.hierarchyFromRows([['CU4E', 'CUW4', 'ERKEK ÇOCUK', 'EÇ Md'], ['BGA', 'BGA8', 'KADIN AYAKKABI', 'AY Md'], ['OLD1', 'ST9', 'STANDART', 'JOY Md']], ['mag', 'mmyg', 'name', 'directorate']);
  const runtime = {
    version: 1, builtAt: 'x', columns: { name: false, directorate: true }, conflicts: [],
    mag: { CU4E: { mmyg: 'CUX4', directorate: 'Yeni Md', rows: 3 }, OLD1: { mmyg: 'ZZ', directorate: '', rows: 1, stale: true } },
    mmyg: { CUX4: { name: '', directorate: 'Yeni Md', rows: 3 }, CUW4: { name: '', directorate: '', rows: 1 } },
  };
  const out = M.overlay(runtime, master);
  assert.equal(out.mag.CU4E.mmyg, 'CUX4', 'taze kullanıcı gözlemi');
  assert.equal(out.mag.BGA.mmyg, 'BGA8', 'Ufuk dışındaki kod modelden');
  assert.equal(out.mag.BGA.source, 'model');
  assert.equal(out.mag.OLD1.mmyg, 'ST9', 'eski kullanıcı kaydı güncel modeli ezmez');
  assert.equal(out.mmyg.CUW4.name, 'ERKEK ÇOCUK', 'boş ad modelden tamamlanır');
  assert.equal(H.describe(out, 'mag', 'BGA').mmygName, 'KADIN AYAKKABI');
  assert.equal(M.overlay(runtime, null), runtime);
  assert.equal(M.overlay(null, master).mag.BGA.mmyg, 'BGA8');
});

test('yenileyici: 12 saat taze kalır, hata sonrası 30 dk denemez, aynı anda tek iş, kaynak kuramazsa nedenini söyler', async () => {
  let clock = Date.parse('2026-11-26T08:00:00Z'), queries = 0, stored = null, fail = false, release;
  const item = asas({ 'Merch Alt Grup Kod': col('Urun', 'MAG'), 'Merch Marka Yaş Grup Kod': col('Urun', 'MMYG') });
  const r = M.createMasterRefresher({
    loadConnections: () => [item], now: () => clock,
    runModelRows: async () => { queries += 1; if (fail) throw new Error('SSAS kapalı'); await new Promise(res => { release = res; }); return { rows: [['CU4E', 'CUW4']] }; },
    readFile: () => stored, writeFile: value => { stored = value; },
  });
  const a = r.ensure(), b = r.ensure();
  assert.equal(a, b, 'aynı anda tek iş');
  assert.equal(r.status().pending, true);
  release(); await a;
  assert.equal(queries, 1);
  assert.equal(stored.hierarchy.mag.CU4E.mmyg, 'CUW4');
  assert.equal(r.status().fresh, true);
  await r.ensure(); assert.equal(queries, 1, '12 saat içinde tekrar sorgu yok');
  clock += M.MAX_AGE_MS + 1; fail = true;
  await r.ensure(); assert.equal(queries, 2);
  assert.match(r.status().error, /SSAS kapalı/);
  assert.equal(stored.hierarchy.mag.CU4E.mmyg, 'CUW4', 'hata son başarılı eşlemeyi silmez');
  clock += 60 * 1000; await r.ensure(); assert.equal(queries, 2, 'hata sonrası 30 dk beklenir');
  const none = M.createMasterRefresher({ loadConnections: () => [], runModelRows: async () => ({ rows: [] }), readFile: () => null, writeFile: () => {} });
  await none.ensure(); assert.match(none.status().error, /bağlantısı yok/);
});

test('sunucu: uç model katmanını birleştirir, bayatsa arka planda tazeler; model yenilemesi sonrası tetiklenir; sürüm iki katmanı izler', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /merchMaster\.overlay\(runtime\.merchHierarchy, master && master\.hierarchy\)/);
  assert.match(server, /if \(!status\.fresh\) kickMerchMasterRefresh\(\)/);
  assert.match(server, /if \(asasMode === 'database'\) setImmediate\(kickMerchMasterRefresh\)/);
  assert.match(server, /merchHierarchyVersion: \[active\.merchHierarchy && active\.merchHierarchy\.builtAt \|\| '', merchMasterRefresher\.status\(\)\.builtAt \|\| ''\]\.join\('\|'\)/);
  assert.match(server, /path\.join\(SERVER_DATA_ROOT, 'merch-master\.json'\)/);
});
