'use strict';

/*
 * Buyer Log — BACKEND YAŞAM DÖNGÜSÜ (Electron ana süreci tarafından yönetilir)
 *
 * Eskiden: START-BUYER-LOG.cmd → node-portable\node.exe → server\watchdog.js
 * Şimdi:   BuyerLog.exe        → (ELECTRON_RUN_AS_NODE) → server\watchdog.js
 *
 * Backend'in KENDİSİ değişmedi. Gözetmen (watchdog) ve sunucu aynı dosyalar,
 * aynı ortam değişkenleri, aynı veri kökleri. Değişen tek şey, Node'u kimin
 * sağladığı ve süreci kimin sahiplendiği.
 *
 * TASARIM KARARLARI:
 *
 * 1) GÖZETMEN KORUNDU, İKİNCİ BİR BACKEND YAZILMADI. server/watchdog.js
 *    çökme sonrası yeniden başlatma, kısılma ve "20 denemede düzelmezse dur"
 *    mantığını zaten taşıyor (üretimde 531 yeniden başlatma görülmüş bir
 *    koddur). Electron bunu yeniden uygulamaz, sahiplenir.
 *
 * 2) KONSOL PENCERESİ YOK. BuyerLog.exe GUI alt sisteminde derlenmiş bir
 *    ikilidir; ELECTRON_RUN_AS_NODE ile başlatılan çocuk süreç saf Node gibi
 *    davranır ama Windows ona ASLA konsol ayırmaz. Eski akışta konsolun
 *    görünmemesi windowsHide bayrağına bağlıydı; burada ikilinin kendi
 *    doğasından geliyor, yani bayrak unutulsa bile pencere açılmaz.
 *
 * 3) LOGLAR KAYBOLMAZ. CMD penceresi ortadan kalktığı için stdout/stderr
 *    diske yazılır. Bu, "pencere yok, dolayısıyla hata da yok" durumunun tek
 *    panzehiridir.
 *
 * 4) HAZIRLIK GERÇEKTEN ÖLÇÜLÜR. Sabit "2 saniye bekle" yerine port gerçekten
 *    cevap verene kadar yoklanır (scripts/open-app-window.js ile aynı kural).
 *    Yavaş makinede boş hata sayfası açılmasının sebebi sabit beklemeydi.
 *
 * 5) ÖKSÜZ SÜREÇ BIRAKILMAZ. Kapanışta önce nazik SIGTERM (gözetmen kendi
 *    çocuğunu düzgünce kapatır), sonra sınırlı süre beklenir, en son çare
 *    olarak SADECE bizim başlattığımız PID ağacı taskkill ile sonlandırılır.
 *    Rastgele node/chrome süreçleri ASLA öldürülmez.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

const { backendEnv, resolveAppUrl, readJsonFile } = require('./portable-paths');
const { redactSecrets } = require('../shared/secret-redaction');

const READY_TIMEOUT_MS = 90000;
const READY_POLL_MS = 400;
const GRACEFUL_STOP_MS = 6000;
const PROBE_TIMEOUT_MS = 2500;

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

const readJson = readJsonFile;

/*
 * config.json DEĞİŞEBİLİR veridir ve portable kökte durur; app.asar/resources
 * içine ASLA yazılmaz. Yoksa uygulama çekirdeğindeki örnekten üretilir.
 */
