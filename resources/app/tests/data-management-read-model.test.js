'use strict';

/* Data Management P2 — ekranın okuduğu projeksiyon.
 *
 * Bu testlerin koruduğu asıl kusur mock-up'tan geliyordu: matris, bir kaynağın
 * besleyemeyeceği modülleri "kapalı anahtar" gibi gösteriyordu. 9 satır × 3
 * sütunun 16 hücresi yapısal olarak imkânsızdı ve arayüz bunu söylemiyordu.
 *
 * Burada kilitlenen sözleşme: 'off' (kapalı ama mümkün) ile 'unavailable'
 * (yapısal olarak imkânsız) ASLA aynı hücre durumuna düşmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-dmrm-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const readModel = require('../server/lib/data-domain/read-model');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function seasonFilter(table, values) {
  return {
    table,
    groups: [{ id: 'g', conditions: [{ id: 'c', table, field: 'Sezon', op: 'in', valueType: 'text', values }] }],
  };
}

/* Katalogdaki her alanı kendi adıyla eşleyen tam bir eşleme. Bir testte
   YALNIZ sınanmak istenen eksiğin kalması için kullanılır. */
function completeMapping(role, table) {
  const modelFields = require('../server/lib/model-fields');
  const out = {};
  for (const field of modelFields.fieldsForRole(role)) {
    out[field.header] = { table, name: field.header, kind: 'column', folder: '' };
  }
  return out;
}

function view(overrides = {}) {
  const items = db.replaceModelConnections([
    {
      id: 'mc_asas', name: 'ASAS', server: 'lcwtabular_s30', catalog: 'ASAS_30', role: 'asas',
      refreshEnabled: true,
      scopes: [
        /* v20260928 — ASAS'ta Orders · Backlog · LFL · Price & Supplier bağlı
           gruptur (tek ufuk) ve CP'den ayrı tutulur; paylaşılan filtre
           senaryosu bu grup üzerinden kurulur. */
        { id: 'sc_cp', name: '', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7', 'S8']) },
        { id: 'sc_core', name: 'Licensing Core', targets: ['backlog'], enabled: true, horizon: seasonFilter('ASAS', ['S7', 'S8']) },
      ],
      mapping: { 'Sipariş Kod': { table: 'ASAS', name: 'SK', kind: 'column', folder: '' } },
      ...(overrides.asas || {}),
    },
    {
      id: 'mc_ias', name: 'IAS', server: 'lcwtabular_s30', catalog: 'IASV2', role: 'antrepo',
      refreshEnabled: true,
      // Bilerek FİLTRESİZ: "yenilemeden önce filtre gerekli" uyarısı sınanır.
      // Eşleme ise TAM: sınanmak istenen tek eksik filtre olsun, yoksa daha
      // öncelikli olan "zorunlu alan eksik" durumu onu gölgeler.
      scopes: [{ id: 'sc_ias', targets: ['cp'], enabled: true, horizon: { table: 'IAS' } }],
      mapping: completeMapping('antrepo', 'IAS'),
      ...(overrides.ias || {}),
    },
  ], null).items;
  return readModel.build(items, { language: 'tr' });
}

/* ------------------------------------------------------------------ */

test('P2 matris "kapalı" ile "imkânsız"ı asla aynı duruma düşürmez', () => {
  const model = view();

  // ASAS LFL'i besleyebilir ama bağlanmamış → kapalı, açılabilir.
  assert.equal(model.matrix.cells['mc_asas:lfl'], 'off');
  // IAS LFL'i besleyemez → hücre yok, toggle gösterilmemeli.
  assert.equal(model.matrix.cells['mc_ias:lfl'], 'unavailable');
  /* Bağlı hücreler iki türlü olur: iş kuralı gereği KİLİTLİ olanlar ve
     kullanıcının kapatabileceği açık olanlar. CP her iki kaynakta da o veri
     olmadan çalışamaz; IAS → Siparişler ise bilinçli bir tercihtir. */
  assert.equal(model.matrix.cells['mc_asas:cp'], 'locked');
  assert.equal(model.matrix.cells['mc_ias:cp'], 'locked');
  assert.equal(model.matrix.cells['mc_ias:orders'], 'on');

  // Mock-up'ın 27 hücresinden kaçının gerçek olduğu: imkânsız hücreler
  // toplamın küçümsenecek bir kısmı değil, bu yüzden açıkça sayılır.
  const states = Object.values(model.matrix.cells);
  assert.ok(states.includes('unavailable'), 'hiç imkânsız hücre üretilmedi — sınıflandırma çalışmıyor');
});

test('P2 kaynak beslemeyen modüller gizlenmez, sebebiyle listelenir', () => {
  const model = view();
  const ids = model.localModules.map(entry => entry.id);
  for (const moduleId of ['koleksiyon', 'quotations', 'pricinghistory', 'opencosting', 'shipping']) {
    assert.ok(ids.includes(moduleId), `${moduleId} listede yok — kullanıcı onu matriste arar`);
  }
  const byId = new Map(model.localModules.map(entry => [entry.id, entry]));
  assert.equal(byId.get('koleksiyon').reason, 'local');
  assert.equal(byId.get('shipping').reason, 'derived');
  assert.equal(byId.get('automations').reason, 'tool');
  // Ve bunlar matrisin satırlarında BULUNMAZ.
  assert.ok(!model.matrix.moduleIds.includes('koleksiyon'));
});

test('P2 sınırsız filtre "yenilemeye hazır" sayılmaz', () => {
  const model = view();
  const cp = model.modules.find(entry => entry.id === 'cp');
  assert.equal(cp.connectedCount, 2);
  // IAS tarafında filtre yok → CP bu hâliyle yenilenemez.
  assert.equal(cp.needsFilter, true);

  const ias = model.sources.find(entry => entry.id === 'mc_ias');
  assert.equal(ias.status, 'needs-filter');

  const asasFilter = model.filterSets.find(entry => entry.name === 'Licensing Core');
  assert.equal(asasFilter.bounded, true);
  assert.equal(asasFilter.conditionCount, 1);
  assert.match(asasFilter.text, /S7/);
});

test('P2 paylaşılan filtre kaç modül tarafından kullanıldığını söyler', () => {
  const model = view();
  const core = model.filterSets.find(entry => entry.name === 'Licensing Core');
  // normalizeScopes bağlı gruba Orders ve priceanalysis'i ekler; üç modül tek filtreyi paylaşır.
  assert.deepEqual(core.moduleIds.slice().sort(), ['backlog', 'orders', 'priceanalysis']);
  assert.equal(core.usedByCount, 3);

  const backlog = model.modules.find(entry => entry.id === 'backlog');
  const asasFeed = backlog.feeds.find(feed => feed.sourceId === 'mc_asas');
  assert.equal(asasFeed.filterName, 'Licensing Core');
  assert.equal(asasFeed.filterUsedByCount, 3);
});

test('P2 yarım kalmış koşul sessizce "sınırlı" sayılmaz', () => {
  // Alan seçili, değer yok: buildHorizonFilter istisna fırlatır.
  const described = readModel.describeFilter({
    table: 'ASAS',
    groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: [] }] }],
  });
  assert.equal(described.bounded, false);
});

