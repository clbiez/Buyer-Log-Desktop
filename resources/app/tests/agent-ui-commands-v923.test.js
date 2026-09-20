'use strict';

/* v9.23 — AJAN KULLANICININ EKRANINDA İŞ YAPIYOR.
 *
 * V1'in ikinci yarısı: ajan artık yalnız cevap üretmiyor, "AW27 modellerini
 * Koleksiyon'da göster" dendiğinde ekranı gerçekten açıp filtreyi uyguluyor.
 *
 * NEDEN SEÇİCİ OTOMASYONU DEĞİL: modele CSS seçici ya da tıklama adımı
 * ürettirmek arayüzün her değişiminde bozulur ve uydurulmuş bir seçici sessizce
 * yanlış yere tıklar. Bunun yerine sunucu DOĞRULANMIŞ bir komut zarfı üretir
 * (kapalı küme: navigate / filter / clearFilters), istemci uygular.
 *
 * TARAYICIDA ÖLÇÜLDÜ: CP ekranında Season=AW27 filtresi gerçekten uygulandı;
 * Koleksiyon'da uygulanmadı çünkü o ekran kendi filtre mekanizmasını kullanıyor
 * (COLS_BY_TABLE yalnız cp / orders / ship taşıyor). Bu fark kayıt defterinde
 * agentFilter olarak ayrı tutulur — capabilities'teki 'filter' KULLANICI için
 * doğrudur, agentFilter AJANIN yolu içindir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../server/lib/module-registry');
const bus = require('../public/copilot-ui-commands.js');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');
const copilot = require('../server/lib/copilot-agent');

const canonicalFields = require('../public/canonical-fields.js');
require('../public/canonical-module-bindings.js')(canonicalFields);

const userAccess = { hasArea: (p, area) => (p && p.areas || []).includes(area), appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon', 'shipping', 'overview'] };
function tools(rows = [{ Season: 'AW27', Manufacturer: 'ABC', FOB: 10 }]) {
  return createToolRegistry({ userAccess, getDataset: async () => rows, listDatasets: async () => [{ id: 'cp', allowed: true }] });
}
/* Gerçek uygulama fonksiyonlarının yerine geçen kabuk: DOM gerekmez,
   böylece komut yolu tarayıcısız sınanabilir. */
function fakeApp() {
  const calls = { tabs: [], rendered: [] };
  const state = { colFilters: {} };
  return {
    calls, state,
    runner: bus.createRunner({
      canonicalFields, state,
      switchTab: tab => { calls.tabs.push(tab); return true; },
      colsByTable: { cp: [{ k: 'Season' }, { k: 'Manufacturer' }], orders: [{ k: 'Season' }] },
      rerender: key => calls.rendered.push(key),
    }),
  };
}

/* ------------------------------------------------- 1) KAPALI KOMUT KÜMESİ */

test('v9.23 komut kümesi kapalı; bilinmeyen komut uygulanmaz', () => {
  /* v11.10 — kümeye modelImages eklendi. Korunan regresyon değişmedi: küme
     KAPALIDIR, model kendi komutunu uyduramaz ve DOM'a tıklayamaz. */
  assert.deepEqual(bus.COMMANDS, ['navigate', 'filter', 'clearFilters', 'modelImages']);
  const app = fakeApp();
  const out = app.runner.run([{ command: 'deleteEverything', module: 'cp' }, { command: 'eval', code: '1+1' }]);
  assert.ok(out.every(item => item.ok === false && item.reason === 'unsupported'));
  assert.deepEqual(app.calls.tabs, [], 'hiçbir şey çalıştırılmamalı');
});

