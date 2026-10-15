'use strict';

/* Olay döngüsü ve heap baskısı tanılaması.

   Sahada sunucu açılıştan sonra hiçbir log yazmadan dakikalarca yanıtsız
   kaldı; logda bunun bellek baskısı mı yoksa uzun bir eşzamanlı iş mi olduğunu
   ayıracak hiçbir iz yoktu. Bu izleyici yalnız sayısal ölçüm yazar
   (kullanıcı, yol veya iş verisi içermez):
   - açılışta V8 heap sınırı,
   - olay döngüsü eşikten uzun bloke kaldıysa, döngü serbest kaldığı anda
     süresi ve o arada harcanan CPU ile birlikte (uyku/saat sıçraması elenir),
   - heap kullanımı sınırın %80'ini aştığında (dakikada en çok bir kez).

   Kilit profili: V8'in örnekleyici CPU profili arka planda sürekli açık
   tutulur (5 ms örnek aralığı) ve bir dakikada bir sıfırlanır, böylece bellek
   sınırlı kalır. Uzun bir kilit (varsayılan 10 sn) biter bitmez profil
   alınır; en çok CPU harcayan fonksiyonlar ve en ağır çağrı zincirleri
   `[RUNTIME] stall-profile` satırlarıyla loga yazılır, tam profil de
   logs/stall-profiles altına .cpuprofile olarak saklanır (en çok 3 dosya).
   Satırlar yalnız fonksiyon adı ve uygulama içi dosya yolu içerir; iş verisi,
   kullanıcı adı veya yerel klasör yolu içermez. BL_STALL_PROFILE=0 kapatır. */
const v8 = require('v8');
const fs = require('fs');
const path = require('path');

const MB = 1048576;
function heapNumbers() {
  const stats = v8.getHeapStatistics();
  return {
    heapUsedMb: Math.round(stats.used_heap_size / MB),
    heapLimitMb: Math.round(stats.heap_size_limit / MB),
    rssMb: Math.round(process.memoryUsage.rss() / MB),
  };
}
function formatLine(kind, values) {
  return `[RUNTIME] ${kind} ${Object.entries(values).map(([key, value]) => `${key}=${value}`).join(' ')}`;
}

// Only the path inside the application (server/…, public/…), never the local folder.
function appRelative(url) {
  const value = String(url || '').replace(/\\/g, '/');
  if (!value) return '';
  const match = value.match(/\/(server|public|electron)\/(.+)$/);
  if (match) return match[1] + '/' + match[2];
  if (value.startsWith('node:')) return value;
  return path.basename(value);
}
function frameLabel(callFrame) {
  const name = callFrame.functionName || '(anonymous)';
  const file = appRelative(callFrame.url);
  return file ? `${name} ${file}:${Number(callFrame.lineNumber) + 1}` : name;
}

/* Self time per function and the heaviest call chains of a V8 CPU profile. */
function summarizeProfile(profile, { topFunctions = 15, topStacks = 4, stackDepth = 18 } = {}) {
  const nodes = new Map(), parent = new Map(), self = new Map();
  for (const node of profile.nodes || []) {
    nodes.set(node.id, node);
    for (const child of node.children || []) parent.set(child, node.id);
  }
  const samples = profile.samples || [], deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i += 1) self.set(samples[i], (self.get(samples[i]) || 0) + Math.max(0, Number(deltas[i]) || 0));
  const totalUs = [...self.values()].reduce((sum, value) => sum + value, 0);
  const byFunction = new Map();
  for (const [id, us] of self) {
    const node = nodes.get(id);
    if (!node) continue;
    const label = frameLabel(node.callFrame);
    byFunction.set(label, (byFunction.get(label) || 0) + us);
  }
  const functions = [...byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, topFunctions)
    .map(([label, us]) => ({ label, ms: Math.round(us / 1000), pct: totalUs ? Math.round(us * 1000 / totalUs) / 10 : 0 }));
  // Heaviest leaf nodes, each with its call chain towards the root.
  const stacks = [...self.entries()].filter(([id]) => nodes.has(id)).sort((a, b) => b[1] - a[1]).slice(0, topStacks).map(([id, us]) => {
    const chain = [];
    for (let current = id; current != null && chain.length < stackDepth; current = parent.get(current)) {
      const node = nodes.get(current);
      if (!node || node.callFrame.functionName === '(root)') break;
      chain.push(frameLabel(node.callFrame));
    }
    return { ms: Math.round(us / 1000), chain };
  });
  return { totalMs: Math.round(totalUs / 1000), functions, stacks };
}

