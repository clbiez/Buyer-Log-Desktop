'use strict';
const webScriptRegistry=require('./web-script-registry');

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { SERVER_DATA_ROOT } = require('../user-data');
const portableWebEngine = require('./portable-web-engine');
const browserSettings = require('./agent-browser-settings');
const { OperationController, STATES, DEFAULT_TIMEOUTS } = require('./operation-controller');
const { POWER_BI_IMPORT_DASHBOARD_URL, buildPowerBiOrderQueryPayload, descriptorColumns, DASHBOARD_FIELD_MAPPING, dashboardSchemaMissingFields, powerBiTemplateHasOrderField } = require('./power-bi-import-dashboard');
const coreNectumStyleApi = require('./corenectum-style-api');
const coreNectumApiClient = require('./corenectum-api-client');
const plmImageDownloadQueue = require('./plm-image-download-queue');
const plmSyncDiagnostics = require('./plm-sync-diagnostics');
const CORENECTUM_GET_STYLE_LIST_URL = coreNectumStyleApi.GET_STYLE_LIST_URL;
const CORENECTUM_GET_STYLE_IMAGES_URL = coreNectumStyleApi.GET_STYLE_IMAGES_URL;

/* GERÇEK Windows LOCALAPPDATA.
 *
 * Portable başlatıcı LOCALAPPDATA'yı paketin içine çeviriyor (uygulama
 * klasörünün dışına yazmasın diye). Edge'in profili ve DevToolsActivePort
 * dosyası ise kullanıcının GERÇEK klasöründe duruyor. Yönlendirilmiş değeri
 * kullanmak, canlıda tam olarak şu hatayı üretti:
 *
 *   "Seçili PLM modelleri aktarılamadı: Buyer Log mevcut Edge oturumuna
 *    henüz bağlanamadı."
 *
 * Edge açık ve remote debugging etkin olduğu hâlde, bağlayıcı paketin içindeki
 * boş klasöre baktığı için oturumu bulamıyordu. Başlatıcı gerçek yolu
 * BL_HOST_LOCALAPPDATA olarak saklıyor; öncelik onda.
 */
function hostLocalAppData() {
  const saved = clean(process.env.BL_HOST_LOCALAPPDATA);
  if (saved) return saved;
  return clean(process.env.LOCALAPPDATA);
}

const EDGE_CANDIDATES = [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.BL_HOST_LOCALAPPDATA && path.join(process.env.BL_HOST_LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge',
].filter(Boolean);

const contexts = new Map();
const recorders = new Map();
const powerBiSessionCache = new Map();
const powerBiSessionSetupInFlight = new Map();
const browserOperations = new Map();
const BROWSER_OPERATION_TIMEOUTS = Object.freeze({
  ...DEFAULT_TIMEOUTS,
  navigationTimeout: 45000,
  networkTimeout: 20000,
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function safeOwner(value) { return clean(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default'; }
function connectorError(message, code = 'BROWSER_CONNECTOR_ERROR', statusCode = 400, details) { return Object.assign(new Error(message), { code, statusCode, details }); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function browserOperationStatus(ownerId = '') {
  const operation = browserOperations.get(safeOwner(ownerId));
  return operation ? operation.snapshot() : { state:STATES.IDLE, pendingApproval:null, error:null, timeouts:{...BROWSER_OPERATION_TIMEOUTS}, operationRemainingMs:0 };
}
function createBrowserOperation(key) {
  let operation;
  operation = new OperationController({
    ...BROWSER_OPERATION_TIMEOUTS,
    onStateChange: () => browserOperations.set(key, operation),
  });
  browserOperations.set(key, operation);
  operation.start();
  return operation;
}
function edgePath() { return EDGE_CANDIDATES.find(candidate => fs.existsSync(candidate)) || ''; }
function browserDebugManager() { try { return require('./browser-debug-service'); } catch (_) { return null; } }
function edgeProcessRunning() {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq msedge.exe', '/NH'], { encoding:'utf8', windowsHide:true, timeout:2000 });
      return /\bmsedge\.exe\b/i.test(String(result.stdout || ''));
    }
    const processName = process.platform === 'darwin' ? 'Microsoft Edge' : 'microsoft-edge';
    const result = spawnSync('pgrep', ['-x', processName], { encoding:'utf8', timeout:2000 });
    return result.status === 0 && Boolean(String(result.stdout || '').trim());
  } catch (_) { return false; }
}
function managedCdpPort() {
  const raw = process.env.BL_MANAGED_EDGE_CDP_PORT;
  const value = raw == null || raw === '' ? 9223 : Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : 0;
}
function managedProfileDir() { return clean(process.env.BL_MANAGED_EDGE_PROFILE_DIR) || path.join(SERVER_DATA_ROOT, 'agent-browser', 'managed-edge'); }
function edgeUserDataDir() {
  return edgeUserDataDirCandidates()[0] || '';
}
// v5.88: tek bir klasöre bakmak yetmiyordu. Kullanıcının Edge'i Beta/Dev/Canary
// kanalında olabilir ya da kurumsal kurulumda profil başka yerde durabilir;
// o durumda DevToolsActivePort dosyası aranan yerde bulunamıyor ve remote
// debugging açık olmasına rağmen "bağlanmıyor" görünüyordu.
function edgeUserDataDirCandidates() {
  const explicit = clean(process.env.BL_EDGE_USER_DATA_DIR);
  // v9.56: portable'da GERÇEK klasör önce denenir (bkz. hostLocalAppData).
  // Yönlendirilmiş değer de listede kalır: normal kurulumda ikisi aynıdır ve
  // kullanıcı profilini gerçekten oraya taşımışsa yine bulunur.
  const local = hostLocalAppData();
  const redirected = clean(process.env.LOCALAPPDATA);
  const home = process.env.HOME || '';
  const list = [
    explicit,
    local && path.join(local, 'Microsoft', 'Edge', 'User Data'),
    local && path.join(local, 'Microsoft', 'Edge Beta', 'User Data'),
    local && path.join(local, 'Microsoft', 'Edge Dev', 'User Data'),
    local && path.join(local, 'Microsoft', 'Edge SxS', 'User Data'),
    redirected && path.join(redirected, 'Microsoft', 'Edge', 'User Data'),
    home && path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    home && path.join(home, '.config', 'microsoft-edge'),
  ].filter(Boolean);
  const seen = new Set(), out = [];
  for (const item of list) { const key = item.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(item); } }
  return out;
}
// Kullanıcı Edge'i elle --remote-debugging-port ile başlatmışsa DevToolsActivePort
// beklenen klasörde olmayabilir; yaygın portlar da ayrıca denenir.
const COMMON_CDP_PORTS = [9222, 9223];
function readDevToolsActivePort(userDataDir = edgeUserDataDir()) {
  const root = clean(userDataDir); if (!root) return null;
  try {
    const raw = fs.readFileSync(path.join(root, 'DevToolsActivePort'), 'utf8').split(/\r?\n/).map(clean).filter(Boolean);
    const port = Number(raw[0]);
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) return null;
    return { port, browserPath:raw[1] || '', userDataDir:root };
  } catch (_) { return null; }
}
function allowedHosts() { return browserSettings.loadSettings().allowedHosts || []; }
function validTargetUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:') return null;
    return url;
  } catch (_) { return null; }
}
function sanitizePowerBiUrl(value) {
  try {
    const url = new URL(clean(value));
    return `${url.origin}${url.pathname}`;
  } catch (_) { return ''; }
}
function isPowerBiSessionRedirectUrl(value) {
  const url = validTargetUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'app.powerbi.com' || host === 'powerbi.com' || host.endsWith('.powerbi.com')
    || host === 'login.microsoftonline.com' || host.endsWith('.microsoftonline.com')
    || host === 'login.microsoft.com' || host === 'login.live.com';
}
function isPowerBiDashboardUrl(value, targetValue) {
  const url = validTargetUrl(value), target = validTargetUrl(targetValue);
  if (!url || !target || !/\.powerbi\.com$/i.test(url.hostname) && url.hostname.toLowerCase() !== 'powerbi.com') return false;
  return url.pathname.replace(/\/+$/, '') === target.pathname.replace(/\/+$/, '');
}
function isPowerBiNavigationAbort(error) {
  return /ERR_ABORTED/i.test(clean(error && error.message || error));
}
function powerBiNavigationFailure(error, currentUrl = '') {
  const message = clean(error && error.message || error), lower = message.toLowerCase();
  if (/timeout|timed out|time ?out/i.test(lower)) {
    return Object.assign(connectorError('Power BI Dashboard yüklenmesi zaman aşımına uğradı.', 'POWERBI_NAVIGATION_TIMEOUT', 504, { currentUrl:sanitizePowerBiUrl(currentUrl) }), { timeoutType:'navigationTimeout', timeoutMs:BROWSER_OPERATION_TIMEOUTS.navigationTimeout });
  }
  if (/dns|err_name_not_resolved|err_internet_disconnected|err_connection_|err_address_unreachable|err_network_changed/i.test(lower)) {
    return Object.assign(connectorError('Power BI ağına erişilemedi. VPN veya kurumsal ağ bağlantısını kontrol edin.', 'POWERBI_NETWORK_ERROR', 502, { currentUrl:sanitizePowerBiUrl(currentUrl) }), { timeoutType:'networkTimeout', timeoutMs:BROWSER_OPERATION_TIMEOUTS.networkTimeout });
  }
  if (/err_aborted/i.test(lower)) {
    return connectorError('Power BI Dashboard yönlendirmesi tamamlanamadı.', 'POWERBI_NAVIGATION_ABORTED', 502, { currentUrl:sanitizePowerBiUrl(currentUrl) });
  }
  return connectorError(`Power BI İthalat Dashboard açılamadı: ${message.slice(0, 240)}`, 'POWERBI_DASHBOARD_OPEN_FAILED', 502, { currentUrl:sanitizePowerBiUrl(currentUrl) });
}
function powerBiDiagnostic(event, details = {}) {
  const safe = { ...details };
  if (safe.url) safe.url = sanitizePowerBiUrl(safe.url);
  if (safe.currentUrl) safe.currentUrl = sanitizePowerBiUrl(safe.currentUrl);
  if (safe.error) safe.error = clean(safe.error).replace(/https?:\/\/\S+/gi, '').slice(0, 240);
  try { console.info(`[POWERBI] ${event}`, safe); } catch (_) {}
}
function hostMatches(host, allowed) { return host === allowed || host.endsWith(`.${allowed}`); }
function assertAllowedUrl(value) {
  const url = validTargetUrl(value);
  if (!url) throw connectorError('Browser Automation yalnız geçerli HTTPS adreslerine gidebilir.', 'BROWSER_URL_INVALID');
  const hosts = allowedHosts();
  if (!hosts.length) throw connectorError('Browser Automation için izinli host tanımlanmamış. Agent > Browser Ayarları bölümünden allowlist oluşturun.', 'BROWSER_HOSTS_EMPTY', 403);
  const host = url.hostname.toLowerCase();
  if (!hosts.some(item => hostMatches(host, item))) throw connectorError(`${host} Browser Automation allowlist içinde değil.`, 'BROWSER_HOST_BLOCKED', 403, { host, allowedHosts: hosts });
  return url;
}
/* v5.88b: DevToolsActivePort dosyası port yazıyor ama HTTP cevap vermiyorsa
   nedenini bilmek gerekiyor. Üç ayrı durum çok farklı çözüm ister:
     · TCP bağlantı reddediliyor  → Edge o portu hiç dinlemiyor (dosya bayat).
     · TCP açık, HTTP başarısız    → DevTools sunucusu var ama isteği reddediyor
                                     (Host başlığı / izin onayı bekliyor).
     · HTTP 200 ama beklenmedik    → sürüm/uç nokta farkı.
   Ayrıca 127.0.0.1 ve localhost ayrı denenir: Chromium DNS yeniden bağlama
   koruması Host başlığına bakar ve ikisi farklı davranabilir. */
async function tcpOpen(port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    const done = value => { try { socket.destroy(); } catch (_) {} resolve(value); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try { socket.connect(port, '127.0.0.1'); } catch (_) { done(false); }
  });
}
/* v5.91: HTTP 200 almak yetmiyor — portta BAŞKA bir uygulama da oturuyor
   olabilir. 9222 yaygın bir geliştirme portu; başka bir araç orayı tutmuşsa
   DevToolsActivePort dosyası 9222 yazsa bile o adres DevTools DEĞİLDİR.
   Bu yüzden yanıtın gerçekten DevTools olduğu doğrulanır (webSocketDebuggerUrl
   ya da Browser alanı) ve doğrulanamazsa portu kimin tuttuğunu anlamaya yarayan
   ipuçları (durum kodu, Server başlığı, gövde başlangıcı) rapora eklenir. */
function looksLikeDevTools(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return typeof payload.webSocketDebuggerUrl === 'string' || typeof payload.Browser === 'string';
}
async function cdpProbe(port, timeoutMs = 900, options = {}) {
  if (!port) return { ok: false, reason: 'no-port' };
  const listening = await tcpOpen(port, Math.min(timeoutMs, 700));
  if (!listening) return { ok: false, reason: 'tcp-refused', listening: false };
  const attempts = [];
  let sawResponse = false, sawForeign = false;
  for (const host of ['127.0.0.1', 'localhost']) {
    /* v7.30 — 127.0.0.1 CEVAP VERDİYSE localhost bir daha denenmez.
       Edge 144+ remote debugging'e yaklaşan her dış istek için "Allow remote
       debugging?" onayı çıkarıyor. Bu döngü, ilk istek DevTools görünümlü bir
       yanıt vermediğinde — onay beklenirken tam olarak bu olur — ikinci kez
       sorup İKİNCİ bir diyalog daha açıyordu. Sunucu cevap verdiyse orada
       olduğu bellidir; ikinci host yalnız TAŞIMA hatasında (bağlantı reddi,
       zaman aşımı) denenir. */
    if (sawResponse) break;
    try {
      const requestController = new AbortController();
      const requestTimer = setTimeout(() => requestController.abort(), timeoutMs);
      const forwardAbort = () => requestController.abort(options.signal && options.signal.reason);
      if (options.signal) {
        if (options.signal.aborted) forwardAbort();
        else options.signal.addEventListener('abort', forwardAbort, { once:true });
      }
      let response;
      try {
        response = await fetch(`http://${host}:${port}/json/version`, { signal: requestController.signal });
      } finally {
        clearTimeout(requestTimer);
        options.signal?.removeEventListener('abort', forwardAbort);
      }
      sawResponse = true;
      const server = response.headers.get('server') || '';
      const text = (await response.text().catch(() => '')).slice(0, 200);
      let payload = null;
      try { payload = JSON.parse(text); } catch (_) { payload = null; }
      const isDevTools = response.ok && looksLikeDevTools(payload);
      attempts.push({ host, status: response.status, server, body: text.slice(0, 120), devtools: isDevTools });
      if (isDevTools) return { ok: true, reason: 'ok', listening: true, host, status: response.status, browser: payload.Browser || '', attempts };
      sawForeign = true;
    } catch (error) {
      attempts.push({ host, error: String(error && (error.cause && error.cause.code || error.message) || error).slice(0, 120), timeoutType:options.timeoutType || undefined });
    }
  }
  // Cevap veren ama DevTools olmayan bir sunucu, "izin bekliyor"dan farklı bir
  // sorundur: portu başka bir uygulama tutuyordur.
  return { ok: false, reason: sawResponse && sawForeign ? 'foreign-server' : 'http-refused', listening: true, sawResponse, attempts };
}
/* Edge, remote debugging'i edge://inspect kutucuğuyla açtığında /json/* HTTP
   uçlarını sunmayabiliyor; bu durumda tek giriş noktası DevToolsActivePort
   dosyasının İKİNCİ satırındaki tarayıcı WebSocket yoludur. Playwright bu ws
   adresine doğrudan bağlanabildiği için el sıkışmayı sınayıp adresi olduğu gibi
   kullanıyoruz. (v5.91) */
