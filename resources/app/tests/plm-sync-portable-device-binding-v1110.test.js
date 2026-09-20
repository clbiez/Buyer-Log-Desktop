'use strict';

/*
 * PLM SYNC — PAKET BAŞKA BİLGİSAYARA KOPYALANDIĞINDA
 *
 * Korunan regression: aynı portable Buyer Log klasörü ikinci bir Windows
 * makinesine kopyalandığında PLM SYNC "CoreNectum'a ulaşıyor ama modelleri
 * bulamıyor" durumuna düşüyordu. Üç ayrı sebep tek cümlenin arkasında
 * saklanıyordu ve buradaki testler üçünü de ayrı ayrı tutar:
 *
 *  1) Ayar dosyası kaynak makinenin Edge profilini/portunu paketin içinde
 *     taşıyordu (browser-debug-settings.json portable'da data\local altında).
 *  2) CoreNectum sekmesi hangi Edge profilinde açılacağı belirlenmeden
 *     açılıyordu; çok profilli makinede varsayılan profile düşüyordu.
 *  3) Arka plan taraması, yakalanan istek şablonundaki GERÇEK süzgeçleri
 *     (filterCriterias / searchCriteria / favoriteGroupId) temizlemiyordu.
 *
 * Ek olarak: tanı izi hiçbir koşulda sır taşımaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const service = require('../server/lib/browser-debug-service');
const connector = require('../server/lib/agent-browser-connector');
const diagnostics = require('../server/lib/plm-sync-diagnostics');

/* ======================================================================
   1) CİHAZ MÜHRÜ
   ====================================================================== */

test('cihaz mührü makine+kullanıcı başına ayrışır ve aynı makinede sabit kalır', () => {
  const source = { COMPUTERNAME: 'KAYNAK-PC', USERNAME: 'clbiez', BL_HOST_LOCALAPPDATA: 'C:\\Users\\clbiez\\AppData\\Local' };
  const target = { COMPUTERNAME: 'HEDEF-PC', USERNAME: 'baskakullanici', BL_HOST_LOCALAPPDATA: 'C:\\Users\\baskakullanici\\AppData\\Local' };
  assert.equal(service.deviceFingerprint(source), service.deviceFingerprint({ ...source }));
  assert.notEqual(service.deviceFingerprint(source), service.deviceFingerprint(target));
  assert.match(service.deviceFingerprint(source), /^[0-9a-f]{32}$/);
});

