'use strict';

/*
 * v10.14 — MASAÜSTÜ (Electron) BARINDIRICI.
 *
 * Bu testler bir mimari sözleşmeyi kilitliyor: Electron'a taşınma bir
 * BARINDIRMA değişikliğidir. Veri yolları, kimlik, güvenlik varsayılanları ve
 * kurumsal tarayıcı entegrasyonu bu taşımada değişmemeli.
 *
 * Başlıklar, korunan kusurun NEDEN öyle çözüldüğünü anlatır; bir testi
 * gevşetmeden önce başlığını okuyun.
 */

const test = require('node:test');
const winTest = process.platform === 'win32' ? test : test.skip;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const paths = require('../electron/portable-paths');
const migration = require('../electron/first-run-migration');
const backend = require('../electron/backend');

const APP_ROOT = path.resolve(__dirname, '..');

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-desktop-' + label + '-'));
}

/* ------------------------------------------------------------ yol çözücü */

winTest('portable kök paketlenmiş çalıştırmada EXE klasörüdür — kullanıcı verisi EXE ile aynı yerde durur', () => {
  const resolved = paths.resolvePortableRoot({
    packaged: true, execPath: 'C:\\BuyerLog\\BuyerLog.exe',
  });
  assert.equal(resolved, path.resolve('C:\\BuyerLog'));
});

winTest('geliştirme çalıştırması depoya data\\ yazmaz — ayrı .desktop-dev kökü kullanır', () => {
  const resolved = paths.resolvePortableRoot({ packaged: false, appPath: 'C:\\repo' });
  assert.equal(resolved, path.resolve('C:\\repo\\.desktop-dev'));
});

test('BUYER_LOG_PORTABLE_ROOT her iki kipi de geçersiz kılar — test ve teşhis bunsuz gerçek veriye dokunurdu', () => {
  const resolved = paths.resolvePortableRoot({
    packaged: true, execPath: 'C:\\BuyerLog\\BuyerLog.exe', override: 'D:\\Deneme',
  });
  assert.equal(resolved, path.resolve('D:\\Deneme'));
});

test('DEĞİŞEBİLİR veri uygulama çekirdeğinin DIŞINDADIR — güncelleme resources\\app\'i değiştirir, data\'yı değil', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  const core = path.resolve('C:\\BuyerLog\\resources\\app').toLowerCase();
  for (const key of ['dataRoot', 'localDbPath', 'configPath', 'serverDataRoot',
    'authDataRoot', 'electronProfileRoot', 'tempRoot', 'logsRoot', 'migrationStatePath']) {
    assert.ok(!layout[key].toLowerCase().startsWith(core),
      key + ' uygulama çekirdeğinin içinde: ' + layout[key]);
  }
});

winTest('yol düzeni START-BUYER-LOG.cmd ile aynı — iki başlatıcı aynı veriyi görmeli, iki ayrı evren üretmemeli', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  assert.equal(layout.serverDataRoot, path.resolve('C:\\BuyerLog\\data\\server'));
  assert.equal(layout.appDataRoot, path.resolve('C:\\BuyerLog\\data\\app'));
  assert.equal(layout.localDataRoot, path.resolve('C:\\BuyerLog\\data\\local'));
  assert.equal(layout.authDataRoot, path.resolve('C:\\BuyerLog\\data\\app\\auth'));
  assert.equal(layout.localDbPath, path.resolve('C:\\BuyerLog\\data\\local\\BuyerLogLocal.db'));
  assert.equal(layout.portableAppData, path.resolve('C:\\BuyerLog\\data\\portable-appdata'));
  assert.equal(layout.portableLocalAppData, path.resolve('C:\\BuyerLog\\data\\portable-localappdata'));
  assert.equal(layout.tempRoot, path.resolve('C:\\BuyerLog\\data\\temp'));
  assert.equal(layout.configPath, path.resolve('C:\\BuyerLog\\config.json'));
});

