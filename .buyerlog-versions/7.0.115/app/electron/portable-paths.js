'use strict';

/*
 * Buyer Log — MASAÜSTÜ YOL ÇÖZÜCÜ (portable Electron barındırıcısı)
 *
 * Bu modül, masaüstü sürümünün TEK yol kaynağıdır. Amaç, "uygulama çekirdeği"
 * ile "kullanıcı verisi"ni fiziksel olarak ayırmak:
 *
 *   BuyerLog.exe + resources\app\  → DEĞİŞMEZ uygulama çekirdeği
 *   data\                          → DEĞİŞEBİLİR iş/kullanıcı verisi
 *
 * Uygulama güncellemesi çekirdeği değiştirir, data\ klasörüne dokunmaz.
 *
 * TASARIM KARARLARI:
 *
 * 1) YOL DÜZENİ START-BUYER-LOG.cmd İLE BİREBİR AYNI. Portable batch
 *    başlatıcısı (scripts/create-portable-package.js → launcherLines) yıllardır
 *    data\server, data\app, data\local, data\auth, data\portable-appdata,
 *    data\portable-localappdata düzenini kullanıyor ve scripts/import-legacy-data.js
 *    bu düzene göre veri taşıyor. Electron farklı bir düzen uydurursa aynı
 *    paket iki ayrı veri evreni üretir. Bu yüzden düzen kopyalanmadı, TEK
 *    tanım hâline getirildi.
 *
 * 2) APPDATA/LOCALAPPDATA/TEMP YALNIZ ÇOCUK SÜRECE YÖNLENDİRİLİR. Electron ana
 *    süreci bu değişkenleri GERÇEK Windows değerleriyle görmeye devam eder.
 *    Sebep: Chromium kendi profil/cache yollarını süreç başlangıcında bu
 *    değişkenlerden türetir; ana süreçte değiştirmek Chromium'un yarı
 *    başlatılmış yol servisiyle yarışa girer. Electron'un kendi profili
 *    app.setPath('userData', ...) ile AÇIKÇA data\electron-profile'a alınır.
 *    Kullanıcı çıktıları için Downloads yolu ayrıca Electron'un gerçek
 *    app.getPath('downloads') değeri olarak korunur.
 *
 * 3) BL_HOST_* KORUNUR. Troy/PLM entegrasyonu ve "Allow Remote Debugging"
 *    kullanıcının GERÇEK Edge/Chrome profilini kullanmak zorunda
 *    (server/lib/agent-browser-connector.js, server/lib/browser-debug-service.js
 *    bu değişkenleri okuyor). Yönlendirilmiş LOCALAPPDATA'yı miras alan bir
 *    tarayıcı, paketin içinde BOŞ bir profil açar ve kurumsal SSO oturumu
 *    sessizce kaybolur — canlıda bir kez yaşandı, bkz. scripts/open-app-window.js.
 */

const fs = require('fs');
const path = require('path');

function clean(value) {
  const text = String(value == null ? '' : value).trim();
  return text || '';
}

/*
 * JSON okuma — BOM'a DAYANIKLI.
 *
 * Windows araçları (Not Defteri, PowerShell'in Set-Content -Encoding utf8,
 * bazı düzenleyiciler) UTF-8 dosyalarının başına BOM koyar. JSON.parse bunu
 * ayrıştıramaz ve hata fırlatır; hatayı yutan bir okuyucu da sessizce
 * VARSAYILANA döner. Canlıda bunun anlamı şudur: kullanıcı config.json'daki
 * portu değiştirir, dosya BOM'lu kaydedilir, uygulama hiçbir şey söylemeden
 * eski varsayılan porttan açılır. Bu yüzden BOM okuma anında kırpılır.
 */
function readJsonFile(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch (_) { return fallback; }
}

