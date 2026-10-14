'use strict';
/* Saha regresyonu (7.0.273–7.0.276): büyük veri setinde sunucu ~2 GB V8
   sınırında kaldı; yenileme snapshot-save adımında OOM ile çöktü, soğuk açılış
   aynı sınırda kilitlendi ve kullanıcı verisi hiç yüklenmedi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-heap-279-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const { serverHeapArgs } = require('../server/lib/server-heap-policy');
const snapshots = require('../server/lib/model-snapshot');
const { startRuntimePressureMonitor } = require('../server/lib/runtime-pressure-monitor');
test.after(() => fs.rmSync(root, { recursive:true, force:true }));
const GB = 1024 ** 3;

test('8 GB machine gets a larger server heap than the ~2 GB V8 default; 16 GB keeps the default', () => {
  assert.deepEqual(serverHeapArgs({ totalMemBytes: 8 * GB }).args, ['--max-old-space-size=3686']);
  const big = serverHeapArgs({ totalMemBytes: 16 * GB });
  assert.deepEqual(big.args, []); assert.equal(big.source, 'v8-default');
  assert.deepEqual(serverHeapArgs({ totalMemBytes: 64 * GB }).args, []);
  assert.deepEqual(serverHeapArgs({ totalMemBytes: 12 * GB }).args, ['--max-old-space-size=4096']);
  assert.deepEqual(serverHeapArgs({ totalMemBytes: 4 * GB }).args, ['--max-old-space-size=1638']);
});
test('administrator settings win and the policy can be disabled', () => {
  assert.equal(serverHeapArgs({ env:{ NODE_OPTIONS:'--max-old-space-size=3000' }, totalMemBytes: 8 * GB }).source, 'inherited');
  const forwarded = serverHeapArgs({ execArgv:['--max-old-space-size=3000'], totalMemBytes: 8 * GB });
  assert.deepEqual(forwarded.args, ['--max-old-space-size=3000']); assert.equal(forwarded.source, 'watchdog-flag');
  assert.deepEqual(serverHeapArgs({ env:{ BUYER_LOG_MAX_HEAP_MB:'0' }, totalMemBytes: 8 * GB }).args, []);
  assert.deepEqual(serverHeapArgs({ env:{ BUYER_LOG_MAX_HEAP_MB:'99999' }, totalMemBytes: 8 * GB }).args, ['--max-old-space-size=4096']);
  assert.deepEqual(serverHeapArgs({ env:{ BUYER_LOG_MAX_HEAP_MB:'100' }, totalMemBytes: 8 * GB }).args, ['--max-old-space-size=1024']);
  assert.deepEqual(serverHeapArgs({ totalMemBytes: 0 }).args, []);
});
test('watchdog starts the server with the heap flag and drops it if Node rejects it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'watchdog.js'), 'utf8');
  assert.match(source, /serverHeapArgs\(\{ env: process\.env, execArgv: process\.execArgv, totalMemBytes: os\.totalmem\(\) \}\)/);
  assert.match(source, /spawn\(process\.execPath, \[\.\.\.heapArgs, SERVER_FILE\]/);
  assert.match(source, /code === 9 && !heapArgsRejected/);
});
test('snapshot body is written without a joined copy and stays byte-compatible with the reader', async () => {
  const orders = Array.from({ length: 400 }, (_, index) => ({ ocode:index, model:`ÖRNEK-ŞĞÜ-${index}`, date:new Date('2026-10-05T21:00:00.000Z') }));
  const payload = { asasOrders:orders, asasOrdersByTarget:{ cp:orders, orders }, antrepoMap:{}, lflRows:[{ model:'İç' }], loadedAt:'2026-10-14T10:00:00.000Z' };
  const saved = await snapshots.saveModelSnapshotAsync('heap', payload);
  const text = zlib.gunzipSync(fs.readFileSync(saved.file)).toString('utf8'), parsed = JSON.parse(text);
  const marker = '"payload":', body = text.slice(text.indexOf(marker) + marker.length, -1);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), parsed.checksum);
  assert.equal(saved.uncompressedBytes, Buffer.byteLength(text));
  const loaded = await snapshots.loadModelSnapshotAsync('heap');
  assert.equal(loaded.asasOrders.length, 400);
  assert.equal(loaded.asasOrders[7].model, 'ÖRNEK-ŞĞÜ-7');
  assert.ok(loaded.asasOrders[0].date instanceof Date);
  assert.equal(loaded.asasOrdersByTarget.orders, loaded.asasOrders);
  assert.equal(loaded.lflRows[0].model, 'İç');
  const empty = await snapshots.saveModelSnapshotAsync('heap-empty', { asasOrders:[] });
  assert.ok(empty.bytes > 0);
  assert.deepEqual((await snapshots.loadModelSnapshotAsync('heap-empty')).asasOrders, []);
});
test('runtime monitor reports the heap limit and a blocked event loop with numbers only', async () => {
  const lines = []; let shift = 0, cpuUs = 0;
  const monitor = startRuntimePressureMonitor({ log: line => lines.push(line), intervalMs: 20, stallMs: 1000, now: () => Date.now() + shift, cpu: () => cpuUs });
  shift = 5000; cpuUs = 4900 * 1000;
  await new Promise(resolve => setTimeout(resolve, 70));
  monitor.stop();
  assert.match(lines[0], /^\[RUNTIME\] heap-limit heapUsedMb=\d+ heapLimitMb=\d+ rssMb=\d+$/);
  const stall = lines.find(line => line.includes('event-loop-stall'));
  assert.match(stall, /^\[RUNTIME\] event-loop-stall blockedMs=\d+ cpuMs=4900 heapUsedMb=\d+ heapLimitMb=\d+ rssMb=\d+$/);
  assert.equal(lines.filter(line => line.includes('event-loop-stall')).length, 1);
});
test('laptop sleep or a clock jump (long lag, no CPU) is not reported as a stall', async () => {
  const lines = []; let shift = 0;
  const monitor = startRuntimePressureMonitor({ log: line => lines.push(line), intervalMs: 20, stallMs: 1000, now: () => Date.now() + shift, cpu: () => 0 });
  shift = 8 * 3600 * 1000;
  await new Promise(resolve => setTimeout(resolve, 70));
  monitor.stop();
  assert.equal(lines.filter(line => line.includes('event-loop-stall')).length, 0);
});
