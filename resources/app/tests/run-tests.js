'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

const filters = process.argv.slice(2).map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
let tests = collectTests(TEST_ROOT);
if (filters.length) {
  tests = tests.filter(file => filters.some(filter => rel(file).toLowerCase().includes(filter)));
}

if (!tests.length) {
  console.error('[Buyer Log tests] Çalıştırılacak test bulunamadı.');
  process.exit(2);
}

// Keep each child-process command safely below the Windows command-line limit.
const batches = [];
let batch = [];
let commandChars = 0;
const MAX_COMMAND_CHARS = 5600;
const MAX_BATCH_FILES = 120;
for (const file of tests) {
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

const requestedConcurrency = Number.parseInt(process.env.BUYER_LOG_TEST_CONCURRENCY || '4', 10);
const testConcurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0 ? Math.min(requestedConcurrency, 16) : 4;

const startedAt = Date.now();
console.log(`[Buyer Log tests] ${tests.length} test dosyası, ${batches.length} batch, concurrency=${testConcurrency}.`);

for (let i = 0; i < batches.length; i += 1) {
  const files = batches[i];
  console.log(`\n[Buyer Log tests] Batch ${i + 1}/${batches.length} (${files.length} dosya)`);
  const result = spawnSync(process.execPath, ['--test', `--test-concurrency=${testConcurrency}`, ...files], {
    cwd: APP_ROOT,
    env: { ...process.env, BUYER_LOG_TEST_SUITE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[Buyer Log tests] Test runner başlatılamadı: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[Buyer Log tests] Batch ${i + 1} başarısız. ZIP teslim edilmemeli.`);
    process.exit(result.status || 1);
  }
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n[Buyer Log tests] PASS — ${tests.length} test dosyası (${elapsedSec}s).`);
