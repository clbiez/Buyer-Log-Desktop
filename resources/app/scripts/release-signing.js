'use strict';
/*
 * Release manifest signing (CI / maintainer tool).
 *
 *   node scripts/release-signing.js keygen <out-dir>
 *       Creates an Ed25519 key pair OUTSIDE the repository. Store the private
 *       PEM as the GitHub Actions secret BUYER_LOG_RELEASE_SIGNING_KEY and
 *       commit the printed public-key entry to
 *       electron/update/release-signing-keys.json. Never commit the private key.
 *
 *   node scripts/release-signing.js sign <manifest.json>
 *       Signs in place with BUYER_LOG_RELEASE_SIGNING_KEY. When the app bundles
 *       trusted keys the secret is mandatory and must match one of them, so an
 *       unsigned or wrongly signed release can never reach clients that enforce.
 *
 *   node scripts/release-signing.js verify <manifest.json>
 *       Verifies against the bundled trusted keys (no-op when none bundled).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseReleaseManifest } = require('../electron/update/manifest');
const { loadTrustedKeys, signManifest, verifyManifestSignature, keyIdFor, KEYS_FILE } = require('../electron/update/signature');

const APP_ROOT = path.resolve(__dirname, '..');

function fail(message, code = 'RELEASE_SIGNING_FAILED') { throw Object.assign(new Error(message), { code }); }
function readManifest(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { raw, manifest: parseReleaseManifest(raw, String(raw && raw.channel || '')) };
}
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function signFile(file, { privateKeyPem = process.env.BUYER_LOG_RELEASE_SIGNING_KEY, appRoot = APP_ROOT, log = console.log } = {}) {
  const trusted = loadTrustedKeys(appRoot);
  const pem = String(privateKeyPem || '').trim();
  if (!pem) {
    if (trusted.length) fail(`BUYER_LOG_RELEASE_SIGNING_KEY secret is required: ${KEYS_FILE} bundles trusted keys and clients reject unsigned releases.`, 'RELEASE_SIGNING_KEY_REQUIRED');
    log('[release-signing] No signing key configured and no trusted keys bundled; manifest left unsigned (legacy SHA-256-only mode).');
    return { signed: false };
  }
  const { raw, manifest } = readManifest(file);
  const signature = signManifest(manifest, pem);
  if (trusted.length && !trusted.some(item => item.keyId === signature.keyId)) {
    fail(`Signing key ${signature.keyId} is not listed in ${KEYS_FILE}.`, 'RELEASE_SIGNING_KEY_UNTRUSTED');
  }
  const next = { ...raw, signature };
  verifyManifestSignature(parseReleaseManifest(next, manifest.channel), trusted.length ? trusted : [{ keyId: signature.keyId, key: crypto.createPublicKey(crypto.createPrivateKey(pem)) }]);
  writeJson(file, next);
  log(`[release-signing] Signed ${path.basename(file)} with key ${signature.keyId}.`);
  return { signed: true, keyId: signature.keyId };
}

function verifyFile(file, { appRoot = APP_ROOT } = {}) {
  const { manifest } = readManifest(file);
  return verifyManifestSignature(manifest, loadTrustedKeys(appRoot));
}

function keygen(outDir) {
  if (!outDir) fail('Usage: release-signing.js keygen <out-dir>', 'RELEASE_ARG_INVALID');
  const dir = path.resolve(outDir);
  const rel = path.relative(path.resolve(APP_ROOT, '..', '..'), dir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) fail('Generate signing keys outside the repository checkout.', 'RELEASE_SIGNING_KEY_LOCATION');
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = keyIdFor(publicKey);
  fs.writeFileSync(path.join(dir, `buyerlog-release-${keyId}.private.pem`), privatePem, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(dir, `buyerlog-release-${keyId}.public.pem`), publicPem, { flag: 'wx' });
  console.log(JSON.stringify({ keyId, publicKey: publicPem }, null, 2));
  return { keyId };
}

function main() {
  const [action, arg, ...rest] = process.argv.slice(2);
  if (rest.length) fail('Too many arguments.', 'RELEASE_ARG_INVALID');
  if (action === 'keygen') return keygen(arg);
  if (action === 'sign' && arg) return signFile(path.resolve(arg));
  if (action === 'verify' && arg) {
    const result = verifyFile(path.resolve(arg));
    console.log(result.verified ? `[release-signing] Signature OK (${result.keyId}).` : '[release-signing] No trusted keys bundled; signature not enforced.');
    return result;
  }
  fail('Usage: release-signing.js keygen <out-dir> | sign <manifest.json> | verify <manifest.json>', 'RELEASE_ARG_INVALID');
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(`[${error.code || 'RELEASE_SIGNING_FAILED'}] ${error.message}`); process.exitCode = 1; }
}
module.exports = { signFile, verifyFile, keygen };
