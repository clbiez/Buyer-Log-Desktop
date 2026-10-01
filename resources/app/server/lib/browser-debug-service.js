'use strict';

/*
 * Central browser/CDP lifecycle for Buyer Log.
 *
 * This service deliberately knows only browser metadata and the local CDP
 * endpoint. It never opens credential stores and it never copies a browser
 * profile. Chrome always gets a Buyer Log-owned persistent profile; Edge may
 * use a discovered existing profile and falls back to the same safe model.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { LOCAL_DATA_ROOT, atomicWriteJson } = require('../user-data');

const BROWSERS = Object.freeze(['edge', 'chrome']);
const POLICY_STATUS = Object.freeze(['ALLOWED', 'NOT_CONFIGURED', 'BLOCKED_BY_ORGANIZATION', 'UNKNOWN']);
/* BAĞLANTI DURUMU TEK BİR SÖZLÜKTEN OKUNUR.

   Eskiden durum serbest metindi ("Port conflict", "Connection failed") ve
   arayüz bunları birebir gösteriyordu; "Connected" yazması yalnız portun
   cevap verdiği anlamına geliyordu. Durum artık kanonik: READY yalnız
   tarayıcı + profil + uç nokta SAHİPLİĞİ doğrulandığında verilir. */
const CONNECTION_STATES = Object.freeze([
  'DISABLED', 'DISCOVERING', 'PROFILE_REQUIRED', 'PROFILE_NOT_FOUND', 'REMOTE_DEBUG_DISABLED',
  'PORT_CONFLICT', 'ENDPOINT_UNVERIFIED', 'CONTEXT_MISMATCH', 'READY', 'ERROR',
]);
const CONFIG_FILE_NAME = 'browser-debug-settings.json';
const DEFAULT_PORTS = Object.freeze({ edge: 9222, chrome: 9223 });
const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  preferredBrowser: 'system',
  selectedEdgeProfileDirectory: '',
  preferredPort: null,
  enabled: false,
  deviceId: '',
});

/* ======================================================================
   CİHAZA BAĞLI AYAR — PAKETLE SEYAHAT ETMEZ

   Bu ayar dosyası portable kurulumda paketin İÇİNDE durur
   (<paket>\data\local\settings\browser-debug-settings.json — v7.83'te
   bilerek oraya taşındı, bkz. configFile yanındaki not). Klasörün tamamı
   başka bir bilgisayara kopyalandığında dosya da gidiyor ve şu üç değer
   KAYNAK bilgisayarı tarif ediyor:

     selectedEdgeProfileDirectory  -> kaynak PC'deki Edge profil klasörü
     preferredPort                 -> kaynak PC'de açılmış CDP portu
     enabled                       -> kaynak PC'de kurulmuş bağlantı

   Hedef bilgisayarda "Profile 3" ya HİÇ YOKTUR (sessizce profiles[0]'a
   düşülür) ya da BAŞKA BİRİNE aittir — ikinci durumda Buyer Log yanlış
   kişinin oturumuna bağlanır. Bu yüzden ayar cihazla mühürlenir: mühür
   tutmuyorsa cihaza bağlı alanlar okunmaz, keşif hedef makinede sıfırdan
   yapılır. Mühür SIR DEĞİLDİR ve sır içermez; yalnız makine+kullanıcı
   kimliğinin geri döndürülemez bir özetidir.
   ====================================================================== */
function deviceFingerprint(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const parts = [
    clean(source.COMPUTERNAME) || clean(source.HOSTNAME),
    clean(source.USERNAME) || clean(source.USER),
    // Yönlendirilmiş LOCALAPPDATA paketin içini gösterir ve HER makinede
    // aynıdır; mühür bu yüzden GERÇEK host yolunu tercih eder.
    clean(source.BL_HOST_LOCALAPPDATA) || clean(source.LOCALAPPDATA),
  ];
  return crypto.createHash('sha256').update(parts.join('\u0000').toLowerCase()).digest('hex').slice(0, 32);
}

// Cihaza bağlı alanlar. preferredBrowser bir KULLANICI tercihidir ve makineye
// bağlı değildir; taşınmasında sakınca yoktur ve her açılışta yeniden çözülür.
const DEVICE_BOUND_FIELDS = Object.freeze(['selectedEdgeProfileDirectory', 'preferredPort', 'enabled']);

function rebindConfiguration(configuration, deviceId) {
  const current = normalizeConfiguration(configuration);
  const id = clean(deviceId);
  if (!id || current.deviceId === id) return { configuration: { ...current, deviceId: id || current.deviceId }, rebound: false, dropped: [] };
  const dropped = DEVICE_BOUND_FIELDS.filter(field => {
    const value = current[field];
    return value !== '' && value !== null && value !== false;
  });
  return {
    configuration: { ...current, selectedEdgeProfileDirectory: '', preferredPort: null, enabled: false, deviceId: id },
    // Mührü hiç olmayan (eski sürümden kalma) dosya da yeniden bağlanır, ama
    // hedefte silinecek bir şey yoksa bunu "değişiklik" diye bildirmeyiz.
    rebound: dropped.length > 0,
    dropped,
  };
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizePreferredBrowser(value) { return BROWSERS.includes(clean(value).toLowerCase()) ? clean(value).toLowerCase() : 'system'; }
function normalizePort(value, { allowNull = true } = {}) {
  if (value == null || value === '') return allowNull ? null : DEFAULT_PORTS.edge;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Remote debugging port must be between 1024 and 65535.');
  return port;
}
function normalizeProfileDirectory(value, { allowEmpty = true } = {}) {
  const id = clean(value);
  if (!id && allowEmpty) return '';
  if (!id || id === '.' || id === '..' || id.includes('\\') || id.includes('/') || id.includes('\0') || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(id)) {
    throw new Error('Invalid browser profile identifier.');
  }
  return id;
}
function normalizeConfiguration(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 1,
    preferredBrowser: normalizePreferredBrowser(input.preferredBrowser),
    selectedEdgeProfileDirectory: normalizeProfileDirectory(input.selectedEdgeProfileDirectory),
    preferredPort: normalizePort(input.preferredPort),
    enabled: Boolean(input.enabled),
    deviceId: normalizeDeviceId(input.deviceId),
  };
}
// Mühür yalnız onaltılık bir özettir; başka bir şey yazılmışsa yok sayılır.
function normalizeDeviceId(value) {
  const id = clean(value).toLowerCase();
  return /^[0-9a-f]{8,64}$/.test(id) ? id : '';
}

/* ======================================================================
   UÇ NOKTA SAHİPLİĞİ — "PORT CEVAP VERİYOR" BİR KANIT DEĞİLDİR

   Bir CDP uç noktası doğrulanmış sayılmak için Chromium konuşmak zorunda
   ama bu YETMEZ: aynı makinede başka bir Edge/Chrome süreci (başka bir
   kullanıcı veri klasörüyle, yani BAŞKA BİRİNİN oturumuyla) de 9222'yi
   tutuyor olabilir. Eski kod yalnız /json/version'daki "Browser" dizesine
   bakıyor, oradan gelen her Edge'i devralıyordu.

   Tarayıcı, remote debugging açıkken kendi kullanıcı veri klasörüne
   DevToolsActivePort dosyasını yazar:
       satır 1: port
       satır 2: /devtools/browser/<GUID>
   GUID, o tarayıcı SÜRECİNE aittir ve /json/version'ın
   webSocketDebuggerUrl'inde birebir aynısı döner. Yani seçili profilin
   klasöründeki dosya ile uç noktanın GUID'i eşleşiyorsa uç nokta O
   SÜRECİNDİR — başka bir yorumu yoktur.
   ====================================================================== */
function browserGuidFromWs(value) {
  const match = /\/devtools\/browser\/([A-Za-z0-9._-]{4,})$/.exec(clean(value));
  return match ? match[1] : '';
}
/* Profil parmak izi SIR DEĞİLDİR: yalnız kök + klasör + cihaz mührünün geri
   döndürülemez özeti. Tanı ekranında gösterilebilir, log'a yazılabilir. */
function profileFingerprint(userDataRoot, profileDirectory, deviceId = '') {
  const root = clean(userDataRoot).toLowerCase(), profile = clean(profileDirectory);
  if (!root || !profile) return '';
  return crypto.createHash('sha256').update([root, profile, clean(deviceId)].join('|')).digest('hex').slice(0, 24);
}

