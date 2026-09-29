'use strict';
/*
 * BuyerLog.exe SİMGESİ — ana süreç tarafı.
 * Release yalnız resources/app taşır; exe'ye gömülü simge güncellemeyle değişmez.
 * buyerlog.ico değiştiğinde exe-icon-worker.mjs ayrı bir düşük öncelikli süreçte
 * exe'nin yeni simgeli kopyasını hazırlar, doğrular ve yerine koyar. Yeni exe
 * bir sonraki açılışta kullanılır; eski dosya o açılışta temizlenir.
 * Durum data/local/branding/exe-icon.json içinde tutulur: aynı simge için iş
 * tekrarlanmaz, başarısız deneme sayısı sınırlıdır.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const MAX_ATTEMPTS = 3;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_) { return {}; }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}

// Önceki değişimden kalan eski exe ve yarım kalmış kopyalar (artık kilitli değil).
function cleanupLeftovers(exePath) {
  const dir = path.dirname(exePath);
  const base = path.basename(exePath).toLowerCase();
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return removed; }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower === base + '.icon-new' || lower.startsWith(base + '.old-')) {
      try { fs.rmSync(path.join(dir, name), { force: true }); removed += 1; } catch (_) {}
    }
  }
  return removed;
}

// Yapılacak iş var mı? Aynı simge zaten uygulanmışsa ve exe o günden beri
// değişmemişse (ör. elle geri kopyalanmamışsa) hiçbir şey yapılmaz.
function planExeIconPatch({ exePath, sourceIcon, stateFile }) {
  if (!exePath || !sourceIcon || !fs.existsSync(exePath) || !fs.existsSync(sourceIcon)) return { action: 'skip', reason: 'missing' };
  const iconHash = sha256(sourceIcon);
  const stat = fs.statSync(exePath);
  const state = readState(stateFile);
  if (state.appliedIconHash === iconHash && state.exeSize === stat.size && state.exeMtimeMs === stat.mtimeMs) {
    return { action: 'skip', reason: 'up-to-date', iconHash };
  }
  if (state.failedIconHash === iconHash && Number(state.failures || 0) >= MAX_ATTEMPTS) {
    return { action: 'skip', reason: 'gave-up', iconHash };
  }
  return { action: 'patch', iconHash, state };
}

function recordResult({ stateFile, plan, result }) {
  const previous = plan.state || {};
  if (result && result.ok && result.swapped) {
    writeState(stateFile, { appliedIconHash: plan.iconHash, exeSize: result.exeSize, exeMtimeMs: result.exeMtimeMs, appliedAt: new Date().toISOString() });
    return;
  }
  const failures = previous.failedIconHash === plan.iconHash ? Number(previous.failures || 0) + 1 : 1;
  writeState(stateFile, { ...previous, failedIconHash: plan.iconHash, failures, lastError: String(result && result.error || 'bilinmeyen hata').slice(0, 400), failedAt: new Date().toISOString() });
}

function parseWorkerOutput(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  try { return JSON.parse(line); } catch (_) { return { ok: false, error: 'işçi çıktısı okunamadı: ' + line.slice(0, 200) }; }
}

function runExeIconPatch({ exePath, sourceIcon, stateFile, log = () => {}, spawn = childProcess.spawn, onApplied = () => {} }) {
  cleanupLeftovers(exePath);
  const plan = planExeIconPatch({ exePath, sourceIcon, stateFile });
  if (plan.action !== 'patch') return Promise.resolve({ ...plan });
  return new Promise(resolve => {
    let stdout = '';
    let child;
    try {
      child = spawn(exePath, [path.join(__dirname, 'exe-icon-worker.mjs'), exePath, sourceIcon], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch (error) {
      const result = { ok: false, error: error.message };
      recordResult({ stateFile, plan, result });
      resolve({ action: 'failed', ...result });
      return;
    }
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (_) {}
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', error => { stdout += '\n' + JSON.stringify({ ok: false, error: error.message }); });
    child.on('close', () => {
      const result = parseWorkerOutput(stdout);
      try { recordResult({ stateFile, plan, result }); } catch (error) { log('Exe simge durumu yazılamadı: ' + error.message); }
      if (result.ok && result.swapped) {
        log('BuyerLog.exe simgesi güncellendi; yeni simge bir sonraki açılışta görünür.');
        try { onApplied(result); } catch (_) {}
        resolve({ action: 'patched', ...result });
      } else {
        log('BuyerLog.exe simgesi güncellenemedi: ' + (result.error || 'bilinmeyen hata'));
        resolve({ action: 'failed', ...result });
      }
    });
  });
}

module.exports = { runExeIconPatch, planExeIconPatch, cleanupLeftovers, parseWorkerOutput, MAX_ATTEMPTS };