test('yönlendirilmiş LOCALAPPDATA mührü aynılaştırmaz: gerçek host yolu esas alınır', () => {
  // Portable pakette LOCALAPPDATA her makinede aynı paket-içi yolu gösterir.
  const redirected = 'C:\\BuyerLogPortable\\data\\portable-localappdata';
  const first = service.deviceFingerprint({ COMPUTERNAME: 'A', USERNAME: 'a', LOCALAPPDATA: redirected, BL_HOST_LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' });
  const second = service.deviceFingerprint({ COMPUTERNAME: 'B', USERNAME: 'b', LOCALAPPDATA: redirected, BL_HOST_LOCALAPPDATA: 'C:\\Users\\b\\AppData\\Local' });
  assert.notEqual(first, second);
});

test('yabancı mühürlü ayar cihaza bağlı alanları bırakır, kullanıcı tercihini korur', () => {
  const copied = { preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 3', preferredPort: 9222, enabled: true, deviceId: 'a'.repeat(32) };
  const result = service.rebindConfiguration(copied, 'b'.repeat(32));
  assert.equal(result.rebound, true);
  assert.deepEqual(result.dropped.sort(), ['enabled', 'preferredPort', 'selectedEdgeProfileDirectory']);
  assert.equal(result.configuration.selectedEdgeProfileDirectory, '');
  assert.equal(result.configuration.preferredPort, null);
  assert.equal(result.configuration.enabled, false);
  // preferredBrowser makineye bağlı değildir; taşınması zararsızdır.
  assert.equal(result.configuration.preferredBrowser, 'edge');
  assert.equal(result.configuration.deviceId, 'b'.repeat(32));
});

test('aynı makinede yeniden başlatma ayarı geri almaz', () => {
  const owned = { preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 1', preferredPort: 9310, enabled: true, deviceId: 'c'.repeat(32) };
  const result = service.rebindConfiguration(owned, 'c'.repeat(32));
  assert.equal(result.rebound, false);
  assert.equal(result.configuration.selectedEdgeProfileDirectory, 'Profile 1');
  assert.equal(result.configuration.preferredPort, 9310);
  assert.equal(result.configuration.enabled, true);
});

function copiedPackageService(storedConfig, { deviceId = 'deadbeef'.padEnd(32, '0') } = {}) {
  const configFile = path.join('C:', 'BuyerLogPortable', 'data', 'local', 'settings', 'browser-debug-settings.json');
  const writes = [];
  const fake = service.createBrowserDebugService({
    configFile,
    localDataRoot: path.join('C:', 'Users', 'hedef', 'BuyerLog'),
    deviceId,
    env: { LOCALAPPDATA: 'C:\\Users\\hedef\\AppData\\Local' },
    fs: {
      existsSync: item => item === configFile,
      readFileSync: () => JSON.stringify(storedConfig),
      readdirSync: () => [],
      mkdirSync: () => {},
    },
    writeJson: (file, value) => writes.push({ file, value }),
  });
  return { fake, writes, configFile };
}

test('paket kopyalanınca kaynak PC profili/portu ilk okumada düşer ve bir kez kalıcılaşır', () => {
  const { fake, writes, configFile } = copiedPackageService({
    preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 3', preferredPort: 9222, enabled: true, deviceId: 'facefeed'.padEnd(32, '0'),
  });
  const config = fake.loadConfiguration();
  assert.equal(config.selectedEdgeProfileDirectory, '');
  assert.equal(config.preferredPort, null);
  assert.equal(config.enabled, false, 'kaynak makinedeki "enabled" hedefte doğrulanmadan kullanılmamalı');
  assert.equal(fake.deviceBinding().rebound, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, configFile);
  fake.loadConfiguration();
  assert.equal(writes.length, 1, 'yeniden bağlama her okumada tekrar yazmamalı');
});

test('kendi makinesinde ayar okunduğunda hiçbir alan düşmez', () => {
  const own = 'deadbeef'.padEnd(32, '0');
  const { fake, writes } = copiedPackageService({
    preferredBrowser: 'edge', selectedEdgeProfileDirectory: 'Profile 1', preferredPort: 9310, enabled: true, deviceId: own,
  }, { deviceId: own });
  const config = fake.loadConfiguration();
  assert.equal(config.selectedEdgeProfileDirectory, 'Profile 1');
  assert.equal(config.preferredPort, 9310);
  assert.equal(config.enabled, true);
  assert.equal(fake.deviceBinding().rebound, false);
  assert.equal(writes.length, 0, 'değişmeyen ayar diske yeniden yazılmamalı');
});

test('hedefte var olmayan profil seçimi sessizce kullanılmaz, bayat olarak bildirilir', () => {
  const userData = path.join('C:', 'Users', 'hedef', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
  const fake = service.createBrowserDebugService({
    configFile: path.join('C:', 'yok', 'browser-debug-settings.json'),
    localDataRoot: path.join('C:', 'Users', 'hedef', 'BuyerLog'),
    env: { LOCALAPPDATA: 'C:\\Users\\hedef\\AppData\\Local' },
    fs: {
      existsSync: item => String(item).replace(/\\/g,'/').endsWith('/Microsoft/Edge/User Data/Local State'),
      readdirSync: () => [{ name: 'Default', isDirectory: () => true }],
      readFileSync: () => JSON.stringify({ info_cache: { Default: { name: 'Hedef Kullanıcı' } } }),
      mkdirSync: () => {},
    },
    writeJson: () => {},
  });
  const stale = fake.resolveProfileStrategy({ resolvedBrowser: 'edge' }, { selectedEdgeProfileDirectory: 'Profile 3' });
  assert.equal(stale.profileSelectionStale, true);
  assert.equal(stale.selectedProfileDirectory, 'Profile 3');
  assert.equal(stale.profileDirectory, 'Default');

  const fresh = fake.resolveProfileStrategy({ resolvedBrowser: 'edge' }, { selectedEdgeProfileDirectory: 'Default' });
  assert.equal(fresh.profileSelectionStale, false);
  assert.equal(fresh.profileDirectory, 'Default');
});

/* ======================================================================
   1b) "İLK PROFİL" TAHMİN EDİLMEZ — EDGE'İN KENDİ ÖLÇÜMÜ OKUNUR
   ====================================================================== */

test('kurumsal makinede kullanılan profil listenin başına gelir, Default değil', () => {
  const localState = JSON.stringify({
    info_cache: { Default: { name: 'Kişisel' }, 'Profile 1': { name: 'İş', user_name: 'buyer@lcwaikiki.com' } },
    profile: { last_used: 'Profile 1', last_active_profiles: ['Profile 1'], profiles_order: ['Default', 'Profile 1'] },
  });
  const profiles = service.parseEdgeProfiles(localState, ['Default', 'Profile 1']);
  assert.equal(profiles[0].id, 'Profile 1', 'kullanıcının açık olduğu profil ilk sırada olmalı');
  assert.equal(profiles[0].userName, 'buyer@lcwaikiki.com');
  assert.equal(profiles[1].id, 'Default');
});

test('kullanım sinyali yoksa eski sayısal sıra korunur', () => {
  const localState = JSON.stringify({ info_cache: { Default: { name: 'Kişisel' }, 'Profile 1': { name: 'İş' } } });
  const profiles = service.parseEdgeProfiles(localState, ['Profile 1', 'Default']);
  assert.deepEqual(profiles.map(item => item.id), ['Default', 'Profile 1']);
});

test('kullanım sırası tekrarsızdır ve boş değer taşımaz', () => {
  const order = service.edgeProfileUsageOrder({ profile: {
    last_active_profiles: ['Profile 2', '', 'Profile 2'],
    last_used: 'Profile 2',
    profiles_order: ['Default', 'Profile 2'],
  }});
  assert.deepEqual(order, ['Profile 2', 'Default']);
});

/* ======================================================================
   2) SEKME HANGİ EDGE PROFİLİNDE AÇILIYOR
   ====================================================================== */

function fakePage(url, browserContextId) {
  return { url: () => url, isClosed: () => false, browserContextId };
}
function fakeContext(pages) {
  return { pages: () => pages, syncPages: async () => pages };
}

test('CoreNectum sekmesi varsa profil ondan bağlanır', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    fakePage('https://www.bing.com/', 'ctx-default'),
    fakePage('https://corenectum.lcwaikiki.com/models-options/style-list', 'ctx-work'),
  ]));
  assert.equal(binding.bound, true);
  assert.equal(binding.source, 'corenectum-tab');
  assert.equal(binding.browserContextId, 'ctx-work');
});

test('CoreNectum sekmesi yoksa Buyer Log sekmesinin profili kullanılır', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    fakePage('https://www.bing.com/', 'ctx-personal'),
    fakePage('http://localhost:6194/', 'ctx-work'),
  ]));
  assert.equal(binding.source, 'buyer-log-tab');
  assert.equal(binding.browserContextId, 'ctx-work');
});

