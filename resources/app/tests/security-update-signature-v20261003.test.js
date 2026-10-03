'use strict';

/* Güvenlik sertleştirmesi — update zinciri authenticity (Ed25519).
 * SHA-256 tek başına yalnız "ZIP manifest ile aynı mı" sorusunu cevaplar;
 * manifest ve ZIP aynı kaynaktan geldiği için kaynağa yazabilen herkes kod
 * dağıtabilirdi. Bu test şunları korur:
 *  - doğru imza kabul, değiştirilmiş manifest / artifact / yanlış anahtar /
 *    eksik imza RED (anahtar paketlendiğinde fail-closed),
 *  - anahtar paketlenmemişken mevcut SHA-256 davranışı aynen çalışır,
 *  - güvenilen anahtarlar indirilen paketten değil ÇALIŞAN uygulamadan okunur,
 *  - CI imzalama aracı ve workflow adımı özel anahtarı yalnız secret'tan alır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseReleaseManifest } = require('../electron/update/manifest');
const { createZipFromDirectory } = require('../electron/update/zip');
const { sha256File } = require('../electron/update/crypto');
const { BuyerLogUpdater } = require('../electron/update/updater');
const signature = require('../electron/update/signature');
const signing = require('../scripts/release-signing');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-update-sig-')); }
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function core(root, version, trustedPublicPems = null) {
  const app = path.join(root, 'app');
  for (const d of ['electron/update', 'server', 'public']) fs.mkdirSync(path.join(app, d), { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'buyer-log-desktop', version, main: 'electron/launcher.js' }));
  fs.writeFileSync(path.join(app, 'electron', 'main.js'), 'module.exports=true;');
  fs.writeFileSync(path.join(app, 'server', 'server.js'), 'module.exports=true;');
  fs.writeFileSync(path.join(app, 'public', 'index.html'), '<html>Buyer Log</html>');
  if (trustedPublicPems) fs.writeFileSync(path.join(app, 'electron', 'update', signature.KEYS_FILE), JSON.stringify({ schemaVersion: 1, keys: trustedPublicPems.map(publicKey => ({ publicKey })) }));
  return app;
}
async function release(source, channel, version, appDir, { privatePem = null, mutate = null } = {}) {
  const root = path.join(source, channel), rel = `releases/BuyerLog-${version}.zip`, zip = path.join(root, rel);
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  createZipFromDirectory(appDir, zip, { rootPrefix: 'app' });
  let manifest = { schemaVersion: 1, channel, version, publishedAt: new Date().toISOString(), artifact: rel, sha256: await sha256File(zip), size: fs.statSync(zip).size, mandatory: false, releaseNotes: 'fixture', minimumUpdaterVersion: '1.0.0' };
  if (privatePem) manifest = { ...manifest, signature: signature.signManifest(manifest, privatePem) };
  if (mutate) manifest = mutate(manifest, zip);
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, zip };
}
async function check(root, bootstrap, source) {
  const u = new BuyerLogUpdater({ currentVersion: '7.0.224', appCoreRoot: bootstrap, portableRoot: path.join(root, 'portable'), localDataRoot: path.join(root, 'local'), packaged: true });
  return u.checkAndStage({ baseConfig: { releaseSource: source }, channel: 'stable' });
}

test('signature module: valid signature verifies; any signed-field change or wrong key is rejected', () => {
  const good = keyPair(), other = keyPair();
  const trusted = signature.normalizeKeys({ keys: [{ publicKey: good.publicPem }] });
  const base = parseReleaseManifest({ schemaVersion: 1, channel: 'test', version: '7.0.225', publishedAt: new Date().toISOString(), artifact: 'releases/BuyerLog-7.0.225.zip', sha256: 'a'.repeat(64), size: 10, releaseNotes: 'n', minimumUpdaterVersion: '1.0.0' }, 'test');
  const signed = parseReleaseManifest({ ...base, signature: signature.signManifest(base, good.privatePem) }, 'test');
  assert.equal(signature.verifyManifestSignature(signed, trusted).verified, true);
  // TEST → STABLE promotion changes only unsigned channel/publishedAt fields.
  const promoted = parseReleaseManifest({ ...signed, channel: 'stable', publishedAt: new Date(Date.now() + 1000).toISOString() }, 'stable');
  assert.equal(signature.verifyManifestSignature(promoted, trusted).verified, true);
  for (const patch of [{ sha256: 'b'.repeat(64) }, { size: 11 }, { version: '7.0.226', artifact: 'releases/BuyerLog-7.0.226.zip' }, { mandatory: true }, { releaseNotes: 'tampered' }, { minimumUpdaterVersion: '0.9.0' }]) {
    const tampered = parseReleaseManifest({ ...signed, ...patch }, 'test');
    assert.throws(() => signature.verifyManifestSignature(tampered, trusted), err => err.code === 'UPDATE_SIGNATURE_INVALID', JSON.stringify(patch));
  }
  const wrongKey = parseReleaseManifest({ ...base, signature: signature.signManifest(base, other.privatePem) }, 'test');
  assert.throws(() => signature.verifyManifestSignature(wrongKey, trusted), err => err.code === 'UPDATE_SIGNATURE_INVALID');
  const forgedId = parseReleaseManifest({ ...base, signature: { ...signature.signManifest(base, other.privatePem), keyId: trusted[0].keyId } }, 'test');
  assert.throws(() => signature.verifyManifestSignature(forgedId, trusted), err => err.code === 'UPDATE_SIGNATURE_INVALID');
  assert.throws(() => signature.verifyManifestSignature(base, trusted), err => err.code === 'UPDATE_SIGNATURE_MISSING');
  assert.throws(() => parseReleaseManifest({ ...base, signature: { alg: 'rsa', keyId: 'x', value: 'y' } }, 'test'), err => err.code === 'UPDATE_SIGNATURE_INVALID');
  assert.deepEqual(signature.verifyManifestSignature(base, []), { verified: false, enforced: false }, 'no bundled key → legacy SHA-only mode');
});

test('updater with bundled key accepts a correctly signed release', async t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = keyPair(), source = path.join(root, 'releases');
  const bootstrap = core(path.join(root, 'bootstrap'), '7.0.224', [keys.publicPem]);
  await release(source, 'stable', '7.0.225', core(path.join(root, 'candidate'), '7.0.225'), { privatePem: keys.privatePem });
  const r = await check(root, bootstrap, source);
  assert.equal(r.ok, true, JSON.stringify(r.lastError));
  assert.equal(r.pendingReady, true);
  assert.match(fs.readFileSync(path.join(root, 'local', 'updater', 'updater.log'), 'utf8'), /signature-ok/);
});

test('updater with bundled key rejects unsigned, tampered-manifest, wrong-key and tampered-artifact releases', async t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = keyPair(), attacker = keyPair();
  const bootstrap = core(path.join(root, 'bootstrap'), '7.0.224', [keys.publicPem]);
  const candidate = core(path.join(root, 'candidate'), '7.0.225');
  const evil = core(path.join(root, 'evil'), '7.0.225'); fs.writeFileSync(path.join(evil, 'server', 'server.js'), 'require("child_process").exec("calc")');
  const cases = [
    ['unsigned', {}, 'UPDATE_SIGNATURE_MISSING'],
    ['tampered-manifest', { privatePem: keys.privatePem, mutate: m => ({ ...m, releaseNotes: 'changed after signing' }) }, 'UPDATE_SIGNATURE_INVALID'],
    ['wrong-key', { privatePem: attacker.privatePem }, 'UPDATE_SIGNATURE_INVALID'],
  ];
  for (const [name, options, code] of cases) {
    const source = path.join(root, 'src-' + name);
    await release(source, 'stable', '7.0.225', candidate, options);
    const r = await check(path.join(root, 'run-' + name), bootstrap, source);
    assert.equal(r.ok, false, name);
    assert.equal(r.lastError.code, code, name);
    assert.equal(r.pendingReady, false, name);
    assert.equal(fs.existsSync(path.join(root, 'run-' + name, 'portable', '.buyerlog-versions', '7.0.225')), false, `${name}: nothing staged`);
  }
  // Artifact swapped after signing (manifest still validly signed for the original bytes).
  const source = path.join(root, 'src-artifact');
  await release(source, 'stable', '7.0.225', candidate, { privatePem: keys.privatePem, mutate: (m, zip) => { createZipFromDirectory(evil, zip + '.evil', { rootPrefix: 'app' }); fs.renameSync(zip + '.evil', zip); return m; } });
  const r = await check(path.join(root, 'run-artifact'), bootstrap, source);
  assert.equal(r.ok, false);
  assert.match(r.lastError.code, /UPDATE_SHA256_MISMATCH|UPDATE_SIZE_MISMATCH/);
  assert.equal(r.pendingReady, false);
});

test('trusted keys come from the running app core, never from the downloaded artifact', async t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = keyPair(), attacker = keyPair();
  const bootstrap = core(path.join(root, 'bootstrap'), '7.0.224', [keys.publicPem]);
  const candidate = core(path.join(root, 'candidate'), '7.0.225', [attacker.publicPem]);
  await release(path.join(root, 'releases'), 'stable', '7.0.225', candidate, { privatePem: attacker.privatePem });
  const r = await check(root, bootstrap, path.join(root, 'releases'));
  assert.equal(r.ok, false);
  assert.equal(r.lastError.code, 'UPDATE_SIGNATURE_INVALID');
});

test('without a bundled key the existing SHA-256-only updater still accepts valid artifacts', async t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bootstrap = core(path.join(root, 'bootstrap'), '7.0.224');
  await release(path.join(root, 'releases'), 'stable', '7.0.225', core(path.join(root, 'candidate'), '7.0.225'));
  const r = await check(root, bootstrap, path.join(root, 'releases'));
  assert.equal(r.ok, true, JSON.stringify(r.lastError));
  assert.equal(r.pendingReady, true);
  assert.match(fs.readFileSync(path.join(root, 'local', 'updater', 'updater.log'), 'utf8'), /signature-not-enforced/);
});

test('release-signing tool signs only with a trusted secret and fails closed when keys are bundled', t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = keyPair(), other = keyPair();
  const appWithKey = core(path.join(root, 'with-key'), '7.0.225', [keys.publicPem]);
  const appWithoutKey = core(path.join(root, 'without-key'), '7.0.225');
  const manifestFile = path.join(root, 'latest.test.json');
  const manifest = { schemaVersion: 1, channel: 'test', version: '7.0.225', publishedAt: new Date().toISOString(), artifact: 'releases/BuyerLog-7.0.225.zip', sha256: 'c'.repeat(64), size: 42, mandatory: false, releaseNotes: '', minimumUpdaterVersion: '1.0.0' };
  const reset = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const log = () => {};
  reset();
  assert.throws(() => signing.signFile(manifestFile, { privateKeyPem: '', appRoot: appWithKey, log }), err => err.code === 'RELEASE_SIGNING_KEY_REQUIRED');
  assert.throws(() => signing.signFile(manifestFile, { privateKeyPem: other.privatePem, appRoot: appWithKey, log }), err => err.code === 'RELEASE_SIGNING_KEY_UNTRUSTED');
  assert.equal(signing.signFile(manifestFile, { privateKeyPem: '', appRoot: appWithoutKey, log }).signed, false);
  assert.equal(signing.signFile(manifestFile, { privateKeyPem: keys.privatePem, appRoot: appWithKey, log }).signed, true);
  assert.equal(signing.verifyFile(manifestFile, { appRoot: appWithKey }).verified, true);
  const written = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.equal(JSON.stringify(written).includes('PRIVATE KEY'), false, 'private key never lands in the manifest');
});

test('repository ships public verification keys only; workflow signs from a CI secret', () => {
  const appRoot = path.join(__dirname, '..');
  const keysFile = fs.readFileSync(path.join(appRoot, 'electron', 'update', signature.KEYS_FILE), 'utf8');
  assert.doesNotMatch(keysFile, /PRIVATE KEY/);
  signature.loadTrustedKeys(appRoot); // must parse
  const workflow = fs.readFileSync(path.join(appRoot, '..', '..', '.github', 'workflows', 'buyerlog-test-release.yml'), 'utf8');
  assert.match(workflow, /BUYER_LOG_RELEASE_SIGNING_KEY: \$\{\{ secrets\.BUYER_LOG_RELEASE_SIGNING_KEY \}\}/);
  assert.ok(workflow.indexOf('release-signing.js sign') > workflow.indexOf('release:build'), 'sign after build');
  assert.ok(workflow.indexOf('release-signing.js sign') < workflow.indexOf('buyerlog-bridge-bundle'), 'sign before any distribution');
  const githubRelease = fs.readFileSync(path.join(appRoot, 'scripts', 'github-release.js'), 'utf8');
  assert.equal((githubRelease.match(/^\s+assertSignedForClients\((manifest|stable)\);/gm) || []).length, 2, 'publish-test and promote-stable verify signatures');
});
