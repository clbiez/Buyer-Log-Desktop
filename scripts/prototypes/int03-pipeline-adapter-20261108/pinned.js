'use strict';
// Reuse the delivered helper and #899 fixture verbatim, without production writes.
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const HANDOFF = '5a5b4f5e2b82d3f4584a818221b7d27a1c487d8a';
const PREPARATION = 'b2a4a579c5369f59e5cfb9181140a00176d944ef';
function blob(sha, file) {
  return execFileSync('git', ['show', `${sha}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
function compile(source, filename, overrides = {}) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(overrides, id) ? overrides[id] : original(id);
  mod._compile(source, filename);
  return mod.exports;
}
const helper = compile(blob(HANDOFF, 'resources/app/server/lib/plm-image-byte-budget.js'), path.join(root, 'resources/app/server/lib/plm-image-byte-budget.js'));
const fixture = compile(blob(PREPARATION, 'resources/app/scripts/lib/plm-image-memory-fixture.js'), path.join(root, 'resources/app/scripts/lib/plm-image-memory-fixture.js'));
module.exports = { root, HANDOFF, PREPARATION, blob, compile, helper, fixture };
