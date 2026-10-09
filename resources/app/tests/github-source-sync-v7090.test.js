'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sync = require('../scripts/github-source-sync');

const ROOT = path.join(__dirname, '..', '..', '..');

test('GitHub source sync blocks personal/runtime data but keeps application source', () => {
  for (const file of [
    'config.json', 'data/local/BuyerLogLocal.db', 'resources/app/server/data/logs/server.log',
    'resources/app/node_modules/x/index.js', 'resources/app/dist-updates/BuyerLog.zip', '.env',
  ]) assert.equal(sync.isForbiddenPath(file), true, file);
  for (const file of [
    'resources/app/server/server.js', 'resources/app/public/index.html',
    'resources/app/config.example.json', '.github/workflows/buyerlog-tests.yml',
  ]) assert.equal(sync.isForbiddenPath(file), false, file);
});

test('every semantic update maps to one immutable version branch', () => {
  assert.equal(sync.versionBranch('7.0.90'), 'updates/v7.0.90');
  assert.throws(() => sync.versionBranch('7.90'));
});

test('main pushes are recorded by the GitHub workflow with contents write permission', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'buyerlog-version-branch.yml'), 'utf8');
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /updates\/v\$\{VERSION\}/);
  assert.match(workflow, /already (immutably )?records/);
  assert.doesNotMatch(workflow, /--force|-f\s+origin/);
});

test('package exposes explicit safe GitHub sync commands', () => {
  const pkg = require('../package.json');
  assert.match(pkg.scripts['github:sync'], /github-source-sync/);
  assert.match(pkg.scripts['github:sync:patch'], /--bump patch/);
});
