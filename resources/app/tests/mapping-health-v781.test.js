'use strict';

/* v7.81 — EŞLEME SAĞLIĞI.
 *
 * Korunan kusur: kullanıcı 37–50 satırlık tam eşleme listesini görüyor ve
 * hangi satıra bakması gerektiğini ayırt edemiyordu. Bakılması gereken bir
 * avuç alan listenin içinde kayboluyordu.
 *
 * Buradaki asıl güvence, güven skorunun autoMapSchema'nın eşleştirme
 * kurallarıyla AYNI kuralları kullanması. İkisi ayrışırsa ekran "bu alan
 * gözden geçirilmeli" diyerek otomatik eşlemenin birebir bulduğu bir alanı
 * işaret eder (ya da tersi, gerçek sorunu gizler).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const modelFields = require('../server/lib/model-fields');

function entry(name, table = 'ASAS', kind = 'column') { return { table, name, kind, folder: '' }; }

/* ------------------------------------------------------------------ */

test('v7.81 durum sınıfları kapalı bir listedir', () => {
  const health = modelFields.mappingHealth('asas', {});
  for (const field of health.fields) {
    assert.ok(modelFields.MAPPING_STATUSES.includes(field.status), `bilinmeyen durum: ${field.status}`);
  }
});

test('v7.81 birebir başlık eşleşmesi "exact"tir', () => {
  assert.equal(modelFields.mappingFieldStatus({ header: 'Sipariş Kod', aliases: [] }, entry('Sipariş Kod')), 'exact');
  // Türkçe karakter ve noktalama farkı eşleşmeyi bozmaz (fieldKey ile aynı katlama).
  assert.equal(modelFields.mappingFieldStatus({ header: 'Sipariş Kod', aliases: [] }, entry('SIPARIS_KOD')), 'exact');
});

test('v7.81 bilinen takma ad "alias"tır, gözden geçirmeye düşmez', () => {
  const field = { header: 'Sipariş Kod', aliases: ['SIPARIS KODU', 'ORDER CODE'] };
  assert.equal(modelFields.mappingFieldStatus(field, entry('Order Code')), 'alias');
});

test('v7.81 yalnız içerme ile tutan alan "weak" — gözden geçirilmeli', () => {
  const field = { header: 'Ürün Tanım', aliases: ['PRODUCT DESCRIPTION'] };
  // "Ürün Tanım Detay" başlığı içeriyor ama birebir değil.
  assert.equal(modelFields.mappingFieldStatus(field, entry('Ürün Tanım Detay')), 'weak');
});

test('v7.81 hiçbir adayla örtüşmeyen alan "foreign"dır', () => {
  const field = { header: 'Ürün Tanım', aliases: ['PRODUCT DESCRIPTION'] };
  assert.equal(modelFields.mappingFieldStatus(field, entry('Internal_Status_9')), 'foreign');
});

test('v7.81 kısa takma ad her şeyi yakalamaz', () => {
  /* "FOB" 5 karakterden kısa; içerme kuralına GİRMEZ. Girseydi adında FOB
     geçen her sütun bu alana tutar ve kullanıcı yanlış bir fiyat sütununu
     onaylanmış sanırdı. autoMapSchema'nın eşiği de aynı sebeple 5'tir. */
  const field = { header: 'FOB Fiyatı', aliases: ['FOB'] };
  // "FOB FIYATI" ile "FOB MALIYET TUTARI" birbirini kapsamıyor, kısa takma ad
  // da devreye girmiyor → gözden geçirilmeli, sessizce kabul edilmemeli.
  assert.equal(modelFields.mappingFieldStatus(field, entry('FOB Maliyet Tutarı')), 'foreign');
  assert.equal(modelFields.mappingFieldStatus(field, entry('Renk Kod')), 'foreign');
  // Uzun aday ise içermeyle tutar.
  assert.equal(modelFields.mappingFieldStatus(field, entry('FOB Fiyatı USD')), 'weak');
});

/* ------------------------------------------------------------------ */

