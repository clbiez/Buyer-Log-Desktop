'use strict';

/*
 * LCW AI kimlik katmanı — token YALNIZ süreç belleğinde yaşar.
 *
 *   Tarayıcı (CDP, mevcut kurumsal Edge profili)  = kimlik/oturum kaynağı
 *   Bu modül                                      = kısa ömürlü bellek önbelleği
 *   lcwai-client.js                               = gerçek HTTP istekleri
 *
 * Kurallar:
 *  - Token diske, config'e, veritabanına, log'a yazılmaz; renderer'a dönmez.
 *    status() token taşımaz; yalnız durum/bitiş zamanı döner.
 *  - Refresh token okunmaz ve saklanmaz; Keycloak'a istek atılmaz. Yenileme,
 *    LCW AI web uygulamasının kendi oturum mekanizmasıyla tarayıcıda olur ve
 *    buradan yalnız yeni access token okunur.
 *  - Okunan token kullanılmadan önce iddiaları doğrulanır: doğru Keycloak
 *    realm'i (iss), doğru istemci (azp/aud = lcwai-prod) ve süresi (exp).
 *    Böylece yanlış sekme/profilden gelen bir token asla kullanılmaz.
 *  - Önbellek Buyer Log kullanıcısı başınadır; bir kullanıcının LCW AI
 *    oturumu diğerine hizmet etmez.
 */
const crypto = require('crypto');
const config = require('./lcwai-config');
const { lcwAiError, isLcwAiError } = require('./lcwai-errors');

const TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

function clean(value) { return String(value == null ? '' : value).trim(); }
function ownerKey(ownerId) { return clean(ownerId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default'; }
function fingerprint(token) { return token ? crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12) : ''; }
function stripBearer(value) { return clean(value).replace(/^bearer\s+/i, '').trim(); }

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch (_) { return null; }
}

/* İmza doğrulaması LCW AI arka ucunun işidir. Buradaki kontrol "bu token
   gerçekten LCW AI istemcisinin, süresi geçerli bir access token'ı mı?"
   sorusunu cevaplar; sonuç token İÇERMEZ. */
function validateAccessToken(value, { now = Date.now(), skewMs = config.TIMEOUTS.tokenSkewMs } = {}) {
  const token = stripBearer(value);
  if (!token) return { ok: false, reason: 'missing' };
  if (token.length < 40 || token.length > 16384 || !TOKEN_RE.test(token)) return { ok: false, reason: 'format' };
  const claims = decodeJwtPayload(token);
  if (!claims) return { ok: false, reason: 'format' };
  const issuer = clean(claims.iss).replace(/\/+$/, '');
  if (issuer !== config.KEYCLOAK.issuer) return { ok: false, reason: 'issuer' };
  const audience = Array.isArray(claims.aud) ? claims.aud.map(clean) : [clean(claims.aud)];
  if (clean(claims.azp) !== config.KEYCLOAK.clientId && !audience.includes(config.KEYCLOAK.clientId)) return { ok: false, reason: 'client' };
  if (claims.typ && !/^bearer$/i.test(clean(claims.typ))) return { ok: false, reason: 'type' };
  const expiresAtMs = Number(claims.exp) * 1000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return { ok: false, reason: 'format' };
  if (expiresAtMs <= now + skewMs) return { ok: false, reason: 'expired', expiresAtMs };
  return { ok: true, reason: '', expiresAtMs, fingerprint: fingerprint(token) };
}