function ensureConfig(paths, appCoreRoot) {
  if (!fs.existsSync(paths.configPath)) {
    const example = path.join(appCoreRoot, 'config.example.json');
    const seed = readJson(example, { port: 6194, host: '127.0.0.1' });
    seed.host = '127.0.0.1'; // Masaüstü kipi yalnız loopback dinler.
    ensureDir(path.dirname(paths.configPath));
    fs.writeFileSync(paths.configPath, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  }
  return readJson(paths.configPath, { port: 6194, host: '127.0.0.1' });
}

function ensureDataTree(paths) {
  for (const directory of [
    paths.dataRoot, paths.serverDataRoot, paths.appDataRoot, paths.localDataRoot,
    paths.authDataRoot, paths.portableAppData, paths.portableLocalAppData,
    paths.electronProfileRoot, paths.logsRoot,
  ]) ensureDir(directory);
}

/* Sunucu cevap verene kadar yokla (§4). HTTP durum kodu ne olursa olsun
   (302 giriş yönlendirmesi dâhil) bir cevap gelmesi "hazır" demektir. */
function waitForServer(origin, timeoutMs = READY_TIMEOUT_MS, isAborted = () => false) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const attempt = () => {
      if (isAborted()) { resolve({ ready: false, reason: 'aborted' }); return; }
      const request = http.get(origin + '/', { timeout: 2000 }, response => {
        response.resume();
        resolve({ ready: true, status: response.statusCode });
      });
      request.on('timeout', () => { request.destroy(); retry(); });
      request.on('error', retry);
    };
    const retry = () => {
      if (isAborted()) { resolve({ ready: false, reason: 'aborted' }); return; }
      if (Date.now() >= deadline) { resolve({ ready: false, reason: 'timeout' }); return; }
      setTimeout(attempt, READY_POLL_MS);
    };
    attempt();
  });
}

/*
 * PORT ZATEN TUTULUYOR MU? — masaüstü sürümünün en tehlikeli sessiz arızası.
 *
 * Aynı bilgisayarda ESKİ (CMD + tarayıcı) Buyer Log açıkken BuyerLog.exe
 * çalıştırılırsa şu olur: kendi sunucumuz portu alamayıp EADDRINUSE ile
 * kapanır (bu bir çökme değil, tasarlanmış davranış), ama hazırlık yoklaması
 * porttan cevap ALIR — çünkü orada BAŞKA bir Buyer Log dinlemektedir. Sonuç,
 * masaüstü penceresinin kendi portable verisi yerine ESKİ kurulumun verisini
 * göstermesidir. Kullanıcı iki ayrı veri evreninin arasında olduğunu fark
 * edemez; en kötü tür sessiz veri karışıklığı budur.
 *
 * Bu yüzden sunucu başlatılmadan ÖNCE port yoklanır. Cevap veren biri varsa
 * uygulama sessizce ona bağlanmaz; durumu söyleyip kullanıcıdan diğer kopyayı
 * kapatmasını ister. Electron'un tek-kopya kilidi yalnız iki BuyerLog.exe'yi
 * engeller; eski sürüme karşı koruyan tek şey bu yoklamadır.
 */
function probeOrigin(origin, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise(resolve => {
    const request = http.get(origin + '/', { timeout: timeoutMs }, response => {
      response.resume();
      resolve({ occupied: true, status: response.statusCode });
    });
    request.on('timeout', () => { request.destroy(); resolve({ occupied: false }); });
    request.on('error', () => resolve({ occupied: false }));
  });
}

class BackendProcess {
  constructor(options = {}) {
    this.paths = options.paths;
    this.appCoreRoot = options.appCoreRoot;
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.onUnexpectedExit = typeof options.onUnexpectedExit === 'function' ? options.onUnexpectedExit : () => {};
    this.desktopBridgeSecret = String(options.desktopBridgeSecret || '');
    this.child = null;
    this.stopping = false;
    this.exited = false;
    this.lastExit = null;
    this.origin = '';
    this.port = 0;
    this.logStream = null;
  }

  get pid() { return this.child ? this.child.pid : 0; }
  get running() { return Boolean(this.child) && !this.exited; }

  openLogStream() {
    ensureDir(this.paths.logsRoot);
    const file = path.join(this.paths.logsRoot, 'backend.log');
    /* Log dosyası sınırsız büyümemeli: 8 MB'ı geçince bir kuşak geriye
       döndürülür. Sessizce silinmez, .1 olarak saklanır. */
    try {
      const stat = fs.statSync(file);
      if (stat.size > 8 * 1024 * 1024) fs.renameSync(file, file + '.1');
    } catch (_) { /* dosya yoksa sorun değil */ }
    this.logStream = fs.createWriteStream(file, { flags: 'a' });
    this.logStream.write('\r\n===== ' + new Date().toISOString() + ' — Buyer Log masaüstü oturumu =====\r\n');
  }