/*
 * v7.78 REGRESYONU — gerçek kurulumda hiçbir kullanıcı giriş yapamadı.
 *
 * authDataRoot `data/auth` idi, yani dataRoot'un kardeşi. Ama legacy kod yolu
 * AUTH_DATA_ROOT = path.join(APP_DATA_ROOT, 'auth') diyor ve taşıma
 * %APPDATA%\Buyer Log ağacını data/app altına kopyalıyor. Sonuç: uygulama,
 * taşınan canlı deponun yanında duran ESKİ bir kopyayı açtı.
 *
 * Ölçülen fark (gerçek kurulum): açılan depo revision 42, moderatör şifresi
 * YOK, 0 sipariş yetkisi; doğru depo revision 45, şifre VAR, 6248 sipariş
 * yetkisi. Belirti: "Kullanıcı adı veya şifre hatalı."
 *
 * Bu testin önceki hâli YANLIŞ değeri kilitliyordu; iddia gevşetilmedi,
 * düzeltildi. Auth kökü APPDATA ağacının İÇİNDE olmak zorundadır.
 */
test('yetki deposu taşınan APPDATA ağacının İÇİNDE yaşar (v7.78 giriş regresyonu)', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  assert.equal(layout.authDataRoot, path.join(layout.appDataRoot, 'auth'),
    'auth kökü appDataRoot altında değil: ' + layout.authDataRoot);
  assert.ok(layout.authDataRoot.startsWith(layout.appDataRoot + path.sep),
    'auth kökü APPDATA ağacının dışında: ' + layout.authDataRoot);

  // Backend ortamı da aynı kökü görmeli; aksi hâlde sunucu başka depo açar.
  const env = paths.backendEnv(layout, {});
  assert.equal(env.BUYER_LOG_AUTH_DATA_ROOT, layout.authDataRoot);
  assert.equal(env.BUYER_LOG_DATA_ROOT, layout.appDataRoot);
});

/* --------------------------------------------------------- backend ortamı */

test('backend ortamı AppData\'yı pakete yönlendirir ama GERÇEK yolları BL_HOST_* olarak saklar', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  const env = paths.backendEnv(layout, {
    APPDATA: 'C:\\Users\\gercek\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\gercek\\AppData\\Local',
  });
  assert.equal(env.APPDATA, layout.portableAppData);
  assert.equal(env.LOCALAPPDATA, layout.portableLocalAppData);
  // PLM/Remote Debugging kurumsal Edge profilini bu iki değişkenden bulur.
  assert.equal(env.BL_HOST_APPDATA, 'C:\\Users\\gercek\\AppData\\Roaming');
  assert.equal(env.BL_HOST_LOCALAPPDATA, 'C:\\Users\\gercek\\AppData\\Local');
});

test('zaten saklanmış BL_HOST_* değerleri EZİLMEZ — yönlendirilmiş AppData ikinci kez kaydedilirse kurumsal profil kaybolurdu', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  const env = paths.backendEnv(layout, {
    BL_HOST_APPDATA: 'C:\\Users\\gercek\\AppData\\Roaming',
    BL_HOST_LOCALAPPDATA: 'C:\\Users\\gercek\\AppData\\Local',
    APPDATA: 'C:\\BuyerLog\\data\\portable-appdata',
    LOCALAPPDATA: 'C:\\BuyerLog\\data\\portable-localappdata',
  });
  assert.equal(env.BL_HOST_APPDATA, 'C:\\Users\\gercek\\AppData\\Roaming');
  assert.equal(env.BL_HOST_LOCALAPPDATA, 'C:\\Users\\gercek\\AppData\\Local');
});

test('backend çocuğu ELECTRON_RUN_AS_NODE ile çalışır ve tarayıcı sekmesi kapansa bile yaşar', () => {
  const env = paths.backendEnv(paths.desktopPaths('C:\\BuyerLog'), {});
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1'); // BuyerLog.exe saf Node olarak; konsol penceresi açılmaz
  assert.equal(env.BL_KEEP_ALIVE, '1');
  assert.equal(env.BL_AUTOEXIT, '0');
});

