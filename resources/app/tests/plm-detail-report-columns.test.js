'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const drawer = require('../public/detail-drawer.js');
const engine = require('../public/price-supplier-insights-engine.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

test('Alt detay raporu: PLM ID taşıyan satırlara PLM Kumaş ve PLM Artwork sütunu eklenir', () => {
  const rows = [{ orderCode: 'A1', plmId: '0101' }, { orderCode: 'A2', row: { 'PLM ID': '102', 'Fabric (PLM)': 'Orme,Süprem' } }];
  const details = { 101: { plmFabric: 'Orme,Jersey,150 gsm', plmArtwork: 'Ön: 1 | Toplam: 1', plmArtworkEn: 'Front: 1 | Total: 1' } };
  let en = false;
  const cols = drawer.includePlmDetailColumns(rows, [{ key: 'orderCode', label: 'Order' }], { isEn: () => en, lookup: id => details[id] || null });
  assert.deepEqual(cols.map(col => col.key), ['orderCode', 'plmFabric', 'plmArtwork']);
  const fabric = cols.find(col => col.key === 'plmFabric'), artwork = cols.find(col => col.key === 'plmArtwork');
  assert.equal(fabric.label, 'PLM Kumaş');
  assert.equal(fabric.value(rows[0]), 'Orme,Jersey,150 gsm', 'depo özeti PLM ID ile okunur');
  assert.equal(fabric.value(rows[1]), 'Orme,Süprem', 'satırın kendi PLM projeksiyonu önce gelir');
  assert.equal(artwork.value(rows[0]), 'Ön: 1 | Toplam: 1');
  en = true;
  assert.equal(artwork.value(rows[0]), 'Front: 1 | Total: 1', 'EN görünümde EN artwork metni');
});

test('Alt detay raporu: rapor zaten PLM sütunlarını taşıyorsa veya PLM ID yoksa sütun eklenmez', () => {
  const existing = [{ key: 'Fabric (PLM)', label: 'Fabric (PLM)' }, { key: 'Artwork Detail', label: 'Artwork Detail' }];
  assert.equal(drawer.includePlmDetailColumns([{ plmId: '5' }], existing, {}), existing);
  const plain = [{ key: 'orderCode' }];
  assert.equal(drawer.includePlmDetailColumns([{ orderCode: 'X' }], plain, {}), plain);
});

test('Ortak detay çekmecesi PLM özetini yalnız rapor açılınca ve salt okunur uçtan okur', () => {
  const js = read('detail-drawer.js');
  assert.match(js, /\/api\/plm-model-details\/batch/);
  assert.match(js, /if\(plmKeys\.length\)loadPlmDetailsFor\(active\)/);
  assert.match(js, /root\.BLPlmModelDetails=/);
});

test('Fiyat & Üretici Analizi: PLM kumaş ve artwork alanları filtre boyutudur', () => {
  for (const dim of ['plmFabric', 'plmArtwork', 'fabricCategory', 'kumasTipi', 'iplikNo', 'fabricWeight', 'karisim']) {
    assert.ok(engine.FILTER_DIMENSIONS.includes(dim), dim);
  }
  const dataset = engine.prepare([
    { price: 2, quantity: 10, season: '25S', manufacturer: 'M1', row: { plmFabric: 'Orme,Süprem', kumasTipi: 'Süprem' } },
    { price: 3, quantity: 10, season: '25S', manufacturer: 'M2', kumasTipi: 'Rib', row: {} },
  ]);
  assert.deepEqual(engine.dimensionValues(dataset, 'kumasTipi').sort(), ['Rib', 'Süprem']);
  const psa = read('price-supplier-analysis.js');
  assert.match(psa, /plmFabric:'PLM Kumaş'/);
  assert.match(psa, /plmFabric:'PLM Fabric'/);
  const app = read('app-main.js');
  assert.match(app, /async function priceAnalysisAttachPlmDetails\(result\)/);
});

test('LFL: PLM Kumaş / PLM Artwork filtre, kırılım ve detay sütunu olarak tanımlı', () => {
  const lfl = read('lfl.js'), html = read('index.html');
  assert.match(lfl, /plmFabric:\{label:'PLM Kumaş',labelEn:'PLM Fabric'/);
  assert.match(lfl, /plmArtwork:\{label:'PLM Artwork',labelEn:'PLM Artwork'/);
  assert.match(lfl, /plmFabric:\{tr:'PLM Kumaş',en:'PLM Fabric',rowKey:'plmFabric'\}/);
  assert.match(lfl, /\.\.\.plmDetailColumns\(\),/);
  assert.match(html, /id="lflDimBtn_plmFabric"/);
  assert.match(html, /id="lflDimBtn_plmArtwork"/);
});

test('Fiyat & Üretici: PLM Artwork filtre kimliği dilden bağımsız, EN yalnız etiketi çevirir', () => {
  const psa = read('price-supplier-analysis.js'), app = read('app-main.js');
  assert.match(psa, /function valueLabel\(dim,value\)/);
  assert.doesNotMatch(psa, /attributeFilter:\['lang'\]\}\);\n\s*function invalidate/);
  assert.match(app, /valueLabels:\{plmArtwork:\{en:artworkEn\}\}/);
  assert.match(app, /obs\.plmArtwork=details\.plmArtwork\|\|''/);
});
