'use strict';

/* P1 — LOJİSTİK SEGMENT GİRDİSİ ARTIMLI UYGULANMAZ (2026-11-27; ADR-0003 §6G bulgusu)
 *
 * Kök neden: applyIncrementalProjectionPatch Del. Type / Ex-factory yamasını satır hücresine yazar ama
 * _logisticSegments'i yeniden üretmez. Okuma modeli hazırlığı (overview-row-prep rebuildLogisticCaches)
 * Del. Type / Ant. Arrival / STATUS / HANDOVER değerlerini segmentten yeniden yazar → düzenleme sunucu
 * görünümünde geri döner (Uçak → Gemi) ve karar/pencereler eski değerle üretilir (bir sonraki tam kuruluma kadar).
 * Mevcut parite ve gölge testleri karşılaştırma tabanını aynı artımlı fonksiyonla kurduğu için kaçırmıştı.
 *
 * Düzeltme: tek merkezi kural (projection-row-patch.patchTouchesLogisticSegments) server.js
 * rowPatchIncrementalSafe içinde; bu kontrol canlı yamayı, projeksiyon önbelleği yeniden yazımını ve satır yaması
 * günlüğünü birlikte yönetir → böyle bir yama tam kurulum yoluna düşer.
 *
 * Bu testin beklenen değerleri ARTIMLI FONKSİYONDAN GEÇMEZ: tam kurulum (buildCPRowsFromASAS) ve alan kuralından
 * gelen açık değerler (Bangladeş transit: Gemi +70 gün, Uçak +15 gün) kullanılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');
const prep = require('../server/lib/read-model/overview-row-prep');
const { applyIncrementalProjectionPatch, patchTouchesLogisticSegments } = require('../server/lib/projection-row-patch');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const iso = value => (value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? null : String(value).slice(0, 10));
const overrides = () => ({ antrepoMatchConfig: parse.defaultAntrepoMatchConfig(), submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {}, pricingRules: [], transitRules: [], datemap: {} });
const asas = (ccode, extra = {}) => ({ 'Sipariş Kod': '4100001', 'Model Adı': 'MODEL-1', 'Renk Kod': ccode, 'Renk': 'SİYAH', 'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 3000, 'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6', 'Buyer Grup (TR)': 'BG', 'Siparişin Üretildiği Ülke': 'BANGLADES', 'Orijinal Exfactory Merch Tarih': '2026-01-01', 'Retail Depo Tarih Yıl Ay Gün': '2026-06-01', 'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15', ...extra });
const ias = (extra = {}) => ({ 'Sipariş Kod': '4100001', 'Ürün Ad': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-03-01', 'HANDOVER Tarihi': '2026-02-20', 'Vasita Tanim': 'Gemi', 'Yükleme Toplam Adet': 3000, 'Net Alım Sipariş Miktarı': 10000, 'İthalat Dosya No': 'IMP-1', 'Konteyner No': 'CONT-1', 'Gemi Ad': 'MSC', ...extra });
const KEY_C01 = parse.rowLineKey({ 'Order Code': 4100001, 'Model Name': 'MODEL-1', 'C.Code': 'C01' });

// Tam kurulum: sunucunun kaynak + override'lardan ürettiği tek doğru satırlar (artımlı yol yok).
function fullBuild(ov, { colours = ['C01'], iasRows = [] } = {}) {
  const orders = parse.parseASASRows(colours.map(c => asas(c)), ov.antrepoMatchConfig).orders;
  const map = iasRows.length ? parse.parseAntrepoRows(iasRows, ov.antrepoMatchConfig) : {};
  return parse.buildCPRowsFromASAS(parse.applyDateOverrides(orders, ov), map, ov);
}
const seg = row => (row._logisticSegments || []).map(s => [s.kind, s.delType, iso(s.arrival)]);

test('merkezi kural: yalnız lojistik segment girdisi (Del. Type, Ex-factory) artımlı uygulanmaz', () => {
  assert.equal(patchTouchesLogisticSegments({ delType: 'Uçak' }), true);
  assert.equal(patchTouchesLogisticSegments({ delType: '' }), true, 'clearing is also a change of the input');
  assert.equal(patchTouchesLogisticSegments({ dates: { exFactory: '2026-02-01' } }), true);
  assert.equal(patchTouchesLogisticSegments({ dates: { retailDate: '2026-06-10' } }), false, 'Retail is not a segment input');
  assert.equal(patchTouchesLogisticSegments({ dates: { inStoreDate: '2026-06-20' } }), false, 'In-Store is not a segment input');
  for (const patch of [{ suppFob: 9.2 }, { notes: { Notes: 'x' } }, { importance: 'A' }, { noteColumns: { c1: 'x' } }, null]) assert.equal(patchTouchesLogisticSegments(patch), false);
});

test('kaynak sözleşmesi: kural tek yerde, canlı yama / projeksiyon önbelleği / satır yaması günlüğü aynı kontrolden geçer', () => {
  const fn = SERVER.slice(SERVER.indexOf('function rowPatchIncrementalSafe('), SERVER.indexOf('function liveRowPatchesFor('));
  assert.match(fn, /patchTouchesLogisticSegments\(patch\)\) return false;/);
  assert.match(SERVER.slice(SERVER.indexOf('function liveRowPatchesFor('), SERVER.indexOf('function liveRowPatchesFor(') + 600), /rowPatchIncrementalSafe\(item\.patch\)/);
  assert.match(SERVER.slice(SERVER.indexOf('async function rewriteProjectionCacheForRowPatches('), SERVER.indexOf('async function rewriteProjectionCacheForRowPatches(') + 400), /rowPatchIncrementalSafe\(item\.patch\)/);
  assert.match(SERVER.slice(SERVER.indexOf('function recordCpRowPatches('), SERVER.indexOf('function recordCpRowPatches(') + 600), /safe:rowPatchIncrementalSafe/);
  // Aynı güvenlik koşulu başka bir çağrı noktasında yeniden tanımlanmaz.
  assert.equal((SERVER.match(/patchTouchesLogisticSegments/g) || []).length, 1);
});

test('artımlı yol bu girdilerde yanlış sonuç üretir (kuralın gerekçesi): tam kurulum Uçak, artımlı + hazırlık Gemi', () => {
  const ov = overrides();
  const before = fullBuild(ov)[0];
  ov.delmap[KEY_C01] = 'Uçak';
  const truth = fullBuild(ov)[0];
  const incremental = JSON.parse(JSON.stringify(before));
  applyIncrementalProjectionPatch(incremental, { delType: 'Uçak', model: 'MODEL-1', ccode: 'C01' }, ov, true, {});
  prep.prepareCpRows([incremental]);
  assert.equal(truth['Del. Type'], 'Uçak');
  assert.equal(incremental['Del. Type'], 'Gemi', 'incremental path reverts the edit — must not be used for this patch');
});

test('tam kurulum — yalnız üretim: Del. Type ve Ex-factory düzenlemesi segmente ve satıra açık değerlerle yansır', () => {
  const ov = overrides();
  let [row] = fullBuild(ov);
  assert.deepEqual([row['Del. Type'], iso(row['Ant. Arrival']), row.STATUS], ['Gemi', '2026-03-12', 'Üretimde']); // 01.01 + 70 gün
  ov.delmap[KEY_C01] = 'Uçak';
  [row] = fullBuild(ov);
  assert.deepEqual([row['Del. Type'], iso(row['Ant. Arrival'])], ['Uçak', '2026-01-16']); // 01.01 + 15 gün
  assert.deepEqual(seg(row), [['production', 'Uçak', '2026-01-16']]);
  ov.delmap = {}; ov.datemap[KEY_C01] = { ex: '2026-02-01' };
  [row] = fullBuild(ov);
  assert.deepEqual([iso(row['Ex-factory']), row['Del. Type'], iso(row['Ant. Arrival'])], ['2026-02-01', 'Gemi', '2026-04-12']); // 01.02 + 70 gün
  // Geri döndürme / temizleme: override kalkınca ASAS değerine döner.
  ov.datemap = {};
  [row] = fullBuild(ov);
  assert.deepEqual([iso(row['Ex-factory']), row['Del. Type'], iso(row['Ant. Arrival'])], ['2026-01-01', 'Gemi', '2026-03-12']);
});

test('tam kurulum — yüklenmiş parsiyeller + üretim bakiyesi: kullanıcı düzenlemesi gerçekleşmiş sevkiyatı değiştirmez', () => {
  const ov = overrides();
  const iasRows = [ias(), ias({ 'İthalat Dosya No': 'IMP-2', 'Konteyner No': 'CONT-2', 'Supplier Portal Statü': 'Depoda', 'Yükleme Toplam Adet': 2000, 'Vasita Tanim': 'Uçak', 'Tahmini Antrepo Giriş Tarihi': '2026-02-10' })];
  ov.delmap[KEY_C01] = 'Uçak'; ov.datemap[KEY_C01] = { ex: '2026-02-01' };
  const [row] = fullBuild(ov, { iasRows });
  const production = row._logisticSegments.filter(s => s.kind === 'production');
  const partials = row._logisticSegments.filter(s => s.kind === 'partial').map(s => [s.delType, iso(s.arrival), s.status]).sort();
  assert.deepEqual(production.map(s => [s.delType, iso(s.arrival)]), [['Uçak', '2026-02-16']], 'only the remaining production balance follows the edit (01.02 + 15)');
  assert.deepEqual(partials, [['Gemi', '2026-03-01', 'Yol Operasyonları'], ['Uçak', '2026-02-10', 'Depoda']], 'loaded IAS partials keep source values');
});

test('tam kurulum — aynı siparişin farklı renkleri: düzenleme yalnız ilgili renk satırına uygulanır; CP ve Siparişler aynı değeri taşır', () => {
  const ov = overrides();
  ov.delmap[KEY_C01] = 'Uçak';
  const orders = parse.parseASASRows([asas('C01'), asas('C02')], ov.antrepoMatchConfig).orders;
  const { cp, orders: orderRows } = parse.buildSharedOrderProjectionRowsFromASAS(parse.applyDateOverrides(orders, ov), {}, ov);
  const pick = (rows, c) => rows.find(r => r['C.Code'] === c);
  assert.deepEqual([pick(cp, 'C01')['Del. Type'], iso(pick(cp, 'C01')['Ant. Arrival'])], ['Uçak', '2026-01-16']);
  assert.deepEqual([pick(cp, 'C02')['Del. Type'], iso(pick(cp, 'C02')['Ant. Arrival'])], ['Gemi', '2026-03-12']);
  for (const c of ['C01', 'C02']) assert.equal(pick(orderRows, c)['Del. Type'], pick(cp, c)['Del. Type']);
});

test('tam kurulum + okuma modeli hazırlığı yalnız üretim satırında aynı değeri korur (kapanış/yeniden açılış = tam kurulum)', () => {
  const ov = overrides();
  ov.delmap[KEY_C01] = 'Uçak';
  const [row] = fullBuild(ov);
  const reopened = JSON.parse(JSON.stringify(row));
  prep.prepareCpRows([reopened]);
  assert.deepEqual([reopened['Del. Type'], iso(reopened['Ant. Arrival']), reopened.STATUS], ['Uçak', '2026-01-16', 'Üretimde']);
});

/* AYRI BULGU (iş kuralı kararı gerekir; bu düzeltmenin kapsamı dışında): parsiyel + üretim bakiyesi birlikteyken
   "birincil segment" iki yerde farklı tanımlı. Tam kurulum (parse.js) ilk kıtlık-dışı segmenti (üretim) alır →
   STATUS Üretimde; okuma modeli hazırlığı ve istemci (rebuildLogisticCaches / rebuildCpLogisticCaches) partials[0]
   alır → STATUS Yol Operasyonları. Yamasız tam kurulum satırında bile hazırlık STATUS / Ant. Arrival'ı değiştirir. */
test.todo('birincil segment tanımı tam kurulum ile okuma modeli hazırlığında aynı olmalı (iş kuralı teyidi bekleniyor)');
