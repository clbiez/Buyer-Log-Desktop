'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const MERGE_892 = '5a1656e98deeb573f6245f4b24a8135cc77a0d7b';
const PROTECTED_FILES = ['public/app-main.js', 'public/checklist-supplier-sync.js',
  'public/cp-checklist-engine.js', 'public/cp-overview-assistant.js'];
const fileSha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function captureSource(appRoot) {
  const git = args => execFileSync('git', args, { cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let revision = null, contains892 = false;
  try { revision = git(['rev-parse', 'HEAD']); git(['merge-base', '--is-ancestor', MERGE_892, 'HEAD']); contains892 = true; }
  catch (_) { /* standalone targets remain usable for diagnostics, never paired acceptance */ }
  return { appRoot, revision, contains892,
    moduleSha256: fileSha(path.join(appRoot, 'server/lib/power-bi-import-dashboard.js')),
    integrationSha256: fileSha(path.join(appRoot, 'server/server.js')),
    canonicalFiles: Object.fromEntries(['server/lib/canonical-fields.js', 'public/canonical-fields.js']
      .map(file => [file, fileSha(path.join(appRoot, file))])),
    protectedFiles: Object.fromEntries(PROTECTED_FILES.map(file => [file, fileSha(path.join(appRoot, file))])) };
}

function assertSourceUnchanged(appRoot, source) {
  assert.deepEqual(captureSource(appRoot), source, 'Target source changed during measurement');
}

// Shared by standalone and cohort CLI invocations on this host. A stale lock is
// evidence: inspect its owner before removing it; never auto-break a live lock.
function acquireMeasurementLock() {
  const file = path.join(os.tmpdir(), 'buyer-log-int06-measurement.lock');
  const descriptor = fs.openSync(file, 'wx');
  try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch (error) { fs.closeSync(descriptor); fs.unlinkSync(file); throw error; }
  let released = false;
  return () => {
    if (released) return;
    fs.closeSync(descriptor); fs.unlinkSync(file); released = true;
  };
}

module.exports = { MERGE_892, PROTECTED_FILES, fileSha, captureSource, assertSourceUnchanged, acquireMeasurementLock };
