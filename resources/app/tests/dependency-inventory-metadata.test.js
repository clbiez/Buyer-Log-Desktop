'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

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

test('Windows-style Git checkout preserves the inventoried Cesium XML bytes', t => {
  const repo = path.resolve(__dirname, '../../..');
  const relative = 'resources/app/public/vendor/cesium/Assets/Textures/NaturalEarthII/tilemapresource.xml';
  const source = fs.readFileSync(path.join(repo, relative));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-inventory-checkout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(repo, '.gitattributes'), path.join(root, '.gitattributes'));
  fs.writeFileSync(destination, source);
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', '-c', 'core.safecrlf=false', ...args], { cwd: root, stdio: 'pipe' });
  git(['init']);
  git(['add', '--', '.gitattributes', relative]);
  fs.unlinkSync(destination);
  git(['checkout-index', '--force', '--all']);
  assert.deepEqual(fs.readFileSync(destination), source, 'checkout must not change the bytes hashed by the SBOM');
});
