'use strict';
const {registerLeaseWorker}=require('./lib/lease-worker-registry');

const path = require('path');
const fs = require('fs');
const os = require('os');
const { performance } = require('perf_hooks');
const { Worker } = require('worker_threads');

const WORKER_FILE = path.join(__dirname, 'workers', 'excel-worker.js');
const MiB = 1024 * 1024;

// Estimates are admission hints, not promises about SheetJS's heap. Large jobs
// run alone; idle workers are never retained with a previous user's workbook.
function estimateTaskBytes(payload) {
  let bytes = 64 * MiB;
  for (const key of ['fullPath', 'asasPath', 'antrepoPath', 'cpupdatePath', 'templatePath']) {
    if (!payload[key]) continue;
    try { bytes += fs.statSync(payload[key]).size * 12; } catch (_) {}
  }
  if (payload.data && Number.isFinite(payload.data.byteLength)) bytes += payload.data.byteLength * 12;
  if (Array.isArray(payload.detailRows)) bytes += payload.detailRows.length * 4096;
  return bytes;
}
function retainedPayloadBytes(payload) {
  return (payload.data && Number(payload.data.byteLength) || 0)
    + (Array.isArray(payload.detailRows) ? payload.detailRows.length * 4096 : 0);
}
function cancelledError() {
  return Object.assign(new Error('Excel işlemi iptal edildi. / Excel operation cancelled.'), { code: 'REFRESH_CANCELLED' });
}

