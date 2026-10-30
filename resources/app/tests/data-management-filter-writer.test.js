'use strict';

/* v7.81 (P3-yazma) — ORTAK MODÜL FİLTRESİNİ DÜZENLE.
 *
 * Korunan kusurlar:
 *
 * 1) PAYLAŞIM SESSİZ OLMAMALI (§19). Bir kapsam birden çok modülü besler;
 *    ufkunu değiştirmek hepsini etkiler. Kullanıcı bunu kaydettikten sonra
 *    başka bir sayfanın verisi değişince keşfetmemeli.
 *
 * 2) SINIRSIZ FİLTRE SESSİZCE KAYDEDİLMEMELİ. Kaydedilebilir, ama yenileme
 *    onu reddeder (source-filter-readiness). Kullanıcı yenilemede değil,
 *    kaydederken öğrenmeli.
 *
 * 3) normalizeScopes YAZILANI TAŞIYABİLİR. Orders ayrılması ve priceanalysis
 *    eklenmesi kapsamları yeniden düzenler; yazdığımız ufkun hedef modülde
 *    gerçekten geçerli olduğu DOĞRULANMALI, varsayılmamalı.
 *
 * v2026-10-30 — İKİ SABİT UFUK: her kaynakta CP ayrı, "Diğer modüller"
 * (ASAS: Orders · Backlog · LFL · Price & Supplier; IAS: Orders · Backlog)
 * tek ufuk. Paylaşım artık yalnız bu grubun içindedir; grup ayrılamaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-filterw-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const writer = require('../server/lib/data-domain/filter-writer');
const modelHorizon = require('../server/lib/modelHorizon');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function horizonOf(values) {
  return { table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] };
}

function setup() {
  return db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [
      { id: 'sc_core', name: 'Licensing Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) },
      { id: 'sc_lfl', name: 'LFL', targets: ['lfl'], enabled: true, horizon: horizonOf(['S6']) },
    ],
  }, {
    id: 'mc_ias', name: 'IAS', server: 's2', catalog: 'c2', role: 'antrepo', refreshEnabled: true,
    scopes: [
      { id: 'sc_ias_core', name: 'IAS Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) },
      { id: 'sc_ias_orders', name: 'IAS Orders', targets: ['orders'], enabled: true, horizon: horizonOf(['S6']) },
    ],
  }], null).items;
}

const save = plan => db.replaceModelConnections(plan.items, null).items;
const horizonFor = (items, moduleId, sourceId = 'mc_asas') => {
  const scope = items.find(entry => entry.id === sourceId).scopes.find(s => (s.targets || []).includes(moduleId));
  return scope ? scope.horizon.groups[0].conditions[0].values : null;
};

/* ------------------------------------------------------------------ */

/* v2026-10-30 — İKİ SABİT UFUK: IAS de CP ve "Diğer modüller" (Siparişler ·
   Backlog) olarak ikiye ayrılır. Eski IAS kaydında Backlog CP ile, Siparişler
   tek başına duruyordu; oylamada Siparişler'in ufku kazanır (eşitlikte Orders
   önce) ve Backlog'un eski ufku linkRestore'a saklanır. */
test('P3w IAS iki ufka ayrılır: Diğer modüllerin filtresi Siparişler + Backlog\'u birlikte günceller, CP etkilenmez', () => {
  const items = setup();
  assert.deepEqual(horizonFor(items, 'cp', 'mc_ias'), ['S7'], 'CP eski ufkunu korur');
  assert.deepEqual(horizonFor(items, 'backlog', 'mc_ias'), ['S6'], 'Backlog Siparişler ile aynı ufku taşır');
  const ias = items.find(entry => entry.id === 'mc_ias');
  assert.deepEqual(ias.linkedTargets, ['orders', 'backlog']);
  const stash = ias.linkRestore.find(entry => entry.moduleId === 'backlog');
  assert.ok(stash, 'Backlog\'un eski ufku saklanmalı');
  assert.deepEqual(stash.horizon.groups[0].conditions[0].values, ['S7']);

  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_ias', moduleId: 'orders', definition: horizonOf(['W9']), mode: 'shared',
  });
  assert.equal(plan.ok, true, plan.message);
  assert.ok(plan.warnings.some(text => /bağlı 2 modülün ortak ufkudur/.test(text)), 'grup uyarısı verilmedi');
  const next = save(plan);
  assert.deepEqual(horizonFor(next, 'orders', 'mc_ias'), ['W9']);
  assert.deepEqual(horizonFor(next, 'backlog', 'mc_ias'), ['W9'], 'aynı ufuktaki modül de değişmeli');
  assert.deepEqual(horizonFor(next, 'cp', 'mc_ias'), ['S7'], 'CP ayrı ufuktur');
});

