'use strict';

/* AÇIKÇA KALDIRILAN KİŞİSEL KATMAN GERİ GELMEZ.
 *
 * Korunan kusur: kullanıcı Veri Yönetimi'nde kişisel Horizon katmanını
 * kaldırıyor, ortak filtre geçerli oluyor — ama Buyer Log kapanıp açılınca
 * kişisel katman geri geliyordu.
 *
 * Sebep, kaydın SİLİNMESİ ile HİÇ YAZILMAMIŞ OLMASININ diskte aynı görünmesiydi:
 * tarayıcıdaki yerel kopya açılışta "sunucuda yok, bende var" diyerek kaydı geri
 * gönderiyordu. Silme artık zaman damgasıyla kaydedilir (mezar taşı) ve silmeden
 * ÖNCE yazılmış bir kopya reddedilir.
 *
 * Kural: kullanıcının açık kararı > otomatik/varsayılan kişisel tohumlama.
 * Ama karar geri alınabilir olmalı — silmeden SONRA yapılan yeni bir kişisel
 * kayıt normal biçimde yazılır ve yeniden geçerli olur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-tombstone-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const prefs = require('../server/lib/user-preferences');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let seq = 0;
const newUser = () => `tombstone-user-${++seq}`;

/* Kullanıcının bildirdiği gerçek katman: sezon + alt grup + buyer. */
function personalHorizon() {
  return {
    table: 'ASAS',
    groups: [{
      id: 'g', conditions: [
        { id: 'c1', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: ['S6', 'S7', 'W6', 'W7'] },
        { id: 'c2', table: 'ASAS', field: 'Merch Alt Grup Kod', op: 'in', valueType: 'text', values: ['CU4E'] },
      ],
    }],
  };
}
const SHARED = {
  table: 'ASAS',
  groups: [{ id: 'shared', conditions: [{ id: 's1', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values: ['W6'] }] }],
};

const layerOf = (userId, module) => prefs.resolveHorizonProvenance(userId, module, SHARED, {}, null).layer;

test('kaldırılan kişisel katman ortak filtreye bırakır ve silme diske yazılır', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', personalHorizon());
  assert.equal(layerOf(user, 'cp'), 'personal');

  // Veri Yönetimi'ndeki "kişisel katmanı kaldır" ucunun yaptığı işin aynısı.
  prefs.removeKeys(user, [prefs.horizonKey('cp')]);

  assert.equal(layerOf(user, 'cp'), 'source');
  assert.deepEqual(prefs.resolveHorizon(user, 'cp', SHARED, {}, null), SHARED);

  // Silme, kaydın yokluğundan ayırt edilebilir olmalı (durum 1 ≠ durum 3).
  const stored = prefs.load(user);
  assert.equal(stored.entries[prefs.horizonKey('cp')], undefined);
  assert.ok(stored.deletions[prefs.horizonKey('cp')], 'silme zaman damgasıyla kaydedilmeli');
});

test('silmeden önceki yerel kopya kaydı DİRİLTEMEZ', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', personalHorizon());
  const before = prefs.load(user).entries[prefs.horizonKey('cp')].updatedAt;
  prefs.removeKeys(user, [prefs.horizonKey('cp')]);

  // Açılışta tarayıcının gönderdiği bayat kopya: değer silmeden ÖNCE yazılmış.
  const saved = prefs.merge(user, { [prefs.horizonKey('cp')]: { value: JSON.stringify(personalHorizon()), updatedAt: before } });
  assert.ok(saved.rejected.some(item => item.key === prefs.horizonKey('cp') && item.reason === 'deleted'));

  assert.equal(prefs.getHorizon(user, 'cp'), null);
  assert.equal(layerOf(user, 'cp'), 'source');

  // Yeniden kurulan oturum / yeniden okunan dosya da aynı sonucu vermeli.
  assert.equal(prefs.load(user).entries[prefs.horizonKey('cp')], undefined);
  assert.equal(layerOf(user, 'cp'), 'source');
});

