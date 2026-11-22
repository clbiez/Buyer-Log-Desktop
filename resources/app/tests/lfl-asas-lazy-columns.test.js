'use strict';

/* Saha (moderatör, 62.660 LFL satırı): /api/lfl her satırın tam _asas torbasını
   (~41 ham ASAS sütunu) gönderiyordu, yanıt ~80 MiB'tı. İstemci torbayı yalnız
   ASAS kırılımı değeri ve yüklü ASAS sütun adları için kullanır. Yanıt artık
   sütun adlarını ve yalnız seçili ASAS kırılım sütunlarını taşır; yeni seçilen
   sütun ayrı uçtan, aynı yetki ve kapsamla gelir. Sunucu runtime'ı değişmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const lflSource = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function row(id, mag, asas) {
  return { id, orderCode: `DEMO-${id}`, mag, mmyg: 'DEMO', classification: 'KAZAK', season: 'S7', inStore: '2027-01-10', fob: 10, quantity: 100,
    manufacturer: 'DEMO A', country: 'CHINA', buyingGroup: 'DEMO', buyer: 'DEMO', _asas: asas };
}

function mountRoutes({ runtime, scope = rows => rows, ready = true, areaCalls = [] } = {}) {
  const routes = new Map();
  const register = method => (url, ...handlers) => routes.set(`${method} ${url}`, handlers);
  require('../server/routes/lfl-routes')({ get: register('GET'), post: register('POST') }, {
    sourceUserId: req => req.currentUser.id, cacheForUser: () => runtime, ensureDataLoaded: async () => {}, initialDataLoadPromises: new Map(),
    loadFromModels: async () => runtime, sourceFilterReadiness: () => ({ ready }), sourceFilterReadinessMessage: () => 'filter',
    userAccess: { requireArea: area => { const guard = (_req, _res, next) => next && next(); guard.area = area; areaCalls.push(area); return guard; },
      publicProfile: user => user, appendAudit() {}, filterRowsByScope: (user, rows) => scope(rows, user) },
    attachModelImageIdentities: rows => rows, modelImageIdentityOrders: () => [], withFabricDimensions: meta => ({ ...(meta || {}) }),
    sendDateSafeJson: (res, data) => res.json(JSON.parse(JSON.stringify(data))), apiError: (res, error) => res.status(error.statusCode || 500).json({ error: error.message }),
  });
  async function call(key, query = {}, user = { id: 'buyer', scopes: { mags: ['A', 'B'] } }) {
    const res = { code: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await routes.get(key).at(-1)({ query, currentUser: user, body: {} }, res);
    return res;
  }
  return { routes, call };
}

test('/api/lfl _asas torbasını göndermez; sütun adları ve yalnız istenen ASAS sütunu satır sırasıyla gelir', async () => {
  const runtime = { lflLoadedAt: 'v1', lflMeta: {}, lflRows: [row(1, 'A', { Renk: 'MAVİ', Kalıp: 'SLIM' }), row(2, 'B', { Renk: 'KIRMIZI', Kalıp: null }), row(3, 'A', { Kalıp: 'REGULAR' })] };
  const { call } = mountRoutes({ runtime });
  const plain = await call('GET /api/lfl');
  assert.equal(plain.code, 200);
  assert.equal(plain.data.rows.length, 3);
  assert.ok(plain.data.rows.every(item => !Object.prototype.hasOwnProperty.call(item, '_asas')), 'ham ASAS torbası yanıta girmez');
  assert.deepEqual([...plain.data.meta.asasHeaders].sort(), ['Kalıp', 'Renk']);
  assert.deepEqual(plain.data.asas.columns, []);
  assert.match(plain.data.asas.version, /^[0-9a-f]{24}$/);

  const selected = await call('GET /api/lfl', { asas: JSON.stringify(['Renk']) });
  assert.deepEqual(selected.data.asas.columns, [{ header: 'Renk', values: ['MAVİ', 'KIRMIZI', null] }]);
  assert.equal(selected.data.asas.version, plain.data.asas.version);
  // Sunucu runtime'ı / snapshot kaynağı değişmez.
  assert.deepEqual(runtime.lflRows[0]._asas, { Renk: 'MAVİ', Kalıp: 'SLIM' });
});

test('ASAS sütunu yalnız kullanıcının kapsamındaki satırlar için ve aynı sırayla döner; ayrı uç aynı değerleri verir', async () => {
  const runtime = { lflLoadedAt: 'v1', lflMeta: {}, lflRows: [row(1, 'A', { Renk: 'MAVİ' }), row(2, 'B', { Renk: 'GİZLİ' }), row(3, 'A', { Renk: 'YEŞİL' })] };
  const areas = [];
  const { call } = mountRoutes({ runtime, areaCalls: areas, scope: (rows, user) => rows.filter(item => user.scopes.mags.includes(item.mag)) });
  const user = { id: 'buyer', scopes: { mags: ['A'] } };
  const full = await call('GET /api/lfl', { asas: JSON.stringify(['Renk']) }, user);
  assert.deepEqual(full.data.rows.map(item => item.id), [1, 3]);
  assert.deepEqual(full.data.asas.columns[0].values, ['MAVİ', 'YEŞİL']);
  assert.ok(!JSON.stringify(full.data).includes('GİZLİ'), 'kapsam dışı satırın ASAS değeri sızmaz');

  const lazy = await call('GET /api/lfl/asas-columns', { headers: JSON.stringify(['Renk']), version: full.data.asas.version }, user);
  assert.equal(lazy.code, 200);
  assert.equal(lazy.headers['Cache-Control'], 'no-store');
  assert.deepEqual(lazy.data, { version: full.data.asas.version, rowCount: 2, columns: [{ header: 'Renk', values: ['MAVİ', 'YEŞİL'] }] });
  assert.ok(areas.includes('lfl'));

  // Başka kapsam, aynı satır sayısı: hizalama sürümü değişir → 409 (yanlış satıra değer yazılmaz).
  const other = await call('GET /api/lfl/asas-columns', { headers: JSON.stringify(['Renk']), version: full.data.asas.version }, { id: 'buyer', scopes: { mags: ['B'] } });
  assert.equal(other.code, 409);
  assert.equal(other.data.code, 'LFL_ASAS_STALE');
  assert.ok(!JSON.stringify(other.data).includes('GİZLİ'));
  runtime.lflLoadedAt = 'v2';
  assert.equal((await call('GET /api/lfl/asas-columns', { headers: JSON.stringify(['Renk']), version: full.data.asas.version }, user)).code, 409, 'yeni LFL yüklemesi eski hizayı geçersiz kılar');
});

test('ASAS sütun istekleri doğrulanır; kaynak filtresi hazır değilse değer dönmez', async () => {
  const runtime = { lflLoadedAt: 'v1', lflMeta: {}, lflRows: [row(1, 'A', { Renk: 'MAVİ' })] };
  const { call } = mountRoutes({ runtime });
  for (const asas of ['not-json', JSON.stringify('Renk'), JSON.stringify([1]), JSON.stringify(Array.from({ length: 13 }, (_, i) => `H${i}`)), JSON.stringify(['x'.repeat(257)])]) {
    assert.equal((await call('GET /api/lfl', { asas })).code, 400, asas.slice(0, 40));
  }
  assert.equal((await call('GET /api/lfl/asas-columns', { headers: JSON.stringify(['Renk']) })).code, 400, 'sürüm zorunlu');
  assert.equal((await call('GET /api/lfl/asas-columns', { headers: '[]', version: 'x' })).code, 400, 'en az bir sütun');
  const notReady = mountRoutes({ runtime, ready: false });
  const blocked = await notReady.call('GET /api/lfl/asas-columns', { headers: JSON.stringify(['Renk']), version: 'x' });
  assert.equal(blocked.code, 409);
  assert.equal(blocked.data.code, 'SOURCE_FILTER_REQUIRED');
});

test('LFL yenilemesi de seçili ASAS sütunlarını aynı biçimde döndürür', async () => {
  const runtime = { lflLoadedAt: 'v1', lflMeta: {}, sources: { lfl: 'ASAS' }, lflRows: [row(1, 'A', { Renk: 'MAVİ' })] };
  const { call } = mountRoutes({ runtime });
  const refreshed = await call('POST /api/lfl/refresh', { asas: JSON.stringify(['Renk', 'Yok']) });
  assert.equal(refreshed.code, 200);
  assert.ok(!('_asas' in refreshed.data.rows[0]));
  assert.deepEqual(refreshed.data.asas.columns, [{ header: 'Renk', values: ['MAVİ'] }, { header: 'Yok', values: [null] }]);
  assert.equal((await call('POST /api/lfl/refresh', { asas: '{' })).code, 400);
});

/* İstemci: saf yardımcılar kaynaktan alınıp gerçek davranışla sınanır. */
function clientHelpers(state, saved = {}) {
  const start = lflSource.indexOf('  const ASAS_COLUMN_REQUEST_LIMIT=');
  const end = lflSource.indexOf('  function invalidateAsasGroupCache(');
  assert.ok(start > 0 && end > start, 'ASAS sütun yardımcıları lfl.js içinde');
  const prefix = lflSource.slice(lflSource.indexOf("  const ASAS_BREAKDOWN_PREFIX="), lflSource.indexOf('  const isValidBreakdownDim='));
  const context = vm.createContext({ state, loadSaved: () => saved });
  vm.runInContext(`${prefix}\n  const asasHeaderFromDim=dim=>isAsasBreakdownDim(dim)?String(dim).slice(ASAS_BREAKDOWN_PREFIX.length):'';\n${lflSource.slice(start, end)}\n  this.api={asasColumnsState,asasHeadersForDims,requestedAsasHeaders,applyAsasColumns,missingAsasHeaders};`, context);
  return context.api;
}

