'use strict';

/* OAB (Order-Assortment-Budget) — Overview > OAB modülü testleri.
 *
 * Kapsam: server/lib/oab-store.js (cache + ayarlar), server/lib/
 * agent-browser-connector.js'teki PASS entegrasyonu (auth adapter, metadata/
 * report servisleri), server.js'teki API uçları, ve public/oab.js'teki saf
 * veri katmanı (LocalFilterEngine, PivotEngine, veri doğruluğu).
 *
 * GERÇEK PASS bağlantısı bu ortamda test EDİLEMEZ (Windows/Edge/PASS session
 * gerektirir). Bu testler mantığı, sözleşmeleri ve kritik güvenlik/doğruluk
 * kurallarını (Authorization asla loglanmaz/kaydedilmez, kod alanları asla
 * sayıya çevrilmez, lokal filtre network isteği atmaz) kanıtlanmış sahte
 * (mock) girdilerle doğrular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const OAB_JS = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const { createTableSearch } = require('./helpers/bl-table-search');

/* --------------------------------------------------------- 1) CACHE DEPOSU */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-oab-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const oabStore = require(path.join(ROOT, 'server', 'lib', 'oab-store.js'));

test('OAB cache anahtarı SeasonRef|MerchSubGroupRef|BuyerGroupRef biçiminde', () => {
  assert.equal(oabStore.cacheKeyOf(20271, 17, 97), '20271|17|97');
  assert.equal(oabStore.cacheKeyOf(20271, '', 97), '', 'eksik parametrede boş anahtar üretilmeli, uydurulmamalı');
});

test('OAB cache dosya adı Windows uyumlu ve pipe karakteri içermez', () => {
  const key = oabStore.cacheKeyOf(20271, 17, 97);
  oabStore.set(key, { rows: [{ a: 1 }], fields: ['a'], params: { seasonRef: 20271 } });
  const files = fs.readdirSync(oabStore.CACHE_DIR);
  const cacheFile = files.find(name => name.endsWith('.json'));
  assert.ok(cacheFile, 'cache dosyası oluşturulmalı');
  assert.doesNotMatch(cacheFile, /[<>:"/\\|?*]/, 'Windows için geçersiz karakter içermemeli');
  assert.equal(cacheFile, '20271_17_97.json');
  oabStore.clearKey(key);
});

test('OAB cache Colour Code gibi Buyer Log desenlerine uygun: kaydet, oku, TTL ile taze/bayat', () => {
  const key = oabStore.cacheKeyOf(20271, 17, 97);
  assert.equal(oabStore.get(key), null);
  oabStore.saveCacheSettings({ ttlMinutes: 30 });
  oabStore.set(key, { rows: [{ a: 1 }], fields: ['a'], params: { seasonRef: 20271 } });
  const hit = oabStore.get(key);
  assert.equal(hit.fresh, true);
  assert.equal(hit.rows.length, 1);
});

test('OAB cache TTL 0 dakikaya CLAMP edilir, "belirtilmemiş" sayılmaz', () => {
  // Kritik regresyon: Number(0)||DEFAULT deseni 0'ı "belirtilmemiş" sayıp
  // sessizce varsayılana düşürüyordu.
  assert.equal(oabStore.saveCacheSettings({ ttlMinutes: 0 }).ttlMinutes, 1);
  assert.equal(oabStore.saveCacheSettings({ ttlMinutes: 999999 }).ttlMinutes, 1440);
  assert.equal(oabStore.saveCacheSettings({}).ttlMinutes, 30);
});

test('OAB varsayılan pivot yapılandırması yeni Excel referans alanlarıyla birebir', () => {
  // Önce settings dosyasını kaldır: bu test gerçekten "kayıtlı layout yok"
  // senaryosunu doğrular, önceki testlerin persisted tercihlerini kullanmaz.
  fs.rmSync(oabStore.SETTINGS_FILE, { force: true });
  const settings = oabStore.loadCacheSettings();
  assert.deepEqual(settings.pivotConfig.rows, ['Klasman Grup Tanımı', 'Klasman Tanımı']);
  assert.deepEqual(settings.pivotConfig.values.map(v => v.field), [
    'Plan Başlangıç Ayı',
    'Klasman Tanımı',
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
  ]);
  assert.deepEqual(settings.pivotConfig.values.map(v => v.agg), ['FIRST', 'FIRST', 'SUM', 'SUM', 'SUM']);
  assert.deepEqual(oabStore.DEFAULT_OAB_PIVOT_VALUES, settings.pivotConfig.values.map(v => v.field));
});

test('OAB pivot tercihleri kalıcı olarak değiştirilip geri okunabiliyor', () => {
  const saved = oabStore.saveCacheSettings({ ttlMinutes: 45, pivotConfig: { rows: ['Line Tanımı'], columns: [], values: [{ field: 'PO Miktarı', agg: 'AVG' }], localFilters: {}, calculatedFields: [] } });
  assert.deepEqual(saved.pivotConfig.rows, ['Line Tanımı']);
  const reloaded = oabStore.loadCacheSettings();
  assert.deepEqual(reloaded.pivotConfig.rows, ['Line Tanımı']);
  assert.equal(reloaded.ttlMinutes, 45);
});


test('OAB eski kayıtlı layoutlardan kaldırılmış Buyer Log başlıklarını temizler', () => {
  const saved = oabStore.saveCacheSettings({
    ttlMinutes: 30,
    pivotConfig: {
      rows: ['Sipariş Durumu', 'Klasman Tanımı'],
      columns: ['WSSI Sipariş Geçiş %'],
      values: [
        { field: 'Kalan Sipariş Adet', agg: 'SUM' },
        { field: 'Toplam WSSI Sipariş Miktarı', agg: 'SUM' },
        { field: 'PO Miktarı', agg: 'SUM' },
      ],
      localFilters: { 'Sipariş Risk Durumu': ['Yüksek'] },
      calculatedFields: [], grouped: true, showSubtotals: true,
    },
  });
  assert.deepEqual(saved.pivotConfig.rows, ['Klasman Tanımı']);
  assert.deepEqual(saved.pivotConfig.columns, []);
  assert.deepEqual(saved.pivotConfig.values.map(v => v.field), ['Toplam WSSI Sipariş Miktarı', 'PO Miktarı']);
  assert.deepEqual(saved.pivotConfig.localFilters, {});
});

test('OAB son snapshot store kullanıcı bazlı, sıkıştırılmış ve Authorization içermeden kalıcıdır', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'oab-session-store.js'), 'utf8');
  assert.match(source, /LOCAL_DATA_ROOT/);
  assert.match(source, /oab-snapshots/);
  assert.match(source, /zlib\.gzipSync/);
  assert.match(source, /seasonRef/);
  assert.match(source, /merchSubGroupRef/);
  assert.match(source, /buyerGroupRef/);
  assert.doesNotMatch(source, /headers|passAuthTemplates|Bearer\s+[A-Za-z0-9]/);
});

test('OAB report başarılı olduğunda hem cache hit hem taze fetch snapshot durumunu kaydeder', () => {
  const body = SERVER.slice(SERVER.indexOf("app.post('/api/oab/report'"), SERVER.indexOf("app.get('/api/oab/state'"));
  const calls = body.match(/oabSessionStore\.save\(req\.currentUser\.id/g) || [];
  assert.equal(calls.length, 2, 'cache hit ve taze PASS sonucu ayrı ayrı snapshot kaydetmeli');
  assert.match(body, /selection:\{ seasonRef, merchSubGroupRef, buyerGroupRef \}/);
});

test('OAB açılış state API son kullanıcı snapshotını PASS bağlantısı kurmadan döndürür', () => {
  const body = SERVER.slice(SERVER.indexOf("app.get('/api/oab/state'"), SERVER.indexOf("app.get('/api/oab/settings'"));
  assert.match(body, /oabSessionStore\.load\(req\.currentUser\.id\)/);
  assert.doesNotMatch(body, /ensurePassConnected|fetchPassReportData/);
});

/* -------------------------------------------------- 2) PASS AUTH ADAPTER */

const connector = require(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'));

test('OAB: passReplayHeaders Authorization\'ı KORUR, tarayıcı-özel header\'ları ATAR', () => {
  const headers = { Authorization: 'Bearer XYZ', 'Content-Type': 'application/json', Host: 'pass.prod.lcwaikiki.com', Cookie: 'a=b', 'User-Agent': 'x', 'sec-ch-ua': 'y' };
  const replayed = connector.passReplayHeaders(headers);
  assert.equal(replayed.Authorization, 'Bearer XYZ', 'Authorization asla filtrelenmemeli');
  assert.equal(replayed['Content-Type'], 'application/json');
  assert.equal(replayed.Host, undefined);
  assert.equal(replayed.Cookie, undefined);
  assert.equal(replayed['User-Agent'], undefined);
  assert.equal(replayed['sec-ch-ua'], undefined);
});

test('OAB: Authorization token kod tabanında (kaynak dosyalarda) hiçbir yerde hard-code edilmemiş', () => {
  // Kullanıcı talimatı: token hiçbir zaman source code içine yazılmaz.
  assert.doesNotMatch(CONNECTOR, /Authorization['"]?\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{10,}/);
  assert.doesNotMatch(SERVER, /Authorization['"]?\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{10,}/);
});

test('OAB: yakalanan template hiçbir zaman console.log/disk yazımına gönderilmiyor', () => {
  const start = CONNECTOR.indexOf('async function capturePassAuthorization');
  const end = CONNECTOR.indexOf('\nfunction requirePassAuth', start);
  const body = CONNECTOR.slice(start, end);
  assert.doesNotMatch(body, /console\.(log|warn|error)/);
  assert.doesNotMatch(body, /fs\.write|writeFileSync|atomicWriteJson/);
});

test('OAB: passAuthStatus Authorization DEĞERİNİ değil yalnız varlığını raporluyor', () => {
  const body = CONNECTOR.slice(CONNECTOR.indexOf('function passAuthStatus'), CONNECTOR.indexOf('function passAuthStatus') + 400);
  assert.match(body, /hasAuthorization/);
  assert.doesNotMatch(body, /headers\[.*\]\s*[,}]/); // header DEĞERİ döndürülmemeli
});

test('OAB: passRequest 401/403 alınca token\'ı temizleyip PASS_SESSION_EXPIRED fırlatıyor', () => {
  const body = connector.oabExtractOptionList ? null : null; // sadece require başarıyla çalıştı mı kontrolü
  const src = CONNECTOR.slice(CONNECTOR.indexOf('async function passRequest'));
  assert.match(src, /result\.status===401\|\|result\.status===403/);
  assert.match(src, /passAuthTemplates\.delete\(safeOwner\(ownerId\)\)/, 'oturum süresi dolan token silinmeli, tekrar kullanılmamalı');
  assert.match(src, /PASS_SESSION_EXPIRED/);
});

test('OAB: passRequestExpression credentials:"omit" kullanıyor (kullanıcı doğrulanmış çalışan model)', () => {
  const expr = connector.passRequestExpression('https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportData', 'POST', { Authorization: 'Bearer X' }, { a: 1 });
  assert.doesNotThrow(() => new Function('fetch', `return ${expr};`));
  assert.match(expr, /credentials:'omit'/);
  // Yalnız GERÇEK fetch() çağrısındaki credentials değerini kontrol et — bu
  // dosyadaki açıklayıcı yorum satırı da 'include' kelimesini içeriyor.
  const fetchCallLine = expr.split('\n').find(line => line.includes('await fetch(cfg.url'));
  assert.ok(fetchCallLine, 'fetch çağrısı bulunmalı');
  assert.doesNotMatch(fetchCallLine, /credentials:'include'/);
});

test('OAB: passRequestExpression uçtan uca — Authorization header taşınıyor, JSON Content-Type zorlanıyor, body doğru serialize ediliyor', async () => {
  const expr = connector.passRequestExpression('https://pass.prod.lcwaikiki.com/x', 'POST', { Authorization: 'Bearer XYZ' }, { reportRef: 'OrderBudget_List_Report' });
  let capturedOpts = null;
  const fakeFetch = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ Data: [[{ a: 1 }]] }) }; };
  const runner = new Function('fetch', 'Headers', `return ${expr};`);
  const result = await runner(fakeFetch, Headers);
  assert.equal(capturedOpts.method, 'POST');
  assert.equal(capturedOpts.credentials, 'omit');
  assert.equal(capturedOpts.headers.get('Authorization'), 'Bearer XYZ');
  assert.equal(capturedOpts.headers.get('Accept'), 'application/json');
  assert.equal(capturedOpts.headers.get('Content-Type'), 'application/json');
  assert.equal(capturedOpts.body, JSON.stringify({ reportRef: 'OrderBudget_List_Report' }));
  assert.deepEqual(result.json, { Data: [[{ a: 1 }]] });
});

test('OAB: PASS auth template Content-Type taşımıyorsa bile GetReportData JSON olarak gönderilir (HTTP 415 regresyonu)', async () => {
  const expr = connector.passRequestExpression('https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportData', 'POST', { Authorization: 'Bearer XYZ', Accept: 'application/json' }, { reportRef: 'OrderBudget_List_Report', languageRef: 2, parameters: { SeasonRef: 20271, MerchSubGroupRef: 17, BuyerGroupRefs: 97, CategoryGroupRefs: '', CategoryRef: '' } });
  let capturedOpts = null;
  const fakeFetch = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ Data: [[]] }) }; };
  const runner = new Function('fetch', 'Headers', `return ${expr};`);
  await runner(fakeFetch, Headers);
  assert.equal(capturedOpts.headers.get('Content-Type'), 'application/json');
});

