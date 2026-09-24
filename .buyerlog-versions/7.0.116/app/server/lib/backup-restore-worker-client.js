'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, '..', 'backup-restore-worker.js');
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
let restoreTail = Promise.resolve();

function runOne(file, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, { workerData:{ file:String(file || ''), env:env || {} } });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('Yedek geri yükleme iş parçacığı zaman aşımına uğradı.');
      error.code = 'BACKUP_RESTORE_TIMEOUT'; error.statusCode = 504;
      finish(error);
    }, timeoutMs);
    worker.once('message', message => {
      if (message && message.ok) { finish(null, message.result); return; }
      const error = new Error(message && message.error || 'Yedek geri yükleme iş parçacığı başarısız oldu.');
      error.code = message && message.code || 'BACKUP_RESTORE_FAILED';
      error.statusCode = Number(message && message.statusCode) || 500;
      error.details = message && message.details || null;
      finish(error);
    });
    worker.once('error', finish);
    worker.once('exit', code => {
      if (!settled && code !== 0) {
        const error = new Error(`Yedek geri yükleme iş parçacığı ${code} koduyla durdu.`);
        error.code = 'BACKUP_RESTORE_WORKER_EXIT'; error.statusCode = 500;
        finish(error);
      }
    });
  });
}

// Restore is a whole-data transaction. Even though the work is off the main
// event loop, two restore commits must never overlap each other.
function runBackupRestore(file, { env = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const task = restoreTail.catch(() => {}).then(() => runOne(file, env, timeoutMs));
  restoreTail = task.catch(() => {});
  return task;
}

module.exports = { runBackupRestore, WORKER_FILE };
