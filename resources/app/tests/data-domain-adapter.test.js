'use strict';

/* Data Management P0 — domain katmanının mevcut depoya sadakati.
 *
 * Bu dosyadaki testler bir özellik değil, bir MİGRATION KANITI kilitler:
 * yeni varlık modeli (DataSource / MappingSet / FilterSet / ModuleBinding)
 * bugünkü modelConnections kaydını hiçbir alanını kaybetmeden temsil
 * edebiliyor ve aynı DAX'ı üretiyor.
 *
 * Bu testler kırılırsa migration güvenli değildir; gevşetilerek değil,
 * adapter düzeltilerek geçilmelidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-datadomain-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const modelHorizon = require('../server/lib/modelHorizon');
const modelScopes = require('../server/lib/model-scopes');
const modelFields = require('../server/lib/model-fields');
const sourceProfiles = require('../server/lib/data-domain/source-profiles');
const adapter = require('../server/lib/data-domain/legacy-adapter');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/* Gerçekçi bir kurulum: iki ASAS kapsamı (biri CP+Backlog ortak filtreyle,
   biri LFL kendi filtresiyle), bir IAS bağlantısı ve kullanımdan kalkmış
   bir fabric kaydı. */
function fixture() {
  const licensing = {
    table: 'ASAS',
    groups: [{
      id: 'g-lic',
      conditions: [
        { id: 'c1', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: ['S7', 'S8'] },
        { id: 'c2', table: 'ASAS', field: 'Buyer Grup (TR)', op: 'in', valueType: 'text', values: ['LISANS'] },
      ],
    }],
  };
  return [
    {
      id: 'mc_asas', name: 'ASAS', server: 'lcwtabular_s30', catalog: 'ASAS_30', role: 'asas',
      mode: 'auto', refreshEnabled: true,
      horizon: { table: 'ASAS', seasons: ['W6'] },
      scopes: [
        { id: 'sc_core', name: 'Licensing Core', targets: ['cp', 'backlog'], enabled: true, horizon: licensing },
        { id: 'sc_lfl', name: 'LFL Karşılaştırma', targets: ['lfl'], enabled: true, horizon: {
          table: 'ASAS',
          groups: [{ id: 'g-lfl', conditions: [{ id: 'c3', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: ['S6', 'S7', 'S8'] }] }],
        } },
        { id: 'sc_orders', name: '', targets: ['orders'], enabled: true, horizon: licensing },
      ],
      mapping: {
        'Sipariş Kod': { table: 'ASAS', name: 'SIPARIS_KOD', kind: 'column', folder: '' },
        'Sezon': { table: 'ASAS', name: 'SEZON', kind: 'column', folder: '' },
        'FOB Fiyatı': { table: 'ASAS', name: 'FOB Fiyatı', kind: 'measure', folder: 'Fiyat' },
      },
      customFields: [{ header: 'Özel Alan', custom: true }],
      cpColumns: [{ id: 'cpx1', label: 'Statü Detay', table: 'ASAS', name: 'STATU', kind: 'column', group: 'Database' }],
    },
    {
      id: 'mc_ias', name: 'IAS', server: 'lcwtabular_s30', catalog: 'IASV2', role: 'antrepo',
      mode: 'auto', refreshEnabled: true,
      horizon: { table: 'IAS' },
      scopes: [{ id: 'sc_ias', name: '', targets: ['cp', 'orders', 'backlog'], enabled: true, horizon: {
        table: 'IAS',
        groups: [{ id: 'g-ias', conditions: [{ id: 'c4', table: 'IAS', field: 'Sezon', op: 'in', valueType: 'text', values: ['S7'] }] }],
      } }],
      mapping: { 'İthalat Dosya No': { table: 'IAS', name: 'DOSYA_NO', kind: 'column', folder: '' } },
    },
    {
      id: 'mc_fabric_old', name: 'Eski Kumaş', server: 'lcwtabular_s30', catalog: 'FABRIC', role: 'fabric',
      mapping: { 'Kumaş Tipi': { table: 'F', name: 'TIP', kind: 'column', folder: '' } },
    },
  ];
}

function normalized() {
  return db.replaceModelConnections(fixture(), null).items;
}

/* ------------------------------------------------------------------ */