test('v7.81 otomatik eşlemenin bulduğu hiçbir alan "foreign" sayılmaz', () => {
  /* ANTI-SAPMA KİLİDİ. autoMapSchema yalnız birebir ad, takma ad veya ≥5
     karakter içerme ile eşleştirir. Dolayısıyla onun ürettiği bir eşlemede
     "hiçbir adayla örtüşmeyen" alan OLAMAZ. Çıkıyorsa iki taraf ayrışmış
     demektir ve ekran yanlış alanı işaret eder. */
  const schema = {
    columns: modelFields.fieldsForRole('asas').map(field => ({ table: 'ASAS', name: field.header, kind: 'column' })),
    measures: [],
  };
  const mapped = modelFields.autoMapSchema('asas', schema);
  const health = modelFields.mappingHealth('asas', mapped.mapping);

  const foreign = health.fields.filter(field => field.status === 'foreign' && !field.identity);
  assert.deepEqual(foreign.map(field => `${field.header} → ${field.column}`), [],
    'otomatik eşlemenin bulduğu bir alan "yabancı" sayıldı — kurallar ayrışmış');

  // Birebir şemada her alan bulunmalı ve hiçbiri gözden geçirmeye düşmemeli.
  assert.equal(health.summary.unmapped, 0);
  assert.equal(health.summary.needsAttention, 0);
  assert.equal(health.summary.ok, health.summary.total);
});

test('v7.81 takma adlarla gelen gerçekçi şema da temiz çıkar', () => {
  const schema = {
    columns: [
      { table: 'ASAS', name: 'ORDER CODE', kind: 'column' },
      { table: 'ASAS', name: 'SEASON', kind: 'column' },
      { table: 'ASAS', name: 'MANUFACTURER', kind: 'column' },
    ],
    measures: [{ table: 'ASAS', name: 'FOB PRICE', kind: 'measure', folder: '' }],
  };
  const mapped = modelFields.autoMapSchema('asas', schema);
  const health = modelFields.mappingHealth('asas', mapped.mapping);
  const byHeader = new Map(health.fields.map(field => [field.header, field]));

  assert.equal(byHeader.get('Sipariş Kod').status, 'alias');
  assert.equal(byHeader.get('Sezon').status, 'alias');
  assert.equal(byHeader.get('Üretici').status, 'alias');
  assert.equal(byHeader.get('FOB Fiyatı').status, 'alias');
});

/* ------------------------------------------------------------------ */

test('v7.81 zorunlu alan eşlenmemişse ENGELLEYİCİdir', () => {
  const health = modelFields.mappingHealth('asas', {
    'Sipariş Kod': entry('SIPARIS_KOD'),
    'Renk': entry('RENK'),
  });
  assert.ok(health.summary.blocking > 0);
  // Ana Kumaş Mı zorunludur ve eşlenmemiştir.
  assert.ok(health.blockingHeaders.includes('Ana Kumaş Mı'));
  // Zorunlu olmayan eşlenmemiş alanlar engelleyici DEĞİLdir; sessizce sayılır.
  assert.ok(health.summary.unmapped > health.summary.blocking);
});

test('v7.81 kimlik alanı şüpheliyse adı benzese bile gözden geçirmeye düşer', () => {
  /* Sipariş eşleşmesi Sipariş Kod + Model Adı + Renk Kod üçlüsüyle BİREBİR
     yapılır. Buradaki hata sessizdir: sorgu çalışır, eşleşme tutmaz. */
  const health = modelFields.mappingHealth('asas', {
    'Sipariş Kod': entry('Sipariş Kod'),
    'Model Adı': entry('Tedarikçi Referans Kodu'),
    'Renk Kod': entry('Renk Kod'),
  });
  const model = health.fields.find(field => field.header === 'Model Adı');
  assert.equal(model.identity, true);
  assert.equal(model.status, 'foreign');
  assert.ok(health.reviewHeaders.includes('Model Adı'));
});

test('v7.81 öne çıkan sayı "bakılması gereken", "toplam alan" değil', () => {
  // Gerçekçi kurulum: çoğu alan birebir, birkaçı sorunlu.
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = entry(field.header);
  mapping['Ürün Tanım'] = entry('Ürün Tanım Detay');       // weak
  mapping['Lisans'] = entry('Internal_Status_9');           // foreign
  delete mapping['Ana Kumaş Mı'];                           // zorunlu, eksik

  const health = modelFields.mappingHealth('asas', mapping);
  assert.equal(health.summary.needsAttention, 3);
  assert.ok(health.summary.total > 30, 'katalog gerçekten büyük olmalı ki test anlamlı olsun');
  // Kullanıcı 37 satır yerine 3 satıra bakmalı.
  assert.ok(health.summary.needsAttention < health.summary.total / 5);
});

test('v7.81 sağlık raporu şema okumaz, ağa çıkmaz', () => {
  // Tamamen boş bir eşlemeyle bile çalışmalı: kaynak erişilemezken de ekran açılır.
  const health = modelFields.mappingHealth('antrepo', {});
  assert.equal(health.summary.ok, 0);
  assert.equal(health.summary.unmapped, health.summary.total);
  assert.ok(health.summary.blocking > 0);
});