function createExcelWorkerClient(options = {}) {
  const WorkerClass = options.WorkerClass || Worker;
  const maxWorkers = options.maxWorkers || Math.max(1, Math.min(2, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length));
  const memoryBudgetBytes = options.memoryBudgetBytes || Math.min(256 * MiB, Math.max(64 * MiB, os.totalmem() / 8));
  const maxPending = options.maxPending || 64;
  const maxRetainedBytes = options.maxRetainedBytes || 64 * MiB;
  const pending = [], activeKeys = new Set();
  let nextId = 1, activeWorkers = 0, activeBytes = 0, retainedBytes = 0;
  const stats = {
    queued: 0, completed: 0, failed: 0, rejected: 0, active: false,
    lastTask: null, lastDurationMs: null, lastQueueWaitMs: null,
    lastExecutionMs: null, lastOverheadMs: null, maxQueueWaitMs: 0,
    totalQueueWaitMs: 0, totalExecutionMs: 0, peakActiveWorkers: 0,
    peakWorkerHeapMiB: 0,
  };

  function pump() {
    while (activeWorkers < maxWorkers) {
      const index = pending.findIndex(job => !activeKeys.has(job.key) &&
        (activeWorkers === 0 || activeBytes + job.bytes <= memoryBudgetBytes));
      if (index < 0) break;
      const job = pending.splice(index, 1)[0];
      retainedBytes -= job.retainedBytes;
      if (job.signal) job.signal.removeEventListener('abort', job.onQueuedAbort);
      activeWorkers++; activeBytes += job.bytes;
      if (job.key) activeKeys.add(job.key);
      stats.active = true;
      stats.peakActiveWorkers = Math.max(stats.peakActiveWorkers, activeWorkers);
      start(job);
    }
  }

  function start(job) {
    const startedAt = performance.now(), queueWaitMs = startedAt - job.queuedAt;
    let worker, timer, settled = false;
    const onAbort = () => finish(cancelledError());
    const finish = (error, result, metrics = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (job.signal) job.signal.removeEventListener('abort', onAbort);
      const durationMs = performance.now() - startedAt;
      stats.lastTask = job.task; stats.lastDurationMs = durationMs;
      stats.lastQueueWaitMs = queueWaitMs;
      stats.lastExecutionMs = Number.isFinite(metrics.executionMs) ? metrics.executionMs : null;
      stats.lastOverheadMs = Number.isFinite(metrics.executionMs) ? Math.max(0, durationMs - metrics.executionMs) : null;
      stats.totalQueueWaitMs += queueWaitMs;
      stats.maxQueueWaitMs = Math.max(stats.maxQueueWaitMs, queueWaitMs);
      stats.totalExecutionMs += stats.lastExecutionMs || 0;
      stats.peakWorkerHeapMiB = Math.max(stats.peakWorkerHeapMiB, Number(metrics.heapUsedBytes) / MiB || 0);
      if (typeof job.onMetrics === 'function') {
        try { job.onMetrics({ queueWaitMs, durationMs, executionMs: stats.lastExecutionMs, overheadMs: stats.lastOverheadMs, heapUsedBytes: Number(metrics.heapUsedBytes) || 0 }); } catch (_) {}
      }
      if (error) { stats.failed++; job.reject(error); } else { stats.completed++; }
      job.payload = null;
      // Keep the slot charged until termination, including timeout/cancellation.
      // Otherwise cancelled workers overlap replacements and defeat the bound.
      Promise.resolve(worker && worker.terminate()).catch(() => {}).then(() => {
        activeWorkers--; activeBytes -= job.bytes;
        if (job.key) activeKeys.delete(job.key);
        stats.active = activeWorkers > 0;
        // Successful completion also means its worker resources are released.
        if (!error) job.resolve(result);
        pump();
      });
    };
    try {
      worker = new WorkerClass(WORKER_FILE,{resourceLimits:{maxOldGenerationSizeMb:512}});
      registerLeaseWorker(worker);
      timer = setTimeout(() => finish(Object.assign(new Error(`Excel işlemi zaman aşımına uğradı: ${job.task} / Excel operation timed out.`), {
        code: 'EXCEL_WORKER_TIMEOUT', statusCode: 504,
      })), job.timeoutMs);
      timer.unref();
      worker.on('message', message => {
        if (!message || message.id !== job.id) return;
        if (message.ok) finish(null, message.result, message.metrics);
        else finish(Object.assign(new Error(message.error && message.error.message || 'Excel worker işlemi başarısız. / Excel worker failed.'), {
          code: 'EXCEL_WORKER_ERROR', workerStack: message.error && message.error.stack || '',
        }), undefined, message.metrics);
      });
      worker.on('error', error => finish(error));
      worker.on('exit', code => { if (!settled) finish(new Error(`Excel worker beklenmedik şekilde kapandı (${code}). / Excel worker exited unexpectedly.`)); });
      if (job.signal) {
        job.signal.addEventListener('abort', onAbort, { once: true });
        if (job.signal.aborted) { onAbort(); return; }
      }
      worker.postMessage({ id: job.id, task: job.task, payload: job.payload });
    } catch (error) { finish(error); }
  }

  function runExcelTask(task, payload = {}, taskOptions = {}) {
    if (taskOptions.signal && taskOptions.signal.aborted) return Promise.reject(cancelledError());
    const retained = retainedPayloadBytes(payload);
    // One large payload may run alone, but cannot accumulate behind active work.
    if (pending.length >= maxPending || (activeWorkers > 0 && retainedBytes + retained > maxRetainedBytes)) {
      stats.rejected++;
      return Promise.reject(Object.assign(new Error('Excel kuyruğu dolu; tekrar deneyin. / Excel queue is full; retry later.'), { code: 'EXCEL_WORKER_BUSY', statusCode: 503 }));
    }
    stats.queued++;
    return new Promise((resolve, reject) => {
      const job = {
        id: nextId++, task, payload, resolve, reject,
        queuedAt: performance.now(), bytes: estimateTaskBytes(payload), retainedBytes: retained,
        key: taskOptions.serializationKey || '', signal: taskOptions.signal, onMetrics: taskOptions.onMetrics,
        timeoutMs: Number(taskOptions.timeoutMs) > 0 ? Number(taskOptions.timeoutMs) : 240000,
      };
      job.onQueuedAbort = () => {
        const index = pending.indexOf(job);
        if (index < 0) return;
        pending.splice(index, 1); retainedBytes -= job.retainedBytes; job.payload = null;
        job.signal.removeEventListener('abort', job.onQueuedAbort);
        stats.failed++; reject(cancelledError()); pump();
      };
      pending.push(job); retainedBytes += retained;
      if (job.signal) job.signal.addEventListener('abort', job.onQueuedAbort, { once: true });
      pump();
    });
  }
  function getExcelWorkerStats() {
    // Never expose job payloads, paths, user IDs, serialization keys or results.
    return { ...stats, pending: pending.length, activeWorkers, maxWorkers,
      memoryBudgetMiB: memoryBudgetBytes / MiB, estimatedActiveMiB: activeBytes / MiB,
      retainedPayloadMiB: retainedBytes / MiB };
  }
  return { runExcelTask, getExcelWorkerStats };
}

module.exports = { ...createExcelWorkerClient(), createExcelWorkerClient };
