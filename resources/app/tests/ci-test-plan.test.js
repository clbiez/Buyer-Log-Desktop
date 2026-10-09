'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPaths } = require('../scripts/ci-test-plan');

test('CI skips installs only for pure documentation and release requests', () => {
  assert.equal(classifyPaths(['CLAUDE.md', '.github/release-requests/stable.json']), 'metadata');
  assert.equal(classifyPaths(['docs/ci.md', 'AGENTS.md']), 'metadata');
});

test('CI focuses CSS-only UI diffs and never skips logic changes', () => {
  assert.equal(classifyPaths(['resources/app/public/design.css', 'CLAUDE.md']), 'ui');
  assert.equal(classifyPaths(['resources/app/public/app-main.js']), 'full');
  assert.equal(classifyPaths(['resources/app/server/server.js']), 'full');
  assert.equal(classifyPaths(['resources/app/tests/ci-test-plan.test.js']), 'full');
  assert.equal(classifyPaths(['.github/workflows/buyerlog-tests.yml']), 'full');
  assert.equal(classifyPaths([]), 'full');
});