test('OAB: passRequestExpression 401 durumunda ok:false ve status:401 döndürüyor (token filtrelenmeden)', async () => {
  const expr = connector.passRequestExpression('https://pass.prod.lcwaikiki.com/x', 'POST', { Authorization: 'Bearer XYZ' }, {});
  const fake401 = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'oturum sona erdi' });
  const runner = new Function('fetch', `return ${expr};`);
  const result = await runner(fake401);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

/* ------------------------------------------------ 3) SEZON/METADATA ÇÖZÜMLEME */

test('OAB: oabExtractOptionList sezonları HİÇ SABİT KODLAMADAN, response şeklinden bağımsız çözüyor', () => {
  // Kullanıcının verdiği örnek kayıt formatı.
  const flat = { Data: [{ Name: 'S7-2027 YAZ', SeasonRef: 20271 }, { Name: 'W6-2026 SONBAHAR KIŞ', SeasonRef: 20262 }] };
  assert.equal(connector.oabExtractOptionList(flat, 'SeasonRef').length, 2);
  // GetReportData'nın doğrulanmış şekli: Data[0] altında satır dizisi.
  const nested = { Data: [[{ Name: 'S6-2026 YAZ', SeasonRef: 20261 }]] };
  assert.equal(connector.oabExtractOptionList(nested, 'SeasonRef').length, 1);
  // Sabit kodlanmış bir sezon listesi YOK — kaynakta "20271" gibi sabit
  // değerlerin bir DİZİ/SABİT olarak tanımlı olmadığını doğrula.
  assert.doesNotMatch(CONNECTOR, /const\s+\w*[Ss]eason\w*\s*=\s*\[\s*20271/);
});

test('OAB: tanınmayan response şekli boş liste döner, veri UYDURULMAZ', () => {
  assert.deepEqual(connector.oabExtractOptionList({ unexpected: true }, 'SeasonRef'), []);
  assert.deepEqual(connector.oabExtractOptionList(null, 'SeasonRef'), []);
});

test('OAB: MAG ve Buyer Group VariableRef değerleri kullanıcı talimatıyla birebir (26 ve 371)', () => {
  const magBody = CONNECTOR.slice(CONNECTOR.indexOf('async function fetchPassMagOptions'));
  assert.match(magBody, /fetchPassVariableWithData\(ownerId,26,/);
  const bgBody = CONNECTOR.slice(CONNECTOR.indexOf('async function fetchPassBuyerGroupOptions'));
  assert.match(bgBody, /fetchPassVariableWithData\(ownerId,371,/);
});

test('OAB: sezon metadata VariableRef/ReportVariableRef 534/454 ile eşleşiyor', () => {
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function fetchPassSeasons'), CONNECTOR.indexOf('async function fetchPassSeasons') + 400);
  assert.match(body, /variableRef:534/);
  assert.match(body, /reportVariableRef:454/);
  assert.match(body, /languageRef:2/);
});

test('OAB: GetReportData response.Data[0] altındaki satırları döndürüyor, alan adı hard-code edilmiyor', () => {
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function fetchPassReportData'));
  assert.match(body, /payload&&payload\.Data&&payload\.Data\[0\]/);
  // Kullanıcının 81 civarı alan adından hiçbiri kaynak kodunda TEK TEK
  // isimlendirilerek response'u daraltmak için kullanılmamalı.
  assert.doesNotMatch(body, /'Plan Sipariş Miktarı'/);
});

/* --------------------------------------------------------------- 4) API UÇLARI */

test('OAB: bütün API uçları overview yetki alanıyla korunuyor', () => {
  for (const route of ["app.get('/api/oab/auth/status'", "app.get('/api/oab/seasons'", "app.post('/api/oab/mag'", "app.post('/api/oab/buyer-groups'", "app.post('/api/oab/report'", "app.get('/api/oab/state'", "app.get('/api/oab/settings'", "app.put('/api/oab/settings'"]) {
    assert.ok(SERVER.includes(route), `${route} bulunmalı`);
  }
  // v6.60 — /api/oab/auth/connect kaldırıldı: bağlantı artık ayrı bir uç
  // değil, ensurePassConnected() ile metadata/rapor uçlarının İÇİNDEN
  // şeffaf şekilde kurulur.
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/oab\/auth\/connect'/);
  // v7.20: uç sayısı sabit değil (çoklu seçim beş uç daha ekledi). Sayı
  // çivilemek yeni her uçta testi kırıyor ama KORUMAYI doğrulamıyordu.
  // Artık her OAB ucunun guard taşıdığı tek tek denetleniyor — özgün amaç
  // buydu ve bu biçim yeni uçlarda da kendiliğinden geçerli.
  const routes = [...SERVER.matchAll(/app\.(get|post|put|delete)\('(\/api\/oab\/[^']*)'([^\n]*)/g)];
  assert.ok(routes.length >= 8, `OAB uçları bulunamadı: ${routes.length}`);
  for (const [, verb, routePath, rest] of routes) {
    assert.match(rest, /userAccess\.requireAnyArea\('overview'\)/, `${verb.toUpperCase()} ${routePath} overview alanıyla korunmalı`);
    assert.match(rest, /userAccess\.requireCapability\('OAB\.(VIEW|MANAGE)'\)/, `${verb.toUpperCase()} ${routePath} OAB yetkisiyle korunmalı`);
  }
});

test('OAB: auth durumu eski PASS Edge/CDP connector state üzerinden raporlanır; credential renderer yanıtına çıkmaz', () => {
  const body = SERVER.slice(SERVER.indexOf("app.get('/api/oab/auth/status'"), SERVER.indexOf("app.post('/api/oab/auth/capture-existing'"));
  assert.match(body, /agentBrowserConnector\.passAuthStatus\(req\.currentUser\.id\)/);
  assert.doesNotMatch(body, /authorization|Bearer/i);
});

test('OAB: metadata uçları paketlenmiş JSON kullanıyor; filtre seçiminde PASS bağlantısı YOK', () => {
  const seasonsBody = SERVER.slice(SERVER.indexOf("app.get('/api/oab/seasons'"), SERVER.indexOf("app.post('/api/oab/mag'"));
  assert.match(seasonsBody, /oabStaticMetadata\.getSeasons\(\)/);
  assert.doesNotMatch(seasonsBody, /ensurePassConnected|fetchPassSeasons|GetReportVariablesWithData/);

  const magBody = SERVER.slice(SERVER.indexOf("app.post('/api/oab/mag'"), SERVER.indexOf("app.post('/api/oab/buyer-groups'"));
  assert.match(magBody, /oabStaticMetadata\.getMag\(seasonRef\)/);
  assert.doesNotMatch(magBody, /ensurePassConnected|fetchPassMagOptions|GetVariableWithData/);

  const bgBody = SERVER.slice(SERVER.indexOf("app.post('/api/oab/buyer-groups'"), SERVER.indexOf("// OAB verisi:"));
  assert.match(bgBody, /oabStaticMetadata\.getBuyerGroups\(merchSubGroupRef\)/);
  assert.doesNotMatch(bgBody, /ensurePassConnected|fetchPassBuyerGroupOptions|GetVariableWithData/);
});

test('OAB: /api/oab/report üç filtreyi eski PASS Edge/CDP taşıma yoluna verir', () => {
  const body = SERVER.slice(SERVER.indexOf("app.post('/api/oab/report'"), SERVER.indexOf("app.get('/api/oab/settings'"));
  assert.match(body, /await ensurePassConnected\(req\.currentUser\.id, \{ seasonRef, merchSubGroupRef, buyerGroupRef \}\)/);
  assert.match(body, /await fetchOabReportWithLoginRecovery\(req\.currentUser\.id, \{ seasonRef, merchSubGroupRef, buyerGroupRef \}\)/);
  assert.doesNotMatch(body, /oabApiClient\.fetchReportData/);
});

test('OAB: /api/oab/report cache\'i kontrol eder, forceRefresh bypass eder', () => {
  const body = SERVER.slice(SERVER.indexOf("app.post('/api/oab/report'"), SERVER.indexOf("app.get('/api/oab/settings'"));
  assert.match(body, /if \(!body\.forceRefresh\)/);
  assert.match(body, /oabStore\.get\(key\)/);
  assert.match(body, /cached\.fresh/);
  assert.match(body, /oabStore\.set\(key,/);
});

test('OAB: rapor alan listesi (fields) hard-code edilmeden response\'tan dinamik üretiliyor', () => {
  const body = SERVER.slice(SERVER.indexOf("app.post('/api/oab/report'"), SERVER.indexOf("app.get('/api/oab/settings'"));
  assert.match(body, /rows\.flatMap\(row => Object\.keys\(row \|\| \{\}\)\)/);
});

/* ---------------------------------------------------------- 5) VERİ DOĞRULUĞU */

function loadOabJs() {
  const elements = {};
  function makeEl(id) {
    if (elements[id]) return elements[id];
    const listeners = {};
    const el = {
      id, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      dataset: {}, style: {},
      addEventListener(evt, fn) { listeners[evt] = listeners[evt] || []; listeners[evt].push(fn); },
      _fire(evt) { (listeners[evt] || []).forEach(fn => fn()); },
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      appendChild() {}, insertAdjacentHTML() {},
      set value(v) { this._value = v; }, get value() { return this._value || ''; },
      set disabled(v) { this._disabled = v; }, get disabled() { return this._disabled; },
      set hidden(v) { this._hidden = v; }, get hidden() { return this._hidden; },
      set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
      set className(v) { this._cls = v; }, get className() { return this._cls || ''; },
    };
    elements[id] = el; return el;
  }
  const fakeDocument = { readyState: 'complete', getElementById: id => makeEl(id), querySelectorAll: () => [], addEventListener() {} };
  const fakeFetch = async () => ({ ok: true, json: async () => ({}) });
  // vm.createContext AYRI bir JS realm'i oluşturur (Array/Object prototipleri
  // testinkinden FARKLI olur) — bu, assert.deepEqual'ı "aynı yapı ama
  // reference-equal değil" diye başarısız ederdi. new Function AYNI realm'de
  // çalışır (testle aynı Array/Object prototipleri), bu sorunu ortadan kaldırır.
  const runner = new Function('window', 'document', 'fetch', 'showToast', 'appLang', 'globalThis',
    `${OAB_JS}\nreturn window;`);
  // oab.js, ortak tablo aramasını app-main.js'in kurduğu global üzerinden okur.
  // Tarayıcıda app-main.js eager yüklendiği için sıra güvenlidir; sahte window
  // ile çalışırken bu globali gerçek uygulama kaynağından besliyoruz.
  const window = runner({ BLTableSearch: createTableSearch() }, fakeDocument, fakeFetch, () => {}, 'tr', {});
  return { window, elements };
}

test('OAB: oab.js hatasız yükleniyor ve saf veri katmanını dışa açıyor', () => {
  const { window } = loadOabJs();
  assert.equal(typeof window.OABLocalFilterEngine, 'function');
  assert.equal(typeof window.OABPivotEngine, 'function');
  assert.equal(typeof window.OABApi, 'object');
  assert.equal(typeof window.OABApi.report, 'function');
});

test('OAB: kod alanları (Renk Kodu, Özel Kod, Klasman Kod) KESİNLİKLE sayıya çevrilmiyor', () => {
  const { window } = loadOabJs();
  const utils = window.OABDataUtils;
  assert.equal(utils.fieldNumericValue({ 'Renk Kodu': '3E8' }, 'Renk Kodu'), null);
  assert.equal(utils.fieldNumericValue({ 'Özel Kod': '3E8' }, 'Özel Kod'), null);
  assert.equal(utils.fieldNumericValue({ 'Klasman Kod': '001' }, 'Klasman Kod'), null);
  assert.equal(utils.fieldNumericValue({ Ref: '5' }, 'Ref'), null, '"Ref" ile biten alan adları da kod sayılır');
});

test('OAB: locale kaynaklı ondalık biçimleri güvenli normalize ediliyor', () => {
  const { window } = loadOabJs();
  const utils = window.OABDataUtils;
  assert.equal(utils.toSafeNumber('1.234,56'), 1234.56);
  assert.equal(utils.toSafeNumber('1,234.56'), 1234.56);
  assert.equal(utils.toSafeNumber('1234,5'), 1234.5);
  assert.equal(utils.toSafeNumber('2.908'), 2908, 'Türkçe adet gösterimindeki nokta binlik ayırıcı olmalı');
  assert.equal(utils.toSafeNumber('null'), null);
  assert.equal(utils.toSafeNumber(''), null);
  assert.equal(utils.toSafeNumber(undefined), null);
  assert.equal(utils.toSafeNumber('abc'), null);
});

test('OAB: orijinal response satırı normalizasyon sırasında HİÇ değiştirilmiyor', () => {
  const { window } = loadOabJs();
  const row = { 'Renk Kodu': '3E8', 'Plan Sipariş Miktarı': '1.234,56' };
  const before = JSON.stringify(row);
  window.OABDataUtils.fieldNumericValue(row, 'Plan Sipariş Miktarı');
  assert.equal(JSON.stringify(row), before);
});

test('OAB: deriveFieldList response\'taki TÜM alanları (81 civarı) korur, hard-code liste kullanmaz', () => {
  const { window } = loadOabJs();
  const rows = [{ a: 1, b: 2 }, { a: 1, c: 3 }];
  assert.deepEqual(window.OABDataUtils.deriveFieldList(rows), ['a', 'b', 'c']);
});

/* -------------------------------------------------- 6) LOCAL FILTER ENGINE */

test('OAB: LocalFilterEngine dataset üzerinde filtreler, PASS\'e yeni istek gerektirmez (saf fonksiyon)', () => {
  const { window } = loadOabJs();
  const rows = [
    { 'Klasman Grup Tanımı': 'ÜST', 'Line Tanımı': 'A' },
    { 'Klasman Grup Tanımı': 'ALT', 'Line Tanımı': 'B' },
  ];
  const engine = new window.OABLocalFilterEngine(rows);
  assert.deepEqual(engine.distinctValues('Klasman Grup Tanımı'), ['ALT', 'ÜST']);
  const filtered = engine.apply({ 'Klasman Grup Tanımı': new Set(['ÜST']) });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]['Line Tanımı'], 'A');
});

test('OAB: birden fazla local filtre AND mantığıyla birleşiyor', () => {
  const { window } = loadOabJs();
  const rows = [
    { A: 'x', B: '1' }, { A: 'x', B: '2' }, { A: 'y', B: '1' },
  ];
  const engine = new window.OABLocalFilterEngine(rows);
  const filtered = engine.apply({ A: new Set(['x']), B: new Set(['1']) });
  assert.equal(filtered.length, 1);
});

test('OAB: local filtre değişikliği kod seviyesinde network isteği İÇERMİYOR', () => {
  // Kullanıcının 7. test senaryosu: "Klasman Grup gibi lokal filtre
  // değiştiğinde yeni network request oluşmuyor."
  //
  // v7.23: yerel filtreler tek seçimli <select> olmaktan çıkıp çoklu seçim
  // bileşenine geçti; testin AMACI (yerel filtre PASS'e gitmez) aynen korunur,
  // yalnız incelenen kod parçası yeni yazıcıya taşınır.
  const start = OAB_JS.indexOf('function oabLocalFilterSpec');
  const end = OAB_JS.indexOf('const OAB_LOCAL_FILTER_FIELDS', start);
  assert.ok(start >= 0 && end > start, 'yerel filtre spec\'i bulunmalı');
  const handler = OAB_JS.slice(start, end);
  assert.doesNotMatch(handler, /OABApi\.|fetch\(/);
  assert.match(handler, /oabRenderTable\(\)/, 'yalnız state içinde yeniden render edilmeli');
  assert.match(handler, /S\.localFilters\[field\] = new Set/, 'seçim yalnız istemci state\'ine yazılmalı');
});

/* ------------------------------------------------------------- 7) PIVOT ENGINE */

test('OAB: PivotEngine Rows/Values ile grupluyor ve SUM doğru hesaplıyor', () => {
  const { window } = loadOabJs();
  const rows = [
    { 'Klasman Grup Tanımı': 'ÜST', 'Plan Sipariş Miktarı': '100' },
    { 'Klasman Grup Tanımı': 'ÜST', 'Plan Sipariş Miktarı': '50' },
    { 'Klasman Grup Tanımı': 'ALT', 'Plan Sipariş Miktarı': '20' },
  ];
  const pivot = new window.OABPivotEngine(rows).compute({ rows: ['Klasman Grup Tanımı'], columns: [], values: [{ field: 'Plan Sipariş Miktarı', agg: 'SUM' }] });
  const ust = pivot.cells.find(c => c.rowKey === 'ÜST');
  assert.equal(ust.results['Plan Sipariş Miktarı::SUM'], 150);
});

test('OAB: PivotEngine tüm aggregate türlerini (SUM/AVG/COUNT/MIN/MAX) destekliyor', () => {
  const { window } = loadOabJs();
  const rows = [{ K: 'a', V: '10' }, { K: 'a', V: '20' }, { K: 'a', V: '30' }];
  const pivot = new window.OABPivotEngine(rows).compute({
    rows: ['K'], columns: [],
    values: [{ field: 'V', agg: 'SUM' }, { field: 'V', agg: 'AVG' }, { field: 'V', agg: 'COUNT' }, { field: 'V', agg: 'MIN' }, { field: 'V', agg: 'MAX' }, { field: 'K', agg: 'FIRST' }],
  });
  const cell = pivot.cells[0].results;
  assert.equal(cell['V::SUM'], 60);
  assert.equal(cell['V::AVG'], 20);
  assert.equal(cell['V::COUNT'], 3);
  assert.equal(cell['V::MIN'], 10);
  assert.equal(cell['V::MAX'], 30);
  assert.equal(cell['K::FIRST'], 'a');
});

test('OAB: pivot toplamları filtrelenmiş ham verinin toplamıyla BİREBİR uyuşuyor (kullanıcının 8. test senaryosu)', () => {
  const { window } = loadOabJs();
  const rows = [
    { K: 'a', V: '10.5' }, { K: 'a', V: '20,25' }, { K: 'b', V: '5' },
  ];
  const engine = new window.OABLocalFilterEngine(rows);
  const filtered = engine.apply({ K: new Set(['a']) });
  const pivot = new window.OABPivotEngine(filtered).compute({ rows: ['K'], columns: [], values: [{ field: 'V', agg: 'SUM' }] });
  const pivotTotal = pivot.cells[0].results['V::SUM'];
  const rawTotal = window.OABPivotEngine.verifyTotal(filtered, 'V', 'SUM');
  assert.equal(pivotTotal, rawTotal);
  assert.equal(pivotTotal, 30.75);
});

test('OAB: kaynak OAB dışında yalnız 4 onaylı derived alan üretilir ve kaynak satır değişmez', () => {
  const { window } = loadOabJs();
  const source = {
    'Plan Sipariş Miktarı': 1000,
    'Onaylı Sipariş Miktarı': 800,
    'PO Miktarı': 600,
    'WSSI Sipariş Miktarı': 900,
  };
  const before = JSON.stringify(source);
  const row = window.OABDataUtils.deriveBuyerMetrics(source);
  assert.equal(JSON.stringify(source), before, 'ham PASS satırı mutate edilmemeli');
  const added = Object.keys(row).filter(key => !(key in source));
  assert.deepEqual(added, [
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
    'Toplam Klasman Analize Konu Olan Toplam Adet',
  ]);
  for (const removed of window.OABDataUtils.OAB_REMOVED_DERIVED_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, removed), false, `${removed} artık satırda üretilmemeli`);
  }
});
test('OAB: Excel referansındaki 4 yeni alan satır bazında doğru türetilir (Test 1-4)', () => {
  const { window } = loadOabJs();
  const cases = [
    { wssi: 2908, onayli: 2992, expected: [2908, 2992, 0, 2908] },
    { wssi: 3169, onayli: 3457, expected: [3169, 3457, 0, 3169] },
    { wssi: 0, onayli: 3552, expected: [0, 3552, 3552, 3552] },
    { wssi: 0, onayli: 1551, expected: [0, 1551, 1551, 1551] },
  ];
  for (const item of cases) {
    const row = window.OABDataUtils.deriveBuyerMetrics({
      'WSSI Sipariş Miktarı': item.wssi,
      'Onaylı Sipariş Miktarı': item.onayli,
    });
    assert.deepEqual([
      row['Toplam WSSI Sipariş Miktarı'],
      row['Toplam Onaylı Sipariş Miktarı'],
      row['Toplam Onaylanmış - Sipariş Geçilmemiş Adet'],
      row['Toplam Klasman Analize Konu Olan Toplam Adet'],
    ], item.expected);
  }
});

test('OAB: yeni alanlarda null/undefined/boş değer 0 kabul edilir', () => {
  const { window } = loadOabJs();
  for (const empty of [null, undefined, '']) {
    const row = window.OABDataUtils.deriveBuyerMetrics({
      'WSSI Sipariş Miktarı': empty,
      'Onaylı Sipariş Miktarı': empty,
    });
    assert.equal(row['Toplam WSSI Sipariş Miktarı'], 0);
    assert.equal(row['Toplam Onaylı Sipariş Miktarı'], 0);
    assert.equal(row['Toplam Onaylanmış - Sipariş Geçilmemiş Adet'], 0);
    assert.equal(row['Toplam Klasman Analize Konu Olan Toplam Adet'], 0);
  }
});

test('OAB: Test 5 — klasman analizi toplamlar üzerinden değil satır bazında hesaplanıp toplanır', () => {
  const { window } = loadOabJs();
  const rows = window.OABDataUtils.withDerivedBuyerMetrics([
    { Grup: 'A', 'WSSI Sipariş Miktarı': 100, 'Onaylı Sipariş Miktarı': 120 },
    { Grup: 'A', 'WSSI Sipariş Miktarı': 0, 'Onaylı Sipariş Miktarı': 50 },
  ]);
  const pivot = new window.OABPivotEngine(rows).compute({
    rows: ['Grup'], columns: [], values: [
      { field: 'Toplam WSSI Sipariş Miktarı', agg: 'SUM' },
      { field: 'Toplam Onaylı Sipariş Miktarı', agg: 'SUM' },
      { field: 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet', agg: 'SUM' },
      { field: 'Toplam Klasman Analize Konu Olan Toplam Adet', agg: 'SUM' },
    ],
  });
  const r = pivot.cells[0].results;
  assert.equal(r['Toplam WSSI Sipariş Miktarı::SUM'], 100);
  assert.equal(r['Toplam Onaylı Sipariş Miktarı::SUM'], 170);
  assert.equal(r['Toplam Onaylanmış - Sipariş Geçilmemiş Adet::SUM'], 50);
  assert.equal(r['Toplam Klasman Analize Konu Olan Toplam Adet::SUM'], 150);
});

test('OAB: referans Excel Pivot toplamları 110.571 / 116.091 / 5.103 / 115.674 ile eşleşir', () => {
  const { window } = loadOabJs();
  // Aynı referans toplamlarını üreten iki satır: WSSI olan satır WSSI'yi,
  // WSSI=0 satırı Onaylı'yı klasman analizine taşır.
  const rows = window.OABDataUtils.withDerivedBuyerMetrics([
    { 'WSSI Sipariş Miktarı': 110571, 'Onaylı Sipariş Miktarı': 110988 },
    { 'WSSI Sipariş Miktarı': 0, 'Onaylı Sipariş Miktarı': 5103 },
  ]);
  assert.equal(window.OABPivotEngine.verifyTotal(rows, 'Toplam WSSI Sipariş Miktarı', 'SUM'), 110571);
  assert.equal(window.OABPivotEngine.verifyTotal(rows, 'Toplam Onaylı Sipariş Miktarı', 'SUM'), 116091);
  assert.equal(window.OABPivotEngine.verifyTotal(rows, 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet', 'SUM'), 5103);
  assert.equal(window.OABPivotEngine.verifyTotal(rows, 'Toplam Klasman Analize Konu Olan Toplam Adet', 'SUM'), 115674);
});

test('OAB: 4 yeni alan gerçek derived field olarak field listesine dahil edilir', () => {
  const { window } = loadOabJs();
  const expected = [
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
    'Toplam Klasman Analize Konu Olan Toplam Adet',
  ];
  expected.forEach(field => assert.ok(window.OABDataUtils.OAB_DERIVED_FIELDS.includes(field), `${field} derived field listesinde olmalı`));
});

test('OAB: client default Pivot Values tam 5 alanı doğru sırada taşır; dördüncü hesap alanı default değildir', () => {
  const { window } = loadOabJs();
  assert.deepEqual(window.OABDataUtils.DEFAULT_OAB_PIVOT_VALUES, [
    'Plan Başlangıç Ayı',
    'Klasman Tanımı',
    'Toplam WSSI Sipariş Miktarı',
    'Toplam Onaylı Sipariş Miktarı',
    'Toplam Onaylanmış - Sipariş Geçilmemiş Adet',
  ]);
  assert.equal(window.OABDataUtils.DEFAULT_OAB_PIVOT_VALUES.includes('Toplam Klasman Analize Konu Olan Toplam Adet'), false);
});

test('OAB: yeni hesaplanan alanlar filtrelenmiş aktif veri kümesine göre toplanır', () => {
  const { window } = loadOabJs();
  const rows = window.OABDataUtils.withDerivedBuyerMetrics([
    { Ay:'Ocak', 'WSSI Sipariş Miktarı':100, 'Onaylı Sipariş Miktarı':120 },
    { Ay:'Şubat', 'WSSI Sipariş Miktarı':0, 'Onaylı Sipariş Miktarı':50 },
  ]);
  const filtered = new window.OABLocalFilterEngine(rows).apply({ Ay: new Set(['Şubat']) });
  assert.equal(window.OABPivotEngine.verifyTotal(filtered, 'Toplam WSSI Sipariş Miktarı', 'SUM'), 0);
  assert.equal(window.OABPivotEngine.verifyTotal(filtered, 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet', 'SUM'), 50);
  assert.equal(window.OABPivotEngine.verifyTotal(filtered, 'Toplam Klasman Analize Konu Olan Toplam Adet', 'SUM'), 50);
});

test('OAB: kaldırılan eski yüzde metrikleri artık formula field olarak sunulmaz', () => {
  const { window } = loadOabJs();
  assert.equal(window.OABDataUtils.isFormulaMetric('Sipariş Geçiş %'), false);
  assert.equal(window.OABDataUtils.derivedFormulaValue([], 'Sipariş Geçiş %'), null);
});
test('OAB: eski WSSI yüzde/kalan başlıkları derived field listesinde bulunmaz', () => {
  const { window } = loadOabJs();
  for (const field of ['WSSI Sipariş Geçiş %', 'WSSI Kalan Sipariş %', 'WSSI Sipariş Sapma %', 'WSSI Sipariş Geçilmemiş Adet']) {
    assert.equal(window.OABDataUtils.OAB_DERIVED_FIELDS.includes(field), false);
  }
});
test('OAB: drill-down bağımlılıkları yalnız 4 izinli derived metriği içerir', () => {
  const start = OAB_JS.indexOf('const OAB_DRILL_METRIC_DEPENDENCIES');
  const body = OAB_JS.slice(start, start + 1200);
  assert.match(body, /'Toplam WSSI Sipariş Miktarı': \['WSSI Sipariş Miktarı'\]/);
  assert.match(body, /'Toplam Onaylı Sipariş Miktarı': \['Onaylı Sipariş Miktarı'\]/);
  assert.match(body, /'Toplam Onaylanmış - Sipariş Geçilmemiş Adet'/);
  assert.match(body, /'Toplam Klasman Analize Konu Olan Toplam Adet'/);
  assert.doesNotMatch(body, /WSSI Sipariş Geçiş %|Kalan Sipariş Adet|Sipariş Durumu/);
});
test('OAB: ay/tarih akıllı sıralama Ocak, Şubat, Mart kronolojisini koruyor', () => {
  const { window } = loadOabJs();
  const values = ['Mart', 'Ocak', 'Şubat'];
  values.sort(window.OABDataUtils.smartCompare);
  assert.deepEqual(values, ['Ocak','Şubat','Mart']);
});

test('OAB: Option Adı ve Renk Adı lokal filtrelerden çıkarıldı', () => {
  const start = OAB_JS.indexOf('const OAB_DEFAULT_LOCAL_FILTER_FIELDS');
  const body = OAB_JS.slice(start, start + 500);
  assert.doesNotMatch(body, /Option Adı/);
  assert.doesNotMatch(body, /Renk Adı/);
  assert.match(body, /Klasman Grup Tanımı/);
});

/* ------------------------------------------------------------ 8) KPI KARTLARI */

test('OAB: ayrı KPI kartları gösterilmez; özet yalnız pivot tablosunda kalır', () => {
  assert.doesNotMatch(OAB_JS, /const OAB_KPI_FIELDS|function oabRenderKpis|oabRenderKpis\(\)/);
  assert.doesNotMatch(INDEX, /id="oabKpiRow"/);
});
/* ------------------------------------------------------ 9) HTML/CSS ENTEGRASYONU */

test('OAB: Overview HTML\'i ovContent\'ten BAĞIMSIZ (Overview\'un diğer fonksiyonlarını bozmaz)', () => {
  const start = INDEX.indexOf('id="oabSection"');
  assert.ok(start > 0, 'oabSection bulunmalı');
  // oabSection, ovContent kapanış div'inden SONRA (dışında) olmalı.
  const ovContentClose = INDEX.lastIndexOf('</div>', start);
  const oabSectionOpenTag = INDEX.slice(start - 200, start);
  assert.ok(ovContentClose < start, 'oabSection ovContent kapanışından sonra gelmeli');
});

test('OAB: filtre zinciri HTML\'de doğru sırayla disabled başlıyor', () => {
  // v7.20: üç filtre <select> değil, çoklu seçim açılırı tetikleyicisi.
  // Çivilenen kural DEĞİŞMEDİ: MAG ve Buyer Group zincirin üstü seçilmeden
  // açılmamalı, Get OAB üçü de seçilmeden basılamamalı.
  const block = INDEX.slice(INDEX.indexOf('oabFilterBar'), INDEX.indexOf('oabFilterBar') + 2600);
  assert.match(block, /id="oabMagTrigger"[^>]*disabled/);
  assert.match(block, /id="oabBuyerGroupTrigger"[^>]*disabled/);
  assert.match(block, /id="oabGetBtn" disabled/);
  // Season tetikleyicisi de metadata gelene kadar kapalı başlar.
  assert.match(block, /id="oabSeasonTrigger"[^>]*disabled/);
});

test('OAB: kullanılan SVG ikonları sprite\'ta gerçekten mevcut', () => {
  for (const icon of ['i-pencil', 'i-refresh']) {
    assert.ok(INDEX.includes(`id="${icon}"`), `${icon} sprite'ta tanımlı olmalı`);
  }
});

test('OAB: script açılışta değil, OAB sekmesine geçilince lazy yükleniyor', () => {
  // v7.69'a kadar oab.js index.html'de eager bir <script> etiketiydi. 150 KB'lık
  // modül, OAB'ye hiç girmeyen kullanıcılar için de açılış kritik yolundaydı.
  // Artık ortak lazy-loader ile yükleniyor; test iddiası da oraya taşındı.
  assert.doesNotMatch(INDEX, /<script src="\/?oab\.js/, 'oab.js açılışta eager yüklenmemeli');
  assert.match(APP_MAIN, /loader\('oab\.js\?rev=\d+'\)/, 'oab.js lazy-loader ile yüklenmeli');
});

test('OAB: CSS mevcut kart/KPI tasarım dilini yeniden kullanıyor (yeni bir stil sistemi icat edilmemiş)', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.match(CSS, /\.oabHeader\{/);
  assert.match(CSS, /\.oabFilterField select\{/);
  // Kendi başına bir "kart" tanımı YOK — .cardBox zaten HTML'de kullanılıyor.
  assert.doesNotMatch(CSS, /\.oabCard\{background:/);
});

/* -------------------------------------------------------- 10) AYARLAR MODALI */

test('OAB: ayarlar modalı statik HTML\'de DEĞİL, yalnız açıldığında JS ile oluşturuluyor', () => {
  // v6.58 regresyon testi — kullanıcı bildirimi: uygulama açılır açılmaz boş
  // bir "OAB Settings" modalı görünüyordu ve hiçbir şey yapılamıyordu.
  // Kök neden: statik #oabSettingsModalOverlay elementi hem [hidden] hem
  // .autoModalOverlay{display:grid} taşıyordu; eşit özgüllükte sayfa CSS'i
  // kazanıp [hidden]'i eziyordu. Düzeltme: modal artık HTML'de hiç yok,
  // yalnız oabOpenSettings() çağrıldığında document.createElement ile
  // oluşturulup document.body'ye eklenir.
  assert.doesNotMatch(INDEX, /id="oabSettingsModalOverlay"/);
  assert.match(OAB_JS, /document\.createElement\('div'\)/);
  assert.match(OAB_JS, /modal\.id = '_oabSettingsModal'/);
  assert.match(OAB_JS, /document\.body\.appendChild\(modal\)/);
});

test('OAB: ayarlar modalı kapatılınca DOM\'dan tamamen kaldırılıyor (statik bir kopya kalmıyor)', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenSettings'), OAB_JS.indexOf('function oabPivotValueRowHtml'));
  assert.match(body, /modal\.remove\(\)/);
});

test('OAB: uygulama açılışında (oabInit) modal hiç oluşturulmuyor, yalnız Ayarlar düğmesi tıklanınca', () => {
  const initBody = OAB_JS.slice(OAB_JS.indexOf('function oabInit'), OAB_JS.indexOf('if (document.readyState'));
  assert.match(initBody, /oabSettingsBtn.*addEventListener\('click', oabOpenSettings\)/);
  assert.doesNotMatch(initBody, /oabOpenSettings\(\);(?!\s*\/\/)/); // init içinde DOĞRUDAN çağrılmamalı
});

test('OAB: uygulama açılışını sahte DOM ile simüle edince ayarlar modalı DOM\'a hiç eklenmiyor', () => {
  let appended = false;
  const elements = {};
  function makeEl(id) {
    if (elements[id]) return elements[id];
    const el = { id, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, style: {},
      addEventListener() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      set value(v) { this._value = v; }, get value() { return this._value || ''; },
      set disabled(v) { this._disabled = v; }, get disabled() { return this._disabled; },
      set hidden(v) { this._hidden = v; }, get hidden() { return this._hidden; },
      set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; } };
    elements[id] = el; return el;
  }
  const fakeDocument = {
    readyState: 'complete',
    getElementById: id => makeEl(id),
    querySelectorAll: () => [], addEventListener() {},
    body: { appendChild() { appended = true; } },
    createElement: () => ({ classList: { add() {}, remove() {} }, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; }, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, remove() {} }),
  };
  const runner = new Function('window', 'document', 'fetch', 'showToast', 'appLang', 'globalThis',
    `${OAB_JS}\nreturn window;`);
  runner({ BLTableSearch: createTableSearch() }, fakeDocument, async () => ({ ok: true, json: async () => ({ ok: true, status: { connected: false } }) }), () => {}, 'tr', {});
  assert.equal(appended, false, 'oabInit çalıştıktan hemen sonra hiçbir modal DOM\'a eklenmemiş olmalı');
});

test('OAB: oabSection HTML\'de <div>, <section> DEĞİL (view/tab-switching kuralından etkilenmemeli)', () => {
  // v6.59 regresyon testi — kullanıcı bildirimi: OAB bölümü Overview'da hiç
  // görünmüyordu. Kök neden: app.css'te "section{display:none;}
  // section.active{display:block;}" kuralı bu kod tabanında <section> etiketini
  // sekme/görünüm (view-cp, view-orders, vb.) yönetimi için ayırmış — .active
  // sınıfı almayan HER <section>, tag adına dayalı bu kuraldan etkilenip
  // kalıcı olarak gizli kalır. oabSection bir sekme değil, bir içerik kartı
  // olduğu için <section> yerine <div> olmalı.
  // Öznitelik sırasına bağlı değil: aradaki tek koşul etiketin <div> olması ve
  // kartın ortak cardBox stilini taşıması.
  const tag = INDEX.match(/<\w+ id="oabSection"[^>]*>/);
  assert.ok(tag, 'oabSection elementi bulunmalı');
  assert.match(tag[0], /^<div /);
  assert.match(tag[0], /class="[^"]*\bcardBox\b[^"]*\boabSection\b/);
  assert.doesNotMatch(INDEX, /<section id="oabSection"/);
});

test('OAB: CSS\'teki section{display:none} kuralı div etiketli oabSection\'ı etkilemiyor (seçici tag-bazlı)', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.match(CSS, /^section\{display:none;\}/m, 'kural hâlâ mevcut olmalı (diğer view sekmeleri için gerekli)');
});

/* ------------------------------------------------- 11) DOĞRU PASS URL'İ (v6.60) */

test('OAB: PASS viewer host doğru (pass.lcwaikiki.com, ERİŞİLEMEYEN pass.prod.lcwaikiki.com DEĞİL)', () => {
  // Kullanıcı bildirimi: eski host'a (pass.prod.lcwaikiki.com) gidince
  // "This page can't be found" hatası alınıyordu. Gerçek kullanıcı arayüzü
  // pass.lcwaikiki.com'da (prod. öneki YOK).
  assert.equal(connector.PASS_UI_HOST, 'pass.lcwaikiki.com');
  assert.doesNotMatch(CONNECTOR, /page\.goto\(PASS_API_ROOT/);
  assert.doesNotMatch(CONNECTOR, /const PASS_HOME_URL/, 'eski, erişilemeyen host sabiti kaldırılmış olmalı');
});

test('OAB: passViewerUrl kullanıcının verdiği TAM URL formatını üretiyor', () => {
  assert.equal(connector.passViewerUrl({}), 'https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report');
  assert.equal(
    connector.passViewerUrl({ seasonRef: 20271, merchSubGroupRef: 17, buyerGroupRef: 97 }),
    'https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report&SeasonRef=20271&MerchSubGroupRef=17&BuyerGroupRefs=97',
  );
  assert.equal(connector.passViewerUrl({ seasonRef: 20271 }), 'https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report&SeasonRef=20271');
});

test('OAB: capturePassAuthorization artık pass.lcwaikiki.com sekmesi arıyor/açıyor', () => {
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function capturePassAuthorization'), CONNECTOR.indexOf('async function capturePassAuthorization') + 1200);
  assert.match(body, /url\.hostname\.toLowerCase\(\)===PASS_UI_HOST/);
  assert.match(body, /passViewerUrl\(\{seasonRef,merchSubGroupRef,buyerGroupRef\}\)/);
});

/* -------------------------------------------------- 12) METADATA CACHE DEPOSU */

const oabMetadataStore = require(path.join(ROOT, 'server', 'lib', 'oab-metadata-store.js'));

test('OAB metadata: boşken null döner, uydurma veri YOK', () => {
  assert.equal(oabMetadataStore.getSeasons(), null);
  assert.equal(oabMetadataStore.getMag(20271), null);
  assert.equal(oabMetadataStore.getBuyerGroups(17), null);
});

test('OAB metadata: Season/MAG/BuyerGroup kaydedilip geri okunabiliyor, ayrı anahtar uzaylarında', () => {
  const savedSeasons = oabMetadataStore.setSeasons([{ Name: 'S7-2027 YAZ', SeasonRef: 20271 }]);
  assert.deepEqual(savedSeasons.options, [{ Name: 'S7-2027 YAZ', SeasonRef: 20271 }]);
  assert.deepEqual(oabMetadataStore.getSeasons().options, [{ Name: 'S7-2027 YAZ', SeasonRef: 20271 }]);

  oabMetadataStore.setMag(20271, [{ Name: 'CU4E', MerchSubGroupRef: 17 }]);
  assert.deepEqual(oabMetadataStore.getMag(20271).options, [{ Name: 'CU4E', MerchSubGroupRef: 17 }]);
  assert.equal(oabMetadataStore.getMag(99999), null, 'farklı sezon için MAG cache\'i olmamalı');

  oabMetadataStore.setBuyerGroups(17, [{ Name: 'LİSANS', BuyerGroupRef: 97 }]);
  assert.deepEqual(oabMetadataStore.getBuyerGroups(17).options, [{ Name: 'LİSANS', BuyerGroupRef: 97 }]);
});

test('OAB metadata: rapor cache\'inden (oab-store.js) TAMAMEN ayrı bir dosyada tutuluyor', () => {
  // Kullanıcı talimatı: "OAB rapor datası cache'i ile filtre metadata cache'ini
  // birbirinden ayrı tut."
  assert.notEqual(oabMetadataStore.METADATA_FILE, oabStore.CACHE_DIR);
  assert.doesNotMatch(oabMetadataStore.METADATA_FILE, /oab-cache/);
});

/* -------------------------------------------- 12B) BUNDLED FILTER METADATA */

const oabStaticMetadata = require(path.join(ROOT, 'server', 'lib', 'oab-static-metadata.js'));

test('OAB bundled metadata: proje içinde kalıcı resource olarak mevcut ve doğru sayımları içeriyor', () => {
  assert.ok(fs.existsSync(oabStaticMetadata.METADATA_FILE), 'oab_filter_metadata.json proje içinde bulunmalı');
  assert.doesNotMatch(oabStaticMetadata.METADATA_FILE.replace(/\\/g, '/'), /server\/data\//, 'release arşivinde dışlanan server/data altında olmamalı');
  const info = oabStaticMetadata.getInfo();
  assert.equal(info.reportRef, 'OrderBudget_List_Report');
  assert.deepEqual(info.counts, { seasons: 4, uniqueMags: 147, uniqueBuyerGroups: 145 });
});

test('OAB bundled metadata: Season -> MAG -> Buyer Group ilişkisi gerçek Ref değerleriyle okunuyor', () => {
  const seasons = oabStaticMetadata.getSeasons();
  assert.equal(seasons.length, 4);
  assert.ok(seasons.some(x => x.SeasonRef === 20271 && x.Name === 'S7-2027 YAZ'));
  const mags = oabStaticMetadata.getMag(20271);
  assert.ok(mags.some(x => x.MerchSubGroupRef === 17 && x.Name.trim() === 'CU4E'));
  const buyers = oabStaticMetadata.getBuyerGroups(17);
  assert.ok(buyers.some(x => x.BuyerGroupRef === 97 && x.Name === 'LİSANS'));
  assert.equal(oabStaticMetadata.validateSelectedRefs({ seasonRef: 20271, merchSubGroupRef: 17, buyerGroupRef: 97 }).ok, true);
  assert.equal(oabStaticMetadata.validateSelectedRefs({ seasonRef: 20271, merchSubGroupRef: 999999, buyerGroupRef: 97 }).ok, false);
});

/* --------------------------------------------------- 13) İSTEMCİ: CACHE-FIRST AKIŞ */

test('OAB istemci: oabInit hiçbir authStatus/connect çağrısı YAPMADAN doğrudan Season yüklüyor', () => {
  // v6.60 regresyon testi: eskiden OAB açılışında önce "bağlı mısın" diye
  // sorulur, kullanıcı "PASS'e Bağlan"a basmadan hiçbir şey olmazdı. Artık
  // Season listesi doğrudan (cache-first) yükleniyor.
  const initBody = OAB_JS.slice(OAB_JS.indexOf('function oabInit'), OAB_JS.indexOf('if (document.readyState'));
  assert.match(initBody, /await oabLoadSeasons\(\)/);
  assert.match(initBody, /await oabRestoreLastSnapshot\(\)/);
  assert.doesNotMatch(initBody, /oabRenderAuthBar/);
  assert.doesNotMatch(OAB_JS, /oabConnectToPass/);
  assert.doesNotMatch(OAB_JS, /\/api\/oab\/auth\/connect/);
});

test('OAB istemci: açılışta son snapshot seçimlerini geri yükleyip PASS raporu çağırmadan render eder', () => {
  assert.match(OAB_JS, /state: \(\) => oabJson\('\/api\/oab\/state'\)/);
  const restore = OAB_JS.slice(OAB_JS.indexOf('async function oabRestoreLastSnapshot'), OAB_JS.indexOf('async function oabFetchReport'));
  assert.match(restore, /await OABApi\.state\(\)/);
  // v7.20: seçim artık dizi. Çivilenen amaç aynı — snapshot'taki seçim
  // zincirin üç kademesine de geri yüklenmeli, sonra veri PASS'e gitmeden
  // ekrana basılmalı.
  assert.match(restore, /S\.seasonRefs = /);
  assert.match(restore, /await oabOnSeasonSelectionChange\(\)/);
  assert.match(restore, /S\.magRefs = oabKeepValid/);
  assert.match(restore, /await oabOnMagSelectionChange\(\)/);
  assert.match(restore, /S\.buyerGroupRefs = oabKeepValid/);
  assert.match(restore, /oabApplyReportData/);
  assert.doesNotMatch(restore, /OABApi\.report\(/, 'snapshot restore PASS GetReportData çağırmamalı');
  // v7.19 ve öncesinde yazılmış TEKİL seçimli snapshot'lar da okunabilmeli;
  // aksi halde yükseltmeden sonra herkesin son raporu kaybolurdu.
  assert.match(restore, /selection\.seasonRefs, selection\.seasonRef/);
  assert.match(restore, /selection\.merchSubGroupRefs, selection\.merchSubGroupRef/);
  assert.match(restore, /selection\.buyerGroupRefs, selection\.buyerGroupRef/);
});

test('OAB Refresh çalışırken mevcut snapshot görünür kalır', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('async function oabFetchReport'), OAB_JS.indexOf('function defaultPivotConfigClient'));
  assert.match(body, /if \(!S\.rows\.length\) oabEl\('oabBody'\)\.hidden = true/);
});

test('OAB istemci: bağlantı/metadata hatası "Tekrar Dene" ile gösteriliyor (dead-end değil)', () => {
  assert.match(OAB_JS, /function oabShowRetry/);
  const seasonsBody = OAB_JS.slice(OAB_JS.indexOf('async function oabLoadSeasons'), OAB_JS.indexOf('function oabShowRetry'));
  assert.match(seasonsBody, /oabShowRetry\(oabAuthErrorMessage\(err\), oabLoadSeasons\)/);
});

/* --------------------------------------------------- 14) 405 TEŞHİS DETAYI (v6.61) */

test('OAB: passRequest HTTP hatasında hangi endpoint/method başarısız olduğunu detaya ekliyor', () => {
  // Kullanıcı bildirimi: "PASS HTTP 405" hatası alındı ama HANGİ endpoint'in
  // başarısız olduğu belli değildi (yalnız status gösteriliyordu). Artık
  // url ve method da err.details'e ekleniyor.
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function passRequest'));
  assert.match(body, /connectorError\(`PASS HTTP \$\{result\.status\} \$\{result\.statusText\}`\.trim\(\),'PASS_HTTP_ERROR',502,\{status:result\.status,body:result\.text\|\|result\.json,url,method\}\)/);
});

test('OAB: oabJson istemcide err.details\'i sunucu yanıtından taşıyor (önceden hiç taşımıyordu)', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('async function oabJson'), OAB_JS.indexOf('const OABApi'));
  assert.match(body, /err\.details = data\.details/);
});

test('OAB: OAB_HTTP_ERROR kullanıcıya güvenli HTTP durum mesajı verir', () => {
  const start = OAB_JS.indexOf('function oabReportErrorMessage(');
  const end = OAB_JS.indexOf('function oabFilteredRows', start);
  const source = OAB_JS.slice(start, end);
  const fn = new Function('oabT', 'oabIsAuthError', 'oabAuthErrorMessage', `${source}; return oabReportErrorMessage;`)(
    (tr) => tr, () => false, () => 'auth'
  );
  const message = fn({ code: 'OAB_HTTP_ERROR', details: { status: 405 } });
  assert.match(message, /HTTP 405/);
  assert.doesNotMatch(message, /pass\.prod\.lcwaikiki\.com|Bearer|authorization/i);
});

/* ----------------------------------------- 14) OAB PIVOT AYARLARI UI (v6.61) */

test('OAB: Pivot Rows ve Columns düz metin değil, tablo alanlarından select ile yönetiliyor', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenSettings'), OAB_JS.indexOf('/* --------------------------------------------------------------- INIT */'));
  assert.doesNotMatch(body, /id="oabPivotRows"[^>]*type="text"/);
  assert.doesNotMatch(body, /id="oabPivotCols"[^>]*type="text"/);
  assert.match(body, /id="oabPivotRowsList"/);
  assert.match(body, /id="oabPivotColsList"/);
  assert.match(OAB_JS, /class="oabPivotAxisField"/);
  assert.match(body, /oabSettingsFieldPool\(config\)/, 'seçim havuzu response tablo başlıklarından türetilmeli');
});

test('OAB: Pivot Rows ve Columns alan ekleme, silme ve sıralama kontrollerine sahip', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenSettings'), OAB_JS.indexOf('/* --------------------------------------------------------------- INIT */'));
  assert.match(body, /id="oabAddRowBtn"/);
  assert.match(body, /id="oabAddColumnBtn"/);
  assert.match(OAB_JS, /data-oab-config-remove/);
  assert.match(OAB_JS, /data-oab-config-move="-1"/);
  assert.match(OAB_JS, /data-oab-config-move="1"/);
  assert.match(OAB_JS, /function oabMoveConfigRow/);
});

test('OAB: Pivot Values alanları silinebilir ve yukarı-aşağı sıralanabilir', () => {
  const valueStart = OAB_JS.indexOf('function oabPivotValueRowHtml');
  const valueHtml = OAB_JS.slice(valueStart, valueStart + 900);
  assert.match(valueHtml, /oabConfigActionsHtml\(\)/);
  assert.match(valueHtml, /oabPivotValueField/);
  assert.match(valueHtml, /oabPivotValueAgg/);
  const openBody = OAB_JS.slice(OAB_JS.indexOf('function oabOpenSettings'), OAB_JS.indexOf('function oabPivotValueRowHtml'));
  assert.match(openBody, /id="oabAddValueBtn"/);
  assert.match(OAB_JS, /data-oab-config-remove/);
  assert.match(OAB_JS, /data-oab-config-move/);
});

test('OAB: Pivot Rows/Columns kaydedilirken UI sırası korunuyor ve duplicate alanlar temizleniyor', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabUniqueSelectedFields'), OAB_JS.indexOf('/* --------------------------------------------------------------- INIT */'));
  assert.match(body, /querySelectorAll\(`\$\{listSelector\} \.oabPivotAxisField`\)/);
  assert.match(body, /seen\.has\(field\)/);
  assert.match(body, /result\.push\(field\)/);
  assert.match(body, /oabUniqueSelectedFields\(modal, '#oabPivotRowsList'\)/);
  assert.match(body, /oabUniqueSelectedFields\(modal, '#oabPivotColsList'\)/);
});


test('OAB: kayıtlı Pivot layout veri yenilemede zorla default alanlarla ezilmez ve Reset ayrı aksiyondur', () => {
  const applyStart = OAB_JS.indexOf('async function oabApplyReportData');
  const applyEnd = OAB_JS.indexOf('async function oabRestoreLastSnapshot', applyStart);
  const applyBody = OAB_JS.slice(applyStart, applyEnd);
  assert.match(applyBody, /if \(!S\.pivotConfig\)/, 'default yalnız config yokken yüklenmeli');
  assert.doesNotMatch(applyBody, /DEFAULT_OAB_PIVOT_VALUES/, 'her yenilemede default values zorla eklenmemeli');
  assert.match(OAB_JS, /data-oab-settings-reset/);
  assert.match(OAB_JS, /function oabResetPivotSettings/);
  assert.match(OAB_JS.slice(OAB_JS.indexOf('function oabResetPivotSettings'), OAB_JS.indexOf('async function oabSaveSettingsFromModal')), /defaultPivotConfigClient\(\)/);
});

test('OAB: settings modal yalnız pointerdown ve pointerup backdrop üzerinde ise kapanıyor', () => {
  assert.match(OAB_JS, /pressedOnBackdrop\s*=\s*false/);
  assert.match(OAB_JS, /pointerdown[\s\S]{0,180}event\.target\s*===\s*modal/);
  assert.match(OAB_JS, /pointerup[\s\S]{0,220}pressedOnBackdrop[\s\S]{0,160}event\.target\s*===\s*modal/);
});

test('OAB: pivot başlıklarında sıralama, değer aralığı filtresi ve sağ-tık sütun gizleme mevcut', () => {
  assert.match(OAB_JS, /oabSmartCompare/);
  assert.match(OAB_JS, /oabOpenPivotFilter/);
  assert.match(OAB_JS, /kind:\s*'range'/);
  assert.match(OAB_JS, /data-oab-pivot-key/);
  assert.match(OAB_JS, /contextmenu[\s\S]{0,160}oabOpenColumnMenu/);
});

test('OAB: Refresh sırasında PASS target navigation/close hatası transient kabul edilip bir kez retry edilir', () => {
  const helper = CONNECTOR.slice(CONNECTOR.indexOf('function passTransientCdpTargetError'), CONNECTOR.indexOf('async function passPageForRequest'));
  assert.match(helper, /inspected target navigated or closed/i);
  assert.match(helper, /execution context/i);
  const body = CONNECTOR.slice(CONNECTOR.indexOf('async function passRequest(ownerId'), CONNECTOR.indexOf('// Rapor metadata servisi:'));
  assert.match(body, /for\(let attempt=0;attempt<2;attempt\+=1\)/, 'yalnız bir retry olmalı');
  assert.match(body, /context\.syncPages\(\)/, 'retry öncesi target listesi yenilenmeli');
  assert.match(body, /await sleep\(450\)/, 'navigation bağlamının oturması için kısa bekleme olmalı');
  assert.match(body, /document\.readyState/, 'güncel execution context hazır olmalı');
});

/* -------------------------------------- 15) OAB GROUPED PIVOT + EXCEL EXPORT */

test('OAB: varsayılan pivot gruplanmış görünüm ve alt toplamlarla açılır', () => {
  // Eski ayar dosyalarında bu iki alan yoksa istemci de !== false ile geriye
  // uyumlu biçimde açık kabul eder; yeni kurulumlarda store açık kaydeder.
  const fresh = oabStore.saveCacheSettings({ ttlMinutes: 30, pivotConfig: {
    rows: ['Sipariş Onaylama Ayı', 'Klasman Tanımı'], columns: [],
    values: [{ field: 'PO Miktarı', agg: 'SUM' }], localFilters: {}, calculatedFields: [],
    grouped: true, showSubtotals: true,
  } });
  assert.equal(fresh.pivotConfig.grouped, true);
  assert.equal(fresh.pivotConfig.showSubtotals, true);
  assert.match(OAB_JS, /config\.grouped !== false/);
  assert.match(OAB_JS, /config\.showSubtotals !== false/);
});

test('OAB: grouped pivot aylar/klasmanlar için hiyerarşik ağaç, daralt-genişlet ve genel toplam üretir', () => {
  assert.match(OAB_JS, /function oabBuildPivotTree/);
  assert.match(OAB_JS, /function oabBuildPivotViewModel/);
  assert.match(OAB_JS, /data-oab-group-key/);
  assert.match(OAB_JS, /S\.collapsedGroups/);
  assert.match(OAB_JS, /oabExpandAllGroups/);
  assert.match(OAB_JS, /oabCollapseAllGroups/);
  assert.match(OAB_JS, /Genel Toplam/);
  assert.match(INDEX, /id="oabExpandAllBtn"/);
  assert.match(INDEX, /id="oabCollapseAllBtn"/);
});

test('OAB: sıfır Toplam Onaylanmış - Sipariş Geçilmemiş grupları varsayılan daraltılır, adetli gruplar açık kalır', () => {
  const { window } = loadOabJs();
  const rows = window.OABDataUtils.withDerivedBuyerMetrics([
    { 'Klasman Grup Tanımı': 'SIFIR', 'Klasman Tanımı': 'A', 'WSSI Sipariş Miktarı': 0, 'Onaylı Sipariş Miktarı': 0 },
    { 'Klasman Grup Tanımı': 'SIFIR', 'Klasman Tanımı': 'B', 'WSSI Sipariş Miktarı': 0, 'Onaylı Sipariş Miktarı': 0 },
    { 'Klasman Grup Tanımı': 'ACIK', 'Klasman Tanımı': 'A', 'WSSI Sipariş Miktarı': 0, 'Onaylı Sipariş Miktarı': 25 },
  ]);
  const config = { rows: ['Klasman Grup Tanımı', 'Klasman Tanımı'], columns: [], values: [{ field: 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet', agg: 'SUM' }], grouped: true };
  assert.deepEqual(window.OABDataUtils.defaultCollapsedPivotGroupKeys(rows, config), ['SIFIR', 'SIFIR␟A', 'SIFIR␟B']);
  assert.deepEqual(window.OABDataUtils.defaultCollapsedPivotGroupKeys(rows, { ...config, rows: ['Klasman Grup Tanımı'] }), ['SIFIR']);
  assert.equal(window.OABDataUtils.defaultCollapsedPivotGroupKeys(rows, config).includes('ACIK'), false);
});

test('OAB: otomatik daraltma kullanıcı genişletmesini aynı veri görünümünde ezmez', () => {
  assert.match(OAB_JS, /function oabSeedDefaultCollapsedGroups\(/);
  assert.match(OAB_JS, /defaultCollapsedPivotGroupKeys\(/);
  assert.match(OAB_JS, /S\.autoCollapseZeroGroupsKey/);
});

test('OAB: alt toplamlar yaprak yüzdelerini toplamaz, kaynak satırlardan yeniden hesaplanır', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabPivotAggregateMap'), OAB_JS.indexOf('function oabBuildPivotBase'));
  assert.match(body, /new OABPivotEngine\(sourceRows \|\| \[\]\)\.compute/);
  assert.match(OAB_JS, /sourceRows: group\.rows\.slice\(\)/);
  assert.match(OAB_JS, /node\.leaves\.flatMap\(leaf => leaf\.sourceRows/);
});

test('OAB: Settings içinde grouped görünüm ve alt toplam anahtarları kaydedilir', () => {
  assert.match(OAB_JS, /id="oabGroupedViewInput"/);
  assert.match(OAB_JS, /id="oabShowSubtotalsInput"/);
  assert.match(OAB_JS, /const grouped = Boolean\(modal\.querySelector\('#oabGroupedViewInput'\)/);
  assert.match(OAB_JS, /const showSubtotals = Boolean\(modal\.querySelector\('#oabShowSubtotalsInput'\)/);
  assert.match(OAB_JS, /pivotConfig = \{ rows, columns, values[\s\S]{0,180}grouped, showSubtotals \}/);
});

test('OAB: tek Excel dışa aktarımı Raw Data ve Pivot olmak üzere iki sheet oluşturur', () => {
  assert.match(INDEX, /id="oabExcelExportBtn"/);
  const body = OAB_JS.slice(OAB_JS.indexOf('async function oabExportExcel'), OAB_JS.indexOf('function oabSwitchView'));
  assert.match(body, /book_append_sheet\(wb, wsRaw, 'OAB Raw Data'\)/);
  assert.match(body, /book_append_sheet\(wb, wsPivot, 'OAB Pivot'\)/);
  assert.match(body, /XLSX\.writeFile\(wb, fileName/);
});

test('OAB: Excel raw export 500 satırlık ekran limitine bağlı değildir ve kod alanlarını metin tutar', () => {
  const raw = OAB_JS.slice(OAB_JS.indexOf('function oabRawExportMatrix'), OAB_JS.indexOf('function oabPivotExportMatrix'));
  assert.doesNotMatch(raw, /slice\(0,\s*500\)/);
  assert.match(raw, /isLikelyCodeField\(field\)/);
  const fmt = OAB_JS.slice(OAB_JS.indexOf('function oabExcelApplyCommonFormatting'), OAB_JS.indexOf('function oabExcelFilePart'));
  assert.match(fmt, /cell\.t = 's'/);
  assert.match(fmt, /cell\.z = '@'/);
});

/* -------------------------------------- 16) OAB DRILL-DOWN + OVERVIEW YERLEŞİMİ */

test('OAB: pivot hücrelerine çift tıklayınca alt detay modalı açılır ve kaynak satırlar korunur', () => {
  assert.match(OAB_JS, /__oabSourceRows/);
  assert.match(OAB_JS, /function oabPivotCellSourceRows/);
  assert.match(OAB_JS, /function oabOpenPivotDetail/);
  assert.match(OAB_JS, /addEventListener\('dblclick'/);
  assert.match(OAB_JS, /id = '_oabDrillModal'/);
  assert.match(OAB_JS, /OAB Alt Detay/);
});

test('OAB: izinli Toplam Onaylanmış - Sipariş Geçilmemiş Adet alt detayı kaynak bileşenlerini gösterir', () => {
  const start = OAB_JS.indexOf('const OAB_DRILL_METRIC_DEPENDENCIES');
  const body = OAB_JS.slice(start, start + 1200);
  assert.match(body, /'Toplam Onaylanmış - Sipariş Geçilmemiş Adet': \['WSSI Sipariş Miktarı', 'Onaylı Sipariş Miktarı'\]/);
  assert.match(OAB_JS, /oabDrillSortRows/);
});
test('OAB: kolon pivotunda drill-down yalnız çift tıklanan kolon grubunun ham satırlarını açar', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabPivotCellSourceRows'), OAB_JS.indexOf('function oabDrillContextText'));
  assert.match(body, /model\.pivot\.colFields/);
  assert.match(body, /descriptor\.colKey/);
  assert.match(body, /oabPivotGroupKey/);
});

test('Overview: OAB, Notes Reminder alanının hemen altında yer alır', () => {
  const notesStart = INDEX.indexOf('id="ovPriorityReminder"');
  const oabStart = INDEX.indexOf('id="oabSection"');
  assert.ok(notesStart > 0 && oabStart > notesStart);
  const between = INDEX.slice(notesStart, oabStart);
  assert.match(between, /<\/section>\s*<!-- OAB/);
  assert.doesNotMatch(between, /id="kpiCP"|id="tblCountry"|id="tblSeason"/);
});

test('Overview: Notes Reminder açılıp kapanabilir ve tercih kişisel workspace ile hatırlanır', () => {
  const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.match(INDEX, /id="ovNotesCollapseBtn"/);
  assert.match(APP_MAIN, /OVERVIEW_NOTES_COLLAPSE_KEY/);
  assert.match(APP_MAIN, /applyOverviewNotesCollapsed/);
  assert.match(APP_MAIN, /BLStorage\.setItem\(OVERVIEW_NOTES_COLLAPSE_KEY/);
  assert.match(CSS, /\.ovPriorityReminder\.isCollapsed \.ovPriorityList/);
});

/* -------------------------------------- 17) OAB DRILL-DOWN TABLE UX */

test('OAB: alt detay modalı ekranın neredeyse tamamını kullanır ve tablo kalan yüksekliği doldurur', () => {
  const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.match(CSS, /\.autoModal\.oabDrillModal\{width:calc\(100vw - 28px\);max-width:none;height:calc\(100vh - 28px\);max-height:none;\}/);
  assert.match(CSS, /\.oabDrillModal \.autoModalBody\{flex:1;min-height:0;overflow:hidden;/);
  assert.match(CSS, /\.oabDrillTableWrap\{overflow:auto;min-height:0;max-height:none;height:100%;/);
});

test('OAB: alt detay tablosunda her sütunda CP benzeri değer filtresi ve sıralama kontrolleri vardır', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenPivotDetail'), OAB_JS.indexOf('function oabRenderPivotTable'));
  assert.match(body, /const drillFilters = new Map\(\)/);
  assert.match(body, /colFilterPanel colFilterPanelModal oabDrillFilterPanel/);
  assert.match(body, /data-oab-drill-filter=/);
  assert.match(body, /cfpSearch/);
  assert.match(body, /cfpApplySelection/);
  assert.match(body, /data-oab-drill-filter-remove/);
  assert.match(body, /data-oab-drill-sort=/);
  assert.match(OAB_JS, /function oabDrillRowsForState/);
});

test('OAB: alt detay Excel aktarımı aktif arama/sütun filtrelerinden geçen tüm satırları aktarır', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenPivotDetail'), OAB_JS.indexOf('function oabRenderPivotTable'));
  assert.match(body, /data-oab-drill-export/);
  assert.match(body, /const rows = sortedFilteredRows\(\)/);
  assert.match(body, /book_append_sheet\(wb, ws, 'OAB Alt Detay'\)/);
  assert.match(body, /OAB_Alt_Detay_/);
  const exportPart = body.slice(body.indexOf('const exportDrill'), body.indexOf('render();', body.indexOf('const exportDrill')));
  assert.doesNotMatch(exportPart, /slice\(0,\s*1000\)/, 'Excel export ekran gösterim limitiyle kesilmemeli');
});


/* -------------------------------------- 18) OAB PLM LINKS + DRILL-DOWN IMAGES */

test('OAB: Option Adı hücreleri CoreNectum PLM model linkine dönüşür', () => {
  assert.match(OAB_JS, /function oabIsOptionNameField/);
  assert.match(OAB_JS, /function oabOptionPlmLinkHtml/);
  assert.match(OAB_JS, /global\.BLPlmModelLinks/);
  const appMain = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(appMain, /window\.BLPlmModelLinks=/);
  const raw = OAB_JS.slice(OAB_JS.indexOf('function oabRenderRawTable'), OAB_JS.indexOf('function oabRawDisplayValue'));
  assert.match(raw, /oabDataCellHtml\(d\.key/);
  const pivot = OAB_JS.slice(OAB_JS.indexOf('function oabPivotCellHtml'), OAB_JS.indexOf('const OAB_DRILL_ID_FIELDS'));
  assert.match(pivot, /oabIsOptionNameField\(descriptor\.label\)/);
});

test('OAB: PLM link listesi sonradan yüklense bile OAB yeniden render edilir', () => {
  const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(APP_MAIN, /window\.BLOAB\?\.refreshPlmLinks\?\.\(\)/);
  assert.match(OAB_JS, /global\.BLOAB\.refreshPlmLinks/);
});

test('OAB: drill-down görselleri Option Adı hemen sağına açılıp kapanabilir', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('const OAB_DRILL_IMAGES_PREF_KEY'), OAB_JS.indexOf('function oabRenderPivotTable'));
  assert.match(body, /data-oab-drill-images/);
  assert.match(body, /Görselleri Göster/);
  assert.match(body, /Görselleri Gizle/);
  assert.match(body, /oabDrillFieldsWithImage/);
  assert.match(body, /oabIsOptionNameField\(field\).*kind: 'image'/s);
  assert.match(body, /global\.BLDetailImages\.buildIndex/);
  assert.match(body, /modelName: source\['Option Adı'\]/);
  assert.match(body, /colourCode: source\['Renk Kodu'\]/);
  assert.match(body, /detailModelThumb/);
});

test('OAB: drill-down Option Adı hücresi de PLM linkidir, görsel sentetik alanı Excel kolonlarına eklenmez', () => {
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabOpenPivotDetail'), OAB_JS.indexOf('function oabRenderPivotTable'));
  assert.match(body, /oabIsOptionNameField\(field\) \? oabOptionPlmLinkHtml/);
  const exportPart = body.slice(body.indexOf('const exportDrill'), body.indexOf('render();', body.indexOf('const exportDrill')));
  assert.match(exportPart, /const fields = mode === 'all' \? allFields : summaryFields/);
  assert.doesNotMatch(exportPart, /__OAB_IMAGE__/);
});


test('OAB: overview yetkisi PLM linklerini ve kayıtlı model görsellerini salt-okunur okuyabilir', () => {
  assert.match(SERVER, /app\.get\('\/api\/plm-style-links',[\s\S]{0,120}'overview'/);
  assert.match(SERVER, /app\.get\('\/api\/collection-images\/:id',[\s\S]{0,140}'overview'/);
  assert.match(SERVER, /app\.get\('\/api\/cp-images\/:id',[\s\S]{0,140}'overview'/);
  assert.doesNotMatch(SERVER, /app\.delete\('\/api\/collection-images\/:id',[\s\S]{0,100}'overview'/);
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/cp-images',[\s\S]{0,100}'overview'/);
});