test('backend ortamı sunucunun okuduğu TÜM veri kökü değişkenlerini verir', () => {
  const layout = paths.desktopPaths('C:\\BuyerLog');
  const env = paths.backendEnv(layout, {});
  assert.equal(env.BUYER_LOG_SERVER_DATA_ROOT, layout.serverDataRoot);
  assert.equal(env.BUYER_LOG_DATA_ROOT, layout.appDataRoot);
  assert.equal(env.BUYER_LOG_LOCAL_DATA_ROOT, layout.localDataRoot);
  assert.equal(env.BUYER_LOG_LOCAL_DB, layout.localDbPath);
  assert.equal(env.BUYER_LOG_AUTH_DATA_ROOT, layout.authDataRoot);
  assert.equal(env.BUYER_LOG_CONFIG_PATH, layout.configPath);
  assert.equal(env.BUYER_LOG_TEMP_ROOT, layout.tempRoot);
  assert.equal(env.TEMP, layout.tempRoot);
  assert.equal(env.TMP, layout.tempRoot);
  assert.equal(env.BL_DATA_DIR, layout.serverDataRoot);
});

/* -------------------------------------------------------------- adres */

test('0.0.0.0 bir DİNLEME adresidir, ziyaret adresi değildir — pencere 127.0.0.1 yükler', () => {
  assert.equal(paths.resolveAppUrl({ port: 6194, host: '0.0.0.0' }).origin, 'http://127.0.0.1:6194');
  assert.equal(paths.resolveAppUrl({ port: 6194, host: '::' }).origin, 'http://127.0.0.1:6194');
});

test('bozuk port sessizce kabul edilmez, bilinen varsayılana düşer', () => {
  assert.equal(paths.resolveAppUrl({ port: 0 }).port, 6194);
  assert.equal(paths.resolveAppUrl({ port: 99999 }).port, 6194);
  assert.equal(paths.resolveAppUrl({ port: 6197 }).port, 6197);
});

test('BOM\'lu config.json sessizce varsayılana düşmez — kullanıcının değiştirdiği port yok sayılırdı', () => {
  const root = tempRoot('bom');
  const file = path.join(root, 'config.json');
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ port: 6203, host: '127.0.0.1' }), 'utf8');
  const parsed = paths.readJsonFile(file, { port: 6194 });
  assert.equal(parsed.port, 6203);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ------------------------------------------------------- veri ağacı/config */

test('ensureConfig masaüstü kipinde host\'u 127.0.0.1\'e sabitler — yerel sunucu ağa açılmaz', () => {
  const root = tempRoot('config');
  const layout = paths.desktopPaths(root);
  backend.ensureDataTree(layout);
  const config = backend.ensureConfig(layout, APP_ROOT);
  assert.equal(config.host, '127.0.0.1');
  assert.ok(fs.existsSync(layout.configPath));
  fs.rmSync(root, { recursive: true, force: true });
});

test('ensureConfig var olan config.json\'ı EZMEZ — kullanıcının portu her açılışta sıfırlanmamalı', () => {
  const root = tempRoot('config-keep');
  const layout = paths.desktopPaths(root);
  backend.ensureDataTree(layout);
  fs.writeFileSync(layout.configPath, JSON.stringify({ port: 6211, host: '127.0.0.1' }), 'utf8');
  assert.equal(backend.ensureConfig(layout, APP_ROOT).port, 6211);
  fs.rmSync(root, { recursive: true, force: true });
});

