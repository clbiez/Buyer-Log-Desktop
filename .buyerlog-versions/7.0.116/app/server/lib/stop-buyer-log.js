'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_FILE = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'BuyerLog', 'runtime', 'watchdog.json')
  : path.join(APP_ROOT, 'server', 'data', 'runtime', 'watchdog.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8')); } catch (_) { return null; }
}

function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== 'win32') return null;
  const command = '$p=Get-CimInstance Win32_Process -Filter "ProcessId=' + pid + '";'
    + 'if($p){$p|Select-Object ProcessId,ParentProcessId,Name,CommandLine|ConvertTo-Json -Compress}';
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: false, timeout: 5000,
    }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function isNode(info) { return Boolean(info && /^node(?:\.exe)?$/i.test(String(info.Name || ''))); }
function commandHas(info, fragment) { return String(info && info.CommandLine || '').toLocaleLowerCase().includes(fragment.toLocaleLowerCase()); }
function sameRoot(info, state) {
  const root = String(state && state.appRoot || '').replace(/[\\/]+$/, '').toLocaleLowerCase();
  return Boolean(root) && commandHas(info, root);
}
function verifiedWatchdog(info, state) {
  return isNode(info) && Number(info.ProcessId) === Number(state.watchdogPid)
    && sameRoot(info, state) && /server[\\/]watchdog\.js/i.test(String(info.CommandLine || ''));
}
function verifiedServer(info, state) {
  return isNode(info) && Number(info.ProcessId) === Number(state.serverPid)
    && Number(info.ParentProcessId) === Number(state.watchdogPid)
    && sameRoot(info, state) && /server[\\/]server\.js/i.test(String(info.CommandLine || ''))
    && !/server[\\/]watchdog\.js/i.test(String(info.CommandLine || ''));
}
function terminateVerified(info) {
  if (!info) return false;
  try { process.kill(Number(info.ProcessId), 'SIGTERM'); return true; } catch (_) { return false; }
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function stop() {
  const state = readState();
  const watchdog = state && processInfo(Number(state.watchdogPid));
  if (!state || !verifiedWatchdog(watchdog, state)) {
    console.error('Buyer Log süreci doğrulanamadı; hiçbir süreç durdurulmadı.');
    return 1;
  }
  const server = state.serverPid ? processInfo(Number(state.serverPid)) : null;
  if (server && !verifiedServer(server, state)) {
    console.error('Buyer Log sunucu PID doğrulanamadı; hiçbir süreç durdurulmadı.');
    return 1;
  }
  if (!terminateVerified(watchdog)) return 1;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await wait(100);
    if (!processInfo(Number(state.watchdogPid))) return 0;
  }
  const remainingServer = state.serverPid ? processInfo(Number(state.serverPid)) : null;
  if (remainingServer && verifiedServer(remainingServer, state)) terminateVerified(remainingServer);
  return 0;
}

if (require.main === module) stop().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
module.exports = { readState, processInfo, verifiedWatchdog, verifiedServer, stop, RUNTIME_FILE };
