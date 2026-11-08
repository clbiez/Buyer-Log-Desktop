'use strict';
const {extractFunction:extractAppFunction}=require('./helpers/app-main-functions');

// v5.98 — Notlar ve kişisel veriler tarayıcılar arasında taşınmıyordu.
//
// Kök neden bir hata değil, mevcut tasarımdı: BLStorage yalnız localStorage'ın
// ince bir sarmalayıcısıydı. localStorage TARAYICIYA özeldir — Edge'de yazılan
// not Chrome'da görünmez, tarayıcı verisi temizlenince ya da makine değişince
// tamamen kaybolur. Not Defteri'nin sunucuda hiçbir karşılığı yoktu.
//
// Artık seçili anahtarlar kullanıcı hesabına bağlı olarak sunucuda da tutulur
// ve açılışta birleştirilir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {extractFunction} = require('./helpers/app-main-functions');

const ROOT = path.join(__dirname, '..');
process.env.BUYER_LOG_SERVER_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-prefs-'));
const prefs = require('../server/lib/user-preferences');
const STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test.after(() => fs.rmSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true, force: true }));

test('v5.98 Not Defteri taşınan anahtarlar arasında', () => {
  // Kullanıcının bildirdiği asıl kayıp buydu.
  assert.equal(prefs.isSyncedKey('lcw.todo.pages.v1'), true);
  assert.equal(prefs.isSyncedKey('lcw.todo.text.v1'), true);
  assert.equal(prefs.isSyncedKey('lcw.mailTemplates.v1'), true);
  assert.equal(prefs.isSyncedKey('lcw_view_favorite_cp'), true);
  assert.equal(prefs.isSyncedKey('lcw_filter_favorite_orders'), true);
});

test('v7.01 ekrana özgü görünüm tercihleri kişisel workspace ile taşınıyor', () => {
  ['lcw_theme', 'lcw.table.columnState.v1', 'lcw.freeze.v1', 'lcw.backlog.columnWidths.v1', 'lcw_font_step']
    .forEach(key => assert.equal(prefs.isSyncedKey(key), true, `${key} kullanıcıya özel taşınmalı`));
  // İstemci ve sunucu aynı listeyi kullanmalı; ayrışırsa veri sessizce düşerdi.
  prefs.SYNCED_PREFIXES.forEach(prefix => {
    assert.ok(STORAGE.includes(`'${prefix}'`), `${prefix} istemci listesinde de olmalı`);
  });
});

test('v7.01 whitelist dışındaki anahtar sunucuya yazılmıyor', () => {
  const saved = prefs.merge('u-a', { 'lcw.todo.pages.v1': { value: 'A' }, 'sharedBacklogFilter': { value: 'unsafe' } });
  assert.deepEqual(Object.keys(saved.entries), ['lcw.todo.pages.v1']);
  assert.deepEqual(saved.rejected, [{ key: 'sharedBacklogFilter', reason: 'not-synced' }]);
});

test('v5.98 daha eski kopya yenisini ezmiyor', () => {
  const owner = 'u-b';
  prefs.merge(owner, { 'lcw.todo.pages.v1': { value: 'YENI', updatedAt: '2026-08-13T10:00:00.000Z' } });
  // Geç açılan bir tarayıcının bayat kopyası yenisini ezmemeli.
  const result = prefs.merge(owner, { 'lcw.todo.pages.v1': { value: 'ESKI', updatedAt: '2026-08-13T09:00:00.000Z' } });
  assert.equal(prefs.load(owner).entries['lcw.todo.pages.v1'].value, 'YENI');
  assert.deepEqual(result.rejected, [{ key: 'lcw.todo.pages.v1', reason: 'stale' }]);
  // Daha yeni kopya yazılmalı.
  prefs.merge(owner, { 'lcw.todo.pages.v1': { value: 'EN_YENI', updatedAt: '2026-08-13T11:00:00.000Z' } });
  assert.equal(prefs.load(owner).entries['lcw.todo.pages.v1'].value, 'EN_YENI');
});

