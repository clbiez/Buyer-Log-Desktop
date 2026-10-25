'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Cheap preflight for every PR, including version-only release preparation.
// The full inventory test still verifies every dependency and artifact byte.
test('release version and exact package-lock bytes match the checked-in SBOM', () => {
  const app = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(app, 'package-lock.json'));
  const lock = JSON.parse(bytes);
  const bom = JSON.parse(fs.readFileSync(path.join(app, '../../docs/dependencies/sbom.cdx.json'), 'utf8'));
  assert.equal(lock.version, pkg.version, 'root lock version');
  assert.equal(lock.packages[''].version, pkg.version, 'application lock version');
  assert.equal(bom.metadata.component.name, pkg.name);
  assert.equal(bom.metadata.component.version, pkg.version, 'refresh SBOM with every version bump');
  const recorded = bom.metadata.properties.find(item => item.name === 'buyerlog:package-lock-sha256');
  assert.equal(recorded?.value, crypto.createHash('sha256').update(bytes).digest('hex'), 'refresh SBOM after changing package-lock.json');
});
