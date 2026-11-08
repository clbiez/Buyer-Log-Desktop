'use strict';
// Materialize existing evidence code verbatim under the permitted prototype
// scratch directory. Production server is only read through a directory link.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { root, HANDOFF, PREPARATION, blob } = require('./pinned');
const dir = fs.mkdtempSync(path.join(__dirname, '.scratch/inherited-'));
const app = path.join(dir, 'resources/app');
const manifest = [];
const files = [
  [PREPARATION, 'resources/app/scripts/lib/plm-image-memory-fixture.js'],
  [PREPARATION, 'resources/app/scripts/lib/plm-image-memory-probe.js'],
  [PREPARATION, 'resources/app/scripts/benchmark-plm-image-memory.js'],
  [PREPARATION, 'resources/app/tests/plm-image-memory-preparation.test.js'],
  [HANDOFF, 'resources/app/tests/int03-byte-budget-unit.test.js'],
  [HANDOFF, 'resources/app/tests/int03-byte-budget-pipeline.test.js'],
  [HANDOFF, 'resources/app/tests/fixtures/int03-byte-budget/mock-pipeline.js'],
  [HANDOFF, 'resources/app/tests/fixtures/int03-byte-budget/plm-image-memory-fixture.js'],
  [HANDOFF, 'resources/app/tests/fixtures/int03-byte-budget/measure.js'],
];
for (const [sha, file] of files) {
  const bytes = blob(sha, file), target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { mode: 0o444 });
  manifest.push({ sha, file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
fs.symlinkSync(path.join(root, 'resources/app/server'), path.join(app, 'server'), 'dir');
// The handoff helper is not installed into production or reimplemented. Resolve
// its original import to the exact pinned module already used by the adapter.
const preload = path.join(dir, 'preload.cjs');
fs.writeFileSync(preload, `const Module=require('node:module');const original=Module._load;const helper=require(${JSON.stringify(path.join(__dirname, 'pinned.js'))}).helper;Module._load=function(id,...args){if(id.endsWith('/plm-image-byte-budget'))return helper;return original.call(this,id,...args)};`);
const output = path.join(root, 'docs/performance-program/contrib-int03-pipeline-adapter-20261108');
fs.writeFileSync(path.join(output, 'inherited-source-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
try {
  for (const [name, tests] of [
    ['helper-tests', ['int03-byte-budget-unit.test.js', 'int03-byte-budget-pipeline.test.js']],
    ['preparation-tests', ['plm-image-memory-preparation.test.js']],
  ]) {
    const result = spawnSync(process.execPath, ['--require', preload, '--test', ...tests.map(f => path.join(app, 'tests', f))], { cwd: app, env: process.env, encoding: 'utf8' });
    fs.writeFileSync(path.join(output, name+'.txt'), (result.stdout || '')+(result.stderr || ''));
    console.log(name, result.status);
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