async function cdpWebSocketReady(port, browserPath, timeoutMs = 1200) {
  const suffix = clean(browserPath);
  if (!port || !suffix.startsWith('/')) return false;
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => { try { socket.destroy(); } catch (_) {} done(false); }, timeoutMs);
    socket.once('error', () => { clearTimeout(timer); done(false); });
    socket.once('connect', () => {
      socket.write(
        `GET ${suffix} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    socket.once('data', chunk => {
      clearTimeout(timer);
      const head = String(chunk).slice(0, 64);
      try { socket.destroy(); } catch (_) {}
      done(/^HTTP\/1\.1 101/i.test(head));
    });
  });
}
async function cdpReady(port, timeoutMs = 900) {
  return (await cdpProbe(port, timeoutMs)).ok;
}
async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = address && typeof address === 'object' ? address.port : 0; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
async function waitForCdp(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await cdpReady(port, 700)) return `http://127.0.0.1:${port}`; await sleep(180); }
  throw connectorError('Microsoft Edge yerel Browser Automation bağlantısı kurulamadı.', 'BROWSER_CDP_TIMEOUT', 503);
}
/* ===================================================================
   TEK ONAY (v7.30)

   Kullanıcı talebi: "1 kere Allow işlemi yapılsın."

   Edge 144+ remote debugging'e yaklaşan HER dış istek için ayrı bir onay
   diyaloğu açıyor ve bu diyaloglar üst üste biniyor. Chromium tarafında
   "beni hatırla" isteği "not planned" olarak kapatıldı; yani onayı tarayıcı
   tarafında kalıcılaştırmanın yolu yok. Yapılabilecek tek şey Buyer Log'un
   Edge'e KAÇ KERE yaklaştığını azaltmak.

   Eskiden tek bir bağlanma isteği şunları yapıyordu:
     1) /json/version → 127.0.0.1     (1. diyalog)
     2) /json/version → localhost     (2. diyalog)
     3) tarayıcı WebSocket'ine el sıkışma denemesi   (3. diyalog)
     4) Playwright'in gerçek connectOverCDP çağrısı  (4. diyalog)
   Üstelik status(), diagnose() ve her "Bağlantıyı kontrol et" tıklaması bu
   diziyi baştan çalıştırıyordu.

   Şimdi:
     · Adres bir kez bulunur ve ÖNBELLEĞE alınır.
     · Sonraki çağrılar yalnız ÇIPLAK TCP ile portun hâlâ dinlediğine bakar.
       TCP bağlantısı DevTools'a bir istek göndermez, dolayısıyla onay
       diyaloğu açtırmaz.
     · Aynı anda gelen çağrılar tek bir arama sözü paylaşır (single-flight);
       paralel denemeler artık diyalog yığmaz.
     · Bağlantı koptuğunda önbellek düşer ve bir sonraki sefer yeniden aranır.

   Sonuç: Edge'i her açtığınızda BİR kez Allow demeniz yeter. */
let endpointCache = null;
let discoveryInFlight = null;

function rememberEndpoint(connection) {
  if (connection && connection.port) endpointCache = { ...connection, rememberedAt: Date.now() };
  return connection;
}
function forgetEndpoint() { endpointCache = null; }
/* Önbellekteki adres hâlâ ayakta mı? Yalnız TCP el sıkışması yapılır: port
   dinlemiyorsa Edge kapanmış demektir. DevTools'a HİÇBİR istek gitmez. */
async function cachedEndpointIfAlive() {
  if (!endpointCache) return null;
  if (await tcpOpen(endpointCache.port, 500)) return endpointCache;
  forgetEndpoint();
  return null;
}

/* Başarısız aramadan sonraki kısa bekleme.

   Onay diyaloğu EKRANDA DURURKEN Edge isteği askıya alır ve arama başarısız
   sayılır. Bu bekleme olmadan her yeni iş yeniden yaklaşır; ekranda ikinci,
   üçüncü diyalog birikir — kullanıcının şikâyet ettiği tam olarak buydu.
   Süre bilerek kısa tutuldu: kullanıcı kutuyu işaretleyip Allow'a bastıktan
   sonraki denemesi beklemeye takılmaz. */
const DISCOVERY_COOLDOWN_MS = 4000;
let discoveryFailedAt = 0;
function discoveryCoolingDown() {
  return discoveryFailedAt > 0 && (Date.now() - discoveryFailedAt) < DISCOVERY_COOLDOWN_MS;
}
function resetDiscoveryCooldown() { discoveryFailedAt = 0; }

const USER_APPROVAL_MESSAGE = 'Tarayıcı onayı bekleniyor… Edge ekranındaki “Allow remote debugging for this browser instance” onayını verin.';

async function probeExistingEdgeWithApproval(port, operation) {
  if (!await tcpOpen(port, 700)) return { ok:false, reason:'tcp-refused', listening:false };
  operation?.enterWaitingForUser({ type:'browser', message:USER_APPROVAL_MESSAGE, timeoutType:'userApprovalTimeout' });
  const probe = await cdpProbe(port, BROWSER_OPERATION_TIMEOUTS.userApprovalTimeout, {
    signal:operation && operation.abortController.signal,
    timeoutType:'userApprovalTimeout',
  });
  if (operation?.state === STATES.FAILED && operation.error && operation.error.timeoutType === 'userApprovalTimeout') throw operation.error;
  operation?.resumeAfterUserApproval();
  return probe;
}

async function discoverExistingEdge(operation = null) {
  for (const dir of edgeUserDataDirCandidates()) {
    const active = readDevToolsActivePort(dir);
    if (!active) continue;
    const probe = operation ? await probeExistingEdgeWithApproval(active.port, operation) : await cdpProbe(active.port, 1200);
    if (probe.ok) {
      return rememberEndpoint({ endpoint:`http://${probe.host || '127.0.0.1'}:${active.port}`, port:active.port, managed:false, launched:false, profileMode:'existing-edge-profile', userDataDir:active.userDataDir, source:'devtools-active-port' });
    }
    // HTTP uçları kapalıysa doğrudan tarayıcı WebSocket adresine bağlanılır.
    // Kullanıcı onayı bekleyen istek zaten bitmediyse ikinci bir istek açılmaz.
    if ((!operation || probe.sawResponse) && await cdpWebSocketReady(active.port, active.browserPath, operation ? BROWSER_OPERATION_TIMEOUTS.userApprovalTimeout : 1400)) {
      return rememberEndpoint({ endpoint:`ws://127.0.0.1:${active.port}${active.browserPath}`, port:active.port, managed:false, launched:false, profileMode:'existing-edge-profile', userDataDir:active.userDataDir, source:'devtools-websocket' });
    }
  }
  for (const port of COMMON_CDP_PORTS) {
    const probe = operation ? await probeExistingEdgeWithApproval(port, operation) : await cdpProbe(port, 800);
    if (probe.ok) return rememberEndpoint({ endpoint:`http://${probe.host || '127.0.0.1'}:${port}`, port, managed:false, launched:false, profileMode:'existing-edge-profile', userDataDir:edgeUserDataDir(), source:'known-port' });
  }
  return null;
}

async function connectExistingEdge(operation = null) {
  // Discovery itself remains centralized in discoverExistingEdge(operation):
  // for (const dir of edgeUserDataDirCandidates()) and
  // for (const port of COMMON_CDP_PORTS) preserve the active-port and known-port
  // routes (source:'devtools-active-port' / source:'known-port').
  const alive = await cachedEndpointIfAlive();
  if (alive) return alive;
  if (discoveryInFlight) return discoveryInFlight;
  if (discoveryCoolingDown()) return null;
  discoveryInFlight = discoverExistingEdge(operation)
    .then(found => { discoveryFailedAt = found ? 0 : Date.now(); return found; })
    .finally(() => { discoveryInFlight = null; });
  return discoveryInFlight;
}

/* Bağlantı tanılaması (v5.88).
   "Remote debugging açık ama bağlanmıyor" durumunda nerede takıldığını tahmin
   etmek yerine adım adım raporlar: Edge bulundu mu, hangi profil klasörlerine
   bakıldı, DevToolsActivePort dosyası var mı, portta CDP cevap veriyor mu. */
async function diagnose() {
  const checks = [];
  const executable = edgePath();
  checks.push({ key:'edge', ok:Boolean(executable), detail:executable || 'Microsoft Edge bulunamadı.' });

  const dirs = [];
  for (const dir of edgeUserDataDirCandidates()) {
    let exists = false;
    try { exists = fs.existsSync(dir); } catch (_) { exists = false; }
    const active = exists ? readDevToolsActivePort(dir) : null;
    const reachable = active ? await cdpReady(active.port, 900) : false;
    let writtenAt = null;
    if (active) { try { writtenAt = fs.statSync(path.join(dir, 'DevToolsActivePort')).mtime.toISOString(); } catch (_) { writtenAt = null; } }
    dirs.push({ dir, exists, port:active ? active.port : null, reachable, writtenAt });
  }
  const withFile = dirs.find(item => item.port != null);
  checks.push({
    key:'profile',
    ok:Boolean(withFile),
    detail: withFile
      ? `${withFile.dir} · DevToolsActivePort = ${withFile.port}${withFile.writtenAt ? ` (yazılma: ${withFile.writtenAt})` : ''}`
      : 'Hiçbir Edge profil klasöründe DevToolsActivePort dosyası yok. Edge açıkken remote debugging etkinleştirildiyse Edge’i tamamen kapatıp yeniden açın.',
    candidates: dirs,
  });

  const ports = [];
  for (const port of [...new Set([...dirs.map(item => item.port).filter(Boolean), ...COMMON_CDP_PORTS])]) {
    ports.push({ port, ...(await cdpProbe(port, 1200)) });
  }
  const reachable = ports.find(item => item.ok);
  const listening = ports.find(item => item.listening);
  let cdpDetail;
  if (reachable) cdpDetail = `${reachable.host}:${reachable.port} cevap veriyor.`;
  else if (listening && listening.reason === 'foreign-server') {
    const first = (listening.attempts || []).find(item => item.status != null) || {};
    cdpDetail = `Port ${listening.port} AÇIK ve cevap veriyor ama oradaki sunucu DevTools DEĞİL (HTTP ${first.status}${first.server ? ` · ${first.server}` : ''}${first.body ? ` · “${first.body.replace(/\s+/g, ' ').slice(0, 60)}”` : ''}). Portu başka bir uygulama tutuyor. Komut isteminde “netstat -ano | findstr :${listening.port}” ile hangi süreç olduğunu bulup kapatın ya da Edge’i başka bir hata ayıklama portuyla açın.`;
  }
  else if (listening) cdpDetail = `Port ${listening.port} AÇIK ama DevTools isteği reddediyor (${(listening.attempts || []).map(item => `${item.host}: ${item.error || item.status}`).join(' · ') || 'yanıt yok'}). Edge ekranında “Uzaktan hata ayıklamaya izin ver / Allow” penceresi çıktıysa onaylayın.`;
  else cdpDetail = `Hiçbir port dinlenmiyor. DevToolsActivePort dosyası ${withFile ? `${withFile.port} yazıyor ama o port kapalı — dosya büyük olasılıkla önceki bir oturumdan kalma` : 'yok'}. Edge’i tamamen kapatıp (görev yöneticisinde msedge.exe kalmasın) yeniden açın.`;
  checks.push({ key:'cdp', ok:Boolean(reachable), detail:cdpDetail, ports });

  // HTTP kapalıysa WebSocket yolu ayrıca denenir ve raporlanır.
  if (!reachable && withFile) {
    const wsOk = await cdpWebSocketReady(withFile.port, (readDevToolsActivePort(withFile.dir) || {}).browserPath, 1400);
    if (wsOk) checks.push({ key:'websocket', ok:true, detail:'Tarayıcı WebSocket adresi cevap veriyor; bağlantı bu yoldan kurulabilir.' });
  }
  /* Bu adım BİLEREK gerçek bağlanma denemesi yapar: "Neden bağlanmıyor?"
     düğmesi zaten bir şey bozukken tıklanır ve tanı için Edge'in ne cevap
     verdiğini görmek gerekir. Sağlıklı bir kurulumda adres önbellekte
     olduğundan burada yeni bir onay diyaloğu açılmaz. */
  const connection = await connectExistingEdge().catch(() => null);
  checks.push({ key:'connection', ok:Boolean(connection), detail: connection ? `Bağlandı (${connection.source}) · port ${connection.port}` : 'Bağlantı kurulamadı.' });
  return { ok:Boolean(connection), checks };
}
// Ayrı otomasyon profili kurumsal SSO oturumunu kullanıcının normal Edge
// profilinden ayırdığı için artık hiçbir koşulda etkinleştirilmez. Export,
// yalnız eski ayar ekranlarıyla geriye dönük uyumluluk içindir.
function managedFallbackEnabled() { return false; }
/* v9.48 — Buyer Log'un kendi adresi TEK yerden okunur.
   Burada eskiden uygulamanın adresi sabit yazılıydı; port yapılandırmadan
   değiştirilince bu satır eski porta bağlanmaya çalışıyor, Edge boş bir sekmede
   kalıyordu. Adres artık çalışan yapılandırmadan gelir. */
function localAppUrl() {
  try {
    const { loadRuntimeConfig, DEFAULT_CONFIG } = require('./runtime-config');
    const configFile = require('path').join(__dirname, '..', '..', 'config.json');
    const config = (loadRuntimeConfig(configFile) || {}).config || DEFAULT_CONFIG;
    const host = String(config.host || '127.0.0.1').trim() || '127.0.0.1';
    const displayHost = host === '127.0.0.1' || host === '0.0.0.0' ? 'localhost' : host;
    return `http://${displayHost}:${Number(config.port) || 6194}`;
  } catch (_) {
    return 'http://localhost:6194';
  }
}

/* =====================================================================
   DOĞRULANMIŞ BAĞLAMA TEK YETKİLİ KAYNAKTIR (v11.12)

   "Browser ve Remote Debugging" etkinleştirildiğinde tarayıcıyı hangi
   profille, hangi portla ve hangi uç noktayla kullanacağımıza ORASI karar
   verir. Eskiden bu hazırlık başarısız olduğunda akış sessizce eski keşfe
   düşüyordu: discoverExistingEdge() bütün Edge kullanıcı klasörlerini ve
   9222/9223 portlarını tarayıp CEVAP VEREN İLK uç noktayı devralıyordu.

   Ölçülen sonuç: ikinci bir Edge profili (başka birinin CoreNectum oturumu)
   açıkken PLM Sync o profile bağlanabiliyor, kullanıcı ise Ayarlar ekranında
   kendi profilini seçili görüyordu. Seçili profil ile GERÇEKTE kullanılan
   profil ayrışıyordu.

   Artık düşüş yok: bağlama hazır değilse ne yapılacağı söylenir. Eski keşif
   yolu yalnız bu özelliği hiç etkinleştirmemiş kurulumlar için durur.
   ===================================================================== */
function managedBindingMessage(status) {
  const state = clean(status && status.connectionState) || 'ERROR';
  const profile = clean(status && status.strategy && status.strategy.selectedProfileDirectory);
  const conflictPort = status && status.portConflict && status.portConflict.port;
  const messages = {
    DISABLED: 'Buyer Log tarayıcı bağlantısı kapalı. Ayarlar > Browser ve Remote Debugging bölümünden “Enable & Launch” ile bağlantıyı kurun.',
    PROFILE_REQUIRED: 'Bu bilgisayarda birden fazla tarayıcı profili var. Ayarlar > Browser ve Remote Debugging bölümünden hangi profilin kullanılacağını seçin; Buyer Log sizin adınıza tahmin etmez.',
    PROFILE_NOT_FOUND: 'Ayarlarda seçili tarayıcı profili (' + (profile || 'seçili profil') + ') bu bilgisayarda bulunamadı. Buyer Log başka bir profile geçmez: Ayarlar > Browser ve Remote Debugging bölümünden profili yeniden seçin.',
    REMOTE_DEBUG_DISABLED: 'Seçili profil için Remote Debugging açık değil. Ayarlar > Browser ve Remote Debugging bölümünden “Enable & Launch” ile tarayıcıyı hazırlayın.',
    PORT_CONFLICT: 'Remote Debugging portunu (' + (conflictPort || 'seçili port') + ') başka bir tarayıcı süreci tutuyor. Buyer Log yabancı bir orunuma bağlanmaz: Ayarlar > Browser ve Remote Debugging bölümünden “Tarayıcıyı yeniden başlat” ile seçili profili yeniden hazırlayın.',
    ENDPOINT_UNVERIFIED: 'Bulunan Remote Debugging uç noktasının seçili profile ait olduğu doğrulanamadı. Ayarlar > Browser ve Remote Debugging bölümünden bağlantıyı yeniden kurun.',
    CONTEXT_MISMATCH: 'Bağlanılan tarayıcı bağlamı seçili profille eşleşmiyor. Ayarlar > Browser ve Remote Debugging bölümünden “Tarayıcıyı yeniden başlat” ile seçili profili yeniden hazırlayın.',
  };
  return messages[state] || 'Buyer Log tarayıcı bağlantısı hazır değil. Ayarlar > Browser ve Remote Debugging bölümünden bağlantıyı kurup “Test Connection” ile doğrulayın.';
}
async function connectPreferredEdge(initialUrl, operation = null) {
  // Settings > Browser & Remote Debugging owns the effective browser once the
  // user has enabled it, and it stays the only source of truth: an unprepared
  // binding fails loudly instead of falling back to arbitrary discovery.
  const manager = browserDebugManager();
  if (manager && manager.loadConfiguration().enabled) {
    const managed = await manager.ensureEndpoint();
    if (managed) return managed;
    const status = await manager.getRuntimeStatus().catch(() => null);
    throw connectorError(managedBindingMessage(status), 'BROWSER_BINDING_NOT_READY', 409, {
      connectionState: clean(status && status.connectionState) || 'ERROR',
      browser: clean(status && status.resolved && status.resolved.resolvedBrowser) || undefined,
      profileDirectory: clean(status && status.strategy && status.strategy.profileDirectory) || undefined,
      portConflict: (status && status.portConflict) || undefined,
      requiresBrowserSetup: true,
    });
  }
  const existing = await connectExistingEdge(operation);
  if (existing) { manager?.publishActiveEndpoint(existing); return existing; }
  /* Chromium 136+ VARSAYILAN kullanıcı veri klasöründe remote debugging'i
     kapatır (port açılır ama /json uçları 404 döner, WebSocket el sıkışmaz).
     Eski "mevcut Edge oturumuna bağlan" yolu bu makinede ASLA başaramaz;
     kullanıcıyı "bağlanamadı → tekrar dene" döngüsünde bırakmak yerine ne
     yapması gerektiği söylenir. */
  const resolvedBrowser = (() => { try { return manager?.resolveEffectiveBrowser?.(); } catch (_) { return null; } })();
  if (resolvedBrowser && resolvedBrowser.defaultProfileDebuggingBlocked) {
    const name = resolvedBrowser.resolvedBrowser === 'chrome' ? 'Chrome' : 'Edge';
    throw connectorError(
      `${name} ${resolvedBrowser.majorVersion} sürümü, kullanıcının gerçek profilinde Remote Debugging'i güvenlik gereği kapatıyor; Buyer Log o profile bağlanamaz. Ayarlar → Browser ve Remote Debugging bölümünden “Enable & Launch” ile Buyer Log'un kendi tarayıcı profilini başlatın ve açılan pencerede CoreNectum'a bir kez giriş yapın.`,
      'BROWSER_DEFAULT_PROFILE_DEBUG_BLOCKED', 409,
      { browser: resolvedBrowser.resolvedBrowser, majorVersion: resolvedBrowser.majorVersion, requiresManagedProfile: true });
  }
  if (!edgePath()) throw connectorError('Microsoft Edge bulunamadı.', 'EDGE_NOT_FOUND', 503);
  if (!edgeProcessRunning()) throw connectorError('Microsoft Edge açık değil.', 'EDGE_NOT_RUNNING', 409);
  throw connectorError('Buyer Log mevcut Edge oturumuna henüz bağlanamadı.', 'BROWSER_INTEGRATION_NOT_READY', 409, { userDataDir:edgeUserDataDir(), requiresRemoteDebugging:true });
}
function openExistingEdgeDebugSetup() {
  const executable=edgePath();
  if(!executable) throw connectorError('Microsoft Edge bulunamadı.', 'EDGE_NOT_FOUND', 503);
  // v5.88: eskiden #devices açılıyordu ve kullanıcıdan soldaki "Remote debugging"
  // bölümüne kendisinin geçmesi bekleniyordu; birçok kullanıcı seçeneği
  // bulamadı. Doğrudan ilgili sayfa açılır.
  const setupUrl='edge://inspect/#remote-debugging';
  try { const child=spawn(executable, [setupUrl], { detached:true, stdio:'ignore', windowsHide:true }); child.unref(); }
  catch(error){ throw connectorError(`Microsoft Edge bağlantı ayarı açılamadı: ${error.message}`, 'EDGE_DEBUG_SETUP_OPEN_FAILED', 503); }
  return { ok:true, url:setupUrl, userDataDir:edgeUserDataDir(), instructions:[
    'Açılan Edge sayfasında “Allow remote debugging for this browser instance” kutusunu işaretleyin.',
    'Kutu görünmüyorsa adres çubuğuna edge://inspect/#remote-debugging yazıp Enter’a basın.',
    'Sayfada hâlâ yoksa Edge sürümünüz bu seçeneği desteklemiyordur: Ayarlar > Microsoft Edge hakkında ile güncelleyip Edge’i yeniden başlatın.',
    'Buyer Log’a dönüp Bağlantıyı kontrol et düğmesine basın.'
  ] };
}
async function connectManagedEdge(initialUrl) { return connectPreferredEdge(initialUrl); }

function normalizeTarget(target) {
  const strategy = clean(target && target.strategy).toLowerCase();
  const selector = clean(target && target.selector).slice(0, 1200);
  if (!selector || !['css','text','label','placeholder','role'].includes(strategy)) return null;
  return { strategy, selector, role:clean(target && target.role).slice(0, 80), name:clean(target && target.name).slice(0, 320) };
}
function normalizeStep(step, index = 0) {
  const allowedActions = new Set(['goto','click','dblclick','fill','select','press','check','uncheck','wait','assert','assert_text','script']);
  const action = clean(step && step.action).toLowerCase();
  if (!allowedActions.has(action)) throw connectorError(`Desteklenmeyen Browser Automation adımı: ${action || '(boş)'}`, 'BROWSER_STEP_INVALID');
  const targets = (Array.isArray(step && step.targets) ? step.targets : []).map(normalizeTarget).filter(Boolean).slice(0, 8);
  const primary = normalizeTarget(step) || targets[0] || null;
  if (primary && !targets.some(item => item.strategy === primary.strategy && item.selector === primary.selector && item.role === primary.role)) targets.unshift(primary);
  const out = {
    id: clean(step && step.id) || `step_${index + 1}`,
    action,
    strategy: primary && primary.strategy || '', selector: primary && primary.selector || '', role: primary && primary.role || '', name: primary && primary.name || '', targets: targets.slice(0, 8),
    value: action === 'script'
      ? String(step && step.value == null ? '' : step.value).slice(0, 120000)
      : (['fill','select','press','assert','assert_text'].includes(action) ? clean(step && step.value).slice(0, 4000) : ''),
    url: action === 'goto' ? clean(step && step.url).slice(0, 4000) : '',
    frameUrl: clean(step && step.frameUrl).slice(0, 4000),
    waitMs: Math.max(0, Math.min(30000, Number(step && step.waitMs) || 0)),
    description: clean(step && step.description).slice(0, 600),
  };
  if (!['goto','wait','assert_text','script'].includes(action) && !out.targets.length) throw connectorError(`Browser adımı için hedef öğe eksik: ${out.id}`, 'BROWSER_TARGET_REQUIRED');
  if (action === 'script' && !out.value.trim()) throw connectorError('Terminal kodu boş olamaz.', 'BROWSER_SCRIPT_REQUIRED');
  return out;
}
function publicStep(step) { const normalized = normalizeStep(step); return normalized; }
function secretField(payload) {
  const source = [payload && payload.fieldType, payload && payload.name, payload && payload.selector, payload && payload.description].map(clean).join(' ').toLowerCase();
  return /password|passwd|parola|şifre|sifre|secret|token|one.?time|otp|cvv|cvc|pin\b/.test(source);
}
function appendRecordedStep(recorder, payload, capturedAt = Date.now()) {
  const step = payload && typeof payload === 'object' ? payload : null;
  if (!recorder || recorder.stopped || !step || !step.action || secretField(step)) return false;
  const action = clean(step.action).toLowerCase();
  if (!['click','dblclick','fill','select','press','check','uncheck'].includes(action)) return false;
  const targets = (Array.isArray(step.targets) ? step.targets : []).map(normalizeTarget).filter(Boolean).slice(0, 8);
  const primary = normalizeTarget(step) || targets[0]; if (!primary) return false;
  if (!targets.some(item => item.strategy === primary.strategy && item.selector === primary.selector && item.role === primary.role)) targets.unshift(primary);
  const targetKey = targets.map(item => `${item.strategy}:${item.role}:${item.selector}`).join('||');
  const fingerprint = `${action}|${targetKey}`;
  const capturedValue = ['fill','select','press'].includes(action) ? clean(step.value).slice(0, 4000) : '';
  if (action === 'dblclick') {
    let removed = 0;
    while (recorder.steps.length && removed < 2) {
      const candidate = recorder.steps[recorder.steps.length - 1];
      if (candidate.action !== 'click' || candidate.targetKey !== targetKey || capturedAt - candidate.capturedAt > 1400) break;
      recorder.steps.pop(); removed += 1;
    }
  }
  const last = recorder.steps[recorder.steps.length - 1];
  if (last && last.fingerprint === fingerprint && ['fill','select','check','uncheck'].includes(action)) {
    last.value = capturedValue; last.description = clean(step.description).slice(0, 600) || last.description; last.targets = targets; last.frameUrl = clean(step.frameUrl).slice(0,4000) || last.frameUrl || ''; last.capturedAt = capturedAt; recorder.updatedAt = new Date(capturedAt).toISOString(); return true;
  }
  recorder.steps.push({
    id:`step_${recorder.steps.length + 1}`, action, strategy:primary.strategy, selector:primary.selector, role:primary.role, name:primary.name,
    targets, value:capturedValue, url:'', frameUrl:clean(step.frameUrl).slice(0,4000), waitMs:0, description:clean(step.description).slice(0, 600), fingerprint, targetKey, capturedAt,
  });
  if (recorder.steps.length > 250) recorder.steps.splice(1, recorder.steps.length - 250);
  recorder.updatedAt = new Date(capturedAt).toISOString(); return true;
}

function recorderInstaller() {
  if (window.__buyerLogBrowserRecorderV3) return;
  window.__buyerLogBrowserRecorderV3 = true;
  const cleanText = value => String(value == null ? '' : value).replace(/\s+/g,' ').trim();
  const text = el => cleanText(el && ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || el.innerText || el.textContent || el.value || '')).slice(0,240);
  const cssEscape = value => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g,ch=>`\\${ch}`);
  const cssValue = value => String(value == null ? '' : value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const stableAttrs = ['data-testid','data-test','data-qa','data-cy','data-id','name'];
  const editableSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"]';
  const editable = el => el && el.closest ? el.closest(editableSelector) : null;
  const path = event => { const raw=event&&typeof event.composedPath==='function'?event.composedPath():[event&&event.target]; return raw.filter(node=>node&&node.nodeType===1); };
  const inputKind = el => String(el && (el.type || el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
  const fieldValue = el => el && el.tagName==='SELECT' ? String(el.options&&el.selectedIndex>=0?el.options[el.selectedIndex].text:el.value||'') : el && el.isContentEditable ? cleanText(el.innerText||el.textContent||'') : String(el && el.value == null ? '' : el.value);
  const sensitive = el => { const raw=[inputKind(el),el&&el.name,el&&el.id,el&&el.getAttribute&&el.getAttribute('autocomplete'),el&&el.getAttribute&&el.getAttribute('aria-label'),el&&el.placeholder].map(cleanText).join(' ').toLowerCase(); return /password|passwd|parola|şifre|sifre|secret|token|one.?time|otp|cvv|cvc|pin\b/.test(raw); };
  const roleOf = el => { const explicit=String(el&&el.getAttribute&&el.getAttribute('role')||'').toLowerCase(); if(explicit)return explicit; if(el&&el.matches&&el.matches('button,input[type="button"],input[type="submit"]'))return'button'; if(el&&el.matches&&el.matches('a[href]'))return'link'; if(el&&el.matches&&el.matches('input[type="checkbox"]'))return'checkbox'; if(el&&el.matches&&el.matches('input[type="radio"]'))return'radio'; if(el&&el.matches&&el.matches('input[type="search"]'))return'searchbox'; if(el&&el.matches&&el.matches('input,textarea,[contenteditable]:not([contenteditable="false"])'))return'textbox'; return''; };
  const uniquePush=(arr,item)=>{if(!item||!item.selector)return;if(!arr.some(x=>x.strategy===item.strategy&&x.selector===item.selector&&x.role===item.role))arr.push(item);};
  const cssPath = el => { const parts=[]; let node=el; while(node&&node.nodeType===1&&node!==document.body&&parts.length<7){let part=node.tagName.toLowerCase(); const stable=stableAttrs.map(attr=>[attr,node.getAttribute&&node.getAttribute(attr)]).find(([,v])=>v); if(stable){part+=`[${stable[0]}="${cssValue(stable[1])}"]`;parts.unshift(part);break;} if(node.id){parts.unshift(`#${cssEscape(node.id)}`);break;} const siblings=node.parentElement?[...node.parentElement.children].filter(item=>item.tagName===node.tagName):[]; if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(node)+1})`;parts.unshift(part);node=node.parentElement;} return parts.join(' > ')||String(el&&el.tagName||'').toLowerCase(); };
  const descriptor = el => {
    const targets=[], label=text(el), role=roleOf(el);
    for(const attr of stableAttrs){const value=el&&el.getAttribute&&el.getAttribute(attr);if(value)uniquePush(targets,{strategy:'css',selector:`[${attr}="${cssValue(value)}"]`,role:'',name:label});}
    if(el&&el.id)uniquePush(targets,{strategy:'css',selector:`#${cssEscape(el.id)}`,role:'',name:label});
    if(el&&el.getAttribute){const aria=el.getAttribute('aria-label');if(aria)uniquePush(targets,{strategy:'label',selector:aria,role:'',name:aria});}
    if(el&&el.placeholder)uniquePush(targets,{strategy:'placeholder',selector:String(el.placeholder),role:'',name:label});
    if(el&&el.labels&&el.labels[0]){const labelText=text(el.labels[0]);if(labelText)uniquePush(targets,{strategy:'label',selector:labelText,role:'',name:labelText});}
    if(role&&label)uniquePush(targets,{strategy:'role',selector:label,role,name:label});
    if(label&&label.length<=180)uniquePush(targets,{strategy:'text',selector:label,role,name:label});
    uniquePush(targets,{strategy:'css',selector:cssPath(el),role:'',name:label});
    const first=targets[0]||{strategy:'css',selector:cssPath(el),role:'',name:label}; return {...first,targets:targets.slice(0,8)};
  };
  const frameMeta = () => { let topFrame=false; try{topFrame=window===window.top;}catch(_){} return {frameUrl:String(location.href||'').slice(0,4000),frameTop:topFrame}; };
  const send = payload => { try { if(typeof window.__buyerLogBrowserRecordStep==='function') window.__buyerLogBrowserRecordStep({...payload,...frameMeta()}).catch(()=>{}); } catch(_){} };
  const editableFromEvent=event=>path(event).map(node=>editable(node)).find(Boolean)||editable(event&&event.target);
  const clickable = event => {
    const elements=path(event), first=elements[0]; if(!first)return null;
    // v5.56: editable fields are real user actions too. Recording their click/focus
    // makes playback deterministic on enterprise search widgets that require an
    // explicit focus before typing.
    const field=editable(first); if(field)return field;
    const semantic='button,a,summary,label,[role="button"],[role="link"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="tab"],[role="treeitem"],[role="switch"],[onclick],[tabindex]';
    for(const el of elements){if(!el.matches)continue;if(el.matches(semantic))return el;try{if(getComputedStyle(el).cursor==='pointer')return el;}catch(_){}}
    return !['BODY','HTML'].includes(first.tagName)?first:null;
  };
  let lastClickEl=null,lastClickAt=0,lastPointerClickEl=null,lastPointerClickAt=0,lastFocusedEl=null,lastFocusedValue='';
  const earlyClickable = el => {
    if(!el||!el.matches)return false;
    if(el.matches('button,input[type="button"],input[type="submit"],input[type="reset"],a[href],[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],[onclick]'))return true;
    try{return getComputedStyle(el).cursor==='pointer'&&!editable(el);}catch(_){return false;}
  };
  const sendField = (el,capture='field') => {
    if(!el||sensitive(el))return;const type=inputKind(el);if(type==='file'||type==='password')return;
    const d=descriptor(el), action=el.tagName==='SELECT'?'select':(['checkbox','radio'].includes(type)?(el.checked?'check':'uncheck'):'fill');
    send({action,...d,value:fieldValue(el),fieldType:type,description:d.name||text(el),capture});
  };
  // v5.59: Action buttons on enterprise SPAs can synchronously submit, rerender or
  // navigate before the normal click/pointerup recorder callback reaches the exposed
  // binding. Capture semantic action controls on pointerdown, before the site gets a
  // chance to replace the DOM. The later click/pointerup handlers suppress only that
  // same physical interaction; a second real click still produces a second step.
  document.addEventListener('pointerdown',event=>{
    if(event.button!=null&&event.button!==0)return;const el=clickable(event);if(!el||!earlyClickable(el))return;
    lastPointerClickEl=el;lastPointerClickAt=Date.now();lastClickEl=el;lastClickAt=lastPointerClickAt;
    send({action:'click',...descriptor(el),description:text(el),capture:'pointerdown-early'});
  },true);
  document.addEventListener('pointerup',event=>{
    if(event.button!=null&&event.button!==0)return; const el=clickable(event);if(!el)return; const stamp=Date.now();
    if(lastPointerClickEl===el&&stamp-lastPointerClickAt<1200)return;
    setTimeout(()=>{if(lastClickEl===el&&lastClickAt>=stamp&&lastClickAt-stamp<450)return;send({action:'click',...descriptor(el),description:text(el),capture:'pointer-fallback'});},220);
  },true);
  document.addEventListener('click',event=>{
    if(event.button!=null&&event.button!==0)return;const el=clickable(event);if(!el)return;const now=Date.now();
    if(lastPointerClickEl===el&&now-lastPointerClickAt<1200){lastClickEl=el;lastClickAt=now;return;}
    lastClickEl=el;lastClickAt=now;
    if(el.tagName==='LABEL'){const control=el.control||(el.htmlFor&&document.getElementById(el.htmlFor));if(control&&['checkbox','radio'].includes(inputKind(control)))return;}
    send({action:'click',...descriptor(el),description:text(el),capture:editable(el)?'editable-click':'click'});
  },true);
  // Some search widgets submit a form and tear down the button immediately. submit is
  // a final safety net, including keyboard-triggered form submission. If pointerdown
  // already captured the submitter this branch deliberately does nothing.
  document.addEventListener('submit',event=>{
    const el=event&&event.submitter; if(!el)return; const now=Date.now();
    if(lastPointerClickEl===el&&now-lastPointerClickAt<1500)return;
    if(lastClickEl===el&&now-lastClickAt<800)return;
    lastClickEl=el;lastClickAt=now;send({action:'click',...descriptor(el),description:text(el),capture:'submit-fallback'});
  },true);
  document.addEventListener('dblclick',event=>{if(event.button!=null&&event.button!==0)return;const el=clickable(event);if(el)send({action:'dblclick',...descriptor(el),description:text(el),capture:'dblclick'});},true);
  document.addEventListener('focusin',event=>{
    const el=editableFromEvent(event);if(!el||sensitive(el))return;lastFocusedEl=el;lastFocusedValue=fieldValue(el);
    // focusin happens before click in normal mouse interaction. Delay the fallback
    // briefly so a real click can win; keyboard/Tab focus still gets recorded.
    setTimeout(()=>{const now=Date.now();if(lastFocusedEl===el&&!(lastClickEl===el&&now-lastClickAt<500))send({action:'click',...descriptor(el),description:text(el),capture:'focus-fallback'});},90);
  },true);
  const captureField=event=>{const el=editableFromEvent(event);if(!el)return;sendField(el,event&&event.type||'field');lastFocusedEl=el;lastFocusedValue=fieldValue(el);};
  document.addEventListener('input',captureField,true);
  document.addEventListener('change',captureField,true);
  document.addEventListener('compositionend',captureField,true);
  document.addEventListener('focusout',captureField,true);
  // beforeinput/paste fire before some component libraries update their hidden
  // input value, so read it on the next task as a fallback.
  document.addEventListener('beforeinput',event=>{const el=editableFromEvent(event);if(el)setTimeout(()=>sendField(el,'beforeinput-fallback'),0);},true);
  document.addEventListener('paste',event=>{const el=editableFromEvent(event);if(el)setTimeout(()=>sendField(el,'paste-fallback'),0);},true);
  document.addEventListener('keyup',event=>{
    const el=editableFromEvent(event);if(!el||sensitive(el)||event.repeat)return;
    if(event.key.length===1||['Backspace','Delete','Space'].includes(event.key))sendField(el,'keyup-fallback');
  },true);
  document.addEventListener('keydown',event=>{const el=editableFromEvent(event);if(!el||sensitive(el)||event.repeat)return;if(!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(event.key))return;const d=descriptor(el);send({action:'press',...d,value:event.key,fieldType:inputKind(el),description:`${d.name||text(el)} · ${event.key}`,capture:'keydown'});},true);
  // Some enterprise controls swallow/synthesize DOM input events. While an
  // editable field has focus, observe its actual value and record any change.
  // This is intentionally limited to the focused element, so it does not record
  // unrelated programmatic page updates.
  setInterval(()=>{
    let el=lastFocusedEl;
    try{if(!el||!el.isConnected){el=editable(document.activeElement);lastFocusedEl=el||null;}}
    catch(_){el=null;}
    if(!el||sensitive(el))return;const value=fieldValue(el);if(value===lastFocusedValue)return;lastFocusedValue=value;sendField(el,'value-watchdog');
  },140);
}

function isBuyerLogPageUrl(value) {
  try {
    const url=new URL(clean(value));
    return /^https?:$/.test(url.protocol) && ['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase());
  } catch (_) { return false; }
}
async function pageForCurrentBuyerLogProfile(context, initialUrl='about:blank') {
  await context.syncPages().catch(()=>{});
  const buyerLogPage=context.pages().find(page=>isBuyerLogPageUrl(page.url()));
  if (buyerLogPage && typeof context.newPageFrom === 'function') {
    try { return await context.newPageFrom(buyerLogPage, clean(initialUrl) || 'about:blank'); } catch (_) {}
  }
  /* Buyer Log sekmesi yoksa (masaüstü/Electron sürümü) sekme VARSAYILAN
     profile düşmemeli: çok profilli bir makinede bu, başka birinin oturumunda
     çalışmak demektir. Açık sekmelerin tamamı tek profildeyse o profil
     kullanılır; bir CoreNectum sekmesi varsa onun profili kullanılır. */
  const pages=context.pages().filter(page=>!page.isClosed());
  const reference=pages.find(page=>coreNectumPageUrl(page.url()));
  if (reference && typeof context.newPageFrom === 'function') {
    try { return await context.newPageFrom(reference, clean(initialUrl) || 'about:blank'); } catch (_) {}
  }
  const contextIds=[...new Set(pages.map(page=>page.browserContextId||'').filter(Boolean))];
  if (contextIds.length === 1) {
    try { return await context.newPage(clean(initialUrl) || 'about:blank', { browserContextId: contextIds[0] }); } catch (_) {}
  }
  // Son çare: eski gömülü motorlarla uyumluluk.
  return context.newPage();
}

async function installRecorderOnPage(page) {
  if (!page || !page.client) return;
  const source=`(${recorderInstaller.toString()})()`;
  await page.client.send('Page.addScriptToEvaluateOnNewDocument',{source}).catch(()=>{});
  await page.evaluate(recorderInstaller).catch(()=>{});
}

/* v7.30 — kullanıcı başına TEK KURULUM (single-flight).
   Aynı anda iki iş (ör. PLM görsel toplama ile PASS yetkilendirmesi) bağlantı
   isterse her ikisi de kendi connectOverCDP çağrısını yapıyor ve Edge iki ayrı
   onay diyaloğu açıyordu. Artık ikinci istek, birincinin sözünü bekler. */
const contextSetupInFlight = new Map();
async function ensureContext(ownerId) {
  const key = safeOwner(ownerId), known = contexts.get(key);
  if (known && !known.closed) {
    await known.context.syncPages().catch(()=>{});
    // Profil topolojisi değişmiş olabilir; "hangi bağlam sonradan açıldı"
    // bilgisi her turda tazelenir (sabitlenmiş sahiplik bundan etkilenmez).
    await known.context.refreshBrowserContextIds?.().catch(()=>{});
    return known;
  }
  const pending = contextSetupInFlight.get(key);
  if (pending) return pending;
  const setup = createContext(key).finally(() => { contextSetupInFlight.delete(key); });
  contextSetupInFlight.set(key, setup);
  return setup;
}
/* PLM'de seçili satırları okuma gibi salt-mevcut-tarayıcı işleri için
   ayrı bağlantı yolu. Bu yol browserDebugManager.ensureEndpoint() veya
   connectPreferredEdge() çağırmaz; dolayısıyla Edge BAŞLATAMAZ. Yalnız zaten
   açık, remote-debugging/CDP erişimi bulunan oturuma bağlanır. */
const existingContextSetupInFlight = new Map();
async function ensureExistingContext(ownerId) {
  const key = safeOwner(ownerId), known = contexts.get(key);
  if (known && !known.closed) {
    await known.context.syncPages().catch(()=>{});
    await known.context.refreshBrowserContextIds?.().catch(()=>{});
    return known;
  }
  const pending = existingContextSetupInFlight.get(key);
  if (pending) return pending;
  const setup = createExistingContext(key).finally(() => { existingContextSetupInFlight.delete(key); });
  existingContextSetupInFlight.set(key, setup);
  return setup;
}
async function createExistingContext(key) {
  const operation = createBrowserOperation(key);
  let connected;
  try {
    connected = await connectExistingEdge(operation);
    if (!connected) throw connectorError(
      'Buyer Log yeni bir Edge penceresi açmadı ve açık bir Remote Debugging/CDP oturumu bulamadı. CoreNectum Style List sekmesini mevcut Edge oturumunuzda açık bırakın. Bu komut seçimleri yalnız mevcut sekmeden okuyabilir; yeni Edge başlatmaz.',
      'CORENECTUM_EXISTING_BROWSER_REQUIRED', 409,
      { existingOnly:true, requiresRemoteDebugging:true, launchesBrowser:false });
  } catch (error) {
    operation.fail(error);
    throw error;
  }
  let browser;
  try { browser = await portableWebEngine.connectOverCDP(connected.endpoint); }
  catch (error) { forgetEndpoint(); operation.fail(error); throw error; }
  const context = browser.contexts()[0];
  if (!context) {
    const error = connectorError('Açık Edge oturumunun Browser Automation context\'i okunamadı.', 'BROWSER_CONTEXT_MISSING', 503);
    operation.fail(error); throw error;
  }
  await context.refreshBrowserContextIds?.().catch(()=>{});
  const startupContextIds=[...new Set(context.pages().filter(page=>!page.isClosed()).map(page=>String(page.browserContextId||'')))];
  if(startupContextIds.length===1){
    pinProfileAffinity(context,{bound:true,hasContext:true,browserContextId:startupContextIds[0],source:'existing-connect-profile'});
  }
  const pinned=pinnedProfileAffinity(context);
  if(pinned)browserDebugManager()?.publishBoundContext?.({browserContextId:pinned.browserContextId,source:pinned.source,profileDirectory:clean(connected.profileDirectory)});
  const entry = { ownerId:key, browser, browserName:connected.browser || 'edge', context, endpoint:connected.endpoint, port:connected.port, managed:connected.managed, launched:false, profileMode:connected.profileMode||'existing-edge-profile', closed:false, existingOnly:true };
  browserDebugManager()?.publishActiveEndpoint({ ...connected, browser:connected.browser || 'edge', launched:false, webSocketDebuggerUrl:connected.webSocketDebuggerUrl });
  contexts.set(key, entry);
  const cleanup=()=>{entry.closed=true;clearProfileAffinity(context);browserDebugManager()?.publishBoundContext?.(null);if(contexts.get(key)===entry)contexts.delete(key);const session=powerBiSessionCache.get(key);if(session){session.closed=true;powerBiSessionCache.delete(key);}forgetEndpoint();};
  browser.on('disconnected',cleanup); context.on('close',cleanup);
  context.on('page',page=>{const rec=recorders.get(key);if(!rec||rec.stopped||!page)return;if(page.openerId&&rec.targetIds.has(page.openerId)){rec.targetIds.add(page.targetId);installRecorderOnPage(page).catch(()=>{});}});
  await context.exposeBinding('__buyerLogBrowserRecordStep',async(source,payload)=>{const rec=recorders.get(key);if(!rec||rec.stopped||!source||!source.page||!rec.targetIds.has(source.page.targetId))return;appendRecordedStep(rec,payload);});
  operation.complete({ endpoint:connected.endpoint, port:connected.port, existingOnly:true });
  return entry;
}

async function createContext(key) {
  const operation = createBrowserOperation(key);
  let connected;
  try {
    connected = await connectPreferredEdge(localAppUrl(), operation);
  } catch (error) {
    operation.fail(error);
    throw error;
  }
  let browser;
  try { browser = await portableWebEngine.connectOverCDP(connected.endpoint); }
  catch (error) {
    // Bayat adres: Edge kapanmış ya da port değişmiş olabilir. Önbellek
    // düşürülür ki bir sonraki deneme yeniden arasın.
    forgetEndpoint(); operation.fail(error);
    throw error;
  }
  const context = browser.contexts()[0];
  if (!context) {
    const error = connectorError('Edge Browser Automation context açılamadı.', 'BROWSER_CONTEXT_MISSING', 503);
    operation.fail(error);
    throw error;
  }
  await context.refreshBrowserContextIds?.().catch(()=>{});
  /* BAĞLANMA ANINDA SAHİPLİK SABİTLENİR.
   *
   * `Target.getBrowserContexts` yalnız CDP ile OLUŞTURULAN bağlamları
   * döndürür; kullanıcının profil değiştiriciyle açtığı ikinci Edge profili o
   * listede GÖRÜNMEZ (ölçüldü). Yani "ek olmayan tek kimlik" çıkarımı gerçek
   * topolojide her zaman işe yaramaz.
   *
   * Ama Buyer Log tarayıcıyı KENDİSİ başlatır ve ilk bağlanan taraftır: o an
   * açık olan tek profil, tanım gereği Buyer Log'un profilidir. Sahiplik
   * burada sabitlenir; sonradan açılan profiller — CoreNectum açsalar, öne
   * gelseler, daha yeni hedef üretseler bile — bunu değiştiremez. */
  const startupContextIds=[...new Set(context.pages().filter(page=>!page.isClosed()).map(page=>String(page.browserContextId||'')))];
  if(startupContextIds.length===1){
    pinProfileAffinity(context,{bound:true,hasContext:true,browserContextId:startupContextIds[0],source:'connect-time-profile'});
  }
  /* Sabitlenen bağlam kimliği doğrulanmış bağlamaya iliştirilir: "Test
     Connection" ve tanı ekranı artık yalnız portu değil, hangi tarayıcı
     bağlamına bağlı olduğumuzu da gösterebilir. Kimlik bir sır değildir. */
  const pinned=pinnedProfileAffinity(context);
  if(pinned)browserDebugManager()?.publishBoundContext?.({browserContextId:pinned.browserContextId,source:pinned.source,profileDirectory:clean(connected.profileDirectory)});
  const entry = { ownerId:key, browser, browserName:connected.browser || 'edge', context, endpoint:connected.endpoint, port:connected.port, managed:connected.managed, launched:connected.launched, profileMode:connected.profileMode||'existing-edge-profile', closed:false };
  browserDebugManager()?.publishActiveEndpoint({ ...connected, browser:connected.browser || 'edge', webSocketDebuggerUrl:connected.webSocketDebuggerUrl });
  contexts.set(key, entry);
  // v7.30: Edge kapanınca adres önbelleği de düşer; aksi hâlde yeni Edge
  // oturumunda ölü bir porta bağlanmaya çalışılırdı.
  const cleanup=()=>{entry.closed=true;clearProfileAffinity(context);browserDebugManager()?.publishBoundContext?.(null);if(contexts.get(key)===entry)contexts.delete(key);const session=powerBiSessionCache.get(key);if(session){session.closed=true;powerBiSessionCache.delete(key);}forgetEndpoint();}; browser.on('disconnected',cleanup); context.on('close',cleanup);
  context.on('page',page=>{const rec=recorders.get(key);if(!rec||rec.stopped||!page)return;if(page.openerId&&rec.targetIds.has(page.openerId)){rec.targetIds.add(page.targetId);installRecorderOnPage(page).catch(()=>{});}});
  await context.exposeBinding('__buyerLogBrowserRecordStep',async(source,payload)=>{const rec=recorders.get(key);if(!rec||rec.stopped||!source||!source.page||!rec.targetIds.has(source.page.targetId))return;appendRecordedStep(rec,payload);});
  operation.complete({ endpoint:connected.endpoint, port:connected.port });
  return entry;
}
function publicRecording(rec) {
  if (!rec) return null;
  return { id:rec.id, stopped:rec.stopped, url:rec.url, steps:rec.steps.map(({fingerprint,targetKey,capturedAt,...step})=>step), createdAt:rec.createdAt, updatedAt:rec.updatedAt };
}
async function openConnection(ownerId, urlValue) {
  const target = assertAllowedUrl(urlValue), connection = await ensureContext(ownerId), { context } = connection, page = await pageForCurrentBuyerLogProfile(context, target.href);
  if (page.url() !== target.href) await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:45000});
  return { connected:true,url:page.url(),title:await page.title().catch(()=>''),openMode:'same-window-new-tab',browser:connection.browserName || 'edge' };
}

// Power BI İthalat Dashboard bağlantısı: ekrandaki satırları okumaz; mevcut
// kurumsal Edge oturumunda raporun yaptığı semantic query/querydata isteğini
// bellekte yakalayıp aynı sorguyu sipariş kodu filtresiyle tekrarlar. Token,
// cookie ve Authorization başlıkları hiçbir zaman diske/loglara yazılmaz.
// Power BI şema toplama: rapor sayfasındaki TÜM görsellerin querydata
// yanıtları biriktirilir. Sessizlik penceresi, dashboard gerekli bir alanı
// hiç sunmuyorsa boşuna tam süre beklememek içindir.
const POWERBI_SCHEMA_TIMEOUT_MS = 60000;
const POWERBI_SCHEMA_QUIET_MS = 4000;
/* Bekleme kararı SAF bir fonksiyondur — asıl hata tam olarak buradaydı
   (ilk querydata yanıtı gelir gelmez "hazır" saymak), bu yüzden ayrı ayrı
   sınanabilir olması önemli.
     'wait'       → daha fazla görselin yanıtı beklenir
     'ready'      → Antrepo'nun ihtiyaç duyduğu tüm alanlar toplandı
     'incomplete' → akış durdu; dashboard bu alanları gerçekten sunmuyor,
                    doğrulama net bir "Eksik alanlar" hatası versin */
function powerBiSchemaWaitDecision(state) {
  const { templates = 0, orderTemplates = 0, schema = [], pendingReads = 0, msSinceGrowth = 0, quietMs = POWERBI_SCHEMA_QUIET_MS } = state || {};
  if (!templates || !schema.length) return 'wait';
  /* Şemanın tam olması TEK BAŞINA yetmez: Sipariş Kod'a göre filtreleyebileceğimiz
     bir sorgu şablonu da gerekir. "Şema tamam ama kullanılabilir şablon yok"
     durumu üretimde GERÇEKTEN yaşandı (tanılamada templates:4, schemaColumns:80
     ama hemen ardından "Sipariş Kod alanı bulunamadı"), o yüzden hazır olma
     koşulu ikisini birden arar. */
  const schemaReady = !dashboardSchemaMissingFields(schema, { sourceMode:'dashboard' }).missing.length;
  if (schemaReady && orderTemplates > 0) return 'ready';
  if (!pendingReads && msSinceGrowth > quietMs) return 'incomplete';
  return 'wait';
}

async function powerBiPageState(page) {
  const url = clean(page && typeof page.url === 'function' ? page.url() : '');
  const signals = await page._evaluateValue(`(()=>{const text=String(document.body&&document.body.innerText||'').replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');return {readyState:document.readyState,login:/sign in|oturum aç|giriş yap|pick an account|hesap seç/.test(text),accessDenied:/access denied|you don't have access|erişim izniniz yok|erişim reddedildi/.test(text),powerBi:/power bi|report|rapor/.test(text)};})()`).catch(() => ({}));
  return { url, login:Boolean(signals.login), accessDenied:Boolean(signals.accessDenied), powerBi:Boolean(signals.powerBi), readyState:signals.readyState || '' };
}
function dashboardTemplateScore(template) {
  const columns = Array.isArray(template && template.columns) ? template.columns : [];
  return DASHBOARD_FIELD_MAPPING.reduce((score, field) => {
    if (!field.required) return score;
    return score + (field.dashboardFields.some(alias => columns.some(column => {
      const left = clean(column).toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
      const right = clean(alias).toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
      return left === right || left.endsWith(`.${right}`);
    })) ? 1 : 0);
  }, 0);
}
async function navigatePowerBiDashboard(page, targetUrl) {
  powerBiDiagnostic('POWERBI_NAV_START', { url:targetUrl });
  try {
    await page.goto(targetUrl, { waitUntil:'domcontentloaded', timeout:60000 });
    const currentUrl = clean(page.url());
    if (currentUrl && currentUrl !== clean(targetUrl)) powerBiDiagnostic('POWERBI_REDIRECT', { from:targetUrl, to:currentUrl });
    return { recovered:false };
  } catch (error) {
    let currentUrl = clean(page.url());
    if (!isPowerBiNavigationAbort(error)) {
      powerBiDiagnostic('POWERBI_ERROR', { stage:'navigation', error:error && error.message, currentUrl });
      throw powerBiNavigationFailure(error, currentUrl);
    }
    await sleep(800);
    currentUrl = clean(page.url());
    const redirected = currentUrl !== clean(targetUrl), state = redirected ? null : await powerBiPageState(page);
    if (!isPowerBiSessionRedirectUrl(currentUrl) || (!redirected && !(state.powerBi && state.readyState === 'complete'))) {
      powerBiDiagnostic('POWERBI_ERROR', { stage:'navigation', error:error && error.message, currentUrl });
      throw powerBiNavigationFailure(error, currentUrl);
    }
    if (currentUrl !== clean(targetUrl)) powerBiDiagnostic('POWERBI_REDIRECT', { from:targetUrl, to:currentUrl });
    powerBiDiagnostic('POWERBI_NAV_ABORT_RECOVERED', { currentUrl });
    return { recovered:true };
  }
}
async function openPowerBiImportDashboardSession(ownerId) {
  const target = validTargetUrl(POWER_BI_IMPORT_DASHBOARD_URL);
  if (!target || target.hostname.toLowerCase() !== 'app.powerbi.com') {
    throw connectorError('Power BI İthalat Dashboard adresi güvenli değil.', 'POWERBI_DASHBOARD_URL_INVALID', 400);
  }
  const key = safeOwner(ownerId), cached = powerBiSessionCache.get(key);
  if (cached && !cached.closed && cached.page && !cached.page.isClosed() && isPowerBiDashboardUrl(cached.page.url(), target.href)) {
    powerBiDiagnostic('POWERBI_AUTH_OK', { reused:true, currentUrl:cached.page.url() });
    return cached.session;
  }
  if (cached) { cached.closed = true; powerBiSessionCache.delete(key); }
  const pending = powerBiSessionSetupInFlight.get(key);
  if (pending) return pending;
  const setup = (async () => {
    powerBiDiagnostic('POWERBI_BROWSER_START', { owner:key });
    const { context } = await ensureContext(ownerId);
    const page = await pageForCurrentBuyerLogProfile(context, target.href);
    const templates = [], responseIds = new Set(), tasks = new Set();
    let schema = [];
    // Sipariş Kod'a göre filtrelenebilen EN İYİ şablon; templates eskiyebilir, bu eskimez.
    let bestOrderTemplate = null;
    const addTemplate = (url, request, postData) => {
      try {
        const body = JSON.parse(postData);
        const columns = descriptorColumns(body);
        if (columns.length) schema = [...new Set([...schema, ...columns])];
        const template = { url, method:clean(request.method) || 'POST', headers:{ ...(request.headers || {}) }, body, columns };
        templates.push(template);
        /* EN İYİ ŞABLONU SABİTLE.
           templates dizisi 20'de bir en eskiyi atıyor (shift) ve oturum
           önbellekten yeniden kullanılıyor. Rapordaki "son güncellenme" kartı
           gibi kendini periyodik yenileyen görseller listeyi doldurdukça,
           Antrepo'nun ihtiyaç duyduğu BÜYÜK TABLO şablonu listeden düşüyordu.
           Sonuç: sorgu kartın şablonuyla atılıyor, yanıt 58 ara toplam satırı
           dönüyor ve hiçbir siparişe karşılık gelmiyordu (ölçüldü:
           manifestNotFound 7192, parseDataRows 0).
           Sipariş Kod'a göre filtrelenebilen ve en yüksek puanı alan şablon
           burada ayrıca saklanır; asla eskitilmez. */
        if (powerBiTemplateHasOrderField(body)) {
          const score = dashboardTemplateScore(template);
          if (!bestOrderTemplate || score > bestOrderTemplate.score) bestOrderTemplate = { template, score };
        }
        if (templates.length > 20) templates.shift();
      } catch (_) { /* JSON olmayan querydata isteği reusable şablon değildir. */ }
    };
    /* SAVUNMA AMAÇLI (ölçülen bir arızanın çözümü DEĞİL): CDP, çok büyük istek
       gövdelerini requestWillBeSent olayında taşımaz — postData yerine
       hasPostData:true gönderip gövdeyi ayrıca istemenizi bekler. Eski kod
       `!request.postData` görünce isteği sessizce eliyordu.

       Not: Bu raporun gerçek trafiği ölçüldüğünde en büyük querydata gövdesi
       ~24 KB'tı ve sorunsuz taşınıyordu; yani yaşanan "Sipariş Kod bulunamadı"
       hatasının sebebi bu DEĞİLDİ (o, powerBiQueryColumnNames'te açıklanıyor).
       Yine de daha büyük raporlarda gerçek bir boşluk olduğu için kapatıldı. */
    const requested = params => {
      const request = params && params.request || {}, url = clean(request.url);
      if (!/\/querydata(?:\?|$)/i.test(url)) return;
      if (request.postData) { addTemplate(url, request, request.postData); return; }
      if (!request.hasPostData || !params.requestId) return;
      let task;
      task = page.client.send('Network.getRequestPostData', { requestId:params.requestId }, 15000)
        .then(result => { const text = clean(result && result.postData); if (text) addTemplate(url, request, text); })
        .catch(() => { /* gövde artık alınamıyorsa bu şablon atlanır. */ })
        .finally(() => tasks.delete(task));
      tasks.add(task);
    };
    const response = params => {
      const item = params && params.response || {};
      if (/\/querydata(?:\?|$)/i.test(clean(item.url))) responseIds.add(params.requestId);
    };
    const finished = params => {
      if (!responseIds.has(params && params.requestId)) return;
      responseIds.delete(params.requestId);
      let task;
      task = page.client.send('Network.getResponseBody', { requestId:params.requestId }, 30000).then(result => {
        const text = result && result.base64Encoded ? Buffer.from(result.body || '', 'base64').toString('utf8') : String(result && result.body || '');
        try {
          const payload = JSON.parse(text), columns = descriptorColumns(payload);
          if (columns.length) schema = [...new Set([...schema, ...columns])];
        } catch (_) { /* sonraki semantic response denenir. */ }
      }).catch(() => {}).finally(() => tasks.delete(task));
      tasks.add(task);
    };
    const failed = params => responseIds.delete(params && params.requestId);
    const detach = () => {
      page.client.off('Network.requestWillBeSent', requested); page.client.off('Network.responseReceived', response);
      page.client.off('Network.loadingFinished', finished); page.client.off('Network.loadingFailed', failed);
    };
    page.client.on('Network.requestWillBeSent', requested);
    page.client.on('Network.responseReceived', response);
    page.client.on('Network.loadingFinished', finished);
    page.client.on('Network.loadingFailed', failed);
    await page.client.send('Network.enable', { maxPostDataSize: CDP_MAX_POST_DATA_SIZE }, 10000);
    try {
      await navigatePowerBiDashboard(page, target.href);
    } catch (error) {
      detach(); await page.close().catch(() => {}); throw error;
    }
    /* Power BI rapor sayfası HER GÖRSEL için ayrı bir querydata isteği atar ve
       her yanıt yalnız o görselin kolonlarını taşır; şema bu yanıtlardan
       BİRİKTİRİLEREK oluşur (yukarıdaki `schema = [...new Set([...schema,
       ...columns])]`).

       ESKİ HATA: döngü `!schema.length` koşuluyla, yani İLK yanıt gelir gelmez
       çıkıyordu. Şema tek bir görselin kolonlarından ibaret kalıyor ve Antrepo
       doğrulaması "Eksik alanlar: Sipariş Kod, Model Adı, ..." diye patlıyordu.
       Hangi görselin önce döndüğü ağ zamanlamasına bağlı olduğu için eksik
       alan listesi her çalıştırmada DEĞİŞİYORDU — kullanıcının gördüğü
       kararsız davranışın sebebi buydu.

       ŞİMDİ: Antrepo'nun ihtiyaç duyduğu alanların hepsi toplanana kadar
       beklenir. Dashboard o alanı gerçekten hiç sunmuyorsa yanıt akışı
       durduğunda (sessizlik penceresi) çıkılır ve doğrulama, artık GERÇEKTEN
       eksik olan alanları bildirir. */
    const deadline = Date.now() + POWERBI_SCHEMA_TIMEOUT_MS;
    let lastGrowthAt = Date.now(), lastSchemaSize = -1, lastTemplateCount = -1;
    const orderTemplateCount = () => templates.filter(item => {
      try { return powerBiTemplateHasOrderField(item.body); } catch (_) { return false; }
    }).length;
    while (Date.now() < deadline) {
      // Yeni kolon VEYA yeni şablon geldiyse sessizlik sayacı sıfırlanır.
      if (schema.length !== lastSchemaSize || templates.length !== lastTemplateCount) {
        lastSchemaSize = schema.length; lastTemplateCount = templates.length; lastGrowthAt = Date.now();
      }
      const decision = powerBiSchemaWaitDecision({
        templates: templates.length, orderTemplates: orderTemplateCount(), schema,
        pendingReads: tasks.size, msSinceGrowth: Date.now() - lastGrowthAt,
      });
      if (decision !== 'wait') break;
      await sleep(200);
    }
    // Uçuşta kalan getResponseBody okumaları şemayı hâlâ büyütebilir.
    await Promise.allSettled([...tasks]);
    const pageState = await powerBiPageState(page);
    if (!templates.length) {
      detach(); await page.close().catch(() => {});
      if (pageState.login || /microsoftonline|login\.microsoft|login\.live/i.test(pageState.url)) {
        powerBiDiagnostic('POWERBI_AUTH_REQUIRED', { currentUrl:pageState.url });
        throw connectorError('Power BI oturumunun yenilenmesi gerekiyor.', 'POWERBI_AUTH_REQUIRED', 409);
      }
      if (pageState.accessDenied) {
        powerBiDiagnostic('POWERBI_ERROR', { stage:'access-denied', currentUrl:pageState.url });
        throw connectorError('Power BI Dashboard erişim yetkiniz yok.', 'POWERBI_ACCESS_DENIED', 403);
      }
      powerBiDiagnostic('POWERBI_ERROR', { stage:'query-template', currentUrl:pageState.url });
      throw connectorError('Power BI Dashboard querydata isteği bulunamadı. Rapor yüklenmedi veya erişim yetkisi yok.', 'POWERBI_DASHBOARD_QUERY_TEMPLATE_MISSING', 409);
    }
    if (!schema.length) {
      detach(); await page.close().catch(() => {});
      powerBiDiagnostic('POWERBI_ERROR', { stage:'schema', currentUrl:pageState.url });
      throw connectorError('Power BI Dashboard yanıtında semantic model şeması bulunamadı.', 'POWERBI_DASHBOARD_SCHEMA_MISSING', 422);
    }
    const state = { key, page, templates, responseIds, tasks, schema, detach, closed:false, session:null };
    const session = {
      async getSchema() {
        if (state.closed || page.isClosed()) throw connectorError('Power BI oturumunun yenilenmesi gerekiyor.', 'POWERBI_AUTH_REQUIRED', 409);
        return state.schema.slice();
      },
      async queryBatch(orderCodes, options = {}) {
        if (options.signal && options.signal.aborted) throw connectorError('Dashboard yenilemesi kullanıcı tarafından durduruldu.', 'POWERBI_DASHBOARD_CANCELLED', 409);
        if (state.closed || page.isClosed()) throw connectorError('Power BI oturumunun yenilenmesi gerekiyor.', 'POWERBI_AUTH_REQUIRED', 409);
        let template = null, body = null, lastError = null;
        let bestScore = -1, bestIndex = -1;
        /* Sabitlenmiş en iyi şablon da adaylara katılır ve listenin SONUNA
           konur: eşit puanda "daha sonraki kazanır" kuralı sayesinde, aynı
           puanlı taze bir şablon varsa o tercih edilir; yoksa eskitilmiş olsa
           bile doğru şablon kaybolmaz. */
        const candidates = bestOrderTemplate ? [...templates, bestOrderTemplate.template] : templates;
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
          try {
            const candidateBody = buildPowerBiOrderQueryPayload(candidates[index].body, orderCodes);
            const score = dashboardTemplateScore(candidates[index]);
            if (score > bestScore || (score === bestScore && index > bestIndex)) {
              body = candidateBody; template = candidates[index]; bestScore = score; bestIndex = index;
            }
          } catch (error) { lastError = error; }
        }
        if (template) powerBiDiagnostic('POWERBI_QUERY_TEMPLATE', {
          score: bestScore, candidates: candidates.length,
          pinnedScore: bestOrderTemplate ? bestOrderTemplate.score : null,
          columns: (template.columns || []).length,
          sample: (template.columns || []).slice(0, 6).join(' | ').slice(0, 300),
        });
        if (!template) {
          /* Tahmin etmek yerine ÖLÇEBİLMEK için: şablonlarda gerçekte hangi
             Select adları geldiğini kaydet. Bu olmadan "Sipariş Kod bulunamadı"
             hatası, alanın adı mı farklı yoksa şablon mu hiç yakalanmamış,
             ayırt edilemiyordu. */
          powerBiDiagnostic('POWERBI_ERROR', {
            stage:'order-field', templates:templates.length,
            selectNames:String(JSON.stringify((lastError && lastError.details && lastError.details.selectNames) || [])).slice(0, 1200),
          });
          throw lastError || connectorError('Power BI querydata şablonunda Sipariş Kod alanı bulunamadı.', 'POWERBI_DASHBOARD_ORDER_FIELD_MISSING', 422);
        }
        const headers = Object.fromEntries(Object.entries(template.headers || {}).filter(([name]) => !/^cookie$/i.test(name)));
        const config = JSON.stringify({ url:template.url, method:template.method, headers, body });
        const value = await page._evaluateValue(`(async()=>{const cfg=${config},response=await fetch(cfg.url,{method:cfg.method||'POST',headers:cfg.headers,body:JSON.stringify(cfg.body),credentials:'include',cache:'no-store'});if(response.status===401||response.status===403)return {__powerBiAuthRequired:true,status:response.status};if(!response.ok)return {__powerBiHttpError:true,status:response.status};return response.json();})()`);
        /* HTTP hatası artık fırlatılmıyor, SINIFLANDIRILIYOR. 4xx (408/429
           hariç) kalıcıdır: aynı istek tekrar denense de, parti bölünse de
           aynı yanıtı verir. Bunu "geçici arıza" sanmak, 250'lik bir partiyi
           1'e kadar bölüp her siparişi ayrı ayrı denemeye yol açıyordu. */
        if (value && value.__powerBiHttpError) {
          const status = Number(value.status) || 0;
          const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
          throw connectorError(`Power BI querydata isteği reddedildi (HTTP ${status}).`,
            permanent ? 'POWERBI_DASHBOARD_QUERY_REJECTED' : 'POWERBI_DASHBOARD_QUERY_FAILED', status || 502);
        }
        if (value && value.__powerBiAuthRequired) {
          state.closed = true; state.detach(); await Promise.allSettled([...state.tasks]); await page.close().catch(() => {});
          if (powerBiSessionCache.get(key) === state) powerBiSessionCache.delete(key);
          powerBiDiagnostic('POWERBI_AUTH_REQUIRED', { status:value.status });
          throw connectorError('Power BI oturumunun yenilenmesi gerekiyor.', 'POWERBI_AUTH_REQUIRED', 409);
        }
        return value;
      },
      async release() { /* Refresh tamamlandı; authenticated page/query template cache korunur. */ },
      async close() { await this.release(); },
      async dispose() {
        if (state.closed) return;
        state.closed = true; state.detach(); await Promise.allSettled([...state.tasks]); await page.close().catch(() => {});
        if (powerBiSessionCache.get(key) === state) powerBiSessionCache.delete(key);
      },
    };
    state.session = session;
    page.on('close', () => { state.closed = true; if (powerBiSessionCache.get(key) === state) powerBiSessionCache.delete(key); });
    powerBiSessionCache.set(key, state);
    powerBiDiagnostic('POWERBI_AUTH_OK', { reused:false, currentUrl:page.url() });
    powerBiDiagnostic('POWERBI_DASHBOARD_READY', { currentUrl:page.url() });
    powerBiDiagnostic('POWERBI_QUERY_READY', { templates:templates.length, orderTemplates:orderTemplateCount(), pinnedScore:bestOrderTemplate ? bestOrderTemplate.score : null, schemaColumns:schema.length });
    return session;
  })();
  powerBiSessionSetupInFlight.set(key, setup);
  try { return await setup; } finally { if (powerBiSessionSetupInFlight.get(key) === setup) powerBiSessionSetupInFlight.delete(key); }
}

