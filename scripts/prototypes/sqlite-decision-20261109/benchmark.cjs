'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { oracle } = require('./oracle.cjs');
const worker = path.join(__dirname, 'worker.cjs');
const root = path.resolve(__dirname, '../../..');

function child(args, killAt) {
  return new Promise((resolve, reject) => {
    const p = fork(worker, [JSON.stringify(args)], { execArgv: ['--expose-gc'], silent: true });
    let result, stderr = '', stdout = '', killed = false;
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(Error(`Worker timeout: ${JSON.stringify(args)}`)); }, 20 * 60 * 1000);
    p.stderr.on('data', b => { stderr += b; });
    p.stdout.on('data', b => { stdout += b; process.stderr.write(b); });
    p.on('message', msg => {
      if (msg.progress) console.log(msg.progress);
      if (msg.result) result = msg.result;
      if (msg.barrier === 'acknowledged' && killAt !== 'acknowledged') p.send('continue');
      if (msg.barrier && (msg.barrier === killAt || killAt === 'inflight' && msg.barrier.startsWith('inflight') ||
          killAt === 'compacting' && msg.barrier.startsWith('compacting'))) { killed = true; p.kill('SIGKILL'); }
    });
    p.on('error', error => { clearTimeout(timer); reject(error); });
    p.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (killed && signal === 'SIGKILL') resolve({ killed: true, signal, stdout, stderr });
      else if (code !== 0 || !result) reject(Error(`Worker failed ${code}/${signal}: ${stderr}`));
      else resolve({ ...result, stdout, stderr });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const out = path.resolve(value('--out', 'docs/performance/local-db-sqlite-2026-11-07'));
  const sizes = value('--sizes', '10000,200000').split(',').map(Number);
  const rounds = Number(value('--rounds', '3'));
  const operations = Number(value('--operations', '300'));
  assert(sizes.every(n => Number.isSafeInteger(n) && n >= 1000));
  assert(Number.isInteger(rounds) && rounds >= 3);
  assert(Number.isInteger(operations) && operations >= 10 && operations % 10 === 0);
  // Refuse an existing output directory; never clean arbitrary caller paths.
  await fsp.mkdir(out, { recursive: false });
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-db-benchmark-'));
  const result = {
    schema: 1, startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(['resources/app/server/lib/local-db.js', 'resources/app/server/lib/large-json.js',
      ...['adapters.cjs', 'workload.cjs', 'worker.cjs', 'benchmark.cjs'].map(f => `scripts/prototypes/sqlite-decision-20261109/${f}`)]
      .map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')])),
    environment: { versions: process.versions, platform: process.platform, arch: process.arch, release: os.release(),
      cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(),
      filesystem: execFileSync('stat', ['-f', '-c', '%T', scratch], { encoding: 'utf8' }).trim(),
      cgroupMemoryMax: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(),
      cgroupCpuMax: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() },
    config: { sizes, rounds, operations, seedBatch: 10000, uploadedFraction: .8,
      localWal: 'production defaults: 1 MiB / 2000 entries', sqlite: 'WAL, FULL, 8 MiB cache, autocheckpoint 256 pages',
      cache: 'warm OS page cache; no cache dropping; fresh process and private file copy per trial' }, seeds: [], trials: [], crashes: [],
  };
  const save = () => fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify(result, null, 2) + '\n');
  save();
  try {
    for (const size of sizes) {
      const fixtures = {};
      for (const engine of ['local', 'sqlite']) {
        const folder = path.join(scratch, `seed-${engine}-${size}`); await fsp.mkdir(folder);
        fixtures[engine] = folder;
        const data = await child({ mode: 'seed', engine, folder, size });
        assert.equal(data.digest, oracle(size, 0), 'Independent seed oracle');
        result.seeds.push({ engine, size, ...data }); save();
      }
      const seeds = result.seeds.filter(s => s.size === size);
      assert.equal(seeds[0].digest, seeds[1].digest, 'Seed business values differ');
      assert.deepEqual(seeds[0].counts, seeds[1].counts, 'Seed counts differ');
      for (let round = 1; round <= rounds; round++) {
        const order = round % 2 ? ['local', 'sqlite'] : ['sqlite', 'local'];
        for (const engine of order) {
          const folder = path.join(scratch, `trial-${engine}`);
          await fsp.cp(fixtures[engine], folder, { recursive: true });
          console.log(`measure ${size} round ${round}/${rounds} ${engine}`);
          const startedAt = new Date().toISOString();
          const data = await child({ mode: 'measure', engine, folder, size, operations });
          assert.equal(data.finalDigest, oracle(size, 630), 'Independent final oracle');
          const reopened = await child({ mode: 'verify', engine, folder, size });
          assert.equal(reopened.digest, data.finalDigest, 'Post-compaction reopen changed business data');
          assert.equal(reopened.eventIds, data.eventIds, 'Post-compaction event identity loss');
          assert.equal(reopened.pending, data.pending);
          result.trials.push({ engine, size, round, order, startedAt, ...data, reopened }); save();
          await fsp.rm(folder, { recursive: true });
        }
        const pair = result.trials.filter(t => t.size === size && t.round === round);
        for (const key of ['finalDigest', 'eventIds', 'pending', 'checksum', 'addedEvents']) assert.equal(pair[0][key], pair[1][key], key);
        assert.deepEqual(pair[0].countsAfter, pair[1].countsAfter);
      }
      for (const engine of ['local', 'sqlite']) {
        for (const scenario of ['acknowledged', 'inflight', 'compacting']) {
          const folder = path.join(scratch, 'crash'); await fsp.cp(fixtures[engine], folder, { recursive: true });
          const killed = await child({ mode: scenario === 'compacting' ? 'crash-compact' : 'crash-write', engine, folder, size }, scenario);
          const recovered = await child({ mode: 'verify', engine, folder, size });
          if (scenario !== 'compacting') assert(recovered.ackRetained.every(Boolean), 'Acknowledged write lost');
          else assert.equal(recovered.digest, seeds.find(s => s.engine === engine).digest, 'Compaction crash changed data');
          if (engine === 'sqlite') assert.equal(recovered.integrity, 'ok');
          result.crashes.push({ engine, size, scenario, ...killed, ...recovered }); save();
          await fsp.rm(folder, { recursive: true });
        }
        await fsp.rm(fixtures[engine], { recursive: true });
      }
    }
    result.completedAt = new Date().toISOString(); result.validation = 'subset-passed'; save();
    console.log(`PASS ${result.trials.length} measured trials; ${result.crashes.length} SIGKILL probes; ${out}`);
  } catch (error) { result.validation='failed'; result.error=error.stack; save(); throw error; }
  finally { await fsp.rm(scratch, { recursive: true, force: true }); }
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { child };