test('tek profil açıksa belirsizlik yoktur', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    fakePage('https://www.bing.com/', 'ctx-only'),
    fakePage('https://example.com/', 'ctx-only'),
  ]));
  assert.equal(binding.bound, true);
  assert.equal(binding.source, 'single-open-profile');
  assert.equal(binding.browserContextId, 'ctx-only');
});

test('çok profilli makinede referanssız sekme açılmaz: yanlış oturuma düşmek yasak', () => {
  const binding = connector.coreNectumProfileBinding(fakeContext([
    fakePage('https://www.bing.com/', 'ctx-personal'),
    fakePage('https://example.com/', 'ctx-work'),
  ]));
  assert.equal(binding.bound, false);
  assert.equal(binding.source, 'ambiguous');
  assert.equal(binding.browserContextId, '');
});

test('bağlı profil sekmesi referans sekme yoksa browserContextId ile açılır', async () => {
  const created = [];
  const context = {
    pages: () => [],
    syncPages: async () => [],
    newPage: async (url, options) => { created.push({ url, options }); return fakePage(url, (options || {}).browserContextId || ''); },
  };
  await connector.pageInBoundProfile(context, 'https://corenectum.lcwaikiki.com/models-options/style-list', { source: 'single-open-profile', browserContextId: 'ctx-work', page: null, bound: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].options.browserContextId, 'ctx-work');
});