test('v5.98 kullanıcılar birbirinin verisini görmüyor', () => {
  prefs.merge('u-c', { 'lcw.todo.pages.v1': { value: 'C' } });
  assert.equal(prefs.load('u-d').entries['lcw.todo.pages.v1'], undefined);
  assert.equal(prefs.load('u-c').entries['lcw.todo.pages.v1'].value, 'C');
});

test('v5.98 aşırı büyük değer tek başına reddediliyor, diğerleri kaydediliyor', () => {
  const owner = 'u-e';
  const huge = 'x'.repeat(prefs.MAX_VALUE_BYTES + 10);
  const saved = prefs.merge(owner, { 'lcw.todo.pages.v1': { value: 'küçük' }, 'lcw.mailTemplates.v1': { value: huge } });
  assert.equal(saved.entries['lcw.todo.pages.v1'].value, 'küçük');
  assert.equal(saved.entries['lcw.mailTemplates.v1'], undefined);
  assert.deepEqual(saved.rejected, [{ key: 'lcw.mailTemplates.v1', reason: 'too-large' }]);
});

test('v5.98 silme yalnız verilen anahtarları kaldırıyor', () => {
  const owner = 'u-f';
  prefs.merge(owner, { 'lcw.todo.pages.v1': { value: 'A' }, 'lcw.mailTemplates.v1': { value: 'B' } });
  const saved = prefs.removeKeys(owner, ['lcw.todo.pages.v1']);
  assert.equal(saved.entries['lcw.todo.pages.v1'], undefined);
  assert.equal(saved.entries['lcw.mailTemplates.v1'].value, 'B');
});

