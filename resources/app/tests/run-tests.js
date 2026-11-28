'use strict';

const fs = require('node:fs');
const os = require('node:os');
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
const isolatedNames = new Set(['sync-simulation-v20261009.test.js', 'collection-sync-simulation-v20261125.test.js', 'oab-batch-integration-v720.test.js', 'refresh-pipeline-perf-v251.test.js', 'plm-technical-sheet-ownership-v1073.test.js', 'loading-recovery.test.js']);
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

// Dosya bazlı süre özeti (kompakt modda): en yavaş N dosya ve her batch'in kritik
// yolu (en uzun dosya / duvar saati). CI süre karşılaştırması için ortam satırı da
// yazılır; farklı runner donanımı aynı kodda süreyi değiştirebilir.
const requestedSlowest = Number.parseInt(process.env.BUYER_LOG_TEST_SLOWEST || '15', 10);
const slowestCount = Number.isFinite(requestedSlowest) && requestedSlowest >= 0 ? Math.min(requestedSlowest, 200) : 15;
const timingsFile = !verbose && slowestCount > 0
  ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-test-timings-')), 'timings.jsonl')
  : '';
const fileTimings = [];
function readBatchTimings(batchNo) {
  if (!timingsFile || !fs.existsSync(timingsFile)) return [];
  const rows = fs.readFileSync(timingsFile, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(row => row && row.file && Number.isFinite(row.ms));
  fs.rmSync(timingsFile, { force: true });
  return rows.map(row => ({ ...row, batch: batchNo }));
}
function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

const startedAt = Date.now();
const cpus = os.cpus();
console.log(`[Buyer Log tests] Ortam: Node ${process.version}, ${os.platform()} ${os.release()} ${os.arch()}, CPU ${cpus.length}× ${(cpus[0] && cpus[0].model || '?').trim()}, RAM ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB.`);
console.log(`[Buyer Log tests] ${tests.length} test dosyası, ${batches.length} batch, concurrency=${testConcurrency}.`);

for (let i = 0; i < batches.length; i += 1) {
  const files = batches[i];
  console.log(`\n[Buyer Log tests] Batch ${i + 1}/${batches.length} (${files.length} dosya)`);
  const batchStartedAt = Date.now();
  const reporterArgs = verbose ? [] : [`--test-reporter=${COMPACT_REPORTER}`];
  const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${testConcurrency}`, ...reporterArgs, ...files], {
    cwd: APP_ROOT,
    env: { ...process.env, BUYER_LOG_TEST_SUITE: '1', ...(timingsFile ? { BUYER_LOG_TEST_TIMINGS_FILE: timingsFile } : {}) },
    stdio: 'inherit',
    windowsHide: true,
  });
  const batchMs = Date.now() - batchStartedAt;
  const batchTimings = readBatchTimings(i + 1);
  fileTimings.push(...batchTimings);
  const longest = batchTimings.reduce((best, row) => (!best || row.ms > best.ms ? row : best), null);
  const fileSumMs = batchTimings.reduce((sum, row) => sum + row.ms, 0);
  const critical = longest && files.length > 1
    ? ` En uzun dosya ${seconds(longest.ms)} (${longest.file}); dosya süreleri toplamı ${seconds(fileSumMs)}.`
    : '';
  console.log(`[Buyer Log tests] Batch ${i + 1}/${batches.length} süresi: ${(batchMs / 1000).toFixed(1)}s.${critical}`);
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
if (fileTimings.length) {
  const slowest = fileTimings.slice().sort((a, b) => b.ms - a.ms).slice(0, slowestCount);
  console.log(`\n[Buyer Log tests] En yavaş ${slowest.length} dosya (duvar saati, alt süreç dahil; ${fileTimings.length} dosya ölçüldü):`);
  for (const row of slowest) console.log(`  ${seconds(row.ms).padStart(8)}  b${row.batch}  ${row.file}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['### Buyer Log tests — en yavaş dosyalar', '', `Toplam ${elapsedSec}s · concurrency=${testConcurrency} · Node ${process.version} · CPU ${cpus.length}× ${(cpus[0] && cpus[0].model || '?').trim()}`, '', '| Süre | Batch | Dosya |', '|---:|---:|---|']
      .concat(slowest.map(row => `| ${seconds(row.ms)} | ${row.batch} | \`${row.file}\` |`));
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n'); } catch (_) { /* özet isteğe bağlı */ }
  }
}
console.log(`\n[Buyer Log tests] PASS — ${tests.length} test dosyası (${elapsedSec}s).`);
