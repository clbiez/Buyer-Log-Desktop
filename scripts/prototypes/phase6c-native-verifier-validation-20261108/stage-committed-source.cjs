'use strict';

// Materialize only the pinned contribution under this prototype. The frozen
// preparation packet and production files are read-only inputs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const pin = '7652f3d294f3a530a28938eff81cbe477c5a0884';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const destination = path.join(__dirname, 'committed-source');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const realLib = path.join(root, 'resources/app/server/lib');
const nativePins = {
  'local-db.js': '0809943a3c4c46a62a80fc5f42d2f85709775c33863b99087ef1ebf4472d8141',
  'shared-file-transaction.js': 'c97b75950ddd726ce58d73a256c0953a98987451d6165bb99112a0e93faa1881',
  'durable-file-recovery.js': 'ae283d148821f117e43c206f54cb1d9f8deb6d071d298b6f45a5ecbf42fd0c62',
};
for (const [name, expected] of Object.entries(nativePins)) assert.equal(sha(fs.readFileSync(path.join(realLib, name))), expected, name + ' source drift');
assert.deepEqual(fs.readFileSync(path.join(realLib, 'local-db.js')), fs.readFileSync(path.join(__dirname, 'preparation/base/local-db.js')));
assert.equal(execFileSync('git', ['rev-parse', pin + '^{commit}'], { encoding: 'utf8' }).trim(), pin);

function put(relative, bytes) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) assert.deepEqual(fs.readFileSync(target), Buffer.from(bytes), 'Refuse to overwrite changed prototype: ' + relative);
  else fs.writeFileSync(target, bytes, { flag: 'wx' });
}
const paths = [
  'resources/app/server/lib/collection-committed-source.js',
  'resources/app/server/lib/collection-delta-commit.js',
  'resources/app/tests/collection-committed-source.test.js',
  'resources/app/tests/collection-delta-commit.test.js',
  'resources/app/tests/collection-delta-native27.test.js',
  'resources/app/tests/fixtures/collection-committed-native.cjs',
  'resources/app/tests/fixtures/collection-native27-binding.cjs',
  'resources/app/tests/fixtures/collection-commit-crash-child.cjs',
  'docs/performance-program/parallel-handoff-20261108/03-collection-server/native/collection-delta-service.test.cjs',
];
const files = [];
for (const relative of paths) {
  const upstream = execFileSync('git', ['show', pin + ':' + relative]);
  let content = upstream;
  let adaptation = null;
  if (relative.endsWith('/fixtures/collection-committed-native.cjs')) {
    const text = upstream.toString('utf8');
    const start = text.indexOf('// TEST ONLY: proposed root durability adapter');
    const end = text.indexOf('\nfunction workspace()', start);
    assert.ok(start > 0 && end > start, 'Reviewed fixture verifier seam');
    content = Buffer.from(text.slice(0, start) +
      '// Validation uses the real candidate API inside the existing native prepare.\n' +
      'const verifyDurability = ({ db, state }) => db.verifyPrivateRecordDurability(state);\n' +
      text.slice(end));
    adaptation = 'Replace Linux fixture verifier with exact candidate API delegation; all tests unchanged.';
  }
  put(relative, content);
  files.push({ path: relative, upstreamSha256: sha(upstream), stagedSha256: sha(content), adaptation });
}
const helper = path.join(__dirname, 'preparation/tests/helpers/native-verifier-subject.cjs');
for (const name of ['local-db.js', 'shared-file-transaction.js', 'shared-sync-policy.js']) {
  const relative = 'resources/app/server/lib/' + name;
  let locator = path.relative(path.dirname(path.join(destination, relative)), helper);
  if (!locator.startsWith('.')) locator = './' + locator;
  const code = name === 'local-db.js'
    ? "'use strict';\nmodule.exports = require(" + JSON.stringify(locator) + ");\n"
    : "'use strict';\nconst path = require('node:path');\nconst { appRoot } = require(" + JSON.stringify(locator) + ");\nmodule.exports = require(path.join(appRoot, 'server/lib', " + JSON.stringify(name) + "));\n";
  put(relative, code);
}
put('PROVENANCE.json', JSON.stringify({ contributionCommit: pin, nativePins, files }, null, 2) + '\n');
console.log('Staged ' + paths.length + ' pinned contribution inputs, three native locator bridges, and provenance. Frozen preparation untouched.');
