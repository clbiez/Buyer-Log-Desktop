'use strict';
// Normal npm test runner with isolated writable fixture roots. No test options,
// skip flags, batch selection or concurrency override for the full invocation.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const app = path.resolve(__dirname, '../../../../resources/app');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-int03-suite-'));
const env = { ...process.env };
delete env.BUYER_LOG_TEST_CONCURRENCY;
// Preserve the application's standard os.tmpdir allowance. An explicit temp
// override narrows durable writes and breaks tests with their own temp roots.
// Auth must follow each test's SERVER_DATA_ROOT instead of a shared override.
delete env.BUYER_LOG_TEMP_ROOT;
delete env.BUYER_LOG_AUTH_DATA_ROOT;
for (const [key, folder] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local' })) {
  env[key] = path.join(root, folder); fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
try {
  const filters = process.argv.slice(2);
  const result = spawnSync('npm', ['test', ...(filters.length ? ['--', ...filters] : [])], { cwd: app, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status || (result.signal ? 1 : 0);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
