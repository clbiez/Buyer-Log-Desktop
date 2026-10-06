const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');
/* v7.44 — SÜRÜM ZIP'İ ARTIK AÇILIŞTA OLUŞTURULMUYOR.
   Kullanıcı talebi: "program versiyon değişiklikleri sırasında her ilk açılışta
   versiyon kopyasını zip olarak oluşturuyor. Buna gerek yok, yapmasın."
   Gözetmen bu yüzden scripts/archive-release.js'i artık ÇAĞIRMIYOR. Betik
   duruyor; isteyen "npm run archive" ile elle bir kopya alabilir. Böylece
   açılışta paket klasörüne (çoğunlukla bir ağ klasörü) megabaytlarca yazma
   yapılmıyor ve hiçbir dosya kendiliğinden silinmiyor. */

const APP_ROOT = path.join(__dirname, '..');
const SERVER_FILE = process.env.BL_SERVER_FILE
  ? path.resolve(process.env.BL_SERVER_FILE)
  : path.join(__dirname, 'server.js');
const LOG_ROOT = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'BuyerLog', 'logs')
  : path.join(APP_ROOT, 'server', 'data', 'logs');
const LOG_FILE = path.join(LOG_ROOT, 'server-restart.log');
const RUNTIME_ROOT = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'BuyerLog', 'runtime')
  : path.join(APP_ROOT, 'server', 'data', 'runtime');
const RUNTIME_FILE = path.join(RUNTIME_ROOT, 'watchdog.json');

/* Kullanıcı oturum çerezi imza anahtarı: gözetmen ömrü boyunca sabit, yalnız
   bellekte. Sunucu çöküp yeniden başlatılınca açık oturum giriş ekranına
   düşmesin diye her başlatmada aynı değer ortamla aktarılır; diske yazılmaz. */
// Masaüstü süreci bir anahtar verdiyse o kullanılır: gözetmenin kendisi de
// yeniden başlatılsa oturum korunur.
const USER_SESSION_SECRET = /^[0-9a-f]{64,}$/i.test(String(process.env.BUYER_LOG_USER_SESSION_SECRET || ''))
  ? String(process.env.BUYER_LOG_USER_SESSION_SECRET)
  : crypto.randomBytes(32).toString('hex');
let child = null;
let restartTimer = null;
let stopping = false;
let recentRestarts = [];

function stamp() {
  return new Date().toISOString();
}
function writeLog(message) {
  const line = `[${stamp()}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_ROOT, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + os.EOL, 'utf8');
  } catch (_) { /* logging must never stop the watchdog */ }
}
function writeRuntimeState(serverPid) {
  try {
    fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
    const temporary = `${RUNTIME_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
      appRoot: path.resolve(APP_ROOT),
      serverFile: path.resolve(SERVER_FILE),
      watchdogPid: process.pid,
      serverPid: serverPid ? Number(serverPid) : null,
      updatedAt: stamp(),
    }), 'utf8');
    fs.renameSync(temporary, RUNTIME_FILE);
  } catch (_) { /* process control metadata must never stop the watchdog */ }
}
function clearRuntimeState() {
  try { fs.rmSync(RUNTIME_FILE, { force: true }); } catch (_) {}
}
/* server/server.js ile paylaşılan çıkış kodu: "port başka bir Buyer Log
   kopyasında; bu kopyaya gerek yok". Yeniden başlatmak anlamsızdır. */
const EXIT_ALREADY_RUNNING = 3;
/* Kısılma tek başına yetmiyordu. 10 saniyelik gecikme, düzelmeyen bir hatada
   yalnız döngüyü yavaşlatır; üretim logunda 531 yeniden başlatma birikmişti.
   Bir saat içinde bu kadar denemeden sonra sorun kendiliğinden geçmiyordur;
   gözetmen sebebi yazıp durur, kullanıcı programı yeniden açar. */
const GIVE_UP_AFTER = 20;
const GIVE_UP_WINDOW_MS = 3600000;
let restartsInWindow = [];
function restartDelay() {
  const now = Date.now();
  recentRestarts = recentRestarts.filter(t => now - t < 60000);
  recentRestarts.push(now);
  // Normal failures recover quickly. A persistent crash loop is throttled so the
  // computer is not flooded with processes or log output.
  return recentRestarts.length >= 5 ? 10000 : 3000;
}
function giveUp(reason) {
  stopping = true;
  writeLog(`${reason} Gözetmen duruyor; Buyer Log'u yeniden açın.`);
  clearRuntimeState();
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  process.exit(0);
}
function scheduleRestart(reason) {
  if (stopping || restartTimer) return;
  const now = Date.now();
  restartsInWindow = restartsInWindow.filter(t => now - t < GIVE_UP_WINDOW_MS);
  restartsInWindow.push(now);
  if (restartsInWindow.length > GIVE_UP_AFTER) {
    giveUp(`${reason}. Son ${Math.round(GIVE_UP_WINDOW_MS / 60000)} dakikada ${restartsInWindow.length} kez yeniden başlatıldı ve düzelmedi.`);
    return;
  }
  const delay = restartDelay();
  writeLog(`${reason}. Sunucu ${Math.round(delay / 1000)} saniye içinde yeniden başlatılacak.`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startServer();
  }, delay);
}
function startServer() {
  if (stopping) return;
  writeLog('Buyer Log sunucusu başlatılıyor.');
  writeRuntimeState(null);
  const env = {
    ...process.env,
    // The application must remain alive even when every browser tab is closed.
    BL_AUTOEXIT: '0',
    BL_KEEP_ALIVE: '1',
    BUYER_LOG_USER_SESSION_SECRET: USER_SESSION_SECRET,
  };
  try {
    child = spawn(process.execPath, [SERVER_FILE], {
      cwd: APP_ROOT,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
  } catch (err) {
    child = null;
    clearRuntimeState();
    scheduleRestart(`Sunucu süreci oluşturulamadı: ${err.message}`);
    return;
  }
  writeRuntimeState(child.pid);
  child.once('error', err => {
    child = null;
    clearRuntimeState();
    scheduleRestart(`Sunucu süreç hatası: ${err.message}`);
  });
  child.once('exit', (code, signal) => {
    child = null;
    writeRuntimeState(null);
    if (stopping) return;
    if (!signal && code === EXIT_ALREADY_RUNNING) {
      giveUp('Buyer Log zaten çalışıyor; bu gözetmene gerek yok.');
      return;
    }
    const detail = signal ? `sinyal=${signal}` : `çıkış kodu=${code}`;
    scheduleRestart(`Sunucu beklenmedik şekilde kapandı (${detail})`);
  });
}
function stopWatchdog(signal) {
  if (stopping) return;
  stopping = true;
  writeLog(`Gözetmen kapatılıyor (${signal}).`);
  clearRuntimeState();
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (child && !child.killed) {
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => process.exit(0), 1500).unref();
  } else {
    process.exit(0);
  }
}
process.on('SIGINT', () => stopWatchdog('SIGINT'));
process.on('SIGTERM', () => stopWatchdog('SIGTERM'));
process.on('uncaughtException', err => {
  writeLog(`Gözetmen hatası yakalandı: ${err && err.stack ? err.stack : err}`);
  scheduleRestart('Gözetmen çalışmaya devam ediyor');
});
process.on('unhandledRejection', err => {
  writeLog(`Gözetmen promise hatası yakaladı: ${err && err.stack ? err.stack : err}`);
});

startServer();