/*
 * Portable kök: BuyerLog.exe'nin bulunduğu klasör.
 *
 * Paketlenmiş çalıştırmada process.execPath = <kök>\BuyerLog.exe olduğu için
 * kök tek adımda bulunur. Geliştirme çalıştırmasında (electron .) çekirdek
 * deponun kendisidir; oraya data\ yazmak depoyu kirletir, bu yüzden ayrı bir
 * .desktop-dev klasörü kullanılır. BUYER_LOG_PORTABLE_ROOT her iki durumu da
 * elle geçersiz kılabilir (test ve teşhis için).
 */
function resolvePortableRoot(options = {}) {
  const override = clean(options.override || process.env.BUYER_LOG_PORTABLE_ROOT);
  if (override) return path.resolve(override);
  if (options.packaged) return path.resolve(path.dirname(options.execPath || process.execPath));
  return path.resolve(path.join(options.appPath || process.cwd(), '.desktop-dev'));
}

/*
 * Tek yol kaydı. İsimler DATA_ARCHITECTURE.md ve data-roots.js ile uyumlu
 * tutuldu; yeni bir terminoloji üretilmedi.
 */
function desktopPaths(portableRoot) {
  const root = path.resolve(portableRoot);
  const dataRoot = path.join(root, 'data');
  const localDataRoot = path.join(dataRoot, 'local');
  return Object.freeze({
    portableRoot: root,
    appCoreRoot: root,
    dataRoot,
    configPath: path.join(root, 'config.json'),
    serverDataRoot: path.join(dataRoot, 'server'),
    appDataRoot: path.join(dataRoot, 'app'),
    localDataRoot,
    localDbPath: path.join(localDataRoot, 'BuyerLogLocal.db'),
    /*
     * Yetki deposu APPDATA agacinin ICINDE yasar.
     *
     * Legacy kod yolu (server/lib/user-access.js):
     *     AUTH_DATA_ROOT = path.join(APP_DATA_ROOT, 'auth')
     * yani %APPDATA%\Buyer Log\auth. Tasima bu agaci data/app altina
     * kopyaladigi icin portable karsiligi data/app/auth olmak ZORUNDA.
     *
     * v7.78 - burasi data/auth idi (dataRoot'un kardesi). Sonuc: uygulama
     * tasinan canli deponun yaninda duran ESKI bir kopyayi aciyordu.
     * Canli olcum (gercek kurulum): aktif depo 132 KB / revision 42 /
     * moderator sifresi YOK / 0 siparis yetkisi; dogru depo 1112 KB /
     * revision 45 / sifre VAR / 6248 siparis yetkisi. Belirti: hicbir
     * kullanici giris yapamiyor.
     */
    authDataRoot: path.join(dataRoot, 'app', 'auth'),
    // Yönlendirilmiş Windows AppData kökleri (yalnız backend çocuk süreci için).
    portableAppData: path.join(dataRoot, 'portable-appdata'),
    portableLocalAppData: path.join(dataRoot, 'portable-localappdata'),
    // Electron'un KENDİ Chromium profili. Kurumsal Edge/Chrome profiliyle
    // hiçbir ilgisi yoktur ve app.asar/resources içine ASLA yazılmaz.
    electronProfileRoot: path.join(dataRoot, 'electron-profile'),
    // Backend'in uygulama tarafından üretilen kısa ömürlü çalışma alanı.
    // Masaüstü child süreci TEMP/TMP'yi buraya yönlendirir; kullanıcı çıktıları
    // (Downloads) bundan etkilenmez.
    tempRoot: path.join(dataRoot, 'temp'),
    // Masaüstü barındırıcısının logları. Backend'in kendi logları
    // portable-localappdata\BuyerLog\logs altında kalmaya devam eder.
    logsRoot: path.join(dataRoot, 'logs'),
    desktopLogPath: path.join(dataRoot, 'logs', 'desktop.log'),
    windowStatePath: path.join(localDataRoot, 'desktop-window-state.json'),
    migrationStatePath: path.join(dataRoot, 'desktop-migration.json'),
  });
}

