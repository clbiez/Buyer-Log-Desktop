'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

function iasRow(overrides = {}) {
  return {
    'Sipariş Kod': '1234567.00',
    'Ürün Ad': 'MODEL-A',
    'Renk Kod': 'C01',
    'Supplier Portal Statü': 'Yol Operasyonları',
    'Tahmini Antrepo Giriş Tarihi': '2026-08-20',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 100,
    ...overrides,
  };
}

test('v4.45 varsayılan ASAS - IAS kuralı yalnız Sipariş Kod + Model/Ürün Ad + Renk Kod üçlüsüdür', () => {
  const config = parse.defaultAntrepoMatchConfig();
  assert.deepStrictEqual(config.conditions.map(item => [
    item.asas.canonicalHeader || item.asas.header,
    item.ias.canonicalHeader || item.ias.header,
  ]), [
    ['Sipariş Kod', 'Sipariş Kod'],
    ['Model Adı', 'Ürün Ad'],
    ['Renk Kod', 'Renk Kod'],
  ]);
});

test('v4.45 Excel ve Data Model sipariş kodu gösterimleri eşleşir, model ve renk kodu birebir kalır', () => {
  const map = parse.parseAntrepoRows([iasRow()]);
  assert.ok(parse.findAntrepoHit(map, { ocode: 1234567, model: 'MODEL-A', ccode: 'C01' }));
  assert.ok(parse.findAntrepoHit(map, { ocode: '1.234.567', model: 'MODEL-A', ccode: 'C01' }));
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 1234567, model: 'model-a', ccode: 'C01' }), null);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 1234567, model: 'MODEL-A', ccode: 'c01' }), null);
});

test('v4.45 Antrepo Excel satırları parsiyel bazında korunur', () => {
  const map = parse.parseAntrepoRows([
    iasRow({ 'Yükleme Toplam Adet': 100, 'Vasita Tanim': 'Gemi' }),
    iasRow({ 'Yükleme Toplam Adet': 200, 'Vasita Tanim': 'Tır', 'Tahmini Antrepo Giriş Tarihi': '2026-08-25' }),
  ]);
  const hits = parse.findAntrepoHits(map, { ocode: 1234567, model: 'MODEL-A', ccode: 'C01' });
  assert.strictEqual(hits.length, 2);
  assert.deepStrictEqual(hits.map(item => [item.loadedQty, item.vasita]), [[100, 'Gemi'], [200, 'Tır']]);
});

test('v4.45 Antrepo ana kaynağı Excel, Database ise açıkça seçilen opsiyondur', () => {
  const dbText = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  const serverText = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const refreshText = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-refresh.js'), 'utf8');
  assert.match(dbText, /antrepoSourceMode:\s*'excel'/);
  assert.match(serverText, /includeAntrepo:\s*antrepoMode === 'database'/);
  assert.match(serverText, /loadAntrepoFromExcel\(id, matchRule, \{[\s\S]{0,260}?refreshBeforeRead: true/);
  assert.match(refreshText, /options\.includeAntrepo !== false/);
});

test('v4.45 Source, Matching Rule ve Data Model ekranları pahalı şemayı açılışta taramaz', () => {
  const modelQuery = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'modelQuery.js'), 'utf8');
  const serverText = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /* v7.81: eşleştirme kuralı ekranı eski bağlantı modalından Veri Yönetimi'ne
     taşındı. Korunan kusur aynı — açılışta tam şema taranmamalı; "Tüm sütunları
     getir" kullanıcının bilinçli olarak ödediği bir bedeldir. */
  const matchRule = fs.readFileSync(path.join(ROOT, 'public', 'data-management-matchrule.js'), 'utf8');
  assert.match(matchRule, /await fetchState\(\);/, 'açılış tam şema istemeden yüklemeli');
  assert.doesNotMatch(matchRule, /await fetchState\(\{ full: true \}\);\s*\r?\n\s*\}\s*\r?\n\s*async function open/, 'açılışta full taranmamalı');
  assert.match(matchRule, /data-full/, 'tam şema ayrı ve isteğe bağlı bir eylem olmalı');
  /* v7.82: dönüş şekli kaynak kataloğuna taşındı (connection artık katalog
     girdisinde). KORUNAN KUSUR AYNI: options.full verilmedikçe discoverSchema
     çağrılmaz, yalnız kayıtlı alan eşlemesi kullanılır. */
  assert.match(serverText, /if \(!options\.full\) return \{ columns: fallback, error: '', authoritative: false \}/);
  assert.match(modelQuery, /METADATA_CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(serverText, /MODEL_DISTINCT_CACHE_TTL_MS = 5 \* 60 \* 1000/);
});