// CoreNectum'a özel, dar kapsamlı PLM bağlantı toplayıcısı. Kullanıcının açık
// Edge profilindeki mevcut oturumu kullanır; parola, çerez veya erişim anahtarı
// Buyer Log'a kopyalanmaz. Hedef adres sabittir ve keyfi URL kabul edilmez.
const CORENECTUM_STYLE_LIST_URL='https://corenectum.lcwaikiki.com/models-options/style-list';
function coreNectumId(value){
  let text=clean(value).replace(/^_+/,'').replace(/\.(?=\d{3}(?:\D|$))/g,'');
  if(/^\d+\.0+$/.test(text))text=text.slice(0,text.indexOf('.'));
  return /^\d+$/.test(text)&&Number(text)>0?String(Number(text)):'';
}
/* ===================================================================
   PLM TEKNİK FÖY (Technical Sheet Report) — TOPLU İNDİRME

   Gerçek akış, kullanıcının canlı CoreNectum oturumunda ağ trafiği
   dinlenerek ÖLÇÜLDÜ (tahmin edilmedi):

     POST .../api/ReportOperations/CreateTechnicalSheetReport
          {"styleId":2498260,"languageId":2}
     → 200, content-type: application/pdf, doğrudan PDF gövdesi
       content-disposition: attachment; filename=TechnicalSheetReport_2498260.pdf

   Asenkron bir rapor kuyruğu YOKTUR; istek senkron olarak PDF döndürür
   (ölçülen örnekte ~2.2 MB, ~7 sn).

   ÖLÇÜLEN EN ÖNEMLİ ŞEY: styleId, PLM Code'dan FARKLI bir sayıdır
   (PLM Code 2120176 → styleId 2498260). Bu yüzden bu fonksiyon styleId'yi
   ASLA türetmez/tahmin etmez; çağıran taraf PLM link deposundan çözüp
   vermek zorundadır. Yanlış bir styleId hata vermez — SESSİZCE BAŞKA BİR
   MODELİN PDF'ini getirir, ki bu en tehlikeli hata biçimidir.

   ESKİ SÜRÜMDEN FARK (neden yeniden yazıldı): eski kod her model için ayrı
   bir sayfa açıp, styleId yoksa TAM Style List taraması yapıyordu — N model
   için N tam tarama. Burada tek bir sayfa açılır ve tüm parti o sayfa
   üzerinde sırayla indirilir; hiç liste taraması yapılmaz.
   =================================================================== */
const CORENECTUM_TECHNICAL_SHEET_API='https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/ReportOperations/CreateTechnicalSheetReport';
// Rapor üretimi bazı modellerde uzun sürebilir (ölçülen örnek ~7 sn).
const CORENECTUM_TP_REQUEST_TIMEOUT_MS=60000;
/* Dil kodları. EN=2 canlı trafikten ÖLÇÜLDÜ. TR=1 kullanıcı tarafından
   bildirildi (ölçülmedi) — yanlışsa değiştirilecek tek yer burasıdır. */
const CORENECTUM_TECHNICAL_SHEET_LANGUAGES=Object.freeze({en:2,tr:1});
function coreNectumTechnicalSheetLanguageId(language){
  const key=clean(language).toLowerCase();
  return CORENECTUM_TECHNICAL_SHEET_LANGUAGES[key]||CORENECTUM_TECHNICAL_SHEET_LANGUAGES.en;
}
function coreNectumTechnicalSheetExpression(inputStyleId,language='en'){
  const styleId=coreNectumId(inputStyleId);
  if(!styleId)throw connectorError('Geçerli bir Style ID gerekli.','CORENECTUM_STYLE_ID_REQUIRED',400);
  const url=JSON.stringify(CORENECTUM_TECHNICAL_SHEET_API);
  const body=JSON.stringify({styleId:Number(styleId),languageId:coreNectumTechnicalSheetLanguageId(language)});
  return `(async()=>{try{const accessToken=String((typeof localStorage==='undefined'?null:localStorage.getItem('access_token'))||'').trim(),authorization=accessToken&&accessToken.toLowerCase().startsWith('bearer ')?accessToken:accessToken?'Bearer '+accessToken:'',headers={Accept:'application/pdf','Content-Type':'application/json'};if(authorization)headers.Authorization=authorization;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),${CORENECTUM_TP_REQUEST_TIMEOUT_MS}),response=await fetch(${url},{method:'POST',credentials:'include',cache:'no-store',signal:controller.signal,headers,body:${JSON.stringify(body)}});clearTimeout(timeout);const blob=await response.blob(),dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('pdf-read'));reader.readAsDataURL(blob);}),comma=dataUrl.indexOf(',');return {ok:response.ok,status:response.status,contentType:String(blob.type||response.headers.get('content-type')||''),base64:comma<0?'':dataUrl.slice(comma+1)};}catch(error){return {ok:false,status:0,contentType:'',base64:'',error:String(error&&error.message||error).slice(0,200)};}})()`;
}
function coreNectumPageUrl(value){
  try { const url=new URL(clean(value)); return url.protocol==='https:'&&url.hostname.toLowerCase()==='corenectum.lcwaikiki.com'; }
  catch(_) { return false; }
}
/* ===================================================================
   OTURUM YOKLAMASI — DEĞER DEĞİL, DURUM

   Sayfada access_token VAR MI, biçimi TANINIYOR MU, çerez VAR MI. Anahtarın
   kendisi Node'a ASLA dönmez; dönen tek şey boolean ve kısa bir biçim
   etiketidir. Amaç, "0 model bulundu" ile "bu bilgisayarda CoreNectum
   oturumu yok" durumlarını birbirinden ayırabilmektir.
   =================================================================== */
const CORENECTUM_AUTH_PROBE_EXPRESSION=`(()=>{try{const extract=value=>{const text=String(value==null?'':value).trim();if(!text)return '';if(text[0]==='{'){try{const parsed=JSON.parse(text),candidate=parsed&&((parsed.access_token)||(parsed.accessToken));if(typeof candidate==='string'&&candidate.trim())return candidate.trim();}catch(_){}}return text;},readStorage=storage=>{if(!storage)return '';for(const key of ['access_token','accessToken']){try{const value=extract(storage.getItem(key));if(value)return value;}catch(_){}}try{for(let i=0;i<storage.length;i+=1){const key=String(storage.key(i)||'');if(!/^oidc\.user:/i.test(key)&&!/(?:^|[._:-])access[_-]?token(?:$|[._:-])/i.test(key))continue;const raw=String(storage.getItem(key)||'').trim();if(!raw)continue;try{const parsed=JSON.parse(raw),candidate=parsed&&((parsed.access_token)||(parsed.accessToken));if(typeof candidate==='string'&&candidate.trim())return candidate.trim();}catch(_){if(!/^oidc\.user:/i.test(key)){const value=extract(raw);if(value)return value;}}}}catch(_){}return '';};let raw='';try{raw=readStorage(typeof localStorage==='undefined'?null:localStorage)||readStorage(typeof sessionStorage==='undefined'?null:sessionStorage);}catch(_){raw='';}const value=String(raw||'').trim(),body=value.toLowerCase().indexOf('bearer ')===0?value.slice(7).trim():value,jwt=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(body);let cookies=false;try{cookies=String(document.cookie||'').length>0;}catch(_){cookies=false;}return {present:body.length>0,format:body.length===0?'MISSING':(jwt?'JWT':'OPAQUE'),cookies,origin:String(location.origin||'')};}catch(_){return {present:false,format:'PROBE_FAILED',cookies:false,origin:''};}})()`;
async function coreNectumAuthState(page){
  const result=await page._evaluateValue(CORENECTUM_AUTH_PROBE_EXPRESSION).catch(()=>null);
  if(!result||typeof result!=='object')return {present:false,format:'PROBE_FAILED',cookies:false,origin:''};
  return {present:result.present===true,format:clean(result.format).slice(0,20)||'MISSING',cookies:result.cookies===true,origin:clean(result.origin).slice(0,120)};
}
/* CoreNectum sekmesinin açılacağı Edge PROFİLİ. Edge'de her profil ayrı bir
   browser context'tir ve Target.createTarget context verilmezse VARSAYILAN
   profile düşer. Masaüstü (Electron) sürümünde Buyer Log arayüzü Edge'de bir
   sekme olarak DURMADIĞI için eski "Buyer Log sekmesinden aç" yolu hiç
   çalışmıyor, sekme sessizce varsayılan profilde açılıyordu; çok profilli bir
   makinede bu, başka bir kişinin (veya hiç giriş yapılmamış) oturumu demek. */
/* ===================================================================
   PROFİL SAHİPLİĞİ (AFFINITY) — BİR KEZ SABİTLENİR, SONRA DEĞİŞMEZ

   Sorun tek bir yanlış seçim değil, seçimin HER ÇAĞRIDA yeniden
   türetilmesiydi: ikinci bir Edge profili CoreNectum açtığında topoloji
   değişiyor ve aynı oturumun ortasında başka bir profile geçilebiliyordu.

   Artık ilk geçerli çözüm bağlama (context) üzerine SABİTLENİR. Sonradan
   açılan profiller, ön plana gelen pencereler, daha yeni CDP hedefleri ya da
   aynı adresi açan başka sekmeler bu sahipliği DEĞİŞTİREMEZ. Sabitlenen
   profil kaybolursa başka birinin profiline ATLANMAZ; açıkça bildirilir.
   =================================================================== */
function pinnedProfileAffinity(context){
  const pinned=context&&context.__blProfileAffinity;
  return pinned&&typeof pinned==='object'?pinned:null;
}
function pinProfileAffinity(context,binding){
  if(!context||!binding||!binding.bound||!binding.hasContext)return binding;
  if(!pinnedProfileAffinity(context)){
    context.__blProfileAffinity={browserContextId:binding.browserContextId||'',source:binding.source,pinnedAt:new Date().toISOString()};
  }
  return binding;
}
function clearProfileAffinity(context){ if(context)delete context.__blProfileAffinity; }
/* Tarayıcının AÇILDIĞI (varsayılan) profil: ek bağlam listesinde OLMAYAN.
   Buyer Log kendi tarayıcı profilini başlattığı için bu, uygulamanın kendi
   profilidir ve ön plandaki pencereden bağımsız, deterministik bir cevaptır. */
function defaultBrowserContextIdOf(context,pages){
  const extra=new Set((context&&context.extraBrowserContextIds||[]).map(String));
  if(!extra.size)return null;
  const ids=[...new Set(pages.map(page=>String(page.browserContextId||'')))].filter(id=>!extra.has(id));
  return ids.length===1?ids[0]:null;
}
function coreNectumProfileBinding(context){
  const pages=context.pages().filter(page=>!page.isClosed());
  /* 1) SABİTLENMİŞ PROFİL her şeyin önündedir. */
  const pinned=pinnedProfileAffinity(context);
  if(pinned){
    const inProfile=pages.filter(page=>(page.browserContextId||'')===pinned.browserContextId);
    if(inProfile.length){
      const reference=inProfile.find(page=>coreNectumPageUrl(page.url()))||inProfile.find(page=>isBuyerLogPageUrl(page.url()))||inProfile[0];
      return {source:`pinned:${pinned.source}`,browserContextId:pinned.browserContextId,page:reference,bound:true,hasContext:true,pinned:true};
    }
    /* Sabitlenen profil artık açık değil. BAŞKA profile geçmek, kullanıcının
       oturumunu sessizce değiştirmek demektir; bunun yerine bildirilir. */
    return {source:'pinned-profile-unavailable',browserContextId:pinned.browserContextId,page:null,bound:false,hasContext:true,pinned:true};
  }
  /* MEVCUT KULLANICININ PROFİLİ ÖNCE GELİR.
   *
   * Buyer Log'un kendi sekmesi, uygulamayı ŞU AN kullanan kişinin hangi Edge
   * profilinde oturduğunu kesin olarak söyler. Bir CoreNectum sekmesi ise
   * makinedeki BAŞKA bir profile ait olabilir — ortak/çok kullanıcılı
   * bilgisayarda bu çok olağandır.
   *
   * Eski sıra CoreNectum sekmesini önce alıyordu: ikinci bir profil açıkken iş
   * sessizce YABANCI profilde çalışıyor, o profilde CoreNectum oturumu
   * olmadığı için liste isteği hiç doğmuyor ve kullanıcı ham CDP hatası
   * ("No resource with given identifier found") görüyordu. */
  const buyerLog=pages.find(page=>isBuyerLogPageUrl(page.url()));
  if(buyerLog){
    const contextId=buyerLog.browserContextId||'';
    const sameProfile=pages.find(page=>coreNectumPageUrl(page.url())&&(page.browserContextId||'')===contextId);
    return pinProfileAffinity(context,{source:sameProfile?'buyer-log-profile-corenectum-tab':'buyer-log-tab',browserContextId:contextId,page:sameProfile||buyerLog,bound:true,hasContext:true});
  }
  /* Masaüstü (Electron) sürümünde Buyer Log Edge'de bir sekme olarak durmaz;
     o zaman tek dayanak açık CoreNectum sekmesidir. İki AYRI profilde
     CoreNectum açıksa hangisinin mevcut kullanıcıya ait olduğu bilinemez:
     rastgele birini seçip başkasının oturumunda çalışmaktansa sorulur. */
  const coreNectumTabs=pages.filter(page=>coreNectumPageUrl(page.url()));
  const coreNectumContexts=[...new Set(coreNectumTabs.map(page=>page.browserContextId||''))];
  if(coreNectumContexts.length>1){
    /* Birden fazla profilde CoreNectum açık. Ön plandaki pencereye ya da en
       yeni sekmeye bakmak keyfîdir; tarayıcının AÇILDIĞI (varsayılan) profil
       Buyer Log'un kendi profilidir ve deterministik cevaptır. */
    const own=defaultBrowserContextIdOf(context,pages);
    const ownTab=own!=null?coreNectumTabs.find(page=>(page.browserContextId||'')===own):null;
    if(ownTab)return pinProfileAffinity(context,{source:'default-profile-corenectum-tab',browserContextId:own,page:ownTab,bound:true,hasContext:true});
    if(own!=null)return pinProfileAffinity(context,{source:'default-profile',browserContextId:own,page:null,bound:true,hasContext:true});
    return {source:'ambiguous-corenectum-profiles',browserContextId:'',page:null,bound:false,hasContext:false};
  }
  const coreNectum=coreNectumTabs[0];
  if(coreNectum)return pinProfileAffinity(context,{source:'corenectum-tab',browserContextId:coreNectum.browserContextId||'',page:coreNectum,bound:true,hasContext:true});
  const contextIds=[...new Set(pages.map(page=>page.browserContextId||''))];
  // Açık bütün sekmeler TEK profildeyse belirsizlik yoktur.
  if(contextIds.length===1)return pinProfileAffinity(context,{source:'single-open-profile',browserContextId:contextIds[0],page:null,bound:true,hasContext:true});
  const own=defaultBrowserContextIdOf(context,pages);
  if(own!=null)return pinProfileAffinity(context,{source:'default-profile',browserContextId:own,page:null,bound:true,hasContext:true});
  return {source:contextIds.length?'ambiguous':'no-open-page',browserContextId:'',page:null,bound:false,hasContext:false};
}
/* İSTEK GÖVDESİ OLAY İÇİNDE GELSİN.
 *
 * CDP'de `Network.enable` varsayılan `maxPostDataSize` 0'dır: POST gövdesi
 * `requestWillBeSent` olayına HİÇ konmaz, yalnız `hasPostData:true` gelir ve
 * gövdeyi almak için ikinci bir `Network.getRequestPostData` çağrısı gerekir.
 * O çağrı, istek tamamlanıp tarayıcı gövdeyi bıraktığında (sayfa yenilenince
 * çok sık) "No resource with given identifier found" ile düşer — ve GetStyleList
 * şablonu elde edilemediği için tarama hiç başlamazdı.
 *
 * Sınırı açıkça vermek gövdeyi olayın İÇİNDE getirir; ikinci çağrı yalnız
 * beklenmedik biçimde büyük gövdeler için yedek kalır. Ölçülen en büyük gerçek
 * gövde ~24 KB'tır; 8 MB fazlasıyla yeterli bir tavandır. */
const CDP_MAX_POST_DATA_SIZE = 8 * 1024 * 1024;
/* Bağlama kurulamadığında kullanıcıya NE YAPACAĞINI söyleyen mesaj. İki ayrı
   durum vardır ve ikisinin çözümü farklıdır. */
function coreNectumUnboundProfileMessage(binding){
  return (binding&&binding.source)==='ambiguous-corenectum-profiles'
    ? 'Edge\'de birden fazla profilde CoreNectum açık; Buyer Log hangisinin size ait olduğunu bilemez ve başkasının oturumunda işlem yapmaz. Yalnız kendi profilinizdeki CoreNectum sekmesini açık bırakıp tekrar deneyin.'
    : 'CoreNectum sekmesinin hangi Edge profilinde açılacağı belirlenemedi: Edge\'de birden fazla profil açık ve hiçbirinde Buyer Log veya CoreNectum sekmesi yok. Kendi profilinizde CoreNectum\'u açıp tekrar deneyin.';
}
/* Sekme, bağlanılan profilde mi?
 *
 * DİKKAT: Chromium'da tarayıcının AÇILDIĞI profil "varsayılan bağlam"dır ve o
 * profildeki hedefler `browserContextId` TAŞIMAZ (boş gelir). Sonradan açılan
 * ikinci profilin sekmeleri ise gerçek bir kimlik taşır. Bu yüzden boş kimliği
 * "ayrım yapma" diye yorumlamak, tam da düzeltmeye çalıştığımız durumda —
 * kullanıcı varsayılan profilde, yabancı kullanıcı ikinci profilde — filtreyi
 * ETKİSİZ bırakıyordu. Bağlama gerçek bir sekmeden geldiyse (hasContext)
 * kimlikler BİREBİR karşılaştırılır; boş kimlik de geçerli bir değerdir. */
