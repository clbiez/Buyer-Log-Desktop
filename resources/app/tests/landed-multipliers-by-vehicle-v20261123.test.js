'use strict';
/* Landed çarpanları: vasıtaya göre yurtdışı standardı (byVehicle).
   P1 — ortak iş kuralı genişliyor. Eski kayıtların şekli korunur, eski istemcinin
   {tr, overseas} PUT'u kayıtlı vasıta standartlarını SİLMEZ, CAS sözleşmesi aynıdır. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-landed-vehicle-'));
for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_AUTH_DATA_ROOT']) process.env[key] = root;
const db = require('../server/db');
const serviceLib = require('../server/lib/landed-multiplier-service');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('migrasyon: byVehicle olmayan eski kayıt aynı şekilde okunur (alan eklenmez)', () => {
  assert.deepEqual(db.normalizeLandedMultipliers({ tr: 1.05, overseas: 1.11 }), { tr: 1.05, overseas: 1.11 });
  assert.deepEqual(db.normalizeLandedMultipliers(null), { tr: 1.05, overseas: 1.11 });
  assert.deepEqual(db.normalizeLandedMultipliers({ tr: 1.05, overseas: 1.11, byVehicle: {} }), { tr: 1.05, overseas: 1.11 });
  assert.deepEqual(db.normalizeLandedMultipliers({ tr: 1.05, overseas: 1.11, byVehicle: { 'Gemi + Uçak': '1.2', Uçak: 0, Gemi: 1.08 } }), { tr: 1.05, overseas: 1.11, byVehicle: { 'GEMI+UCAK': 1.2, GEMI: 1.08 } });
  assert.deepEqual(db.normalizeLandedMultipliers({ tr: 1.05, overseas: 1.11, byVehicle: 'bozuk' }), { tr: 1.05, overseas: 1.11 });
});

test('parmak izi: byVehicle yoksa eski parmak iziyle aynıdır, varsa değişir', () => {
  const { hash } = require('../server/lib/operation-utils');
  assert.equal(serviceLib.fingerprint({ tr: 1.05, overseas: 1.11 }), hash(JSON.stringify({ tr: 1.05, overseas: 1.11 })));
  assert.notEqual(serviceLib.fingerprint({ tr: 1.05, overseas: 1.11, byVehicle: { UCAK: 1.5 } }), serviceLib.fingerprint({ tr: 1.05, overseas: 1.11 }));
});

test('sıkı doğrulama: byVehicle değeri 0 < x ≤ 10 olmalı; alan yoksa undefined kalır (koru anlamı)', () => {
  assert.deepEqual(serviceLib.validateMultipliers({ tr: 1.05, overseas: 1.11 }), { tr: 1.05, overseas: 1.11 });
  assert.deepEqual(serviceLib.validateMultipliers({ tr: 1.05, overseas: 1.11, byVehicle: { 'Gemi+Uçak': 1.25 } }), { tr: 1.05, overseas: 1.11, byVehicle: { 'GEMI+UCAK': 1.25 } });
  assert.deepEqual(serviceLib.validateMultipliers({ tr: 1.05, overseas: 1.11, byVehicle: {} }), { tr: 1.05, overseas: 1.11, byVehicle: {} });
  for (const byVehicle of [{ Gemi: 0 }, { Gemi: 11 }, { Gemi: 'x' }, [], 'Gemi', { 'Gemi+Uçak': 1.2, 'GEMI + UCAK': 1.3 }]) {
    assert.throws(() => serviceLib.validateMultipliers({ tr: 1.05, overseas: 1.11, byVehicle }), { code: 'LANDED_MULTIPLIERS_INVALID' }, JSON.stringify(byVehicle));
  }
});

test('servis: vasıta standardı kaydedilir; eski istemcinin {tr, overseas} PUT\'u kayıtlı standartları korur; {} açıkça temizler', async () => {
  const service = serviceLib.createLandedMultiplierService({ db });
  const start = await service.snapshot({});
  const saved = await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Gemi: 1.08, 'Gemi+Uçak': 1.2 } }, { revision: start.revision }, {});
  assert.deepEqual(saved.multipliers, { tr: 1.05, overseas: 1.11, byVehicle: { GEMI: 1.08, 'GEMI+UCAK': 1.2 } });
  assert.equal(saved.revision, start.revision + 1);
  assert.deepEqual(db.loadOverrides().landedVehicleStandards, { GEMI: 1.08, 'GEMI+UCAK': 1.2 });

  const legacy = await service.replace({ tr: 1.06, overseas: 1.12 }, { revision: saved.revision }, {});
  assert.deepEqual(legacy.multipliers, { tr: 1.06, overseas: 1.12, byVehicle: { GEMI: 1.08, 'GEMI+UCAK': 1.2 } });

  const cleared = await service.replace({ tr: 1.06, overseas: 1.12, byVehicle: {} }, { revision: legacy.revision }, {});
  assert.deepEqual(cleared.multipliers, { tr: 1.06, overseas: 1.12 });
  assert.deepEqual(db.loadOverrides().landedVehicleStandards, {});
  assert.equal(db.landedMultipliersOf(db.loadOverrides()).byVehicle, undefined);
});

test('servis CAS: eski revizyonla vasıta standardı yazımı çakışma verir ve kaydı değiştirmez', async () => {
  const service = serviceLib.createLandedMultiplierService({ db });
  const start = await service.snapshot({});
  await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Uçak: 1.5 } }, { revision: start.revision }, {});
  const before = db.loadOverrides().landedMultipliers;
  await assert.rejects(service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Uçak: 1.9 } }, { revision: start.revision }, {}), error => error instanceof db.RevisionConflictError);
  assert.deepEqual(db.loadOverrides().landedMultipliers, before);
});

test('servis önizleme ve geri alma: önizleme vasıta değişimini bildirir, restore kaydı birebir geri getirir', async () => {
  const service = serviceLib.createLandedMultiplierService({ db });
  const first = await service.snapshot({});
  const base = await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: {} }, { revision: first.revision }, {});
  const preview = await service.preview({ tr: 1.05, overseas: 1.11, byVehicle: { Tır: 1.07 } }, {});
  assert.equal(preview.impact.vehicleStandardsChanged, true);
  assert.deepEqual(preview.next.byVehicle, { TIR: 1.07 });
  const applied = await service.replace(preview.next, preview, {});
  assert.deepEqual(applied.multipliers.byVehicle, { TIR: 1.07 });
  // Önceki kayıtta byVehicle yoktu: restore vasıta standartlarını kaldırmalı (koru anlamı uygulanmaz).
  const restored = await service.restore(base.multipliers, applied, {});
  assert.deepEqual(restored.multipliers, { tr: 1.05, overseas: 1.11 });
  // Eski istemci önizlemesi ({tr, overseas}) kayıtlı vasıta standardını değiştirmez.
  await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Tır: 1.07 } }, { revision: restored.revision }, {});
  const legacyPreview = await service.preview({ tr: 1.05, overseas: 1.11 }, {});
  assert.equal(legacyPreview.impact.vehicleStandardsChanged, false);
  assert.deepEqual(legacyPreview.next.byVehicle, { TIR: 1.07 });
});

/* Karışık sürüm: eski sürüm loadOverrides'ta bilinmeyen ÜST DÜZEY anahtarları korur
   ({...base, ...parsed}) ama landedMultipliers'ı yalnız {tr, overseas} olarak normalize eder.
   Bu yüzden vasıta standartları ayrı üst düzey anahtarda (landedVehicleStandards) tutulur. */
