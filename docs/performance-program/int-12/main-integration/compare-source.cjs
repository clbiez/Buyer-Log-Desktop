'use strict';
// Read-only source proof. Does not import the harness or run a measurement.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../../..');
const before = '2e1506490d997247aaf37def69a739d9048b2f03';
const main = '63159fb32ff3d5bdc5f142b4a8f16ca6a3983240';
const merged = '24131b856d14b3a196058602c7f15f13dca28d39';
const git = args => execFileSync('git', args, { cwd: repo });
const old = file => git(['show', before + ':' + file]);
const current = file => fs.readFileSync(path.join(repo, file));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const closure = read => {
  const pending = ['resources/app/tests/helpers/oab-int12-harness.cjs'], files = {};
  while (pending.length) {
    const file = pending.pop(); if (files[file]) continue;
    const bytes = read(file); files[file] = sha(bytes);
    if (file.endsWith('.json')) continue;
    for (const match of bytes.toString().matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (!match[1].startsWith('.')) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      const resolved = [base, base + '.js', base + '.cjs', base + '.json', base + '/index.js'].find(candidate =>
        spawnSync('git', ['cat-file', '-e', merged + ':' + candidate], { cwd: repo, stdio: 'ignore' }).status === 0);
      assert.ok(resolved, 'Unresolved local dependency: ' + file + ' -> ' + match[1]);
      pending.push(resolved);
    }
  }
  return files;
};
const auth = read => {
  const bytes = read('resources/app/server/server.js'), source = bytes.toString();
  const start = 'function assertOabCurrentAccess(', end = 'async function oabDesktopSessionReady()';
  assert.equal(source.split(start).length - 1, 1);
  assert.equal(source.split(end).length - 1, 1);
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(last > first);
  return { serverSha256: sha(bytes), helperSha256: sha(source.slice(first, last)), start, end,
    startLine: source.slice(0, first).split('\n').length, endLine: source.slice(0, last).split('\n').length };
};
git(['merge-base', '--is-ancestor', '76ddbaf4a2a85132d2ad9dff8d1465377e1f81aa', main]);
git(['merge-base', '--is-ancestor', '5a1656e98deeb573f6245f4b24a8135cc77a0d7b', main]);
assert.equal(git(['show', '-s', '--format=%P', merged]).toString().trim(), before + ' ' + main);
assert.equal(git(['diff', '--name-only', main, '--', 'resources/app/server', 'resources/app/public', 'CLAUDE.md', 'AGENTS.md']).toString(), '');
const beforeFiles = closure(old), afterFiles = closure(current);
const changed = [...new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])].filter(file => beforeFiles[file] !== afterFiles[file]);
const beforeAuth = auth(old), afterAuth = auth(current);
const servicePath = 'resources/app/server/lib/oab-batch-service.js';
const service = current(servicePath).toString();
const fixture = JSON.parse(current('resources/app/tests/fixtures/oab-int12.json'));
const anchors = ['for (const item of job.queue) {',
  'const result = await oabFetchOneCombination(userId, currentUser, item, job.forceRefresh, job.transport, job);'];
const anchorCounts = Object.fromEntries(anchors.map(anchor => [anchor, service.split(anchor).length - 1]));
const previousIdentity = JSON.parse(current('docs/performance-program/int-12/followup-evidence/ab-3pairs/preflight.json')).identity;
const preserved = git(['ls-tree', '-r', '--name-only', before, '--',
  'docs/performance-program/int-12/evidence', 'docs/performance-program/int-12/followup-evidence']).toString().trim().split('\n');
const evidenceChanged = preserved.filter(file => !old(file).equals(current(file)));
const excluded = ['resources/app/server/lib/oab-static-metadata.js', 'resources/app/server/lib/user-access.js'].map(file => ({ file,
  beforeSha256: sha(old(file)), afterSha256: sha(current(file)),
  reason: 'The unchanged harness injects fake metadata/access dependencies; this production module is not loaded by the measured path.' }));
const result = { before, main, merged, mainIncludes885And892: true, normalMergeParentsVerified: true,
  ownProductionDelta: [], beforeFiles, afterFiles, changed, beforeAuth, afterAuth, anchorCounts, excluded,
  preservedHistoricalFiles: preserved.length, evidenceChanged,
  servicePinUnchanged: afterFiles[servicePath] === fixture.sourceSha256,
  measuredIdentityMatches: { service: previousIdentity.serviceSha256 === afterFiles[servicePath],
    auth: previousIdentity.authHelperSha256 === afterAuth.helperSha256,
    harness: previousIdentity.harnessSha256 === afterFiles['resources/app/tests/helpers/oab-int12-harness.cjs'],
    fixture: previousIdentity.fixtureSha256 === afterFiles['resources/app/tests/fixtures/oab-int12.json'] },
  nativeContractByteIdentical: old(servicePath).equals(current(servicePath)), measurementRun: false,
  measurementPathChanged: changed.length > 0 || beforeAuth.helperSha256 !== afterAuth.helperSha256,
  node: process.version };
fs.writeFileSync(process.argv[2] || path.join(__dirname, 'source-comparison.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
assert.deepEqual(changed, []); assert.deepEqual(evidenceChanged, []);
assert.equal(result.servicePinUnchanged, true); assert.equal(result.nativeContractByteIdentical, true);
assert.ok(Object.values(result.measuredIdentityMatches).every(Boolean));
assert.ok(Object.values(anchorCounts).every(count => count === 1));
assert.equal(result.measurementPathChanged, false);
console.log('PASS: 11 local files and native auth slice unchanged; no A/B rerun required. Historical files: ' + preserved.length);
