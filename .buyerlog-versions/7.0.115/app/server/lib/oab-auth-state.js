'use strict';

const crypto = require('crypto');

let state = null;
const pendingControllers = new Set();

function clean(value) { return String(value == null ? '' : value).replace(/[\u0000\r\n]/g, '').trim(); }
function normalizeAuthorization(value) {
  const text = clean(value);
  if (!text) return '';
  if (!/^Bearer\s+/i.test(text)) return '';
  const token = text.replace(/^Bearer\s+/i, '').trim();
  if (token.length < 20 || /\s/.test(token)) return '';
  return 'Bearer ' + token;
}
function jwtExpiryMs(authorization) {
  const token = clean(authorization).replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Number.isFinite(Number(payload.exp)) ? Number(payload.exp) * 1000 : 0;
  } catch (_) { return 0; }
}
function tokenFingerprint(authorization) {
  return crypto.createHash('sha256').update(String(authorization || '')).digest('hex').slice(0, 12);
}
function setAuthorization(value) {
  const authorization = normalizeAuthorization(value);
  if (!authorization) {
    const error = new Error('OAB yetkilendirme bilgisi geçersiz.');
    error.code = 'OAB_AUTH_INVALID'; error.statusCode = 400; throw error;
  }
  const expiresAtMs = jwtExpiryMs(authorization);
  state = {
    authorization,
    capturedAt: new Date().toISOString(),
    expiresAtMs,
    fingerprint: tokenFingerprint(authorization),
  };
  return status();
}
function clear(options = {}) {
  state = null;
  if (options.abortPending !== false) {
    for (const controller of pendingControllers) {
      try { controller.abort(); } catch (_) {}
    }
    pendingControllers.clear();
  }
  return status();
}
function usable() {
  if (!state || !state.authorization) return null;
  if (state.expiresAtMs && state.expiresAtMs <= Date.now() + 30000) { clear(); return null; }
  return state;
}
function requireAuthorization() {
  const current = usable();
  if (!current) {
    const error = new Error('OAB oturumu gerekli.');
    error.code = 'OAB_AUTH_REQUIRED'; error.statusCode = 401; throw error;
  }
  return current.authorization;
}
function status() {
  const current = usable();
  return { authenticated: Boolean(current) };
}
function registerController(controller) { if (controller) pendingControllers.add(controller); }
function unregisterController(controller) { if (controller) pendingControllers.delete(controller); }

module.exports = { setAuthorization, clear, requireAuthorization, status, registerController, unregisterController, normalizeAuthorization };
