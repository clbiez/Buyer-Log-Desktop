'use strict';

const { parentPort, workerData } = require('node:worker_threads');

// user-data resolves every storage root while the module is loaded. Tests and
// portable installations therefore pass the effective roots before require().
for (const [key, value] of Object.entries((workerData && workerData.env) || {})) {
  if (value != null && value !== '') process.env[key] = String(value);
}

const { restoreBackupFromFile } = require('./user-data');

(async () => {
  try {
    const result = await restoreBackupFromFile(String(workerData && workerData.file || ''));
    parentPort.postMessage({ ok:true, result });
  } catch (error) {
    parentPort.postMessage({
      ok:false,
      error:String(error && error.message || error),
      code:String(error && error.code || 'BACKUP_RESTORE_FAILED'),
      statusCode:Number(error && error.statusCode) || 500,
      details:error && error.details || null,
    });
  }
})();