function createStallProfiler({ log, samplingUs = 5000, windowMs = 60000, dir = null, keep = 3 } = {}) {
  let session = null, running = false, windowStart = 0, busy = false;
  try {
    const inspector = require('inspector');
    session = new inspector.Session();
    session.connect();
  } catch (_) { return null; }
  const post = (method, params) => new Promise(resolve => {
    try { session.post(method, params || {}, (error, result) => resolve(error ? null : result)); }
    catch (_) { resolve(null); }
  });
  async function start() {
    if (await post('Profiler.enable') === null) return false;
    await post('Profiler.setSamplingInterval', { interval: samplingUs });
    running = (await post('Profiler.start')) !== null;
    windowStart = Date.now();
    return running;
  }
  function save(profile) {
    if (!dir) return '';
    try {
      fs.mkdirSync(dir, { recursive: true });
      const name = 'stall-' + new Date().toISOString().replace(/[:.]/g, '-') + '.cpuprofile';
      fs.writeFileSync(path.join(dir, name), JSON.stringify(profile));
      const files = fs.readdirSync(dir).filter(file => file.endsWith('.cpuprofile')).sort();
      for (const file of files.slice(0, Math.max(0, files.length - keep))) { try { fs.unlinkSync(path.join(dir, file)); } catch (_) {} }
      return name;
    } catch (_) { return ''; }
  }
  // A quiet minute is discarded so the profile buffer stays small.
  async function rotate() {
    if (!running || busy || Date.now() - windowStart < windowMs) return;
    busy = true;
    try { await post('Profiler.stop'); await post('Profiler.start'); windowStart = Date.now(); }
    finally { busy = false; }
  }
  async function capture(blockedMs) {
    if (!running || busy) return;
    busy = true;
    try {
      const result = await post('Profiler.stop');
      if (result && result.profile) {
        const summary = summarizeProfile(result.profile);
        const file = save(result.profile);
        log(formatLine('stall-profile', { blockedMs, sampledMs: summary.totalMs, ...(file ? { file } : {}) }));
        summary.functions.forEach((item, index) => log(`[RUNTIME] stall-profile top${index + 1} ${item.ms}ms ${item.pct}% ${item.label}`));
        summary.stacks.forEach((item, index) => log(`[RUNTIME] stall-profile stack${index + 1} ${item.ms}ms ${item.chain.join(' < ')}`));
      }
      await post('Profiler.start'); windowStart = Date.now();
    } catch (_) { /* diagnostics never break the server */ }
    finally { busy = false; }
  }
  return { start, rotate, capture, stop: () => { running = false; void post('Profiler.stop'); try { session.disconnect(); } catch (_) {} } };
}

function defaultProfileDir() {
  try { return path.join(require('../user-data').LOGS_ROOT, 'stall-profiles'); } catch (_) { return null; }
}

const SUSPEND_MS = 10 * 60000;
function startRuntimePressureMonitor({ log = console.log, intervalMs = 5000, stallMs = 3000, pressureRatio = 0.8, pressureEveryMs = 60000, now = Date.now, cpu = () => { const usage = process.cpuUsage(); return usage.user + usage.system; },
  profile = process.env.BL_STALL_PROFILE !== '0', profileStallMs = 10000, profileDir } = {}) {
  log(formatLine('heap-limit', heapNumbers()));
  const profiler = profile ? createStallProfiler({ log, dir: profileDir === undefined ? defaultProfileDir() : profileDir }) : null;
  if (profiler) void profiler.start().then(ok => { if (ok) log(formatLine('stall-profiler', { samplingMs: 5, minStallMs: profileStallMs })); });
  let expected = now() + intervalMs, lastPressureAt = 0, lastCpu = cpu();
  const timer = setInterval(() => {
    const at = now(), lagMs = at - expected, usedCpu = cpu(), cpuMs = Math.round((usedCpu - lastCpu) / 1000);
    expected = at + intervalMs; lastCpu = usedCpu;
    const numbers = heapNumbers();
    // cpuMs separates a real block (CPU close to blockedMs) from sleep/hibernate
    // or a wall-clock jump (CPU near 0); the latter is not reported.
    const suspended = lagMs > SUSPEND_MS && cpuMs < lagMs / 20;
    if (lagMs >= stallMs && !suspended) {
      log(formatLine('event-loop-stall', { blockedMs: lagMs, cpuMs, ...numbers }));
      if (profiler && lagMs >= profileStallMs) void profiler.capture(lagMs);
    } else if (profiler) void profiler.rotate();
    if (numbers.heapUsedMb >= numbers.heapLimitMb * pressureRatio && at - lastPressureAt >= pressureEveryMs) {
      lastPressureAt = at;
      log(formatLine('heap-pressure', numbers));
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => { clearInterval(timer); profiler?.stop(); } };
}

module.exports = { startRuntimePressureMonitor, formatLine, summarizeProfile };
