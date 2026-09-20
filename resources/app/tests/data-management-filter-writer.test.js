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
  }], null).items;
}

const save = plan => db.replaceModelConnections(plan.items, null).items;
const horizonFor = (items, moduleId) => {
  const scope = items.find(entry => entry.id === 'mc_asas').scopes.find(s => (s.targets || []).includes(moduleId));
  return scope ? scope.horizon.groups[0].conditions[0].values : null;
};

/* ------------------------------------------------------------------ */

test('P3w paylaşılan filtreyi güncellemek TÜM paylaşanları etkiler ve bunu söyler', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'cp', definition: horizonOf(['W9']), mode: 'shared',
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some(text => /paylaşılıyor/.test(text)), 'paylaşım uyarısı verilmedi');

  const next = save(plan);
  assert.deepEqual(horizonFor(next, 'cp'), ['W9']);
  assert.deepEqual(horizonFor(next, 'backlog'), ['W9'], 'aynı kapsamdaki modül de değişmeli');
  // Başka kapsam etkilenmemeli.
  assert.deepEqual(horizonFor(next, 'lfl'), ['S6']);
});

test('P3w ayırmak diğer modülleri ESKİ filtrede bırakır', () => {
  const items = setup();
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'cp', definition: horizonOf(['W9']), mode: 'split', name: 'CP Kendi Kapsamı',
  });
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some(text => /kendi filtresine ayrıldı/.test(text)));

  const next = save(plan);
  assert.deepEqual(horizonFor(next, 'cp'), ['W9']);
  assert.deepEqual(horizonFor(next, 'backlog'), ['S7'], 'ayrılan modül diğerini de götürmemeli');

  const cpScope = next.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('cp'));
  assert.equal(cpScope.name, 'CP Kendi Kapsamı');
  assert.ok(!cpScope.targets.includes('backlog'));
});

test('P3w tek başına olan modülü "ayırmak" kapsam kimliğini boşuna değiştirmez', () => {
  const items = setup();
  const before = items.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('lfl')).id;
  const plan = writer.planFilterChange(items, {
    sourceId: 'mc_asas', moduleId: 'lfl', definition: horizonOf(['S8']), mode: 'split',
  });
  const next = save(plan);
  const after = next.find(entry => entry.id === 'mc_asas').scopes.find(s => s.targets.includes('lfl'));
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
  assert.deepEqual(writer.sharedModules(items, 'mc_asas', 'cp').sort(), ['backlog', 'priceanalysis']);
  assert.deepEqual(writer.sharedModules(items, 'mc_asas', 'lfl'), []);
});
