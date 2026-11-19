'use strict';

/*
 * ERP okuma modeli benchmark'ı (#1072) — tarayıcı probu ve saf analiz fonksiyonları.
 * Tarayıcı tarafı (installErpProbe) Playwright addInitScript ile serileştirilir:
 * Node modül kapsamına referans içermez. Analiz fonksiyonları DOM'suzdur ve
 * birim test edilebilir.
 */

// ---- Tarayıcı init betiği (serileştirilir) ----
function installErpProbe({ lagIntervalMs = 50, anchorBusyMs = 4, bridge = true } = {}) {
  const probe = window.__erpProbe = { longTasks: [], lag: [], anchor: null, events: {}, lagIntervalMs };
  // CPU profili ↔ performance.now eşlemesi: bu adlandırılmış fonksiyon profilde
  // ayırt edilebilir bir örnek kümesi bırakır; başlangıç zamanı kaydedilir.
  (function __blErpProfileAnchor() {
    const start = performance.now();
    let x = 0;
    while (performance.now() - start < anchorBusyMs) x += Math.sqrt(x + 1);
    probe.anchor = { startMs: start, endMs: performance.now(), x };
  })();
  try { localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'); } catch (_) { /* opsiyonel */ }
  if (bridge && !window.buyerLogDesktop) {
    // Masaüstü köprüsü taklidi: yalnız açılış/warmup yolunun okuduğu yüzey.
    window.buyerLogDesktop = {
      renderProfile: async () => ({ softwareCompositing: false }),
      workspace: { setModule: async () => true },
    };
  }
  for (const name of ['bl:primary-screen-ready', 'bl:startup-ready', 'bl:startup-complete', 'bl:background-warmup-done']) {
    window.addEventListener(name, () => { if (probe.events[name] == null) probe.events[name] = performance.now(); });
  }
  try {
    new PerformanceObserver(list => {
      for (const task of list.getEntries()) probe.longTasks.push({ startTime: task.startTime, duration: task.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { probe.longTaskUnsupported = true; }
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    probe.lag.push([now, Math.max(0, now - last - lagIntervalMs)]);
    last = now;
  }, lagIntervalMs);
}

// ---- Saf yardımcılar ----
function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// Uzun görevleri [startMs, endMs) penceresine kırpar.
function longTaskStats(tasks, startMs, endMs) {
  const clipped = [];
  for (const task of tasks || []) {
    const s = Math.max(task.startTime, startMs), e = Math.min(task.startTime + task.duration, endMs);
    if (e > s) clipped.push(e - s);
  }
  return {
    count: clipped.length,
    totalMs: round(clipped.reduce((a, b) => a + b, 0)),
    maxMs: round(clipped.length ? Math.max(...clipped) : 0),
  };
}

function lagStats(samples, startMs, endMs, thresholdMs = 200) {
  const chosen = (samples || []).filter(([at]) => at >= startMs && at < endMs).map(([, lag]) => lag);
  return {
    samples: chosen.length,
    maxMs: round(chosen.length ? Math.max(...chosen) : 0),
    over200Count: chosen.filter(lag => lag > thresholdMs).length,
  };
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// BLPerf.timeline() atMs alanı BLPerf.origin()'e görelidir → performance.now ekseni.
function timelineToPerf(timeline, origin) {
  return (timeline || []).map(mark => ({ name: mark.name, atMs: mark.atMs, perfMs: round(mark.atMs + (Number(origin) || 0)), detail: mark.detail ?? null }));
}

/*
 * CDP Profiler.stop çıktısını analiz eder.
 *   anchorPerfMs: __blErpProfileAnchor başlangıcının performance.now değeri (son belge).
 *   windows: [{ name, startMs, endMs }] performance.now ekseninde.
 * Örnek i'nin süresi = timestamps[i+1] - timestamps[i] (DevTools ile aynı).
 */
const ANCHOR_NAME = '__blErpProfileAnchor';
const IGNORED_SELF = new Set(['(idle)', '(program)', '(root)']);
function analyzeProfile(profile, { anchorPerfMs, windows = [], topN = 15, appMainPattern = /\/app-main\.js(?:[?#].*)?$/ } = {}) {
  const nodes = new Map(), parent = new Map();
  for (const node of profile.nodes || []) {
    nodes.set(node.id, node);
    for (const child of node.children || []) parent.set(child, node.id);
  }
  const samples = profile.samples || [], deltas = profile.timeDeltas || [];
  const stamps = new Array(samples.length);
  let t = profile.startTime;
  for (let i = 0; i < samples.length; i++) { t += deltas[i] || 0; stamps[i] = t; }
  const frameOf = id => nodes.get(id)?.callFrame || {};
  const label = frame => `${frame.functionName || '(anonymous)'} ${shortUrl(frame.url)}:${(frame.lineNumber ?? -1) + 1}`;
  const stackCache = new Map();
  function stackInfo(id) {
    if (stackCache.has(id)) return stackCache.get(id);
    let anchor = false, outer = null;
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const frame = frameOf(cur);
      if (frame.functionName === ANCHOR_NAME) anchor = true;
      if (appMainPattern.test(frame.url || '')) outer = frame;
    }
    const info = { anchor, outer: outer ? label(outer) : null };
    stackCache.set(id, info);
    return info;
  }
  // Son anchor kümesi = son belge (giriş sayfasının anchor'ı daha öncedir).
  let anchorUs = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (stackInfo(samples[i]).anchor) {
      let j = i;
      while (j > 0 && stackInfo(samples[j - 1]).anchor) j--;
      // İlk anchor örneği, anchor başlangıcından en fazla bir örnekleme aralığı sonradır;
      // önceki örneğin zamanı alt sınırdır. Orta nokta hata payını yarıya indirir.
      const prev = j > 0 ? stamps[j - 1] : stamps[j];
      anchorUs = (prev + stamps[j]) / 2;
      break;
    }
  }
  const aligned = anchorUs != null && Number.isFinite(anchorPerfMs);
  const toPerf = us => (us - anchorUs) / 1000 + anchorPerfMs;
  const result = { aligned, sampleCount: samples.length, intervalUs: samples.length > 1 ? round((stamps.at(-1) - stamps[0]) / (samples.length - 1), 0) : null, windows: [] };
  if (!aligned) return result;
  for (const win of windows) {
    const self = new Map(), outer = new Map();
    let sampledMs = 0, busyMs = 0, gcMs = 0;
    for (let i = 0; i < samples.length - 1; i++) {
      const at = toPerf(stamps[i]);
      if (at < win.startMs || at >= win.endMs) continue;
      const ms = (stamps[i + 1] - stamps[i]) / 1000;
      sampledMs += ms;
      const frame = frameOf(samples[i]), name = frame.functionName || '(anonymous)';
      if (IGNORED_SELF.has(name)) continue;
      busyMs += ms;
      if (name === '(garbage collector)') gcMs += ms;
      // (garbage collector) gibi sanal çerçeveler URL'siz; anonim JS fonksiyonları konumuyla ayrılır.
      const key = name.startsWith('(') && !frame.url ? name : label(frame);
      self.set(key, (self.get(key) || 0) + ms);
      const info = stackInfo(samples[i]);
      const outerKey = info.outer || (name === '(garbage collector)' ? '(garbage collector)' : '(app-main.js dışı)');
      outer.set(outerKey, (outer.get(outerKey) || 0) + ms);
    }
    const top = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([fn, ms]) => ({ fn, ms: round(ms) }));
    result.windows.push({ name: win.name, startMs: round(win.startMs), endMs: round(win.endMs), sampledMs: round(sampledMs), busyMs: round(busyMs), gcMs: round(gcMs), topSelf: top(self), topAppMainOuter: top(outer) });
  }
  return result;
}

function shortUrl(url) {
  if (!url) return '';
  try { const u = new URL(url); return u.pathname.split('/').pop() || u.pathname; } catch (_) { return String(url).split('/').pop(); }
}

function isTrackedPayload(pathname) { return pathname.startsWith('/api/page-projection/') || pathname === '/api/data' || pathname.startsWith('/api/data/') || pathname.startsWith('/api/data?'); }

function summarizePayloads(entries) {
  const byPath = new Map();
  for (const entry of entries) {
    const key = entry.path;
    const cur = byPath.get(key) || { path: key, count: 0, decodedBytes: 0, encodedBytes: 0, phases: new Set() };
    cur.count++; cur.decodedBytes += entry.decodedBytes || 0; cur.encodedBytes += entry.encodedBytes || 0; cur.phases.add(entry.phase);
    byPath.set(key, cur);
  }
  return [...byPath.values()].map(item => ({ ...item, phases: [...item.phases] })).sort((a, b) => b.decodedBytes - a.decodedBytes);
}

module.exports = { installErpProbe, median, longTaskStats, lagStats, timelineToPerf, analyzeProfile, summarizePayloads, isTrackedPayload, round, ANCHOR_NAME };