test('P2 özet gerçek sayıları verir', () => {
  const model = view();
  // ASAS + IAS + varsayılan INTAKE.
  assert.equal(model.summary.sourceCount, 3);
  assert.equal(model.summary.totalFedModules, 6);
  assert.ok(model.summary.problemCount >= 1, 'filtresiz IAS sorun olarak sayılmalı');
  assert.equal(model.summary.localModuleCount, model.localModules.length);
});

test('P2 projeksiyon veritabanına bağlanmadan çalışır', () => {
  // Erişilemez bir sunucu adıyla bile ekran açılabilmeli (CLAUDE.md §10):
  // build() sorgu atmaz, yalnız kayıtlı yapılandırmayı okur.
  const model = view({ asas: { server: 'erisilemez-sunucu', catalog: 'YOK' } });
  assert.equal(model.sources.length, 3);
  assert.ok(model.sources.some(entry => entry.connection.server === 'erisilemez-sunucu'));
});

/* ------------------------------------------------------------------ */
/* v7.81 — KATMAN GÖRÜNÜRLÜĞÜ.
   Ekranda gösterilen filtre, GERÇEKTE çalışacak filtredir. Kişisel bir ufuk
   ortak kapsamı eziyorsa ortak olanı göstermek, kullanıcının "ayarı
   değiştirdim ama hiçbir şey olmadı" demesine yol açan durumun ta kendisiydi. */