test('kişisel VARSAYILAN kaldırılınca tüm modüller ortak filtreye döner ve dönmeye devam eder', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'default', personalHorizon());
  assert.equal(layerOf(user, 'orders'), 'personalDefault');

  const before = prefs.load(user).entries[prefs.horizonKey('default')].updatedAt;
  prefs.removeKeys(user, [prefs.horizonKey('default')]);
  prefs.merge(user, { [prefs.horizonKey('default')]: { value: JSON.stringify(personalHorizon()), updatedAt: before } });

  assert.equal(layerOf(user, 'orders'), 'source');
  assert.equal(layerOf(user, 'cp'), 'source');
});

test('silmeden SONRA yapılan yeni kişisel kayıt normal biçimde yazılır ve kalıcıdır', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', personalHorizon());
  prefs.removeKeys(user, [prefs.horizonKey('cp')]);
  assert.equal(layerOf(user, 'cp'), 'source');

  const next = personalHorizon();
  next.groups[0].conditions[0].values = ['W7'];
  prefs.saveHorizon(user, 'cp', next);

  assert.equal(layerOf(user, 'cp'), 'personal');
  assert.deepEqual(prefs.getHorizon(user, 'cp'), next);
  // Mezar taşı kalkmış olmalı; yoksa kayıt bir sonraki açılışta yine silinirdi.
  assert.equal(prefs.load(user).deletions[prefs.horizonKey('cp')], undefined);
  assert.equal(layerOf(user, 'cp'), 'personal');
});

test('bir kullanıcının silmesi diğerinin kişisel katmanını etkilemez', () => {
  const a = newUser(), b = newUser();
  prefs.saveHorizon(a, 'cp', personalHorizon());
  prefs.saveHorizon(b, 'cp', personalHorizon());

  prefs.removeKeys(a, [prefs.horizonKey('cp')]);

  assert.equal(layerOf(a, 'cp'), 'source');
  assert.equal(layerOf(b, 'cp'), 'personal');
  assert.equal(prefs.load(b).deletions[prefs.horizonKey('cp')], undefined);
});

test('hiç kaydı olmayan kullanıcı için varsayılan davranış değişmez', () => {
  const user = newUser();
  assert.equal(layerOf(user, 'cp'), 'source');
  assert.deepEqual(prefs.load(user).deletions, {});
});

/* ---- Kaynak sözleşmesi: tarayıcı tarafı birleştirme ------------------ */

const ROOT = path.join(__dirname, '..');
const STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const DATA_MANAGEMENT = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');

test('sunucu silinen anahtarları istemciye bildirir', () => {
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/user-preferences'"), SERVER.indexOf("app.put('/api/user-preferences'"));
  assert.match(route, /deletions:\s*store\.deletions/, 'GET /api/user-preferences deletions döndürmeli');
});

test('hydrate silinen anahtarı geri göndermez', () => {
  const block = STORAGE.slice(STORAGE.indexOf('hydrate:function()'), STORAGE.indexOf('  };\n  Object.defineProperty'));
  assert.ok(block, 'hydrate bloğu bulunmalı');
  assert.match(block, /data\.deletions/, 'hydrate sunucudaki silme kaydını okumalı');
  assert.match(block, /native\.removeItem\(actual\(key\)\)/, 'silinen anahtarın yerel kopyası da temizlenmeli');
  // Silme işlemi, "sunucuda olmayan yerel anahtarları yukarı taşı" döngüsünden
  // ÖNCE gelmeli; sonra gelseydi kayıt aynı açılışta geri gönderilirdi.
  assert.ok(block.indexOf('data.deletions') < block.indexOf('Object.keys(meta).forEach'),
    'silme işlemi yukarı taşıma döngüsünden önce yapılmalı');
});

