'use strict';
// Must run beneath the same flock as measurement/tests. No production changes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const [label, scenario] = process.argv.slice(2);
assert.match(label || '', /^[a-z0-9-]+$/);
assert.ok(['completion-race', 'contention', 'active-before-write', 'active-after-fsync'].includes(scenario));
const output = path.join(root, 'docs/performance-program/shared-lease-lost-20261108', label);
fs.mkdirSync(output); // Refuse reuse, including failed evidence.
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shared-lease-diag-'));
const file = path.join(dataRoot, 'BuyerLogLocal.db');
const events = [];
const record = (event, detail = {}) => events.push({ ns: process.hrtime.bigint().toString(), wall: new Date().toISOString(),
  pid: process.pid, event, ...detail });
const pins = {};
const sources = ['resources/app/server/lib/local-db.js', 'resources/app/server/lib/shared-file-transaction.js',
  'resources/app/server/lib/durable-file-recovery.js', 'resources/app/server/lib/lease-worker-registry.js'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const p of sources) {
  pins[p] = hash(fs.readFileSync(path.join(root, p)));
  assert.equal(pins[p], hash(execFileSync('git', ['show', `abc683e4bcc247a7e8e412c07532bc8059fe3adb:${p}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 })));
}
const stat = fs.statfsSync(dataRoot);
const manifest = { label, scenario, started: new Date().toISOString(), versions: process.versions, runtime: process.execPath,
  dataRoot, sourceBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  historical: 'abc683e4bcc247a7e8e412c07532bc8059fe3adb', sourcePins: pins,
  harnessPins: Object.fromEntries(fs.readdirSync(__dirname).filter(p => /\.(cjs|sh)$/.test(p)).map(p => [p, hash(fs.readFileSync(path.join(__dirname, p)))])),
  freeDiskBytes: Number(stat.bavail) * Number(stat.bsize), freeMemoryBytes: os.freemem(),
  lock: '/tmp/buyerlog-performance-measurement.lock',
  classification: 'Controlled scheduling/IO or external-owner-displacement injection; real production guards/default timer; not a natural failure or historical replay',
  accepted: [], rejected: [] };
assert.ok(manifest.freeDiskBytes > 1024 ** 3 && manifest.freeMemoryBytes > 1024 ** 3);
const children = [];
function child(role, extra = {}) {
  const name = extra.name || role;
  const config = { scenario, role, file, ...extra, timeline: path.join(output, name + '.timeline.jsonl'), result: path.join(output, name + '.result.json') };
  fs.writeFileSync(path.join(output, name + '.config.json'), JSON.stringify(config, null, 2) + '\n');
  const out = fs.openSync(path.join(output, name + '.stdout.log'), 'wx');
  const err = fs.openSync(path.join(output, name + '.stderr.log'), 'wx');
  const received = fs.openSync(path.join(output, name + '.streams.jsonl'), 'wx');
  const env = { ...process.env, BUYER_LOG_INSTANCE_ID: `diag-${label}-${name}`, BUYER_LOG_SERVER_DATA_ROOT: dataRoot,
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataRoot, 'local'), BUYER_LOG_DATA_ROOT: path.join(dataRoot, 'app'),
    BUYER_LOG_CONFIG_PATH: path.join(dataRoot, 'config.json') };
  delete env.BUYER_LOG_DEBUG_LEASE;
  const p = spawn(process.execPath, [path.join(__dirname, 'scenario-worker.cjs'), JSON.stringify(config)],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages = [];
  const waiters = [];
  p.on('message', message => {
    messages.push(message); record('child:message', { name, childPid: p.pid, ...message });
    if (message.event === 'ack') manifest.accepted.push({ name, ...message });
    if (message.event === 'rejected') manifest.rejected.push({ name, ...message });
    for (const waiter of waiters.splice(0)) waiter();
  });
  for (const [streamName, stream, fd] of [['stdout', p.stdout, out], ['stderr', p.stderr, err]]) stream.on('data', data => {
    fs.writeSync(fd, data); fs.writeSync(received, JSON.stringify({ ns: process.hrtime.bigint().toString(), stream: streamName, base64: data.toString('base64') }) + '\n');
  });
  let closed = false;
  const exit = new Promise((resolve, reject) => {
    p.once('error', reject);
    p.once('close', (code, signal) => {
      closed = true; [out, err, received].forEach(fd => fs.closeSync(fd));
      fs.writeFileSync(path.join(output, name + '.exit.json'), JSON.stringify({ code, signal }, null, 2) + '\n');
      record('child:exit', { name, code, signal });
      for (const waiter of waiters.splice(0)) waiter();
      code === 0 ? resolve() : reject(Error(`${name} exited ${code}/${signal}`));
    });
  }); exit.catch(() => {});
  const c = { p, exit, async wait(event) {
    while (!messages.some(m => m.event === event)) { if (closed) throw Error(`${name} exited without ${event}`); await new Promise(resolve => waiters.push(resolve)); }
    return messages.find(m => m.event === event);
  }, go() { record('child:send', { name, command: 'go' }); p.send({ event: 'go' }); } };
  children.push(c); return c;
}
async function main() {
  await child('init').exit;
  const a = child('a', scenario.startsWith('active-') ? { expectedError: 'SHARED_LEASE_LOST' } : {});
  await a.wait(scenario === 'active-after-fsync' ? 'after-wal-fsync' : 'held');
  let ranges;
  if (scenario === 'completion-race') {
    await a.wait('renew-read-held'); await a.exit;
    ranges = [{ writer: 'a', count: 1 }];
  } else if (scenario === 'contention') {
    const busy = child('b', { name: 'b-busy', expectedError: 'SHARED_WRITE_BUSY' });
    await busy.exit; await a.wait('renewed'); a.go(); await a.exit;
    await child('b').exit;
    ranges = [{ writer: 'a', count: 1 }, { writer: 'b', count: 1 }];
  } else {
    const ownerFile = path.join(file + '.write-lock', 'owner.json');
    const previous = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    const previousStat = fs.statSync(ownerFile);
    // Explicit adversarial fixture: not a protocol-sanctioned live takeover.
    fs.renameSync(file + '.write-lock', path.join(dataRoot, 'retained-displaced-lock'));
    record('injection:live-owner-directory-displaced', { previous, inode: previousStat.ino });
    const b = child('b', { hold: true }); const next = await b.wait('held');
    const current = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    record('injection:successor-owner', { current, inode: fs.statSync(ownerFile).ino });
    assert.notEqual(previous.token, next.token); assert.ok(previous.generation < next.generation);
    a.go(); await a.exit;
    assert.equal(JSON.parse(fs.readFileSync(ownerFile, 'utf8')).token, next.token, 'stale release must preserve successor owner');
    record('assertion:successor-preserved'); b.go(); await b.exit;
    ranges = scenario === 'active-after-fsync' ? [{ writer: 'a', count: 1 }, { writer: 'b', count: 1 }] : [{ writer: 'b', count: 1 }];
    manifest.permittedUnacknowledged = scenario === 'active-after-fsync' ? ['diag-a-0'] : [];
  }
  await child('verify', { ranges }).exit;
  assert.equal(fs.existsSync(file + '.write-lock'), false);
  manifest.status = 'passed';
}
const deadline = setTimeout(() => { for (const c of children) c.p.kill('SIGKILL'); }, 90000);
main().catch(error => { manifest.status = 'failed'; manifest.error = error.stack; process.exitCode = 1; })
  .finally(async () => {
    clearTimeout(deadline);
    for (const c of children) if (c.p.exitCode === null && c.p.signalCode === null) c.p.kill('SIGKILL');
    await Promise.allSettled(children.map(c => c.exit));
    manifest.ended = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'parent.timeline.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ output, status: manifest.status, dataRoot }));
  });