  start() {
    const watchdog = path.join(this.appCoreRoot, 'server', 'watchdog.js');
    if (!fs.existsSync(watchdog)) {
      throw Object.assign(new Error('server\\watchdog.js bulunamadı: ' + watchdog), { code: 'BACKEND_MISSING' });
    }
    ensureDataTree(this.paths);
    const config = ensureConfig(this.paths, this.appCoreRoot);
    const address = resolveAppUrl(config);
    this.origin = address.origin;
    this.port = address.port;

    this.openLogStream();
    const env = backendEnv(this.paths, process.env);
    if (this.desktopBridgeSecret) env.BUYER_LOG_DESKTOP_BRIDGE_SECRET = this.desktopBridgeSecret;
    this.log('Backend başlatılıyor: ' + watchdog + ' · port=' + this.port);

    this.child = spawn(process.execPath, [watchdog], {
      cwd: this.appCoreRoot,
      env,
      /* Boruya bağlanır: CMD penceresi olmadığı için tek log kaynağı budur (§3).
         windowsHide ayrıca verilir; ELECTRON_RUN_AS_NODE zaten pencere açmaz
         ama iki güvence bir bayrağın unutulmasından iyidir (§2). */
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });
    this.exited = false;
    this.stopping = false;

    const pipe = stream => {
      if (!stream) return;
      // Boru her kosulda tuketilir: yazamasak bile veriyi almazsak
      // backend kendi stdout'unda kilitlenir.
      stream.on('data', chunk => {
        try { if (this.logStream) this.logStream.write(redactSecrets(chunk.toString())); } catch (_) {}
      });
    };
    pipe(this.child.stdout);
    pipe(this.child.stderr);

    this.child.on('error', error => {
      this.exited = true;
      this.log('Backend süreç hatası: ' + (error && error.message));
      if (!this.stopping) this.onUnexpectedExit({ error });
    });
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.lastExit = { code, signal };
      this.log('Backend kapandı (kod=' + code + ' sinyal=' + signal + ').');
      try { if (this.logStream) this.logStream.end(); } catch (_) {}
      this.logStream = null;
      if (!this.stopping) this.onUnexpectedExit({ code, signal });
    });

    return { origin: this.origin, port: this.port, pid: this.child.pid };
  }

  /* Hazırlık ölçümü. Backend beklerken çökerse boşuna 90 saniye beklenmez. */
  waitUntilReady(timeoutMs = READY_TIMEOUT_MS) {
    return waitForServer(this.origin, timeoutMs, () => this.exited);
  }

  /*
   * Nazik kapanış (§5). Gözetmen SIGTERM alınca kendi sunucu çocuğunu
   * SIGTERM'liyor ve runtime durumunu temizliyor; ancak bunun tamamlandığını
   * beklemeden Electron'u kapatırsak süreç ağacı öksüz kalır.
   */
  async stop() {
    if (!this.child || this.exited) return { stopped: true, forced: false };
    this.stopping = true;
    const pid = this.child.pid;
    this.log('Backend durduruluyor (PID ' + pid + ').');
    const exitPromise = new Promise(resolve => {
      if (this.exited) { resolve(true); return; }
      this.child.once('exit', () => resolve(true));
    });
    try { this.child.kill('SIGTERM'); } catch (_) {}

    const gracefully = await Promise.race([
      exitPromise,
      new Promise(resolve => setTimeout(() => resolve(false), GRACEFUL_STOP_MS)),
    ]);
    if (gracefully) { this.log('Backend düzgün kapandı.'); return { stopped: true, forced: false }; }

    /* Son çare: YALNIZ bizim başlattığımız PID ağacı. Rastgele node/chrome
       süreçlerine dokunulmaz — bu, kullanıcının başka işini öldürmenin
       en kolay yolu olurdu. */
    this.log('Backend zamanında kapanmadı; süreç ağacı sonlandırılıyor (PID ' + pid + ').');
    await new Promise(resolve => {
      if (process.platform !== 'win32') { try { this.child.kill('SIGKILL'); } catch (_) {} resolve(); return; }
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => resolve());
    });
    return { stopped: true, forced: true };
  }
}

module.exports = {
  BackendProcess, waitForServer, probeOrigin, ensureConfig, ensureDataTree, READY_TIMEOUT_MS,
};
