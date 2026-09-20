'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const planner = require('../server/lib/horizon-source-planner');
const modelFields = require('../server/lib/model-fields');
const modelRefresh = require('../server/lib/model-refresh');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('v1000 query fingerprint is deterministic and ignores object key order', () => {
  const a = planner.queryFingerprint({ connectionId: 'asas-1', filters: { season: ['W6'], mag: ['CU4E'] }, fields: ['A', 'B'] });
  const b = planner.queryFingerprint({ fields: ['A', 'B'], filters: { mag: ['CU4E'], season: ['W6'] }, connectionId: 'asas-1' });
  const c = planner.queryFingerprint({ connectionId: 'asas-1', filters: { season: ['W7'] }, fields: ['A', 'B'] });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('v1000 in-flight source coordinator executes an equivalent concurrent plan once', async () => {
  const coordinator = planner.createSourceQueryCoordinator();
  let calls = 0;
  const plan = { connectionId: 'asas-1', query: "EVALUATE 'Siparis'", requiredFields: ['Sipariş Kod'] };
  const runner = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 10)); return { rows: [1] }; };
  const [left, right] = await Promise.all([coordinator.run(plan, runner), coordinator.run({ query: plan.query, requiredFields: plan.requiredFields, connectionId: plan.connectionId }, runner)]);
  assert.deepEqual(left, right);
  assert.equal(calls, 1);
  assert.equal(coordinator.metrics().actualRequests, 1);
  /* v7.81 — sonuç artık KOŞUM BOYUNCA tutulur, tamamlanınca silinmez.
     Eskiden birleştirme yalnız plan uçuştayken çalışıyordu; ardışık çalışan
     özdeş bir plan aynı veriyi ikinci kez sorguya götürüyordu. Temizlik
     sözleşmesi kaybolmadı, yeri değişti: koşum bitince clear() boşaltır. */
  assert.equal(coordinator.metrics().retained, 1);
  coordinator.clear();
  assert.equal(coordinator.metrics().retained, 0);
});

test('v7.81 ardışık çalışan özdeş plan da tek sorguya iner', async () => {
  const coordinator = planner.createSourceQueryCoordinator();
  let calls = 0;
  const plan = { connectionId: 'asas-1', query: "EVALUATE 'Siparis'", requiredFields: ['Sipariş Kod'] };
  const runner = async () => { calls += 1; return { rows: [1] }; };
  // Bilerek ARDIŞIK: ilki tamamen bitmeden ikincisi başlamıyor.
  const first = await coordinator.run(plan, runner);
  const second = await coordinator.run({ ...plan }, runner);
  assert.deepEqual(first, second);
  assert.equal(calls, 1, 'ardışık özdeş plan ikinci kez sorguya gitmemeli');
  assert.equal(coordinator.metrics().reusedRequests, 1);
});

test('v7.81 başarısız plan koşumun geri kalanını zehirlemez', async () => {
  const coordinator = planner.createSourceQueryCoordinator();
  const plan = { connectionId: 'asas-1', query: 'EVALUATE X' };
  let attempt = 0;
  const runner = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('geçici ağ arızası');
    return { rows: [7] };
  };
  await assert.rejects(() => coordinator.run(plan, runner), /geçici ağ arızası/);
  // Hata SAKLANMAMALI: aynı plan yeniden denendiğinde gerçekten çalışmalı.
  const retry = await coordinator.run({ ...plan }, runner);
  assert.deepEqual(retry, { rows: [7] });
  assert.equal(attempt, 2);
});

