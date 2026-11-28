'use strict';

/* BL-028 · DEL. TYPE "KAYNAĞA DÖN" — SUNUCU (2026-11-28)
 *
 * "Kaynağa dön" boş ya da "Gemi" kaydetmek DEĞİLDİR: satırın manuel Del. Type override'ı (satır anahtarı) silinir,
 * değer kaynak önceliğiyle yeniden hesaplanır (parse.js backlogProductionDelType: satır anahtarı → sipariş anahtarı →
 * sistem varsayılanı Gemi). Gövde `delType: null` taşır; iki kayıt yolu (PATCH/batch ve POST /rows) yalnız o satırın
 * anahtarını siler, paylaşılan depoya `delivery: null` yansır, diğer renklerin override'ı ve IAS parsiyelleri değişmez.
 * Satır kimliği olmadan null kabul edilmez: sipariş anahtarını silmek diğer renkleri etkiler.
 *
 * Beklenen değerler artımlı fonksiyondan geçmez: tam kurulum (buildCPRowsFromASAS) ve alan kuralı
 * (Bangladeş transit: Gemi +70 gün, Uçak +15 gün, Ex-factory 2026-01-01).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-deltype-revert-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server-data'), BUYER_LOG_DATA_ROOT: path.join(root, 'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local-data'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});
const db = require('../server/db');
const parse = require('../server/lib/parse');
const cpSharedStore = require('../server/lib/cp-shared-store');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const iso = value => (value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? null : String(value).slice(0, 10));
const asas = (code, ccode) => ({ 'Sipariş Kod': String(code), 'Model Adı': 'MODEL-1', 'Renk Kod': ccode, 'Renk': 'SİYAH', 'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 3000, 'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6', 'Buyer Grup (TR)': 'BG', 'Siparişin Üretildiği Ülke': 'BANGLADES', 'Orijinal Exfactory Merch Tarih': '2026-01-01', 'Retail Depo Tarih Yıl Ay Gün': '2026-06-01', 'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15' });
const ias = code => ({ 'Sipariş Kod': String(code), 'Ürün Ad': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-03-01', 'HANDOVER Tarihi': '2026-02-20', 'Vasita Tanim': 'Gemi', 'Yükleme Toplam Adet': 3000, 'Net Alım Sipariş Miktarı': 10000, 'İthalat Dosya No': 'IMP-1', 'Konteyner No': 'CONT-1', 'Gemi Ad': 'MSC' });
// Tam kurulum: kayıtlı override belgesi + kaynak → sunucunun ürettiği satırlar.
function fullBuild(code, { partial = false } = {}) {
  const ov = { ...db.loadOverrides(), antrepoMatchConfig: parse.defaultAntrepoMatchConfig(), transitRules: [] };
  const orders = parse.parseASASRows([asas(code, 'C01'), asas(code, 'C02')], ov.antrepoMatchConfig).orders;
  const map = partial ? parse.parseAntrepoRows([ias(code)], ov.antrepoMatchConfig) : {};
  const rows = parse.buildCPRowsFromASAS(parse.applyDateOverrides(orders, ov), map, ov);
  const of = ccode => rows.find(row => row['C.Code'] === ccode);
  const seg = row => row._logisticSegments.map(s => [s.kind, s.delType, iso(s.arrival)]).sort();
  return { C01: of('C01'), C02: of('C02'), seg };
}
const lineKey = (code, ccode) => db.overrideWriteKey(code, { model: 'MODEL-1', ccode });
const line = ccode => ({ model: 'MODEL-1', ccode });
const rev = () => Number(db.loadOverrides()._revisions.orders) || 0;

test('eski PATCH: satır override\'ı silinir → üretim kaynak varsayılanı Gemi, Ant. Arrival = Ex-factory + 70; diğer renk korunur', () => {
  const code = 4200001;
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  db.patchOrderOverride(code, { ...line('C02'), delType: 'Gemi+Tır' }, rev());
  let built = fullBuild(code);
  assert.deepEqual(built.seg(built.C01), [['production', 'Uçak', '2026-01-16']], 'override applied (01.01 + 15)');
  const saved = db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev());
  assert.equal(Object.hasOwn(saved.overrides.delmap, lineKey(code, 'C01')), false, 'line key removed, not stored as "" or "Gemi"');
  assert.equal(saved.overrides.delmap[lineKey(code, 'C02')], 'Gemi+Tır', 'other colour untouched');
  built = fullBuild(code);
  assert.deepEqual(built.seg(built.C01), [['production', 'Gemi', '2026-03-12']], 'source priority: system default Gemi (01.01 + 70)');
  assert.equal(built.C01['Del. Type'], 'Gemi');
  assert.equal(iso(built.C01['Ant. Arrival']), '2026-03-12');
  assert.equal(built.C02['Del. Type'], 'Gemi+Tır');
});

test('toplu /batch yolu (patchOrderOverrides) aynı temizlemeyi yapar', () => {
  const code = 4200002;
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  db.patchOrderOverrides([{ orderCode: code, patch: { ...line('C01'), delType: null } }], rev());
  assert.equal(Object.hasOwn(db.loadOverrides().delmap, lineKey(code, 'C01')), false);
});

test('POST /rows: null yalnız satır anahtarını siler; current kaynağa döner; tekrar (idempotent) çakışma değildir', () => {
  const code = 4200003;
  db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: 'Uçak' }, base: {} }]);
  db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C02'), delType: 'Gemi+Tır' }, base: {} }]);
  const result = db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: null }, base: { delType: 'Uçak' } }]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.updated, 1);
  assert.equal(Object.hasOwn(result.applied[0].current, 'delType'), false, 'no stored value after revert');
  const ov = db.loadOverrides();
  assert.equal(Object.hasOwn(ov.delmap, lineKey(code, 'C01')), false);
  assert.equal(ov.delmap[lineKey(code, 'C02')], 'Gemi+Tır');
  const again = db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: null }, base: { delType: 'Uçak' } }]);
  assert.deepEqual(again.conflicts, []);
  assert.equal(again.updated, 0, 'already at source: no write');
});

test('POST /rows: başka kullanıcının değeri ezilmez (bayat base → çakışma, değer korunur)', () => {
  const code = 4200004;
  db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: 'Uçak' }, base: {} }]);
  // Kullanıcı B aynı satırı Gemi+Uçak yaptı; kullanıcı A eski görüntüsüyle (Uçak) "Kaynağa dön" gönderir.
  db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: 'Gemi+Uçak' }, base: { delType: 'Uçak' } }]);
  const stale = db.patchOrderOverrideRows([{ orderCode: code, patch: { ...line('C01'), delType: null }, base: { delType: 'Uçak' } }]);
  assert.equal(stale.updated, 0);
  assert.deepEqual(stale.conflicts[0].fields, ['delType']);
  assert.equal(stale.conflicts[0].current.delType, 'Gemi+Uçak');
  assert.equal(db.loadOverrides().delmap[lineKey(code, 'C01')], 'Gemi+Uçak');
});

test('eski PATCH: bayat revizyonla temizleme reddedilir (global CAS), değer korunur', () => {
  const code = 4200005;
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  const stale = rev();
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Gemi+Uçak' }, rev());
  assert.throws(() => db.patchOrderOverride(code, { ...line('C01'), delType: null }, stale), error => error.code === 'REVISION_CONFLICT');
  assert.equal(db.loadOverrides().delmap[lineKey(code, 'C01')], 'Gemi+Uçak');
});

test('satır kimliği olmadan null reddedilir: sipariş anahtarı silinmez (diğer renkler etkilenmez)', () => {
  const code = 4200006;
  db.patchOrderOverride(code, { delType: 'Uçak' }, rev()); // eski biçim: sipariş anahtarı
  assert.throws(() => db.patchOrderOverride(code, { delType: null }, rev()), error => error.code === 'VALIDATION_ERROR' && error.statusCode === 400);
  assert.equal(db.loadOverrides().delmap[String(code)], 'Uçak');
});

test('geri al: önceki override açık değerle yeniden yazılır; yinele yeniden temizler', () => {
  const code = 4200007;
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev());
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev()); // geri al
  let built = fullBuild(code);
  assert.deepEqual(built.seg(built.C01), [['production', 'Uçak', '2026-01-16']]);
  db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev()); // yinele
  built = fullBuild(code);
  assert.deepEqual(built.seg(built.C01), [['production', 'Gemi', '2026-03-12']]);
});

test('IAS parsiyeli satır: temizleme yalnız üretim bakiyesini kaynağa döndürür; parsiyel değişmez', () => {
  const code = 4200008;
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  let built = fullBuild(code, { partial: true });
  const partialBefore = built.C01._logisticSegments.filter(s => s.kind === 'partial').map(s => [s.delType, iso(s.arrival), s.status]);
  assert.deepEqual(built.C01._logisticSegments.filter(s => s.kind === 'production').map(s => s.delType), ['Uçak']);
  db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev());
  built = fullBuild(code, { partial: true });
  assert.deepEqual(built.C01._logisticSegments.filter(s => s.kind === 'production').map(s => [s.delType, iso(s.arrival)]), [['Gemi', '2026-03-12']]);
  assert.deepEqual(built.C01._logisticSegments.filter(s => s.kind === 'partial').map(s => [s.delType, iso(s.arrival), s.status]), partialBefore);
});

test('sipariş anahtarlı eski override: satır temizliği onu görünür kılar (kaynak önceliği); veri yenilemesi temizliği kaldırır, diğer rengin satır override\'ı kalır', () => {
  const code = 4200009;
  db.patchOrderOverride(code, { delType: 'Gemi+Uçak' }, rev()); // eski sürümden kalma sipariş anahtarı
  db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  db.patchOrderOverride(code, { ...line('C02'), delType: 'Gemi+Tır' }, rev());
  db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev());
  let built = fullBuild(code);
  assert.equal(built.C01['Del. Type'], 'Gemi+Uçak', 'documented: order-level legacy value is next in source priority');
  // Her başarılı veri yenilemesinden sonra server.js etkin siparişlerin sipariş anahtarlarını siler.
  db.clearDeliveryOverridesForOrders([code]);
  built = fullBuild(code);
  assert.equal(built.C01['Del. Type'], 'Gemi');
  assert.equal(built.C02['Del. Type'], 'Gemi+Tır', 'other colour line override survives the refresh cleanup');
});

test('paylaşılan depo yansıması: temizlenen satır delivery:null alır (alan mezar taşı; overlay haritadan siler)', () => {
  const code = 4200010, key = lineKey(code, 'C01');
  const saved = db.patchOrderOverride(code, { ...line('C01'), delType: 'Uçak' }, rev());
  assert.deepEqual(cpSharedStore.patchFromOrderPatch(saved.overrides, key, { ...line('C01'), delType: 'Uçak' }), { delivery: 'Uçak' });
  const cleared = db.patchOrderOverride(code, { ...line('C01'), delType: null }, rev());
  assert.deepEqual(cpSharedStore.patchFromOrderPatch(cleared.overrides, key, { ...line('C01'), delType: null }), { delivery: null });
});
