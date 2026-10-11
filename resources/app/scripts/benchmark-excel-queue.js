'use strict';
// Local, synthetic data only. Does not start the server or use network/release tools.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const XLSX = require('xlsx');
const { createExcelWorkerClient } = require('../server/excel-worker-client');
require('../public/excel-date-utils').installSheetJsHooks(XLSX);
const { parseASASWorkbook } = require('../server/lib/parse');
const rowCount = Math.max(1, Number(process.argv[2]) || 2000);

async function measure(maxWorkers, files) {
  const client = createExcelWorkerClient({ maxWorkers });
  const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const started = performance.now(), tasks = [];
  await Promise.all([
    { task: 'diagnosticSpin', payload: { ms: 900 }, key: 'source:demo-a' },
    ...files.map(({ fullPath }, index) => ({ task: 'parseAsasFile', payload: { fullPath }, key: `source:demo-${index + 1}` })),
  ].map((job, index) => {
    const submitted = performance.now(); let metrics;
    return client.runExcelTask(job.task, job.payload, { serializationKey: job.key, onMetrics: value => { metrics = value; } }).then(result => {
      if (index > 0) assert.deepEqual(result.parsedAsas, files[index - 1].expected);
      tasks.push({ index, task: job.task, totalMs: performance.now() - submitted, ...metrics });
    });
  }));
  while (client.getExcelWorkerStats().activeWorkers) await new Promise(resolve => setImmediate(resolve));
  clearInterval(sampler); delay.disable();
  return { maxWorkers, wallMs: performance.now() - started, peakRssMiB: peakRss / 1048576,
    eventLoopDelayMaxMs: delay.max / 1e6, tasks: tasks.sort((a, b) => a.index - b.index), stats: client.getExcelWorkerStats() };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-excel-benchmark-'));
  try {
    const files = ['DEMO-B', 'DEMO-C'].map(marker => {
      const workbook = XLSX.utils.book_new();
      const rows = Array.from({ length: rowCount }, (_, index) => ({ 'Sipariş Kod': String(index + 100000), 'Model Adı': marker,
        'Renk Kod': '001', 'Net Alım Sipariş Miktarı': 150 + index, 'FOB Fiyatı': 3.25, 'Orijinal Exfactory Merch Tarih': '2026-10-01' }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'ASAS');
      const fullPath = path.join(dir, `${marker}.xlsx`); XLSX.writeFile(workbook, fullPath);
      return { fullPath, expected: parseASASWorkbook(XLSX.readFile(fullPath, { cellDates: false, raw: true })) };
    });
    // --workers isolates each measurement in a fresh process for RSS comparisons.
    const flag = process.argv.indexOf('--workers');
    const workers = flag >= 0 ? [Number(process.argv[flag + 1]) || 1] : [1, 2];
    const measurements = [];
    for (const count of workers) measurements.push(await measure(count, files));
    console.log(JSON.stringify({ syntheticRowsPerWorkbook: rowCount, parsedOutputParity: true,
      sequentialReference: 'maxWorkers=1 reproduces the former global queue', measurements }, null, 2));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
