'use strict';

/* CoreNectum direct API credential state.
 *
 * v7 auto-auth model:
 *   - Normal desktop use gets a fresh Bearer automatically from Buyer Log's
 *     dedicated CoreNectum Electron session. The raw token is transferred to
 *     the backend over a loopback-only, per-process secret bridge and is kept
 *     only in backend RAM.
 *   - No Bearer is shown to the user or written to Buyer Log settings/logs.
 *   - The dedicated Chromium auth partition may persist its own normal SSO
 *     cookies/storage so the corporate sign-in can refresh silently later.
 *   - Environment token and the old per-user in-memory setter remain as
 *     compatibility fallbacks; the UI no longer asks users to paste a token.
 */

const tokens = new Map();
let desktopToken = '';
let desktopTokenUpdatedAt = 0;

function clean(value, max = 20000) {
  return String(value == null ? '' : value).replace(/[\u0000\r\n]/g, '').trim().slice(0, max);
}
function userKey(value) {
  return clean(value, 160).replace(/[^A-Za-z0-9._-]/g, '_') || 'moderator';
}
function normalizeToken(value) {
  let text = clean(value, 20000);
  if (/^bearer\s+/i.test(text)) text = text.replace(/^bearer\s+/i, '').trim();
  return text;
}
function environmentToken() {
  return normalizeToken(process.env.BUYER_LOG_CORENECTUM_BEARER_TOKEN);
}
function getToken(userId) {
  return environmentToken() || desktopToken || tokens.get(userKey(userId)) || '';
}
function sourceFor(userId) {
  if (environmentToken()) return 'environment';
  if (desktopToken) return 'desktop-sso';
  if (tokens.get(userKey(userId))) return 'session-memory';
  return 'none';
}
function publicSettings(userId) {
  const source = sourceFor(userId);
  return {
    configured: source !== 'none',
    source,
    mode: source === 'desktop-sso' ? 'direct-api-auto-auth' : 'direct-bearer',
    persistence: source === 'environment' ? 'environment' : source === 'desktop-sso' ? 'persistent-browser-session' : 'session-memory',
    automatic: source === 'desktop-sso',
    updatedAt: source === 'desktop-sso' && desktopTokenUpdatedAt ? new Date(desktopTokenUpdatedAt).toISOString() : '',
  };
}
function assertToken(normalized) {
  if (!normalized || normalized.length < 20) {
    const error = new Error('Geçerli bir CoreNectum Bearer token alınamadı.');
    error.code = 'CORENECTUM_API_TOKEN_INVALID_FORMAT'; error.statusCode = 400; throw error;
  }
  return normalized;
}
function saveToken(userId, token) {
  const normalized = assertToken(normalizeToken(token));
  tokens.set(userKey(userId), normalized);
  return publicSettings(userId);
}
function clearToken(userId) {
  tokens.delete(userKey(userId));
  return publicSettings(userId);
}
function setDesktopToken(token) {
  desktopToken = assertToken(normalizeToken(token));
  desktopTokenUpdatedAt = Date.now();
  return publicSettings('desktop');
}
function clearDesktopToken() {
  desktopToken = '';
  desktopTokenUpdatedAt = 0;
  return publicSettings('desktop');
}
function hasDesktopToken() { return Boolean(desktopToken); }

module.exports = {
  normalizeToken, getToken, publicSettings, saveToken, clearToken,
  setDesktopToken, clearDesktopToken, hasDesktopToken,
};
