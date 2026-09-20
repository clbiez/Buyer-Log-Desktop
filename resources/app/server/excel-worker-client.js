'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_FILE = path.join(__dirname, 'workers', 'excel-worker.js');
let queue = Promise.resolve();
let nextId = 1;
const stats = { queued: 0, completed: 0, failed: 0, active: false, lastTask: null, lastDurationMs: null };

function runWorker(task, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const worker = new Worker(WORKER_FILE);
    let settled = false;
    const startedAt = Date.now();
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stats.active = false;
      stats.lastTask = task;
      stats.lastDurationMs = Date.now() - startedAt;
      if (error) { stats.failed += 1; reject(error); }
      else { stats.completed += 1; resolve(result); }
      worker.terminate().catch(() => {});
    };
    const timer = setTimeout(() => {
      const error = new Error(`Excel işlemi zaman aşımına uğradı: ${task}`);
      error.code = 'EXCEL_WORKER_TIMEOUT';
      error.statusCode = 504;
      finish(error);
    }, timeoutMs);
    timer.unref();
    worker.on('message', message => {
      if (!message || message.id !== id) return;
      if (message.ok) finish(null, message.result);
      else {
        const error = new Error(message.error && message.error.message || 'Excel worker işlemi başarısız.');
        error.code = 'EXCEL_WORKER_ERROR';
        error.workerStack = message.error && message.error.stack || '';
        finish(error);
      }
    });
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!settled && code !== 0) finish(new Error(`Excel worker beklenmedik şekilde kapandı (${code}).`)); });
    stats.active = true;
    worker.postMessage({ id, task, payload });
  });
}
function runExcelTask(task, payload = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 240000;
  stats.queued += 1;
  const operation = () => runWorker(task, payload, timeoutMs);
  const pending = queue.then(operation, operation);
  queue = pending.catch(() => {});
  return pending;
}
function getExcelWorkerStats() { return { ...stats }; }

module.exports = { runExcelTask, getExcelWorkerStats };
