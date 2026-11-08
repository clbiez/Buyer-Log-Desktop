'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const supported = process.allowedNodeEnvironmentFlags.has('--experimental-webstorage');
for (const stage of ['ack', 'quota', 'half-compaction', 'corrupt', 'missing']) test('real persistent Web Storage across processes: ' + stage,
  { skip: !supported && 'Node Web Storage unavailable; run documented Chromium storage acceptance' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pending-native-'));
    try {
      const run = action => {
        const result = spawnSync(process.execPath, ['--experimental-webstorage', '--localstorage-file=' + path.join(dir, 'storage'),
          path.join(__dirname, 'fixtures/collection-delta-pending/native-storage.cjs'), action], { encoding: 'utf8', timeout: 45000 });
        assert.equal(result.status, 0, result.stderr + result.stdout); return JSON.parse(result.stdout);
      };
      assert.equal(run('seed').value, '20');
      const result = run(stage);
      if (stage === 'ack') assert.deepEqual(result.history, ['edit']);
      else if (stage === 'quota' || stage === 'half-compaction') assert.equal(result.oldEditPreserved, true);
      else { assert.equal(result.rejected, true); assert.equal(result.basePreserved, true); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
