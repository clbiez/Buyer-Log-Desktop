'use strict';

/*
 * v7.23 — KULLANICIYA ÖZGÜ SAYFALAR
 *
 * NOT (v7.81): bu dosya eskiden Horizon ön ayarlarını da sınıyordu. Ön ayar
 * özelliği kullanıcının kararıyla KALDIRILDI (görünmeyen bir katman olarak
 * Veri Yönetimi'ndeki ortak filtreyi eziyordu); o testler silindi, aşağıdaki
 * nakliye izolasyonu testleri olduğu gibi duruyor.
 *
 * Kullanıcı talepleri (saha, birebir):
 *   · "Overview, OAB, Koleksiyon, Orders ve CP sayfaları dışındaki tüm sayfalar
 *      kullanıcıya özgü alanlardır. Oluşturulan otomasyonlar, shipping
 *      comparisonlar, backlog ve LFL'ler her kullanıcının ekranında özel
 *      olmalıdır, diğer kullanıcılar görmemeli."
 *
 * Bu testlerin çivilediği davranış: nakliye kıyaslaması kullanıcıya özgüdür
 * AMA eski paylaşılan dosyadaki satırlar KAYBOLMAZ (§142). Sahibi bilinmeyen
 * satırlara uydurma sahip atanmaz; devralma ilk yazmada olur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v723-scope-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const db = require('../server/db');

/* ------------------------------------------- 1) NAKLİYE KIYASLAMASI İZOLASYONU */

test('v7.23 nakliye satırları kullanıcıya özgüdür; başkasının ekranına yansımaz', () => {
  db.addShippingRows([{ orderCode: 111, note: 'ayse' }], null, 'ayse');
  db.addShippingRows([{ orderCode: 222, note: 'mehmet' }], null, 'mehmet');
  const ayse = db.loadShipping('ayse'), mehmet = db.loadShipping('mehmet');
  assert.deepEqual(ayse.rows.map(row => row.note), ['ayse']);
  assert.deepEqual(mehmet.rows.map(row => row.note), ['mehmet']);
});

test('v7.23 bir kullanıcının silmesi diğerinin satırını silmez', () => {
  const ayse = db.loadShipping('ayse');
  db.deleteShippingRows(ayse.rows.map(row => row._shipId), ayse._revision, 'ayse');
  assert.deepEqual(db.loadShipping('ayse').rows, []);
  assert.equal(db.loadShipping('mehmet').rows.length, 1, 'başka kullanıcının verisi etkilenmemeli');
});

test('v7.23 ESKİ paylaşılan satırlar kaybolmaz; ilk yazmada devralınır', () => {
  // v7.22'den kalma paylaşılan dosyayı elle kur.
  const shared = path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, 'shipping-comparison.json');
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.writeFileSync(shared, JSON.stringify({ rows: [{ _shipId: 'legacy1', orderCode: 900, note: 'eski' }], _revision: 3 }), 'utf8');

  // Henüz hiç yazmamış bir kullanıcı eski satırı GÖRÜR.
  const fresh = db.loadShipping('zeynep');
  assert.equal(fresh.rows.length, 1);
  assert.equal(fresh.rows[0].note, 'eski');
  assert.equal(fresh.rows[0]._inherited, true, 'devralınan satır işaretli gelmeli');

  // İlk yazmada eski satır kendi dosyasına kopyalanır; paylaşılan dosya değişmez.
  const saved = db.addShippingRows([{ orderCode: 901, note: 'yeni' }], fresh._revision, 'zeynep');
  assert.deepEqual(saved.rows.map(row => row.note).sort(), ['eski', 'yeni']);
  const sharedAfter = JSON.parse(fs.readFileSync(shared, 'utf8'));
  assert.deepEqual(sharedAfter.rows.map(row => row.note), ['eski'], 'paylaşılan dosya YAZILMAMALI (geri dönüş güvencesi)');

  // Devralmadan sonra kullanıcı kendi kopyasını düzenler; diğer kullanıcı hâlâ orijinali görür.
  const zeynep = db.loadShipping('zeynep');
  db.deleteShippingRows(['legacy1'], zeynep._revision, 'zeynep');
  assert.deepEqual(db.loadShipping('zeynep').rows.map(row => row.note), ['yeni']);
  assert.deepEqual(db.loadShipping('burak').rows.map(row => row.note), ['eski'],
    'henüz devralmamış başka bir kullanıcı eski satırı görmeye devam etmeli');
  // Devralmış bir kullanıcı ise artık YALNIZ kendi kopyasını görür; zeynep'in
  // silmesi onun ekranını değiştirmemiştir.
  assert.deepEqual(db.loadShipping('mehmet').rows.map(row => row.note), ['mehmet']);
});

/* v7.81 — Horizon ön ayarı testleri KALDIRILDI: özellik artık yok.
   Kaldırmanın kendisi tests/horizon-layer-provenance.test.js içinde
   kilitlenir ("ön ayar çözümleyicisi ARTIK KABUL EDİLMEZ"). */
