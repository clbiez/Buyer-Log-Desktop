'use strict';

// An independent process keeps scheduling requests while the archive thread stalls.
// This is a synthetic harness endpoint, never the application health handler.
const http = require('node:http');
const now = () => Number(process.hrtime.bigint()) / 1e6;
let timer, pending = 0, stopping = false;
const attempts = [];
function done() { if (stopping && pending === 0) process.send({ attempts }, () => process.exit(0)); }
process.on('message', message => {
  if (message.stop) { clearInterval(timer); stopping = true; done(); return; }
  if (!message.port || timer) return;
  const request = () => {
    const sample = { sentMs: now(), status: null, error: null, latencyMs: null };
    attempts.push(sample); pending++;
    const req = http.get({ hostname: '127.0.0.1', port: message.port, path: '/api/health', agent: false }, res => {
      sample.status = res.statusCode; res.resume();
      res.on('end', () => { sample.latencyMs = now() - sample.sentMs; pending--; done(); });
    });
    req.setTimeout(2000, () => req.destroy(new Error('probe timeout')));
    req.on('error', error => { sample.error = error.message; sample.latencyMs = now() - sample.sentMs; pending--; done(); });
  };
  timer = setInterval(request, 10); request(); process.send({ ready: true });
});
process.on('disconnect', () => process.exit(1));