function createLcwAiAuth(options = {}) {
  const provider = options.provider || null;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const secrets = new Map();   // ownerKey -> token (YALNIZ burada)
  const meta = new Map();      // ownerKey -> { expiresAtMs, fingerprint, source, connectedAt, hadSession, rejected }
  const refreshInFlight = new Map();
  const logins = new Map();    // ownerKey -> { promise, phase, startedAt }

  function validate(token) { return validateAccessToken(token, { now: now() }); }
  function store(key, token, source) {
    const check = validate(token);
    if (!check.ok) return check;
    secrets.set(key, stripBearer(token));
    meta.set(key, { expiresAtMs: check.expiresAtMs, fingerprint: check.fingerprint, source: clean(source) || 'browser', connectedAt: new Date(now()).toISOString(), hadSession: true, rejected: false });
    return check;
  }
  function cached(key) {
    const token = secrets.get(key), info = meta.get(key);
    if (!token || !info || info.rejected) return '';
    return info.expiresAtMs > now() + config.TIMEOUTS.tokenSkewMs ? token : '';
  }
  function providerFailure(error, hadSession) {
    if (isLcwAiError(error)) {
      if (error.shortCode === 'AUTH_REQUIRED' && hadSession) return lcwAiError('SESSION_EXPIRED');
      return error;
    }
    return lcwAiError(hadSession ? 'SESSION_EXPIRED' : 'BROWSER_UNAVAILABLE', { detail: error && (error.code || error.message) });
  }

  /* Geçerli Authorization değeri. Önbellek geçerliyse tarayıcıya hiç
     gidilmez. Değilse açık LCW AI sekmesinden SESSİZCE yeni token okunur
     (Edge başlatılmaz, kullanıcıdan giriş istenmez). `rejected` 401 almış
     token'ın parmak izidir: aynı token ikinci kez kullanılmaz. */
  async function getAuthorization(ownerId, { forceRefresh = false, rejectedFingerprint = '' } = {}) {
    const key = ownerKey(ownerId);
    if (!forceRefresh) {
      const token = cached(key);
      if (token) return `Bearer ${token}`;
    }
    const pending = refreshInFlight.get(key);
    if (pending) return pending;
    const request = (async () => {
      const info = meta.get(key);
      const hadSession = Boolean(info && info.hadSession);
      if (!provider || typeof provider.readToken !== 'function') throw lcwAiError(hadSession ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED');
      let result;
      try {
        result = await provider.readToken(ownerId, {
          avoidFingerprint: rejectedFingerprint || (forceRefresh && info ? info.fingerprint : ''),
          isUsable: token => { const check = validate(token); return check.ok && check.fingerprint !== rejectedFingerprint; },
          fingerprint,
        });
      } catch (error) { throw providerFailure(error, hadSession); }
      const token = stripBearer(result && result.token);
      const check = validate(token);
      if (!check.ok || (rejectedFingerprint && check.fingerprint === rejectedFingerprint)) {
        if (info) meta.set(key, { ...info, rejected: true });
        throw lcwAiError(hadSession || check.reason === 'expired' ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED');
      }
      store(key, token, result && result.source);
      return `Bearer ${token}`;
    })().finally(() => { if (refreshInFlight.get(key) === request) refreshInFlight.delete(key); });
    refreshInFlight.set(key, request);
    return request;
  }

  /* 401 alan token'ı geçersiz işaretler; sonraki çağrı yeni token arar. */
  function invalidate(ownerId, authorization = '') {
    const key = ownerKey(ownerId), info = meta.get(key);
    const rejected = authorization ? fingerprint(stripBearer(authorization)) : (info ? info.fingerprint : '');
    if (info && (!rejected || info.fingerprint === rejected)) {
      meta.set(key, { ...info, rejected: true });
      secrets.delete(key);
    }
    return rejected;
  }

  /* Etkileşimli giriş: tarayıcıda LCW AI açılır, kullanıcı kurumsal
     kimliğiyle NORMAL şekilde giriş yapar. Buyer Log parola alanlarını
     okumaz/doldurmaz. Aynı kullanıcı için tek giriş akışı yürür. */
  function login(ownerId) {
    const key = ownerKey(ownerId);
    const running = logins.get(key);
    if (running) return running.promise;
    if (!provider || typeof provider.login !== 'function') return Promise.reject(lcwAiError('BROWSER_UNAVAILABLE'));
    const entry = { phase: 'opening', startedAt: new Date(now()).toISOString(), promise: null };
    entry.promise = (async () => {
      let result;
      try {
        result = await provider.login(ownerId, {
          onPhase: phase => { entry.phase = clean(phase) || entry.phase; },
          isUsable: token => validate(token).ok,
          timeoutMs: config.TIMEOUTS.loginMs,
        });
      } catch (error) {
        throw isLcwAiError(error) ? error : lcwAiError('BROWSER_UNAVAILABLE', { detail: error && (error.code || error.message) });
      }
      const check = store(key, result && result.token, result && result.source);
      if (!check.ok) throw lcwAiError(check.reason === 'expired' ? 'SESSION_EXPIRED' : 'LOGIN_TIMEOUT');
      return status(ownerId);
    })().finally(() => { if (logins.get(key) === entry) logins.delete(key); });
    logins.set(key, entry);
    return entry.promise;
  }

  function disconnect(ownerId) {
    const key = ownerKey(ownerId);
    secrets.delete(key);
    meta.delete(key);
    return status(ownerId);
  }

  /* Yalnız durum: token, parmak izi veya iddia içeriği DÖNMEZ. */
  function status(ownerId) {
    const key = ownerKey(ownerId), info = meta.get(key), loginEntry = logins.get(key);
    const valid = Boolean(cached(key));
    const state = loginEntry ? 'connecting' : valid ? 'connected' : info && info.hadSession ? 'expired' : 'disconnected';
    return {
      state,
      connected: valid,
      expiresAt: valid && info ? new Date(info.expiresAtMs).toISOString() : null,
      source: info ? info.source : '',
      loginInProgress: Boolean(loginEntry),
      phase: loginEntry ? loginEntry.phase : '',
      model: config.DEFAULT_MODEL,
      modelLabel: config.modelInfo(config.DEFAULT_MODEL).label,
    };
  }

  /* Durum sorgusu için: oturum bu süreçte açılmışsa ve token süresi dolduysa
     sekmeden sessizce yenisini okumayı dener (tarayıcı başlatmaz). */
  async function refreshStatus(ownerId) {
    const key = ownerKey(ownerId), info = meta.get(key);
    if (!cached(key) && info && info.hadSession && !logins.has(key)) {
      try { await getAuthorization(ownerId); } catch (_) { /* durum "expired" kalır */ }
    }
    return status(ownerId);
  }

  return { getAuthorization, invalidate, login, disconnect, status, refreshStatus, validate };
}

module.exports = { createLcwAiAuth, validateAccessToken, decodeJwtPayload, fingerprint, stripBearer, ownerKey };