test('referans sekme varsa sekme ondan türetilir (aynı profil kesin)', async () => {
  const reference = fakePage('http://localhost:6194/', 'ctx-work');
  let fromReference = null;
  const context = {
    pages: () => [reference],
    syncPages: async () => [reference],
    newPage: async () => { throw new Error('referans varken newPage kullanılmamalı'); },
    newPageFrom: async (page, url) => { fromReference = { page, url }; return fakePage(url, page.browserContextId); },
  };
  const page = await connector.pageInBoundProfile(context, 'https://corenectum.lcwaikiki.com/models-options/style-list', { source: 'buyer-log-tab', browserContextId: 'ctx-work', page: reference, bound: true });
  assert.equal(fromReference.page, reference);
  assert.equal(page.browserContextId, 'ctx-work');
});

/* ======================================================================
   2b) SEÇİLİ MODELLER KULLANICININ AÇIK SEKMESİNDEN OKUNUR
   ====================================================================== */

test('seçili model akışı Buyer Log\'un açtığı boş sekmeden okuma yapmaz', () => {
  const SOURCE = require('node:fs').readFileSync(require.resolve('../server/lib/agent-browser-connector.js'), 'utf8');
  // Sekmeyi yeniden kullanıp kullanmadığımız açıkça izlenir…
  assert.match(SOURCE, /const reusedStyleListTab=Boolean\(page\);/);
  // …ve seçim okunmadan ÖNCE eksik sekme ayrı bir kodla reddedilir.
  assert.match(SOURCE, /if\(selectedOnly\)throw[\s\S]{0,500}?CORENECTUM_STYLE_LIST_TAB_MISSING/);
  assert.match(SOURCE, /'CORENECTUM_STYLE_LIST_TAB_MISSING'/);
  // Sekme var ama işaret yoksa sebep AYRI kalır.
  assert.match(SOURCE, /'CORENECTUM_SELECTED_ITEMS_EMPTY'/);
  // Kontrol, seçimi okuyan çağrıdan önce gelmeli.
  const guard = SOURCE.indexOf('if(selectedOnly)throw');
  const read = SOURCE.indexOf('await coreNectumSelectedStyleRows(page)');
  assert.ok(guard > 0 && read > 0 && guard < read, 'eksik sekme kontrolü seçim okumasından önce olmalı');
});

/* ======================================================================
   3) ARKA PLAN TARAMASININ İSTEK GÖVDESİ
   ====================================================================== */

