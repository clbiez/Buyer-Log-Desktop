'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('INT-06 unchanged #890 preparation and SIGKILL/resume assertions against current production source', t => {
  const fixtureRoot = path.join(__dirname, 'fixtures/int06-checkpoint-journal');
  const provenance = require('./fixtures/int06-checkpoint-journal/provenance.json');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-inherited-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of provenance.files) {
    const bytes = fs.readFileSync(path.join(fixtureRoot, file.storedPath));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const appRoot = path.resolve(__dirname, '..');
  for (const dir of ['server', 'public']) fs.symlinkSync(path.join(appRoot, dir), path.join(root, 'resources/app', dir), 'dir');
  fs.symlinkSync(path.resolve(appRoot, '../../.git'), path.join(root, '.git'), 'dir');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap',
    'resources/app/tests/powerbi-checkpoint-preparation.test.js',
    'resources/app/tests/powerbi-checkpoint-resume.test.js'], { cwd: root, env, encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.error && result.error.message || result.stderr);
  assert.match(result.stdout, /# tests 17\b/);
  assert.match(result.stdout, /# fail 0\b/);
});