test('Veri Yönetimi kaldırma işlemi yerel aynayı da unutur', () => {
  assert.match(DATA_MANAGEMENT, /function forgetLocalHorizonMirror/);
  assert.match(DATA_MANAGEMENT, /forgetLocalHorizonMirror\(feed\.layerKey === 'personalDefault' \? 'default' : moduleId\)/);
});

/* ---- Canlı davranış: tarayıcı birleştirmesi (hydrate) --------------- */

const vm = require('node:vm');

/* user-storage.js tarayıcı dosyasıdır; küçük bir localStorage/fetch taklidiyle
   gerçekten çalıştırılır. Kaynak deseni sınamak bu noktada yetmezdi: diriltme
   tam olarak bu fonksiyonun içinde oluyordu. */
function runStorage(stored, serverPayload) {
  const map = new Map(Object.entries(stored));
  const localStorage = {
    get length() { return map.size; },
    key: index => Array.from(map.keys())[index] ?? null,
    getItem: key => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: key => { map.delete(String(key)); },
    clear: () => map.clear(),
  };
  const pushed = [];
  const sandbox = {
    localStorage,
    BL_USER_CONTEXT: { id: 'u1' },
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    fetch: (url, options) => {
      if (String(url) === '/api/user-preferences' && (!options || !options.method || options.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(serverPayload) });
      }
      if (options && options.method === 'PUT') pushed.push(JSON.parse(options.body).entries);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8'), sandbox);
  return { storage: sandbox.BLStorage, localStorage, pushed, map };
}

const HORIZON_LOCAL_KEY = 'bl.user.u1.buyerlog.workspace.horizon.cp.v1';

test('hydrate: silinen kişisel Horizon ne yerel kopyadan geri gelir ne de sunucuya geri gönderilir', async () => {
  const value = JSON.stringify(personalHorizon());
  const context = runStorage({
    [HORIZON_LOCAL_KEY]: value,
    'bl.user.u1.__syncMeta.v1': JSON.stringify({ 'buyerlog.workspace.horizon.cp.v1': '2026-09-01T10:00:00.000Z' }),
  }, {
    ok: true, entries: {}, deletions: { 'buyerlog.workspace.horizon.cp.v1': '2026-09-02T10:00:00.000Z' }, roleDefaults: {},
  });

  await context.storage.hydrate();

  assert.equal(context.localStorage.getItem(HORIZON_LOCAL_KEY), null, 'yerel kopya temizlenmeli');
  assert.deepEqual(context.pushed, [], 'silinen anahtar sunucuya geri gönderilmemeli');
});

test('hydrate: silmeden SONRA yazılmış yerel kayıt korunur ve sunucuya taşınır', async () => {
  const value = JSON.stringify(personalHorizon());
  const context = runStorage({
    [HORIZON_LOCAL_KEY]: value,
    'bl.user.u1.__syncMeta.v1': JSON.stringify({ 'buyerlog.workspace.horizon.cp.v1': '2026-09-03T10:00:00.000Z' }),
  }, {
    ok: true, entries: {}, deletions: { 'buyerlog.workspace.horizon.cp.v1': '2026-09-02T10:00:00.000Z' }, roleDefaults: {},
  });

  await context.storage.hydrate();

  assert.equal(context.localStorage.getItem(HORIZON_LOCAL_KEY), value);
  assert.equal(context.pushed.length, 1);
  assert.ok(context.pushed[0]['buyerlog.workspace.horizon.cp.v1']);
});

test('hydrate: silme kaydı olmayan yerel anahtar eskisi gibi yukarı taşınır', async () => {
  const context = runStorage({
    'bl.user.u1.lcw.todo.v1': '[]',
    'bl.user.u1.__syncMeta.v1': JSON.stringify({ 'lcw.todo.v1': '2026-09-01T10:00:00.000Z' }),
  }, { ok: true, entries: {}, deletions: {}, roleDefaults: {} });

  await context.storage.hydrate();

  assert.equal(context.pushed.length, 1);
  assert.ok(context.pushed[0]['lcw.todo.v1']);
});
