'use strict';
// Usage: node run-startup.js <fixtureRoot> <outJson> [appRoot] [--notrace] [--wait ms]
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), net = require('net');
const [root, out, appArg] = process.argv.slice(2);
const APP = path.resolve(appArg && !appArg.startsWith('--') ? appArg : '/home/user/Buyer-Log-Desktop/resources/app');
const trace = !process.argv.includes('--notrace');
const waitIdx = process.argv.indexOf('--wait');
const settleMs = waitIdx > 0 ? Number(process.argv[waitIdx + 1]) : 12000;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { return new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
(async () => {
  const port = await freePort();
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local', 'BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp'), PORT: String(port), BUYER_LOG_PORT: String(port),
    FS_TRACE_OUT: out + '.fs.json', FS_TRACE_ROOT: root };
  if (!fs.existsSync(path.join(root, 'config.json'))) fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port }));
  else { const c = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); c.port = port; fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(c)); }
  const args = trace ? ['--require', path.join(__dirname, 'fs-trace.js'), path.join(APP, 'server/server.js')] : ['--require', path.join(__dirname, 'lag-probe.js'), path.join(APP, 'server/server.js')];
  env.LAG_OUT = out + '.lag.json';
  const logFd = fs.openSync(out + '.log', 'w');
  const t0 = performance.now();
  const child = spawn(process.execPath, args, { cwd: APP, env, stdio: ['ignore', logFd, logFd] });
  const base = `http://127.0.0.1:${port}`;
  const result = { port };
  for (let i = 0; i < 2400; i++) {
    if (child.exitCode !== null) throw Error('server exited ' + child.exitCode);
    try { const r = await fetch(base + '/api/status', { signal: AbortSignal.timeout(2000) }); if (r.status < 500) { result.statusReadyMs = performance.now() - t0; break; } } catch (_) {}
    await delay(25);
  }
  const password = 'synthetic-startup-only-123';
  const t1 = performance.now();
  const lr = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', password, newPassword: password }), signal: AbortSignal.timeout(120000) });
  result.loginStatus = lr.status; result.loginMs = performance.now() - t1; result.loginDoneMs = performance.now() - t0;
  const cookie = String(lr.headers.get('set-cookie') || '').split(';')[0];
  const t2 = performance.now();
  try {
    const dr = await fetch(base + '/api/data', { headers: { cookie }, signal: AbortSignal.timeout(300000) });
    const buf = Buffer.from(await dr.arrayBuffer());
    result.dataStatus = dr.status; result.dataBytes = buf.length; result.dataMs = performance.now() - t2; result.dataDoneMs = performance.now() - t0;
  } catch (e) { result.dataError = String(e); }
  await delay(settleMs);
  child.kill('SIGUSR2'); await delay(1500);
  child.kill('SIGTERM');
  await new Promise(r => child.once('exit', r));
  const log = fs.readFileSync(out + '.log', 'utf8');
  result.perf = log.split('\n').filter(l => l.startsWith('[PERF]')).slice(0, 80);
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ statusReadyMs: Math.round(result.statusReadyMs), loginMs: Math.round(result.loginMs), loginStatus: result.loginStatus, dataMs: Math.round(result.dataMs), dataStatus: result.dataStatus, dataBytes: result.dataBytes }));
})().catch(e => { console.error(e); process.exit(1); });