test('veri ağacı Electron profilini de içerir — Chromium app.asar/resources içine yazmamalı', () => {
  const root = tempRoot('tree');
  const layout = paths.desktopPaths(root);
  backend.ensureDataTree(layout);
  for (const key of ['serverDataRoot', 'appDataRoot', 'localDataRoot', 'authDataRoot',
    'portableAppData', 'portableLocalAppData', 'electronProfileRoot', 'tempRoot', 'logsRoot']) {
    assert.ok(fs.existsSync(layout[key]), key + ' oluşturulmadı');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/* --------------------------------------------------------------- taşıma */

test('yerel veritabanı DOĞRULANIR: kopyalanmış olması açılabildiği anlamına gelmez', () => {
  const root = tempRoot('verify');
  const good = path.join(root, 'good.db');
  fs.writeFileSync(good, JSON.stringify({ records: { 'store:settings.json': { a: 1 } } }), 'utf8');
  const okResult = migration.verifyLocalDatabase(good);
  assert.equal(okResult.ok, true);
  assert.equal(okResult.storeCount, 1);

  const broken = path.join(root, 'broken.db');
  fs.writeFileSync(broken, '{ bu json degil', 'utf8');
  assert.equal(migration.verifyLocalDatabase(broken).ok, false);

  const empty = path.join(root, 'empty.db');
  fs.writeFileSync(empty, '', 'utf8');
  assert.equal(migration.verifyLocalDatabase(empty).ok, false);

  // Kayıt deposu olmayan geçerli JSON da kullanılamaz veridir.
  const shapeless = path.join(root, 'shapeless.db');
  fs.writeFileSync(shapeless, JSON.stringify({ hello: 'world' }), 'utf8');
  assert.equal(migration.verifyLocalDatabase(shapeless).ok, false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('eski kurulumda veritabanı YOKSA bu bir hata değildir — taşınacak bir şey olmayabilir', () => {
  const result = migration.verifyLocalDatabase(path.join(tempRoot('none'), 'yok.db'));
  assert.equal(result.present, false);
  assert.equal(result.ok, true);
});

/*
 * v10.14 — "dosyalar kopyalandı" ile "veri KULLANILABİLİR" arasındaki fark.
 * Canlıda taşıma başarılı göründü, veritabanı ayrıştırıldı, program açıldı —
 * ama CP ve Siparişler boştu. Sebep, yanına kopyalanmış ve kaynak makinenin
 * mutlak yolunu gösteren kurtarma niyet dosyasıydı; tek bir tanesi tüm yerel
 * veritabanı açılışını düşürüyor.
 */
test('yabancı köke işaret eden kurtarma niyeti yakalanır — veritabanı sağlam olsa bile açılamaz hâle getirir', () => {
  const root = tempRoot('intent');
  const local = path.join(root, 'local', '.buyerlog-db-recovery');
  fs.mkdirSync(local, { recursive: true });

  // Hedefi KENDI kokunun icinde olan niyet: sorun degil.
  fs.writeFileSync(path.join(local, 'ok.intent.json'),
    JSON.stringify({ target: path.join(root, 'local', 'BuyerLogLocal.db') }), 'utf8');
  assert.equal(migration.verifyRecoveryIntents(root).foreign.length, 0);

  // Hedefi ESKI kurulumu gosteren niyet: taşıma buradan geçmemeli.
  fs.writeFileSync(path.join(local, 'kotu.intent.json'),
    JSON.stringify({ target: 'C:\\Users\\baskasi\\AppData\\Local\\BuyerLog\\BuyerLogLocal.db' }), 'utf8');
  const result = migration.verifyRecoveryIntents(root);
  assert.equal(result.foreign.length, 1);
  assert.match(result.foreign[0].file, /kotu\.intent\.json$/);
  assert.equal(result.checked, 2);

  fs.rmSync(root, { recursive: true, force: true });
});

test('bozuk JSON ayar dosyası etkinleştirmeden ÖNCE yakalanır', () => {
  const root = tempRoot('json');
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'settings.json'), '{"ok":true}', 'utf8');
  fs.writeFileSync(path.join(root, 'server', 'kirik.json'), '{kirik', 'utf8');
  const result = migration.verifyJsonTree(root);
  assert.equal(result.broken.length, 1);
  assert.match(result.broken[0].file, /kirik\.json$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('etkinleştirme portable\'ın KENDİ dosyasını ezmez — kullanıcının yeni işi eski kopyayla silinmemeli', () => {
  const root = tempRoot('activate');
  const from = path.join(root, 'staging');
  const to = path.join(root, 'data');
  fs.mkdirSync(path.join(from, 'alt'), { recursive: true });
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(from, 'ayni.json'), 'ESKI', 'utf8');
  fs.writeFileSync(path.join(from, 'alt', 'yeni.json'), 'TASINAN', 'utf8');
  fs.writeFileSync(path.join(to, 'ayni.json'), 'PORTABLE', 'utf8');

  const stats = { activated: 0, kept: 0, failed: [] };
  migration.activateTree(from, to, stats);

  assert.equal(fs.readFileSync(path.join(to, 'ayni.json'), 'utf8'), 'PORTABLE');
  assert.equal(fs.readFileSync(path.join(to, 'alt', 'yeni.json'), 'utf8'), 'TASINAN');
  assert.equal(stats.kept, 1);
  assert.equal(stats.activated, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable kullanılmaya başlandıysa taşıma çalışmaz — ikinci açılış veriyi yeniden içe aktarmamalı', () => {
  const root = tempRoot('inuse');
  const layout = paths.desktopPaths(root);
  backend.ensureDataTree(layout);
  assert.equal(migration.portableAlreadyInUse(layout), false);
  fs.writeFileSync(layout.localDbPath, JSON.stringify({ records: {} }), 'utf8');
  assert.equal(migration.portableAlreadyInUse(layout), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('taşıma durumu sürümlenir — fikirdeşlik dosya varlığına değil şemaya bağlıdır', async () => {
  const root = tempRoot('idempotent');
  const layout = paths.desktopPaths(root);
  backend.ensureDataTree(layout);
  fs.writeFileSync(layout.migrationStatePath, JSON.stringify({
    schemaVersion: migration.MIGRATION_SCHEMA_VERSION, state: 'complete', completedAt: 'dun',
  }), 'utf8');
  const result = await migration.runFirstRunMigration({ paths: layout, appCoreRoot: APP_ROOT });
  assert.equal(result.state, 'skipped');
  assert.equal(result.performed, false);
  fs.rmSync(root, { recursive: true, force: true });
});

/* ------------------------------- portu tutan kopyayı kapatma (hata ekranı) */

const portOwner = require('../electron/port-owner');
const ERROR_PAGE = fs.readFileSync(path.join(APP_ROOT, 'electron', 'startup-error.html'), 'utf8');

/*
 * Bu düğme bir SÜRECİ SONLANDIRIYOR. Kullanıcının açık Excel'ini ya da
 * ilgisiz bir Node sunucusunu kapatmak, "kolaylık" adına yapılabilecek en kötü
 * şeydir. Kapatma iznini veren üç kapı da burada kilitleniyor.
 */
test('yalnız BuyerLog.exe ve node.exe kapatılabilir — başka bir görüntü adına dokunulmaz', () => {
  assert.deepEqual([...portOwner.ALLOWED_IMAGES].sort(), ['buyerlog.exe', 'node.exe']);
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'port-owner.js'), 'utf8');
  // Görüntü adı TEK BAŞINA yetmez; adres de Buyer Log gibi cevap vermeli.
  assert.match(source, /looksLikeBuyerLog/);
  assert.match(source, /ALLOWED_IMAGES\.has\(image\)/);
});

test('kendi sürecimiz hedef olamaz', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'port-owner.js'), 'utf8');
  assert.match(source, /pid === process\.pid \|\| pid === process\.ppid/);
});

test('önce nazik kapatma, zorlama yalnız son çare — veritabanı düzgün kapansın', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'port-owner.js'), 'utf8');
  const gentle = source.indexOf("['/PID', String(owner.pid), '/T']");
  const forced = source.indexOf("['/PID', String(owner.pid), '/T', '/F']");
  assert.ok(gentle > 0 && forced > gentle, 'zorlama nazik denemeden ÖNCE gelmemeli');
});

test('"kapatıldı" demek için port gerçekten serbest kalmalı', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'port-owner.js'), 'utf8');
  assert.match(source, /waitForFree\(origin, GRACEFUL_WAIT_MS\)/);
  assert.match(source, /waitForFree\(origin, FORCE_WAIT_MS\)/);
});

