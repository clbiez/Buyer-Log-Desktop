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
function summarizeHealth(samples, phase, endpoint) {
  const chosen = samples.filter(sample => (!phase || sample.phase === phase) && (!endpoint || sample.endpoint === endpoint));
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
function compactRefreshStatus(status) {
  function compact(value) {
    if (Array.isArray(value)) return { count:value.length };
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,compact(item)]));
    return value;
  }
  return { ...status, summary:compact(status.summary) };
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
function installProbe({ sampleWindowMs, logEvents = false }) {
  const probe = window.__startupProbe = { primaryScreenReadyMs:null, startupReadyMs:null, startupCompleteMs:null,
    continueAtMs:null,continueIntentAtMs:null,continueDispatchDelayMs:null,userWaitMs:null, systemStartupCompleteMs:null, sampleWindowMs, longTasks:[] };
  for (const [event,key] of [['bl:primary-screen-ready','primaryScreenReadyMs'],['bl:startup-ready','startupReadyMs'],['bl:startup-complete','startupCompleteMs']]) {
    window.addEventListener(event, () => {
      probe[key] = performance.now();
      if (logEvents) console.log('BENCHMARK_LIFECYCLE '+JSON.stringify({event,key,ms:probe[key]}));
      if (event === 'bl:startup-complete') {
        const intent=probe.continueIntentAtMs ?? probe.continueAtMs ?? probe.startupReadyMs;
        probe.userWaitMs = Math.max(0, intent - probe.startupReadyMs);
        probe.continueDispatchDelayMs=Math.max(0,(probe.continueAtMs ?? intent)-intent);
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
async function readRendererMetrics(context,page,timeoutMs=10000) {
  const cdp=await context.newCDPSession(page);
  async function bounded(promise,label){
    let timer;
    try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),timeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  try{
    // Forced HeapProfiler.collectGarbage can stop a busy renderer and alter the workload.
    await bounded(cdp.send('Performance.enable'),'Performance.enable');
    const {metrics}=await bounded(cdp.send('Performance.getMetrics'),'Performance.getMetrics');
    const dom=await bounded(cdp.send('Memory.getDOMCounters'),'Memory.getDOMCounters');
    return {jsHeapUsedBytes:metrics.find(metric=>metric.name==='JSHeapUsedSize')?.value,dom,heapSampling:'uncollected'};
  }finally{await bounded(cdp.detach(),'CDP detach');}
}
function initializeBenchmarkState(root,now=Date.now()) {
  const fs=require('node:fs'),path=require('node:path');
  const file=path.join(root,'local','data-cleanup-state.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({schemaVersion:1,lastCheckAt:new Date(now).toISOString()})+'\n',{flag:'wx'});
  return {maintenanceState:'recent-weekly-check',stateFile:file};
}
module.exports = { requestJson, summarizeHealth, parseStalls, validateMeasurement, installProbe, measureModules, compactRefreshStatus, readRendererMetrics, initializeBenchmarkState };
