'use strict';
// Minimal synthetic updater cores include the actual mandatory trial protocol;
// release lifecycle tests must not bypass the launcher compatibility gate.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function installTrialCore(app) {
  for (const folder of ['server/lib', 'electron/update']) fs.mkdirSync(path.join(app, folder), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../../server/lib/update-trial-backend.js'), path.join(app, 'server/lib/update-trial-backend.js'));
  fs.copyFileSync(path.join(__dirname, '../../electron/update/trial-backend.js'), path.join(app, 'electron/update/trial-backend.js'));
  fs.copyFileSync(path.join(__dirname, '../../electron/update/json-store.js'), path.join(app, 'electron/update/json-store.js'));
  fs.writeFileSync(path.join(app, 'server/server.js'), "require('./lib/update-trial-backend').waitForTrialBackend();\nmodule.exports=true;\n");
};
