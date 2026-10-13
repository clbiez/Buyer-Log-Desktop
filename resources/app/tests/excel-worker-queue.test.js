'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExcelWorkerClient } = require('../server/excel-worker-client');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor() { super(); workers.push(this); }
    postMessage(message) { this.message = message; }
    terminate() { return Promise.resolve(); }
    complete(result = this.message.payload) {
      this.emit('message', { id: this.message.id, ok: true, result, metrics: { executionMs: 12, heapUsedBytes: 1024 } });
    }
  }
  return { workers, ...createExcelWorkerClient({ WorkerClass: FakeWorker, maxWorkers: 2, ...options }) };
}

test('independent users bypass a blocked owner while same-owner mutations keep FIFO', async () => {
  const client = fixture();
  let measured;
  const a = client.runExcelTask('parseAsasFile', { marker: 'A1' }, { serializationKey: 'source:user-a', onMetrics: metrics => { measured = metrics; } });
  const a2 = client.runExcelTask('parseAsasFile', { marker: 'A2' }, { serializationKey: 'source:user-a' });
  const b = client.runExcelTask('parseAsasFile', { marker: 'B' }, { serializationKey: 'source:user-b' });
  assert.equal(client.workers.length, 2);
  assert.equal(client.workers[1].message.payload.marker, 'B');
  client.workers[1].complete(); assert.deepEqual(await b, { marker: 'B' }); await tick();
  assert.equal(client.workers.length, 2, 'A2 waits for A1, even after B completes');
  client.workers[0].complete(); assert.deepEqual(await a, { marker: 'A1' }); await tick();
  assert.equal(client.workers[2].message.payload.marker, 'A2');
  client.workers[2].complete(); await a2; await tick();
  assert.equal(client.getExcelWorkerStats().peakActiveWorkers, 2);
  assert.equal(measured.executionMs, 12);
  assert.ok(measured.queueWaitMs >= 0);
  assert.doesNotMatch(JSON.stringify(measured), /user-a|marker|A1/);
  const diagnostics = JSON.stringify(client.getExcelWorkerStats());
  assert.doesNotMatch(diagnostics, /user-a|user-b|marker|A1|A2/);
});

test('large jobs run alone and queue backlog rejects instead of retaining unbounded data', async () => {
  const client = fixture({ memoryBudgetBytes: 96 * 1024 * 1024, maxPending: 1 });
  const a = client.runExcelTask('first');
  const b = client.runExcelTask('second');
  await assert.rejects(client.runExcelTask('third'), { code: 'EXCEL_WORKER_BUSY', statusCode: 503 });
  assert.equal(client.workers.length, 1);
  client.workers[0].complete(); await a; await tick();
  client.workers[1].complete(); await b; await tick();
  assert.equal(client.getExcelWorkerStats().peakActiveWorkers, 1);
});

test('pending buffer admission is bounded and cancelled payloads release queue capacity', async () => {
  const client = fixture({ maxWorkers: 1, maxRetainedBytes: 8 });
  const first = client.runExcelTask('first');
  const controller = new AbortController();
  const queued = client.runExcelTask('second', { data: new ArrayBuffer(8) }, { signal: controller.signal });
  await assert.rejects(client.runExcelTask('third', { data: new ArrayBuffer(1) }), { code: 'EXCEL_WORKER_BUSY' });
  controller.abort(); await assert.rejects(queued, { code: 'REFRESH_CANCELLED' });
  assert.equal(client.getExcelWorkerStats().retainedPayloadMiB, 0);
  client.workers[0].complete(); await first; await tick();
});

test('cancelled worker stays charged until termination; unrelated queue resumes afterwards', async () => {
  const client = fixture({ maxWorkers: 1 });
  let terminate;
  const controller = new AbortController();
  const active = client.runExcelTask('first', {}, { signal: controller.signal });
  client.workers[0].terminate = () => new Promise(resolve => { terminate = resolve; });
  const next = client.runExcelTask('second');
  controller.abort(); await assert.rejects(active, { code: 'REFRESH_CANCELLED' });
  assert.equal(client.workers.length, 1);
  terminate(); await tick();
  client.workers[1].complete(); await next; await tick();
});

test('timeout, clean unexpected exit and clone failure release slots and never hang the queue', async () => {
  const client = fixture({ maxWorkers: 1 });
  const timed = client.runExcelTask('first', {}, { timeoutMs: 10 });
  const exited = client.runExcelTask('second');
  const cloneError = client.runExcelTask('third');
  const timeoutAssertion = assert.rejects(timed, { code: 'EXCEL_WORKER_TIMEOUT' });
  // Node timeout is unref'ed deliberately; keep the test alive until it fires.
  await new Promise(resolve => setTimeout(resolve, 30)); await timeoutAssertion; await tick();
  client.workers[1].emit('exit', 0); await assert.rejects(exited, /exited unexpectedly/); await tick();
  client.workers[2].emit('error', new Error('DataCloneError')); await assert.rejects(cloneError, /DataCloneError/); await tick();
  assert.equal(client.getExcelWorkerStats().activeWorkers, 0);
});

test('parallel actual Excel work preserves canonical calculations and user-specific results', async () => {
  const XLSX = require('xlsx');
  require('../public/excel-date-utils').installSheetJsHooks(XLSX);
  const { parseASASWorkbook } = require('../server/lib/parse');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-worker-isolation-'));
  try {
    const files = ['DEMO-A', 'DEMO-B'].map((marker, index) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 'Sipariş Kod': String(100 + index), 'Model Adı': marker, 'Renk Kod': '001', 'Net Alım Sipariş Miktarı': 150 + index, 'FOB Fiyatı': 3.25 }]), 'ASAS');
      const file = path.join(dir, `${marker}.xlsx`); XLSX.writeFile(wb, file);
      return { file, expected: parseASASWorkbook(XLSX.readFile(file, { cellDates: false, raw: true })) };
    });
    const client = createExcelWorkerClient({ maxWorkers: 2 });
    const results = await Promise.all(files.map(({ file }, index) => client.runExcelTask('parseAsasFile', { fullPath: file }, { serializationKey: `source:demo-${index}` })));
    results.forEach((result, index) => assert.deepEqual(result.parsedAsas, files[index].expected));
    assert.equal(results[0].parsedAsas.orders[0].model, 'DEMO-A');
    assert.equal(results[1].parsedAsas.orders[0].model, 'DEMO-B');
    assert.equal(client.getExcelWorkerStats().peakActiveWorkers, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('successful task settles after termination so completion stats match released resources', async () => {
  const client = fixture({ maxWorkers: 1 });
  let terminate, completed = false;
  const pending = client.runExcelTask('first');
  client.workers[0].terminate = () => new Promise(resolve => { terminate = resolve; });
  pending.then(() => { completed = true; });
  client.workers[0].complete(); await tick();
  assert.equal(completed, false); assert.equal(client.getExcelWorkerStats().activeWorkers, 1);
  terminate(); await pending;
  assert.equal(client.getExcelWorkerStats().active, false);
  assert.equal(client.getExcelWorkerStats().activeWorkers, 0);
});