test('kapatma düğmesi yalnız port çakışmasında ve kopya doğrulanabiliyorsa görünür', () => {
  // Düğme varsayılan olarak gizli; hint metni değil, gerçek durum belirliyor.
  assert.match(ERROR_PAGE, /id="closeOther" hidden/);
  assert.match(ERROR_PAGE, /failure\.kind !== 'port-occupied'/);
  assert.match(ERROR_PAGE, /owner && owner\.closable/);
});

test('kopya kapatılınca açılış kendiliğinden denenir — ikinci tıklama beklenmez', () => {
  assert.match(MAIN_SOURCE, /ipcMain\.handle\('buyerlog:close-other'/);
  const handler = MAIN_SOURCE.slice(MAIN_SOURCE.indexOf("ipcMain.handle('buyerlog:close-other'"));
  assert.match(handler.slice(0, 600), /await startBuyerLog\(\)/);
});

/* ------------------------------- kaynak sözleşmesi (ana süreç davranışları) */

const MAIN_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'electron', 'main.js'), 'utf8');
const PRELOAD_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'electron', 'preload.js'), 'utf8');

test('güvenli Electron varsayılanları: renderer\'da Node yok, context izole, sandbox açık', () => {
  assert.match(MAIN_SOURCE, /nodeIntegration:\s*false/);
  assert.match(MAIN_SOURCE, /contextIsolation:\s*true/);
  assert.match(MAIN_SOURCE, /sandbox:\s*true/);
  assert.doesNotMatch(MAIN_SOURCE, /nodeIntegration:\s*true/);
  assert.doesNotMatch(MAIN_SOURCE, /webSecurity:\s*false/);
});

