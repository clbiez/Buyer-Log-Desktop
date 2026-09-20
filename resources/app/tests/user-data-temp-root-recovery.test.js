'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('temporary server data roots keep durable recovery records inside the temporary root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-user-data-recovery-'));
  try {
    const serverRoot = path.join(root, 'server');
    const profileRoot = path.join(root, 'profile');
    const script = [
      `const path = require(${JSON.stringify('node:path')});`,
      `const { atomicWriteJson } = require(${JSON.stringify(path.join(ROOT, 'server', 'user-data.js'))});`,
      'atomicWriteJson(path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, "probe.json"), { ok: true });',
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      env: {
        ...process.env,
        BUYER_LOG_SERVER_DATA_ROOT: serverRoot,
        BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
        BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
        LOCALAPPDATA: profileRoot,
        APPDATA: profileRoot,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(serverRoot, '.buyerlog-write-recovery')), true);
    assert.equal(fs.existsSync(path.join(profileRoot, 'BuyerLog', 'write-recovery')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