test('istemci sütunları süzülmemiş yanıt sırasıyla satırlara yazar; eksik sütunu bilir; eski sunucuda tam torbayı kullanır', () => {
  const state = { breakdown: ['mag', 'asas:Renk', 'asas:Kalıp', 'asas:Bilinmeyen'] };
  const api = clientHelpers(state, { breakdown: ['asas:Kayıtlı'] });
  assert.deepEqual([...api.requestedAsasHeaders()], ['Renk', 'Kalıp', 'Bilinmeyen', 'Kayıtlı'], 'kayıtlı kırılımın sütunu ilk istekte gelir');

  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  state.asas = api.asasColumnsState({ version: 'v1', columns: [] }, ['Renk', 'Kalıp', '__proto__'], rows);
  api.applyAsasColumns(state.asas, [{ header: 'Renk', values: ['MAVİ', null] }, { header: '__proto__', values: ['x', 'y', 'z'] }]);
  assert.deepEqual(rows.map(item => item._asas.Renk), ['MAVİ', null, null]);
  assert.equal(Object.getPrototypeOf(rows[0]._asas), null, 'başlık adı prototipi değiştiremez');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0]._asas, '__proto__'), true);
  assert.deepEqual([...api.missingAsasHeaders()], ['Kalıp'], 'yüklü listede olmayan başlık için istek yapılmaz');
  state.asas.failed.add('Kalıp');
  assert.deepEqual([...api.missingAsasHeaders()], [], 'başarısız sütun tekrar tekrar istenmez');

  state.asas = api.asasColumnsState(null, [], rows);
  assert.equal(state.asas.legacy, true);
  assert.deepEqual([...api.missingAsasHeaders()], [], 'eski sunucu tam torba gönderir; ek istek yok');
});

