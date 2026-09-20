'use strict';
/*
 * v4.27 — Ön maliyetin formülleriyle Excel'e aktarılması ve geri alınması.
 *
 * Eski dışa aktarım hesaplanmış SAYILAR yazıyordu: Excel'de bir tüketim ya da
 * birim fiyat değiştirildiğinde hiçbir şey güncellenmiyor, dosya bir ekran
 * görüntüsü gibi davranıyordu. Artık satır toplamları, grup ara toplamları ve
 * bütün özet zinciri formüldür.
 *
 * Geri alma, her anlamlı satıra yazılan görünmez ANAHTAR sütununa dayanır; satır
 * sırası veya araya eklenen satırlar önemli değildir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-costing.js'), 'utf-8');
const HTML = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));

const SECTION_KEYS = ['fabric', 'labor', 'accessories', 'printEmbroidery', 'specialProcess', 'washing', 'packaging', 'testing', 'other'];
const RATE_KEYS = ['productionWastePct', 'overheadPct', 'financePct', 'profitPct'];

// ocRecordFromKeyedRows saf bir fonksiyon: bağımlılıklarını taklit ederek yükle.
function loadMapper() {
  const match = SRC.match(/function ocRecordFromKeyedRows\(keyed,existingRecords\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'ocRecordFromKeyedRows bulunamadı');
  const SECTION_DEFS = SECTION_KEYS.map(key => ({ key }));
  const clone = value => JSON.parse(JSON.stringify(value));
  const emptyRow = (currency = 'USD') => ({
    id: 'row', item: '', details: '', supplier: '', unit: 'adet',
    qty: '', unitPrice: '', currency, _currencyAuto: true, wastePct: '',
  });
  const normalizeRecord = raw => {
    const r = clone(raw || {});
    r.title = r.title || '';
    r.meta = Object.assign({ currency: 'USD', fxMonth: '', quantity: 0, targetFob: 0 }, r.meta || {});
    r.rates = Object.assign({ productionWastePct: 0, overheadPct: 0, financePct: 0, profitPct: 0 }, r.rates || {});
    r.sections = r.sections || {};
    SECTION_KEYS.forEach(k => { r.sections[k] = r.sections[k] || []; });
    return r;
  };
  const currentMonthKey = () => '2026-08';
  return new Function('SECTION_DEFS', 'clone', 'emptyRow', 'normalizeRecord', 'currentMonthKey',
    `return (${match[0]})`)(SECTION_DEFS, clone, emptyRow, normalizeRecord, currentMonthKey);
}

const row = cells => { const r = new Array(10).fill(null); cells.forEach((v, i) => { r[i] = v; }); return r; };

function keyedFile(extra) {
  return [
    { key: 'META:title', row: row(['Maliyet Adı', 'Kışlık Kazak']) },
    { key: 'META:modelCode', row: row(['Model', 'KZ-1001']) },
    { key: 'META:currency', row: row(['Para Birimi', 'USD']) },
    { key: 'META:fxMonth', row: row(['Kur Ayı', '2026-07']) },
    { key: 'META:quantity', row: row(['Adet', 5000]) },
    { key: 'META:targetFob', row: row(['Hedef FOB', 9.5]) },
    { key: 'RATE:overheadPct', row: row(['Genel Gider', 0.08]) },
    { key: 'LINE:fabric', row: row(['Kumaş', 'Ana kumaş', 'Süprem', 'kg', 0.55, 6.2, 'USD', 0.03]) },
    { key: 'LINE:labor', row: row(['İşçilik', 'CMT', '', 'adet', 1, 1.75, 'EUR', 0]) },
  ].concat(extra || []);
}

test('meta alanları anahtara göre okunur', () => {
  const { record } = loadMapper()(keyedFile(), []);
  assert.strictEqual(record.title, 'Kışlık Kazak');
  assert.strictEqual(record.meta.modelCode, 'KZ-1001');
  assert.strictEqual(record.meta.quantity, 5000);
  assert.strictEqual(record.meta.targetFob, 9.5);
  assert.strictEqual(record.meta.fxMonth, '2026-07');
});

test('yüzdeler kesirden yüzdeye çevrilir', () => {
  // Excel yüzde hücresini 0,08 olarak tutar; uygulama 8 bekler.
  const { record } = loadMapper()(keyedFile(), []);
  assert.strictEqual(record.rates.overheadPct, 8);
});

test('satırlar doğru gruba yazılır', () => {
  const { record } = loadMapper()(keyedFile(), []);
  assert.strictEqual(record.sections.fabric.length, 1);
  assert.strictEqual(record.sections.labor.length, 1);
  assert.strictEqual(record.sections.accessories.length, 0);
  const fabric = record.sections.fabric[0];
  assert.strictEqual(fabric.item, 'Ana kumaş');
  assert.strictEqual(fabric.qty, 0.55);
  assert.strictEqual(fabric.unitPrice, 6.2);
  assert.strictEqual(fabric.currency, 'USD');
  assert.strictEqual(fabric.wastePct, 3);
  assert.strictEqual(record.sections.labor[0].currency, 'EUR', 'satır para birimi korunmalı');
});

test('satır sırası önemli değildir, yalnız anahtar sayılır', () => {
  const shuffled = keyedFile().slice().reverse();
  const { record } = loadMapper()(shuffled, []);
  assert.strictEqual(record.title, 'Kışlık Kazak');
  assert.strictEqual(record.sections.fabric.length, 1);
});

test('Excel\'de eklenen satır da içe aktarılır', () => {
  const withExtra = keyedFile([{ key: 'LINE:fabric', row: row(['Kumaş', 'Ribana', '', 'kg', 0.1, 5, 'USD', 0]) }]);
  const { record } = loadMapper()(withExtra, []);
  assert.strictEqual(record.sections.fabric.length, 2);
  assert.strictEqual(record.sections.fabric[1].item, 'Ribana');
});

test('dosyadaki kimlik mevcut kayda aitse o kayıt taban alınır', () => {
  const existing = { id: 'oc_1', title: 'Eski', meta: { image: 'veri', currency: 'USD' }, rates: {}, sections: {} };
  const file = keyedFile([{ key: 'ID:record', row: row(['Kimlik', 'oc_1']) }]);
  const { record, existing: found } = loadMapper()(file, [existing]);
  assert.ok(found, 'kayıt bulunmalı');
  assert.strictEqual(record.meta.image, 'veri', 'Excel\'de taşınmayan alanlar korunmalı');
  assert.strictEqual(record.title, 'Kışlık Kazak', 'dosyadaki değerler üzerine yazmalı');
});

test('kimlik yoksa yeni kayıt kurulur, başka kayıt ezilmez', () => {
  const existing = { id: 'oc_1', title: 'Eski', meta: {}, rates: {}, sections: {} };
  const { existing: found } = loadMapper()(keyedFile(), [existing]);
  assert.strictEqual(found, null);
});

test('geçersiz kur ayı güvenli değere düşer', () => {
  const file = keyedFile().filter(k => k.key !== 'META:fxMonth')
    .concat([{ key: 'META:fxMonth', row: row(['Kur Ayı', 'temmuz']) }]);
  const { record } = loadMapper()(file, []);
  assert.match(record.meta.fxMonth, /^\d{4}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// Dışa aktarım: formüller
// ---------------------------------------------------------------------------

test('satır toplamı sayı değil formüldür', () => {
  assert.ok(/E\$\{R\(i\)\}\*F\$\{R\(i\)\}\*\(1\+H\$\{R\(i\)\}\)/.test(SRC),
    'satır toplamı tüketim × birim fiyat × (1 + fire) formülü olmalı');
  assert.ok(SRC.includes('VLOOKUP(G'), 'döviz çevrimi kur sayfasından okunmalı');
});

test('ara toplamlar ve özet zinciri formüldür', () => {
  assert.ok(/SUM\(I\$\{R\(first\)\}:I\$\{R\(last\)\}\)/.test(SRC), 'grup ara toplamı SUM olmalı');
  assert.ok(SRC.includes('`B${R(baseRow)}*B${R(amount)}`'), 'oran tutarı önceki ara toplamdan hesaplanmalı');
  assert.ok(SRC.includes('`B${R(baseRow)}+C${R(amount)}`'), 'zincir bir önceki adıma bağlanmalı');
  assert.ok(SRC.includes('ROUND(B${R(fobRow)}*B${R(qtyRow)},2)'), 'toplam sipariş maliyeti formül olmalı');
});

test('kur sayfası ve gizli anahtar sütunu yazılıyor', () => {
  assert.ok(SRC.includes("OC_SHEET_FX='Kurlar'"), 'kur sayfası olmalı');
  assert.ok(SRC.includes('hidden:true'), 'anahtar sütunu gizlenmeli');
  assert.ok(SRC.includes('OC_KEY_COL=9'), 'anahtar sütunu J olmalı');
});

test('biçimlendirme korunuyor', () => {
  for (const bit of ['fgColor', "z='#,##0.00'", "z='0.00%'", "!merges", "!cols"]) {
    assert.ok(SRC.includes(bit), `${bit} dışa aktarımda olmalı`);
  }
});

test('içeri ve dışarı aktar düğmeleri var', () => {
  assert.ok(HTML.includes('id="ocImportBtn"'), 'içeri aktar düğmesi olmalı');
  assert.ok(HTML.includes('id="ocImportFile"'), 'dosya seçici olmalı');
  assert.ok(HTML.includes('id="ocExportBtn"'), 'dışarı aktar düğmesi olmalı');
  assert.ok(SRC.includes("$('ocImportBtn')"), 'içeri aktar bağlanmalı');
});

test('içe aktarım doğrudan kaydetmiyor', () => {
  const fn = SRC.match(/async function importExcel\(file\)\{[\s\S]*?\n\}/)[0];
  assert.ok(fn.includes('setDirty(true)'), 'değişiklik kaydedilmemiş olarak işaretlenmeli');
  assert.ok(!/request\(/.test(fn), 'kullanıcı Kaydet demeden sunucuya yazılmamalı');
});
