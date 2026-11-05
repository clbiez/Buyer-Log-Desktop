'use strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function requestJson(url, options = {}, { fetchImpl = fetch, delayImpl = delay, onAttempt = () => {} } = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const retryable = method === 'GET' && ['/api/health', '/api/status', '/api/refresh-status'].includes(new URL(url).pathname);
  const limit = retryable ? 3 : 1;
  for (let attempt = 1; attempt <= limit; attempt++) {
    const started = performance.now();
    let status = null, transient = true;
    try {
      const response = await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(60000) });
      status = response.status;
      transient = [408, 429, 502, 503, 504].includes(status);
      const payload = await response.json();
      if (!response.ok) throw new Error(`${new URL(url).pathname}: ${status} ${JSON.stringify(payload)}`);
      onAttempt({ ms: performance.now() - started, status, attempt });
      return payload;
    } catch (error) {
      onAttempt({ ms: performance.now() - started, status, attempt, error: error.message });
      if (!retryable || !transient || attempt === limit) throw error;
      await delayImpl(100 * attempt);
    }
  }
}
function summarizeHealth(samples, phase) {
  const chosen = samples.filter(sample => !phase || sample.phase === phase);
  const values = chosen.map(sample => sample.ms).sort((a,b) => a-b);
  const quantile = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  const failed = chosen.filter(sample => sample.error || sample.status !== 200).length;
  return { count: values.length, successful: values.length - failed, failed, p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: quantile(1) };
}
function parseStalls(log) {
  return log.split(/\r?\n/).filter(line => line.includes('[RUNTIME] event-loop-stall ')).map(line => ({
    line, ...Object.fromEntries([...line.matchAll(/(\w+)=(-?[\d.]+)/g)].map(([,key,value]) => [key,Number(value)])),
  }));
}
function validateMeasurement(expected, actual) {
  for (const [label, wanted, got] of [
    ['rows',expected.rows[actual.module],actual.rows], ['generation',expected.generation,actual.generation],
    ['source revision',expected.sourceRevision,actual.sourceRevision],
    ...Object.entries(expected.revisions).map(([key,value]) => ['revision '+key,value,actual.revisions?.[key]]),
  ]) if (wanted == null || wanted !== got) throw new Error(`${actual.module} ${label} mismatch: expected ${wanted}, received ${got}`);
  if (!actual.projectionGenerations?.length) throw new Error(actual.module+' projection generation missing');
  if (actual.projectionGenerations.some(generation => generation !== expected.generation)) throw new Error(actual.module+' response generation mismatch');
}
// Serializable Playwright init script: no references to the Node module scope.
function installProbe({ sampleWindowMs }) {
  const probe = window.__startupProbe = { primaryScreenReadyMs:null, startupReadyMs:null, startupCompleteMs:null,
    continueAtMs:null, userWaitMs:null, systemStartupCompleteMs:null, sampleWindowMs, longTasks:[] };
  for (const [event,key] of [['bl:primary-screen-ready','primaryScreenReadyMs'],['bl:startup-ready','startupReadyMs'],['bl:startup-complete','startupCompleteMs']]) {
    window.addEventListener(event, () => {
      probe[key] = performance.now();
      if (event === 'bl:startup-complete') {
        probe.userWaitMs = Math.max(0, (probe.continueAtMs ?? probe.startupReadyMs) - probe.startupReadyMs);
        probe.systemStartupCompleteMs = probe.startupCompleteMs - probe.userWaitMs;
      }
    }, { once:true });
  }
  new PerformanceObserver(list => {
    for (const task of list.getEntries()) if (task.startTime < sampleWindowMs) probe.longTasks.push({
      startTime:task.startTime, duration:Math.min(task.duration, sampleWindowMs - task.startTime),
    });
  }).observe({ type:'longtask', buffered:true });
}
async function measureModules(context, modules, measure) {
  const measurements = [];
  for (const module of modules) {
    const page = await context.newPage();
    try { measurements.push(await measure(page,module)); }
    finally { await page.close(); }
  }
  return measurements;
}
module.exports = { requestJson, summarizeHealth, parseStalls, validateMeasurement, installProbe, measureModules };