function pageIsInBoundProfile(page,binding){
  if(!page||page.isClosed?.())return false;
  if(!binding||!binding.hasContext)return true;
  return (page.browserContextId||'')===(binding.browserContextId||'');
}
async function pageForCoreNectumReport(context){
  await context.syncPages().catch(()=>{});
  // Rapor da başkasının profilinde çalışmaz: bağlama mevcut kullanıcınındır.
  const binding=coreNectumProfileBinding(context);
  const existing=context.pages().find(candidate=>!candidate.isClosed()&&coreNectumPageUrl(candidate.url())&&pageIsInBoundProfile(candidate,binding));
  if(existing&&typeof context.newPageFrom==='function'){
    try{return {page:await context.newPageFrom(existing,CORENECTUM_STYLE_LIST_URL),ownsPage:true};}catch(_){}
  }
  if(existing)return {page:existing,ownsPage:false};
  /* Sekme yoksa yeni sekme VARSAYILAN profile düşmemeli: bağlama neyi
     gösteriyorsa orada açılır (masaüstü sürümde Buyer Log sekmesi yoktur). */
  return {page:await pageInBoundProfile(context,CORENECTUM_STYLE_LIST_URL,binding),ownsPage:true};
}
/* items: [{plmId, styleId}] — styleId ZORUNLUDUR (bkz. yukarıdaki not).
   Tek sayfa açılır, tüm parti o sayfada sırayla indirilir. */
async function downloadCoreNectumTechnicalSheets(ownerId,items,{language='en',onProgress,isCancelled}={}){
  const throwIfCancelled=()=>{
    if(typeof isCancelled==='function'&&isCancelled())
      throw connectorError('PLM teknik föy indirme işlemi kullanıcı tarafından durduruldu.','PLM_JOB_CANCELLED',499);
  };
  const queue=(Array.isArray(items)?items:[]).map(item=>({
    plmId:coreNectumId(item&&item.plmId),
    styleId:coreNectumId(item&&item.styleId),
  }));
  const files=[],failed=[];
  const pending=queue.filter(item=>{
    if(!item.styleId){failed.push({plmId:item.plmId,error:'Bu model için Style ID bulunamadı. Önce PLM Sync ile model linklerini alın.',code:'CORENECTUM_STYLE_ID_REQUIRED'});return false;}
    return true;
  });
  if(!pending.length)return {files,failed,requested:queue.length};
  const languageId=coreNectumTechnicalSheetLanguageId(language);
  for(let index=0;index<pending.length;index+=1){
    throwIfCancelled();
    const item=pending[index];
    if(typeof onProgress==='function')onProgress({phase:'Teknik föy indiriliyor',current:index,total:pending.length,model:item.plmId});
    try{
      const result=await coreNectumApiClient.postBuffer(ownerId,CORENECTUM_TECHNICAL_SHEET_API,{styleId:Number(item.styleId),languageId},{timeoutMs:90000,retries:3,accept:'application/pdf, application/octet-stream, */*'});
      throwIfCancelled();
      const buffer=result&&Buffer.isBuffer(result.buffer)?result.buffer:Buffer.alloc(0);
      const contentType=clean(result&&result.contentType).toLowerCase();
      if(!buffer.length||buffer.subarray(0,5).toString('ascii')!=='%PDF-'){
        failed.push({plmId:item.plmId,styleId:item.styleId,code:'PLM_TP_INVALID_PDF',error:`PLM beklenen PDF yerine ${contentType||'geçersiz/boş içerik'} döndürdü.`});
        continue;
      }
      files.push({plmId:item.plmId,styleId:item.styleId,base64:buffer.toString('base64'),contentType:contentType||'application/pdf'});
    }catch(error){
      if(error&&['CORENECTUM_API_TOKEN_REQUIRED','CORENECTUM_API_TOKEN_INVALID'].includes(error.code))throw error;
      failed.push({plmId:item.plmId,styleId:item.styleId,error:String(error&&error.message||error).slice(0,300),code:error&&error.code||'PLM_TP_HTTP_ERROR'});
    }
  }
  if(typeof onProgress==='function')onProgress({phase:'Teknik föy indiriliyor',current:pending.length,total:pending.length,model:''});
  return {files,failed,requested:queue.length};
}
async function coreNectumStyleListReady(page,timeoutMs=30000,isCancelled){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(typeof isCancelled==='function'&&isCancelled())throw connectorError('PLM teknik föy indirme işlemi kullanıcı tarafından durduruldu.','PLM_JOB_CANCELLED',499);
    const ready=await page._evaluateValue(`(()=>{const text=String(document.body&&document.body.innerText||'').replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');const numeric=[...document.querySelectorAll('a')].some(el=>/^\s*\d{5,}\s*$/.test(el.textContent||''));return numeric||(text.includes('plm code')&&text.includes('style name'));})()`).catch(()=>false);
    if(ready)return true;
    await sleep(250);
  }
  return false;
}
/* ===================================================================
   PLM SYNC — EK İŞ ALANLARI (Collection Direct PLM Sync)

   plmCode/styleId/styleName/specialCode/seasonName/imageUrl alanları BURADAN
   ÖNCE zaten çalışıyordu ve doğrulanmış durumda (gerçek GetStyleList
   yanıtlarıyla üretimde kullanılıyor).

   GEÇMİŞ. Diğer alanlar için ham anahtarlar başlangıçta TAHMİN EDİLMİŞTİ
   (aynı camelCase kuralına göre) ve üretimde yanlış veri üretti: "en az bir
   aday adı gerçek yanıtta VAR ama FARKLI bir anlam taşıyor" — isim çakışması
   alakasız bir değeri Collection alanına yazdı. Liste bu yüzden bir süre
   TAMAMEN BOŞALTILMIŞTI.

   v(sonraki) — GERÇEK VERİYLE DOĞRULANDI. Kullanıcının kendi CoreNectum
   oturumunda canlı bir GetStyleList yanıtı incelendi (Buyer'ın Style List
   ekranındaki sütun başlıkları ile ham JSON anahtarları TEK TEK karşılaştırıldı,
   birden fazla gerçek kayıt üzerinden değer örnekleriyle doğrulandı — artık
   TAHMİN değil). Aşağıdaki liste yalnız bu şekilde doğrulanan alanları içerir.

   BİLEREK DIŞARIDA BIRAKILANLAR (canlı yanıtta karşılığı bulunamadı/emin
   olunamadı — tahminle doldurulmadı):
     - licensor: internalBrandName/externalBrandName her kayıtta null
       geldi; GetStyleList bu bilgiyi taşımıyor. Excel tek kaynak kalır.
     - colourCode/colour: style seviyesinde TEK obje değil, `colors` adında
       bir DİZİ geliyor (birden çok renk olabilir). Hangi rengin bu
       Koleksiyon satırındaki renkle eşleştiğini dizi index'ine göre
       TAHMİN ETMEK aynı "yanlış ama kendinden emin" hatasını tekrar ederdi.
     - fmhSpecialist: ham anahtarlar arasında eşleşen bir alan bulunamadı.

   Yeni bir alan eklerken: coreNectumRawSampleKeys'i (ya da benzer bir
   tanılama) kullanarak GERÇEK bir kayıttan doğrulayın; tahmin etmeyin. */