function browserFromProgId(value) {
  const id = clean(value).toLowerCase();
  if (!id) return 'unknown';
  if (id.includes('msedge') || id.includes('edge')) return 'edge';
  if (id.includes('chrome') || id.includes('googlechrome')) return 'chrome';
  if (/firefox|brave|opera|vivaldi|iexplore|safari/.test(id)) return 'unsupported';
  return 'unknown';
}
function registryText(value) {
  if (value && typeof value === 'object') return clean(value.value ?? value.stdout ?? value.data);
  return clean(value);
}
function parseRegistryValue(output, valueName = '') {
  const name = clean(valueName);
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b\\s+REG_[^\\s]+\\s+(.*)$`, 'i'));
    if (match) return clean(match[1]);
  }
  return '';
}
function readRegistryValue(key, valueName) {
  if (process.platform !== 'win32') return '';
  try {
    const result = spawnSync('reg.exe', ['query', key, '/v', valueName], { encoding: 'utf8', windowsHide: true, timeout: 2500, shell: false });
    return parseRegistryValue(result.stdout, valueName);
  } catch (_) { return ''; }
}
function resolveSystemDefault({ readRegistry = readRegistryValue } = {}) {
  const locations = [
    ['https', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice'],
    ['http', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice'],
  ];
  for (const [protocol, key] of locations) {
    let progId = '';
    try { progId = registryText(readRegistry(key, 'ProgId')); } catch (_) { progId = ''; }
    const browser = browserFromProgId(progId);
    if (browser !== 'unknown') return { browser, detectedProgId: progId || undefined, source: `windows-userchoice-${protocol}` };
  }
  return { browser: 'unknown', source: 'windows-userchoice' };
}

function normalizePolicyValue(value) {
  if (value == null || value === '') return 'NOT_CONFIGURED';
  if (value === true || value === 1 || clean(value) === '1') return 'ALLOWED';
  if (value === false || value === 0 || clean(value) === '0') return 'BLOCKED_BY_ORGANIZATION';
  return 'UNKNOWN';
}
function combinePolicyValues(values) {
  const normalized = (values || []).map(normalizePolicyValue);
  if (normalized.includes('BLOCKED_BY_ORGANIZATION')) return 'BLOCKED_BY_ORGANIZATION';
  if (normalized.includes('ALLOWED')) return 'ALLOWED';
  if (normalized.includes('UNKNOWN')) return 'UNKNOWN';
  return 'NOT_CONFIGURED';
}

/* ======================================================================
   PROFİL SIRASI — "İLK PROFİL" TAHMİN DEĞİL, ÖLÇÜM

   Liste eskiden alfabetik/sayısal sıralanıyordu, yani profiles[0] HER ZAMAN
   "Default" oluyordu. Tek profilli bir makinede (geliştirme bilgisayarı) bu
   fark etmez. Kurumsal bir makinede kullanıcının SSO oturumu çoğu kez
   "Profile 1"dedir ve "Default" bomboştur: Buyer Log CoreNectum'u boş profilde
   açıyor, siteye ULAŞIYOR ama ne oturumu ne de kullanıcının Style List
   seçimini görüyordu. Belirti tam olarak buydu.

   Edge hangi profili kullandığını kendi Local State dosyasında söylüyor;
   sıralama artık oradan gelir:
     profile.last_active_profiles  — şu an açık olan profiller, açılış sırasıyla
     profile.last_used             — en son kullanılan profil
     profile.profiles_order        — kullanıcının profil çubuğundaki sırası
   Hiçbiri yoksa eski sayısal sıraya düşülür (davranış değişmez).
   ====================================================================== */
function edgeProfileUsageOrder(parsed) {
  const profile = parsed && parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {};
  const listOf = value => (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
  const order = [...listOf(profile.last_active_profiles), clean(profile.last_used), ...listOf(profile.profiles_order)];
  const seen = new Set();
  return order.filter(id => id && !seen.has(id) && seen.add(id));
}
function parseEdgeProfiles(localStateText, directories = []) {
  let parsed = {};
  try { parsed = JSON.parse(String(localStateText || '{}')); } catch (_) { parsed = {}; }
  const info = parsed && parsed.info_cache && typeof parsed.info_cache === 'object' ? parsed.info_cache : {};
  const usage = edgeProfileUsageOrder(parsed);
  const rank = id => { const index = usage.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const ids = [...new Set((directories || []).map(clean).filter(id => /^Default$|^Profile [0-9]+$/i.test(id)))]
    .sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b, undefined, { numeric: true }));
  return ids.map(id => {
    const metadata = info[id] && typeof info[id] === 'object' ? info[id] : {};
    const result = { id, name: clean(metadata.name) || id };
    const userName = clean(metadata.user_name || metadata.userName);
    if (userName) result.userName = userName;
    return result;
  });
}

function validatePort(port) { return Number.isInteger(Number(port)) && Number(port) >= 1024 && Number(port) <= 65535; }
function buildLaunchArgs({ browser, profileMode, userDataDir = '', profileDirectory = 'Default', port }) {
  const engine = clean(browser).toLowerCase();
  if (!BROWSERS.includes(engine)) throw new Error('Unsupported browser.');
  if (!validatePort(port)) throw new Error('Invalid remote debugging port.');
  const profile = normalizeProfileDirectory(profileDirectory, { allowEmpty: false });
  const args = [];
  if (profileMode !== 'buyer-log-persistent' && profileMode !== 'existing') throw new Error('Invalid browser profile mode.');
  /* Mevcut profil modunda da --user-data-dir ZORUNLU.
     Eskiden yalnız --profile-directory veriliyordu. Chromium o durumda
     varsayılan kullanıcı veri klasörünü açar; o klasörü tutan bir süreç
     (açık pencere ya da Edge'in "startup boost" arka plan süreci) varsa yeni
     süreç işi singleton'a devredip HEMEN kapanır ve remote debugging hiç
     açılmaz. Kullanıcının gördüğü "aç-kapan-aç-kapan" döngüsünün kaynağı
     buydu: süreç kapanıyor, CDP gelmiyor, kurulum yeniden deniyordu. */
  const root = path.resolve(clean(userDataDir));
  if (!clean(userDataDir) || root === path.parse(root).root) {
    throw new Error(profileMode === 'existing' ? 'Invalid existing browser profile path.' : 'Invalid persistent browser profile path.');
  }
  args.push(`--user-data-dir=${root}`);
  // A dedicated automation profile should open cleanly without Edge's welcome /
  // default-browser pages; those extra pages were indistinguishable from the
  // user's reported "blank Edge windows" during repeated setup attempts.
  args.push(`--profile-directory=${profile}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${Number(port)}`);
  return args;
}

/* ======================================================================
   "Edg/" — GERÇEK EDGE KENDİNİ BÖYLE TANITIR

   ÖLÇÜLDÜ (bu makine, Edge 153): /json/version yanıtı
       "Browser": "Edg/153.0.4234.32"
   Sondaki "e" YOKTUR. Eski desen /edge/i olduğu için GERÇEK Edge uç noktası
   hiçbir zaman eşleşmiyor, sağlıklı bir bağlantı "Port conflict ·
   foreign-server" diye reddediliyordu. Sınamalarda uydurma bir
   "Microsoft Edge/140" dizesi kullanıldığı için hata yıllarca görünmedi.

   Chrome ise "Chrome/<sürüm>" der. Edge'in KULLANICI AJANI içinde de
   "Chrome/..." geçer, ama burada yalnız Browser alanı okunur; karışmaz.
   ====================================================================== */
const EDGE_BROWSER_LABEL = /(?:^|[^a-z])edge?[\/ ]/i;
const CHROMIUM_BROWSER_LABEL = /(?:chrome|chromium|edge?[\/ ]|electron)/i;
function validateCdpVersion(payload, port) {
  const browser = clean(payload && payload.Browser);
  const ws = clean(payload && payload.webSocketDebuggerUrl);
  const expected = Number(port);
  const wsUrl = (() => { try { return new URL(ws); } catch (_) { return null; } })();
  const isChromium = CHROMIUM_BROWSER_LABEL.test(browser);
  const isLoopback = wsUrl && ['127.0.0.1', 'localhost', '::1'].includes(wsUrl.hostname) && Number(wsUrl.port) === expected;
  return {
    ok: Boolean(browser && isChromium && ws && wsUrl && wsUrl.protocol === 'ws:' && isLoopback),
    browser,
    webSocketDebuggerUrl: ws || undefined,
  };
}

/* netstat çıktısından, verilen loopback portunu DİNLEYEN sürecin kimliği.
   Yalnız 127.0.0.1/localhost satırları sayılır: dışarıya açık bir dinleyici
   Buyer Log'un uç noktası olamaz. */
function parseListeningPid(output, port) {
  const target = Number(port);
  for (const line of String(output || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/^TCP$/i.test(parts[0])) continue;
    if (!/^LISTENING$/i.test(parts[3])) continue;
    const local = parts[1] || '';
    const index = local.lastIndexOf(':');
    if (index < 0 || Number(local.slice(index + 1)) !== target) continue;
    const host = local.slice(0, index).replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) continue;
    const pid = Number(parts[4]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return 0;
}
/* Chromium komut satırından --user-data-dir değeri. Tırnaklı ve tırnaksız
   biçimlerin ikisi de gerçek hayatta görülür. */
function parseUserDataDirArgument(commandLine) {
  const text = String(commandLine || '');
  /* Windows/CreateProcess may quote Chromium arguments in two different ways
     when the path contains spaces:
       --user-data-dir="C:\\Path With Spaces\\Profile"
       "--user-data-dir=C:\\Path With Spaces\\Profile"
     The previous parser only understood the first form. In the second form it
     fell through to the bare regex and truncated the path at the first space.
     That made Buyer Log think its own Edge profile was not running and launch
     msedge.exe again on the next PLM preflight. */
  const patterns = [
    /--user-data-dir\s*=\s*"([^"]+)"/i,
    /"--user-data-dir=([^"]+)"/i,
    /--user-data-dir\s*=\s*'([^']+)'/i,
    /'--user-data-dir=([^']+)'/i,
    /--user-data-dir\s*=\s*([^\s"']+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && clean(match[1])) return clean(match[1]);
  }
  return '';
}
function samePath(left, right) {
  const a = clean(left), b = clean(right);
  if (!a || !b) return false;
  return path.resolve(a).replace(/[\\/]+$/, '').toLowerCase() === path.resolve(b).replace(/[\\/]+$/, '').toLowerCase();
}
function loopbackPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    const done = value => { try { server.close(); } catch (_) {} resolve(value); };
    server.once('error', () => done(false));
    server.listen(Number(port), '127.0.0.1', () => done(true));
  });
}
function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

/* CHROMIUM 136+ : GERÇEK PROFİLDE REMOTE DEBUGGING YASAK.
 *
 * Chromium 136 ile birlikte `--remote-debugging-port`, VARSAYILAN kullanıcı
 * veri klasörüyle çalıştırıldığında devre dışı bırakılır — kötü niyetli bir
 * sürecin kullanıcının canlı oturumlarını ele geçirmesini önleyen güvenlik
 * önlemidir. Bu makinede ÖLÇÜLEN davranış (Edge 153): port dinlemeye açılır,
 * DevToolsActivePort dosyası yazılır, ama /json/version dahil bütün HTTP
 * uçları 404 döner ve tarayıcı WebSocket'i el sıkışmayı tamamlamaz.
 * AYRI bir --user-data-dir ile aynı sürüm sorunsuz çalışır (/json/version 200).
 *
 * Sonuç: bu sürümlerde "kullanıcının mevcut Edge profiline bağlan" stratejisi
 * ÇALIŞAMAZ. Profil eşleştirme mantığı ne kadar doğru olursa olsun bağlantı
 * hiç kurulmadığı için PLM Sync sessizce ölür. Buyer Log bu sürümlerde KENDİ
 * kalıcı profilini kullanır: kullanıcı o pencerede bir kez giriş yapar,
 * oturum o profilde kalıcıdır. */
const DEFAULT_PROFILE_DEBUG_BLOCKED_MAJOR = 136;

function createBrowserDebugService(options = {}) {
  const fsImpl = options.fs || fs;
  const spawnImpl = options.spawn || spawn;
  const spawnSyncImpl = options.spawnSync || spawnSync;
  const fetchImpl = options.fetch || globalThis.fetch;
  const canBindPort = options.canBindPort || loopbackPort;
  const env = options.env || process.env;
  // Portable launchers may redirect Buyer Log's application data into the
  // package directory. Browser auth/session state must stay device-local, so
  // prefer the host LOCALAPPDATA hand-off when it is available.
  const hostLocalAppData = clean(env.BL_HOST_LOCALAPPDATA);
  const localDataRoot = path.resolve(options.localDataRoot || (hostLocalAppData ? path.join(hostLocalAppData, 'BuyerLog') : LOCAL_DATA_ROOT));
  /* v7.83 — Ayar dosyası KANONİK yazılabilir kökte durur.
     localDataRoot bilerek cihaz-yerel Edge/Chrome profiline bakar; portable'da
     bu, BL_HOST_LOCALAPPDATA üzerinden paket dışına çıkar. Ayar dosyası da
     oraya yazılınca user-data.js'in kalıcı yazma politikası hedefi izinli
     köklerin dışında görüp "Kalıcı yazma hedefi izin verilen veri alanlarının
     dışında: ...\BuyerLog\browser-debug-settings.json" hatası veriyordu.
     Profil klasörü cihaz-yerel kalır; ayar dosyası kanonik köke taşındı. */
  const canonicalDataRoot = path.resolve(options.canonicalDataRoot || LOCAL_DATA_ROOT);
  const configFile = options.configFile || path.join(canonicalDataRoot, 'settings', CONFIG_FILE_NAME);
  const legacyConfigFiles = [path.join(localDataRoot, CONFIG_FILE_NAME), path.join(canonicalDataRoot, CONFIG_FILE_NAME)]
    .filter(item => path.resolve(item) !== path.resolve(configFile));
  const writeJson = options.writeJson || atomicWriteJson;
  const readRegistry = options.readRegistry || ((key, name) => {
    if (process.platform !== 'win32') return '';
    try {
      const result = spawnSyncImpl('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 2500, shell: false });
      return parseRegistryValue(result.stdout, name);
    } catch (_) { return ''; }
  });
  /* ownedPort/ownedStrategyKey: bu çalıştırmada Buyer Log'un KENDİ başlattığı
     port ve o başlatmanın profili. Tarayıcı DevToolsActivePort'u henüz
     yazmamış olsa bile başlatmanın kendisi bir sahiplik kanıtıdır. */
  const runtime = { status: 'Ready', state: 'IDLE', endpoint: null, resolved: null, error: null, ownedPid: null, ownedPort: null, ownedStrategyKey: '', lastLaunchAt: 0, binding: null, boundContext: null, portConflict: null };

  function readConfigurationFile(file) {
    try {
      if (!fsImpl.existsSync(file)) return null;
      return normalizeConfiguration(JSON.parse(fsImpl.readFileSync(file, 'utf8')));
    } catch (_) { return null; }
  }
  // Eski konumdaki ayar bir kez kanonik köke taşınır. Yazma işini loadConfiguration
  // yapar: taşıma ile cihaz mührü TEK yazmada birleşsin, dosya her okumada
  // yeniden yazılmasın (bkz. browser-debug-service-v1 migration regression'ı).
  let legacyMigrationChecked = false;
  function migrateLegacyConfigurationOnce() {
    if (legacyMigrationChecked) return null;
    legacyMigrationChecked = true;
    for (const file of legacyConfigFiles) {
      const legacy = readConfigurationFile(file);
      if (legacy) return legacy;
    }
    return null;
  }
  /* Bu çalıştırmanın cihaz mührü. options.deviceId yalnız sınama içindir. */
  const deviceId = normalizeDeviceId(options.deviceId) || deviceFingerprint(env);
  // Paket başka bir makineye kopyalandığında mühür ilk okumada bir kez
  // düşürülür; sonuç diske de yazılır ki tanı ekranı ve bir sonraki açılış
  // aynı gerçeği görsün. Yazma başarısız olsa bile BELLEKTEKİ değer temizdir:
  // kaynak makinenin profili/portu hiçbir koşulda kullanılmaz.
  let lastRebind = { rebound: false, dropped: [] };
  let persistedOnce = false;
  function loadConfiguration() {
    const current = readConfigurationFile(configFile);
    const legacy = current ? null : migrateLegacyConfigurationOnce();
    const source = current || legacy;
    const result = rebindConfiguration(source || DEFAULT_CONFIG, deviceId);
    if (result.rebound) lastRebind = { rebound: true, dropped: result.dropped };
    const stampChanged = !source || source.deviceId !== result.configuration.deviceId;
    // Dosya YOKSA hiç yazılmaz: salt okuma bir ayar dosyası doğurmamalı.
    if (source && !persistedOnce && (legacy || result.rebound || stampChanged)) {
      persistedOnce = true;
      try {
        fsImpl.mkdirSync(path.dirname(configFile), { recursive: true });
        writeJson(configFile, result.configuration);
      } catch (_) {}
    }
    return result.configuration;
  }
  function saveConfiguration(value) {
    const next = normalizeConfiguration({ ...loadConfiguration(), ...(value || {}), deviceId });
    fsImpl.mkdirSync(path.dirname(configFile), { recursive: true });
    writeJson(configFile, next);
    return next;
  }
  function deviceBinding() { return { deviceId, ...lastRebind }; }
  function browserCandidates(browser) {
    const local = clean(env.LOCALAPPDATA);
    const hostLocal = clean(env.BL_HOST_LOCALAPPDATA);
    const program = clean(env.PROGRAMFILES);
    const program86 = clean(env['PROGRAMFILES(X86)']);
    const roots = [program, program86, hostLocal, local].filter(Boolean);
    const relative = browser === 'edge'
      ? ['Microsoft\\Edge\\Application\\msedge.exe']
      : ['Google\\Chrome\\Application\\chrome.exe'];
    return [...new Set(roots.flatMap(root => relative.map(item => path.join(root, item))))];
  }
  /* SÜRÜM, KURULUM KLASÖRÜNDEN OKUNUR — TARAYICI ASLA ÇALIŞTIRILMAZ.
     Kurulum klasörünün yanında sürüm adlı bir alt klasör vardır
     (…\Edge\Application\153.0.4234.32\) ve bu kaynak güvenilirdir.

     Eskiden sürüm için `msedge.exe --version` / `chrome.exe --version`
     çalıştırılıyordu. Windows'ta Edge/Chrome bu bayrağı DESTEKLEMEZ: stdout'a
     hiçbir şey yazmaz, gerçek bir tarayıcı penceresi açar ve 2,5 sn sonra
     zaman aşımıyla öldürülür. Tarayıcı zaten açıksa iş singleton'a devredilir
     ve kullanıcının Edge'inde yeni pencere belirir. Her durum/bağlantı
     kontrolü bunu 2–4 kez yaptığı için "Get OAB" ve "Remote Debugging"
     düğmelerinde 3–4 tarayıcı açılıp kapanıyordu. */
  function installedBrowserVersion(executablePath) {
    let best = '';
    let bestParts = null;
    try {
      const root = path.dirname(clean(executablePath));
      if (root && clean(executablePath)) {
        for (const entry of fsImpl.readdirSync(root)) {
          const name = String(entry && typeof entry === 'object' && 'name' in entry ? entry.name : entry);
          if (!/^\d+\.\d+\.\d+\.\d+$/.test(name)) continue;
          const parts = name.split('.').map(Number);
          const diff = bestParts ? parts.map((value, index) => value - bestParts[index]).find(value => value !== 0) : 1;
          if (diff > 0) { best = name; bestParts = parts; }
        }
      }
    } catch (_) { /* sürüm okunamazsa boş kalır ve eski davranış sürer */ }
    return best;
  }
  function browserMajorVersion(executablePath, versionText = '') {
    const fromText = /(\d+)\.\d+\.\d+\.\d+/.exec(clean(versionText) || installedBrowserVersion(executablePath));
    const major = fromText ? Number(fromText[1]) : 0;
    return Number.isFinite(major) ? major : 0;
  }
  function detectBrowser(browser) {
    const executablePath = browserCandidates(browser).find(item => { try { return fsImpl.existsSync(item); } catch (_) { return false; } }) || '';
    const version = executablePath ? installedBrowserVersion(executablePath) : '';
    return { installed: Boolean(executablePath), browser, executablePath: executablePath || undefined, version: version || undefined, majorVersion: browserMajorVersion(executablePath, version) };
  }
  function detectInstalledBrowsers() { return BROWSERS.map(detectBrowser); }
  function detectSystemDefaultBrowser() {
    const result = resolveSystemDefault({ readRegistry });
    if (result.browser === 'edge' || result.browser === 'chrome') {
      const found = detectBrowser(result.browser);
      return { ...result, executablePath: found.executablePath, version: found.version };
    }
    return result;
  }
  // Chrome de kullanıcının GERÇEK profilini kullanır; boş bir Buyer Log
  // profili yalnız gerçek profil bulunamazsa devreye girer.
  function chromeUserDataRoots() {
    const local = clean(env.LOCALAPPDATA);
    const hostLocal = clean(env.BL_HOST_LOCALAPPDATA);
    return [
      clean(env.BL_CHROME_USER_DATA_DIR),
      hostLocal && path.join(hostLocal, 'Google', 'Chrome', 'User Data'),
      local && path.join(local, 'Google', 'Chrome', 'User Data'),
      local && path.join(local, 'Google', 'Chrome Beta', 'User Data'),
      local && path.join(local, 'Google', 'Chrome Dev', 'User Data'),
      local && path.join(local, 'Google', 'Chrome SxS', 'User Data'),
    ].filter(Boolean);
  }
  function edgeUserDataRoots() {
    const local = clean(env.LOCALAPPDATA);
    const hostLocal = clean(env.BL_HOST_LOCALAPPDATA);
    return [
      clean(env.BL_EDGE_USER_DATA_DIR),
      hostLocal && path.join(hostLocal, 'Microsoft', 'Edge', 'User Data'),
      local && path.join(local, 'Microsoft', 'Edge', 'User Data'),
      local && path.join(local, 'Microsoft', 'Edge Beta', 'User Data'),
      local && path.join(local, 'Microsoft', 'Edge Dev', 'User Data'),
      local && path.join(local, 'Microsoft', 'Edge SxS', 'User Data'),
    ].filter(Boolean);
  }
  // Kurulu tarayıcının gerçek kullanıcı veri klasörü ve oradaki profiller.
  // Aynı çözümleme hem profil listesi hem de başlatma argümanları için
  // kullanılır; iki yerin ayrı karar vermesi mümkün değildir.
  function discoverUserProfiles(browser) {
    const roots = browser === 'edge' ? edgeUserDataRoots() : browser === 'chrome' ? chromeUserDataRoots() : [];
    for (const root of roots) {
      try {
        if (!fsImpl.existsSync(path.join(root, 'Local State'))) continue;
        const dirs = fsImpl.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name);
        const text = fsImpl.readFileSync(path.join(root, 'Local State'), 'utf8');
        const profiles = parseEdgeProfiles(text, dirs);
        if (profiles.length) return { root, profiles };
      } catch (_) {}
    }
    return { root: '', profiles: [] };
  }
  function listBrowserProfiles(browser) {
    const { profiles } = discoverUserProfiles(browser);
    if (profiles.length) return profiles.map(item => ({ ...item, mode: 'existing' }));
    if (browser === 'edge') return [];
    return [{ id: 'Default', name: 'Buyer Log Persistent Profile', mode: 'buyer-log-persistent' }];
  }
  // Chromium açık bir tarayıcı verisi klasörüne ikinci kez remote debugging
  // ile bağlanamaz; o klasörü hangi portun tuttuğunu tarayıcının kendi
  // DevToolsActivePort dosyası söyler. Zaten geçerli bir uç nokta varsa
  // yeniden başlatmaya gerek yoktur.
  function readDevToolsActivePort(userDataDir) {
    const root = clean(userDataDir);
    if (!root) return null;
    try {
      const raw = fsImpl.readFileSync(path.join(root, 'DevToolsActivePort'), 'utf8').split(/\r?\n/).map(clean).filter(Boolean);
      const port = Number(raw[0]);
      if (!validatePort(port)) return null;
      return { port, browserPath: raw[1] || '', userDataDir: root };
    } catch (_) { return null; }
  }
  function getRemoteDebugPolicy(browser) {
    const policyRoot = browser === 'edge' ? 'Microsoft\\Edge' : 'Google\\Chrome';
    const keys = ['HKCU', 'HKLM'].map(hive => `${hive}\\Software\\Policies\\${policyRoot}`);
    const values = keys.map(key => { try { return readRegistry(key, 'RemoteDebuggingAllowed'); } catch (_) { return undefined; } });
    return { browser, status: combinePolicyValues(values), source: keys, values: values.map(value => normalizePolicyValue(value)) };
  }
  async function verifyEndpoint(port, timeoutMs = 1200) {
    if (!validatePort(port) || typeof fetchImpl !== 'function') return { ok: false, status: 'Connection failed', reason: 'invalid-client' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`http://127.0.0.1:${Number(port)}/json/version`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch (_) { return { ok: false, status: 'Port conflict', reason: 'invalid-json' }; }
      if (!response.ok) return { ok: false, status: 'Connection failed', reason: `http-${response.status}` };
      const validated = validateCdpVersion(payload, port);
      if (!validated.ok) return { ok: false, status: 'Port conflict', reason: 'foreign-server' };
      const httpEndpoint = `http://127.0.0.1:${Number(port)}`;
      return { ok: true, status: 'Connected', port: Number(port), browser: validated.browser, webSocketDebuggerUrl: validated.webSocketDebuggerUrl, httpEndpoint, endpoint: httpEndpoint };
    } catch (error) {
      return { ok: false, status: error && error.name === 'AbortError' ? 'Connection failed' : 'Browser is not running', reason: 'request-failed' };
    } finally { clearTimeout(timer); }
  }
  async function resolveDebugPort(browser, preferredPort, { requireBrowserIdentity = false, strategy = null } = {}) {
    const requested = normalizePort(preferredPort);
    const candidates = [...new Set([requested, DEFAULT_PORTS[browser], ...Object.values(DEFAULT_PORTS)].filter(Boolean))];
    const conflicts = [];
    for (const port of candidates) {
      const active = await verifyEndpoint(port, 500);
      // Portta CDP konuşan BAŞKA bir Chromium varsa (ör. Edge beklenirken
      // Chrome) o uç nokta devralınmaz; port da dolu sayılır.
      if (active.ok) {
        if (requireBrowserIdentity && !endpointMatchesBrowser(active.browser, browser)) { conflicts.push({ port, reason: 'foreign-browser' }); continue; }
        // Strateji verildiyse "Edge cevap verdi" yetmez: uç nokta SEÇİLİ
        // profilin süreci olmalı. Aksi hâlde port dolu sayılır ve profil
        // kendi portunda başlatılır — yabancı orunuma bağlanılmaz.
        if (!strategy) return { port, existingEndpoint: active, conflicts };
        const ownership = endpointOwnership(strategy, active, port);
        if (ownership.owned) return { port, existingEndpoint: active, ownership, conflicts };
        conflicts.push({ port, reason: ownership.reason || 'not-owned' });
        continue;
      }
      if (await canBindPort(port)) return { port, existingEndpoint: null, conflicts };
    }
    return { port: await freeLoopbackPort(), existingEndpoint: null, conflicts };
  }
  function resolveEffectiveBrowser(configuration = loadConfiguration()) {
    const preferredBrowser = normalizePreferredBrowser(configuration.preferredBrowser);
    const detected = preferredBrowser === 'system' ? detectSystemDefaultBrowser() : { browser: preferredBrowser, source: 'explicit-preference' };
    const resolvedBrowser = detected.browser;
    const installed = BROWSERS.includes(resolvedBrowser) ? detectBrowser(resolvedBrowser) : { installed: false, browser: resolvedBrowser };
    // profileMode gerçek keşiften gelir; tarayıcı adına göre önden varsayılmaz.
    const majorVersion = Number(installed.majorVersion) || 0;
    const defaultProfileDebuggingBlocked = majorVersion >= DEFAULT_PROFILE_DEBUG_BLOCKED_MAJOR;
    // profileMode gerçek keşiften gelir; tarayıcı adına göre önden varsayılmaz.
    const profileMode = BROWSERS.includes(resolvedBrowser) && !defaultProfileDebuggingBlocked
      && discoverUserProfiles(resolvedBrowser).profiles.length ? 'existing' : 'buyer-log-persistent';
    return { preference: preferredBrowser, resolvedBrowser, executablePath: installed.executablePath, version: installed.version, majorVersion, defaultProfileDebuggingBlocked, installed: installed.installed, detected, profileMode };
  }
  /* Kullanıcının gerçek profili varsayılan yoldur (Edge ve Chrome).
     Gerçek kullanıcı veri klasörü bulunamazsa yalnız o zaman Buyer Log'a ait
     kalıcı profil kullanılır; bu bir yedek yoldur, normal çözüm değildir. */
  function resolveProfileStrategy(resolved, configuration = loadConfiguration()) {
    const browser = resolved.resolvedBrowser;
    if (!BROWSERS.includes(browser)) return { browser, mode: 'unsupported', profileDirectory: '', userDataDir: '', label: 'Unsupported browser' };
    const selected = normalizeProfileDirectory(configuration.selectedEdgeProfileDirectory);
    const { root, profiles } = discoverUserProfiles(browser);
    const match = selected ? profiles.find(item => item.id === selected) : null;
    // Seçili profil bu makinede YOKSA sessizce profiles[0]'a düşmek, kullanıcıyı
    // "seçtiğim profil kullanılıyor" sanısında bırakıyordu. Düşüş hâlâ olur
    // (çalışmaya devam etmek için) ama artık BİLDİRİLİR.
    const profileSelectionStale = Boolean(selected) && !match;
    const profile = match || profiles[0];
    const browserName = browser === 'edge' ? 'Edge' : 'Chrome';
    /* Chromium 136+ gerçek (varsayılan) kullanıcı veri klasöründe remote
       debugging'i kapatır: port dinlemeye açılır ama /json/* uçları 404 döner
       ve tarayıcı WebSocket'i el sıkışmaz. Bu sürümlerde "mevcut profile
       bağlan" yolu ÇALIŞAMAZ; denemek kullanıcıyı sonu gelmeyen bir
       "bağlanamadı" döngüsünde bırakır. */
    if (resolved.defaultProfileDebuggingBlocked) {
      return { browser, mode: 'buyer-log-persistent', profileDirectory: 'Default', userDataDir: path.join(localDataRoot, 'browser-profiles', browser),
        label: `Buyer Log Persistent ${browserName} Profile`, profiles, selectedProfileDirectory: selected, profileSelectionStale,
        persistentReason: 'default-profile-debugging-blocked', browserMajorVersion: Number(resolved.majorVersion) || 0 };
    }
    if (root && profile) {
      return { browser, mode: 'existing', profileDirectory: profile.id, userDataDir: root, label: `${profile.name} — Existing ${browserName} Profile`, profiles, selectedProfileDirectory: selected, profileSelectionStale };
    }
    return { browser, mode: 'buyer-log-persistent', profileDirectory: 'Default', userDataDir: path.join(localDataRoot, 'browser-profiles', browser), label: `Buyer Log Persistent ${browserName} Profile`, profiles, selectedProfileDirectory: selected, profileSelectionStale };
  }
  function browserProcessRunning(browser) {
    if (options.processRunning) return Boolean(options.processRunning(browser));
    if (process.platform !== 'win32') return false;
    const image = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    try {
      const result = spawnSyncImpl('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 2000, shell: false });
      const escapedImage = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapedImage}\\b`, 'i').test(String(result.stdout || '').replace(/\s+/g, ' '));
    } catch (_) { return false; }
  }
  /* Is THIS exact --user-data-dir already held by a Chromium process?
     For the Buyer Log persistent profile, starting the executable again while
     CDP is unhealthy does not repair it: Chromium delegates to the singleton,
     opens another new tab/window, then the child exits. Detect that condition
     and stop instead of multiplying empty Edge pages. */
  function browserPidRunning(pid) {
    const target = Number(pid);
    if (!Number.isInteger(target) || target <= 0) return false;
    if (options.processAlive) return Boolean(options.processAlive(target));
    if (process.platform !== 'win32') return false;
    try {
      const result = spawnSyncImpl('tasklist.exe', ['/FI', `PID eq ${target}`, '/NH'], { encoding:'utf8', windowsHide:true, timeout:2500, shell:false });
      return new RegExp(`\\b${target}\\b`).test(String(result.stdout || ''));
    } catch (_) { return false; }
  }
  /* The PID guard complements command-line profile detection. Corporate WMI /
     CIM policies can hide CommandLine even though the process is alive. If the
     exact process Buyer Log just spawned is still alive, another launch cannot
     repair CDP; it can only create another Edge window. */
  function ownedBrowserProcessStillRunning(strategy) {
    if (!strategy || runtime.ownedStrategyKey !== strategyKey(strategy) || !runtime.ownedPid) return false;
    const alive = browserPidRunning(runtime.ownedPid);
    if (!alive) runtime.ownedPid = null;
    return alive;
  }
  function browserUserDataDirProcessRunning(browser,userDataDir) {
    if (options.profileProcessRunning) return Boolean(options.profileProcessRunning(browser,userDataDir));
    if (process.platform !== 'win32' || !clean(userDataDir)) return false;
    const image = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    try {
      const result = spawnSyncImpl('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
        `$items = Get-CimInstance Win32_Process -Filter "Name='${image}'" -ErrorAction SilentlyContinue; if ($items) { $items | ForEach-Object { $_.CommandLine } }`],
        { encoding:'utf8', windowsHide:true, timeout:6000, shell:false });
      for (const line of String(result.stdout||'').split(/\r?\n/)) {
        const dir=parseUserDataDirArgument(line);if(dir&&samePath(dir,userDataDir))return true;
      }
    } catch (_) {}
    return false;
  }
  /* ======================================================================
     BUYER LOG KENDİ "DevToolsActivePort"UNU TUTAR

     ÖLÇÜLDÜ (Edge 153.0.4234.32, bu makine): Edge remote debugging AÇIKKEN
     ve /json/version SAĞLIKLI cevap verirken kullanıcı veri klasörüne
     DevToolsActivePort dosyasını YAZMIYOR. Klasörde yalnız 0 baytlık
     "lockfile" var. Yani tarayıcının yazdığı dosyaya dayanan sahiplik kanıtı
     modern Edge'de tek başına yetmez.

     Sonuç: Buyer Log kendi başlattığı uç noktayı kendisi kaydeder. Kayıt
     cihaz mührüyle mühürlüdür — paket başka bir bilgisayara kopyalanırsa
     mühür tutmaz ve kayıt hiç okunmaz. İçinde sır yoktur: yalnız port,
     tarayıcı süreç GUID'i ve hangi profil için açıldığı.

     Bu kayıt olmadan şu gerçek hata oluşuyordu: Buyer Log sunucusu yeniden
     başlayınca kendi tarayıcısının 9223'te açık olduğunu unutuyor, yeni bir
     port ayırıp Edge'i yeniden başlatıyor; Edge ise aynı kullanıcı veri
     klasörü açık olduğu için işi singleton'a devredip HEMEN kapanıyor ve
     ayrılan portta hiçbir zaman CDP açılmıyordu (cdp-timeout).
     ====================================================================== */
  const endpointRecordFile = options.endpointRecordFile || path.join(canonicalDataRoot, 'settings', 'browser-debug-endpoint.json');
  function readEndpointRecord() {
    try {
      const raw = JSON.parse(fsImpl.readFileSync(endpointRecordFile, 'utf8'));
      if (!raw || typeof raw !== 'object') return null;
      // Mühür tutmuyorsa kayıt BAŞKA bir makineye aittir; okunmaz.
      if (normalizeDeviceId(raw.deviceId) !== deviceId) return null;
      const port = Number(raw.port);
      if (!validatePort(port)) return null;
      return { strategyKey: clean(raw.strategyKey), port, browserGuid: clean(raw.browserGuid) };
    } catch (_) { return null; }
  }
  function writeEndpointRecord(strategy, connection) {
    try {
      fsImpl.mkdirSync(path.dirname(endpointRecordFile), { recursive: true });
      writeJson(endpointRecordFile, {
        schemaVersion: 1, deviceId, strategyKey: strategyKey(strategy),
        port: Number(connection.port), browserGuid: browserGuidFromWs(connection.webSocketDebuggerUrl),
        updatedAt: new Date().toISOString(),
      });
    } catch (_) { /* kayıt bir hız yardımıdır; yazılamazsa akış bozulmaz */ }
  }
  /* ======================================================================
     KESİN KANIT: PORTU DİNLEYEN SÜREÇ HANGİ PROFİL KLASÖRÜNÜ AÇTI?

     Edge 153 DevToolsActivePort yazmadığı için dosyaya dayalı kanıt tek
     başına yetmiyor. İşletim sistemi ise cevabı kesin olarak biliyor: portu
     dinleyen sürecin komut satırında --user-data-dir yazar. Bu değer seçili
     profilin köküyle birebir aynıysa uç nokta O KLASÖRÜN tarayıcısınındır —
     tahmin değil, ölçüm.

     Maliyet bir netstat + bir süreç sorgusudur ve yalnız sahiplik başka
     yolla kanıtlanamadığında ödenir; sonuç port+pid başına önbelleklenir.
     Sorgu sır taşımaz: yalnız --user-data-dir karşılaştırılır, komut satırı
     ne saklanır ne de bildirilir. */
  const processOwnerCache = new Map();
  function listeningPid(port) {
    if (process.platform !== 'win32') return 0;
    try {
      const result = spawnSyncImpl('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true, timeout: 4000, shell: false });
      return parseListeningPid(result.stdout, port);
    } catch (_) { return 0; }
  }
  function processUserDataDir(pid) {
    if (options.processUserDataDir) return clean(options.processUserDataDir(pid));
    if (process.platform !== 'win32' || !pid) return '';
    try {
      const result = spawnSyncImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }`],
        { encoding: 'utf8', windowsHide: true, timeout: 6000, shell: false });
      return parseUserDataDirArgument(result.stdout);
    } catch (_) { return ''; }
  }
  function endpointOwnedByProcess(strategy, port) {
    const pid = options.listeningPid ? Number(options.listeningPid(port)) || 0 : listeningPid(port);
    if (!pid) return null;
    const key = `${port}:${pid}`;
    if (!processOwnerCache.has(key)) processOwnerCache.set(key, processUserDataDir(pid));
    const dir = processOwnerCache.get(key);
    if (!dir) return null;
    return samePath(dir, strategy && strategy.userDataDir);
  }
  function recordForStrategy(strategy) {
    const record = readEndpointRecord();
    return record && record.strategyKey === strategyKey(strategy) ? record : null;
  }
  function strategyKey(strategy) {
    const root = clean(strategy && strategy.userDataDir);
    return `${root ? path.resolve(root).toLowerCase() : ''}|${clean(strategy && strategy.profileDirectory)}`;
  }
  /* Bu uç nokta SEÇİLİ profilin tarayıcı sürecine mi ait?
     Kanıt sırası: (1) profilin DevToolsActivePort dosyasındaki port+GUID,
     (2) bu çalıştırmada aynı profil için Buyer Log'un kendi başlattığı port.
     Hiçbiri yoksa sahiplik KANITLANAMAZ; uç nokta devralınmaz. */
  function endpointOwnership(strategy, connection, port) {
    const guid = browserGuidFromWs(connection && connection.webSocketDebuggerUrl);
    const active = readDevToolsActivePort(strategy && strategy.userDataDir);
    if (active) {
      const activeGuid = browserGuidFromWs(active.browserPath);
      if (Number(active.port) !== Number(port)) {
        return { owned: false, source: 'devtools-active-port', reason: 'endpoint-belongs-to-another-browser', browserGuid: guid, profilePort: Number(active.port) };
      }
      if (activeGuid && guid && activeGuid !== guid) {
        return { owned: false, source: 'devtools-active-port', reason: 'stale-endpoint', browserGuid: guid };
      }
      return { owned: true, source: 'devtools-active-port', browserGuid: guid || activeGuid };
    }
    if (runtime.ownedPort && Number(runtime.ownedPort) === Number(port) && runtime.ownedStrategyKey === strategyKey(strategy)) {
      return { owned: true, source: 'launch-owned', browserGuid: guid };
    }
    /* Buyer Log'un kendi kaydı: sunucu yeniden başlasa da kendi tarayıcısını
       tanır. GUID de kaydedildiyse birebir eşleşmesi gerekir — port aynı ama
       süreç değişmişse (başkası portu kaptıysa) sahiplik DÜŞER. */
    const record = recordForStrategy(strategy);
    if (record && Number(record.port) === Number(port)) {
      if (record.browserGuid && guid && record.browserGuid !== guid) {
        return { owned: false, source: 'buyer-log-record', reason: 'stale-endpoint', browserGuid: guid };
      }
      return { owned: true, source: 'buyer-log-record', browserGuid: guid };
    }
    const byProcess = endpointOwnedByProcess(strategy, port);
    if (byProcess === true) return { owned: true, source: 'listening-process', browserGuid: guid };
    if (byProcess === false) return { owned: false, source: 'listening-process', reason: 'endpoint-belongs-to-another-browser', browserGuid: guid };
    return { owned: false, source: 'none', reason: 'ownership-unprovable', browserGuid: guid };
  }
  /* Seçilen profilin klasörü zaten remote debugging ile açıksa uç nokta
     oradadır. Bu kontrol her kurulum çağrısının BAŞINDA yapılır; ikinci kez
     "Enable" demek tarayıcıyı yeniden başlatmaz.

     ÖNEMLİ: cevap veren ama sahipliği kanıtlanamayan uç nokta DEVRALINMAZ;
     çakışma olarak bildirilir. Yoksa Buyer Log başka bir Edge profilinin
     (başka birinin oturumunun) içinde çalışmaya başlar. */
  async function findOwnedEndpoint(strategy, configuration) {
    const active = readDevToolsActivePort(strategy.userDataDir);
    const record = recordForStrategy(strategy);
    // Kendi kaydımız İLK sırada: açık olan kendi tarayıcımızı yeniden
    // başlatmadan bulmanın tek güvenilir yolu odur. Yabancı bir uç noktaya
    // bağlanma riski yoktur; her aday ayrıca sahiplik sınavından geçer.
    const candidates = [...new Set([
      active && active.port,
      record && record.port,
      runtime.ownedPort,
      normalizePort(configuration.preferredPort),
      ...Object.values(DEFAULT_PORTS),
    ].filter(Boolean))];
    let conflict = null;
    for (const port of candidates) {
      const connection = await verifyEndpoint(port, 900);
      if (!connection.ok) continue;
      // Portta CDP konuşan başka bir Chromium (ör. Edge yerine Chrome) varsa
      // o uç nokta devralınmaz.
      if (!endpointMatchesBrowser(connection.browser, strategy.browser)) {
        conflict = conflict || { port, reason: 'foreign-browser', browser: connection.browser };
        continue;
      }
      const ownership = endpointOwnership(strategy, connection, port);
      if (ownership.owned) return { connection, ownership, port, conflict: null };
      conflict = conflict || { port, reason: ownership.reason, browser: connection.browser, profilePort: ownership.profilePort };
    }
    return { connection: null, ownership: null, port: null, conflict };
  }
  function endpointMatchesBrowser(browserLabel, expected) {
    const label = clean(browserLabel);
    if (!label) return false;
    // "Edg/153.0.4234.32" de "Microsoft Edge/140" da Edge'dir (bkz. yukarıdaki
    // ölçüm notu). Chrome yalnız Edge OLMAYAN Chromium'dur.
    const isEdge = EDGE_BROWSER_LABEL.test(label);
    return expected === 'edge' ? isEdge : /chrome|chromium/i.test(label) && !isEdge;
  }
  /* KANONİK BAĞLAMA. Tarayıcıya ihtiyaç duyan her entegrasyon sayfasını
     BURADAN alır; kendi başına profil/sekme aramaz. İçinde hiçbir sır yoktur:
     çerez, token, oturum bilgisi taşımaz. */
  function buildBinding(connection, strategy, ownership) {
    const port = Number(connection.port);
    const httpEndpoint = connection.httpEndpoint || connection.endpoint || `http://127.0.0.1:${port}`;
    return {
      browserType: strategy.browser,
      browserExecutable: clean(runtime.resolved && runtime.resolved.executablePath),
      userDataRoot: strategy.userDataDir,
      profileDirectory: strategy.profileDirectory,
      profileMode: strategy.mode,
      profileFingerprint: profileFingerprint(strategy.userDataDir, strategy.profileDirectory, deviceId),
      endpoint: httpEndpoint,
      port,
      browserGuid: (ownership && ownership.browserGuid) || browserGuidFromWs(connection.webSocketDebuggerUrl),
      ownership: { owned: true, source: (ownership && ownership.source) || 'launch' },
      browserContextIdentity: runtime.boundContext || null,
      deviceId,
      verifiedAt: new Date().toISOString(),
    };
  }
  function markConnected(connection, strategy, ownership = null) {
    const binding = buildBinding(connection, strategy, ownership);
    writeEndpointRecord(strategy, connection);
    runtime.binding = binding;
    runtime.endpoint = {
      ...connection, browser: strategy.browser, profileMode: strategy.mode,
      profileDirectory: strategy.profileDirectory, userDataDir: strategy.userDataDir,
      profileFingerprint: binding.profileFingerprint, browserGuid: binding.browserGuid,
      ownership: binding.ownership, binding, verifiedAt: binding.verifiedAt,
    };
    runtime.status = 'Connected';
    runtime.state = 'READY';
    runtime.error = null;
    return runtime.endpoint;
  }
  function fail(status, reason, extra = {}) {
    const connectionState = CONNECTION_STATES.includes(clean(extra.connectionState)) ? clean(extra.connectionState) : 'ERROR';
    runtime.status = status;
    runtime.state = connectionState;
    runtime.error = reason;
    runtime.binding = null;
    // ERROR bir son durumdur: buradan kendiliğinden PREPARING'e dönülmez,
    // yeni bir kullanıcı isteği gerekir.
    return { ok: false, status, reason, ...extra, connectionState };
  }
  /* Seçim kuralı. Tek profil varsa kendiliğinden seçilebilir; birden fazla
     profil varsa kullanıcının AÇIK seçimi gerekir ve o seçim bu makinede
     saklanır. Seçilen profil artık yoksa BAŞKASINA düşülmez. */
  function profileSelectionState(strategy) {
    if (!strategy || strategy.mode !== 'existing') return null;
    if (strategy.profileSelectionStale) return 'PROFILE_NOT_FOUND';
    const profiles = Array.isArray(strategy.profiles) ? strategy.profiles : [];
    if (!clean(strategy.selectedProfileDirectory) && profiles.length > 1) return 'PROFILE_REQUIRED';
    return null;
  }
  /* Tek kanonik kurulum işlemi. Paralel istekler aynı sözü paylaşır; ikinci
     bir tarayıcı başlatma dizisi başlatılmaz. */
  let setupInFlight = null;
  function enableAndLaunch(input = {}) {
    if (setupInFlight) return setupInFlight;
    const request = runSetup(input, { allowRestart: Boolean(input && input.allowRestart) })
      .finally(() => { if (setupInFlight === request) setupInFlight = null; });
    setupInFlight = request;
    return request;
  }
  async function runSetup(input = {}, { allowRestart = false } = {}) {
    runtime.state = 'DETECTING';
    runtime.error = null;
    const configuration = saveConfiguration({ ...input, enabled: true });
    const resolved = resolveEffectiveBrowser(configuration);
    runtime.resolved = resolved;
    const base = { resolved, configuration };
    if (!BROWSERS.includes(resolved.resolvedBrowser)) return fail('Unsupported system default', 'unsupported-browser', base);
    if (!resolved.installed) return fail('Browser not installed', 'browser-not-installed', base);
    const policy = getRemoteDebugPolicy(resolved.resolvedBrowser);
    if (policy.status === 'BLOCKED_BY_ORGANIZATION') return fail('Blocked by organization', 'policy-blocked', { ...base, policy });
    const strategy = resolveProfileStrategy(resolved, configuration);
    if (strategy.mode === 'buyer-log-persistent') fsImpl.mkdirSync(strategy.userDataDir, { recursive: true });

    /* SESSİZ PROFİL DÜŞÜŞÜ YOK.
       Seçili profil bu makinede yoksa listenin ilk profiline geçmek,
       kullanıcının oturumu sandığı yerde BAŞKA BİRİNİN oturumunda çalışmak
       demektir. Paket başka bir bilgisayara kopyalandığında görülen tam olarak
       budur. Düşülmez: durum bildirilir ve seçim yeniden istenir. */
    const selectionState = profileSelectionState(strategy);
    if (selectionState === 'PROFILE_NOT_FOUND') {
      return fail('Profile not found', 'profile-not-found', { ...base, strategy, policy, connectionState: 'PROFILE_NOT_FOUND', selectedProfileDirectory: strategy.selectedProfileDirectory });
    }
    if (selectionState === 'PROFILE_REQUIRED') {
      return fail('Profile required', 'profile-required', { ...base, strategy, policy, connectionState: 'PROFILE_REQUIRED' });
    }

    runtime.state = 'CHECK_EXISTING_ENDPOINT';
    const reusable = await findOwnedEndpoint(strategy, configuration);
    runtime.portConflict = reusable.conflict || null;
    if (reusable.connection) return { ok: true, status: 'Connected', reused: true, endpoint: markConnected(reusable.connection, strategy, reusable.ownership), strategy, policy, ...base };

    /* Persistent profile already running but no valid CDP endpoint: spawning
       the same --user-data-dir again is a Chromium singleton hand-off and only
       creates another blank/new-tab window. Stop here and ask for one clean
       close/relaunch instead of producing an unbounded tab loop. */
    if (strategy.mode === 'buyer-log-persistent' && (ownedBrowserProcessStillRunning(strategy) || browserUserDataDirProcessRunning(resolved.resolvedBrowser,strategy.userDataDir))) {
      return fail('Buyer Log browser profile is already running without a healthy debugging endpoint', 'browser-profile-running-no-cdp', {
        ...base, strategy, policy, connectionState:'REMOTE_DEBUG_DISABLED', profileProcessRunning:true,
        ownedPid: runtime.ownedPid || null, lastLaunchAt: runtime.lastLaunchAt || 0,
      });
    }

    /* Tarayıcı, seçilen profil klasörü açıkken remote debugging olmadan
       çalışıyorsa yeni süreç singleton'a devredip kapanır. O yüzden burada
       başlatma DENENMEZ; kullanıcının onayladığı tek bir kontrollü yeniden
       başlatma gerekir. Aksi hâlde aç-kapan döngüsü oluşur. */
    /* SİNGLETON YALNIZ AYNI KULLANICI VERİ KLASÖRÜ İÇİN GEÇERLİDİR.

       Chromium'un "yeni süreç açık olana devreder ve kapanır" davranışı
       --user-data-dir BAŞINA çalışır. Buyer Log kendi kalıcı profilini
       kullandığında (Chromium 136+ ile TEK yol budur) o klasörü kullanıcının
       normal Edge'i tutmaz; devir olamaz.

       Eski kontrol makinede HERHANGİ bir msedge.exe varsa duruyordu. Ölçülen
       sonuç: Edge 153'te kullanıcı Buyer Log'u kurmak için AÇIK TARAYICISININ
       TAMAMINI kapatmak zorunda kalıyordu — üstelik kapatmasının hiçbir
       faydası yoktu, çünkü açılacak profil zaten ayrı bir klasördeydi.
       Kontrol artık yalnız gerçekten çakışan durumda uygulanır: seçili
       profil, tarayıcının KENDİ kullanıcı veri kökünde. */
    if (strategy.mode === 'existing' && browserProcessRunning(resolved.resolvedBrowser)) {
      if (!allowRestart) return fail('Browser restart required', 'browser-running', { ...base, strategy, policy });
      runtime.state = 'RESTART_ONCE_IF_REQUIRED';
      const closed = await closeBrowserOnce(resolved.resolvedBrowser);
      if (!closed) return fail('Browser restart required', 'browser-close-failed', { ...base, strategy, policy });
    }

    runtime.state = 'PREPARING';
    /* Seçili port yabancı/bayat bir uç nokta tarafından tutuluyorsa ona
       BAĞLANILMAZ; seçili profil için geçerli başka bir port hazırlanır.
       Hiç port hazırlanamazsa durum açık bir PORT_CONFLICT olarak biter. */
    const remembered = recordForStrategy(strategy);
    const portInfo = await resolveDebugPort(resolved.resolvedBrowser, configuration.preferredPort || (remembered && remembered.port) || null, { requireBrowserIdentity: true, strategy });
    const portConflict = reusable.conflict || (portInfo.conflicts || [])[0] || null;
    runtime.portConflict = portConflict;
    if (portInfo.existingEndpoint) return { ok: true, status: 'Connected', reused: true, endpoint: markConnected(portInfo.existingEndpoint, strategy, portInfo.ownership), strategy, policy, portConflict, ...base };
    const args = buildLaunchArgs({ browser: resolved.resolvedBrowser, profileMode: strategy.mode, userDataDir: strategy.userDataDir, profileDirectory: strategy.profileDirectory, port: portInfo.port });
    runtime.status = 'Launching';
    let child;
    try {
      child = spawnImpl(resolved.executablePath, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref?.();
      runtime.ownedPid = child.pid || null;
      runtime.lastLaunchAt = Date.now();
    }
    catch (error) { return fail('Launch failed', 'browser-spawn-failed', { ...base, strategy, policy }); }
    // Başlatma bir sahiplik kanıtıdır: bu portu, bu profil için BİZ açtık.
    runtime.ownedPort = portInfo.port;
    runtime.ownedStrategyKey = strategyKey(strategy);

    runtime.state = 'WAIT_FOR_CDP';
    const deadline = Date.now() + Number(options.launchTimeoutMs || 12000);
    while (Date.now() < deadline) {
      // Süreç var olmak başarı değildir; yalnız doğrulanmış CDP uç noktası sayılır.
      const connection = await verifyEndpoint(portInfo.port, 900);
      if (connection.ok) {
        runtime.state = 'VERIFY';
        const ownership = endpointOwnership(strategy, connection, portInfo.port);
        // Açtığımız portta bize ait OLMAYAN bir tarayıcı cevap veriyorsa
        // (port kapıldı) bağlanmak, yabancı bir oturuma girmek olurdu.
        if (!ownership.owned) return fail('Port conflict', ownership.reason || 'endpoint-not-owned', { ...base, strategy, policy, port: portInfo.port, connectionState: 'PORT_CONFLICT', portConflict: { port: portInfo.port, reason: ownership.reason } });
        return { ok: true, status: 'Connected', endpoint: markConnected(connection, strategy, ownership), strategy, policy, portConflict, ...base };
      }
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    if (portConflict) return fail('Port conflict', portConflict.reason || 'port-conflict', { ...base, strategy, policy, port: portInfo.port, connectionState: 'PORT_CONFLICT', portConflict });
    return fail('Launch failed', 'cdp-timeout', { ...base, strategy, policy, port: portInfo.port });
  }
  /* Tek, sınırlı ve nazik kapatma. /F kullanılmaz: pencereler kapanma isteği
     alır, kullanıcının oturumu ve sekme kurtarması korunur. Süreç kapanmazsa
     ikinci bir deneme yapılmaz; işlem ERROR ile biter. */
  async function closeBrowserOnce(browser) {
    if (options.closeBrowser) return Boolean(await options.closeBrowser(browser));
    if (process.platform !== 'win32') return false;
    const image = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    try { spawnSyncImpl('taskkill.exe', ['/IM', image], { encoding: 'utf8', windowsHide: true, timeout: 5000, shell: false }); }
    catch (_) { return false; }
    const deadline = Date.now() + Number(options.closeTimeoutMs || 8000);
    while (Date.now() < deadline) {
      if (!browserProcessRunning(browser)) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return !browserProcessRunning(browser);
  }
  /* "Test Connection" ARTIK PORT TESTİ DEĞİL.

     Sırayla kanıtlanır: tarayıcı kurulu mu, politika izin veriyor mu, seçili
     profil bu makinede duruyor mu, uç nokta CDP konuşuyor mu, ve uç nokta
     SEÇİLİ PROFİLİN süreci mi. READY yalnız hepsi geçtiğinde verilir; sonuç
     hiçbir sır (çerez, token, oturum) taşımaz. */
  async function testConnection() {
    const configuration = loadConfiguration();
    const resolved = resolveEffectiveBrowser(configuration);
    runtime.resolved = resolved;
    const supported = BROWSERS.includes(resolved.resolvedBrowser);
    const browserLabel = resolved.resolvedBrowser === 'edge' ? 'Microsoft Edge' : resolved.resolvedBrowser === 'chrome' ? 'Google Chrome' : String(resolved.resolvedBrowser || '');
    const checks = [];
    const note = (key, ok, detail) => { checks.push({ key, ok: Boolean(ok), detail: clean(detail) }); return Boolean(ok); };
    const done = (state, status, reason, extra = {}) => {
      const ok = state === 'READY';
      if (!ok) { runtime.endpoint = null; runtime.binding = null; }
      runtime.status = status;
      runtime.state = state;
      return { ok, status, reason: reason || undefined, connectionState: state, checks, configuration, resolved, strategy: extra.strategy || null, policy: extra.policy || null, binding: ok ? runtime.binding : null, endpoint: ok ? runtime.endpoint : null, portConflict: extra.portConflict || null };
    };
    if (!note('browser', supported && resolved.installed, supported ? browserLabel : 'unsupported')) {
      return done('ERROR', supported ? 'Browser not installed' : 'Unsupported system default', supported ? 'browser-not-installed' : 'unsupported-browser');
    }
    const policy = getRemoteDebugPolicy(resolved.resolvedBrowser);
    if (!note('policy', policy.status !== 'BLOCKED_BY_ORGANIZATION', policy.status)) {
      return done('REMOTE_DEBUG_DISABLED', 'Blocked by organization', 'policy-blocked', { policy });
    }
    const strategy = resolveProfileStrategy(resolved, configuration);
    const selectionState = profileSelectionState(strategy);
    note('profile', !selectionState, selectionState || strategy.label);
    if (selectionState === 'PROFILE_NOT_FOUND') return done('PROFILE_NOT_FOUND', 'Profile not found', 'profile-not-found', { strategy, policy });
    if (selectionState === 'PROFILE_REQUIRED') return done('PROFILE_REQUIRED', 'Profile required', 'profile-required', { strategy, policy });
    if (!configuration.enabled) return done('DISABLED', 'Ready', 'not-enabled', { strategy, policy });
    const found = await findOwnedEndpoint(strategy, configuration);
    runtime.portConflict = found.conflict || null;
    if (!found.connection) {
      if (found.conflict) {
        note('endpoint', false, `port ${found.conflict.port} · ${found.conflict.reason}`);
        return done('PORT_CONFLICT', 'Port conflict', found.conflict.reason, { strategy, policy, portConflict: found.conflict });
      }
      note('endpoint', false, 'no-cdp-endpoint');
      return done('REMOTE_DEBUG_DISABLED', 'Browser is not running', 'no-endpoint', { strategy, policy });
    }
    note('endpoint', true, `127.0.0.1:${found.port}`);
    note('ownership', true, found.ownership.source);
    markConnected(found.connection, strategy, found.ownership);
    /* Sabitlenmiş CDP bağlamı BAŞKA bir profile aitse (ör. kullanıcı seçimi
       bağlantı kurulduktan sonra değiştirdi) bu bağlantı READY sayılamaz:
       iş, kullanıcının artık seçmediği profilde yürüyor olurdu. */
    const bound = runtime.boundContext;
    if (bound && bound.profileDirectory && bound.profileDirectory !== strategy.profileDirectory) {
      note('context', false, `bound:${bound.profileDirectory}`);
      return done('CONTEXT_MISMATCH', 'Browser context mismatch', 'context-profile-mismatch', { strategy, policy });
    }
    // Bağlam sahipliği bağlayıcıdan gelir; henüz kurulmadıysa bu bir hata
    // değildir (ilk PLM işi kuracaktır), yalnız "doğrulanmadı" diye bildirilir.
    note('context', Boolean(bound), bound ? bound.source : 'not-established');
    return done('READY', 'Connected', null, { strategy, policy });
  }
  let ensureEndpointInFlight = null;
  async function ensureEndpoint() {
    if (ensureEndpointInFlight) return ensureEndpointInFlight;
    const request = (async () => {
      const configuration = loadConfiguration();
      if (!configuration.enabled) return null;
      const current = await testConnection();
      if (current.ok) return runtime.endpoint;
      const launched = await enableAndLaunch(configuration);
      return launched.ok ? launched.endpoint : null;
    })().finally(() => { if (ensureEndpointInFlight === request) ensureEndpointInFlight = null; });
    ensureEndpointInFlight = request;
    return request;
  }
  /* Yeniden başlatma AYNI orkestrasyondan geçer; farkı, kullanıcının açıkça
     istediği TEK kontrollü kapatmaya izin vermesidir. Süreç zorla (/F)
     sonlandırılmaz ve bir çağrıda en fazla bir kapatma denenir. */
  function restartWithRemoteDebugging(input = {}) {
    if (setupInFlight) return setupInFlight;
    const request = runSetup({ ...input, enabled: true }, { allowRestart: true })
      .finally(() => { if (setupInFlight === request) setupInFlight = null; });
    setupInFlight = request;
    return request;
  }
  function publishActiveEndpoint(endpoint) {
    if (!endpoint || !validatePort(endpoint.port)) return null;
    runtime.endpoint = { ...endpoint, httpEndpoint: endpoint.httpEndpoint || `http://127.0.0.1:${Number(endpoint.port)}`, endpoint: endpoint.endpoint || endpoint.httpEndpoint || `http://127.0.0.1:${Number(endpoint.port)}`, verifiedAt: endpoint.verifiedAt || new Date().toISOString() };
    runtime.status = 'Connected';
    return runtime.endpoint;
  }
  async function getActiveEndpoint() {
    if (!runtime.endpoint) return null;
    const check = await verifyEndpoint(runtime.endpoint.port, 700);
    if (!check.ok) { runtime.endpoint = null; runtime.status = check.status; return null; }
    runtime.endpoint = { ...runtime.endpoint, ...check, verifiedAt: new Date().toISOString() };
    return runtime.endpoint;
  }
  /* Doğrulanmış bağlama. Tarayıcıya ihtiyaç duyan entegrasyonlar sayfayı
     buradan alır; kendi başına profil/port/sekme aramaz. */
  function getBrowserBinding() { return runtime.binding ? { ...runtime.binding, browserContextIdentity: runtime.boundContext || null } : null; }
  /* Bağlayıcı, CDP bağlamını sabitlediğinde kimliğini buraya bildirir. Kimlik
     bir sır değildir: yalnız CDP browserContextId'si ve nasıl belirlendiği. */
  function publishBoundContext(value) {
    if (!value || typeof value !== 'object') { runtime.boundContext = null; return null; }
    runtime.boundContext = { browserContextId: clean(value.browserContextId), source: clean(value.source) || 'unknown', profileDirectory: clean(value.profileDirectory), boundAt: new Date().toISOString() };
    if (runtime.binding) runtime.binding = { ...runtime.binding, browserContextIdentity: runtime.boundContext };
    return runtime.boundContext;
  }
  function connectionState(endpoint) {
    const configuration = loadConfiguration();
    if (endpoint) return 'READY';
    if (!configuration.enabled) return 'DISABLED';
    if (CONNECTION_STATES.includes(runtime.state)) return runtime.state;
    return runtime.portConflict ? 'PORT_CONFLICT' : 'REMOTE_DEBUG_DISABLED';
  }
  async function getRuntimeStatus() {
    const configuration = loadConfiguration();
    const resolved = resolveEffectiveBrowser(configuration);
    runtime.resolved = resolved;
    let endpoint = await getActiveEndpoint();
    const strategy = BROWSERS.includes(resolved.resolvedBrowser) ? resolveProfileStrategy(resolved, configuration) : null;
    /* Sunucu yeniden başladığında BELLEK boştur ama bağlantı yaşıyor olabilir.
       Eskiden bu durumda ekran "Remote Debugging kapalı" diyordu; kullanıcı
       çalışan bir bağlantıyı kapalı sanıyordu. Durum kendi kanıtını arar:
       yalnız SAHİPLİĞİ doğrulanmış uç nokta bağlantı sayılır. */
    if (!endpoint && strategy && configuration.enabled && !profileSelectionState(strategy)) {
      const found = await findOwnedEndpoint(strategy, configuration);
      runtime.portConflict = found.conflict || null;
      if (found.connection) endpoint = markConnected(found.connection, strategy, found.ownership);
    }
    const selectionState = profileSelectionState(strategy);
    const state = selectionState && !endpoint ? selectionState : connectionState(endpoint);
    return { status: endpoint ? 'Connected' : runtime.status, state: endpoint ? 'READY' : (runtime.state || 'IDLE'), connectionState: state, configuration, resolved, strategy, selectedProfileDirectory: strategy ? strategy.selectedProfileDirectory : '', device: deviceBinding(), installedBrowsers: detectInstalledBrowsers(), profiles: BROWSERS.includes(resolved.resolvedBrowser) ? listBrowserProfiles(resolved.resolvedBrowser) : [], policy: BROWSERS.includes(resolved.resolvedBrowser) ? getRemoteDebugPolicy(resolved.resolvedBrowser) : null, endpoint: endpoint || null, binding: endpoint ? getBrowserBinding() : null, portConflict: runtime.portConflict || null, busy: Boolean(setupInFlight), runtime: { ownedPid: runtime.ownedPid, state: runtime.state || 'IDLE', error: runtime.error } };
  }
  async function disable() {
    const configuration = saveConfiguration({ enabled: false });
    runtime.endpoint = null; runtime.ownedPid = null; runtime.lastLaunchAt = 0; runtime.status = 'Ready'; runtime.error = null; runtime.state = 'DISABLED';
    runtime.binding = null; runtime.boundContext = null; runtime.ownedPort = null; runtime.ownedStrategyKey = ''; runtime.portConflict = null;
    try { fsImpl.rmSync ? fsImpl.rmSync(endpointRecordFile, { force: true }) : fsImpl.unlinkSync(endpointRecordFile); } catch (_) {}
    return { ok: true, status: 'Ready', connectionState: 'DISABLED', configuration };
  }
  return {
    configFile, configRoot: path.dirname(configFile), localDataRoot, deviceId, deviceBinding, loadConfiguration, getConfiguration: loadConfiguration, saveConfiguration,
    detectInstalledBrowsers, detectBrowser, detectSystemDefaultBrowser,
    listBrowserProfiles, getRemoteDebugPolicy, resolveEffectiveBrowser,
    resolveProfileStrategy, getConfiguredBrowser: resolveEffectiveBrowser, resolveDebugPort, verifyEndpoint, enableAndLaunch, restartWithRemoteDebugging,
    ensureEndpoint, testConnection, getRuntimeStatus, getActiveEndpoint,
    publishActiveEndpoint, disable, getBrowserBinding, publishBoundContext,
    endpointOwnership, findOwnedEndpoint, profileSelectionState,
    endpointRecordFile, readEndpointRecord,
  };
}

const defaultService = createBrowserDebugService();
module.exports = {
  BROWSERS, POLICY_STATUS, CONNECTION_STATES, CONFIG_FILE_NAME, DEFAULT_PORTS, DEFAULT_CONFIG,
  browserGuidFromWs, profileFingerprint, parseListeningPid, parseUserDataDirArgument,
  normalizePreferredBrowser, normalizePort, normalizeProfileDirectory,
  normalizeConfiguration, browserFromProgId, parseRegistryValue,
  resolveSystemDefault, normalizePolicyValue, combinePolicyValues,
  parseEdgeProfiles, edgeProfileUsageOrder, buildLaunchArgs, validateCdpVersion, createBrowserDebugService,
  deviceFingerprint, rebindConfiguration, normalizeDeviceId, DEVICE_BOUND_FIELDS,
  ...defaultService,
};