test('P3w CP tek başına bir ufuktur; "ayır" kipi CP\'nin kendi ufkunu yazar', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_ias', moduleId: 'cp', definition: horizonOf(['W9']), mode: 'split', name: 'CP Kendi Kapsamı',
  });
  assert.equal(plan.ok, true, plan.message);
  const next = save(plan);
  assert.deepEqual(horizonFor(next, 'cp', 'mc_ias'), ['W9']);
  assert.deepEqual(horizonFor(next, 'backlog', 'mc_ias'), ['S6'], 'Diğer modüllerin ufku değişmez');
  const cpScope = next.find(entry => entry.id === 'mc_ias').scopes.find(s => s.targets.includes('cp'));
  assert.deepEqual(cpScope.targets, ['cp']);
});

test('P3w ASAS bağlı grubu tek ufuk taşır; eski ayrık kayıtlar tek kapsamda birleşir', () => {
  const items = setup();
  const asas = items.find(entry => entry.id === 'mc_asas');
  const linked = asas.scopes.filter(s => s.targets.some(t => ['orders', 'backlog', 'lfl', 'priceanalysis'].includes(t)));
  assert.equal(linked.length, 1, 'bağlı modüller tek kapsamda durmalı');
  assert.deepEqual(linked[0].targets.slice().sort(), ['backlog', 'lfl', 'orders', 'priceanalysis']);
  // CP bağlı gruba girmez; eski ufkunu korur.
  assert.deepEqual(horizonFor(items, 'cp'), ['S7']);
});

test('P3w bağlı modülün ortak filtresi grubun HEPSİNİ günceller, CP etkilenmez', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition: horizonOf(['W9']), mode: 'shared',
  });
  assert.equal(plan.ok, true, plan.message);
  assert.ok(plan.warnings.some(text => /bağlı 4 modülün ortak ufkudur/.test(text)), 'bağlı grup uyarısı verilmedi');
  const next = save(plan);
  for (const moduleId of ['orders', 'backlog', 'lfl', 'priceanalysis']) {
    assert.deepEqual(horizonFor(next, moduleId), ['W9'], `${moduleId} yeni ufku almalı`);
  }
  assert.deepEqual(horizonFor(next, 'cp'), ['S7'], 'CP bağlı gruba dahil değil');
  const linkedScopes = next.find(entry => entry.id === 'mc_asas').scopes.filter(s => s.targets.includes('lfl') || s.targets.includes('orders'));
  assert.equal(linkedScopes.length, 1, 'grup bölünmemeli');
});

/* v2026-10-30 — Diğer modüllerden tek bir modül kendi filtresine ayrılamaz.
   Sessizce ortak kayda çevirmek yerine açık bir kodla reddedilir. */
test('P3w Diğer modüllerin bir üyesi için "ayır" reddedilir (LINK_FIXED); kayıt değişmez', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition: horizonOf(['W9']), mode: 'split', name: 'LFL Kendi',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'LINK_FIXED');
  assert.deepEqual(horizonFor(items, 'lfl'), ['S7']);
});

test('P3w eski kayıtta kendi filtresiyle ayrı duran LFL ortak ufka katılır; eski filtresi saklanır', () => {
  const items = setup();
  const asas = items.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(asas.linkedTargets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  const stash = asas.linkRestore.find(entry => entry.moduleId === 'lfl');
  assert.ok(stash, 'LFL\'in eski ayrı filtresi kaybolmamalı');
  assert.equal(stash.scopeName, 'LFL');
  assert.deepEqual(stash.horizon.groups[0].conditions[0].values, ['S6']);
  // Kararlılık: yeniden kaydetmek saklananı kaybetmez, çoğaltmaz.
  const again = db.replaceModelConnections(items, null).items.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(again.linkRestore, asas.linkRestore);
  assert.deepEqual(again.scopes, asas.scopes);
});

test('P3w tek başına olan modülü "ayırmak" kapsam kimliğini boşuna değiştirmez', () => {
  const items = setup();
  const before = items.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('cp')).id;
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'cp', definition: horizonOf(['S8']), mode: 'split',
  });
  assert.equal(plan.ok, true, plan.message);
  const next = save(plan);
  const after = next.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('cp'));
  assert.equal(after.id, before, 'gereksiz yere yeni kapsam üretilmemeli');
  assert.deepEqual(after.horizon.groups[0].conditions[0].values, ['S8']);
});