function seasonHorizon(values) {
  return {
    table: 'ASAS',
    groups: [{ id: 'gp', conditions: [{ id: 'cp', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }],
  };
}

test('P3 çözümleyici verilmezse ekran katman uydurmaz', () => {
  const model = view();
  const cp = model.modules.find(entry => entry.id === 'cp');
  for (const feed of cp.feeds) assert.equal(feed.layer, 'source');
});

test('P3 kişisel ufuk ortak filtreyi ezdiğinde ekran EZEN filtreyi gösterir', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Licensing Core', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7', 'S8']) }],
    mapping: { 'Sipariş Kod': { table: 'ASAS', name: 'SK', kind: 'column', folder: '' } },
  }], null).items;

  const model = readModel.build(items, {
    language: 'tr',
    resolveLayer: ({ moduleId }) => moduleId === 'cp'
      ? { horizon: seasonHorizon(['W9']), layer: 'personal', groupName: '' }
      : { horizon: {}, layer: 'source', groupName: '' },
  });

  const feed = model.modules.find(entry => entry.id === 'cp').feeds[0];
  assert.equal(feed.layer, 'personal');
  // Gösterilen metin kişisel ufkundur, ortak olan değil.
  assert.match(feed.filterText, /W9/);
  assert.doesNotMatch(feed.filterText, /S7/);
  // Ama neyin ezildiği kaybolmaz — kullanıcı sebebi görebilmeli.
  assert.equal(feed.sharedFilterName, 'Licensing Core');
  assert.match(feed.sharedFilterText, /S7/);
  // Kişisel ufuk kimseyle paylaşılmaz; paylaşım rozeti gösterilmemeli.
  assert.equal(feed.filterUsedByCount, 0);
});

test('P3 ezen kişisel ufuk sınırsızsa modül yine "filtre gerekli" sayılır', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Licensing Core', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
  }], null).items;

  const model = readModel.build(items, {
    language: 'tr',
    // Ortak filtre sınırlı, kişisel olan boş: gerçekte çalışacak sorgu sınırsız.
    resolveLayer: () => ({ horizon: { table: 'ASAS' }, layer: 'personal', groupName: '' }),
  });
  const cp = model.modules.find(entry => entry.id === 'cp');
  assert.equal(cp.feeds[0].filterBounded, false);
  assert.equal(cp.needsFilter, true);
});

test('P3 kaldırılan katmanlar ekrana sızmaz', () => {
  /* v7.81: `preset` ve `group` katmanları kullanıcı kararıyla KALDIRILDI.
     Bu test eskiden grup adının rozette gösterildiğini kilitliyordu; artık
     böyle bir katman yok ve ekranın onu ÇİZMEMESİ gerekiyor — çözümleyici
     bir şekilde eski bir katman adı döndürse bile. */
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Licensing Core', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
  }], null).items;

  const model = readModel.build(items, {
    language: 'tr',
    resolveLayer: () => ({ horizon: seasonHorizon(['S6', 'S7']), layer: 'personal', preferenceLayer: 'personal' }),
  });
  const feed = model.modules.find(entry => entry.id === 'cp').feeds[0];
  assert.equal(feed.layer, 'personal');
  assert.equal(feed.layerKey, 'personal');
  // Ezen katmanın kendi adı yoktur; ortak filtrenin adını da taşımaz.
  assert.equal(feed.filterName, '');
  assert.equal(feed.sharedFilterName, 'Licensing Core');

  const prefs = require('../server/lib/user-preferences');
  assert.ok(!prefs.HORIZON_LAYERS.includes('group'));
  assert.ok(!prefs.HORIZON_LAYERS.includes('preset'));
});

test('P3 ezilen filtre ortak adını taşımaz', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Licensing Core', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
  }], null).items;

  const model = readModel.build(items, {
    language: 'tr',
    resolveLayer: () => ({ horizon: seasonHorizon(['W9']), layer: 'personal', groupName: '' }),
  });
  const feed = model.modules.find(entry => entry.id === 'cp').feeds[0];
  /* "Licensing Core" yazıp W9 çalıştırmak, düzeltmeye çalıştığımız yanlış
     anlamanın daha kötü hâliydi: ad ortak filtreden, içerik kişiselden. */
  assert.equal(feed.filterName, '');
  assert.match(feed.filterText, /W9/);
  assert.equal(feed.sharedFilterName, 'Licensing Core');
});