test('v1000 compatible linked targets share one real model-refresh execution', async () => {
  let calls = 0;
  const mapping = Object.fromEntries(modelFields.fieldsForRole('asas')
    .filter(field => field.required)
    .map(field => [field.header, { table: 'ASAS', name: field.header, kind: 'column' }]));
  const scope = target => ({
    id: `scope-${target}`,
    targets: [target],
    enabled: true,
    horizon: { table: 'ASAS', groups: [] },
  });
  const result = await modelRefresh.loadFromModelConnections([{
    id: 'mc-asas-linked', name: 'ASAS', role: 'asas', refreshEnabled: true,
    server: 'db', catalog: 'ASAS', mode: 'auto', mapping,
    mappingEnhancementScanVersion: 2,
    scopes: [scope('orders'), scope('lfl'), scope('priceanalysis')],
  }], {
    targets: ['orders', 'lfl', 'priceanalysis'],
    includeAntrepo: false,
    includeAsas: true,
    includeLfl: true,
    maxConcurrency: 3,
    runModelRows: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        rows: [{
          'Sipariş Kod': 'A', 'Model Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk': 'SİYAH',
          'Net Alım Sipariş Miktarı': 100, 'Kalan Alım Sipariş Miktarı': 100,
          'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6',
          'Orijinal Exfactory Merch Tarih': '2026-09-01', 'Ana Kumaş Mı': 1,
        }],
        elapsedMs: 2, provider: 'test',
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.queryMetrics.actualRequests, 1);
  assert.equal(result.runs.length, 1);
  assert.equal(result.asasOrdersByTarget.orders.length, 1);
  assert.equal(result.asasOrdersByTarget.priceanalysis.length, 1);
});

test('v1000 horizon groups are user-scoped records without duplicated credentials', () => {
  const group = planner.normalizeHorizonGroup({
    id: 'g1', name: 'S7 Merch', moduleIds: ['orders', 'lfl', 'priceanalysis', 'unknown'],
    connectionId: 'mc-asas', horizon: { groups: [{ conditions: [] }], linkedGroupId: 'must-not-persist' },
  }, ['orders', 'lfl', 'priceanalysis']);
  assert.deepEqual(group.moduleIds, ['orders', 'lfl', 'priceanalysis']);
  assert.equal(group.connectionId, 'mc-asas');
  assert.equal(group.horizon.linkedGroupId, undefined);
  assert.equal(group.password, undefined);
});

test('v1000 kaynak/filtre için TEK normal giriş noktası vardır', () => {
  /* Korunan karar aynı: kullanıcıya aynı işi yapan iki kapı
     gösterilmemeli. v7.81'de kapı sayısı İKİDEN BİRE indi — kişisel ufuk
     katmanı ve onun sayfa rozetindeki düzenleyicisi kaldırıldı. Geriye
     yalnız Veri Yönetimi kaldı. */
  const index = read('public/index.html');
  const app = read('public/app-main.js');

  // Eski modal tamamen gitti; hiçbir yerden açılmıyor.
  assert.doesNotMatch(app, /openModelConnectionModal/);
  // Kişisel ufuk düzenleyicisi de gitti: ikinci kapı yok.
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'horizon-editor.js')), false);
  assert.doesNotMatch(app, /BLHorizonEditor/);
  // Veri Yönetimi kapısı duruyor.
  assert.match(app, /function openDataSourceAndFilters\(/);
  assert.match(index, /id="railDataMgmtBtn"|data-tab="source"/);
});

test('v7.81 modül başlığı hiçbir ufuk eylemine devretmez', () => {
  /* KARAR TERSİNE ÇEVRİLDİ (kullanıcı isteği): başlık eskiden kişisel
     ufuk akışına devrediyordu. Artık "sadece seçili horizonun filtre
     özeti" görünür; devredecek bir eylem yok. */
  const app = read('public/app-main.js');
  /* YORUMLAR ELENİR: kaldırma notları bu adları anıyor. */
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /data-horizon-action/);
  assert.doesNotMatch(code, /horizonCompactHeader/);
  assert.doesNotMatch(code, /openCompactHorizonManager\(/);
  /* Özet artık state'ten okunur (modelScopes + appliedHorizons); ayrı uç
     kaldırıldı çünkü rozet çizimi ağ isteği atmamalı. */
  assert.match(code, /horizonSummaryChip/, 'başlık filtre özetini çizmeli');
  assert.match(code, /state\.modelScopes/, 'özet kaynak kapsamından okumalı');
});

