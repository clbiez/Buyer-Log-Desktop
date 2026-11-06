'use strict';
// Each invocation is a fresh parent and real Excel worker. Synthetic files only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const app = path.resolve(arg('--app-root', path.join(__dirname, '..')));
const source = path.resolve(arg('--source-fixture', ''));
const fixture = path.join(source, 'benchmark-fixture.json');
if (!fs.existsSync(fixture) || JSON.parse(fs.readFileSync(fixture, 'utf8')).synthetic !== true) throw Error('An explicitly synthetic benchmark fixture is required');
const file = path.join(source, 'ASAS - Demo.xlsx');
const worker = new Worker(path.join(app, 'server/workers/excel-worker.js'));
const started = performance.now();
const timer = setTimeout(() => { worker.terminate(); throw Error('Source benchmark timed out'); }, 180000);
worker.once('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
worker.once('message', message => {
  clearTimeout(timer);
  try {
    if (!message.ok) throw Error(message.error?.message || 'Source worker failed');
    const receivedAt = performance.now();
    const result = message.result;
    if (result.parsedAsas.orders.length !== 30000) throw Error('Expected exactly 30,000 synthetic orders');
    const sha256 = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
    process.stdout.write(JSON.stringify({ synthetic: true, app, task: 'parseAsasFile',
      sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      rows: result.parsedAsas.orders.length, resultSha256: sha256,
      workerExecutionMs: message.metrics.executionMs, parentRoundTripMs: receivedAt - started,
      workerHeapUsedBytes: message.metrics.heapUsedBytes, node: process.version, platform: process.platform }) + '\n');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { worker.terminate(); }
});
worker.postMessage({ id: 1, task: 'parseAsasFile', payload: { fullPath: file } });
