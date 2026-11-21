'use strict';

/* OneDrive istemcisi için güvenli, kullanıcı onaylı yardımcı işlemler.

   Buyer Log OneDrive'ın yükleme/indirme kuyruğunu doğrudan yönetemez; resmi
   bir arayüz yoktur. Yalnız iki geri alınabilir işlem sunulur:
   1) "Bu cihazda her zaman tut" (attrib +P -U): yalnız küçük senkron
      klasörlerine uygulanır; OneDrive dosyaları önceden indirir, Buyer Log
      okumaları bulut indirmesini beklerken zaman aşımına düşmez. Görsel ve
      kişisel yedek klasörlerine uygulanmaz (disk kullanımı).
   2) OneDrive'ı kapatıp yeniden başlatmak (/shutdown → /background).
      Takılmış kuyruklar için bilinen tek etkili çaredir; OneDrive kuyruğunu
      diskte tutar, yeniden açılınca kaldığı yerden sürdürür.
   /reset, dosya silme veya bulut API'siyle doğrudan yazma YOKTUR.
   Komutlar kabuk olmadan (execFile, argüman dizisi) çalışır. */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PIN_FOLDERS = ['sync', 'master', 'business', 'iam'];
const DEFAULT_LAYOUT = { sync: 'BUYER_LOG_SYNC', master: 'master', business: 'business', iam: 'iam' };
const RESTART_COOLDOWN_MS = 10 * 60 * 1000;

function controlError(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function defaultExec(file, args, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { error.stdout = String(stdout || ''); error.stderr = String(stderr || ''); reject(error); return; }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function defaultLaunch(file, args) {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

const normalize = value => path.win32.resolve(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();

function isInside(child, parent) {
  const c = normalize(child), p = normalize(parent);
  return Boolean(p) && (c === p || c.startsWith(`${p}\\`));
}

/* reg query çıktısındaki sürücü yolu taşıyan REG_SZ değerleri: OneDrive hesap
   klasörleri (UserFolder) ve eşitlenen SharePoint kitaplıkları
   (ScopeIdToMountPointPathCache). */
function parseRegistryRoots(output) {
  const roots = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /\sREG_(?:EXPAND_)?SZ\s+([A-Za-z]:\\[^\r\n]*?)\s*$/.exec(line);
    if (match) roots.add(match[1]);
  }
  return [...roots];
}

function createOneDriveControl({ platform = process.platform, env = process.env, exec = defaultExec, launch = defaultLaunch,
  exists = file => fs.existsSync(file), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
  let lastRestartAt = 0, busy = false;
  const windows = platform === 'win32';
  const system32 = file => path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', file);

  function executable() {
    const candidates = [
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'OneDrive', 'OneDrive.exe'),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Microsoft OneDrive', 'OneDrive.exe'),
      env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Microsoft OneDrive', 'OneDrive.exe'),
    ].filter(Boolean);
    return candidates.find(file => { try { return exists(file); } catch (_) { return false; } }) || '';
  }

  async function running() {
    try {
      const { stdout } = await exec(system32('tasklist.exe'), ['/FI', 'IMAGENAME eq OneDrive.exe', '/FO', 'CSV', '/NH'], { timeout: 8000 });
      return /"onedrive\.exe"/i.test(stdout);
    } catch (_) { return null; }
  }

  async function syncRoots() {
    const roots = [env.OneDriveCommercial, env.OneDriveConsumer, env.OneDrive].filter(Boolean);
    try {
      const { stdout } = await exec(system32('reg.exe'), ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s'], { timeout: 8000 });
      roots.push(...parseRegistryRoots(stdout));
    } catch (_) { /* kayıt defteri okunamazsa ortam değişkenleri yeter */ }
    return [...new Set(roots)];
  }

  async function detect(sharedRoot) {
    if (!windows) return { supported: false, platform, managed: false, running: null, executable: false, restartAvailableInMs: 0 };
    const roots = sharedRoot ? await syncRoots() : [];
    const managed = Boolean(sharedRoot) && roots.some(root => isInside(sharedRoot, root));
    return { supported: true, platform, managed, running: await running(), executable: Boolean(executable()),
      restartAvailableInMs: Math.max(0, lastRestartAt + RESTART_COOLDOWN_MS - now()) };
  }

  async function requireManaged(sharedRoot) {
    if (!windows) throw controlError('Bu işlem yalnız Windows\'ta kullanılabilir.', 'ONEDRIVE_UNSUPPORTED_PLATFORM');
    if (!sharedRoot) throw controlError('Ortak klasör ayarlı değil.', 'SYNC_NOT_CONFIGURED');
    const info = await detect(sharedRoot);
    if (!info.managed) throw controlError('Ortak klasör bir OneDrive klasörü olarak doğrulanamadı.', 'ONEDRIVE_NOT_MANAGED');
    return info;
  }

  async function keepOnDevice(sharedRoot, layout = {}) {
    await requireManaged(sharedRoot);
    if (busy) throw controlError('Başka bir OneDrive işlemi sürüyor.', 'ONEDRIVE_BUSY');
    busy = true;
    try {
      const attrib = system32('attrib.exe'), folders = [], failed = [];
      for (const key of PIN_FOLDERS) {
        const name = String(layout[key] || DEFAULT_LAYOUT[key]);
        // Manifest yalnız tek seviyeli göreli ad verebilir; kök dışına çıkış yok.
        if (!name || name.includes('..') || /[\\/:]/.test(name)) continue;
        const folder = path.win32.join(sharedRoot, name);
        if (!exists(folder)) continue;
        try {
          await exec(attrib, ['+P', '-U', folder], { timeout: 30000 });
          await exec(attrib, ['+P', '-U', path.win32.join(folder, '*'), '/S', '/D'], { timeout: 180000 });
          folders.push(name);
        } catch (error) { failed.push({ folder: name, error: String(error && (error.stderr || error.message) || error).slice(0, 300) }); }
      }
      if (!folders.length && failed.length) throw controlError('OneDrive "cihazda tut" ayarı uygulanamadı.', 'ONEDRIVE_PIN_FAILED', 500);
      return { pinned: folders, failed };
    } finally { busy = false; }
  }

  async function restart(sharedRoot) {
    const info = await requireManaged(sharedRoot);
    if (info.restartAvailableInMs > 0) throw controlError('OneDrive kısa süre önce yeniden başlatıldı; biraz bekleyin.', 'ONEDRIVE_RESTART_COOLDOWN', 429);
    if (busy) throw controlError('Başka bir OneDrive işlemi sürüyor.', 'ONEDRIVE_BUSY');
    const exe = executable();
    if (!exe) throw controlError('OneDrive uygulaması bulunamadı.', 'ONEDRIVE_NOT_FOUND', 404);
    busy = true; lastRestartAt = now();
    try {
      const wasRunning = info.running === true;
      if (wasRunning) {
        try { await exec(exe, ['/shutdown'], { timeout: 30000 }); } catch (_) { /* kapanış beklemesiyle doğrulanır */ }
        let stopped = false;
        for (let i = 0; i < 30; i++) {
          if ((await running()) === false) { stopped = true; break; }
          await sleep(1000);
        }
        if (!stopped) throw controlError('OneDrive kapanmadı; yeniden başlatma yapılmadı.', 'ONEDRIVE_SHUTDOWN_TIMEOUT', 504);
      }
      launch(exe, ['/background']);
      return { restarted: wasRunning, started: true };
    } finally { busy = false; }
  }

  return { detect, keepOnDevice, restart };
}

module.exports = { createOneDriveControl, parseRegistryRoots, isInside, PIN_FOLDERS, RESTART_COOLDOWN_MS };
