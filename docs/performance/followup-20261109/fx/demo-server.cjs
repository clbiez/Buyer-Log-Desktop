'use strict';
// Acceptance-only IPC seam: capture the actual route dependencies without adding
// an application endpoint or changing the singleton Excel client's limits.
const path = require('node:path'), Module = require('node:module');
const appRoot = process.env.FX_ACCEPTANCE_APP;
const originalLoad = Module._load;
let fx, pending = [];
Module._load = function(request, parent, ...rest) {
  const loaded = originalLoad.call(this, request, parent, ...rest);
  if (request !== './routes/costing-fx-shipping-routes') return loaded;
  return (app, deps) => { fx = deps; return loaded(app, deps); };
};
require(path.join(appRoot, 'server/server.js'));
Module._load = originalLoad;
const client = require(path.join(appRoot, 'server/excel-worker-client'));
process.on('message', async ({ id, command }) => {
  try {
    let result;
    if (command === 'busy' || command === 'saturate') {
      const workers = client.getExcelWorkerStats().maxWorkers;
      pending = Array.from({ length: workers }, () => client.runExcelTask('diagnosticSpin', { ms: 1000 }));
      for (let i = 0; i < 64; i++) pending.push(client.runExcelTask('health'));
      // Attach rejection handlers immediately, including on a failed assertion.
      pending = pending.map(job => job.catch(error => ({ code: error.code })));
      result = command === 'busy' ? await fx.syncFxFromKurWorkbook('moderator') : { saturated: true };
    } else if (command === 'drain') {
      await Promise.all(pending); pending = []; result = { drained: true };
    } else if (command === 'sync') result = await fx.syncFxFromKurWorkbook('moderator');
    else throw new Error('Unknown acceptance command');
    process.send({ id, result, store: fx.loadFx(), folderSync: fx.getFolderFxSyncStatus(), stats: client.getExcelWorkerStats() });
  } catch (error) { process.send({ id, error: { code: error.code, message: error.message } }); }
});