test('v9.23 komutlar sırayla uygulanır ve her biri ayrı raporlanır', () => {
  /* Kısmi başarı sessizce tam başarı gibi görünmemeli: "uyguladım" demeden
     önce gerçekten uygulandığını bilmek gerekir (§26). */
  const app = fakeApp();
  const out = app.runner.run([
    { command: 'navigate', module: 'cp', route: 'cp' },
    { command: 'filter', module: 'cp', tableKey: 'cp', route: 'cp', source: 'cp', field: 'Season', canonicalId: 'season', values: ['AW27'] },
    { command: 'filter', module: 'cp', tableKey: 'cp', route: 'cp', source: 'cp', field: 'uydurma_alan', canonicalId: null, values: ['x'] },
  ]);
  assert.deepEqual(out.map(item => item.ok), [true, true, false]);
  assert.equal(out[2].reason, 'field-unknown');
  // Başarısız olan biri diğerlerini engellememeli.
  assert.equal([...app.state.colFilters.cp.Season.values][0], 'AW27');
  assert.match(bus.describe(out, true), /uygulanamadı/);
});

/* -------------------------------------------- 2) KANONİK ALAN ÇÖZÜMLEMESİ */

test('v9.23 alan adı kanonik kayıttan çözülüyor, tahminle değil', () => {
  /* Dataset alan anahtarı ile tablo sütun anahtarı aynı olmak zorunda değil.
     Eşlemeyi burada tekrar yazmak iki kaynak yaratırdı; kanonik kayıt tektir. */
  const columns = [{ k: 'Season' }, { k: 'Manufacturer' }];
  assert.equal(bus.resolveColumnKey('cp', { canonicalId: 'season', field: 'season' }, columns, canonicalFields), 'Season');
  // Alias da çözülmeli: canonical 'manufacturer' → tablodaki gerçek sütun.
  assert.equal(bus.resolveColumnKey('cp', { canonicalId: 'manufacturer', field: 'manufacturer' }, columns, canonicalFields), 'Manufacturer');
  // Uydurulmuş alan null döner; sessizce boş filtre uygulanmaz.
  assert.equal(bus.resolveColumnKey('cp', { canonicalId: null, field: 'yok_boyle' }, columns, canonicalFields), null);
});

test('v9.23 kanonik kayıt enjekte edilebilir', () => {
  // window'a bağlanmak modülü test edilemez kılıyordu ve bağ gereksizdi.
  assert.equal(bus.resolveColumnKey('cp', { canonicalId: 'season', field: 'Season' }, [{ k: 'Season' }], null), 'Season');
});

/* ----------------------------------------------------- 3) SUNUCU ZARFI */

test('v9.23 ui.filter zarfı istemcinin ihtiyaç duyduğu üç adı da taşıyor', async () => {
  /* Aynı şeyin üç adı var: modül 'cp', tablo 'cp', dataset 'cp' — ama
     Koleksiyon'da bunlar koleksiyon / kol / collection diye AYRIŞIYOR.
     İstemci tahmin etmek zorunda kalmamalı. */
  const result = await tools().execute('ui.filter',
    { module: 'cp', field: 'Season', values: ['AW27'] }, { profile, ownerId: 'u1' });
  const command = result.uiCommand;
  assert.equal(command.command, 'filter');
  assert.equal(command.module, 'cp');
  assert.equal(command.tableKey, 'cp');
  assert.equal(command.source, 'cp');
  assert.equal(command.canonicalId, 'season');
  assert.deepEqual(command.values, ['AW27']);
});

test('v9.23 yetkisiz ekran açılamıyor', async () => {
  await assert.rejects(() => tools().execute('ui.navigate', { module: 'lfl' }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'AREA_FORBIDDEN');
  /* Ekranı olmayan modüle gidilemez. v7.81'e kadar örnek 'source' idi;
     Kaynak Veri artık Veri Yönetimi ekranına sahip olduğu için örnek
     gerçekten rotasız olan 'agents' ile verilir. Sözleşme aynı. */
  await assert.rejects(() => tools().execute('ui.navigate', { module: 'agents' }, { profile: { areas: ['agents'] }, ownerId: 'u1' }),
    error => error && error.code === 'MODULE_NOT_NAVIGABLE');
  // Ve yetkisi olan kullanıcı Veri Yönetimi ekranına artık gidebilir.
  await assert.doesNotReject(() => tools().execute('ui.navigate', { module: 'source' }, { profile: { areas: ['source'] }, ownerId: 'u1' }));
});

test('v9.23 uydurulmuş filtre değeri sunucuda durduruluyor', async () => {
  // Alan gerçekten o datasette olmalı; yoksa istemcide sessizce boş filtre olur.
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'cp', field: 'uydurma_alan', values: ['x'] }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'DATASET_FIELD_NOT_FOUND');
  // Değersiz filtre de anlamsız.
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'cp', field: 'Season', values: [] }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'FILTER_VALUE_REQUIRED');
});

