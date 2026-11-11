'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const TEST_ROOT = __dirname;
const APP_ROOT = path.resolve(TEST_ROOT, '..');

function collectTests(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTests(full));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function rel(file) {
  return path.relative(APP_ROOT, file).split(path.sep).join('/');
}

const args = process.argv.slice(2).map(v => String(v || '').trim()).filter(Boolean);
// Varsayılan kompakt çıktı: yalnız başarısız testler + özet (agent/CI log ve token
// maliyetini düşürür). Tam spec/TAP akışı için --verbose veya BUYER_LOG_TEST_VERBOSE=1.
const verbose = args.includes('--verbose') || process.env.BUYER_LOG_TEST_VERBOSE === '1';
const filters = args.filter(v => v !== '--verbose').map(v => v.toLowerCase());
// Windows mutlak yolu (D:\…) ESM yükleyicisinde şema sanılır; raporlayıcı file:// URL olarak verilir.
const COMPACT_REPORTER = pathToFileURL(path.join(TEST_ROOT, 'compact-reporter.js')).href;
let tests = collectTests(TEST_ROOT);
if (filters.length) {
  tests = tests.filter(file => filters.some(filter => rel(file).toLowerCase().includes(filter)));
}

if (!tests.length) {
  console.error('[Buyer Log tests] Çalıştırılacak test bulunamadı.');
  process.exit(2);
}

// Keep each child-process command conservatively below the Windows command-line limit.
// Larger sequential batches avoid idle test workers at batch boundaries;
// the same test files, test concurrency and failure gates are preserved.
// The ten-device filesystem simulation keeps its own deadlines by running
// without competing file workers. Every seed and assertion still runs.
// These tests enforce short wall-clock budgets. A measured
// parallel run stretched a 23 ms PLM lookup to 650 ms and delayed worker startup
// past 200 ms. Keep their data, assertions and deadlines; remove CPU contention.
const isolatedNames = new Set(['sync-simulation-v20261009.test.js', 'oab-batch-integration-v720.test.js', 'refresh-pipeline-perf-v251.test.js', 'plm-technical-sheet-ownership-v1073.test.js', 'loading-recovery.test.js']);
// The projection regression also forks workers; isolate it after a measured
// 8 GiB suite OOM. Its data, assertions and deadlines remain unchanged.
// OAB runs a real HTTP server, cancellation and intentionally delayed mock PASS
// requests; isolate it from CPU/file contention in the parallel Windows suite.
const isolatedTests = tests.filter(file => isolatedNames.has(path.basename(file)));
const parallelTests = tests.filter(file => !isolatedTests.includes(file));
const batches = [];
let batch = [];
let commandChars = 0;
const MAX_COMMAND_CHARS = 16000;
const MAX_BATCH_FILES = 300;
for (const file of parallelTests) {
  const arg = rel(file);
  const cost = arg.length + 3;
  if (batch.length && (batch.length >= MAX_BATCH_FILES || commandChars + cost > MAX_COMMAND_CHARS)) {
    batches.push(batch);
    batch = [];
    commandChars = 0;
  }
  batch.push(arg);
  commandChars += cost;
}
if (batch.length) batches.push(batch);
for (const file of isolatedTests) batches.push([rel(file)]);

const requestedConcurrency = Number.parseInt(process.env.BUYER_LOG_TEST_CONCURRENCY || '4', 10);
const testConcurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? Math.min(requestedConcurrency, 16) : 4;

const startedAt = Date.now();
console.log(`[Buyer Log tests] ${tests.length} test dosyası, ${batches.length} batch, concurrency=${testConcurrency}.`);

for (let i = 0; i < batches.length; i += 1) {
  const files = batches[i];
  console.log(`\n[Buyer Log tests] Batch ${i + 1}/${batches.length} (${files.length} dosya)`);
  const batchStartedAt = Date.now();
  const reporterArgs = verbose ? [] : [`--test-reporter=${COMPACT_REPORTER}`];
  const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${testConcurrency}`, ...reporterArgs, ...files], {
    cwd: APP_ROOT,
    env: { ...process.env, BUYER_LOG_TEST_SUITE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  console.log(`[Buyer Log tests] Batch ${i + 1}/${batches.length} süresi: ${((Date.now() - batchStartedAt) / 1000).toFixed(1)}s.`);
  if (result.error) {
    console.error(`[Buyer Log tests] Test runner başlatılamadı: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[Buyer Log tests] Batch ${i + 1} başarısız. ZIP teslim edilmemeli.`);
    console.error(verbose ? '[Buyer Log tests] Hatanın kaynağı için üstteki "not ok" kaydındaki location ve error alanlarını inceleyin.' : '[Buyer Log tests] Hatanın kaynağı için üstteki ✖ kayıtlarını (dosya:satır + hata) inceleyin; tam akış için --verbose.');
    process.exit(result.status || 1);
  }
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n[Buyer Log tests] PASS — ${tests.length} test dosyası (${elapsedSec}s).`);