test('preload keyfi IPC çalıştırma yolu AÇMAZ — ipcRenderer doğrudan dışa verilmez', () => {
  assert.doesNotMatch(PRELOAD_SOURCE, /exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
  // Kanal adı çağırandan alınan genel bir invoke sarmalayıcısı da olmamalı.
  assert.doesNotMatch(PRELOAD_SOURCE, /invoke:\s*\(\s*channel/);
  for (const channel of ['buyerlog:diagnostics', 'buyerlog:retry', 'buyerlog:quit']) {
    assert.ok(PRELOAD_SOURCE.includes("'" + channel + "'"), channel + ' kanalı yok');
  }
});

test('menü kurulmaz — Electron varsayılan menüsü Ctrl+Z/Ctrl+Y\'yi Collection\'a ulaşmadan yutardı', () => {
  assert.match(MAIN_SOURCE, /Menu\.setApplicationMenu\(null\)/);
});

test('tek kopya kilidi vardır — iki kopya iki DB yazıcısı ve iki sync motoru demektir', () => {
  assert.match(MAIN_SOURCE, /requestSingleInstanceLock\(\)/);
  assert.match(MAIN_SOURCE, /'second-instance'/);
});

test('port başkasındaysa SESSİZCE ona bağlanılmaz — eski kurulumun verisini göstermek en kötü sessiz arıza', () => {
  assert.match(MAIN_SOURCE, /probeOrigin\(/);
  assert.match(MAIN_SOURCE, /zaten çalışıyor/);
});

test('pencere sunucu hazır olmadan açılmaz — sabit bekleme yerine gerçek yoklama', () => {
  const readyIndex = MAIN_SOURCE.indexOf('waitUntilReady');
  const windowIndex = MAIN_SOURCE.indexOf('createMainWindow(bound.origin)');
  assert.ok(readyIndex > 0 && windowIndex > readyIndex,
    'pencere hazırlık ölçümünden önce açılıyor');
});

test('kapanışta yalnız BİZİM başlattığımız süreç ağacı sonlandırılır — rastgele node/chrome öldürülmez', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'backend.js'), 'utf8');
  assert.match(source, /taskkill\.exe/);
  assert.match(source, /'\/PID', String\(pid\)/);
  assert.doesNotMatch(source, /IMAGENAME/);
  assert.doesNotMatch(source, /\/IM/);
});

