'use strict';

/* Node yerleşik derleme önbelleği (7.0.323).
 *
 * SORUN. Sunucu app.listen() öncesinde yüzlerce modülü senkron yüklüyor; her
 * açılışta V8 bunları sıfırdan ayrıştırıp derliyordu (soğuk diskte saniyeler).
 *
 * ÇÖZÜM. Masaüstü ana süreci backend ortamına NODE_COMPILE_CACHE dizinini
 * verir (electron/portable-paths.js → backendEnv). Burada önbellek, modüller
 * yüklenmeden önce açıkça etkinleştirilir; Node ortam değişkenini kendisi
 * zaten okuduysa çağrı "already enabled" döner ve zararsızdır. Önbellek girdisi
 * dosya içeriği + Node/V8 sürümüyle anahtarlanır: değişen dosya bayat kod
 * çalıştırmaz, yalnız yeniden derlenir.
 *
 * Windows'ta backend süreci TerminateProcess ile kapanabildiği için Node'un
 * çıkışta yaptığı yazma her zaman gerçekleşmez; bu yüzden açılıştan sonra
 * önbellek açıkça diske yazılır (flushCompileCache).
 *
 * Hiçbir adım açılışı durdurmaz: desteklenmeyen çalışma zamanında veya hata
 * durumunda sunucu önbelleksiz, eskisi gibi açılır. */
const CACHE_ENV = 'NODE_COMPILE_CACHE';

function statusName(moduleApi, code) {
  const names = (moduleApi && moduleApi.constants && moduleApi.constants.compileCacheStatus) || {};
  const found = Object.keys(names).find(key => names[key] === code);
  return String(found || code || 'unknown').toLowerCase();
}

function enableBackendCompileCache({ env = process.env, moduleApi = require('module') } = {}) {
  const directory = String((env && env[CACHE_ENV]) || '').trim();
  if (!directory) return { status: 'disabled' };
  if (!moduleApi || typeof moduleApi.enableCompileCache !== 'function') return { status: 'unsupported' };
  try {
    const result = moduleApi.enableCompileCache(directory) || {};
    return { status: statusName(moduleApi, result.status), directory: result.directory || directory };
  } catch (error) {
    return { status: 'failed', message: String((error && error.message) || error).slice(0, 200) };
  }
}

const FLUSH_DELAYS_MS = [10000, 120000];
function scheduleCompileCacheFlush({ moduleApi = require('module'), delays = FLUSH_DELAYS_MS, setTimer = setTimeout } = {}) {
  if (!moduleApi || typeof moduleApi.flushCompileCache !== 'function') return 0;
  let scheduled = 0;
  for (const delay of delays) {
    const timer = setTimer(() => { try { moduleApi.flushCompileCache(); } catch (_) {} }, delay);
    if (timer && typeof timer.unref === 'function') timer.unref();
    scheduled += 1;
  }
  return scheduled;
}

module.exports = { CACHE_ENV, enableBackendCompileCache, scheduleCompileCacheFlush, FLUSH_DELAYS_MS };
