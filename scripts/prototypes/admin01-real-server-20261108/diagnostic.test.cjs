'use strict';
const test = require('node:test'), http = require('node:http'), os = require('node:os');
const { fork } = require('node:child_process');
const { fs, path, assert, quantiles, inside, sha } = require('./common.cjs');
test('failed and timed-out attempts remain in latency quantiles', () => {
  assert.deepEqual(quantiles([{ latencyMs: 1, status: 200 }, { latencyMs: 2, status: 200 }, { latencyMs: 10000, status: null, error: 'timeout' }]),
    { count: 3, failures: 1, p50Ms: 2, p95Ms: 10000, maxMs: 10000 });
  assert.equal(quantiles([]).p95Ms, null);
  assert.throws(() => quantiles([{ latencyMs: NaN, status: 200 }]));
});
test('diagnostic output confinement rejects siblings and traversals', () => {
  inside('/tmp/demo', '/tmp/demo/run');
  for (const file of ['/tmp/demo', '/tmp/demo-sibling/run', '/tmp/demo/../private']) assert.throws(() => inside('/tmp/demo', file));
});
test('independent client preserves denied GET and generation mismatch; no retry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin01-load-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/api/health') { res.end('{"ok":true,"app":"Buyer Log"}'); return; }
    res.setHeader('X-Page-Cache-Generation', 'changed');
    res.statusCode = req.url.endsWith('orders') ? 403 : 200; res.end('projection');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const child = fork(path.join(__dirname, 'load.cjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.connected) child.kill(); });
  const output = path.join(root, 'attempts.json');
  const expected = Object.fromEntries(['overview', 'orders'].map(m => ['/api/page-projection/' + m, { sha256: sha('projection'), generation: 'expected' }]));
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('child exit ' + code)));
    child.on('message', m => { if (m.ready) child.send({ stop: true }); });
    child.send({ port: server.address().port, cookie: 'synthetic=only', scenario: 'backup-interactive', expected, output });
  });
  const attempts = JSON.parse(fs.readFileSync(output)).attempts;
  for (const module of ['overview', 'orders']) {
    const samples = attempts.filter(a => a.endpoint.endsWith(module)); assert.equal(samples.length, 1);
    assert.equal(samples[0].error, 'projection bytes/generation changed'); assert.ok(samples[0].latencyMs > 0);
  }
  assert.equal(attempts.find(a => a.endpoint.endsWith('orders')).status, 403);
  assert.ok(requests.every(r => r.method === 'GET'));
});