test('P3 paylaşım rozeti FİİLİ kullanımı sayar, bağ sayısını değil', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Licensing Core', targets: ['backlog'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
  }], null).items;

  // orders kişisel ufukla ezilmiş; backlog ve priceanalysis ortak filtrede.
  const model = readModel.build(items, {
    language: 'tr',
    resolveLayer: ({ moduleId, definition }) => moduleId === 'orders'
      ? { horizon: seasonHorizon(['W9']), layer: 'personal', groupName: '' }
      : { horizon: definition, layer: 'source', groupName: '' },
  });

  const backlogFeed = model.modules.find(entry => entry.id === 'backlog').feeds[0];
  // Üç modül bağlı ama ikisi çalıştırıyor: rozet 2 demeli, 3 değil.
  assert.equal(backlogFeed.boundModuleCount, 3);
  assert.equal(backlogFeed.filterUsedByCount, 2);

  const ordersFeed = model.modules.find(entry => entry.id === 'orders').feeds[0];
  assert.equal(ordersFeed.filterUsedByCount, 0, 'kişisel ufuk kimseyle paylaşılmaz');
});

/* ------------------------------------------------------------------ */
/* v7.81 (P4) — EŞLEME SAĞLIĞI EKRANA NASIL TAŞINIYOR. */

test('P4 ekrana tam katalog değil, yalnız sorunlu alanlar gider', () => {
  const modelFields = require('../server/lib/model-fields');
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) {
    mapping[field.header] = { table: 'ASAS', name: field.header, kind: 'column', folder: '' };
  }
  mapping['Ürün Tanım'] = { table: 'ASAS', name: 'Ürün Tanım Detay', kind: 'column', folder: '' };
  mapping['Lisans'] = { table: 'ASAS', name: 'Internal_Status_9', kind: 'column', folder: '' };
  delete mapping['Ana Kumaş Mı'];

  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: '', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
    mapping,
  }], null).items;

  const source = readModel.build(items, { language: 'tr' }).sources.find(entry => entry.id === 'mc_asas');

  assert.ok(source.mapping.total > 30, 'katalog gerçekten büyük');
  assert.equal(source.mapping.needsAttention, 3);
  /* Asıl kazanç burada: 38 satırlık katalog ağdan GEÇMEZ. Kullanıcının
     bakması gereken 3 satırsa, istemciye 3 satır iner. */
  assert.equal(source.mapping.problems.length, 3);
  assert.ok(!('fields' in source.mapping), 'tam alan listesi istemciye sızmamalı');

  const byHeader = new Map(source.mapping.problems.map(entry => [entry.header, entry]));
  assert.equal(byHeader.get('Lisans').status, 'foreign');
  assert.equal(byHeader.get('Ürün Tanım').status, 'weak');
  assert.equal(byHeader.get('Ana Kumaş Mı').status, 'unmapped');
  assert.equal(byHeader.get('Ana Kumaş Mı').required, true);
});

test('P4 eksik zorunlu alan, geçmiş yenileme başarılı görünse bile durumu belirler', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: '', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
    mapping: { 'Sipariş Kod': { table: 'ASAS', name: 'Sipariş Kod', kind: 'column', folder: '' } },
    lastRun: { at: new Date().toISOString(), ok: true, rowCount: 100, elapsedMs: 10, provider: '', outFile: '', error: '' },
  }], null).items;

  const source = readModel.build(items, { language: 'tr' }).sources.find(entry => entry.id === 'mc_asas');
  /* Son yenileme "ok" görünüyor ama zorunlu alanlar eksik: bir SONRAKİ
     yenileme kesin olarak MAPPING_INCOMPLETE ile duracak. Bunu "bağlı" diye
     göstermek, kullanıcının düzeltilebilir bir kurulum eksiğini geçici bir
     arıza sanmasına yol açıyordu. */
  assert.equal(source.status, 'needs-mapping');
  assert.ok(source.mapping.blocking > 0);
});

test('P4 eşlemesi temiz kaynak gözden geçirme istemez', () => {
  const modelFields = require('../server/lib/model-fields');
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) {
    mapping[field.header] = { table: 'ASAS', name: field.header, kind: 'column', folder: '' };
  }
  const items = db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 's30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: '', targets: ['cp'], enabled: true, horizon: seasonFilter('ASAS', ['S7']) }],
    mapping,
  }], null).items;

  const source = readModel.build(items, { language: 'tr' }).sources.find(entry => entry.id === 'mc_asas');
  assert.equal(source.mapping.needsAttention, 0);
  assert.deepEqual(source.mapping.problems, []);
  assert.equal(source.status, 'ready');
});