test('GetStyleList süzgeç sözleşmesi taramada gerçekten temizlenir', () => {
  const captured = {
    pageNumber: 4,
    pageSize: 100,
    filterCriterias: [{ filterColumnName: 'seasonName', filterOperator: 1, filterValue: '2026 KIS' }],
    searchCriteria: { columnNames: ['styleName'], searchText: 'triko' },
    favoriteGroupId: 42,
  };
  const body = connector.coreNectumUnfilteredRequestBody(captured);
  assert.deepEqual(body.filterCriterias, []);
  assert.deepEqual(body.searchCriteria, { columnNames: [], searchText: '' }, 'searchCriteria yerinde boşaltılmalı, şekli korunmalı');
  assert.equal(body.favoriteGroupId, null);
  // Sayfalama alanları taramanın kendi mekanizmasıdır; dokunulmaz.
  assert.equal(body.pageSize, 100);
  assert.equal(body.pageNumber, 4);
});

test('yetki/kapsam alanları temizlenmez: tarama kullanıcının kapsamını genişletemez', () => {
  const body = connector.coreNectumUnfilteredRequestBody({
    securityScope: { tenants: ['LCW'], filters: ['brand-1'], searchCriteria: { searchText: 'korunmalı' } },
    permissions: { filters: ['p1'] },
    filterCriterias: [{ filterColumnName: 'plmCode', filterValue: '1' }],
  });
  assert.deepEqual(body.securityScope.filters, ['brand-1']);
  assert.deepEqual(body.securityScope.tenants, ['LCW']);
  assert.equal(body.securityScope.searchCriteria.searchText, 'korunmalı');
  assert.deepEqual(body.permissions.filters, ['p1']);
  assert.deepEqual(body.filterCriterias, []);
});

/* ======================================================================
   4) TANI İZİ — SIRSIZ VE AYIRT EDİCİ
   ====================================================================== */

test('tanı izi sır taşımaz: gizli anahtar ve token görünümlü değer düşer', () => {
  const safe = diagnostics.safeDetail({
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc',
    cookie: 'session=1',
    access_token: 'abc123',
    refreshToken: 'x',
    present: true,
    status: 200,
    origin: 'https://corenectum.lcwaikiki.com',
  });
  assert.deepEqual(Object.keys(safe).sort(), ['origin', 'present', 'status']);
  assert.equal(safe.present, true);
  assert.equal(safe.status, 200);
  // Anahtar masum olsa bile JWT/Bearer görünümlü değer taşınmaz.
  assert.equal(diagnostics.safeValue('Bearer abc'), undefined);
  assert.equal(diagnostics.safeValue('eyJhbGciOiJIUzI1NiJ9xxxxxxxx'), undefined);
  assert.equal(diagnostics.safeValue('a'.repeat(48)), undefined);
  assert.equal(diagnostics.safeValue('JWT'), 'JWT');
});

test('iz aynı aşamayı tekrar yazmaz ve sıraya sadık kalır', () => {
  const trail = diagnostics.createTrail();
  trail.record('CDP_CONNECTED', { connected: true, port: 9222 });
  trail.record('AUTH_STATE', { present: true, format: 'JWT' });
  trail.record('CDP_CONNECTED', { connected: true, port: 9310 });
  trail.record('GECERSIZ_ASAMA', { x: 1 });
  assert.deepEqual(trail.stages(), ['CDP_CONNECTED', 'AUTH_STATE']);
  assert.equal(trail.get('CDP_CONNECTED').port, 9310);
});

