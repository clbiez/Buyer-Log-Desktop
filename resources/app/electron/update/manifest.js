'use strict';
const path = require('path');
const { parseSemver } = require('./semver');

function manifestError(message, code='UPDATE_MANIFEST_INVALID') {
  return Object.assign(new Error(message), { code });
}
function safeArtifactPath(value) {
  const text = String(value || '').replace(/\\/g, '/').trim();
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.includes('\0')) return '';
  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  return parts.join('/');
}
function parseReleaseManifest(raw, expectedChannel='') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!source) throw manifestError('Release manifest bir JSON nesnesi olmalı.');
  if (Number(source.schemaVersion) !== 1) throw manifestError('Desteklenmeyen release manifest schemaVersion.', 'UPDATE_MANIFEST_SCHEMA');
  const channel = String(source.channel || '').trim().toLowerCase();
  if (!['stable','test'].includes(channel)) throw manifestError('Release channel geçersiz.');
  if (expectedChannel && channel !== expectedChannel) throw manifestError('Release manifest yanlış kanala ait.');
  const version = String(source.version || '').trim();
  if (!parseSemver(version)) throw manifestError('Release version geçerli SemVer değil.');
  const artifact = safeArtifactPath(source.artifact);
  if (!artifact) throw manifestError('Release artifact yolu güvenli değil.');
  const sha256 = String(source.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw manifestError('Release SHA-256 geçersiz.');
  const size = Number(source.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw manifestError('Release artifact boyutu geçersiz.');
  const publishedAt = String(source.publishedAt || '').trim();
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) throw manifestError('publishedAt geçersiz.');
  const minimumUpdaterVersion = String(source.minimumUpdaterVersion || '1.0.0').trim();
  if (!parseSemver(minimumUpdaterVersion)) throw manifestError('minimumUpdaterVersion geçersiz.');
  return Object.freeze({
    schemaVersion:1, channel, version, publishedAt, artifact, sha256, size,
    mandatory:source.mandatory === true,
    releaseNotes:String(source.releaseNotes || '').slice(0, 8000),
    minimumUpdaterVersion,
  });
}
module.exports = { parseReleaseManifest, safeArtifactPath };