const CORENECTUM_EXTRA_FIELDS=Object.freeze([
  ['productMainDefinition',['productMainDefinitionName']],
  ['magRaw',['merchSubGroupName']],
  ['mmygRaw',['merchBrandAgeGroupName']],
  ['buyingGroup',['buyerGroupName']],
  ['lineRaw',['lineName']],
  ['categoryRaw',['productCategoryName']],
  ['fabric',['mainFabricInfo']],
  ['fit',['labelFitName']],
  ['designSourceRaw',['designSourceName','designSource']],
  ['statusRaw',['workflowStatusName']],
  ['orderStatusRaw',['orderStatusName']],
  ['productType',['productTypeName']],
  ['buyerRaw',['buyer']],
  ['ageGroup',['ageGroupName']],
]);
function coreNectumExtraFields(model){
  const out={};
  for(const [target,candidates] of CORENECTUM_EXTRA_FIELDS){
    for(const key of candidates){
      const value=model&&model[key];
      if(value!=null&&String(value).trim()){out[target]=String(value).trim().slice(0,300);break;}
    }
  }
  return out;
}
// İki bulk-scan yolu (satır ~1072 ve ~1150) tarayıcı içinde CDP ile
// ÇALIŞTIRILAN metin ifadeleridir; Node fonksiyonunu doğrudan paylaşamazlar.
// Alan ADAYLARI (veri) burada TEK yerde tanımlı kalır, yalnız çıkarım
// mantığının birkaç satırı iki yerde metin olarak tekrarlanır — bu,
// CDP script enjeksiyonunun kaçınılmaz kısıtıdır, kod tekrarı tercihi değil.
const CORENECTUM_EXTRA_FIELDS_JS=`(model)=>{const fields=${JSON.stringify(CORENECTUM_EXTRA_FIELDS)},out={};for(const [target,candidates] of fields){for(const key of candidates){const value=model&&model[key];if(value!=null&&String(value).trim()){out[target]=String(value).trim().slice(0,300);break;}}}return out;}`;
function coreNectumRecordImageUrl(item){
  // Style List'in üst-seviye imageUrl'u kanonik ön+arka model görselidir.
  // model.imageUrl bazı kayıtlarda Options'taki tekli görseli taşır; yalnız
  // üst-seviye alan yoksa geriye dönük fallback olarak kullanılır.
  const direct=clean(item&&item.imageUrl)||clean(item&&item.model&&item.model.imageUrl);if(direct)return direct;
  let found='';const visit=(value,depth=0)=>{if(found||depth>6||value==null||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if(/^imageUrl$/i.test(key)&&clean(entry)){found=clean(entry);return;}visit(entry,depth+1);}};visit(item);return found;
}
function coreNectumAttachmentUrl(value){
  try{const url=new URL(clean(value),CORENECTUM_STYLE_LIST_URL);if(url.protocol!=='https:'||!/(^|\.)lcwaikiki\.com$/i.test(url.hostname)||!/\/Attachment\/GetAttachment\//i.test(url.pathname))return '';return url.href;}catch(_){return '';}
}
function coreNectumColourImageKey(item){
  const plmId=coreNectumId(item&&item.plmId),colourCode=clean(item&&(item.colourCode||item.colorCode)).toLocaleUpperCase('tr-TR'),colour=clean(item&&(item.colour||item.color)).toLocaleUpperCase('tr-TR');
  const base=plmId&&colourCode?`${plmId}\u0000${colourCode}`:plmId;
  return base&&colour?`${base}\u0000${colour}`:base;
}
function coreNectumResolveRequestedImage(requested,colourImages,genericImage,options={}){
  if(options&&options.preferGeneric===true)return coreNectumUsableImage(genericImage)?genericImage:null;
  const code=clean(requested&&(requested.colourCode||requested.colorCode));
  const colourImage=code&&colourImages instanceof Map?colourImages.get(coreNectumColourImageKey(requested)):null;
  if(coreNectumUsableImage(colourImage))return colourImage;
  if(options&&options.allowGenericFallback===false)return null;
  return coreNectumUsableImage(genericImage)?genericImage:null;
}
function coreNectumImageRecordPlan(candidates=[]){
  const known=new Map(),scan=[];
  for(const candidate of Array.isArray(candidates)?candidates:[]){
    const plmId=coreNectumId(candidate&&candidate.plmId),styleId=coreNectumId(candidate&&candidate.styleId);
    if(!plmId)continue;
    if(styleId&&!known.has(plmId))known.set(plmId,{plmId,styleId,styleName:clean(candidate&&candidate.styleName).slice(0,300),imageUrl:''});
    // Her görsel işi Style List kaydını okur: ana görsel ile PLM'in kanonik
    // renk sırası aynı yanıttadır. Kayıtlı styleId yalnız link işlerini hızlandırır.
    if((!styleId||candidate&&candidate.needImage===true)&&!scan.includes(plmId))scan.push(plmId);
  }
  return {knownRecords:[...known.values()],scanIds:scan};
}
// Model görseli MODEL SEVİYESİNDEDİR: tek kaynak Style List satırının Image
// sütunudur. Aynı PLM ID'nin bütün renkleri bu tek görseli paylaşır; renk
// başına Style Overview (model detay) gezintisi YAPILMAZ. Renk seviyesindeki
// farklılaştırma kullanıcının elle yaptığı override ile olur, PLM Sync ile
// değil. Bu yüzden colourRequests her zaman boştur.
function coreNectumImageSelectionPlan(requestedList=[],record={}){
  const requested=(Array.isArray(requestedList)?requestedList:[]).filter(item=>item&&item.needImage!==false);
  const sourceColours=coreNectumColourVariants(record&&(record.colors||record.colours));
  return {sourceColours,primary:requested.slice(),hasGenericRequest:requested.length>0,useGenericFor:()=>true,colourRequests:[]};
}
function coreNectumRefreshImageUrl(imageUrl, refreshToken=''){
  const url=coreNectumAttachmentUrl(imageUrl),token=clean(refreshToken).replace(/[^a-zA-Z0-9._~-]/g,'').slice(0,96);
  if(!url||!token)return url;
  try{const parsed=new URL(url);parsed.searchParams.set('bl_refresh',token);return parsed.href;}catch(_){return url;}
}
// ASAS "Teknik Resim" alanı yalnız bu sabit PIM hostundaki iki salt-okunur
// görsel servisini kabul eder. Kaynaktan gelen keyfi bir URL tarayıcıda veya
// sunucuda çalıştırılmaz.
function pimTechnicalImageUrl(value){
  try{
    const url=new URL(clean(value));
    if(url.protocol!=='https:'||url.hostname.toLowerCase()!=='pim.prod.lcwaikiki.com')return '';
    if(!/^\/productimageoperation\/service\/customer\/api\/(?:CoreNectumAttachmentOperation\/GetAttachment\/[^/?#]+|PLMImageOperation\/GetStyleImageById\/[^/?#]+)\/?$/i.test(url.pathname))return '';
    return url.href;
  }catch(_){return '';}
}
function coreNectumImageKey(value){const url=coreNectumAttachmentUrl(value);if(!url)return '';try{return new URL(url).pathname.replace(/\/+$/,'').toLowerCase();}catch(_){return '';}}
function coreNectumImageMime(buffer,hint=''){
  const mime=clean(hint).toLowerCase().split(';')[0].trim();if(/^image\/(jpeg|png|webp|gif)$/.test(mime))return mime;
  if(!Buffer.isBuffer(buffer)||buffer.length<12)return '';
  if(buffer[0]===0x89&&buffer.slice(1,4).toString('ascii')==='PNG')return'image/png';
  if(buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return'image/jpeg';
  if(buffer.slice(0,3).toString('ascii')==='GIF')return'image/gif';
  if(buffer.slice(0,4).toString('ascii')==='RIFF'&&buffer.slice(8,12).toString('ascii')==='WEBP')return'image/webp';
  return '';
}
function coreNectumRecordsOf(payload){
  const preferred=payload&&payload.data&&payload.data.coreNectumResultData&&payload.data.coreNectumResultData.styleListResult;
  let source=Array.isArray(preferred)&&preferred.length?preferred:null;
  if(!source){const visit=(value,depth=0)=>{if(source||depth>8||value==null)return;if(Array.isArray(value)){if(value.some(item=>item&&typeof item==='object'&&('styleId'in item)&&('plmCode'in item))){source=value;return;}value.forEach(item=>visit(item,depth+1));return;}if(typeof value==='object')Object.values(value).forEach(item=>visit(item,depth+1));};visit(payload);}
  return source||[];
}
function coreNectumColourVariants(value){
  const source=Array.isArray(value)?value:[];
  return source.map(item=>{
    if(!item||typeof item!=='object')return null;
    const out={},code=clean(item.colorCode||item.colourCode||item.code||item.color_code),name=clean(item.name||item.colorName||item.colourName||item.colour||item.color),hex=clean(item.hexCode||item.hex||item.rgb);
    if(item.id!=null)out.id=item.id;
    if(name)out.name=name;
    if(code)out.colorCode=code;
    if(hex)out.hexCode=hex;
    if(item.pantone!=null)out.pantone=item.pantone;
    return Object.keys(out).length>0?out:null;
  }).filter(Boolean);
}
function coreNectumMergeColourVariants(primary,fallback){
  const merged=[],seen=new Set();
  const keyFor=item=>{
    const code=clean(item&&item.colorCode).toLocaleUpperCase('tr-TR'),name=clean(item&&item.name).toLocaleUpperCase('tr-TR'),hex=clean(item&&item.hexCode).toLocaleUpperCase('tr-TR'),pantone=clean(item&&item.pantone).toLocaleUpperCase('tr-TR');
    return code?`code:${code}`:name?`name:${name}`:hex?`hex:${hex}`:pantone?`pantone:${pantone}`:'';
  };
  for(const item of [...coreNectumColourVariants(primary),...coreNectumColourVariants(fallback)]){
    const key=keyFor(item);if(!key||seen.has(key))continue;seen.add(key);merged.push(item);
  }
  return merged;
}
const CORENECTUM_COLOURS_JS="(value)=>{const source=Array.isArray(value)?value:[];return source.map(item=>{if(!item||typeof item!=='object')return null;const out={},code=String(item.colorCode||item.colourCode||item.code||item.color_code||'').trim(),name=String(item.name||item.colorName||item.colourName||item.colour||item.color||'').trim(),hex=String(item.hexCode||item.hex||item.rgb||'').trim();if(item.id!=null)out.id=item.id;if(name)out.name=name;if(code)out.colorCode=code;if(hex)out.hexCode=hex;if(item.pantone!=null)out.pantone=item.pantone;return Object.keys(out).length?out:null;}).filter(Boolean);}";
function coreNectumStyleListRows(payload){
  const source=coreNectumRecordsOf(payload);
  const rows=[],seen=new Set();
  for(const item of (source||[])){
    const plmId=coreNectumId(item&&item.plmCode),styleId=coreNectumId(item&&item.styleId);if(!plmId||!styleId||seen.has(plmId))continue;seen.add(plmId);
    const row={plmId,styleId,styleName:clean(item.styleName).slice(0,300),specialCode:clean(item.specialCode).slice(0,120)},season=clean(item.seasonName||item.season).slice(0,120),imageUrl=coreNectumAttachmentUrl(coreNectumRecordImageUrl(item)),colors=coreNectumColourVariants(item&& (item.colors||item.colours));if(season)row.season=season;if(imageUrl)row.imageUrl=imageUrl;if(colors.length)row.colors=colors;Object.assign(row,coreNectumExtraFields(item));rows.push(row);
  }
  return rows;
}
async function coreNectumListCapture(page){
  const batches=[],images=new Map(),templates=[],errors=[],requests=new Map(),tasks=new Set(),templateTasks=new Set(),styleRequestIds=new Set(),templateByRequest=new Map(),extraHeadersByRequest=new Map();
  /* "No resource with given identifier found" GERÇEK bir sebep değildir:
     sayfa yenilendiğinde/gezindiğinde tarayıcı eski yanıt gövdesini atar ve
     bizim okuma isteğimiz boşa düşer. Bu satır kullanıcıya hata olarak
     gösterildiğinde asıl sorunu (yanlış profil / oturum yok) maskeliyordu.
     Böyle bir okuma başarısızlığı kaydedilir ama kullanıcıya sebep olarak
     SUNULMAZ. */
  const isEvictedResource=message=>/no resource with given identifier|no data found for resource/i.test(message);
  const captureError=(stage,error)=>{const message=String(error&&error.message||error||'Unknown error').replace(/[\r\n]+/g,' ').slice(0,240);errors.push({stage,error:message,evicted:isEvictedResource(message)});};
  const requested=params=>{
    const request=params&&params.request||{},url=clean(request.url);if(!/\/StyleList\/GetStyleList(?:\?|$)/i.test(url))return;
    const requestId=clean(params&&params.requestId);if(requestId)styleRequestIds.add(requestId);
    let task;task=(async()=>{
      let postData=String(request.postData||'');
      if(!postData&&request.hasPostData&&requestId){
        const recovered=await page.client.send('Network.getRequestPostData',{requestId},10000).catch(error=>{captureError('request-postdata',error);return null;});
        postData=String(recovered&&recovered.postData||'');
      }
      if(!postData)return;
      try{
        const body=JSON.parse(postData),extra=requestId&&extraHeadersByRequest.get(requestId)||{};
        const template={requestId,url,method:clean(request.method)||'POST',headers:{...(request.headers||{}),...extra},body};
        templates.push(template);if(requestId)templateByRequest.set(requestId,template);if(templates.length>10){const removed=templates.shift();if(removed&&removed.requestId)templateByRequest.delete(removed.requestId);}
      }catch(error){captureError('request-postdata-json',error);}
    })().finally(()=>templateTasks.delete(task));templateTasks.add(task);
  };
  /* Chromium bazı hassas/ağ-katmanı başlıklarını (özellikle Authorization)
     requestWillBeSent içinde eksik bırakabiliyor. Gerçekte tel üzerinden
     gönderilen başlıklar requestWillBeSentExtraInfo'da gelir. Bearer değeri
     Node'a/log'a yazılmaz; yalnız sayfa içindeki tekrar isteğine aktarılır. */
  const requestExtraInfo=params=>{
    const requestId=clean(params&&params.requestId);if(!requestId||!styleRequestIds.has(requestId))return;
    const headers={...(params&&params.headers||{})},template=templateByRequest.get(requestId);
    if(template)template.headers={...(template.headers||{}),...headers};else extraHeadersByRequest.set(requestId,headers);
  };
  const response=params=>{const data=params&&params.response||{},url=clean(data.url);if(/\/StyleList\/GetStyleList(?:\?|$)/i.test(url))requests.set(params.requestId,{kind:'list',url,mimeType:data.mimeType});else if(/\/Attachment\/GetAttachment\//i.test(url))requests.set(params.requestId,{kind:'image',url,mimeType:data.mimeType});};
  const finished=params=>{const request=requests.get(params&&params.requestId);if(!request)return;requests.delete(params.requestId);let task;task=page.client.send('Network.getResponseBody',{requestId:params.requestId},30000).then(body=>{if(request.kind==='list'){const text=body&&body.base64Encoded?Buffer.from(body.body||'','base64').toString('utf8'):String(body&&body.body||'');const rows=coreNectumStyleListRows(JSON.parse(text));if(rows.length)batches.push(rows);return;}const buffer=body&&body.base64Encoded?Buffer.from(body.body||'','base64'):Buffer.from(String(body&&body.body||''),'binary'),mimeType=coreNectumImageMime(buffer,request.mimeType);if(!mimeType||!buffer.length||buffer.length>20*1024*1024)return;const image={mimeType,base64:buffer.toString('base64')},key=coreNectumImageKey(request.url);images.set(request.url,image);if(key)images.set(key,image);}).catch(error=>{captureError(request.kind==='list'?'list-response-body':'image-response-body',error);}).finally(()=>tasks.delete(task));tasks.add(task);};
  const failed=params=>{const requestId=params&&params.requestId,request=requests.get(requestId);if(request)captureError(request.kind==='list'?'list-loading':'image-loading',params&&params.errorText||'Network loading failed');requests.delete(requestId);};
  page.client.on('Network.requestWillBeSent',requested);page.client.on('Network.requestWillBeSentExtraInfo',requestExtraInfo);page.client.on('Network.responseReceived',response);page.client.on('Network.loadingFinished',finished);page.client.on('Network.loadingFailed',failed);
  await page.client.send('Network.enable',{maxPostDataSize:CDP_MAX_POST_DATA_SIZE},10000);
  return {batches,images,templates,errors,async waitForTemplate(timeoutMs=5000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(templates.length)return true;if(templateTasks.size)await Promise.race([Promise.allSettled([...templateTasks]),sleep(50)]);else await sleep(50);}return Boolean(templates.length);},async stop(){page.client.off('Network.requestWillBeSent',requested);page.client.off('Network.requestWillBeSentExtraInfo',requestExtraInfo);page.client.off('Network.responseReceived',response);page.client.off('Network.loadingFinished',finished);page.client.off('Network.loadingFailed',failed);styleRequestIds.clear();templateByRequest.clear();extraHeadersByRequest.clear();await Promise.allSettled([...templateTasks,...tasks]);}};
}
function coreNectumBatchSignature(rows){return (rows||[]).map(item=>item.plmId+':'+item.styleId).join('|');}
async function coreNectumWaitListBatch(capture,startIndex,previousSignature='',timeoutMs=45000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){for(let index=startIndex;index<capture.batches.length;index+=1){const rows=capture.batches[index],signature=coreNectumBatchSignature(rows);if(signature&&signature!==previousSignature)return {rows,signature,index};}await sleep(120);}
  return null;
}
async function coreNectumNextListPage(page){
  return page._evaluateValue(`(()=>{const visible=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};const buttons=[...document.querySelectorAll('button')].filter(visible);const next=buttons.find(el=>el.classList.contains('mat-mdc-paginator-navigation-next'))||buttons.find(el=>/next page|sonraki sayfa/i.test([el.getAttribute('aria-label'),el.title].filter(Boolean).join(' ')));if(!next)return {found:false,disabled:true};const disabled=!!next.disabled||next.getAttribute('aria-disabled')==='true';if(disabled)return {found:true,disabled:true};next.scrollIntoView({block:'center'});next.click();return {found:true,disabled:false,clicked:true};})()`).catch(()=>({found:false,disabled:true}));
}
async function coreNectumDirectApiScan(page,capture,wantedIds){
  const template=capture.templates[capture.templates.length-1];if(!template||!template.body)return null;
  const allowedHeaders=coreNectumReplayHeaders(template.headers);
  const config=JSON.stringify({url:template.url,method:template.method,headers:allowedHeaders,body:coreNectumUnfilteredRequestBody(template.body),wanted:[...wantedIds],maxPages:5000,pageDelay:75});
  return page._evaluateValue(`(async()=>{const cfg=${config},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clone=value=>JSON.parse(JSON.stringify(value)),get=(object,path)=>path.reduce((current,key)=>current==null?undefined:current[key],object),set=(object,path,value)=>{let current=object;for(let i=0;i<path.length-1;i+=1)current=current[path[i]];current[path[path.length-1]]=value;};const fields=[];const visit=(value,path=[])=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){const childPath=[...path,key],normalized=key.replace(/[_\\-\\s]/g,'').toLowerCase();if(typeof child==='number'){let type='';if(/^(page|pageno|pagenumber|pageindex|currentpage|currentpageno|currentpagenumber|currentpageindex)$/.test(normalized))type='page';else if(/^(skip|offset|start|startindex|first|firstrow|startrow)$/.test(normalized))type='offset';else if(/^(pagesize|size|limit|take|length|rowcount|maxresultcount)$/.test(normalized))type='size';if(type)fields.push({type,path:childPath,key:normalized,base:child});}if(child&&typeof child==='object')visit(child,childPath);}};visit(cfg.body);const pages=fields.filter(field=>field.type==='page'),offsets=fields.filter(field=>field.type==='offset'),sizes=fields.filter(field=>field.type==='size');if(!pages.length&&!offsets.length)return null;const pageSize=sizes.map(field=>Number(get(cfg.body,field.path))).find(value=>value>0)||100,wanted=new Set(cfg.wanted.map(String)),found=new Map(),allSeen=new Set(),recordsOf=payload=>{const preferred=payload&&payload.data&&payload.data.coreNectumResultData&&payload.data.coreNectumResultData.styleListResult;if(Array.isArray(preferred))return preferred;let result=null;const find=value=>{if(result||value==null)return;if(Array.isArray(value)){if(value.some(item=>item&&typeof item==='object'&&('styleId'in item)&&('plmCode'in item))){result=value;return;}value.forEach(find);return;}if(typeof value==='object')Object.values(value).forEach(find);};find(payload);return result||[];},normalizePlmId=value=>{let text=String(value==null?'':value).trim().replace(/^_+/,'').replace(/\\.(?=\\d{3}(?:\\D|$))/g,'');if(/^\\d+\\.0+$/.test(text))text=text.slice(0,text.indexOf('.'));return /^\\d+$/.test(text)&&Number(text)>0?String(Number(text)):'';},recordImageUrl=item=>{let found='';const find=value=>{if(found||value==null||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if(/^imageUrl$/i.test(key)&&String(entry||'').trim()){found=String(entry).trim();return;}find(entry);}};find(item);return found;},extraFields=${CORENECTUM_EXTRA_FIELDS_JS};let scannedPages=0,scannedRows=0,duplicates=0;for(let pageOffset=0;pageOffset<cfg.maxPages;pageOffset+=1){const body=clone(cfg.body);for(const field of pages){const zeroBased=/index$/.test(field.key)||field.base===0;set(body,field.path,pageOffset+(zeroBased?0:1));}for(const field of offsets)set(body,field.path,pageOffset*pageSize);const response=await fetch(cfg.url,{method:cfg.method||'POST',headers:cfg.headers,body:JSON.stringify(body),credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('CoreNectum API page '+(pageOffset+1)+': HTTP '+response.status);const payload=await response.json(),records=recordsOf(payload);scannedPages+=1;scannedRows+=records.length;let fresh=0;for(const model of records){const styleId=normalizePlmId(model&&model.styleId),plmId=normalizePlmId(model&&model.plmCode);if(plmId&&!allSeen.has(plmId)){allSeen.add(plmId);fresh+=1;}if(plmId&&wanted.has(plmId)&&!found.has(plmId))found.set(plmId,{plmId,styleId,styleName:String(model.styleName||'').trim(),specialCode:String(model.specialCode||'').trim(),season:String(model.seasonName||model.season||'').trim(),imageUrl:recordImageUrl(model),...extraFields(model)});}duplicates=fresh?0:duplicates+1;if(!records.length||records.length<pageSize||duplicates>=2)break;if(cfg.pageDelay)await sleep(cfg.pageDelay);}return {rows:[...found.values()],scannedPages,scannedRows};})()`).catch(error=>{return {rows:[],scannedPages:0,scannedRows:0,error:String(error&&error.message||error).slice(0,240)};});
}
// Görünür paginator'a dokunmadan GetStyleList isteğini, sunucunun yakalanan
// gerçek sayfa boyutuyla arka planda dolaşır. Kullanıcının açık Style List
// filtreleri kaldırılır; güvenlik scope'u, sıralama ve diğer istek alanları korunur.
function coreNectumUnfilteredRequestBody(value){
  const clone=value==null?{}:JSON.parse(JSON.stringify(value));
  /* GetStyleList'in GERÇEK süzgeç sözleşmesi filterCriterias / searchCriteria /
     favoriteGroupId'dir (canlı ölçümle doğrulandı, bkz. corenectum-style-api.js
     styleListBatchBody). Bu üç anahtar listede YOKTU: arka plan taraması,
     kullanıcının Style List ekranında o an etkin olan sezon/koleksiyon
     filtresini yakalanan şablondan AYNEN devralıyordu. Sonuç, taze bir
     CoreNectum oturumunda (ör. uygulamayı başka bir bilgisayara kopyalayınca)
     daraltılmış bir evren taramak ve aranan PLM'ler o evrende olmadığı için
     "model bulunamadı" demekti — oysa modeller yerindeydi.
     Yetki/kapsam alanları (securityScope, tenant…) protectedKeys ile korunur. */
  const filterKeys=new Set(['filter','filters','filterlist','filtermodel','appliedfilters','columnfilters','filteritems','filtercriterias','filtercriteria','searchcriteria','searchcriterias']);
  // Skaler daraltıcılar: değer TAŞIMAZ hâle getirilir ama alan silinmez;
  // sunucu modelinde beklenen bir alanı yok etmek isteği tümden reddettirebilir.
  const nullKeys=new Set(['favoritegroupid','favouritegroupid','favoritegroup','groupid']);
  const protectedKeys=new Set(['securityscope','accessscope','userscope','permission','permissions','tenant','tenants','authorization']);
  /* Nesne biçimindeki süzgeç (searchCriteria gibi) {} ile DEĞİŞTİRİLMEZ,
     YERİNDE boşaltılır: alan adları korunur, yalnız değerleri sıfırlanır.
     Böylece gövde şeması yakalanan gerçek istekle birebir aynı kalır. */
  const blankInPlace=current=>{
    if(!current||typeof current!=='object')return;
    for(const [key,child] of Object.entries(current)){
      if(Array.isArray(child))current[key]=[];
      else if(child&&typeof child==='object')blankInPlace(child);
      else if(typeof child==='string')current[key]='';
      else if(typeof child==='boolean')current[key]=false;
    }
  };
  const visit=(current,protectedBranch=false)=>{
    if(!current||typeof current!=='object')return;
    for(const [key,child] of Object.entries(current)){
      const normalized=key.replace(/[_\-\s]/g,'').toLowerCase();
      if(protectedBranch){ visit(child,true); continue; }
      if(nullKeys.has(normalized)&&(child===null||typeof child!=='object')){ current[key]=null; continue; }
      if(filterKeys.has(normalized)){
        if(Array.isArray(child))current[key]=[];
        else if(child&&typeof child==='object')blankInPlace(child);
        else if(typeof child==='string')current[key]='';
        else if(typeof child==='boolean')current[key]=false;
        else current[key]=null;
        continue;
      }
      visit(child,protectedKeys.has(normalized));
    }
  };
  visit(clone);
  return clone;
}
/* CoreNectum Style List taraması PARÇALI çalışır.

   NEDEN: Eskiden bütün sayfalar TEK bir Runtime.evaluate çağrısının içinde
   geziliyordu. CDP komutunun sabit 45 sn bütçesi var (portable-web-engine
   _send varsayılanı) ama tarama süresi listenin büyüklüğüyle artıyor:
   ~100 satır/sayfa, sayfa başına bir ağ turu + 75 ms bekleme. 10.000 satırlık
   bir koleksiyonda ~100 sayfa ≈ 40-78 sn sürüyor ve komut düşüyordu
   ("CDP komutu zaman aşımına uğradı: Runtime.evaluate"). maxPages:5000 ile
   45 sn arasında iki büyüklük mertebesi fark vardı.

   ŞİMDİ: her çağrı yalnız CORENECTUM_SCAN_PAGE_BUDGET kadar sayfa tarar ve
   döner; döngüyü Node yürütür. Sayfa içi durum (bulunanlar, görülenler, sayfa
   imleci) window üzerinde saklanır, böylece 10.000 ID her çağrıda yeniden
   gönderilmez. Kazanımlar: her CDP çağrısı kısa kalır, koleksiyon büyüklüğü
   sınır olmaktan çıkar ve tarama boyunca ilerleme bildirilebilir. */
const CORENECTUM_SCAN_PAGE_BUDGET=8;
// 700 × 8 = 5600 sayfa: eski maxPages:5000 üst sınırının biraz üstü.
const CORENECTUM_SCAN_MAX_CHUNKS=700;
const CORENECTUM_SCAN_STATE_KEY='__blCoreNectumScanState';

function coreNectumScanExpression(configJson){
  return `(async()=>{
    const cfg=${configJson};
    const KEY=${JSON.stringify(CORENECTUM_SCAN_STATE_KEY)};
    /* Durum, çağrılar arasında sayfada saklanır. Tarayıcıda bu window'dur;
       enjekte edilen kodu tarayıcı dışında koşturan sınama koşumlarında
       window tanımlı değildir. Doğrudan window'a bağlanmak o koşumları
       kırdığı için kapsam burada güvenle seçilir. */
    const scope=(typeof window!=='undefined'&&window)?window:globalThis;
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const clone=value=>JSON.parse(JSON.stringify(value));
    const get=(object,path)=>path.reduce((current,key)=>current==null?undefined:current[key],object);
    const set=(object,path,value)=>{let current=object;for(let i=0;i<path.length-1;i+=1)current=current[path[i]];current[path[path.length-1]]=value;};
    if(cfg.reset||!scope[KEY]){
      if(!cfg.reset)return {rows:[],done:false,needsReset:true,scannedPages:0,scannedRows:0,pageSize:0};
      const fields=[];
      const visit=(value,path=[])=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){const childPath=[...path,key],normalized=key.replace(/[_\\-\\s]/g,'').toLowerCase();if(typeof child==='number'){let type='';if(/^(page|pageno|pagenumber|pageindex|currentpage|currentpageno|currentpagenumber|currentpageindex)$/.test(normalized))type='page';else if(/^(skip|offset|start|startindex|first|firstrow|startrow)$/.test(normalized))type='offset';else if(/^(pagesize|size|limit|take|length|rowcount|maxresultcount)$/.test(normalized))type='size';if(type)fields.push({type,path:childPath,key:normalized,base:child});}if(child&&typeof child==='object')visit(child,childPath);}};
      visit(cfg.body);
      const pages=fields.filter(field=>field.type==='page');
      const offsets=fields.filter(field=>field.type==='offset');
      const sizes=fields.filter(field=>field.type==='size');
      if(!pages.length&&!offsets.length){scope[KEY]=null;return null;}
      scope[KEY]={
        cfg:{url:cfg.url,method:cfg.method,headers:cfg.headers,body:cfg.body,pageDelay:cfg.pageDelay,maxPages:cfg.maxPages},
        pages,offsets,
        pageSize:sizes.map(field=>Number(get(cfg.body,field.path))).find(value=>value>0)||100,
        wanted:new Set((cfg.wanted||[]).map(String)),
        found:new Set(),allSeen:new Set(),
        pageOffset:0,duplicates:0,done:false,scannedPages:0,scannedRows:0,
      };
    }
    const st=scope[KEY];
    if(!st)return null;
    const recordsOf=payload=>{const preferred=payload&&payload.data&&payload.data.coreNectumResultData&&payload.data.coreNectumResultData.styleListResult;if(Array.isArray(preferred)&&preferred.length)return preferred;let result=null;const visit=(value,depth=0)=>{if(result||depth>8||value==null)return;if(Array.isArray(value)){if(value.some(item=>item&&typeof item==='object'&&('styleId'in item)&&('plmCode'in item))){result=value;return;}value.forEach(item=>visit(item,depth+1));return;}if(typeof value==='object')Object.values(value).forEach(item=>visit(item,depth+1));};visit(payload);return result||[];};
    const normalizePlmId=value=>{let text=String(value==null?'':value).trim().replace(/^_+/,'').replace(/\\.(?=\\d{3}(?:\\D|$))/g,'');if(/^\\d+\\.0+$/.test(text))text=text.slice(0,text.indexOf('.'));return /^\\d+$/.test(text)&&Number(text)>0?String(Number(text)):'';};
    const recordImageUrl=item=>{let found='';const visit=(value,depth=0)=>{if(found||depth>6||value==null||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if(/^imageUrl$/i.test(key)&&String(entry||'').trim()){found=String(entry).trim();return;}visit(entry,depth+1);}};visit(item);return found;};
    // Node fonksiyonu coreNectumExtraFields'i BURADA doğrudan çağıramayız — bu
    // ifade CDP ile sayfa içinde çalışır. Aynı aday listesi metin olarak
    // enjekte edilir (bkz. CORENECTUM_EXTRA_FIELDS_JS tanımı ve açıklaması).
    const extraFields=${CORENECTUM_EXTRA_FIELDS_JS};
    const colourVariants=${CORENECTUM_COLOURS_JS};
    const newRows=[];
    try{
      for(let step=0;step<(cfg.pageBudget||8)&&!st.done;step+=1){
        if(st.pageOffset>=st.cfg.maxPages){st.done=true;break;}
        const body=clone(st.cfg.body);
        for(const field of st.pages){const zeroBased=/index$/.test(field.key)||field.base===0;set(body,field.path,st.pageOffset+(zeroBased?0:1));}
        for(const field of st.offsets)set(body,field.path,st.pageOffset*st.pageSize);
        const response=await fetch(st.cfg.url,{method:st.cfg.method||'POST',headers:st.cfg.headers,body:JSON.stringify(body),credentials:'include',cache:'no-store'});
        if(!response.ok)throw new Error('CoreNectum GetStyleList API request '+(st.pageOffset+1)+': HTTP '+response.status);
        const payload=await response.json(),records=recordsOf(payload);
        st.pageOffset+=1;st.scannedPages+=1;st.scannedRows+=records.length;
        let fresh=0;
        for(const model of records){
          const styleId=normalizePlmId(model&&model.styleId),plmId=normalizePlmId(model&&model.plmCode);
          if(plmId&&!st.allSeen.has(plmId)){st.allSeen.add(plmId);fresh+=1;}
          if(plmId&&styleId&&st.wanted.has(plmId)&&!st.found.has(plmId)){
            st.found.add(plmId);
            const row={plmId,styleId,styleName:String(model.styleName||'').trim(),specialCode:String(model.specialCode||'').trim(),season:String(model.seasonName||model.season||'').trim(),imageUrl:recordImageUrl(model),...extraFields(model)},colors=colourVariants(model&& (model.colors||model.colours));if(colors.length)row.colors=colors;newRows.push(row);
          }
        }
        st.duplicates=fresh?0:st.duplicates+1;
        if(st.found.size===st.wanted.size||!records.length||records.length<st.pageSize||st.duplicates>=2){st.done=true;break;}
        if(st.cfg.pageDelay)await sleep(st.cfg.pageDelay);
      }
    }catch(error){
      st.done=true;
      return {rows:newRows,done:true,scannedPages:st.scannedPages,scannedRows:st.scannedRows,pageSize:st.pageSize,error:String(error&&error.message||error).slice(0,240)};
    }
    return {rows:newRows,done:st.done,scannedPages:st.scannedPages,scannedRows:st.scannedRows,pageSize:st.pageSize};
  })()`;
}

async function coreNectumBulkApiScan(page,capture,wantedIds,options={}){
  /* ŞABLON GELMEDİYSE SAYFAYI GERÇEKTEN YENİLE.
   *
   * Tarama, CoreNectum'un KENDİ GetStyleList isteğini yakalayıp aynı biçimde
   * tekrarlar; yani önce o isteğin bir kez doğması gerekir. Sekme ZATEN Style
   * List adresindeyse `Page.navigate` aynı adrese gitmek Angular tarafında
   * belge yenilemeyebilir ve liste isteği hiç yeniden doğmaz — şablon boş
   * kalır, iş "istek yeniden oluşturulamadı" diye düşer. Kullanıcıya yıllardır
   * "Style List'i bir kez yenileyin" denmesinin sebebi buydu; artık yenilemeyi
   * Buyer Log kendisi yapar. */
  if(capture&&typeof capture.waitForTemplate==='function'){
    let ready=await capture.waitForTemplate(5000);
    if(!ready&&typeof options.refresh==='function'){
      try{ await options.refresh(); }catch(_){ /* yenileme başarısızsa aşağıdaki şablon kontrolü karar verir */ }
      ready=await capture.waitForTemplate(20000);
    }
    void ready;
  }
  const template=capture.templates[capture.templates.length-1];
  /* Başarısızlık SEBEBİ taşınır. Eskiden burada çıplak `null` dönüyordu ve
     çağıran "sayfalama okunamadı" gibi hangi adımın koptuğunu söylemeyen tek
     bir cümle üretiyordu. */
  if(!template||!template.body)return {rows:[],scannedPages:0,scannedRows:0,mode:'direct-api',reason:'no-template'};
  const wanted=[...wantedIds].map(String);
  const resetConfig=()=>JSON.stringify({
    reset:true,
    url:template.url,
    method:template.method,
    headers:coreNectumReplayHeaders(template.headers),
    body:coreNectumUnfilteredRequestBody(template.body),
    wanted,
    maxPages:5000,
    pageDelay:75,
    pageBudget:CORENECTUM_SCAN_PAGE_BUDGET,
  });
  const continueConfig=()=>JSON.stringify({reset:false,pageBudget:CORENECTUM_SCAN_PAGE_BUDGET});
  const found=new Map();
  let scannedPages=0,scannedRows=0,pageSize=0,needsReset=true;
  for(let chunk=0;chunk<CORENECTUM_SCAN_MAX_CHUNKS;chunk+=1){
    const slice=await page._evaluateValue(coreNectumScanExpression(needsReset?resetConfig():continueConfig()));
    if(!slice)return {rows:[...found.values()],scannedPages,scannedRows,mode:'direct-api',reason:'evaluate-failed'};
    /* Sayfa yenilenir/gezinirse window üzerindeki durum kaybolur. Bu durumda
       tarama baştan başlatılır; sessizce boş sonuç dönmek, kullanıcının
       "tarama bitti ama veri yok" görmesine yol açardı. */
    if(slice.needsReset){ if(needsReset)return {rows:[...found.values()],scannedPages,scannedRows,mode:'direct-api',reason:'scan-state-lost'}; needsReset=true; continue; }
    needsReset=false;
    for(const row of slice.rows||[])if(row&&row.plmId&&!found.has(row.plmId))found.set(row.plmId,row);
    if(slice.scannedPages)scannedPages=slice.scannedPages;
    if(slice.scannedRows)scannedRows=slice.scannedRows;
    if(slice.pageSize)pageSize=slice.pageSize;
    if(typeof options.onProgress==='function')options.onProgress({phase:'PLM listesi taranıyor',current:found.size,total:wanted.length,model:''});
    if(slice.error)return {rows:[...found.values()],scannedPages,scannedRows,mode:'direct-api',bulk:false,pageSize,error:slice.error};
    if(slice.done)break;
  }
  return {rows:[...found.values()],scannedPages,scannedRows,mode:'direct-api',bulk:false,pageSize};
}
function coreNectumReplayHeaders(headers){const allowed={};for(const [key,value] of Object.entries(headers||{})){if(!/^(host|content-length|cookie|origin|referer|connection|accept-encoding|accept-language|user-agent)$/i.test(key)&&!/^sec-/i.test(key)&&!key.startsWith(':'))allowed[key]=value;}return allowed;}
async function coreNectumWaitCapturedImage(capture,imageUrl,timeoutMs=2500){
  const url=coreNectumAttachmentUrl(imageUrl),key=coreNectumImageKey(url);if(!url)return null;const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const image=capture.images.get(url)||capture.images.get(key);if(image)return image;await sleep(100);}return capture.images.get(url)||capture.images.get(key)||null;
}
function coreNectumImageFetchExpression(imageUrl,options={}){
  const url=options&&options.forceRefresh?coreNectumRefreshImageUrl(imageUrl,options.refreshToken):coreNectumAttachmentUrl(imageUrl),value=JSON.stringify(url);
  return `(async()=>{try{const nativeFetch=window.fetch.bind(window),response=await nativeFetch(${value},{credentials:'include',cache:'no-store'});if(!response.ok)return {ok:false,code:'HTTP_ERROR',status:response.status};let blob=await response.blob();if(blob.size<=0)return {ok:false,code:'EMPTY_IMAGE'};if(blob.size>20*1024*1024)return {ok:false,code:'IMAGE_TOO_LARGE',size:blob.size};let bytes=new Uint8Array(await blob.arrayBuffer()),declared=String(blob.type||'').split(';')[0].trim().toLowerCase(),supported=['image/jpeg','image/png','image/webp','image/gif'],mime=supported.includes(declared)?declared:'';if(!mime&&bytes.length>=12){if(bytes[0]===0x89&&String.fromCharCode(...bytes.slice(1,4))==='PNG')mime='image/png';else if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';else if(String.fromCharCode(...bytes.slice(0,3))==='GIF')mime='image/gif';else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';}if(!mime){try{const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('image-convert')),'image/png'));bytes=new Uint8Array(await blob.arrayBuffer());mime='image/png';}catch(_){return {ok:false,code:'UNSUPPORTED_IMAGE',declared,size:blob.size};}}const normalized=new Blob([bytes],{type:mime}),dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('image-read'));reader.readAsDataURL(normalized);}),comma=dataUrl.indexOf(',');if(comma<0)return {ok:false,code:'IMAGE_ENCODING_FAILED'};return {ok:true,mimeType:mime,base64:dataUrl.slice(comma+1)};}catch(error){return {ok:false,code:'FETCH_FAILED',error:String(error&&error.message||error).slice(0,160)};}})()`;
}
function pimTechnicalImageFetchExpression(imageUrl){
  const value=JSON.stringify(pimTechnicalImageUrl(imageUrl));
  return `(async()=>{try{const nativeFetch=window.fetch.bind(window),response=await nativeFetch(${value},{credentials:'include',cache:'no-store'});if(!response.ok)return {ok:false,code:'HTTP_ERROR',status:response.status};let blob=await response.blob();if(blob.size<=0)return {ok:false,code:'EMPTY_IMAGE'};if(blob.size>20*1024*1024)return {ok:false,code:'IMAGE_TOO_LARGE',size:blob.size};let bytes=new Uint8Array(await blob.arrayBuffer()),declared=String(blob.type||'').split(';')[0].trim().toLowerCase(),supported=['image/jpeg','image/png','image/webp','image/gif'],mime=supported.includes(declared)?declared:'';if(!mime&&bytes.length>=12){if(bytes[0]===0x89&&String.fromCharCode(...bytes.slice(1,4))==='PNG')mime='image/png';else if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';else if(String.fromCharCode(...bytes.slice(0,3))==='GIF')mime='image/gif';else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';}if(!mime){try{const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('image-convert')),'image/png'));bytes=new Uint8Array(await blob.arrayBuffer());mime='image/png';}catch(_){return {ok:false,code:'UNSUPPORTED_IMAGE',declared,size:blob.size};}}const normalized=new Blob([bytes],{type:mime}),dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('image-read'));reader.readAsDataURL(normalized);}),comma=dataUrl.indexOf(',');if(comma<0)return {ok:false,code:'IMAGE_ENCODING_FAILED'};return {ok:true,mimeType:mime,base64:dataUrl.slice(comma+1)};}catch(error){return {ok:false,code:'FETCH_FAILED',error:String(error&&error.message||error).slice(0,160)};}})()`;
}
/* v9.58 — GÖRSEL VARSAYILANLARI.
   Eski hedef 5 KB idi. Gerçek bir 1200x1600 ürün fotoğrafıyla tarayıcıda
   ölçüldü: 5 KB için 16 encode, kalite 0.06; 30 KB için 5 encode, kalite 0.26.
   İkisi de gözle görülür şekilde bozuk. 60 KB / 900px ise 5 encode, kalite
   0.49 ve DAHA HIZLI (küçültme döngüsüne hiç girmiyor). Yani eski ayar hem
   yavaşlık hem kalite kaybı ödetiyordu. */
const IMAGE_TARGET_BYTES = 61440;   // 60 KB
const IMAGE_DIMENSION_CAP = 900;    // uzun kenar
const IMAGE_QUALITY_FLOOR = 0.35;

function imageTargetBytes(value){
  return Math.max(1024,Math.min(4*1024*1024,Math.round(Number(value)||IMAGE_TARGET_BYTES)));
}

/* v9.58 — İNDİR VE OPTİMİZE ET: TEK İFADE.
 *
 * Eskiden bu iki iş ayrı `_evaluateValue` çağrılarıydı: görsel tarayıcıda
 * indiriliyor, TAM BOY base64 olarak Node'a geçiyor, sonra optimize için
 * GERİ tarayıcıya gönderiliyordu. 441 KB'lık bir JPEG base64'te ~588 KB;
 * yani görsel başına ~1,2 MB gereksiz veri tek bir CDP soketinden sırayla
 * akıyordu. Optimize zaten tarayıcının içinde çalışıyor — görselin dışarı
 * çıkıp geri girmesi için hiçbir sebep yok.
 *
 * Artık yalnız küçültülmüş sonuç bir kez sınırı geçiyor.
 *
 * Ayrıca:
 *  · decode SIRASINDA yeniden boyutlandırılıyor (createImageBitmap resize*),
 *    ara canvas çizimi yok.
 *  · kalite doğrusal azaltma yerine İKİLİ ARAMA ile bulunuyor.
 *  · OffscreenCanvas varsa o kullanılıyor; yoksa DOM canvas'a düşülüyor.
 */
function coreNectumFetchOptimizeExpression(imageUrl,options={}){
  /* rawUrl: adres zaten normalize edilmis (or. PIM teknik gorseli). */
  const url=options&&options.rawUrl?String(imageUrl||'')
    :(options&&options.forceRefresh?coreNectumRefreshImageUrl(imageUrl,options.refreshToken):coreNectumAttachmentUrl(imageUrl));
  const value=JSON.stringify(url);
  const target=imageTargetBytes(options&&options.maxBytes);
  const cap=Math.max(64,Math.min(4096,Math.round(Number(options&&options.cap)||IMAGE_DIMENSION_CAP)));
  const floor=Math.max(0.05,Math.min(0.95,Number(options&&options.qualityFloor)||IMAGE_QUALITY_FLOOR));

  /* Worker gövdesi: indirme sayfada, GÖRÜNTÜ İŞLEME burada.
     Blob postMessage ile referans olarak geçer, kopyalanmaz. */
  const workerBody=`self.onmessage=async event=>{
try{
const d=event.data,target=d.target,cap=d.cap,floor=d.floor;
let probe=await createImageBitmap(d.blob);
const w0=probe.width,h0=probe.height;probe.close();
if(!w0||!h0){self.postMessage({ok:false,code:'IMAGE_DIMENSIONS_MISSING'});return;}
const ratio=Math.min(1,cap/Math.max(w0,h0));
let width=Math.max(1,Math.round(w0*ratio)),height=Math.max(1,Math.round(h0*ratio));
let bitmap;try{bitmap=await createImageBitmap(d.blob,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});}catch(_){bitmap=await createImageBitmap(d.blob);width=bitmap.width;height=bitmap.height;}
let canvas=new OffscreenCanvas(width,height);
const paint=(cv,w,h,src)=>{const c=cv.getContext('2d',{alpha:false});c.fillStyle='#fff';c.fillRect(0,0,w,h);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(src,0,0,w,h);return cv;};
paint(canvas,width,height,bitmap);bitmap.close();
let encodes=0,best=null,bestQ=0;
const enc=async q=>{encodes++;const b=await canvas.convertToBlob({type:'image/jpeg',quality:q});if(b.size<=target&&q>bestQ){best=b;bestQ=q;}return b;};
let hi=0.92,lo=floor;
const top=await enc(hi);
if(top.size>target){
  const bottom=await enc(lo);
  if(bottom.size<=target){for(let i=0;i<4;i++){const mid=(lo+hi)/2;const b=await enc(mid);if(b.size<=target)lo=mid;else hi=mid;}}
}
if(!best){
  let w=width,h=height,out=null;
  while(Math.max(w,h)>64){
    const longest=Math.max(w,h),next=Math.max(64,Math.round(longest*0.72)),scale=next/longest;
    w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));
    const nc=new OffscreenCanvas(w,h);paint(nc,w,h,canvas);canvas=nc;encodes++;
    out=await canvas.convertToBlob({type:'image/jpeg',quality:floor});
    if(out.size<=target){best=out;bestQ=floor;width=w;height=h;break;}
  }
  if(!best){self.postMessage({ok:false,code:'IMAGE_TARGET_NOT_REACHED',size:out?out.size:0});return;}
}
const buf=new Uint8Array(await best.arrayBuffer());
let bin='';const chunk=0x8000;
for(let i=0;i<buf.length;i+=chunk)bin+=String.fromCharCode.apply(null,buf.subarray(i,i+chunk));
self.postMessage({ok:true,mimeType:'image/jpeg',base64:btoa(bin),size:best.size,width,height,quality:bestQ,encodes});
}catch(error){self.postMessage({ok:false,code:'IMAGE_WORKER_FAILED',error:String(error&&error.message||error).slice(0,160)});}
};`;

  return `(async()=>{try{
const target=${target},cap=${cap},floor=${floor};
const nativeFetch=window.fetch.bind(window);
const response=await nativeFetch(${value},{credentials:'include',cache:'no-store'});
if(!response.ok)return {ok:false,code:'HTTP_ERROR',status:response.status};
const blob=await response.blob();
if(!blob.size)return {ok:false,code:'EMPTY_IMAGE'};
if(blob.size>20*1024*1024)return {ok:false,code:'IMAGE_TOO_LARGE',size:blob.size};
const sourceBytes=blob.size;
const toBase64=async b=>{const buf=new Uint8Array(await b.arrayBuffer());let bin='';const chunk=0x8000;for(let i=0;i<buf.length;i+=chunk)bin+=String.fromCharCode.apply(null,buf.subarray(i,i+chunk));return btoa(bin);};

/* SIFIR ENCODE YOLU: kaynak zaten JPEG ve hedefin altındaysa dokunma.
   En hızlı optimize, hiç yapılmayandır. */
if(blob.type==='image/jpeg'&&sourceBytes<=target){
  return {ok:true,mimeType:'image/jpeg',base64:await toBase64(blob),size:sourceBytes,encodes:0,sourceBytes,path:'as-is'};
}

/* WORKER YOLU — ASIL HIZ KAZANCI.
   Ölçüldü: sayfanın ana iş parçacığında bir JPEG encode ~1005 ms sürüyor
   (pencere odakta değilken tarayıcı ana iş parçacığı görevlerini saniyede
   bire kısıyor); AYNI encode bir Worker içinde ~5 ms. 200 kat fark.
   PLM görsel çekmenin yavaşlamasının asıl sebebi buydu. */
if(typeof Worker==='function'&&typeof OffscreenCanvas==='function'){
  let workerUrl='';
  try{
    workerUrl=URL.createObjectURL(new Blob([${JSON.stringify(workerBody)}],{type:'text/javascript'}));
    const worker=new Worker(workerUrl);
    const result=await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve({ok:false,code:'IMAGE_WORKER_TIMEOUT'}),60000);
      worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
      worker.onerror=e=>{clearTimeout(timer);resolve({ok:false,code:'IMAGE_WORKER_ERROR',error:String(e&&e.message||'').slice(0,160)});};
      worker.postMessage({blob,target,cap,floor});
    });
    try{worker.terminate();}catch(_){}
    try{URL.revokeObjectURL(workerUrl);}catch(_){}
    if(result&&result.ok)return {...result,sourceBytes,path:'worker'};
    /* Worker başarısızsa (CSP blob: engeli vb.) ana iş parçacığına düşülür:
       yavaş ama çalışır. Sessizce boş dönmek kabul edilemez. */
  }catch(_){try{if(workerUrl)URL.revokeObjectURL(workerUrl);}catch(__){}}
}

/* YEDEK: ana iş parçacığı. Worker yoksa veya engellendiyse. */
let probe;try{probe=await createImageBitmap(blob);}catch(_){return {ok:false,code:'UNSUPPORTED_IMAGE',declared:String(blob.type||''),size:sourceBytes};}
const w0=probe.width,h0=probe.height;probe.close();
if(!w0||!h0)return {ok:false,code:'IMAGE_DIMENSIONS_MISSING'};
const ratio=Math.min(1,cap/Math.max(w0,h0));
const width=Math.max(1,Math.round(w0*ratio)),height=Math.max(1,Math.round(h0*ratio));
let bitmap;try{bitmap=await createImageBitmap(blob,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});}catch(_){bitmap=await createImageBitmap(blob);}
const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):Object.assign(document.createElement('canvas'),{width,height});
const ctx=canvas.getContext('2d',{alpha:false});
ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
const encode=q=>canvas.convertToBlob?canvas.convertToBlob({type:'image/jpeg',quality:q})
  :new Promise((res,rej)=>canvas.toBlob(v=>v?res(v):rej(new Error('jpeg-encode')),'image/jpeg',q));
let best=null,bestQ=0,encodes=0;
const tryQ=async q=>{encodes++;const b=await encode(q);if(b.size<=target&&q>bestQ){best=b;bestQ=q;}return b;};
let hi=0.92,lo=floor;
const top=await tryQ(hi);
if(top.size>target){const bottom=await tryQ(lo);if(bottom.size<=target){for(let i=0;i<4;i++){const mid=(lo+hi)/2;const b=await tryQ(mid);if(b.size<=target)lo=mid;else hi=mid;}}}
if(!best)return {ok:false,code:'IMAGE_TARGET_NOT_REACHED'};
return {ok:true,mimeType:'image/jpeg',base64:await toBase64(best),size:best.size,width,height,quality:bestQ,encodes,sourceBytes,path:'main-thread'};
}catch(error){return {ok:false,code:'IMAGE_PIPELINE_FAILED',error:String(error&&error.message||error).slice(0,160)};}})()`;
}

/* Tek turda indirir ve optimize eder. Sonuç zaten hedef boyutta olduğu için
   ayrıca ikinci bir optimizasyon turu gerekmez. */
async function coreNectumFetchOptimizedImage(page,imageUrl,options={}){
  const url=options&&options.rawUrl?String(imageUrl||''):coreNectumAttachmentUrl(imageUrl);if(!url)return null;
  const expression=coreNectumFetchOptimizeExpression(url,options);
  return page._evaluateValue(expression)
    .catch(error=>({ok:false,code:'CDP_TRANSFER_FAILED',error:clean(error&&error.message).slice(0,160)}));
}

async function coreNectumImageFromUrl(page,imageUrl,options={}){
  const url=coreNectumAttachmentUrl(imageUrl);if(!url)return null;
  /* v6.41 — kullanıcı bu betiği Terminal'den düzenlediyse onun sürümü çalışır.
     Düzenleme yoksa expressionFor fabrika ifadesini AYNEN döndürür, yani
     davranış birebir eskisi gibi kalır. */
  const forceRefresh=options&&options.forceRefresh===true;
  const fallback=coreNectumImageFetchExpression(url,{forceRefresh,refreshToken:options&&options.refreshToken});
  const resolved=forceRefresh?{expression:fallback}:webScriptRegistry.expressionFor('corenectum.image.fetch',{url},fallback);
  return page._evaluateValue(resolved.expression).catch(error=>({ok:false,code:'CDP_TRANSFER_FAILED',error:clean(error&&error.message).slice(0,160)}));
}
function coreNectumUsableImage(image){return Boolean(image&&/^image\/(jpeg|png|webp|gif)$/.test(clean(image.mimeType).toLowerCase())&&clean(image.base64));}
function coreNectumImagePayloadIsValid(image){
  if(!coreNectumUsableImage(image))return false;
  try{return Boolean(coreNectumImageMime(Buffer.from(clean(image.base64),'base64')));}catch(_){return false;}
}

async function collectAsasTechnicalImages(ownerId,items=[],options={}){
  const maxBytes=imageTargetBytes(options&&options.maxBytes);
  const candidates=(Array.isArray(items)?items:[]).map(item=>({
    key:clean(item&&item.key).slice(0,240),url:pimTechnicalImageUrl(item&&item.url),plmId:clean(item&&item.plmId),colourCode:clean(item&&item.colourCode),
  })).filter(item=>item.key&&item.url);
  const images=new Map(),failures=new Map();
  if(!candidates.length)return{images,failures,requested:0};
  const {context}=await ensureContext(ownerId);
  const page=await pageForCurrentBuyerLogProfile(context,'about:blank');
  try{
    // Aynı-origin fetch için PIM origininde boş bir sayfa açılır. Kök adresin
    // 404 dönmesi sorun değildir; önemli olan sayfanın güvenli PIM origininde
    // çalışması ve mevcut Edge/kurumsal oturumu kullanmasıdır.
    await page.goto('https://pim.prod.lcwaikiki.com/',{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    let cursor=0;
    async function worker(){
      while(cursor<candidates.length){
        const item=candidates[cursor++];
        const probe=await page._evaluateValue(pimTechnicalImageFetchExpression(item.url)).catch(error=>({ok:false,code:'CDP_TRANSFER_FAILED',error:clean(error&&error.message).slice(0,160)}));
        if(!coreNectumUsableImage(probe)){
          failures.set(item.key,{code:clean(probe&&probe.code)||'PIM_IMAGE_FETCH_FAILED',error:'ASAS teknik resmi ham biçiminde alınamadı.'});
          continue;
        }
        images.set(item.key,{...probe,filename:`asas-${item.plmId||'model'}-${item.colourCode||'colour'}.${probe.mimeType==='image/png'?'png':probe.mimeType==='image/webp'?'webp':probe.mimeType==='image/gif'?'gif':'jpg'}`});
        options.onProgress?.({phase:'Görsel alınıyor',current:images.size,total:candidates.length,model:item.plmId||item.key});
      }
    }
    /* v9.58 — Görsel indirme AĞ beklemesi, sıkıştırma ise CPU. İndirme ve
       optimize tek tura indiği için işçi başına bekleme azaldı; dört işçi ağ
       gecikmesini örtüyor ve Edge'i kilitlemiyor. */
    await Promise.all(Array.from({length:Math.min(4,candidates.length)},()=>worker()));
  }finally{try{await page.close();}catch(_){}}
  return{images,failures,requested:candidates.length};
}
function coreNectumImageFailure(probe,imageUrl){
  if(!coreNectumAttachmentUrl(imageUrl))return {code:'CORENECTUM_IMAGE_URL_MISSING',error:'CoreNectum model.imageUrl alanı boş veya geçersiz.'};
  const code=clean(probe&&probe.code)||'CORENECTUM_IMAGE_RESPONSE_MISSING',status=Number(probe&&probe.status)||0,declared=clean(probe&&probe.declared),detail=clean(probe&&probe.error);
  const suffix=status?` (HTTP ${status})`:declared?` (${declared})`:detail?` (${detail})`:'';
  return {code,error:`CoreNectum Attachment görseli alınamadı: ${code}${suffix}.`};
}
async function coreNectumBulkImages(page,capture,records,concurrency=6,options={}){
  const forceRefresh=options&&options.forceRefresh===true,output=new Map(),failures=new Map(),queue=(records||[]).slice();output.failures=failures;let cursor=0;
  async function worker(){while(cursor<queue.length){
    const record=queue[cursor++],url=coreNectumAttachmentUrl(record.imageUrl);
    if(!url){failures.set(record.plmId,coreNectumImageFailure(null,record.imageUrl));continue;}
    let image=null,probe=null;
    if(forceRefresh){
      /* Manual Refresh must never fall back to a possibly cached captured image.
         v9.58: indirme ve optimize TEK ifadede; tam boy görsel CDP sınırını
         hiç geçmiyor (bkz. coreNectumFetchOptimizeExpression). */
      probe=await coreNectumFetchOptimizedImage(page,url,{forceRefresh:true,refreshToken:options.refreshToken,maxBytes:options.maxBytes,cap:options.cap});
      if(coreNectumImagePayloadIsValid(probe))image=probe;
    }else{
      image=await coreNectumWaitCapturedImage(capture,url,100);
      if(!image){probe=await coreNectumImageFromUrl(page,url);if(coreNectumUsableImage(probe))image=probe;else image=await coreNectumWaitCapturedImage(capture,url,2500);}
    }
    if(coreNectumUsableImage(image))output.set(record.plmId,image);else failures.set(record.plmId,coreNectumImageFailure(probe,url));
  }}
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),queue.length||1)},()=>worker()));return output;
}
async function coreNectumStyleListRowImage(page,plmId,timeoutMs=12000){
  const deadline=Date.now()+timeoutMs,wanted=JSON.stringify(plmId);
  while(Date.now()<deadline){
    const result=await page._evaluateValue(`(async()=>{const wanted=${wanted},clean=v=>String(v||'').replace(/\s+/g,' ').trim();const rows=[...new Set([...document.querySelectorAll('a')].filter(el=>clean(el.textContent)===wanted).map(el=>el.closest('tr')).filter(Boolean))];if(rows.length!==1)return null;const row=rows[0];const rowImage=[...row.querySelectorAll('img')].find(img=>img.complete&&img.naturalWidth>0&&img.naturalHeight>0);if(!rowImage)return null;rowImage.scrollIntoView({block:'center'});for(const type of ['pointerenter','mouseenter','mouseover'])rowImage.dispatchEvent(new MouseEvent(type,{bubbles:true,view:window}));await new Promise(resolve=>setTimeout(resolve,450));const visible=el=>{if(!el||!el.isConnected)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0&&r.width>=20&&r.height>=20;};const overlay=[...document.querySelectorAll('.cdk-overlay-container img,.cdk-overlay-pane img,[role="tooltip"] img')].filter(visible);const img=overlay.sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.width*br.height-ar.width*ar.height;})[0]||rowImage;const src=String(img.currentSrc||img.src||'');try{let dataUrl='';if(/^data:image\//i.test(src))dataUrl=src;else{const response=await fetch(src,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const blob=await response.blob();if(!/^image\/(jpeg|png|webp|gif)$/i.test(blob.type)||blob.size<=0||blob.size>20*1024*1024)return null;dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('image-read'));reader.readAsDataURL(blob);});}const match=/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/is.exec(dataUrl);if(match)return {mimeType:match[1].toLowerCase(),base64:match[2],width:img.naturalWidth||0,height:img.naturalHeight||0};}catch(_){}try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);const dataUrl=canvas.toDataURL('image/png'),match=/^data:(image\/png);base64,(.+)$/s.exec(dataUrl);if(match)return {mimeType:'image/png',base64:match[2],width:canvas.width,height:canvas.height};}catch(_){}const r=img.getBoundingClientRect();return {clip:{x:Math.max(0,r.left+scrollX),y:Math.max(0,r.top+scrollY),width:Math.max(1,r.width),height:Math.max(1,r.height)}};})()`).catch(()=>null);
    if(result&&result.base64)return result;
    if(result&&result.clip){const scale=Math.max(1,Math.min(3,1200/Math.max(result.clip.width,result.clip.height))),shot=await page.client.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{...result.clip,scale}},30000).catch(()=>null);if(shot&&shot.data)return {mimeType:'image/png',base64:shot.data,width:Math.round(result.clip.width*scale),height:Math.round(result.clip.height*scale),captured:true};}
    await sleep(200);
  }
  return null;
}
async function coreNectumSelectedStyleRows(page){
  if(!page||typeof page._evaluateValue!=='function')return [];
  const rows=await page._evaluateValue(`(async()=>{const clean=value=>String(value==null?'':value).replace(/\\s+/g,' ').trim(),read=(row,key)=>clean(row.querySelector('[data-column-id="'+key+'"]')?.textContent),visible=element=>{if(!element||!element.isConnected)return false;const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)!==0&&rect.width>0&&rect.height>0;},label=(text,key)=>{const match=new RegExp('(?:^|\\\\s)'+key+'\\\\s*-\\\\s*(.*)$','i').exec(clean(text));return clean(match&&match[1]);},popup=()=>[...document.querySelectorAll('.cdk-overlay-container .color-popover-menu,.mat-mdc-menu-panel.color-popover-menu')].find(visible),readColours=async row=>{const cell=row.querySelector('[data-column-id="colors"]');if(!cell)return [];const targets=[...cell.querySelectorAll('.color-dots__hoverTarget')].length?[...cell.querySelectorAll('.color-dots__hoverTarget')]:[...cell.querySelectorAll('.color-dots__dot')],colours=[];for(const target of targets){target.scrollIntoView({block:'center'});target.click();let menu=null;const deadline=Date.now()+1200;while(Date.now()<deadline){menu=popup();if(menu)break;await new Promise(resolve=>setTimeout(resolve,50));}if(menu){const texts=[...menu.querySelectorAll('.color-info__text')].map(item=>clean(item.textContent));const name=texts.map(text=>label(text,'Color Name')).find(Boolean)||'',colorCode=texts.map(text=>label(text,'Color Code')).find(Boolean)||'',pantone=texts.map(text=>label(text,'Pantone')).find(Boolean)||'';if(name||colorCode||pantone)colours.push({name,colorCode,pantone});target.click();}else{target.click();}await new Promise(resolve=>setTimeout(resolve,50));}return colours;};const selected=[...document.querySelectorAll('table tbody tr')].filter(row=>row.querySelector('input[type="checkbox"]:checked')),result=[];for(const row of selected){const item={plmId:read(row,'plmCode'),styleName:read(row,'styleName'),specialCode:read(row,'specialCode')};if(/^\\d+$/.test(item.plmId)){const colours=await readColours(row);if(colours.length)item.colors=colours;result.push(item);}}return result;})()`).catch(()=>[]);
  return Array.isArray(rows)?rows:[];
}
async function coreNectumRestoreSelectedStyleRows(page,selected=[]){
  if(!page||typeof page._evaluateValue!=='function')return 0;
  const wanted=[...new Set((Array.isArray(selected)?selected:[]).map(item=>coreNectumId(item&&item.plmId)).filter(Boolean))];
  if(!wanted.length)return 0;
  const restored=await page._evaluateValue(`(async()=>{const wanted=new Set(${JSON.stringify(wanted)}),clean=value=>String(value==null?'':value).replace(/\\s+/g,' ').trim(),read=row=>clean(row.querySelector('[data-column-id="plmCode"]')?.textContent),deadline=Date.now()+5000;let count=0;while(Date.now()<deadline){count=0;for(const row of document.querySelectorAll('table tbody tr')){const id=read(row),checkbox=row.querySelector('input[type="checkbox"]');if(!wanted.has(id)||!checkbox)continue;if(!checkbox.checked)checkbox.click();if(checkbox.checked)count+=1;}if(count>=wanted.size)break;await new Promise(resolve=>setTimeout(resolve,100));}return count;})()`).catch(()=>0);
  return Number.isFinite(Number(restored))?Number(restored):0;
}
/* Metadata-only PLM Sync does not need to drive the visible Style List UI.
   Buyer Log Desktop obtains the current CoreNectum authorization automatically
   from its dedicated corporate SSO session and keeps the captured Bearer only
   in backend memory. Normal PLM Sync therefore has no Edge/CDP dependency.
   Only the special 'PLM-selected' DOM action still needs an already-open PLM
   page because its checkbox selection exists only there. */