/*
 * Backend çocuk sürecinin ortamı. START-BUYER-LOG.cmd'nin yaptığı
 * yönlendirmenin birebir aynısı; tek fark ELECTRON_RUN_AS_NODE bayrağıdır:
 * BuyerLog.exe bu bayrakla saf bir Node çalıştırıcısı gibi davranır, pencere
 * veya konsol açmaz.
 */
function backendEnv(paths, hostEnv = process.env, extra = {}) {
  const hostAppData = clean(hostEnv.BL_HOST_APPDATA) || clean(hostEnv.APPDATA);
  const hostLocalAppData = clean(hostEnv.BL_HOST_LOCALAPPDATA) || clean(hostEnv.LOCALAPPDATA);
  const env = { ...hostEnv };

  // GERÇEK yollar önce saklanır (§3). Yönlendirmeden sonra okunamazlar.
  if (hostAppData) env.BL_HOST_APPDATA = hostAppData;
  if (hostLocalAppData) env.BL_HOST_LOCALAPPDATA = hostLocalAppData;

  env.APPDATA = paths.portableAppData;
  env.LOCALAPPDATA = paths.portableLocalAppData;
  // Backend'in tüm uygulama kontrollü geçici dosyaları da portable klasörde
  // kalsın. Electron ana sürecinin Windows TEMP'i değiştirilmez; yalnızca
  // BuyerLog'un yönettiği child/server süreci etkilenir.
  env.TEMP = paths.tempRoot;
  env.TMP = paths.tempRoot;
  env.TMPDIR = paths.tempRoot;
  env.BUYER_LOG_SERVER_DATA_ROOT = paths.serverDataRoot;
  env.BUYER_LOG_DATA_ROOT = paths.appDataRoot;
  env.BUYER_LOG_LOCAL_DATA_ROOT = paths.localDataRoot;
  env.BUYER_LOG_LOCAL_DB = paths.localDbPath;
  env.BUYER_LOG_AUTH_DATA_ROOT = paths.authDataRoot;
  env.BUYER_LOG_CONFIG_PATH = paths.configPath;
  env.BUYER_LOG_PORTABLE_DATA_ROOT = paths.dataRoot;
  env.BUYER_LOG_TEMP_ROOT = paths.tempRoot;
  env.BUYER_LOG_EXCEL_PID_FILE = path.join(paths.localDataRoot, 'runtime', 'excel.pid');
  env.BUYER_LOG_EXCEL_PIVOT_PID_FILE = path.join(paths.localDataRoot, 'runtime', 'excel-pivot.pid');
  // Eski web-script-store fallback'inin resources/app/server/data'ya yazmasını
  // önle; packaged backend'in tek server veri kökü olsun.
  env.BL_DATA_DIR = paths.serverDataRoot;

  // Sunucu, tarayıcı sekmesi kapanınca kapanmaz; masaüstü penceresinin
  // yaşam döngüsünü Electron yönetir.
  env.BL_AUTOEXIT = '0';
  env.BL_KEEP_ALIVE = '1';

  // BuyerLog.exe'yi saf Node olarak çalıştır. Electron GUI alt sisteminde
  // derlendiği için bu süreç HİÇBİR konsol penceresi açmaz.
  env.ELECTRON_RUN_AS_NODE = '1';

  return Object.assign(env, extra);
}

/* config.json'dan adres. Sunucu aynı dosyayı okuduğu için tek kaynak budur. */
function resolveAppUrl(config) {
  const source = config && typeof config === 'object' ? config : {};
  const port = Number(source.port);
  const safePort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 6194;
  const host = clean(source.host) || '127.0.0.1';
  // 0.0.0.0/:: dinleme adresidir, ziyaret adresi değildir.
  const display = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return { port: safePort, host: display, origin: 'http://' + display + ':' + safePort };
}

module.exports = { resolvePortableRoot, desktopPaths, backendEnv, resolveAppUrl, readJsonFile };
