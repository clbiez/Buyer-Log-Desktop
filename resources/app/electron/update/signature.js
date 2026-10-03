'use strict';
/*
 * Release manifest authenticity (Ed25519).
 *
 * SHA-256 alone proves only that the downloaded ZIP matches the manifest; the
 * manifest and the ZIP come from the same public source, so whoever can write
 * that source (release repo, raw mirror, legacy folder share) could publish any
 * code. The release pipeline therefore signs the manifest's artifact identity
 * with a private Ed25519 key that lives only in the CI secret store. Clients
 * carry only public keys (release-signing-keys.json, read from the RUNNING app,
 * never from the downloaded artifact) and verify before downloading/staging.
 *
 * Enforcement: when at least one public key is bundled, a missing or invalid
 * signature is rejected (fail-closed). With no bundled key the updater keeps the
 * legacy SHA-256-only behaviour so existing installations keep updating until
 * the maintainer provisions a key (see SELF_UPDATE_README.md).
 *
 * Signed fields exclude `channel` and `publishedAt` so TEST → STABLE promotion
 * republishes identical bytes without re-signing; every field that decides what
 * code runs (version, artifact, sha256, size, minimumUpdaterVersion) or what the
 * user is told (mandatory, releaseNotes) is covered.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SIGNATURE_SCHEMA = 'buyer-log-release-signature/v1';
const KEYS_FILE = 'release-signing-keys.json';

function signatureError(message, code) { return Object.assign(new Error(message), { code }); }

function signedPayload(manifest) {
  const m = manifest || {};
  return Buffer.from(JSON.stringify([
    SIGNATURE_SCHEMA,
    String(m.version || ''),
    String(m.artifact || ''),
    String(m.sha256 || '').toLowerCase(),
    Number(m.size),
    m.mandatory === true,
    String(m.releaseNotes || ''),
    String(m.minimumUpdaterVersion || '1.0.0'),
  ]), 'utf8');
}

function publicKeyObject(pem) {
  const key = crypto.createPublicKey(String(pem || ''));
  if (key.asymmetricKeyType !== 'ed25519') throw signatureError('Release signing key must be Ed25519.', 'UPDATE_SIGNING_KEY_INVALID');
  return key;
}

function keyIdFor(publicKey) {
  const der = (typeof publicKey === 'string' ? publicKeyObject(publicKey) : publicKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

function normalizeKeys(raw) {
  const list = raw && Array.isArray(raw.keys) ? raw.keys : [];
  return list.map(item => {
    const key = publicKeyObject(item && item.publicKey);
    const keyId = keyIdFor(key);
    if (item.keyId && String(item.keyId) !== keyId) throw signatureError('Release signing keyId does not match its public key.', 'UPDATE_SIGNING_KEY_INVALID');
    return { keyId, key };
  });
}

function loadTrustedKeys(appCoreRoot) {
  const file = path.join(appCoreRoot, 'electron', 'update', KEYS_FILE);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error && error.code === 'ENOENT') return [];
    // A present-but-unreadable key file must not silently disable verification.
    throw signatureError('Release signing key file is unreadable.', 'UPDATE_SIGNING_KEY_INVALID');
  }
  return normalizeKeys(raw);
}

function parseSignature(value) {
  if (value == null) return null;
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const keyId = source && String(source.keyId || '');
  const sig = source && String(source.value || '');
  if (!source || source.alg !== 'ed25519' || !/^[a-f0-9]{16}$/.test(keyId) || !/^[A-Za-z0-9+/]{86}==$/.test(sig)) {
    throw signatureError('Release manifest signature is malformed.', 'UPDATE_SIGNATURE_INVALID');
  }
  return Object.freeze({ alg: 'ed25519', keyId, value: sig });
}

function signManifest(manifest, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(String(privateKeyPem || ''));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw signatureError('Release signing key must be Ed25519.', 'UPDATE_SIGNING_KEY_INVALID');
  const keyId = keyIdFor(crypto.createPublicKey(privateKey));
  const value = crypto.sign(null, signedPayload(manifest), privateKey).toString('base64');
  return { alg: 'ed25519', keyId, value };
}

/*
 * Returns { verified:true, keyId } when signed by a trusted key,
 * { verified:false, enforced:false } when no key is bundled (legacy mode),
 * and throws UPDATE_SIGNATURE_MISSING / UPDATE_SIGNATURE_INVALID otherwise.
 */
function verifyManifestSignature(manifest, trustedKeys) {
  const keys = Array.isArray(trustedKeys) ? trustedKeys : [];
  if (!keys.length) return { verified: false, enforced: false };
  if (!manifest || !manifest.signature) throw signatureError('Release manifest is not signed.', 'UPDATE_SIGNATURE_MISSING');
  const signature = parseSignature(manifest.signature);
  const trusted = keys.find(item => item.keyId === signature.keyId);
  if (!trusted) throw signatureError('Release manifest is signed by an untrusted key.', 'UPDATE_SIGNATURE_INVALID');
  const ok = crypto.verify(null, signedPayload(manifest), trusted.key, Buffer.from(signature.value, 'base64'));
  if (!ok) throw signatureError('Release manifest signature verification failed.', 'UPDATE_SIGNATURE_INVALID');
  return { verified: true, enforced: true, keyId: signature.keyId };
}

module.exports = { SIGNATURE_SCHEMA, KEYS_FILE, signedPayload, keyIdFor, normalizeKeys, loadTrustedKeys, parseSignature, signManifest, verifyManifestSignature };