async function collectCoreNectumStyleLinksDirect(ownerId,candidates,options,trail){
  const requested=coreNectumStyleApi.dedupePlmCodes(candidates),requestedSet=new Set(requested),candidateByPlm=new Map();
  for(const item of candidates)if(item&&item.plmId&&!candidateByPlm.has(item.plmId))candidateByPlm.set(item.plmId,item);
  if(!requested.length)throw plmSyncDiagnostics.attach(connectorError('Eşleştirilecek geçerli PLM ID bulunamadı.','CORENECTUM_ITEMS_EMPTY'),trail);
  const found=new Map(),ambiguous=new Set();let scannedPages=0,scannedRows=0,processed=0;
  const session=await openCoreNectumStyleApiSession(ownerId,{trail,isCancelled:options&&options.isCancelled});
  const ingest=payload=>{
    const records=coreNectumStyleApi.styleListRecords(payload);scannedPages+=1;scannedRows+=records.length;
    const normalized=coreNectumStyleApi.styleListRowsByPlm(payload),fullRows=coreNectumStyleListRows(payload),fullByPlm=new Map(fullRows.map(row=>[row.plmId,row]));
    for(const plmId of normalized.ambiguous||[]){if(requestedSet.has(plmId)){ambiguous.add(plmId);found.delete(plmId);}}
    for(const [plmId,row] of normalized.rows||[]){
      if(!requestedSet.has(plmId)||ambiguous.has(plmId))continue;
      const full=fullByPlm.get(plmId)||{},merged={...full,...row,plmId};
      // Legacy PLM consumers expect colors as {colorCode,name,...}; keep the
      // richer existing normalizer when it is available instead of replacing
      // it with the API helper's {colourCode,colour,...} shape.
      if(Array.isArray(full.colors)&&full.colors.length)merged.colors=full.colors;
      found.set(plmId,merged);
    }
  };
  const scanBatch=async codes=>{
    try{ingest(await session.styleListLookup(codes));}
    catch(error){
      const fallbacks=Array.isArray(coreNectumStyleApi.STYLE_LIST_FALLBACK_SIZES)?coreNectumStyleApi.STYLE_LIST_FALLBACK_SIZES:[];
      const next=fallbacks.find(size=>size<codes.length&&size>0);
      /* Match PLM_Image_Test_v2: auth failures are terminal, while transport/
         HTTP/batch failures step down 100 -> 50 -> 20 before giving up. */
      const authFailure=error&&['CORENECTUM_API_TOKEN_INVALID','CORENECTUM_API_TOKEN_REQUIRED'].includes(error.code);
      if(!authFailure&&next){for(const child of coreNectumStyleApi.splitBatches(codes,next))await scanBatch(child);return;}
      throw error;
    }
    processed+=codes.length;
    if(typeof options?.onProgress==='function')await Promise.resolve(options.onProgress({phase:'PLM verisi alınıyor',current:Math.min(processed,requested.length),total:requested.length,model:codes[codes.length-1]||''})).catch(()=>{});
  };
  try{
    for(const batch of coreNectumStyleApi.splitBatches(requested,coreNectumStyleApi.STYLE_LIST_BATCH_SIZE))await scanBatch(batch);
    const links=[],failed=[];
    for(const plmId of requested){
      if(ambiguous.has(plmId)){failed.push({plmId,error:'Aynı PLM ID için birden fazla çelişen CoreNectum kaydı bulundu.',code:'CORENECTUM_STYLE_AMBIGUOUS'});continue;}
      const row=found.get(plmId),input=candidateByPlm.get(plmId)||{};
      if(!row){failed.push({plmId,error:'CoreNectum Style List içinde model bulunamadı.',code:'CORENECTUM_STYLE_NOT_FOUND'});continue;}
      const merged={...row,styleName:clean(row.styleName||input.styleName).slice(0,300)};
      const mergedColours=coreNectumMergeColourVariants(row.colors||row.colours,input.colors||input.colours);
      if(mergedColours.length)merged.colors=mergedColours;
      links.push(merged);
    }
    trail.record('STYLE_LIST_HTTP_STATUS',{status:200,ok:true,direct:true});
    trail.record('STYLE_LIST_RESPONSE_RECORDS',{records:scannedRows,pages:scannedPages,requested:requested.length,direct:true});
    trail.record('STYLE_LIST_NORMALIZED',{matched:links.length,requested:requested.length,notFound:failed.length,direct:true});
    return {links,failed,imageFailed:[],requested:requested.length,scannedPages,scannedRows,diagnostics:trail.snapshot()};
  }catch(error){throw plmSyncDiagnostics.attach(error,trail);}
  finally{await session.close().catch(()=>{});}
}
async function collectCoreNectumStyleLinks(ownerId,items=[],options={}){
  const imageMaxBytes=imageTargetBytes(options&&options.maxBytes),imageMaxKb=Math.ceil(imageMaxBytes/1024);
  const forceRefreshImages=options&&options.forceRefreshImages===true,refreshToken=forceRefreshImages?`${Date.now()}-${crypto.randomBytes(6).toString('hex')}`:'';
  const selectedOnly=options&&options.selectedOnly===true;
  let candidates=(Array.isArray(items)?items:[]).map(item=>({plmId:coreNectumId(item&&item.plmId),styleId:coreNectumId(item&&item.styleId),styleName:clean(item&&item.styleName).slice(0,300),colourCode:clean(item&&(item.colourCode||item.colorCode)).slice(0,80),colour:clean(item&&(item.colour||item.color)).slice(0,160),needImage:item&&item.needImage!==false})).filter(item=>item.plmId);
  const trail=options.diagnostics||plmSyncDiagnostics.createTrail();
  // Normal PLM table sync is metadata-only. Keep it off the visible page and
  // call CoreNectum directly through the already authenticated browser session.
  if(!selectedOnly&&candidates.length&&candidates.every(item=>item.needImage===false))
    return collectCoreNectumStyleLinksDirect(ownerId,candidates,options,trail);
  const entry=selectedOnly ? await ensureExistingContext(ownerId) : await ensureContext(ownerId);
  const context=entry.context;
  trail.record('BROWSER_DISCOVERED',{found:true,browser:entry.browserName||'edge'});
  trail.record('CDP_CONNECTED',{connected:true,port:Number(entry.port)||0,profileMode:entry.profileMode||''});
  await context.syncPages().catch(()=>{});
  /* Style List sekmesi YALNIZ mevcut kullanıcının profilinde aranır. Eskiden
     ilk bulunan sekme alınıyordu; ikinci bir Edge profili açıkken bu, başka
     birinin sekmesinde çalışmak demekti. */
  const binding=coreNectumProfileBinding(context);
  const isStyleListTab=candidate=>{try{const url=new URL(candidate.url());return !candidate.isClosed()&&url.hostname.toLowerCase()==='corenectum.lcwaikiki.com'&&/\/models-options\/style-list\/?$/i.test(url.pathname);}catch(_){return false;}};
  let page=context.pages().find(candidate=>isStyleListTab(candidate)&&pageIsInBoundProfile(candidate,binding));
  const foreignStyleListTab=!page&&context.pages().some(isStyleListTab);
  const reusedStyleListTab=Boolean(page);
  if(page)trail.record('BROWSER_PROFILE_RESOLVED',{source:`style-list-tab:${binding.source}`,bound:true,boundContext:Boolean(page.browserContextId),styleListTab:true});
  else{
    trail.record('BROWSER_PROFILE_RESOLVED',{source:binding.source,bound:binding.bound,boundContext:Boolean(binding.browserContextId),styleListTab:false,foreignStyleListTab});
    /* selectedOnly akışında YENİ SEKME de açılmaz. Seçim zaten kullanıcının
       açık Style List DOM'unda yaşar; sekme yoksa işlem burada durur. */
    if(selectedOnly)throw plmSyncDiagnostics.attach(connectorError(foreignStyleListTab
      ?'Açık CoreNectum Style List sekmesi başka bir Edge profiline ait. Buyer Log yeni Edge/sekme açmaz; kendi açık Style List sekmenizi kullanın.'
      :'Buyer Log açık bir CoreNectum Style List sekmesi bulamadı. Yeni Edge veya boş sekme açılmadı. CoreNectum Style List’i mevcut Edge oturumunuzda açık bırakıp modelleri seçtikten sonra tekrar deneyin.',
      foreignStyleListTab?'CORENECTUM_STYLE_LIST_TAB_OTHER_PROFILE':'CORENECTUM_STYLE_LIST_TAB_MISSING',409,{launchesBrowser:false}),trail);
    if(!binding.bound)throw plmSyncDiagnostics.attach(connectorError(coreNectumUnboundProfileMessage(binding),'BROWSER_PROFILE_UNBOUND',409),trail);
    page=reusableBlankPageInBoundProfile(context,binding)||await pageInBoundProfile(context,'about:blank',binding);
  }
  /* SEÇİLİ MODELLER kullanıcının AÇIK sekmesinin DOM'unda yaşar. Buyer Log
     kendi yeni sekmesini açarsa o sekmede hiçbir satır işaretli değildir ve
     eskiden bu durum "Style List sayfasında seçili model bulunamadı" diye
     bildiriliyordu — kullanıcı seçimi yapmış olduğu hâlde. İki durum artık
     ayrıdır: sekme YOK / sekme var ama seçim yok. */
  if(selectedOnly){
    const selected=await coreNectumSelectedStyleRows(page);
    candidates=selected.map(item=>({...item,plmId:coreNectumId(item.plmId),styleName:clean(item.styleName).slice(0,300),colourCode:'',needImage:false})).filter(item=>item.plmId);
  }
  if(!candidates.length)throw plmSyncDiagnostics.attach(connectorError(selectedOnly?'Açık CoreNectum Style List sekmesinde işaretli model yok. Satırların solundaki kutuları işaretleyip tekrar deneyin.':'Eşleştirilecek geçerli PLM ID bulunamadı.',selectedOnly?'CORENECTUM_SELECTED_ITEMS_EMPTY':'CORENECTUM_ITEMS_EMPTY'),trail);
  /* Seçili-model aktarımında PLM ID'leri DOM'dan zaten okundu. Eski yol bu
     ID'leri yeniden bulmak için Style List'i yenileyip bütün sayfaları
     tarıyordu. Bu hem kullanıcı seçimini gereksiz yere bozuyor hem de
     yakalanan ağ olayında Authorization başlığı eksik kaldığında replay'i
     401/403'e düşürebiliyordu. Artık yalnız seçili PLM kodları doğrulanmış
     GetStyleList filtresiyle hedefli sorgulanır; görünür sayfa yenilenmez. */
  if(selectedOnly)return collectCoreNectumStyleLinksDirect(ownerId,candidates,options,trail);
  // Model görseli yalnız Style List'ten okunduğu için açık bir Style Overview
  // (model detay) sekmesi artık görsel işi için seçilmez.
  const capture=await coreNectumListCapture(page),requestedByPlm=new Map(),wanted=new Map(),links=[],imageFailed=[],found=new Set(),ambiguousIds=new Set();
  for(const candidate of candidates){const key=coreNectumColourImageKey(candidate);if(!key||wanted.has(key))continue;wanted.set(key,candidate);const list=requestedByPlm.get(candidate.plmId)||[];list.push(candidate);requestedByPlm.set(candidate.plmId,list);}
  candidates=[...wanted.values()];const recordPlan=coreNectumImageRecordPlan(candidates);let scannedPages=0,scannedRows=0;
  try{
    let scannedRecords=[];
    if(recordPlan.scanIds.length){
      await page.goto(CORENECTUM_STYLE_LIST_URL,{waitUntil:'domcontentloaded',timeout:45000});
      const ready=await coreNectumStyleListReady(page,30000);
      trail.record('CORENECTUM_PAGE_READY',{ready,opened:true});
      if(!ready)throw plmSyncDiagnostics.attach(connectorError('CoreNectum Style List açılamadı. Açılan Edge sekmesinde CoreNectum girişini tamamlayıp tekrar deneyin.','CORENECTUM_LOGIN_REQUIRED',409),trail);
      /* Oturum durumu İSTEKTEN ÖNCE okunur (yalnız VAR/YOK, değer okunmaz).
         Anahtar yokken tarama 200 + BOŞ liste de dönebiliyor ve o zaman
         "model bulunamadı" diyerek oturum sorununu maskeliyorduk. */
      const auth=await coreNectumAuthState(page);
      trail.record('AUTH_STATE',{present:auth.present,format:auth.format,cookies:auth.cookies,origin:auth.origin});
      if(!auth.present&&!auth.cookies)throw plmSyncDiagnostics.attach(connectorError('Bu bilgisayarda CoreNectum oturumu bulunamadı. Açılan Edge sekmesinde CoreNectum\'a giriş yapıp tekrar deneyin.','CORENECTUM_LOGIN_REQUIRED',409),trail);
      if(selectedOnly)await coreNectumRestoreSelectedStyleRows(page,candidates);
      const initialBatchPromise=coreNectumWaitListBatch(capture,0,'',5000);
      // Tarama artık parçalı ilerlediği için her parçada ilerleme bildirilebilir;
      // eskiden tek uzun CDP çağrısı boyunca kullanıcı hiçbir geri bildirim
      // görmüyordu (bkz. coreNectumBulkApiScan başındaki not).
      trail.record('STYLE_LIST_REQUEST_SENT',{sent:true,wanted:recordPlan.scanIds.length});
      const direct=await coreNectumBulkApiScan(page,capture,recordPlan.scanIds,{
        onProgress:options.onProgress,
        /* Liste isteği doğmadıysa GERÇEK bir yenileme yapılır. Seçili model
           akışında işaretler yenilemeyle silinir; bu yüzden hemen ardından
           kullanıcının seçimi geri işaretlenir (kimlikler zaten elimizde). */
        refresh:async()=>{
          trail.record('STYLE_LIST_REQUEST_SENT',{sent:true,wanted:recordPlan.scanIds.length,refreshed:true});
          await page.client.send('Page.reload',{ignoreCache:true},20000).catch(()=>{});
          await coreNectumStyleListReady(page,30000);
          if(selectedOnly)await coreNectumRestoreSelectedStyleRows(page,candidates);
        },
      });
      if(!direct||!direct.scannedPages){
        const initialBatch=await initialBatchPromise;
        // Yalnız GERÇEK sebepler gösterilir; atılmış yanıt gövdesi sebep değildir.
        const detail=(capture.errors||[]).find(item=>item&&!item.evicted)?.error;
        const reason=direct&&direct.reason||'',directError=clean(direct&&direct.error).slice(0,240);
        const statusMatch=/HTTP\s+(\d{3})/i.exec(directError),replayStatus=statusMatch?Number(statusMatch[1]):0;
        if(replayStatus)trail.record('STYLE_LIST_HTTP_STATUS',{status:replayStatus,ok:false,replay:true});
        trail.record('STYLE_LIST_SCAN_FAILED',{reason:reason||'no-pages',initialBatch:Boolean(initialBatch),captureErrors:(capture.errors||[]).length});
        const classified=trail.classify(),classifiedMessage=classified&&classified.code!=='OK'?classified.message:'';
        const message=classifiedMessage
          || (reason==='no-template'
          ? 'Buyer Log, CoreNectum\'un kendi Style List isteğini yakalayamadı (istek gövdesi tarayıcıdan okunamadı). Style List sekmesini yenileyip (F5) listenin dolmasını bekleyin, sonra tekrar deneyin.'
          : reason==='scan-state-lost'
          ? 'CoreNectum Style List taraması sırasında sayfa yenilendi ve tarama durumu kayboldu. Sekmede gezinmeden tekrar deneyin.'
          : directError?`CoreNectum GetStyleList API yeniden çağrısı başarısız: ${directError}`
          : detail?`CoreNectum GetStyleList API okunamadı: ${detail}`
          : initialBatch?'CoreNectum GetStyleList API sayfalaması okunamadı.'
          : `CoreNectum Style List isteği yakalanamadı. Kullanılan Edge sekmesinde (${binding.source}) CoreNectum oturumu açık olmayabilir; Buyer Log'u kullandığınız Edge profilinde CoreNectum'a girip tekrar deneyin.`);
        const code=classified&&classified.code&&classified.code!=='OK'?classified.code:'CORENECTUM_DIRECT_API_UNAVAILABLE';
        throw plmSyncDiagnostics.attach(connectorError(message,code,409),trail);
      }
      scannedPages=direct.scannedPages;scannedRows=direct.scannedRows;scannedRecords=direct.rows||[];
      trail.record('STYLE_LIST_HTTP_STATUS',{status:200,ok:true});
      trail.record('STYLE_LIST_RESPONSE_RECORDS',{records:scannedRows,pages:scannedPages,requested:recordPlan.scanIds.length});
      /* İstek başarılı ama TARANAN EVREN boş. Bu "model bulunamadı" DEĞİLDİR:
         bu hesabın Style List kapsamı boş ya da ekranda daraltan bir durum
         var. İkisini aynı cümleyle bildirmek, kullanıcıyı modelin PLM'de
         olmadığına inandırıyordu. */
      if(!scannedRows){
        /* Sebep, izin EN ERKEN kopan halkasından okunur. Oturum anahtarı yokken
           (yalnız çerez varken) sorgu 200 + boş liste döndürebiliyor; bunu
           "kapsam boş" diye bildirmek de "model bulunamadı" kadar yanlış olurdu. */
        const cause=trail.classify();
        const code=cause.code&&cause.code!=='OK'?cause.code:'CORENECTUM_SCOPE_EMPTY';
        const message=cause.message||'CoreNectum GetStyleList isteği başarılı oldu ama hiç model döndürmedi.';
        throw plmSyncDiagnostics.attach(connectorError(message,code,409),trail);
      }
    }
    const recordMap=new Map([...recordPlan.knownRecords,...scannedRecords].map(record=>[record.plmId,{...record,imageUrl:coreNectumAttachmentUrl(record.imageUrl)}]));
    // Aynı PLM ID için Style List taraması birbiriyle çelişen birden fazla satır
    // döndürdüyse keyfi satır seçilmez; model "belirsiz" sayılıp failed'a düşer.
    // Karşılaştırma yalnız TARANAN satırlar arasında yapılır: kayıtlı link
    // kaydının (knownRecords) görseli zaten boştur, çelişki değildir.
    const scanSignatures=new Map();
    for(const record of scannedRecords){
      const plmId=coreNectumId(record&&record.plmId);if(!plmId)continue;
      const signature=`${coreNectumId(record&&record.styleId)}\u0000${coreNectumAttachmentUrl(record&&record.imageUrl)}`;
      if(scanSignatures.has(plmId)){if(scanSignatures.get(plmId)!==signature)ambiguousIds.add(plmId);}else scanSignatures.set(plmId,signature);
    }
    for(const plmId of ambiguousIds)recordMap.delete(plmId);
    const records=[...recordMap.values()],selectionPlans=new Map(records.map(record=>[record.plmId,coreNectumImageSelectionPlan(requestedByPlm.get(record.plmId)||[],record)])),imageRecords=records.filter(record=>selectionPlans.get(record.plmId)?.hasGenericRequest),images=imageRecords.length?await coreNectumBulkImages(page,capture,imageRecords,6,{forceRefresh:forceRefreshImages,refreshToken,maxBytes:imageMaxBytes}):new Map();
      for(const record of records){
        const requestedList=requestedByPlm.get(record.plmId);if(!requestedList)continue;
        const selection=selectionPlans.get(record.plmId)||coreNectumImageSelectionPlan(requestedList,record);
        let genericImage=images.get(record.plmId)||null;
        if(selection.hasGenericRequest&&!coreNectumUsableImage(genericImage))genericImage=await coreNectumStyleListRowImage(page,record.plmId,1500);
        // Renk seviyesinde PLM kaynağı YOKTUR: Style List görseli modelin bütün
        // renkleri için ortak varsayılandır, bu yüzden colourImages hep boştur.
        const colourImages=new Map();
        for(const requested of requestedList){
          const needsImage=requested.needImage,image=coreNectumResolveRequestedImage(requested,colourImages,genericImage,{preferGeneric:selection.useGenericFor(requested),allowGenericFallback:false});
          if(needsImage&&!coreNectumUsableImage(image)){let failure=null;if(genericImage&&genericImage.code)failure={code:genericImage.code,error:`CoreNectum görseli ${imageMaxKb} KB hedefine optimize edilemedi: ${genericImage.code}${genericImage.error?` (${genericImage.error})`:''}.`};if(!failure)failure=images.failures&&images.failures.get(record.plmId)||coreNectumImageFailure(null,record.imageUrl);imageFailed.push({plmId:record.plmId,colourCode:requested.colourCode||'',colour:requested.colour||'',styleName:record.styleName||requested.styleName,...failure});}
          const colours=coreNectumMergeColourVariants(record.colors||record.colours,requested.colors),linkedRecord={...record};if(colours.length)linkedRecord.colors=colours;if(requested.colourCode)linkedRecord.colourCode=requested.colourCode;if(requested.colour)linkedRecord.colour=requested.colour;
          links.push({...linkedRecord,styleName:linkedRecord.styleName||requested.styleName,image:image&&coreNectumUsableImage(image)?{...image,filename:`corenectum-${record.plmId}${requested.colourCode?`-${clean(requested.colourCode).replace(/[^a-z0-9_-]/gi,'_')}`:''}.${image.mimeType==='image/png'?'png':image.mimeType==='image/webp'?'webp':image.mimeType==='image/gif'?'gif':'jpg'}`}:null});found.add(coreNectumColourImageKey(requested));
          options.onProgress?.({phase:requested.needImage?'Görsel alınıyor':'PLM linki aranıyor',current:found.size,total:candidates.length,model:record.plmId});
        }
      }
  } finally {await capture.stop();}
  const failed=candidates.filter(item=>!found.has(coreNectumColourImageKey(item))).map(item=>ambiguousIds.has(item.plmId)
    ?{plmId:item.plmId,colourCode:item.colourCode||'',styleName:item.styleName,error:`PLM ${item.plmId} için Style List'te birbiriyle çelişen birden fazla satır bulundu; keyfi satır seçilmedi.`,code:'CORENECTUM_STYLE_AMBIGUOUS'}
    :{plmId:item.plmId,colourCode:item.colourCode||'',styleName:item.styleName,error:`PLM ${item.plmId} GetStyleList API verilerinde bulunamadı.`,code:'CORENECTUM_STYLE_NOT_FOUND'});
  trail.record('STYLE_LIST_NORMALIZED',{matched:links.length,requested:candidates.length,notFound:failed.length});
  return {links,failed,imageFailed,requested:candidates.length,scannedPages,scannedRows,diagnostics:trail.snapshot()};
}

/* ===================================================================
   CORENECTUM STYLE API KÖPRÜSÜ — YETKİLİ METADATA

   NE DEĞİŞTİ: Model/renk görselini bulmak için artık kullanıcının GÖRÜNEN
   Style List ekranı SÜRÜLMÜYOR. Ne filtre kaldırılıyor, ne 15-20 bin satır
   sayfa sayfa geziliyor, ne de model detay (Style Overview) sayfası
   açılıyor. İki uç doğrudan çağrılıyor:

     StyleList/GetStyleList                  — plmCode süzgeciyle 100'lük parti
     StyleMainInformation/GetStyleImages     — styleId başına renk görselleri

   İkisi de YETKİ ister; normal PLM Sync artık TARAYICIYA bağlanmaz. Kullanıcı
   PLM Kullanıcı Girişi akışı güncel yetkilendirmeyi gerektiğinde yeniler; geçici token yalnız
   backend süreç belleğinde tutulur ve doğrudan Node tarafındaki API istemcisi
   tarafından kullanılır. Edge/CDP/DOM bu yola dahil değildir.
   Attachment baytları ise test komut dosyasındaki gibi yetki başlığı olmadan
   doğrudan Node'da indirilir (bkz. plm-image-download-queue.js).

   x-cancel-previous-request BİLEREK gönderilmez: o başlık arayüzün "önceki
   isteği iptal et" davranışıdır ve arka plan taramasında kendi isteklerimizi
   birbirine iptal ettirirdi.
   =================================================================== */
const CORENECTUM_API_TIMEOUT_MS=45000;
function coreNectumApiExpression(url,body,timeoutMs=CORENECTUM_API_TIMEOUT_MS){
  const target=JSON.stringify(String(url)),payload=JSON.stringify(JSON.stringify(body==null?{}:body));
  /* CoreNectum sürümleri access token'ı aynı isimle ama farklı Web Storage
     alanlarında tutabiliyor. Değer SAYFANIN İÇİNDE kalır; Node'a dönmez. */
  return `(async()=>{try{const extract=value=>{const text=String(value==null?'':value).trim();if(!text)return '';if(text[0]==='{'){try{const parsed=JSON.parse(text),candidate=parsed&&((parsed.access_token)||(parsed.accessToken));if(typeof candidate==='string'&&candidate.trim())return candidate.trim();}catch(_){}}return text;},readStorage=storage=>{if(!storage)return '';for(const key of ['access_token','accessToken']){try{const value=extract(storage.getItem(key));if(value)return value;}catch(_){}}try{for(let i=0;i<storage.length;i+=1){const key=String(storage.key(i)||'');if(!/^oidc\.user:/i.test(key)&&!/(?:^|[._:-])access[_-]?token(?:$|[._:-])/i.test(key))continue;const raw=String(storage.getItem(key)||'').trim();if(!raw)continue;try{const parsed=JSON.parse(raw),candidate=parsed&&((parsed.access_token)||(parsed.accessToken));if(typeof candidate==='string'&&candidate.trim())return candidate.trim();}catch(_){if(!/^oidc\.user:/i.test(key)){const value=extract(raw);if(value)return value;}}}}catch(_){}return '';},raw=readStorage(typeof localStorage==='undefined'?null:localStorage)||readStorage(typeof sessionStorage==='undefined'?null:sessionStorage),authorization=raw?(raw.toLowerCase().startsWith('bearer ')?raw:'Bearer '+raw):'',headers={Accept:'application/json','Content-Type':'application/json'};if(authorization)headers.Authorization=authorization;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),${Math.max(1000,Number(timeoutMs)||CORENECTUM_API_TIMEOUT_MS)});let response=null;try{response=await fetch(${target},{method:'POST',credentials:'include',cache:'no-store',signal:controller.signal,headers,body:${payload}});}finally{clearTimeout(timer);}const text=await response.text();let payloadValue=null;try{payloadValue=text?JSON.parse(text):null;}catch(_){payloadValue=null;}return {ok:response.ok,status:response.status,payload:payloadValue,body:payloadValue?'':String(text||'').slice(0,300),authAttached:Boolean(authorization)};}catch(error){return {ok:false,status:0,payload:null,error:String(error&&error.message||error).slice(0,300)};}})()`;
}
/* CoreNectum API'si için sayfa. Açık bir CoreNectum sekmesi varsa o kullanılır
   (oturum orada); yoksa Style List açılır ve giriş beklenir. */
function reusableBlankPageInBoundProfile(context,binding){
  const blank=/^(?:about:blank|edge:\/\/newtab\/?|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?)$/i;
  return context.pages().find(candidate=>{try{return !candidate.isClosed()&&blank.test(clean(candidate.url()))&&pageIsInBoundProfile(candidate,binding);}catch(_){return false;}})||null;
}
async function pageForCoreNectumApi(context,trail=null){
  await context.syncPages().catch(()=>{});
  const binding=coreNectumProfileBinding(context);
  trail?.record('BROWSER_PROFILE_RESOLVED',{source:binding.source,bound:binding.bound,boundContext:Boolean(binding.browserContextId)});
  // Yalnız MEVCUT KULLANICININ profilindeki CoreNectum sekmesi kullanılır.
  const existing=context.pages().find(candidate=>!candidate.isClosed()&&coreNectumPageUrl(candidate.url())&&pageIsInBoundProfile(candidate,binding));
  if(existing)return {page:existing,ownsPage:false,needsNavigation:false,binding};
  if(!binding.bound)throw plmSyncDiagnostics.attach(connectorError(coreNectumUnboundProfileMessage(binding),'BROWSER_PROFILE_UNBOUND',409),trail);
  // Fresh Chromium profiles already contain a startup blank/new-tab page. Reuse
  // it instead of creating an additional blank tab for every PLM operation.
  const blank=reusableBlankPageInBoundProfile(context,binding);
  if(blank)return {page:blank,ownsPage:false,needsNavigation:true,binding};
  return {page:await pageInBoundProfile(context,CORENECTUM_STYLE_LIST_URL,binding),ownsPage:true,needsNavigation:true,binding};
}
/* Sekme, belirlenen profilde açılır. Referans sekme varsa window.open ile
   (aynı profil kesin), yoksa browserContextId ile doğrudan. */
async function pageInBoundProfile(context,url,binding){
  if(binding&&binding.page&&typeof context.newPageFrom==='function'){
    try{ return await context.newPageFrom(binding.page,clean(url)||'about:blank'); }catch(_){}
  }
  if(binding&&binding.browserContextId)return context.newPage(clean(url)||'about:blank',{browserContextId:binding.browserContextId});
  return context.newPage(clean(url)||'about:blank');
}
async function coreNectumApiCall(page,url,body,options={}){
  const trail=options.trail||null;
  let result=null;
  trail?.record('STYLE_LIST_REQUEST_SENT',{sent:true});
  try{ result=await page._evaluateValue(coreNectumApiExpression(url,body,options.timeoutMs)); }
  catch(error){ throw plmSyncDiagnostics.attach(connectorError(`CoreNectum API isteği çalıştırılamadı: ${clean(error&&error.message||error)}`,'CORENECTUM_API_EVAL_FAILED',502),trail); }
  const status=Number(result&&result.status)||0;
  trail?.record('STYLE_LIST_HTTP_STATUS',{status,ok:result?result.ok===true:false});
  // Oturum düştüyse yeniden denemek CoreNectum'u boşuna döver; iş temiz
  // biçimde durur ve kullanıcıdan giriş tazelemesi istenir.
  if(status===401||status===403)throw plmSyncDiagnostics.attach(connectorError('CoreNectum PLM oturumu gerekli. Açık Edge sekmesinde CoreNectum girişini tazeleyip tekrar deneyin.','CORENECTUM_LOGIN_REQUIRED',409),trail);
  if(!result||result.ok!==true){
    const detail=clean(result&&(result.error||result.body)).slice(0,200);
    throw plmSyncDiagnostics.attach(connectorError(`CoreNectum API yanıtı alınamadı${status?` (HTTP ${status})`:''}${detail?`: ${detail}`:'.'}`,'CORENECTUM_API_HTTP_ERROR',502,{status}),trail);
  }
  return result.payload;
}
/* Bir PLM görsel işinin YETKİLİ metadata oturumu. Tek sayfa açılır, bütün
   parti o sayfa üzerinden sorulur; iş bitince (sayfa bize aitse) kapatılır. */