test('istemci sözleşmesi: yükleme seçili sütunları ister, ASAS kırılımı eksikse önce o sütunu indirir', () => {
  assert.match(lflSource, /fetch\(\(force\?'\/api\/lfl\/refresh':'\/api\/lfl'\)\+asasQuery,/);
  assert.match(lflSource, /asasQuery=asasHeaders\.length\?`\?asas=\$\{encodeURIComponent\(JSON\.stringify\(asasHeaders\)\)\}`:''/);
  assert.match(lflSource, /state\.asas=asasColumnsState\(asasPayload,data\.meta&&data\.meta\.asasHeaders,Array\.isArray\(data\.rows\)\?data\.rows:\[\]\);\n\s*if\(asasPayload\)applyAsasColumns\(state\.asas,asasPayload\.columns\);\n\s*state\.serverRows=/,
    'sütunlar süzmeden önce, yanıt sırasıyla yazılır');
  assert.match(lflSource, /\/api\/lfl\/asas-columns\?headers=\$\{encodeURIComponent\(JSON\.stringify\(missing\)\)\}&version=\$\{encodeURIComponent\(asas\.version\)\}/);
  assert.match(lflSource, /res\.status===409&&data&&data\.code==='LFL_ASAS_STALE'\)\{\n\s*const ok=await load\(false,\{preserveOnError:true,silent:true\}\);/);
  const render = lflSource.slice(lflSource.indexOf('  function render(){'), lflSource.indexOf('    enforceTrialFilterRules();\n    trialUpdateButton();'));
  assert.match(render, /if\(!state\.loading&&state\.serverRows\.length&&missingAsasHeaders\(\)\.length\)/);
  assert.match(render, /void ensureAsasColumns\(\)\.then\(\(\)=>\{setLoadingView\(false\);if\(!state\.loading\)render\(\);\}\);\n\s*return;/);
  // Gelen sütun, önceden boş hesaplanmış grup etiketlerini geçersiz kılar.
  assert.match(lflSource, /applyAsasColumns\(asas,data\.columns\);[^\n]*\n\s*invalidateAsasGroupCache\(asas\.sourceRows\);/);
  assert.match(lflSource, /function invalidateAsasGroupCache\(rows\)\{\n\s*analysisDatasetRevision\+=1;lflAnalysisCache\.clear\(\);lflScenarioCache\.clear\(\);/);
  // Hata yolunda yeniden yüklenemeyen eski veri sürümü de korunur.
  assert.match(lflSource, /trialRows:state\.trial\.rows,asas:state\.asas\}:null;/);
  assert.match(lflSource, /state\.trial\.rows=preserved\.trialRows;state\.asas=preserved\.asas;/);
  // Sütun adları sunucu listesinden; tam torba taraması yalnız eski sunucu için.
  assert.match(lflSource, /const set=new Set\(\(state\.asas&&state\.asas\.headers\)\|\|\[\]\);\n\s*\/\/[^\n]*\n\s*if\(!state\.asas\|\|state\.asas\.legacy\)/);
  // TR/EN: yeni yükleme ve hata metinleri iki dilde.
  for (const text of ['Loading ASAS column…', 'ASAS sütunu yükleniyor…', 'Only the selected ASAS breakdown column is downloaded.', 'Yalnız seçilen ASAS kırılım sütunu indiriliyor.', 'ASAS column could not be loaded: ', 'ASAS sütunu yüklenemedi: ']) {
    assert.ok(lflSource.includes(text), text);
  }
});
