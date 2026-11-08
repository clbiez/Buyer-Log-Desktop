'use strict';
// Separate client process. Fixed cadence, no HTTP retry, full response body timing.
const http = require('node:http'), crypto = require('node:crypto');
const { now, save } = require('./common.cjs');
const agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
let config, timers = [], pending = 0, stopping = false;
const attempts = [];
function finish() {
  if (stopping && pending === 0) { save(config.output, { attempts }); agent.destroy(); process.send?.({ stopped: true }); process.disconnect(); }
}
function request(endpoint, plannedMs) {
  const sample = { endpoint, plannedMs, sentMs: now(), status: null, error: null };
  attempts.push(sample);
  if (pending >= 100) { Object.assign(sample, { error: 'client admission: 100 outstanding', latencyMs: 0, bytes: 0 }); return; }
  pending++; let completed = false, bytes = 0;
  const hash = crypto.createHash('sha256'), chunks = [];
  function done(error) {
    if (completed) return; completed = true;
    Object.assign(sample, { latencyMs: now() - sample.sentMs, bytes, error: error ? error.message : null });
    if (!error) {
      sample.bodySha256 = hash.digest('hex');
      if (endpoint === '/api/health') {
        try { const value = JSON.parse(Buffer.concat(chunks)); if (value.ok !== true || value.app !== 'Buyer Log') sample.error = 'invalid real health payload'; }
        catch (err) { sample.error = err.message; }
      } else if (sample.bodySha256 !== config.expected[endpoint].sha256 || sample.generation !== config.expected[endpoint].generation) sample.error = 'projection bytes/generation changed';
    }
    pending--; finish();
  }
  const req = http.get({ hostname: '127.0.0.1', port: config.port, path: endpoint, agent,
    headers: { Cookie: config.cookie, 'Accept-Encoding': 'gzip' } }, res => {
    sample.status = res.statusCode; sample.generation = res.headers['x-page-cache-generation'] || null;
    sample.cache = res.headers['x-page-cache'] || null; sample.encoding = res.headers['content-encoding'] || 'identity';
    res.on('data', chunk => { bytes += chunk.length; hash.update(chunk); if (endpoint === '/api/health') chunks.push(chunk); });
    res.once('end', () => done()); res.once('error', done); res.once('aborted', () => done(new Error('response aborted')));
  });
  req.setTimeout(10000, () => req.destroy(new Error('request timeout'))); req.once('error', done);
}
process.on('message', message => {
  if (message.stop) { for (const timer of timers) clearInterval(timer); stopping = true; finish(); return; }
  config = message;
  const cadences = config.scenario === 'profile' ? [] : [['/api/health', 10],
    ...(config.scenario === 'backup-interactive' ? [['/api/page-projection/overview', 500], ['/api/page-projection/orders', 500]] : [])];
  for (const [endpoint, cadence] of cadences) {
    let planned = now(); request(endpoint, planned);
    timers.push(setInterval(() => { planned += cadence; request(endpoint, planned); }, cadence));
  }
  process.send?.({ ready: true });
});
process.on('disconnect', () => { if (!stopping && config) { save(config.output + '.failed.json', { attempts, error: 'parent disconnected' }); process.exit(1); } });