async function openCoreNectumStyleApiSession(ownerId,options={}){
  const isCancelled=typeof options.isCancelled==='function'?options.isCancelled:()=>false;
  const guard=()=>{ if(isCancelled())throw connectorError('PLM görsel işlemi kullanıcı tarafından durduruldu.','PLM_JOB_CANCELLED',499); };
  const trail=options.trail||plmSyncDiagnostics.createTrail();
  guard();
  /* v7.0.81-direct-api: PLM metadata calls no longer attach to Edge. The
     Bearer credential lives only in backend process memory and is consumed by
     the Node-side API client; it is never persisted by Buyer Log. */
  trail.record('AUTH_MODE',{mode:'direct-bearer',browserRequired:false});
  return {
    page:null,
    trail,
    diagnostics(){ return trail.snapshot(); },
    async styleListLookup(plmCodes){
      guard();
      trail.record('STYLE_LIST_REQUEST_SENT',{sent:true,direct:true});
      try{
        const payload=await coreNectumApiClient.postJson(ownerId,CORENECTUM_GET_STYLE_LIST_URL,coreNectumStyleApi.styleListBatchBody(plmCodes,{pageSize:Math.max(150,coreNectumStyleApi.dedupePlmCodes(plmCodes).length+20)}),{timeoutMs:90000,retries:3,language:options.language});
        const records=coreNectumStyleApi.styleListRecords(payload);
        const previous=trail.get('STYLE_LIST_RESPONSE_RECORDS')||{};
        trail.record('STYLE_LIST_HTTP_STATUS',{status:200,ok:true,direct:true});
        trail.record('STYLE_LIST_RESPONSE_RECORDS',{records:(Number(previous.records)||0)+records.length,requested:(Number(previous.requested)||0)+coreNectumStyleApi.dedupePlmCodes(plmCodes).length,batches:(Number(previous.batches)||0)+1,direct:true});
        return payload;
      }catch(error){ throw plmSyncDiagnostics.attach(error,trail); }
    },
    async styleImagesLookup(styleId){
      guard();
      try{return await coreNectumApiClient.postJson(ownerId,CORENECTUM_GET_STYLE_IMAGES_URL,coreNectumStyleApi.styleImagesRequestBody(styleId),{timeoutMs:90000,retries:3});}
      catch(error){throw plmSyncDiagnostics.attach(error,trail);}
    },
    async close(){},
  };
}
// Attachment baytları: Node tarafı, paylaşılan keepAlive bağlantı havuzu.
function downloadCoreNectumAttachment(url,options={}){ return plmImageDownloadQueue.downloadImage(url,options); }

// Umbrella QTX Library bridge. This is intentionally a single-record action:
// Buyer Log sends only the Colour Code, the open Edge profile is reused, and
// exactly one matching .qtx download is started.
// Unlike the console helper supplied by the user, this flow never bulk-downloads
// the library and stops immediately after the first unambiguous match.
const UMBRELLA_HOME_URL='https://umbrella.lcwaikiki.com/';
const qtxOwnerLocks=new Set();
function qtxInput(value,max=200){return clean(value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function umbrellaQtxDownloadExpression(item,mode='trigger'){
  const config=JSON.stringify({colourCode:item.colourCode,maxPages:250,mode});
  return `(async()=>{
    const cfg=${config},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const SETTINGS={navigationWait:1000,menuWait:450,downloadWait:900,pageWait:1300,elementTimeout:30000,pageChangeTimeout:20000,fetchCaptureWait:4000};
    const normalize=value=>String(value||'').replace(/\\s+/g,' ').trim().toLocaleLowerCase('tr-TR');
    const canonical=value=>normalize(value).replace(/\\.qtx\\b/ig,'').replace(/[^a-z0-9çğıöşü]+/gi,'');
    const tokens=value=>normalize(value).replace(/\\.qtx\\b/ig,'').split(/[^a-z0-9çğıöşü]+/i).filter(Boolean);
    const isVisible=element=>{if(!element)return false;const win=element.ownerDocument&&element.ownerDocument.defaultView||window,style=win.getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)!==0&&rect.width>0&&rect.height>0;};
    const exactText=(doc,text)=>{const wanted=normalize(text);return [...doc.querySelectorAll('span,button,a,[role="button"]')].find(el=>isVisible(el)&&normalize(el.textContent)===wanted)||null;};
    const clickElement=element=>{if(!element)throw new Error('Tıklanacak öğe bulunamadı.');const clickable=element.closest('button,a,[role="button"]')||element;clickable.scrollIntoView({behavior:'auto',block:'center',inline:'center'});const win=clickable.ownerDocument&&clickable.ownerDocument.defaultView||window;clickable.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,view:win}));};
    const waitFor=async(getter,description,timeout=SETTINGS.elementTimeout)=>{const started=Date.now();while(Date.now()-started<timeout){try{const value=getter();if(value)return value;}catch(_){}await sleep(250);}const error=new Error(description+' bulunamadı.');error.qtxDescription=description;throw error;};
    const frameContext=()=>{for(const frame of document.querySelectorAll('iframe')){try{const doc=frame.contentDocument,win=frame.contentWindow;if(doc&&win&&doc.querySelector('i.icon.toggle'))return {frame,doc,win};}catch(_){}}return null;};
    const openLibrary=async()=>{const existing=frameContext();if(existing)return existing;let ros=exactText(document,'ROS');if(!ros){const logo=await waitFor(()=>document.querySelector('img[src*="logo-lcwaikiki-world.png"]'),'LC Waikiki dünya logosu');clickElement(logo);await sleep(SETTINGS.navigationWait);ros=await waitFor(()=>exactText(document,'ROS'),'ROS düğmesi');}clickElement(ros);await sleep(SETTINGS.navigationWait);const qtx=await waitFor(()=>exactText(document,'Qtx Library')||exactText(document,'QTX Library'),'QTX Library düğmesi');clickElement(qtx);const context=await waitFor(frameContext,'QTX Library iframe kayıtları',45000);await sleep(SETTINGS.pageWait);return context;};
    const getRow=toggle=>{let current=toggle;while(current&&current.parentElement){const parent=current.parentElement;if(parent.querySelectorAll('i.icon.toggle').length>1)return current;current=parent;}return toggle.closest('tr,[role="row"],.mat-row,.mat-mdc-row,.table-row')||toggle.parentElement;};
    const filenameFor=(toggle,index,pageNumber)=>{const row=getRow(toggle),text=row&&String(row.innerText||row.textContent||'')||'',match=text.match(/[^\\n<>:"/\\\\|?*]+\\.qtx\\b/i);return match?match[0].trim():'Sayfa-'+pageNumber+'-Satir-'+(index+1);};
    const distance=(a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),ax=ar.left+ar.width/2,ay=ar.top+ar.height/2,bx=br.left+br.width/2,by=br.top+br.height/2;return Math.hypot(ax-bx,ay-by);};
    const downloadButton=(doc,toggle)=>{const buttons=[...new Set([...doc.querySelectorAll('i.fas.fa-download')].map(icon=>icon.closest('button')).filter(Boolean))];if(!buttons.length)return null;const active=buttons.filter(button=>{const transform=button.style.transform||'',z=button.style.zIndex||'';return transform.includes('-100%')||transform.includes('calc(-100%')||z==='5';}),candidates=active.length?active:buttons.filter(isVisible);return candidates.sort((a,b)=>distance(a,toggle)-distance(b,toggle))[0]||null;};
    const openDownload=async(doc,toggle)=>{clickElement(toggle);await sleep(SETTINGS.menuWait);return waitFor(()=>downloadButton(doc,toggle),'Download butonu',6000);};
    const signature=doc=>[...doc.querySelectorAll('i.icon.toggle')].map(toggle=>normalize((getRow(toggle)||{}).innerText||(getRow(toggle)||{}).textContent||'')).join('||');
    const nextButton=doc=>{for(const selector of ['button.mat-mdc-paginator-navigation-next','button.mat-paginator-navigation-next','.mat-mdc-paginator-navigation-next','.mat-paginator-navigation-next','button[aria-label*="Next page" i]','button[aria-label*="Sonraki sayfa" i]']){const el=doc.querySelector(selector);if(el)return el.closest('button')||el;}const arrow=[...doc.querySelectorAll('svg.mat-paginator-icon')].find(svg=>String(svg.querySelector('path')&&svg.querySelector('path').getAttribute('d')||'').replace(/\\s+/g,'').startsWith('M106L8.597.41'));return arrow&&arrow.closest('button')||null;};
    const disabled=button=>!button||button.disabled||button.hasAttribute('disabled')||button.getAttribute('aria-disabled')==='true'||button.classList.contains('mat-button-disabled')||button.classList.contains('mat-mdc-button-disabled');
    const stableRows=async doc=>{let previous=-1,stable=0;for(let i=0;i<20;i+=1){const count=doc.querySelectorAll('i.icon.toggle').length;if(count>0&&count===previous)stable+=1;else stable=0;if(stable>=2)return count;previous=count;await sleep(300);}return doc.querySelectorAll('i.icon.toggle').length;};
    const waitPage=async(doc,old)=>{const started=Date.now();while(Date.now()-started<SETTINGS.pageChangeTimeout){await sleep(350);const next=signature(doc);if(doc.querySelectorAll('i.icon.toggle').length>0&&next&&next!==old)return true;}return false;};
    /* v6.55 — "fetch" modunda, tıklamadan ÖNCE indirilen dosyanın GERÇEK
       baytlarını yakalayan iki bağımsız gözlemci kurulur:
       (1) window.fetch/XMLHttpRequest override — .qtx uzantılı veya
           indirilebilir içerik türlü (octet-stream/vnd.*) bir ağ yanıtı
           gelirse baytları saklar.
       (2) MutationObserver — sayfaya blob: bağlantılı bir <a> eklenirse
           (birçok Angular/React uygulaması dosya indirmeyi
           URL.createObjectURL + görünmez <a>.click() ile yapar), o blob'u
           AYNI SAYFA BAĞLAMINDA fetch(blobUrl) ile okuyup baytlarını alır.
       Hangi yöntemin Umbrella'da GERÇEKTEN çalıştığı siteyi görmeden kesin
       bilinemez; ikisi birden kurulduğu için hangisi tetiklenirse baytlar
       yakalanır. Hiçbiri tetiklenmezse fetchCaptureWait sonunda
       QTX_BYTES_NOT_CAPTURED ile başarısız döner — bu durumda Terminal'den
       (Automations > Yerleşik web betikleri > CoreNectum/Umbrella QTX indirme)
       gerçek yakalama noktası düzeltilebilir. */
    const captureDownloadBytes=async(doc,win)=>{
      let resolved=false,resolve;
      const done=new Promise(r=>{resolve=r;});
      const finish=(buffer,sourceUrl)=>{if(resolved)return;resolved=true;resolve({buffer,sourceUrl});};
      const bufferToBase64=buffer=>{const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=1)binary+=String.fromCharCode(bytes[i]);return (win.btoa||btoa)(binary);};
      const looksLikeFile=(url,contentType)=>{const ct=String(contentType||'').toLowerCase();return /\\.qtx(\\?|$)/i.test(String(url||''))||ct.includes('octet-stream')||ct.includes('vnd.')||ct.includes('force-download');};
      const originalFetch=win.fetch&&win.fetch.bind(win);
      if(originalFetch){
        win.fetch=async(...args)=>{
          const response=await originalFetch(...args);
          try{
            const url=String((args[0]&&args[0].url)||args[0]||'');
            const contentType=response.headers&&response.headers.get&&response.headers.get('content-type');
            if(!resolved&&looksLikeFile(url,contentType)){const clone=response.clone();const buffer=await clone.arrayBuffer();if(buffer&&buffer.byteLength)finish(buffer,url);}
          }catch(_){}
          return response;
        };
      }
      const OriginalXHR=win.XMLHttpRequest;
      if(OriginalXHR){
        win.XMLHttpRequest=function(){
          const xhr=new OriginalXHR();
          const originalOpen=xhr.open;
          xhr.open=function(method,url,...rest){this.__qtxUrl=url;try{this.responseType=this.responseType||'blob';}catch(_){}return originalOpen.call(this,method,url,...rest);};
          xhr.addEventListener('load',function(){
            if(resolved)return;
            const url=String(this.__qtxUrl||''),contentType=this.getResponseHeader&&this.getResponseHeader('content-type');
            if(!looksLikeFile(url,contentType))return;
            try{
              const blob=this.response instanceof Blob?this.response:null;
              if(blob)blob.arrayBuffer().then(buffer=>{if(buffer&&buffer.byteLength)finish(buffer,url);}).catch(()=>{});
            }catch(_){}
          });
          return xhr;
        };
      }
      const observer=new (win.MutationObserver||MutationObserver)(mutations=>{
        if(resolved)return;
        for(const mutation of mutations){
          for(const node of mutation.addedNodes||[]){
            if(!(node instanceof win.HTMLAnchorElement||node instanceof HTMLAnchorElement))continue;
            const href=String(node.href||'');
            if(!href.startsWith('blob:'))continue;
            fetch(href).then(response=>response.arrayBuffer()).then(buffer=>{if(buffer&&buffer.byteLength)finish(buffer,href);}).catch(()=>{});
          }
        }
      });
      observer.observe(doc.body||doc,{childList:true,subtree:true});
      const restore=()=>{try{if(originalFetch)win.fetch=originalFetch;}catch(_){}try{if(OriginalXHR)win.XMLHttpRequest=OriginalXHR;}catch(_){}try{observer.disconnect();}catch(_){}};
      const timeout=sleep(SETTINGS.fetchCaptureWait).then(()=>{finish(null,'');});
      const result=await Promise.race([done,timeout]);
      restore();
      return result&&result.buffer?result:null;
    };
    const colourCanonical=canonical(cfg.colourCode),colourTokens=tokens(cfg.colourCode);
    const colourMatches=text=>{const rowTokens=tokens(text);if(!colourCanonical||!colourTokens.length)return false;return rowTokens.some((_,start)=>colourTokens.every((token,index)=>rowTokens[start+index]===token));};
    if(window.__BUYER_LOG_QTX_RUNNING__)return {ok:false,code:'QTX_ALREADY_RUNNING',message:'Başka bir QTX indirme işlemi halen çalışıyor.'};
    window.__BUYER_LOG_QTX_RUNNING__=true;
    try{
      if(!colourCanonical)return {ok:false,code:'QTX_COLOUR_REQUIRED',message:'Colour Code boş olamaz.'};
      const context=await openLibrary(),doc=context.doc,win=context.win;let pageNumber=1,rowsScanned=0,pagesScanned=0;
      while(pageNumber<=cfg.maxPages){
        await stableRows(doc);const toggles=[...doc.querySelectorAll('i.icon.toggle')];if(!toggles.length)return {ok:false,code:'QTX_ROWS_NOT_FOUND',message:'QTX satırları bulunamadı.',pagesScanned,rowsScanned};
        pagesScanned+=1;rowsScanned+=toggles.length;
        const matches=[];
        toggles.forEach((toggle,index)=>{const row=getRow(toggle),rowText=String(row&&row.innerText||row&&row.textContent||''),filename=filenameFor(toggle,index,pageNumber),haystack=filename+' '+rowText;if(colourMatches(haystack))matches.push({toggle,filename,index});});
        if(matches.length){
          const selected=matches[0],button=await openDownload(doc,selected.toggle);
          if(cfg.mode==='fetch'){
            const capturePromise=captureDownloadBytes(doc,win);
            clickElement(button);
            const captured=await capturePromise;
            if(!captured)return {ok:false,code:'QTX_BYTES_NOT_CAPTURED',message:'QTX dosyasının baytları yakalanamadı (indirme başladıysa da içerik ele geçirilemedi).',filename:selected.filename,colourCode:cfg.colourCode,pageNumber,pagesScanned,rowsScanned};
            const bytes=new Uint8Array(captured.buffer);let binary='';for(let i=0;i<bytes.length;i+=1)binary+=String.fromCharCode(bytes[i]);
            return {ok:true,filename:selected.filename,colourCode:cfg.colourCode,pageNumber,pagesScanned,rowsScanned,matchMode:'colour-code-only',base64:(win.btoa||btoa)(binary),sourceUrl:captured.sourceUrl};
          }
          clickElement(button);await sleep(SETTINGS.downloadWait);return {ok:true,filename:selected.filename,colourCode:cfg.colourCode,pageNumber,pagesScanned,rowsScanned,matchMode:'colour-code-only'};
        }
        const next=nextButton(doc);if(disabled(next))break;const old=signature(doc);clickElement(next);if(!await waitPage(doc,old))return {ok:false,code:'QTX_PAGE_CHANGE_FAILED',message:'Sonraki QTX sayfasının açıldığı doğrulanamadı.',pagesScanned,rowsScanned};pageNumber+=1;await sleep(SETTINGS.pageWait);
      }
      return {ok:false,code:'QTX_NOT_FOUND',message:'Colour Code ile eşleşen QTX dosyası bulunamadı.',pagesScanned,rowsScanned};
    }catch(error){const description=String(error&&error.qtxDescription||''),code=description.includes('dünya logosu')?'UMBRELLA_LOGIN_REQUIRED':description.includes('ROS')?'UMBRELLA_ROS_NOT_FOUND':description.includes('QTX Library')?'QTX_LIBRARY_NOT_FOUND':description.includes('Download')?'QTX_DOWNLOAD_BUTTON_NOT_FOUND':'QTX_AUTOMATION_FAILED';return {ok:false,code,message:String(error&&error.message||error)};}
    finally{window.__BUYER_LOG_QTX_RUNNING__=false;}
  })()`;
}
async function downloadUmbrellaQtx(ownerId,input={}){
  const item={colourCode:qtxInput(input.colourCode,80)};
  const mode=input.mode==='fetch'?'fetch':'trigger';
  if(!item.colourCode)throw connectorError('Colour Code boş olamaz.','QTX_COLOUR_REQUIRED');
  const owner=safeOwner(ownerId);if(qtxOwnerLocks.has(owner))throw connectorError('Bu kullanıcı için başka bir QTX indirme işlemi devam ediyor.','QTX_ALREADY_RUNNING',409);
  qtxOwnerLocks.add(owner);
  try{
    const {context}=await ensureContext(ownerId);await context.syncPages().catch(()=>{});
    let page=context.pages().find(candidate=>{try{const url=new URL(candidate.url());return !candidate.isClosed()&&url.hostname.toLowerCase()==='umbrella.lcwaikiki.com';}catch(_){return false;}});
    if(!page)page=await pageForCurrentBuyerLogProfile(context,'about:blank');
    const current=validTargetUrl(page.url());if(!current||current.hostname.toLowerCase()!=='umbrella.lcwaikiki.com')await page.goto(UMBRELLA_HOME_URL,{waitUntil:'domcontentloaded',timeout:45000});
    // v6.55 — mode:'fetch' istendiğinde web-script-registry'e üçüncü argüman
    // olarak GEÇEN fabrika ifadesi de fetch modunda üretilir; kullanıcı bu
    // betiği Terminal'den override ederse mode bilgisi kendi kodunda params
    // aracılığıyla erişilebilir olur.
    const qtxResolved=webScriptRegistry.expressionFor('umbrella.qtx.download',{colourCode:item.colourCode,mode},umbrellaQtxDownloadExpression(item,mode));
    const result=await page._evaluateValue(qtxResolved.expression).catch(error=>{throw connectorError(`Umbrella QTX otomasyonu çalıştırılamadı: ${clean(error&&error.message||error)}`,'QTX_CDP_FAILED',409);});
    if(!result||result.ok!==true)throw connectorError(clean(result&&result.message)||'QTX dosyası indirilemedi.',clean(result&&result.code)||'QTX_DOWNLOAD_FAILED',409,result||undefined);
    return {...result,url:page.url()};
  }finally{qtxOwnerLocks.delete(owner);}
}

/* ===================================================================
   OAB (Order-Assortment-Budget) — PASS entegrasyonu.

   OABAuthAdapter (bu blok): Authorization token'ı Buyer Log koduna, log'una
   veya kalıcı depoya HİÇBİR ZAMAN yazmaz. Umbrella QTX'in (yukarıdaki blok)
   ve CoreNectum'un (coreNectumDirectApiScan) kullandığı AYNI kanıtlanmış
   deseni izler: kullanıcının PASS'te GERÇEKTEN yaptığı bir rapor sorgusu
   CDP Network domain'i ile YAKALANIR (Authorization header'ı dahil), bu
   "template" yalnız Node.js process RAM'inde (passAuthTemplates Map'i,
   diske hiç yazılmaz) tutulur; sonraki her OAB isteği bu template'in
   header'larıyla page._evaluateValue İÇİNDE (tarayıcı sekmesinin kendi
   JS bağlamında, fetch ile) yapılır — token sunucu koduna hiçbir zaman
   "değer" olarak dönmez, yalnız CDP üzerinden tarayıcıya bir JS ifadesi
   içinde geçici olarak taşınır.

   Bu yüzden bir "PASS'e bağlan" adımı gerekir: viewer sayfası açılır (mümkünse
   kullanıcının o an seçtiği Season/MAG/Buyer Group ile önceden doldurulmuş
   olarak, böylece sayfa kendiliğinden rapor/metadata isteği atar), Buyer Log
   oluşan ilk rapor-API isteğini yakalayana kadar bekler. */
// v6.60 — DÜZELTME: pass.prod.lcwaikiki.com (eski PASS_HOME_URL) kullanıcı
// arayüzü DEĞİL; o adrese gidince "page can't be found" hatası alınıyordu.
// Gerçek kullanıcı arayüzü (viewer) pass.lcwaikiki.com'da (prod. ÖNEKİ YOK).
// API istekleri YİNE DE pass.prod.lcwaikiki.com'a gidiyor (kullanıcının ilk
// verdiği spesifikasyonda doğrulanmıştı) — bu, sayfanın (pass.lcwaikiki.com)
// farklı bir subdomain'deki API'yi çağırdığı yaygın bir mimari; PASS_API_HOST/
// PASS_API_ROOT bu yüzden değişmedi, yalnız SAYFA (gezinme) hostu düzeltildi.
const PASS_UI_HOST='pass.lcwaikiki.com';
const PASS_VIEWER_BASE='https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report';
const PASS_API_HOST='pass.prod.lcwaikiki.com';
const PASS_API_ROOT='https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0';
const passAuthTemplates=new Map(); // ownerId -> {url,method,headers,capturedAt}
const passCaptureLocks=new Set();
// OAB login/authorization yakalama ilerlemesi yalnız RAM'de tutulur. Kullanıcı adı,
// parola veya Authorization DEĞERİ bu yapıya hiçbir zaman yazılmaz; UI yalnız
// 'PASS oturum açma bekleniyor' gibi güvenli durum bilgisini görebilir.
const passAuthProgress=new Map(); // ownerId -> {phase,startedAt,loginRequired}

// Kullanıcı talimatı: "bu 3 alan filtrelemesi mecburi, filtreleme yokken OAB
// raporu gelmiyor." Season/MAG/Buyer Group parametreleri URL'e EKLENDİĞİNDE
// viewer sayfası GetReportData'yı kendiliğinden tetikler; hiçbiri verilmezse
// yalnız filtre metadata'sını (Season listesi vb.) dolduran istekler oluşur —
// ikisi de "/pass/common/report/api/" isteği ürettiği için aynı yakalama
// mekanizması (capturePassAuthorization) her iki amaç için de kullanılabilir.
function passViewerUrl({seasonRef,merchSubGroupRef,buyerGroupRef}={}){
  const url=new URL(PASS_VIEWER_BASE);
  if(seasonRef!=null&&seasonRef!=='')url.searchParams.set('SeasonRef',seasonRef);
  if(merchSubGroupRef!=null&&merchSubGroupRef!=='')url.searchParams.set('MerchSubGroupRef',merchSubGroupRef);
  if(buyerGroupRef!=null&&buyerGroupRef!=='')url.searchParams.set('BuyerGroupRefs',buyerGroupRef);
  return url.toString();
}

function passHeaderAllowed(name){
  // Umbrella/CoreNectum ile AYNI kural (coreNectumReplayHeaders): tarayıcının
  // KENDİSİ eklemesi gereken header'lar (Host, Cookie, User-Agent, sec-* vb.)
  // hariç tutulur — bunları biz kopyalarsak tarayıcının gerçek bağlamıyla
  // çelişip isteği REDDETTİREBİLİR. Authorization bu listede YOKTUR, korunur.
  return !/^(host|content-length|cookie|origin|referer|connection|accept-encoding|accept-language|user-agent)$/i.test(name)&&!/^sec-/i.test(name)&&!name.startsWith(':');
}
function passReplayHeaders(headers){
  const allowed={};
  for(const [key,value] of Object.entries(headers||{}))if(passHeaderAllowed(key))allowed[key]=value;
  return allowed;
}
function passAuthorizationHeader(headers){
  for(const [key,value] of Object.entries(headers||{})){
    if(!/^authorization$/i.test(String(key||'')))continue;
    const text=clean(Array.isArray(value)?value[0]:value);
    if(/^Bearer\s+\S{20,}$/i.test(text))return text;
  }
  return '';
}

/* v7.0.81 — OAB mevcut-Edge oturumu önceliği.
   Yeni OAB login penceresi açmadan önce, kullanıcının ZATEN açık olan Edge
   PASS/OAB sekmesine bağlanır. Yalnız mevcut CDP/Remote Debugging context'i
   kabul edilir: ensureExistingContext() yeni Edge/profil başlatamaz. Açık PASS
   sekmesinin kendi normal ağ isteği yeniden tetiklenir ve Authorization yalnız
   process RAM'inde döner; diske/loga/renderer'a yazılmaz. */
async function captureExistingPassAuthorizationFromContext(context,{timeoutMs=12000}={}){
  if(!context)throw connectorError('Açık Edge OAB context\'i bulunamadı.','OAB_EXISTING_BROWSER_UNAVAILABLE',409,{existingOnly:true,launchesBrowser:false});
  await context.syncPages().catch(()=>{});
  const isPassUiPage=candidate=>{try{const url=new URL(candidate.url());return !candidate.isClosed()&&url.hostname.toLowerCase()===PASS_UI_HOST;}catch(_){return false;}};
  let page=context.pages().find(isPassUiPage);
  if(!page)throw connectorError(
    'Açık Edge oturumunda OAB/PASS sekmesi bulunamadı.',
    'OAB_EXISTING_TAB_NOT_FOUND',409,
    {existingOnly:true,launchesBrowser:false}
  );

  let authorization='';
  const attached=new Map();
  const onRequest=params=>{
    if(authorization)return;
    const request=params&&params.request||{},url=clean(request.url);
    if(!url.toLowerCase().includes('/pass/common/report/api/'))return;
    authorization=passAuthorizationHeader(request.headers||{});
  };
  const attachPage=async candidate=>{
    if(!candidate||candidate.isClosed()||attached.has(candidate.client))return;
    candidate.client.on('Network.requestWillBeSent',onRequest);
    attached.set(candidate.client,true);
    await candidate.client.send('Network.enable',{},10000).catch(()=>{});
  };
  const detachAll=()=>{
    for(const client of attached.keys())try{client.off('Network.requestWillBeSent',onRequest);}catch(_){}
    attached.clear();
  };

  try{
    for(const candidate of context.pages().filter(isPassUiPage))await attachPage(candidate);
    await attachPage(page);

    // Listener ÖNCE bağlanır. Mevcut viewer URL'i aynı sekmede yeniden açmak,
    // PASS SPA'nın normal metadata/report çağrılarını üretir; yeni pencere/sekme
    // oluşturulmaz ve mevcut query/filter parametreleri korunur.
    const currentUrl=clean(page.url());
    const targetUrl=currentUrl&&isPassUiPage(page)?currentUrl:PASS_VIEWER_BASE;
    await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});

    const deadline=Date.now()+Math.max(2500,Number(timeoutMs)||12000);
    while(!authorization&&Date.now()<deadline){
      await context.syncPages().catch(()=>{});
      const pages=context.pages().filter(isPassUiPage);
      if(pages.length)page=pages[0];
      for(const candidate of pages)await attachPage(candidate);
      if(!authorization)await sleep(180);
    }
    if(!authorization)throw connectorError(
      'Açık OAB sekmesinden Authorization yakalanamadı.',
      'OAB_EXISTING_AUTH_NOT_CAPTURED',408,
      {existingOnly:true,launchesBrowser:false}
    );
    return {ok:true,authorization,source:'existing-edge',capturedAt:new Date().toISOString()};
  }finally{detachAll();}
}
async function captureExistingPassAuthorization(ownerId,options={}){
  let context;
  try{
    ({context}=await ensureExistingContext(ownerId));
  }catch(error){
    throw connectorError(
      'Açık Edge oturumu OAB için okunamadı. Buyer Log yeni bir tarayıcı açmadı.',
      'OAB_EXISTING_BROWSER_UNAVAILABLE',409,
      {existingOnly:true,requiresRemoteDebugging:true,launchesBrowser:false,causeCode:clean(error&&error.code)}
    );
  }
  return captureExistingPassAuthorizationFromContext(context,options);
}
function passAuthStatus(ownerId){
  const key=safeOwner(ownerId),template=passAuthTemplates.get(key),progress=passAuthProgress.get(key);
  return {
    connected:Boolean(template),
    capturedAt:template&&template.capturedAt||null,
    hasAuthorization:Boolean(template)&&Object.keys(template.headers||{}).some(name=>/^authorization$/i.test(name)),
    captureInProgress:Boolean(progress),
    loginRequired:Boolean(progress&&progress.loginRequired),
    phase:progress&&progress.phase||'',
    startedAt:progress&&progress.startedAt||null,
  };
}

function passLikelyLoginUrl(value){
  try{
    const url=new URL(clean(value)),host=url.hostname.toLowerCase(),pathText=`${url.pathname}${url.search}`.toLowerCase();
    if(host===PASS_UI_HOST)return /\/(login|signin|auth)(?:\/|$)/i.test(url.pathname);
    return /login|signin|auth|identity|sso|adfs|microsoftonline|oauth|authorize/i.test(`${host}${pathText}`);
  }catch(_){return false;}
}
async function passPageLooksLikeLogin(page){
  if(!page||page.isClosed())return false;
  if(passLikelyLoginUrl(page.url()))return true;
  try{
    return Boolean(await page._evaluateValue(`Boolean(document.querySelector('input[type="password"], input[name*="password" i], input[id*="password" i], form[action*="login" i], form[action*="signin" i]'))`));
  }catch(_){return false;}
}
// Yalnız PASS'in KABUL ettiği (2xx) report-API isteğinin header'ları yakalanır.
// Viewer açılışta tarayıcıda saklı ESKİ token'la istek atabilir; eskiden bu ilk
// istek yanıtına bakılmadan alınıyordu → replay 401 → yeniden yakalama → PASS
// sekmesi defalarca açılıp yükleniyordu. 401/403 alan aday atılır ve viewer'ın
// yenilenmiş token'la attığı istek aynı çağrı içinde beklenir.
function createPassAuthCaptureTracker(){
  const pending=new Map();
  let captured=null,rejectedAt=0;
  return {
    captured:()=>captured,
    rejectedAt:()=>rejectedAt,
    onRequest(params){
      if(captured)return;
      const request=params&&params.request||{},url=clean(request.url),method=clean(request.method).toUpperCase()||'POST',requestId=clean(params&&params.requestId);
      if(!requestId||method==='OPTIONS'||!url.toLowerCase().includes('/pass/common/report/api/'))return;
      const headers={...(request.headers||{})};
      if(!Object.keys(headers).some(name=>/^authorization$/i.test(name)))return;
      pending.set(requestId,{url,method,headers});
    },
    onResponse(params){
      if(captured)return;
      const requestId=clean(params&&params.requestId),candidate=pending.get(requestId);
      if(!candidate)return;
      pending.delete(requestId);
      const status=Number(params&&params.response&&params.response.status)||0;
      if(status>=200&&status<300)captured=candidate;
      else rejectedAt=Date.now();
    },
    onFailed(params){pending.delete(clean(params&&params.requestId));},
  };
}
// PASS viewer'ını (mümkünse seçili filtrelerle önceden doldurulmuş olarak)
// açar ve PASS'in kabul ettiği ilk rapor-API isteğinin header'larını
// (Authorization dahil) yakalar. PASS oturumu açılmamışsa login ekranı kullanıcıya bırakılır: Buyer
// Log kullanıcı adı/parola alanlarını OKUMAZ, doldurmaz ve kaydetmez. Kullanıcı
// Edge'de oturum açtığında capture aynı çağrı içinde otomatik devam eder.
async function capturePassAuthorization(ownerId,{timeoutMs=300000,seasonRef,merchSubGroupRef,buyerGroupRef}={}){
  const key=safeOwner(ownerId);
  const targetUrl=passViewerUrl({seasonRef,merchSubGroupRef,buyerGroupRef});
  const isPassUiPage=candidate=>{try{const url=new URL(candidate.url());return !candidate.isClosed()&&url.hostname.toLowerCase()===PASS_UI_HOST;}catch(_){return false;}};
  if(passCaptureLocks.has(key))throw connectorError('PASS bağlantı yakalaması zaten sürüyor.','PASS_CAPTURE_ALREADY_RUNNING',409);
  passCaptureLocks.add(key);
  const progress={phase:'opening',startedAt:new Date().toISOString(),loginRequired:false};
  passAuthProgress.set(key,progress);
  const attachedClients=new Map();
  const tracker=createPassAuthCaptureTracker();
  const listeners={
    'Network.requestWillBeSent':params=>tracker.onRequest(params),
    'Network.responseReceived':params=>tracker.onResponse(params),
    'Network.loadingFailed':params=>tracker.onFailed(params),
  };
  let captured=null;
  const detachAll=()=>{
    for(const client of attachedClients.keys())for(const [event,listener] of Object.entries(listeners))try{client.off(event,listener);}catch(_){}
    attachedClients.clear();
  };
  try{
    const {context}=await ensureContext(ownerId);await context.syncPages().catch(()=>{});
    const attachPage=async candidate=>{
      if(!candidate||candidate.isClosed()||attachedClients.has(candidate.client))return;
      for(const [event,listener] of Object.entries(listeners))candidate.client.on(event,listener);
      attachedClients.set(candidate.client,true);
      await candidate.client.send('Network.enable',{},10000).catch(()=>{});
    };
    for(const candidate of context.pages())await attachPage(candidate);
    let page=context.pages().find(isPassUiPage);
    if(!page)page=await pageForCurrentBuyerLogProfile(context,targetUrl);
    await attachPage(page);
    // Listener navigation'dan ÖNCE bağlıdır; viewer doğrudan report isteği atarsa
    // çok hızlı çağrılar da kaçırılmaz. SSO/login redirect'i olursa aynı client
    // ve sonradan açılan target'lar polling döngüsünde yeniden izlenir.
    if(page.url()!==targetUrl)await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    progress.phase='waiting-request';
    const deadline=Date.now()+Math.max(30000,Number(timeoutMs)||300000);
    let lastViewerKick=0,rejectedKicks=0;
    while(!(captured=tracker.captured())&&Date.now()<deadline){
      await context.syncPages().catch(()=>{});
      const pages=context.pages().filter(candidate=>!candidate.isClosed());
      for(const candidate of pages)await attachPage(candidate);
      let loginRequired=false;
      for(const candidate of pages){if(await passPageLooksLikeLogin(candidate)){loginRequired=true;break;}}
      if(loginRequired){
        progress.loginRequired=true;
        progress.phase='login-required';
      }else if(progress.loginRequired){
        // Login ekranı kayboldu ancak SSO her zaman doğrudan rapor viewer'ına
        // dönmeyebilir. Kimlik doğrulama bittikten sonra hedef viewer'ı tekrar
        // açıp seçili filtrelerle report isteğini tetikleriz.
        progress.loginRequired=false;
        progress.phase='authenticated-opening-report';
        const passPage=pages.find(candidate=>{try{return new URL(candidate.url()).hostname.toLowerCase()===PASS_UI_HOST;}catch(_){return false;}});
        if(passPage&&Date.now()-lastViewerKick>1500){
          lastViewerKick=Date.now();
          await attachPage(passPage);
          if(passPage.url()!==targetUrl)await passPage.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
        }
      }else{
        progress.phase='waiting-request';
        // PASS eski token'ı reddettiyse viewer çoğu zaman yenilenmiş token'la
        // kendisi tekrar dener. Denemezse YENİ sekme açılmaz; aynı PASS sekmesi
        // en fazla iki kez yeniden yüklenir.
        const rejectedAt=tracker.rejectedAt();
        const passPage=rejectedAt>lastViewerKick&&Date.now()-rejectedAt>4000&&rejectedKicks<2?pages.find(isPassUiPage):null;
        if(passPage){
          lastViewerKick=Date.now();rejectedKicks+=1;
          await attachPage(passPage);
          await passPage.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
        }
      }
      if(!tracker.captured())await sleep(250);
    }
    if(!captured){
      if(progress.loginRequired)throw connectorError('PASS oturum açma işlemi tamamlanmadı. Edge üzerindeki PASS girişini tamamlayıp tekrar deneyin.','PASS_LOGIN_TIMEOUT',408);
      throw connectorError('PASS\'ten filtre/rapor isteği algılanamadı. PASS oturumunuzun açık olduğundan emin olun ve tekrar deneyin.','PASS_AUTH_TIMEOUT',408);
    }
    progress.phase='captured';
    const headers=passReplayHeaders(captured.headers);
    if(!Object.keys(headers).some(name=>/^authorization$/i.test(name)))throw connectorError('Yakalanan istekte Authorization başlığı bulunamadı.','PASS_AUTH_HEADER_MISSING',502);
    passAuthTemplates.set(key,{url:captured.url,method:captured.method,headers,capturedAt:new Date().toISOString()});
    return passAuthStatus(ownerId);
  }finally{
    detachAll();
    passAuthProgress.delete(key);
    passCaptureLocks.delete(key);
  }
}
function requirePassAuth(ownerId){
  const template=passAuthTemplates.get(safeOwner(ownerId));
  if(!template)throw connectorError('PASS bağlantısı hazır değil. Önce PASS\'e bağlanın.','PASS_NOT_CONNECTED',409);
  return template;
}
// Tek amaçlı köprü: page._evaluateValue içinde, TARAYICI bağlamında bir PASS
// isteği yapar ve JSON yanıtı Node.js'e döndürür. Authorization header'ı
// yalnız bu ifadenin İÇİNDE (page context'ine gönderilen JS metninde) yer
// alır; fonksiyonun kendisi token'ı bir DEĞER olarak GERİ DÖNDÜRMEZ.
// PLM Sync ile AYNI model: PASS SPA access token'ı kendi web storage'ında
// (access_token) tutar. İstek her seferinde açık PASS sekmesindeki GÜNCEL
// token'la atılır; değer sayfanın içinde kalır, Node'a dönmez. Yakalanmış
// template yalnız diğer başlıklar ve storage'da token bulunmayan durum içindir.
const PASS_STORED_TOKEN_READER=`const readStoredPassToken=()=>{
    const extract=value=>{let text=String(value==null?'':value).trim();if(!text)return '';
      if(text[0]==='"'||text[0]==='{'){try{const parsed=JSON.parse(text);text=typeof parsed==='string'?parsed:String(parsed&&(parsed.access_token||parsed.accessToken)||'');}catch(_){return '';}}
      text=text.trim().replace(/^bearer\\s+/i,'');return text.length>=20&&!/\\s/.test(text)?'Bearer '+text:'';};
    const stores=[];try{if(typeof localStorage!=='undefined'&&localStorage)stores.push(localStorage);}catch(_){}try{if(typeof sessionStorage!=='undefined'&&sessionStorage)stores.push(sessionStorage);}catch(_){}
    for(const store of stores)for(const key of ['access_token','accessToken']){try{const value=extract(store.getItem(key));if(value)return value;}catch(_){}}
    return '';
  };`;
