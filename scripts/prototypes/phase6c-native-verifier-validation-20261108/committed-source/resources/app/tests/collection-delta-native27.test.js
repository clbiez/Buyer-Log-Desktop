'use strict';

// Özgün native27 assertion'ları aynen çalışır; yalnız gerçek dosya locator'ları
// ve test adoption fixture'ının key-order alanı yeni modüle bağlanır.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const file = path.resolve(__dirname, '../../../docs/performance-program/parallel-handoff-20261108/03-collection-server/native/collection-delta-service.test.cjs');
let code = fs.readFileSync(file, 'utf8');
function replaceOnce(before, after) {
  assert.equal(code.split(before).length - 1, 1, 'Reviewed native27 locator/fixture seam must be unique');
  code = code.replace(before, after);
}
replaceOnce("require('./reference/local-db.js')", "require(" + JSON.stringify(path.resolve(__dirname, '../server/lib/local-db.js')) + ")");
replaceOnce("require('./reference/shared-sync-policy.js')", "require(" + JSON.stringify(path.resolve(__dirname, '../server/lib/shared-sync-policy.js')) + ")");
replaceOnce("require('./collection-delta-service.cjs')", "require(" + JSON.stringify(path.resolve(__dirname, 'fixtures/collection-native27-binding.cjs')) + ")");
replaceOnce('ownerId, metadata, rowIds:', 'ownerId, metadata, workspaceKeys: Object.keys(initial), rowIds:');
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(code, file);