/* v7.81 — v1002 ve v1003 KALDIRILDI.

   İkisi de silinen bağlantı modalının İÇ DÜZENİNİ kilitliyordu: sekmeli
   çalışma alanı, katlanabilir bölümler, yapışkan başlık/altlık. O ekran artık
   yok; iddiaları taşıyacak bir yer de yok, çünkü ortak ayarlar Veri Yönetimi
   ekranının kendi düzenine taşındı (tests/data-management-ui-v781.test.js).

   Altlarındaki asıl güvence — kişisel ufkun modül kapsamlarını göstermesi —
   v1006/v1007'nin yerine geçen testlerde korunuyor. */

test('v7.81 başlıkta eylem satırı yok, yalnız özet çipleri var', () => {
  /* Eskiden filtre çipleri Horizon denetimleriyle aynı satırı paylaşıp
     sağa yaslanıyordu. Denetimler kalktı; geriye sade bir özet kaldı. */
  const app = read('public/app-main.js');
  assert.doesNotMatch(app, /horizonCompactFilters/);
  assert.match(app, /horizonSummaryChip/);
  assert.match(app, /horizonSummarySource/);
});

test('v1005 Link Modules text entry does not depend on native prompt()', () => {
  const app = read('public/app-main.js');
  assert.match(app, /function openHorizonTextInput\(/, 'Horizon için uygulama içi metin girişi olmalı');
  /* v7.81 — kompakt Horizon eylem bloğu kaldırıldı; incelenecek dilim yok. */
  assert.doesNotMatch(app.slice(app.indexOf('function renderHorizonBadges()'), app.indexOf('function renderHorizonBadges()') + 3000), /\bprompt\s*\(/, 'başlık özeti native prompt kullanmamalı');
  /* v7.81: eski bağlantı modalı silindi. Korunan kusur AYNEN geçerli ve artık
     onun yerine geçen iki yüzeyde sınanıyor. native prompt() bastırıldığında
     null döner ve "vazgeçildi"den ayırt edilemez; üstelik uygulamanın kendi
     görsel diline de ait değildir.

     ÖNEMLİ: bu iddia indexOf(-1) ile boş bir dilime bakıp sessizce geçemez —
     dosyalar doğrudan okunur. */
  /* horizon-editor.js v7.81'de silindi (kişisel ufuk kaldırıldı). */
  for (const rel of ['public/data-management.js',
    'public/data-management-filter.js', 'public/data-management-matchrule.js',
    'public/data-management-cpcolumns.js', 'public/data-management-query.js',
    'public/data-management-connection.js']) {
    /* YORUMLAR ELENİR. Bu dosyaların kendi açıklamaları "native prompt()
       kullanılmaz" diye yazıyor; ham eşleştirme o cümleyi kod sanardı. */
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /(^|[^.\w])prompt\s*\(/m, `${rel} native prompt kullanmamalı`);
  }
  // Yerine uygulamanın kendi metin girişi kullanılır.
  assert.match(read('public/data-management.js'), /openHorizonTextInput\(\{/);
});

test('v7.81 her modülün ufku KENDİ kapsamından okunur', () => {
  /* Korunan kusur aynı kökten: kullanıcı bir modülün ufkunu görmeden
     değiştirmemeli. Kişisel düzenleyici kalkınca sorun kökünden çözüldü —
     ufuk modül başına kaynak kapsamından gelir ve rozet her modülde
     kendi kapsamını ayrı gösterir. */
  const app = read('public/app-main.js');
  const at = app.indexOf('function renderHorizonBadges()');
  assert.ok(at > -1, 'renderHorizonBadges yok');
  const block = app.slice(at, app.indexOf('\n}\n', at));
  assert.match(block, /byTarget\[entry\.target\]=entry/, 'kapsamlar modüle göre indekslenmeli');
  assert.match(block, /horizonBadgeScope\(byTarget,target\)/, 'her modül kendi kapsamını almalı');
});
