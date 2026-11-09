'use strict';
// Synthetic local HTTP only. Run each revision in a fresh process.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { getEventListeners } = require('node:events');
const source = process.argv[2];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int07-ab-'));
Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local') });
const { syncPlmBoms } = require(path.join(source, 'resources/app/server/lib/plm-bom-sync'));
const client = require(path.join(source, 'resources/app/server/lib/corenectum-api-client'));
const settings = require(path.join(source, 'resources/app/server/lib/corenectum-api-settings'));
const bom = require(path.join(source, 'resources/app/server/lib/corenectum-bom-api'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const body = id => JSON.stringify({ data: { success: true, coreNectumResultData: { styleBom: { styleId: id, styleBomComponents: [] } } } });
const metrics = { calls: 0, active: 0, closed: 0, bytes: 0 };
const server = http.createServer(async (req, res) => {
  metrics.calls++; metrics.active++;
  let timer;
  res.on('close', () => { clearTimeout(timer); metrics.active--; metrics.closed++; });
  let text = ''; for await (const chunk of req) text += chunk;
  const id = JSON.parse(text).styleId;
  timer = setTimeout(() => { const data = body(id); metrics.bytes += Buffer.byteLength(data); res.end(data); }, id === 4 ? 500 : 50);
});
const realFetch = global.fetch;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  global.fetch = (url, options) => realFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  settings.saveToken('int07-ab', 'synthetic-local-probe-only');
  const dataStore = () => ({ load: () => ({ models: {} }), saveResults: entries => ({ revision: 1, written: entries.length }) });
  const result = { metrics, normal: [], defaults: [], lifecycle: [] };
  for (let i = 0; i < 2; i++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const value = await syncPlmBoms([{ plmId: '1', styleId: '2' }], { ownerId: 'int07-ab', store: dataStore() });
    result.normal.push({ state: i ? 'warm' : 'cold', ms: performance.now() - start, cpu: process.cpuUsage(cpu), fetched: value.fetched, fingerprint: value.entries.get('1').fingerprint });
  }
  for (let i = 0; i < 2; i++) {
    const calls = metrics.calls, start = performance.now();
    const options = { retries: 1 };
    const values = await Promise.all([client.postJson('int07-ab', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 3 }, options), client.postJson('int07-ab', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 3 }, options)]);
    result.defaults.push({ state: i ? 'warm' : 'cold', ms: performance.now() - start, calls: metrics.calls - calls, cloned: values[0] !== values[1] });
  }
  for (let i = 0; i < 6; i++) {
    const signal = new AbortController(); let cancelled = false;
    const running = syncPlmBoms([{ plmId: '1', styleId: '4' }], { ownerId: 'int07-ab', store: dataStore(), signal: signal.signal, isCancelled: () => cancelled });
    while (metrics.active !== 1) await pause(1);
    const start = performance.now(); cancelled = true; signal.abort();
    const value = await running;
    while (metrics.active) await pause(1);
    global.gc?.();
    const sample = { cycle: i, cancelToCloseMs: performance.now() - start, active: metrics.active, signalListeners: getEventListeners(signal.signal, 'abort').length, intervals: process.getActiveResourcesInfo().filter(x => x === 'Timeout').length, rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, fetched: value.fetched };
    if (i) result.lifecycle.push(sample); // first cycle warms cancellation/undici internals
  }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