test('v5.98 yazma sunucuya gönderiliyor ama gecikmeli', () => {
  // Not yazarken her tuşta istek atmak gereksiz yük olurdu.
  assert.match(STORAGE, /pushTimer=global\.setTimeout\(flushPush,1200\)/);
  assert.match(STORAGE, /pending\[key\]=\{value:String\(value\),updatedAt:stamp\}/);
  // Sekme kapanırken bekleyen yazma kaybolmamalı.
  assert.match(STORAGE, /addEventListener\('pagehide'/);
  // Çevrimdışıyken hata yutulmalı: yerel kopya zaten yazıldı.
  assert.match(STORAGE, /catch\(function\(\)\{\/\* çevrimdışı olabilir/);
});

test('v5.98 birleştirme iki yönlü: yeni olan kazanır', () => {
  const start = STORAGE.indexOf('hydrate:function(');
  const end = STORAGE.indexOf('  };\n  Object.defineProperty', start);
  assert.ok(start >= 0 && end > start, 'gerçek hydrate metodu bulunmalı');
  const block = STORAGE.slice(start, end);
  // Sunucu daha yeniyse yerele yazılır.
  assert.match(block, /String\(remote\.updatedAt\|\|''\)>localStamp/);
  // Yerel daha yeniyse sunucuya gönderilir — bu tarayıcıda yazılmış notlar
  // diğerlerine geçsin diye.
  assert.match(block, /localStamp>String\(remote\.updatedAt\|\|''\)/);
  // Sunucuda hiç olmayan yerel anahtarlar da yukarı taşınmalı.
  assert.match(block, /if\(!synced\(key\)\|\|data\.entries\[key\]\)return;/);
  // Ağ hatası açılışı engellememeli.
  assert.match(block, /\.catch\(function\(error\)\{if\(applyBarrierFailed\)throw error;return \{applied:0,pushed:0\}\}\)/);
});

test('v5.98 açılışta birleştirme çağrılıyor ve Not Defteri önbelleği tazeleniyor', () => {
  // hydrate() çağrısı authHydrationPromise'in içine taşındı: açılış onu
  // beklemeden ilerliyor, bu blok yalnız sonucu alıp önbellekleri bırakıyor.
  const anchor = 'const sync=await authHydrationPromise;';
  const load = extractAppFunction(APP, 'loadFromServer');
  const at = load.indexOf(anchor);
  assert.ok(at > 0, 'açılışta kişisel veri birleştirmesi beklenmeli');
  const hydrate = extractFunction(APP, 'hydrateUserPreferencesAfterUi');
  assert.match(hydrate, /authHydrationPromise=Promise\.resolve\(\)\.then\(\(\)=>BLStorage\.hydrate\(\{beforeApply:/, 'birleştirme BLStorage.hydrate ve uygulanma öncesi kapısıyla yapılmalı');
  const block = load.slice(at);
  // Not Defteri belleğe alınıyor; taze veri geldiğinde bırakılmalı, yoksa
  // sunucudan gelen notlar ekrana yansımazdı.
  assert.match(block, /if\(sync&&sync\.applied\)\{ _todoState=null; \}/);
  // Hata yakalama da authHydrationPromise'e taşındı; birleştirme başarısız
  // olsa bile açılış devam etmeli ve sebep konsola yazılmalı.
  assert.match(hydrate, /\.catch\(error=>\{[\s\S]*?console\.warn\('Kişisel veriler eşitlenemedi:',error\);[\s\S]*?return null;/,
    'birleştirme hatası açılışı durdurmamalı, sebebi kaydedilmeli');
});

for (const [name, localStamp, remoteStamp, expected, applied, pushed] of [
  ['newer remote notebook', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'remote', 1, 0],
  ['newer local notebook', '2026-09-01T11:00:00Z', '2026-09-01T10:00:00Z', 'local', 0, 1],
  ['local notebook missing remotely', '2026-09-01T11:00:00Z', null, 'local', 0, 1],
]) test('native browser hydrate preserves ' + name, async () => {
  const key = 'lcw.todo.pages.v1', prefix = 'bl.user.synthetic-notebook.';
  const values = new Map([[prefix + key, 'local'], [prefix + '__syncMeta.v1', JSON.stringify({[key]: localStamp})]]);
  const writes = [];
  const sandbox = {
    BL_USER_CONTEXT: {id: 'synthetic-notebook'},
    localStorage: {get length(){return values.size;}, key:index=>[...values.keys()][index]??null,
      getItem:key=>values.get(String(key))??null, setItem:(key,value)=>values.set(String(key),String(value)), removeItem:key=>values.delete(String(key))},
    fetch:async (_url, options) => {
      if(options?.method === 'PUT') { writes.push(JSON.parse(options.body).entries); return {ok:true,json:async()=>({ok:true})}; }
      return {ok:true,json:async()=>({entries:remoteStamp?{[key]:{value:'remote',updatedAt:remoteStamp}}:{}})};
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(STORAGE, sandbox);
  const result = await sandbox.BLStorage.hydrate();
  assert.equal(sandbox.BLStorage.getItem(key), expected);
  assert.equal(result.applied, applied); assert.equal(result.pushed, pushed);
  assert.equal(writes.length, pushed);
  if(pushed) assert.equal(writes[0][key].value, 'local');
});

test('v5.98 uç noktalar kullanıcının kendi kaydına bağlı', () => {
  assert.match(SERVER, /app\.get\('\/api\/user-preferences'/);
  assert.match(SERVER, /app\.put\('\/api\/user-preferences'/);
  assert.match(SERVER, /app\.post\('\/api\/user-preferences\/delete'/);
  // Kimlik her zaman oturumdan alınmalı; istemcinin gönderdiği bir kullanıcı
  // kimliğine güvenmek başkasının verisine erişim açardı.
  const routes=SERVER.slice(SERVER.indexOf("app.get('/api/user-preferences'"),SERVER.indexOf('const USER_WORKSPACE_MODULES'));
  assert.equal((routes.match(/const ownerId=req\.currentUser\.id/g)||[]).length,3);
  assert.equal((routes.match(/await userPreferences\.(loadAsync|mergeAsync|removeKeysAsync)\(ownerId/g)||[]).length,3);
  assert.equal((routes.match(/assertAuthority:\(\)=>assertPreferenceOwner\(req,ownerId\)/g)||[]).length,3);
  assert.match(routes,/await userAccess\.roleWorkspaceEntriesAsync\(req\.currentUser/);
  assert.match(routes,/userAccess\.sessionProfile\(req\)/);
  assert.match(routes,/profile\.id !== ownerId/);
  assert.doesNotMatch(routes,/req\.body\.(?:userId|ownerId)/);
});