/* --------------------------------- 4) AJAN YOLU ile KULLANICI YOLU AYRI */

test('v9.23 ajanın filtreleyebildiği ekranlar kayıt defterinde işaretli', () => {
  const agentFilterable = registry.list().filter(m => m.agentFilter).map(m => m.id).sort();
  assert.deepEqual(agentFilterable, ['cp', 'orders', 'shipping']);
  // Koleksiyon KULLANICI için filtrelenebilir ama ajanın yolu onu kapsamıyor.
  assert.ok(registry.get('koleksiyon').capabilities.includes('filter'));
  assert.equal(registry.get('koleksiyon').agentFilter, false);
  // Doğrulama bu ikisinin çelişmesine izin vermemeli.
  assert.equal(registry.validate().ok, true);
});

test('v9.23 kapsam dışı ekranda ajana ne yapabileceği söyleniyor', async () => {
  /* Yalnız "yapamam" demek modeli aynı ekranı tekrar denemeye iter. */
  await assert.rejects(() => tools().execute('ui.filter',
    { module: 'koleksiyon', field: 'season', values: ['AW27'] }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'MODULE_NOT_FILTERABLE' && /Filtreleyebildiğim ekranlar/.test(error.message));
});

/* -------------------------------------------------- 5) AJAN SÖZLEŞMESİ */

test('v9.23 ui araçları onaysız çalışır ama veriye dokunmaz', () => {
  const ids = copilot.toolCatalog(tools()).map(tool => tool.id);
  assert.ok(ids.includes('ui.navigate') && ids.includes('ui.filter') && ids.includes('ui.clear_filters'));
  // 'ui' katmanı okuma ile aynı sınıfta: "Mart'takileri göster" için onay
  // kutusu çıkarmak kullanıcıyı boşuna yavaşlatırdı.
  const policy = createPolicyEngine({ userAccess });
  const decision = policy.evaluate(profile, { id: 'ui.filter', risk: 'ui', area: '' }, {}, {});
  assert.equal(decision.allowed, true);
  assert.equal(decision.approvalRequired, false);
  // Ama bilinmeyen bir risk katmanı sessizce serbest kalmamalı.
  const unknown = policy.evaluate(profile, { id: 'x.y', risk: 'birseyler', area: '' }, {}, {});
  assert.equal(unknown.approvalRequired, true);
});

test('v9.23 saf aksiyon turu "araç kullanılmadı" diye reddedilmiyor', async () => {
  /* "Göster" isteğinde ajan ui.filter çağırıp işi YAPIYOR ama hiçbir dataset.*
     aracı kullanmıyordu; grounding kapısı bunu iş saymayıp turu düşürüyordu. */
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => {
      let index = 0;
      const turns = [
        { toolCalls: [{ id: 'call1', name: 'ui__filter', args: { module: 'cp', field: 'Season', values: ['AW27'] } }] },
        { content: 'CP ekranında AW27 filtresi uygulandı.' },
      ];
      return {
        config: { provider: 'ollama', model: 'test' },
        async chat() {
          const turn = turns[Math.min(index++, turns.length - 1)];
          return { content: turn.content || '', toolCalls: turn.toolCalls || [], model: 'test' };
        },
      };
    },
  });
  const result = await assistant.respond({
    question: 'AW27 modellerini CP ekranında göster.', ownerId: 'u1', profile,
    toolRegistry: tools(), policyEngine: createPolicyEngine({ userAccess }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.uiCommands.length, 1, 'komut zarfı cevapla taşınmalı');
  assert.equal(result.uiCommands[0].command, 'filter');
});

test('v9.23 sistem promptu ajana ekranda iş yapmasını söylüyor', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  const start = source.indexOf('function systemPrompt(');
  const block = source.slice(start, source.indexOf('function likelyBusinessFact', start));
  assert.match(block, /do not just describe it — call ui\.navigate or ui\.filter/);
});
