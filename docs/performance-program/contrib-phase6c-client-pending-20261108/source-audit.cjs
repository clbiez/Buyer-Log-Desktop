'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const oldCommit = 'd66c1f803097af5991616f0420392e1027888f2e', baseCommit = 'ea49389836dba23f0970a974b4c0185f1b36ec0e';
const file = 'resources/app/public/app-main.js';
const read = ref => execFileSync('git', ['show', ref + ':' + file], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const oldSource = read(oldCommit), source = fs.readFileSync(path.join(repo, file), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const gitBlob = text => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const helper = fs.readFileSync(path.join(repo, 'resources/app/tests/fixtures/collection-client-delta/actual-editor.cjs'), 'utf8');
const literal = helper.slice(helper.indexOf('const boundaries = ') + 'const boundaries = '.length, helper.indexOf('\n];') + 2);
const boundaries = vm.runInNewContext(literal);
function extract(text, name, end) { const start = text.indexOf('function ' + name + '('); const stop = text.indexOf(end, start + 10); if (start < 0 || stop < 0) throw new Error(name); return text.slice(start, stop); }
const actualEditorFunctions = boundaries.map(([name, end]) => { const old = extract(oldSource, name, end), now = extract(source, name, end); return { name, unchanged: old === now, oldSha256: sha(old), currentSha256: sha(now) }; });
const named = ['kolPersistPendingWorkspace','kolReadPendingWorkspace','kolMergePendingWorkspace','kolRestorePendingWorkspace','saveKolRows'];
const pendingFunctions = named.map(name => { const start = source.indexOf('function ' + name + '('); const end = source.indexOf('\n}', start) + 2;
  const text = name === 'kolReadPendingWorkspace' ? source.slice(start, source.indexOf('\n', start)) : source.slice(start, end);
  return { name, line: source.slice(0, start).split('\n').length, sha256: sha(text) }; });
const pins = require(path.join(repo, 'resources/app/tests/fixtures/collection-client-delta/actual-source-pins.json'));
const pinnedFiles = Object.entries(pins.blobs).map(([name, expected]) => { const actual = gitBlob(fs.readFileSync(path.join(repo, 'resources/app/public', name), 'utf8')); return { name, expected, actual, unchanged: actual === expected }; });
const report = { baseCommit, inheritedFixtureBase: oldCommit, appMainAtBaseMatches: source === read(baseCommit), actualEditorFunctions, pinnedFiles, pendingFunctions,
  inheritedPinPolicy: 'Unchanged. Whole-file app-main pin blocks original actual-editor fixture; root must review/update it within root scope.' };
if (process.argv.includes('--check')) {
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'source-comparison.json'), 'utf8'));
  // Boundary arrays originate in a VM realm; compare owned JSON data, not
  // cross-realm Array prototypes. Source/hash assertions remain unchanged.
  require('node:assert/strict').deepEqual(JSON.parse(JSON.stringify(report)), expected);
  process.stdout.write(JSON.stringify({ sourceReportMatches: true, unchangedActualEditorFunctions: actualEditorFunctions.filter(item => item.unchanged).length,
    inheritedWholeFilePinBlocker: pinnedFiles.some(item => !item.unchanged) }) + '\n');
} else fs.writeFileSync(path.join(__dirname, 'source-comparison.json'), JSON.stringify(report, null, 2) + '\n');
module.exports = { source, extract, report };