const oldVersionView = ov => ({ ...ov, landedMultipliers: { tr: ov.landedMultipliers.tr, overseas: ov.landedMultipliers.overseas } });

test('depolama: vasıta standartları ayrı üst düzey anahtarda; landedMultipliers yalnız {tr, overseas}', async () => {
  const service = serviceLib.createLandedMultiplierService({ db });
  const start = await service.snapshot({});
  const saved = await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Gemi: 1.08 } }, { revision: start.revision }, {});
  assert.deepEqual(saved.multipliers, { tr: 1.05, overseas: 1.11, byVehicle: { GEMI: 1.08 } });
  const raw = db.loadOverrides();
  assert.deepEqual(raw.landedMultipliers, { tr: 1.05, overseas: 1.11 });
  assert.deepEqual(raw.landedVehicleStandards, { GEMI: 1.08 });
  assert.deepEqual(db.landedMultipliersOf(raw), { tr: 1.05, overseas: 1.11, byVehicle: { GEMI: 1.08 } });
  assert.ok(require('../server/lib/shared-sync-policy').MASTER_OVERRIDE_FIELDS.has('landedVehicleStandards'), 'Shared Hub taşır');
});

test('karışık sürüm: eski sürümün bütün-belge overrides yazımı ve kendi landed PUT\'u vasıta standartlarını silmez', async () => {
  const service = serviceLib.createLandedMultiplierService({ db });
  const start = await service.snapshot({});
  await service.replace({ tr: 1.05, overseas: 1.11, byVehicle: { Uçak: 1.4, Gemi: 1.07 } }, { revision: start.revision }, {});
  // Eski sürüm: ilgisiz bir alanı (not) düzenleyip bütün belgeyi yazar.
  const oldDoc = oldVersionView(db.loadOverrides());
  oldDoc.notesmap = { ...oldDoc.notesmap, 'k|1': { Notes: 'eski sürüm' } };
  db.saveOverrides(oldDoc, oldDoc._revision);
  assert.deepEqual(db.landedMultipliersOf(db.loadOverrides()).byVehicle, { UCAK: 1.4, GEMI: 1.07 });
  // Eski sürüm: kendi replaceLandedMultipliers akışı ({tr, overseas}, revizyon +1).
  const oldPut = oldVersionView(db.loadOverrides());
  oldPut.landedMultipliers = { tr: 1.06, overseas: 1.12 };
  oldPut._revisions = { ...oldPut._revisions, landedMultipliers: oldPut._revisions.landedMultipliers + 1 };
  db.saveOverrides(oldPut, oldPut._revision);
  const after = await service.snapshot({});
  assert.deepEqual(after.multipliers, { tr: 1.06, overseas: 1.12, byVehicle: { UCAK: 1.4, GEMI: 1.07 } });
  // Açık temizleme: anahtar boş nesne olarak kalır (eski iç içe değer geri gelmez).
  await service.replace({ tr: 1.06, overseas: 1.12, byVehicle: {} }, { revision: after.revision }, {});
  assert.deepEqual(db.loadOverrides().landedVehicleStandards, {});
  assert.deepEqual(db.landedMultipliersOf(db.loadOverrides()), { tr: 1.06, overseas: 1.12 });
});