/* ------------------------------------------------------------------ */

test('P3w sınırsız filtre kaydedilebilir ama SESSİZ kalmaz', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition: { table: 'ASAS' }, mode: 'shared',
  });
  assert.equal(plan.ok, true, 'kaydetmeyi engellememeli — kullanıcı düzenlemenin ortasında olabilir');
  assert.ok(plan.warnings.some(text => /yenileme çalışmaz/.test(text)),
    'sınırsız filtre uyarısı yok — kullanıcı bunu yenilemede öğrenirdi');
});

test('P3w yarım kalmış koşul da uyarı üretir', () => {
  const items = setup();
  // Alan seçili, değer yok: buildHorizonFilter istisna fırlatır.
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', mode: 'shared',
    definition: { table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: [] }] }] },
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some(text => /tamamlanmamış/.test(text)));
});

/* ------------------------------------------------------------------ */

test('P3w bağlı olmayan modüle filtre yazılmaz', () => {
  // LFL'yi kapsamdan çıkar: artık bağlı değil.
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc_core', name: 'Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) }],
  }], null).items;

  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition: horizonOf(['W9']), mode: 'shared',
  });
  /* Görünmeyen bir ayar bırakmak yerine reddedilir: kullanıcı önce bağlantıyı
     açmalı, yoksa kaydettiği filtreyi hiçbir yerde göremezdi. */
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'BINDING_NOT_FOUND');
  assert.deepEqual(plan.items, items);
});

test('P3w imkânsız modül reddedilir', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'intake', definition: horizonOf(['S7']), mode: 'shared',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'MODULE_NOT_FEEDABLE');
});

test('P3w geçersiz kaydetme biçimi reddedilir', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'cp', definition: horizonOf(['S7']), mode: 'uydurma',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'FILTER_MODE_INVALID');
});

/* ------------------------------------------------------------------ */

test('P3w normalizasyondan sonra filtrenin GERÇEKTEN uygulandığı doğrulanır', () => {
  /* normalizeScopes Orders'ı ayırır ve ASAS rolünde priceanalysis'i ilk
     kapsama ekler. Yazdığımızı varsaymak, kullanıcının kaydettiğini sanıp
     başka bir ufkun çalışmasına yol açardı. */
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'orders', definition: horizonOf(['W1']), mode: 'shared',
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.appliedScopeId, 'uygulanan kapsam bildirilmeli');

  const next = save(plan);
  assert.deepEqual(horizonFor(next, 'orders'), ['W1']);
  // CP'nin ufku Orders'tan bağımsız kalmalı.
  assert.deepEqual(horizonFor(next, 'cp'), ['S7']);
});

test('P3w kaydedilen ufuk DAX üretimine birebir girer', () => {
  const items = setup();
  const definition = horizonOf(['S7', 'S8']);
  const next = save(writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition, mode: 'shared',
  }));
  const stored = next.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('lfl')).horizon;
  assert.equal(
    modelHorizon.buildHorizonFilter(stored).expression,
    modelHorizon.buildHorizonFilter(definition).expression,
    'saklanan ufuk ile gönderilen ufuk aynı DAX’ı üretmeli');
});

test('P3w sharedModules paylaşanları listeler', () => {
  const items = setup();
  // v2026-10-30: IAS'ta da CP tek başına, Siparişler + Backlog birlikte.
  assert.deepEqual(writer.sharedModules(items, 'mc_ias', 'cp'), []);
  assert.deepEqual(writer.sharedModules(items, 'mc_ias', 'orders'), ['backlog']);
  // ASAS'ta bağlı grup üyeleri birbirinin ortağıdır; CP tek başınadır.
  assert.deepEqual(writer.sharedModules(items, 'mc_asas', 'lfl').sort(), ['backlog', 'orders', 'priceanalysis']);
  assert.deepEqual(writer.sharedModules(items, 'mc_asas', 'cp'), []);
});