test('"0 model bulundu" beş ayrı sebepten ayrılır', () => {
  const classify = entries => diagnostics.classify(entries).code;

  assert.equal(classify([{ stage: 'BROWSER_DISCOVERED', found: false }]), 'EDGE_NOT_FOUND');

  assert.equal(classify([
    { stage: 'BROWSER_DISCOVERED', found: true },
    { stage: 'CDP_CONNECTED', connected: false },
  ]), 'BROWSER_CDP_NOT_READY');

  assert.equal(classify([
    { stage: 'BROWSER_DISCOVERED', found: true },
    { stage: 'CDP_CONNECTED', connected: true },
    { stage: 'BROWSER_PROFILE_RESOLVED', bound: false, source: 'ambiguous' },
  ]), 'BROWSER_PROFILE_UNBOUND');

  assert.equal(classify([
    { stage: 'CDP_CONNECTED', connected: true },
    { stage: 'BROWSER_PROFILE_RESOLVED', bound: true },
    { stage: 'CORENECTUM_PAGE_READY', ready: true },
    { stage: 'AUTH_STATE', present: false, format: 'MISSING' },
  ]), 'CORENECTUM_LOGIN_REQUIRED');

  assert.equal(classify([
    { stage: 'AUTH_STATE', present: true, format: 'JWT' },
    { stage: 'STYLE_LIST_HTTP_STATUS', status: 403, ok: false },
  ]), 'CORENECTUM_LOGIN_REQUIRED');

  assert.equal(classify([
    { stage: 'AUTH_STATE', present: true, format: 'JWT' },
    { stage: 'STYLE_LIST_HTTP_STATUS', status: 500, ok: false },
  ]), 'CORENECTUM_API_HTTP_ERROR');

  // İstek başarılı, evren BOŞ: model "bulunamadı" değildir.
  assert.equal(classify([
    { stage: 'AUTH_STATE', present: true, format: 'JWT' },
    { stage: 'STYLE_LIST_HTTP_STATUS', status: 200, ok: true },
    { stage: 'STYLE_LIST_RESPONSE_RECORDS', records: 0, requested: 12 },
  ]), 'CORENECTUM_SCOPE_EMPTY');

  // Kayıt geldi ama istenen PLM'ler yok: GERÇEK "bulunamadı".
  assert.equal(classify([
    { stage: 'AUTH_STATE', present: true, format: 'JWT' },
    { stage: 'STYLE_LIST_HTTP_STATUS', status: 200, ok: true },
    { stage: 'STYLE_LIST_RESPONSE_RECORDS', records: 8400, requested: 12 },
    { stage: 'STYLE_LIST_NORMALIZED', matched: 0, requested: 12 },
  ]), 'CORENECTUM_STYLE_NOT_FOUND');

  assert.equal(classify([
    { stage: 'STYLE_LIST_HTTP_STATUS', status: 200, ok: true },
    { stage: 'STYLE_LIST_RESPONSE_RECORDS', records: 8400, requested: 12 },
    { stage: 'STYLE_LIST_NORMALIZED', matched: 12, requested: 12 },
  ]), 'OK');
});

test('iz bir hataya iliştirilince HTTP yanıtına details.diagnostics olarak çıkar', () => {
  const trail = diagnostics.createTrail();
  trail.record('AUTH_STATE', { present: false, format: 'MISSING' });
  const error = diagnostics.attach(Object.assign(new Error('test'), { code: 'CORENECTUM_LOGIN_REQUIRED' }), trail);
  assert.deepEqual(error.details.diagnostics, [{ stage: 'AUTH_STATE', present: false, format: 'MISSING' }]);
});

/* ======================================================================
   5) OTURUM YOKLAMASI — DEĞER DEĞİL DURUM
   ====================================================================== */

test('oturum yoklaması yalnız durum döndürür; anahtarın kendisi sayfadan çıkmaz', () => {
  const expression = connector.CORENECTUM_AUTH_PROBE_EXPRESSION;
  // Yoklamanın döndürdüğü nesne tam olarak dört alandır.
  const returned = expression.match(/return \{present:[^}]*\}/g) || [];
  assert.ok(returned.length >= 1, 'yoklama bir durum nesnesi döndürmeli');
  for (const item of returned) {
    assert.match(item, /present:/);
    assert.match(item, /format:/);
    assert.match(item, /cookies(?:,|:)/);
    assert.ok(!/raw|value:value|body:body|document\.cookie\)/.test(item), `ham değer döndürülmemeli: ${item}`);
  }
  // Uzunluk/biçim okunur, içerik okunmaz.
  assert.match(expression, /body\.length>0/);
  assert.match(expression, /document\.cookie\|\|''\)\.length>0/);
});
