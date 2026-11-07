'use strict';
// Her A/B kolu yeni Node ve Chromium süreçlerinde; koşular eşzamanlı çalışmaz.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const app = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const baseline = path.resolve(arg('--baseline-dir', '')), candidate = path.resolve(arg('--candidate-dir', ''));
const destination = path.resolve(arg('--output', ''));
const suite = arg('--suite', 'both'), onlyModule = arg('--module', '');
assert.ok(process.argv.includes('--baseline-dir') && process.argv.includes('--candidate-dir') && process.argv.includes('--output'));
assert.ok(['both', 'card', 'int'].includes(suite));
const lock = path.join(os.tmpdir(), 'buyerlog-client-paired-benchmark.lock');
const lockFd = fs.openSync(lock, 'wx');
fs.writeFileSync(lockFd, String(process.pid)); fs.closeSync(lockFd);
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = args => { const result = spawnSync('git', args, { cwd: app, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
try {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination); // Mevcut kanıtın üzerine yazılmaz.
  const modules = ['license-cards.js', 'manufacturers.js', 'email-groups.js', 'lcwai-chat.js'];
  const shared = ['license-cards-engine.js', 'manufacturer-cards-engine.js', 'business-rules.js', 'lcwai-markdown.js'];
  const manifest = {
    protocol: 'Three independent pairs: A/B, B/A, A/B. Each arm launches a fresh Chromium process. Click/frame observations are nested samples, not independent runs.',
    startedAt: new Date().toISOString(), driverPid: process.pid,
    head: git(['rev-parse', 'HEAD']), node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemory: os.totalmem(),
    fixture: { cards: [500, 5000], selectionObservations: 10, searchObservations: 10, saveObservations: 5, aiHistoryMessages: 100, aiPaintObservations: 40 },
    variants: Object.fromEntries([['A', baseline], ['B', candidate]].map(([name, dir]) => [name, { dir, sourceHashes: Object.fromEntries(modules.filter(file => fs.existsSync(path.join(dir, file))).map(file => [file, digest(path.join(dir, file))])) }])),
    sharedHashes: Object.fromEntries(shared.map(file => [file, digest(path.join(app, 'public', file))])),
    runs: [],
  };
  const save = () => fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  for (const target of suite === 'both' ? ['card', 'int'] : [suite]) for (const [index, order] of ['AB', 'BA', 'AB'].entries()) for (const variant of order) {
      const directory = variant === 'A' ? baseline : candidate;
      const name = `pair-${index + 1}-${variant}-${target}`;
      const args = target === 'card' ? [path.join(__dirname, 'card-render-acceptance.js'), '--source-dir', directory]
        : [path.join(__dirname, 'lcwai-stream-render-acceptance.js'), '--source', path.join(directory, 'lcwai-chat.js')];
      if (target === 'card' && onlyModule) args.push('--module', onlyModule);
      if (variant === 'B') args.push('--assert-optimized');
      const startedAt = new Date().toISOString();
      console.error(`${startedAt} START ${name}`);
      const output = fs.openSync(path.join(destination, name + '.json'), 'wx');
      const errors = fs.openSync(path.join(destination, name + '.stderr.txt'), 'wx');
      const result = spawnSync(process.execPath, args, { cwd: app, env: process.env, stdio: ['ignore', output, errors] });
      fs.closeSync(output); fs.closeSync(errors);
      assert.equal(result.status, 0, `${name} failed; inspect its stderr`);
      const data = JSON.parse(fs.readFileSync(path.join(destination, name + '.json'), 'utf8'));
      manifest.runs.push({ pair: index + 1, order, variant, target, processId: data.processId, startedAt, finishedAt: new Date().toISOString(), file: name + '.json', sha256: digest(path.join(destination, name + '.json')) });
      save(); console.error(`${new Date().toISOString()} DONE ${name} pid=${data.processId}`);
  }
  assert.equal(new Set(manifest.runs.map(run => run.processId)).size, manifest.runs.length);
  for (const target of suite === 'both' ? ['card', 'int'] : [suite]) for (let pair = 1; pair <= 3; pair++) {
    const data = variant => JSON.parse(fs.readFileSync(path.join(destination, manifest.runs.find(run => run.target === target && run.pair === pair && run.variant === variant).file), 'utf8'));
    const a = data('A'), b = data('B');
    assert.equal(a.chromium, b.chromium);
    if (target === 'card') for (const row of a.results) {
      const matched = b.results.find(other => other.module === row.module && other.count === row.count);
      assert.ok(matched); assert.equal(matched.requestSha256, row.requestSha256);
    }
  }
  manifest.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ output: destination, independentRuns: manifest.runs.length, pairsPerTarget: 3 }));
} finally { fs.unlinkSync(lock); }