function passStoredTokenPresentExpression(){
  return `(()=>{${PASS_STORED_TOKEN_READER}return Boolean(readStoredPassToken());})()`;
}
function passRequestExpression(url,method,headers,body){
  const config=JSON.stringify({url,method:method||'POST',headers:headers||{},body:body===undefined?null:body});
  return `(async()=>{
    const cfg=${config};
    ${PASS_STORED_TOKEN_READER}
    // PASS bağlantısı kurulurken yakalanan ilk report API isteği bir metadata
    // GET/POST çağrısı olabilir ve Content-Type taşımayabilir. String body ile
    // fetch() böyle bir header olmadan çalışırsa tarayıcı text/plain;charset=UTF-8
    // gönderebilir; GetReportData bunu HTTP 415 (Unsupported Media Type) ile
    // reddeder. Bu yüzden replay header'larını Headers üzerinden normalize edip
    // JSON body gönderilen her istekte Content-Type'ı KESİN olarak JSON yapıyoruz.
    // Authorization yakalanan template'ten aynen korunur.
    const requestHeaders=new Headers(cfg.headers||{});
    requestHeaders.set('Accept','application/json');
    if(cfg.body!=null)requestHeaders.set('Content-Type','application/json');
    const templateAuthorization=requestHeaders.get('Authorization')||'';
    const storedAuthorization=readStoredPassToken();
    if(storedAuthorization)requestHeaders.set('Authorization',storedAuthorization);
    if(!requestHeaders.get('Authorization'))return {ok:false,status:0,code:'PASS_TOKEN_MISSING'};
    // Kullanıcı notu: credentials:'include' PASS'te CORS hatası veriyor;
    // çalışan model credentials:'omit' + Authorization header.
    const send=()=>fetch(cfg.url,{method:cfg.method,headers:requestHeaders,credentials:'omit',cache:'no-store',body:cfg.body==null?undefined:JSON.stringify(cfg.body)});
    let response=await send();
    // Storage'daki token reddedildiyse ve PASS'in kabul ettiği yakalanmış token
    // farklıysa istek bir kez onunla tekrarlanır.
    if((response.status===401||response.status===403)&&storedAuthorization&&templateAuthorization&&templateAuthorization!==storedAuthorization){
      requestHeaders.set('Authorization',templateAuthorization);
      response=await send();
    }
    const text=await response.text();
    let parsed=null;try{parsed=JSON.parse(text);}catch(_){/* JSON değilse ham metin döner */}
    return {ok:response.ok,status:response.status,statusText:String(response.statusText||''),json:parsed,text:parsed?null:text.slice(0,2000)};
  })()`;
}
// ownerId için PASS'e bir istek yapar; oturum süresi dolmuşsa (401/403) TEK
// SEFER otomatik olarak yeniden yakalamayı DENEMEZ — kullanıcı notu "session
// expired, reconnect" mesajını NET görsün diye PASS_SESSION_EXPIRED fırlatır,
// çağıran taraf (server.js) bunu kullanıcıya kontrollü şekilde gösterir.
function passTransientCdpTargetError(error){
  const message=clean(error&&error.message||error);
  return /inspected target navigated or closed|target (?:page )?closed|session closed|no target with given id|cannot find context with specified id|execution context (?:was )?destroyed|context.*destroyed|cannot find execution context/i.test(message);
}
async function passPageForRequest(context){
  await context.syncPages().catch(()=>{});
  let page=context.pages().find(candidate=>{try{const u=new URL(candidate.url());return !candidate.isClosed()&&u.hostname.toLowerCase()===PASS_UI_HOST;}catch(_){return false;}});
  if(!page)page=await pageForCurrentBuyerLogProfile(context,PASS_VIEWER_BASE);
  return page;
}
// Token açık PASS sekmesinin storage'ından okunur; yakalanmış template
// zorunlu değildir (bkz. PASS_STORED_TOKEN_READER).
async function passStorageAuthStatus(ownerId){
  const status=passAuthStatus(ownerId);
  const {context}=await ensureContext(ownerId);
  await context.syncPages().catch(()=>{});
  const page=context.pages().find(candidate=>{try{const u=new URL(candidate.url());return !candidate.isClosed()&&u.hostname.toLowerCase()===PASS_UI_HOST;}catch(_){return false;}});
  if(!page)return status;
  const present=await page._evaluateValue(passStoredTokenPresentExpression()).catch(()=>false);
  return present?{...status,connected:true,hasAuthorization:true,source:'page-storage'}:status;
}
async function passRequest(ownerId,url,method,body){
  const template=passAuthTemplates.get(safeOwner(ownerId));
  const {context}=await ensureContext(ownerId);
  const expression=passRequestExpression(url,method,template&&template.headers,body);
  let result=null,lastError=null;
  // PASS viewer bazen ilk rapor çağrısından sonra kendi navigation/render
  // döngüsünü tamamlar. Tam o sırada Refresh OAB çalıştırılırsa CDP,
  // "Inspected target navigated or closed" ile Runtime.evaluate bağlamını
  // iptal edebilir. Bu bir auth/HTTP hatası DEĞİLDİR; aynı salt-okunur rapor
  // isteğini, target listesini yeniden senkronize edip yalnız BİR KEZ tekrar
  // etmek güvenlidir. Böylece kullanıcı ilk Get OAB'den sonra Refresh'e
  // bastığında PASS sekmesini manuel yeniden açmak zorunda kalmaz.
  for(let attempt=0;attempt<2;attempt+=1){
    let page=null;
    try{
      page=await passPageForRequest(context);
      // Navigation sırasında yakalanmış eski execution context yerine güncel
      // document context'inin hazır olduğunu doğrula. Bu kısa kontrol de aynı
      // transient hatayı verirse aşağıdaki retry yoluna düşer.
      await page._evaluateValue('document.readyState');
      result=await page._evaluateValue(expression);
      lastError=null;
      break;
    }catch(error){
      lastError=error;
      if(attempt===0&&passTransientCdpTargetError(error)){
        await context.syncPages().catch(()=>{});
        await sleep(450);
        continue;
      }
      throw connectorError(`PASS isteği çalıştırılamadı: ${clean(error&&error.message||error)}`,'PASS_CDP_FAILED',409);
    }
  }
  if(lastError&&!result)throw connectorError(`PASS isteği çalıştırılamadı: ${clean(lastError&&lastError.message||lastError)}`,'PASS_CDP_FAILED',409);
  if(!result)throw connectorError('PASS isteğinden yanıt alınamadı.','PASS_NO_RESPONSE',502);
  if(result.code==='PASS_TOKEN_MISSING')throw connectorError('PASS bağlantısı hazır değil. Önce PASS\'e bağlanın.','PASS_NOT_CONNECTED',409);
  if(result.status===401||result.status===403){passAuthTemplates.delete(safeOwner(ownerId));throw connectorError('PASS oturumu sona ermiş görünüyor.','PASS_SESSION_EXPIRED',401);}
  if(!result.ok)throw connectorError(`PASS HTTP ${result.status} ${result.statusText}`.trim(),'PASS_HTTP_ERROR',502,{status:result.status,body:result.text||result.json,url,method});
  if(result.json==null)throw connectorError('PASS yanıtı JSON olarak ayrıştırılamadı.','PASS_INVALID_JSON',502);
  return result.json;
}
// Rapor metadata servisi: GetReportVariablesWithData ile sezon listesini
// (VariableRef:534, ReportVariableRef:454, config key SeasonRef) çeker.
// Sezonlar HİÇBİR ZAMAN sabit kodlanmaz; her çağrıda PASS'ten taze gelir.
async function fetchPassSeasons(ownerId){
  const body={reportRef:'OrderBudget_List_Report',languageRef:2,variableRef:534,reportVariableRef:454};
  const payload=await passRequest(ownerId,`${PASS_API_ROOT}/Report/GetReportVariablesWithData`,'POST',body);
  return oabExtractOptionList(payload,'SeasonRef');
}
// MAG ve Buyer Group aynı servisi (GetVariableWithData) farklı VariableRef ve
// Parameters ile kullanır; tek fonksiyonda parametrize edildi.
async function fetchPassVariableWithData(ownerId,variableRef,parameters){
  const body={VariableRef:variableRef,Parameters:parameters||{},LanguageRef:2};
  const payload=await passRequest(ownerId,`${PASS_API_ROOT}/Report/GetVariableWithData`,'POST',body);
  return oabExtractOptionList(payload);
}
async function fetchPassMagOptions(ownerId,seasonRef){
  return fetchPassVariableWithData(ownerId,26,{SeasonRef:seasonRef});
}
async function fetchPassBuyerGroupOptions(ownerId,merchSubGroupRef){
  return fetchPassVariableWithData(ownerId,371,{MerchSubGroupRef:merchSubGroupRef});
}
// PASS response şekli tam netleşene kadar (kullanıcı yalnız örnek KAYIT verdi,
// TAM zarf yapısını vermedi) birden çok olası konumu dener; hiçbiri uymazsa
// boş liste döner (sessizce yanlış veri UYDURMAK yerine).
function oabExtractOptionList(payload,refKeyHint){
  const looksLikeOptionRow=row=>row&&typeof row==='object'&&!Array.isArray(row)&&(!refKeyHint||Object.prototype.hasOwnProperty.call(row,refKeyHint)||Object.keys(row).some(key=>/ref$/i.test(key)));
  // PASS zarfının TAM şekli kullanıcı örneğinde netleşmedi (yalnız tek bir
  // kayıt verildi: {Name,SeasonRef}); hem "Data doğrudan satır dizisi" hem
  // "Data[0] satır dizisi" (GetReportData'nın doğrulanmış şekli) ihtimalleri
  // denenir. Gerçek PASS response'u ile doğrulanana kadar ikisi de açık
  // tutuluyor; hiçbiri uymazsa veri UYDURULMAZ, boş liste döner.
  const candidates=[payload,payload&&payload.Data,payload&&payload.data,payload&&payload.Result,payload&&payload.result,payload&&payload.Items,payload&&payload.items];
  for(const candidate of candidates){
    if(!Array.isArray(candidate))continue;
    if(candidate.length&&looksLikeOptionRow(candidate[0]))return candidate;
    if(candidate.length&&Array.isArray(candidate[0])&&candidate[0].length&&looksLikeOptionRow(candidate[0][0]))return candidate[0];
  }
  return [];
}
// Rapor servisi: GetReportData. response.Data[0] altındaki satırları döndürür;
// 81 civarındaki alan adı HİÇBİR ZAMAN hard-code edilmez, satırlar OLDUĞU
// GİBİ (dinamik anahtarlarıyla) taşınır.
// v7.20: parametre adı PASS tarafında `BuyerGroupRefs` — ÇOĞUL. Tek ref eski
// davranışın aynısıdır (buyerGroupRef). Birden çok ref verildiğinde virgülle
// birleştirilip TEK istekte gönderilir; servisin bunu gerçekten uygulayıp
// uygulamadığı VARSAYILMAZ, çağıran taraf yanıt satırlarından doğrular
// (oab-batch.verifyBatchedBuyerGroupResponse). Doğrulanmazsa kombinasyon
// başına tek ref ile devam edilir.
function passBuyerGroupParam(buyerGroupRef,buyerGroupRefs){
  const list=(Array.isArray(buyerGroupRefs)?buyerGroupRefs:[])
    .map(value=>String(value==null?'':value).trim()).filter(Boolean);
  if(list.length)return [...new Set(list)].join(',');
  return buyerGroupRef;
}
async function fetchPassReportData(ownerId,{seasonRef,merchSubGroupRef,buyerGroupRef,buyerGroupRefs}){
  const body={
    reportRef:'OrderBudget_List_Report',languageRef:2,
    parameters:{SeasonRef:seasonRef,MerchSubGroupRef:merchSubGroupRef,BuyerGroupRefs:passBuyerGroupParam(buyerGroupRef,buyerGroupRefs),CategoryGroupRefs:'',CategoryRef:''},
  };
  const payload=await passRequest(ownerId,`${PASS_API_ROOT}/Report/GetReportData`,'POST',body);
  const rows=Array.isArray(payload&&payload.Data&&payload.Data[0])?payload.Data[0]:[];
  return rows;
}

async function startRecording(ownerId,urlValue) {
  const key=safeOwner(ownerId), target=assertAllowedUrl(urlValue), {context}=await ensureContext(ownerId);
  const previous=recorders.get(key);if(previous&&!previous.stopped){previous.stopped=true;if(previous.syncTimer)clearInterval(previous.syncTimer);}
  const rec={id:`record_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,ownerId:key,stopped:false,url:target.href,targetIds:new Set(),steps:[{id:'step_1',action:'goto',strategy:'',selector:'',role:'',name:'',targets:[],value:'',url:target.href,waitMs:0,description:'Hedef siteyi aç'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),syncTimer:null};
  recorders.set(key,rec);const page=await pageForCurrentBuyerLogProfile(context,target.href);rec.targetIds.add(page.targetId);if(page.url()!==target.href)await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:45000});await installRecorderOnPage(page);
  // v7.75 — bir syncPages() turu (yeni sekme algılandığında Target.attachToTarget +
  // Page.enable + Runtime.enable + binding/init-script kurulumu) 180ms'den uzun
  // sürebiliyor; setInterval önceki turu BEKLEMEDEN bir sonrakini ateşliyordu.
  // Üst üste binen turlar aynı yeni hedefi paralel attach etmeye çalışıyor,
  // her deneme paylaşılan browserClient'a dinleyici ekliyordu (kök neden artık
  // PortableContext._addTarget'ta çözüldü). syncing bayrağı burada da ikinci
  // bir savunma hattı: önceki tur bitmeden yenisi hiç başlamaz.
  let recordingSyncing=false;
  rec.syncTimer=setInterval(()=>{
    if(recordingSyncing)return;
    recordingSyncing=true;
    context.syncPages().catch(()=>{}).finally(()=>{recordingSyncing=false;});
  },180);
  rec.syncTimer.unref?.();return publicRecording(rec);
}
async function recordingState(ownerId,recordId){const key=safeOwner(ownerId),rec=recorders.get(key);if(!rec||rec.id!==clean(recordId))throw connectorError('Browser kayıt oturumu bulunamadı.','BROWSER_RECORDING_NOT_FOUND',404);const entry=contexts.get(key);if(entry)await entry.context.syncPages().catch(()=>{});return publicRecording(rec);}
async function stopRecording(ownerId,recordId){const key=safeOwner(ownerId),rec=recorders.get(key);if(!rec||rec.id!==clean(recordId))throw connectorError('Browser kayıt oturumu bulunamadı.','BROWSER_RECORDING_NOT_FOUND',404);const entry=contexts.get(key);if(entry)await entry.context.syncPages().catch(()=>{});rec.stopped=true;if(rec.syncTimer)clearInterval(rec.syncTimer);rec.syncTimer=null;rec.updatedAt=new Date().toISOString();return publicRecording(rec);}

function locatorForTarget(page,target){if(target.strategy==='label')return page.getByLabel(target.selector).first();if(target.strategy==='placeholder')return page.getByPlaceholder(target.selector).first();if(target.strategy==='role')return page.getByRole(target.role||'button',{name:target.name||target.selector}).first();if(target.strategy==='css')return page.locator(target.selector).first();return page.getByText(target.selector).first();}
async function locate(page,step,timeoutMs){let lastError=null;for(const target of step.targets||[]){try{const locator=locatorForTarget(page,target);await locator.waitFor({state:'visible',timeout:Math.min(5000,timeoutMs)});return{locator,target};}catch(error){lastError=error;}}throw connectorError(`Web öğesi bulunamadı: ${step.description||step.selector||step.id}${lastError&&lastError.message?` · ${lastError.message}`:''}`,'BROWSER_ELEMENT_NOT_FOUND',409,{stepId:step.id,targets:step.targets});}
async function assertStep(page,step,timeoutMs){
  const {target}=await locate(page,step,timeoutMs);
  if(!step.value)return{ok:true,target,mode:'visible'};
  const expected=step.value.toLocaleLowerCase('tr-TR');
  const bodyText=await page._evaluateValue(`String(document.body&&document.body.innerText||'').slice(0,200000)`).catch(()=> '');
  if(String(bodyText||'').toLocaleLowerCase('tr-TR').includes(expected))return{ok:true,target,mode:'page_text_contains',expected:step.value};
  throw connectorError(`Assert beklenen metni doğrulamadı: ${step.value}`,'BROWSER_ASSERT_FAILED',409,{stepId:step.id});
}
function browserScriptResult(value){
  if(typeof value==='undefined')return null;
  try{const json=JSON.stringify(value);if(typeof json!=='string')return null;return json.length<=8000?JSON.parse(json):{truncated:true,preview:json.slice(0,8000)};}catch(_){return String(value).slice(0,8000);}
}
async function executeStep(page,step,timeoutMs,item=null,itemIndex=1){if(step.action==='goto'){const target=assertAllowedUrl(step.url);await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:45000});return{action:'goto',url:page.url()};}if(step.action==='wait'){await page.waitForTimeout(step.waitMs||500);return{action:'wait',waitMs:step.waitMs||500};}if(step.action==='script'){const payload=JSON.stringify(item==null?null:item).replace(/</g,'\\u003c'),deadline=Math.max(1000,Math.min(30000,Number(timeoutMs)||12000));const expression=`Promise.race([(async function(item,index){\n${step.value}\n}).call(window,${payload},${Number(itemIndex)||1}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Buyer Log terminal code timeout')),${deadline}))])`;try{return{action:'script',result:browserScriptResult(await page._evaluateValue(expression))};}catch(error){throw connectorError(`Terminal kodu çalıştırılamadı: ${clean(error&&error.message||error)}`,'BROWSER_SCRIPT_FAILED',409,{stepId:step.id});}}if(step.action==='assert_text'){const expected=clean(step.value);if(!expected)throw connectorError('Doğrulama metni boş olamaz.','BROWSER_ASSERT_TEXT_REQUIRED');const bodyText=await page._evaluateValue(`String(document.body&&document.body.innerText||'').slice(0,200000)`).catch(()=> '');if(String(bodyText||'').toLocaleLowerCase('tr-TR').includes(expected.toLocaleLowerCase('tr-TR')))return{ok:true,action:'assert_text',expected};throw connectorError(`Sayfada beklenen doğrulama metni bulunamadı: ${expected}`,'BROWSER_ASSERT_FAILED',409,{stepId:step.id,expected});}if(step.action==='assert')return assertStep(page,step,timeoutMs);const found=await locate(page,step,timeoutMs),locator=found.locator;if(step.action==='fill')await locator.fill(step.value);else if(step.action==='select')await locator.selectOption({label:step.value}).catch(()=>locator.selectOption(step.value));else if(step.action==='press')await locator.press(step.value||'Enter');else if(step.action==='check')await locator.check();else if(step.action==='uncheck')await locator.uncheck();else if(step.action==='dblclick')await locator.dblclick();else await locator.click();if(step.waitMs)await page.waitForTimeout(step.waitMs);return{action:step.action,target:found.target};}
function itemValue(item,pathText){
  const path=clean(pathText);if(!path)return item;
  return path.split('.').reduce((current,key)=>current==null?undefined:current[key],item);
}
function interpolateItem(value,item,index){
  if(Array.isArray(value))return value.map(entry=>interpolateItem(entry,item,index));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,interpolateItem(entry,item,index)]));
  if(typeof value!=='string')return value;
  const exact=/^\s*\{\{\s*(item(?:\.[^{}]+)?|index)\s*\}\}\s*$/.exec(value);
  if(exact){if(exact[1]==='index')return index;const result=itemValue(item,exact[1].replace(/^item\.?/,''));return typeof result==='undefined'?value:result;}
  return value.replace(/\{\{\s*(item(?:\.[^{}]+)?|index)\s*\}\}/g,(all,key)=>{if(key==='index')return String(index);const result=itemValue(item,key.replace(/^item\.?/,''));return typeof result==='undefined'?all:String(result==null?'':result);});
}

async function run(ownerId,args={},ctx={}){
  const baseUrl=assertAllowedUrl(args.url), rawSteps=Array.isArray(args.steps)?args.steps:[];
  if(!rawSteps.length)throw connectorError('Browser Automation çalıştırmak için en az bir kayıtlı adım gerekli.','BROWSER_STEPS_EMPTY');
  const items=Array.isArray(args.items)?args.items.slice(0,200):[null], batch=Array.isArray(args.items), timeoutMs=Math.max(1000,Math.min(30000,Number(args.timeoutMs)||12000)),continueOnError=args.continueOnError===true;
  if(batch&&args.items.length>200)throw connectorError('Browser Automation tek çalıştırmada en fazla 200 kayıt işleyebilir.','BROWSER_BATCH_LIMIT',413);
  if(ctx.dryRun){const steps=rawSteps.map((step,index)=>normalizeStep(step,index));return{dryRun:true,ok:true,url:baseUrl.href,steps:steps.length,items:items.length,continueOnError,actions:steps.map(step=>({id:step.id,action:step.action,description:step.description,url:step.url||undefined,targets:step.targets.length}))};}
  const {context}=await ensureContext(ownerId), page=await pageForCurrentBuyerLogProfile(context,baseUrl.href);let activePage=page;const itemResults=[];
  for(let itemIndex=0;itemIndex<items.length;itemIndex+=1){
    const item=items[itemIndex], itemUrl=assertAllowedUrl(interpolateItem(baseUrl.href,item,itemIndex+1)), steps=rawSteps.map((step,index)=>normalizeStep(interpolateItem(step,item,itemIndex+1),index));
    await activePage.goto(itemUrl.href,{waitUntil:'domcontentloaded',timeout:45000});const results=[];let itemFailed=null;
    for(let index=0;index<steps.length;index+=1){const step=steps[index],beforeTargets=new Set(context.pages().map(entry=>entry.targetId));try{const result=await executeStep(activePage,step,timeoutMs,item,itemIndex+1);await context.syncPages().catch(()=>{});const opened=context.pages().filter(entry=>!beforeTargets.has(entry.targetId)&&!entry.isClosed());if(opened.length){const candidate=opened[opened.length-1],current=validTargetUrl(candidate.url());if(current)assertAllowedUrl(current.href);activePage=candidate;}const current=validTargetUrl(activePage.url());if(current)assertAllowedUrl(current.href);results.push({id:step.id,index:index+1,ok:true,action:step.action,result,url:activePage.url()});}catch(error){results.push({id:step.id,index:index+1,ok:false,action:step.action,error:error.message,code:error.code||'BROWSER_STEP_FAILED',url:activePage.url()});itemFailed={error,step,index};break;}}
    if(itemFailed){itemResults.push({index:itemIndex+1,ok:false,item,completed:results.filter(entry=>entry.ok).length,results});if(!continueOnError){const {error,step,index}=itemFailed;throw connectorError(`Browser Automation ${itemIndex+1}. kayıt / ${index+1}. adımda durdu: ${error.message}`,error.code||'BROWSER_STEP_FAILED',error.statusCode||409,{itemIndex:itemIndex+1,stepId:step.id,stepIndex:index+1,item,results,itemResults});}continue;}
    itemResults.push({index:itemIndex+1,ok:true,item,completed:results.length,results,finalUrl:activePage.url()});
  }
  const failed=itemResults.filter(entry=>!entry.ok).length,processed=itemResults.filter(entry=>entry.ok).length;
  return{ok:failed===0,processed,failed,expectedItems:items.length,stepsPerItem:rawSteps.length,finalUrl:activePage.url(),title:await activePage.title().catch(()=>''),itemResults};
}
/* v7.30 — status() ARTIK EDGE'E BAĞLANMAZ.
   Otomasyon Ayarları penceresi her açılışta, "Bağlantıyı kontrol et" her
   tıklamada, PLM ekranları da ayrıca status() çağırıyordu; her çağrı Edge'e
   yeniden yaklaşıp yeni bir onay diyaloğu açıyordu. Hazır olma bilgisi için
   BAĞLANMAK GEREKMİYOR: canlı bir bağlantı varsa o yeter, yoksa
   DevToolsActivePort'taki portun ÇIPLAK TCP ile dinlendiği yeterli kanıttır —
   bu zaten kullanıcının işaretlediği "Allow remote debugging for this browser
   instance" kutusunun karşılığıdır. Onay ise ilk GERÇEK bağlantıda bir kez
   istenir. */
async function remoteDebuggingListening(){
  if(await cachedEndpointIfAlive()) return true;
  for(const dir of edgeUserDataDirCandidates()){
    const active=readDevToolsActivePort(dir);
    if(active && await tcpOpen(active.port,500)) return true;
  }
  for(const port of COMMON_CDP_PORTS){ if(await tcpOpen(port,400)) return true; }
  return false;
}
async function status(ownerId=''){
  const existing=await remoteDebuggingListening().catch(()=>false),rec=recorders.get(safeOwner(ownerId)),running=edgeProcessRunning();
  return{engine:portableWebEngine.engineStatus(),browserFound:Boolean(edgePath()),edgeRunning:running,browser:'Microsoft Edge',managedPort:managedCdpPort(),existingProfileReady:Boolean(existing),sameWindowReady:Boolean(existing),profileMode:existing?'existing-edge-profile':'existing-edge-profile-required',openMode:existing?'current-profile-new-tab':'current-profile-setup-required',edgeUserDataDir:edgeUserDataDir(),edgeUserDataDirCandidates:edgeUserDataDirCandidates(),managedFallbackEnabled:managedFallbackEnabled(),allowedHosts:allowedHosts(),operation:browserOperationStatus(ownerId),recording:rec&&!rec.stopped?{id:rec.id,steps:rec.steps.length,startedAt:rec.createdAt}:null};
}

module.exports={status,diagnose,cdpProbe,cdpReady,cdpWebSocketReady,looksLikeDevTools,tcpOpen,edgeUserDataDirCandidates,openConnection,openPowerBiImportDashboardSession,isPowerBiNavigationAbort,isPowerBiSessionRedirectUrl,isPowerBiDashboardUrl,sanitizePowerBiUrl,powerBiNavigationFailure,CORENECTUM_STYLE_LIST_URL,startRecording,recordingState,stopRecording,run,collectCoreNectumStyleLinks,coreNectumSelectedStyleRows,coreNectumRestoreSelectedStyleRows,collectAsasTechnicalImages,CORENECTUM_SCAN_PAGE_BUDGET,coreNectumScanExpression,powerBiSchemaWaitDecision,POWERBI_SCHEMA_QUIET_MS,downloadCoreNectumTechnicalSheets,coreNectumTechnicalSheetExpression,coreNectumTechnicalSheetLanguageId,CORENECTUM_TECHNICAL_SHEET_LANGUAGES,coreNectumId,coreNectumColourImageKey,coreNectumResolveRequestedImage,coreNectumImageRecordPlan,coreNectumImageSelectionPlan,pimTechnicalImageUrl,pimTechnicalImageFetchExpression,downloadUmbrellaQtx,umbrellaQtxDownloadExpression,coreNectumRecordsOf,coreNectumColourVariants,coreNectumMergeColourVariants,coreNectumStyleListRows,coreNectumAttachmentUrl,coreNectumRefreshImageUrl,coreNectumListCapture,coreNectumImageMime,coreNectumDirectApiScan,coreNectumUnfilteredRequestBody,coreNectumBulkApiScan,coreNectumBulkImages,coreNectumImageFetchExpression,coreNectumImageFromUrl,coreNectumWaitCapturedImage,coreNectumStyleListRowImage,coreNectumNextListPage,assertAllowedUrl,appendRecordedStep,normalizeStep,recorderInstaller,managedCdpPort,managedProfileDir,edgeUserDataDir,readDevToolsActivePort,connectExistingEdge,discoverExistingEdge,connectPreferredEdge,remoteDebuggingListening,cachedEndpointIfAlive,forgetEndpoint,rememberEndpoint,resetDiscoveryCooldown,discoveryCoolingDown,DISCOVERY_COOLDOWN_MS,browserOperationStatus,BROWSER_OPERATION_TIMEOUTS,USER_APPROVAL_MESSAGE,openExistingEdgeDebugSetup,pageForCurrentBuyerLogProfile,dashboardTemplateScore,managedFallbackEnabled,interpolateItem,itemValue,
  passAuthStatus,passStorageAuthStatus,capturePassAuthorization,createPassAuthCaptureTracker,passStoredTokenPresentExpression,captureExistingPassAuthorization,captureExistingPassAuthorizationFromContext,fetchPassSeasons,fetchPassMagOptions,fetchPassBuyerGroupOptions,fetchPassReportData,passBuyerGroupParam,passReplayHeaders,passAuthorizationHeader,oabExtractOptionList,passRequestExpression,passViewerUrl,PASS_API_ROOT,PASS_VIEWER_BASE,PASS_UI_HOST,PASS_API_HOST,
  CORENECTUM_EXTRA_FIELDS,coreNectumExtraFields,CORENECTUM_EXTRA_FIELDS_JS,
  coreNectumFetchOptimizeExpression,coreNectumFetchOptimizedImage,imageTargetBytes,IMAGE_TARGET_BYTES,IMAGE_DIMENSION_CAP,IMAGE_QUALITY_FLOOR,
  ensureContext,ensureExistingContext,connectorError,safeOwner,sleep};
module.exports.coreNectumApiExpression=coreNectumApiExpression;
module.exports.coreNectumApiCall=coreNectumApiCall;
module.exports.pageForCoreNectumApi=pageForCoreNectumApi;
module.exports.pageInBoundProfile=pageInBoundProfile;
module.exports.coreNectumProfileBinding=coreNectumProfileBinding;
module.exports.pageIsInBoundProfile=pageIsInBoundProfile;
module.exports.pinnedProfileAffinity=pinnedProfileAffinity;
module.exports.pinProfileAffinity=pinProfileAffinity;
module.exports.clearProfileAffinity=clearProfileAffinity;
module.exports.defaultBrowserContextIdOf=defaultBrowserContextIdOf;
module.exports.coreNectumAuthState=coreNectumAuthState;
module.exports.CORENECTUM_AUTH_PROBE_EXPRESSION=CORENECTUM_AUTH_PROBE_EXPRESSION;
module.exports.openCoreNectumStyleApiSession=openCoreNectumStyleApiSession;
module.exports.downloadCoreNectumAttachment=downloadCoreNectumAttachment;
module.exports.CORENECTUM_GET_STYLE_LIST_URL=CORENECTUM_GET_STYLE_LIST_URL;
module.exports.CORENECTUM_GET_STYLE_IMAGES_URL=CORENECTUM_GET_STYLE_IMAGES_URL;
