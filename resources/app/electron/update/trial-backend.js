'use strict';
// A trial server may open persistence only after its watchdog has durably
// registered the exact writer PID. Unlike diagnostic watchdog.json, this ledger
// survives watchdog shutdown/crashes until the launcher commits recovery/health.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { atomicWriteJson } = require('./json-store');
const wait = new Int32Array(new SharedArrayBuffer(4));
function fenceError() { return Object.assign(new Error('Güncelleme denemesi için sunucu kimliği doğrulanamadı. / The update trial server identity could not be verified.'), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' }); }
function ledgerFile(localRoot, token) {
  if (!localRoot || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(String(token))) throw fenceError();
  return path.join(path.resolve(localRoot), 'updater', 'trial-backends', token + '.json');
}
function readTrialBackend(localRoot, token) {
  const file = ledgerFile(localRoot, token);
  let value;
  try {
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw fenceError();
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw Object.assign(fenceError(), { cause: error }); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || value.token !== token || !Number.isInteger(value.watchdogPid) || value.watchdogPid <= 0
    || value.serverPid !== null && (!Number.isInteger(value.serverPid) || value.serverPid <= 0)) throw fenceError();
  return value;
}
function registerTrialBackend(serverPid, env = process.env) {
  const token = env.BUYER_LOG_UPDATE_HEALTH_TOKEN;
  if (!token) return false;
  atomicWriteJson(ledgerFile(env.BUYER_LOG_LOCAL_DATA_ROOT, token), { schemaVersion: 1, token, watchdogPid: process.pid, serverPid: serverPid || null });
  return true;
}
function waitForTrialBackend({ env = process.env, pid = process.pid, parentPid = process.ppid, timeoutMs = 5000 } = {}) {
  const token = env.BUYER_LOG_UPDATE_HEALTH_TOKEN;
  if (!token) return false;
  const deadline = performance.now() + Math.max(0, Math.min(5000, timeoutMs));
  do {
    const record = readTrialBackend(env.BUYER_LOG_LOCAL_DATA_ROOT, token);
    if (record && record.serverPid === pid && record.watchdogPid === parentPid) return true;
    Atomics.wait(wait, 0, 0, 15);
  } while (performance.now() < deadline);
  throw fenceError();
}
module.exports = { ledgerFile, readTrialBackend, registerTrialBackend, waitForTrialBackend };