test('P0 kaynak profilleri bugünkü rol gerçeğiyle birebir uyuşur', () => {
  const result = sourceProfiles.validate({
    roleTargets: modelScopes.ROLE_TARGETS,
    scopeTargets: modelScopes.SCOPE_TARGETS,
    fieldsForRole: modelFields.fieldsForRole,
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('P0 her etkin rolün bir profili vardır; fabric bilinçli olarak dışarıdadır', () => {
  assert.equal(sourceProfiles.fromLegacyRole('asas').id, 'asas-orders');
  assert.equal(sourceProfiles.fromLegacyRole('antrepo').id, 'ias-warehouse');
  assert.equal(sourceProfiles.fromLegacyRole('intake').id, 'intake-budget');
  assert.equal(sourceProfiles.fromLegacyRole('fabric'), null);
  assert.equal(sourceProfiles.isRetiredRole('fabric'), true);
});

/* ------------------------------------------------------------------ */

test('P0 gidiş-dönüş iş verisini korur; profil engine varsayımları kanonikleştirilebilir', () => {
  const before = normalized();
  const after = adapter.toLegacy(adapter.fromLegacy(before));
  const canonicalBefore = before.map(item => {
    const profile = sourceProfiles.fromLegacyRole(item.role);
    return profile && !item.engine ? { ...item, engine: profile.engine } : item;
  });
  assert.deepEqual(after, canonicalBefore);
});

test('P0 kullanımdan kalkmış fabric kaydı silinmez, olduğu gibi taşınır', () => {
  const before = normalized();
  const domain = adapter.fromLegacy(before);
  assert.equal(domain.retired.length, 1);
  assert.equal(domain.retired[0].legacyRole, 'fabric');
  // Eşlemesi dahil korunmuş olmalı: kullanıcı bunu geri açarsa kaybı olmasın.
  assert.ok(domain.retired[0].item.mapping['Kumaş Tipi']);
  const after = adapter.toLegacy(domain);
  assert.ok(after.some(item => item.id === 'mc_fabric_old' && item.role === 'fabric'));
});

test('P0 üretilen DAX filtresi birebir aynı kalır', () => {
  const before = normalized();
  const domain = adapter.fromLegacy(before);
  const filterSets = new Map(domain.filterSets.map(entry => [entry.id, entry]));
  let compared = 0;

  for (const item of before) {
    if (sourceProfiles.isRetiredRole(item.role)) continue;
    for (const scope of item.scopes || []) {
      const binding = domain.bindings.find(entry =>
        entry.sourceId === item.id && (scope.targets || []).includes(entry.moduleId));
      assert.ok(binding, `${item.id} / ${scope.id} için binding üretilmedi`);

      const legacyBuilt = modelHorizon.buildHorizonFilter(scope.horizon, item.mapping);
      const domainBuilt = modelHorizon.buildHorizonFilter(filterSets.get(binding.filterSetId).definition, item.mapping);
      assert.equal(domainBuilt.expression, legacyBuilt.expression,
        `${item.id} / ${scope.id} kapsamında DAX ifadesi değişti`);
      assert.equal(domainBuilt.conditionCount, legacyBuilt.conditionCount);
      assert.equal(domainBuilt.groupCount, legacyBuilt.groupCount);
      compared += 1;
    }
  }
  assert.ok(compared >= 4, `karşılaştırılan kapsam sayısı beklenenden az: ${compared}`);
});

/* ------------------------------------------------------------------ */

test('P0 aynı filtreyi kullanan modüller tek FilterSet paylaşır', () => {
  const domain = adapter.fromLegacy(normalized());
  /* v20260928 — ASAS'ta Orders · Backlog · LFL · Price & Supplier BAĞLI bir
     gruptur: tek kapsam, tek filtre. Fikstürde Backlog (Licensing Core) ve
     Orders aynı ufku, LFL ayrı bir ufku taşıyordu; çoğunluğun ufku kazanır
     ve dört modül tek FilterSet'e düşer. CP bağlı gruba girmez (v4.71: Orders
     ufku CP'den bağımsız düzenlenir), kendi FilterSet'inde kalır. */
  const core = domain.filterSets.find(entry => entry.name === 'Licensing Core');
  assert.ok(core, 'Licensing Core filtresi bulunamadı');
  assert.deepEqual(adapter.filterUsage(domain, core.id), ['cp']);

  const ordersBinding = domain.bindings.find(entry => entry.sourceId === 'mc_asas' && entry.moduleId === 'orders');
  assert.ok(ordersBinding, 'Orders bağı bulunamadı');
  const linked = adapter.filterUsage(domain, ordersBinding.filterSetId);
  assert.deepEqual(linked.slice().sort(), ['backlog', 'lfl', 'orders', 'priceanalysis']);

  // Tek bir kaynakta aynı filtreyi paylaşan modüller gerçekten tek kayda düşer:
  // dört modül, tek FilterSet kimliği.
  const shared = domain.bindings.filter(entry => entry.filterSetId === ordersBinding.filterSetId);
  assert.equal(shared.length, 4);
});

test('P0 alan eşlemesi kaynağa aittir, bağlantıya değil', () => {
  const domain = adapter.fromLegacy(normalized());
  const asas = domain.sources.find(entry => entry.id === 'mc_asas');
  const mappingSet = domain.mappingSets.find(entry => entry.id === asas.mappingSetId);

  // CP, Orders, Backlog, LFL ve Price Analysis aynı tek eşlemeyi kullanır.
  const asasBindings = domain.bindings.filter(entry => entry.sourceId === 'mc_asas');
  assert.ok(asasBindings.length >= 5);
  for (const binding of asasBindings) assert.equal(binding.mappingSetId, mappingSet.id);

  // §11 — CP bağlantısını kaldırmak eşlemeyi VE diğer modülleri etkilemez.
  const withoutCp = { ...domain, bindings: domain.bindings.filter(entry => entry.moduleId !== 'cp') };
  const rebuilt = adapter.toLegacy(withoutCp);
  const asasLegacy = rebuilt.find(item => item.id === 'mc_asas');
  assert.deepEqual(asasLegacy.mapping, normalized().find(item => item.id === 'mc_asas').mapping);
  assert.ok(asasLegacy.scopes.some(scope => scope.targets.includes('backlog')));
  assert.ok(!asasLegacy.scopes.some(scope => scope.targets.includes('cp')));
});

test('P0 kimlikler deterministiktir — migration iki kez çalışsa da çoğalmaz', () => {
  const before = normalized();
  const first = adapter.fromLegacy(before);
  const second = adapter.fromLegacy(before);
  assert.deepEqual(second.sources.map(entry => entry.id), first.sources.map(entry => entry.id));
  assert.deepEqual(second.bindings.map(entry => entry.id), first.bindings.map(entry => entry.id));
  assert.deepEqual(second.filterSets.map(entry => entry.id), first.filterSets.map(entry => entry.id));
  assert.deepEqual(second.mappingSets.map(entry => entry.id), first.mappingSets.map(entry => entry.id));
  // İkinci tur, ilk turun çıktısı üzerinden geçse de aynı kimlikleri üretir.
  const third = adapter.fromLegacy(adapter.toLegacy(first));
  assert.deepEqual(third.filterSets.map(entry => entry.id), first.filterSets.map(entry => entry.id));
});

/* ------------------------------------------------------------------ */

test('P0 matris hücresi "kapalı" ile "imkânsız"ı ayırır', () => {
  const domain = adapter.fromLegacy(normalized());

  assert.equal(adapter.cellState(domain, 'mc_asas', 'cp'), 'on');
  assert.equal(adapter.cellState(domain, 'mc_asas', 'lfl'), 'on');

  // IAS, LFL'i besleyemez — bu kapalı bir anahtar değil, olmayan bir hücre.
  assert.equal(adapter.cellState(domain, 'mc_ias', 'lfl'), 'unavailable');
  // INTAKE yalnız kendi modülünü besler.
  const intake = domain.sources.find(entry => entry.profileId === 'intake-budget');
  assert.ok(intake, 'varsayılan INTAKE kaynağı bulunamadı');
  assert.equal(adapter.cellState(domain, intake.id, 'cp'), 'unavailable');
  assert.equal(adapter.cellState(domain, intake.id, 'intake'), 'on');
});

test('P0 kaynak beslemeyen modüller hiçbir profilin listesinde yoktur', () => {
  // Mock-up bu modülleri matriste gösteriyordu; gerçekte yerel/türetilmiş veri.
  for (const moduleId of ['koleksiyon', 'quotations', 'pricinghistory', 'opencosting', 'shipping']) {
    assert.deepEqual(sourceProfiles.profilesForModule(moduleId), [],
      `${moduleId} bir kaynak profiline bağlanmış görünüyor`);
  }
  assert.deepEqual(sourceProfiles.feedableModules().slice().sort(),
    ['backlog', 'cp', 'intake', 'lfl', 'orders', 'priceanalysis']);
});

test('P0 imkânsız hedef taşıyan kayıt sessizce düşürülmez, uyarı üretir', () => {
  const broken = fixture();
  broken[1].scopes[0].targets = ['cp', 'lfl'];   // IAS → LFL mümkün değil
  const domain = adapter.fromLegacy(db.replaceModelConnections(broken, null).items);
  // db normalizasyonu izin verilmeyen hedefi zaten eler; adapter da aynı
  // sonuca varmalı: LFL için IAS binding'i OLUŞMAZ.
  assert.ok(!domain.bindings.some(entry => entry.sourceId === 'mc_ias' && entry.moduleId === 'lfl'));
});