/*
 * v10.16 — CANLIDA GÖRÜLEN KİLİTLENME.
 *
 * BuyerLog.exe GUI alt sisteminde derlenmiştir; çift tıklamayla açıldığında
 * bağlı bir konsolu YOKTUR. Böyle bir süreçte process.stdout.write, okuyucusu
 * olmayan bir handle'a yazıp BLOKE OLABİLİR. Bloke olan ana süreç, çalıştırdığı
 * taşıma çocuğunun stdout borusunu da boşaltmayı bırakır; boru dolunca çocuk
 * kopyalamanın ortasında kilitlenir.
 *
 * Ölçülen sonuç: ilk açılış taşıması ~10 MB (bir boru tamponu) kopyalayıp
 * durdu, iki süreç de saatlerce bekledi, ekranda pencere bile açılmadı.
 * Günlükte son satır taşımanın ilk özet satırıydı.
 */
test('v10.16 konsol yokken stdout\'a yazılmaz — yazarsa taşıma çocuğu boruda kilitlenir', () => {
  const writes = [...MAIN_SOURCE.matchAll(/process\.stdout\.write\(/g)];
  assert.ok(writes.length > 0, 'test artık geçerli değil: stdout yazımı kalmamış');
  for (const match of writes) {
    // Her yazımın önünde isTTY kapısı olmalı.
    const before = MAIN_SOURCE.slice(Math.max(0, match.index - 200), match.index);
    assert.match(before, /process\.stdout && process\.stdout\.isTTY/,
      'korumasız process.stdout.write — konsolsuz pakette bloke olur');
  }
});

test('v10.16 çocuğun borusu loglama başarısız olsa bile boşaltılır', () => {
  const source = fs.readFileSync(path.join(APP_ROOT, 'electron', 'first-run-migration.js'), 'utf8');
  const collect = source.slice(source.indexOf('const collect = chunk =>'), source.indexOf('if (child.stdout)'));
  // Veri ÖNCE tüketilir; loglama ayrı ve korumalı.
  assert.ok(collect.indexOf('output += text') < collect.indexOf('log('),
    'veri tüketimi loglamadan sonra yapılıyor — loglama bloke olursa boru dolar');
  assert.match(collect, /catch \(_\) \{ \/\* gunluk yazilamasa bile boru akmali \*\/ \}/);
});

test('teşhis çıktısı sır SIZDIRMAZ', () => {
  const start = MAIN_SOURCE.indexOf('function diagnostics()');
  assert.ok(start > 0);
  /* Yorumlar ayıklanır: "buraya token KOYULMAZ" diyen bir açıklama satırı,
     testi kendi uyarısıyla düşürürdü. Aranan şey KODUN ne döndürdüğü. */
  const body = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf('function registerIpc'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  for (const secret of ['passwordHash', 'sessionSecret', 'authorization', 'token', 'password']) {
    assert.ok(!body.toLowerCase().includes(secret.toLowerCase()), 'teşhis ' + secret + ' içeriyor');
  }
});

test('indirme hedefi AÇIKÇA verilir — yol verilmezse Electron her dışa aktarımda kaydetme penceresi açardı', () => {
  assert.match(MAIN_SOURCE, /item\.setSavePath\(target\)/);
  assert.match(MAIN_SOURCE, /app\.getPath\('downloads'\)/);
  // Çakışan ad üstüne yazmak, önceki dışa aktarımı yok etmektir.
  assert.match(MAIN_SOURCE, /function uniqueDownloadPath/);
});

test('harici bağlantı sistem tarayıcısına gider — PLM/M365 kurumsal profile bağlı', () => {
  assert.match(MAIN_SOURCE, /setWindowOpenHandler/);
  assert.match(MAIN_SOURCE, /action:\s*'deny'/);
  assert.match(MAIN_SOURCE, /shell\.openExternal/);
  assert.match(MAIN_SOURCE, /'will-navigate'/);
});

test('Electron profili veri kökünde tutulur ve kurumsal tarayıcı profiliyle karışmaz', () => {
  assert.match(MAIN_SOURCE, /setPath\('userData', paths\.electronProfileRoot\)/);
  assert.match(MAIN_SOURCE, /setPath\('sessionData', paths\.electronProfileRoot\)/);
});
