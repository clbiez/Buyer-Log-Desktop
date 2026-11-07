'use strict';

// Preparation only: run the current production pipeline; never install a candidate.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync, execFileSync } = require('node:child_process');
const { hash } = require('./lib/plm-image-memory-fixture');
const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '../..');
const REQUIRED_MAIN = '5a1656e98deeb573f6245f4b24a8135cc77a0d7b'; // Main including #892
const probe = path.join(__dirname, 'lib/plm-image-memory-probe.js');
const metrics = ['osPeakRssBytes', 'sampledPeakRssBytes', 'sampledPeakExternalBytes', 'sampledPeakArrayBufferBytes', 'firstCanonicalLinkMs', 'totalMs', 'peakCommitInputBytes'];
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
function summarize(runs) {
  if (runs.length < 3 || runs.some(r => !r.oracleMatches || r.status !== 'completed')) throw new Error('At least three successful, equivalent runs are required');
  for (const r of runs) for (const m of metrics) if (!Number.isFinite(r[m]) || r[m] < 0) throw new Error(`Invalid metric: ${m}`);
  if (new Set(runs.map(r => r.fixtureSha256)).size !== 1) throw new Error('Fixture mismatch within cohort');
  return Object.fromEntries(metrics.map(m => [m, median(runs.map(r => r[m]))]));
}
function compareCohorts(before, after) {
  if (before.arm !== 'before' || after.arm !== 'after') throw new Error('Both before and after cohorts are required');
  for (const c of [before, after]) if (c.includes892 !== true) throw new Error('Both arms must contain Main #892');
  for (const key of ['environment', 'protectedSources', 'harnessSources']) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`Comparison mismatch: ${key}`);
  }
  if (before.runs[0]?.fixtureSha256 !== after.runs[0]?.fixtureSha256) throw new Error('Comparison fixture mismatch');
  if (JSON.stringify(before.targetSources) === JSON.stringify(after.targetSources)) throw new Error('No production after-change source; acceptance remains pending');
  return { before: summarize(before.runs), after: summarize(after.runs), acceptance: 'measurement-only; behavioral and Phase 6 full-suite gates remain required' };
}
function shaFiles(files) { return Object.fromEntries(files.map(p => [p, hash(fs.readFileSync(path.join(APP, p)))])); }
function readOptional(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return 'unavailable'; } }
function archiveTraces(stem) {
  const directory = path.dirname(stem);
  const prefix = path.basename(stem) + '.trace.';
  const names = fs.readdirSync(directory).filter(p => p.startsWith(prefix) && p.endsWith('.json')).sort();
  if (!names.length) throw new Error('Node trace output is missing');
  const archived = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const raw = fs.readFileSync(file);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.traceEvents) || !parsed.traceEvents.length) throw new Error('Empty Node trace');
    const zipped = zlib.gzipSync(raw);
    if (!zlib.gunzipSync(zipped).equals(raw)) throw new Error('Trace compression verification failed');
    fs.writeFileSync(`${file}.gz`, zipped);
    fs.unlinkSync(file);
    archived.push({ file: name + '.gz', rawSha256: hash(raw), gzipSha256: hash(zipped), events: parsed.traceEvents.length });
  }
  return archived;
}
function metadata(arm) {
  const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  const includes892 = spawnSync('git', ['merge-base', '--is-ancestor', REQUIRED_MAIN, 'HEAD'], { cwd: REPO }).status === 0;
  if (!includes892) throw new Error('Current source does not include Main #892');
  const css = fs.readdirSync(path.join(APP, 'public')).filter(p => p.endsWith('.css')).sort().map(p => `public/${p}`);
  const trackedDiff = git(['diff', '--name-only', 'HEAD', '--', 'resources/app/server', 'resources/app/public']);
  if (trackedDiff) throw new Error('Commit runtime changes before measuring: provenance must identify exact source');
  return {
    arm, includes892, requiredMain: REQUIRED_MAIN, sourceCommit: git(['rev-parse', 'HEAD']),
    environment: { node: process.version, platform: process.platform, arch: process.arch,
      kernel: os.release(), cpu: os.cpus()[0].model, cpuQuota: readOptional('/sys/fs/cgroup/cpu.max'),
      memoryMax: readOptional('/sys/fs/cgroup/memory.max'), machineSha256: hash(os.hostname()),
      traceCategories: 'v8,node,node.async_hooks', forceGc: false, mockDelayMs: 1 },
    targetSources: shaFiles(['server/lib/plm-image-download-queue.js', 'server/lib/plm-image-sync-service.js']),
    protectedSources: shaFiles(['public/app-main.js', 'public/index.html', 'public/perf-runtime.js', ...css,
      'server/lib/model-image-distribution.js', 'server/lib/shared-image-store.js', 'server/lib/plm-image-ingest.js',
      'server/lib/plm-image-ownership.js', 'server/db.js', 'server/user-data.js', 'server/server.js']),
    harnessSources: shaFiles(['scripts/benchmark-plm-image-memory.js', 'scripts/lib/plm-image-memory-probe.js', 'scripts/lib/plm-image-memory-fixture.js']),
    runs: [],
  };
}
function runCohort(arm, output) {
  if (!['before', 'after'].includes(arm) || !output) throw new Error('Usage: node scripts/benchmark-plm-image-memory.js before|after NEW_OUTPUT_DIRECTORY');
  const meta = metadata(arm);
  const lock = path.join(os.tmpdir(), 'buyer-log-performance.lock');
  const fd = fs.openSync(lock, 'wx'); // shared, fail closed; do not overlap measurements
  try {
    fs.writeFileSync(fd, String(process.pid));
    fs.mkdirSync(output); // existing evidence is never overwritten
    fs.writeFileSync(path.join(output, 'cohort.json'), JSON.stringify(meta, null, 2));
    for (let i = 1; i <= 3; i++) {
      const stem = path.join(output, `${arm}-${i}`);
      // Node rotates traces. A fixed filename silently overwrites earlier segments.
      const traceFile = `${stem}.trace.\${rotation}.json`;
      const child = spawnSync(process.execPath, ['--trace-events-enabled', '--trace-event-categories=v8,node,node.async_hooks',
        `--trace-event-file-pattern=${traceFile}`, probe, 'baseline'], { cwd: APP, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      fs.writeFileSync(`${stem}.stdout.json`, child.stdout || '');
      fs.writeFileSync(`${stem}.stderr.txt`, child.stderr || '');
      if (child.status !== 0) throw new Error(`Run ${i} failed; all output retained (${child.error || child.status})`);
      const run = JSON.parse(child.stdout);
      run.traceArchive = archiveTraces(stem);
      meta.runs.push(run);
      fs.writeFileSync(path.join(output, 'cohort.json'), JSON.stringify(meta, null, 2));
      console.log(`${arm} ${i}/3: RSS=${(run.osPeakRssBytes / 1048576).toFixed(1)} MiB; external=${(run.sampledPeakExternalBytes / 1048576).toFixed(1)} MiB; first-link=${run.firstCanonicalLinkMs.toFixed(1)} ms; total=${run.totalMs.toFixed(1)} ms`);
    }
    const result = { arm, median: summarize(meta.runs), productionAcceptance: 'pending Phase 7 implementation and paired after cohort' };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
    return result;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) {
  try {
    if (process.argv[2] === 'compare') {
      const read = p => JSON.parse(fs.readFileSync(path.join(p, 'cohort.json'), 'utf8'));
      console.log(JSON.stringify(compareCohorts(read(process.argv[3]), read(process.argv[4])), null, 2));
    } else console.log(JSON.stringify(runCohort(process.argv[2], path.resolve(process.argv[3] || '.')), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { median, summarize, compareCohorts, archiveTraces };
