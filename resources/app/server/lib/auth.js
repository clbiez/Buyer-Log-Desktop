'use strict';

/*
 * Oturum tabanlı kimlik doğrulama — bağımlılıksız (yalnız Node `crypto`).
 *
 * Tasarım:
 *  - VARSAYILAN KAPALI. Bir parola yapılandırılmadıkça (config.auth.passwordHash veya
 *    BL_AUTH_PASSWORD) auth devre dışıdır ve requireAuth bir geçiş (no-op) olur. Böylece
 *    mevcut yerel/localhost kullanımı hiç etkilenmez.
 *  - Açıkken: /api/login parolayı doğrular, HMAC ile imzalı, httpOnly, sameSite=Strict bir
 *    session cookie kurar. Tüm diğer /api ve uygulama istekleri geçerli oturum ister.
 *  - Stateless imzalı cookie (sunucu tarafı oturum deposu yok) — tek-parola geçidi için
 *    yeterli ve yeni bağımlılık gerektirmez. Çok kullanıcı/rol bir sonraki adımdır.
 *
 * Bu modül, barındırma (c) yönünün ilk gerçek güvenlik primitifidir; ağ kilidi (net-guard)
 * yalnız yanlış yapılandırmayı engeller, kimlik doğrulama işini bu modül yapar.
 */

const crypto = require('crypto');
const { APP_VERSION } = require('./app-version');

const COOKIE_NAME = 'bl_session';
const DEFAULT_SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

// ---- Parola (scrypt) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}
function verifyPasswordHash(pw, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!expected.length) return false;
    const dk = crypto.scryptSync(String(pw), salt, expected.length);
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch (_) { return false; }
}
// Ortam değişkeni (düz metin) parolayı sabit-zamanlı ve uzunluk sızdırmadan karşılaştır.
function constantTimeEquals(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---- İmzalı oturum cookie'si (stateless) ----
function signSession(secret, ttlMs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifySession(secret, token, now = Date.now()) {
  if (!token || typeof token !== 'string' || !secret) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let gotSig;
  try { gotSig = Buffer.from(sig, 'base64url'); } catch (_) { return false; }
  const expSig = crypto.createHmac('sha256', secret).update(payload).digest();
  if (expSig.length !== gotSig.length || !crypto.timingSafeEqual(expSig, gotSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed.exp === 'number' && now < parsed.exp;
  } catch (_) { return false; }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); } }
  });
  return out;
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const xf = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return xf === 'https';
}

const LOGIN_PAGE_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Buyer Log — Giriş</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#F6F7F9;color:#1c2430}
.card{width:min(360px,92vw);background:#fff;border:1px solid #e6e8ec;border-radius:14px;
  padding:28px 26px;box-shadow:0 8px 30px rgba(20,30,50,.08)}
h1{font-size:18px;margin:0 0 4px}p.sub{margin:0 0 18px;color:#6b7280;font-size:13px}
label{display:block;font-size:13px;margin:0 0 6px;color:#374151}
input{width:100%;height:40px;padding:0 12px;border:1px solid #d1d5db;border-radius:9px;font-size:15px;background:#fff;color:#111}
input:focus{outline:none;border-color:#1B5FA8;box-shadow:0 0 0 3px rgba(27,95,168,.15)}
button{width:100%;height:40px;margin-top:16px;border:0;border-radius:9px;background:#1B5FA8;color:#fff;
  font-size:15px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.err{margin-top:12px;font-size:13px;color:#b42318;min-height:18px}
</style><link rel="stylesheet" href="/giris.css?v=${encodeURIComponent(APP_VERSION)}"></head><body>
<form class="card" id="f" autocomplete="off">
  <h1>Buyer Log</h1><p class="sub">Devam etmek için erişim parolasını girin.</p>
  <label for="pw">Parola</label>
  <input id="pw" type="password" autocomplete="current-password" autofocus>
  <button id="b" type="submit">Giriş yap</button>
  <div class="err" id="e"></div>
</form>
<script>
const f=document.getElementById('f'),pw=document.getElementById('pw'),b=document.getElementById('b'),e=document.getElementById('e');
f.addEventListener('submit',async ev=>{ev.preventDefault();e.textContent='';b.disabled=true;
 try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw.value})});
   if(r.ok){location.href='/';return;}
   const d=await r.json().catch(()=>({}));
   e.textContent=r.status===429?'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.':(d.error||'Giriş başarısız.');
 }catch(_){e.textContent='Sunucuya ulaşılamadı.';}
 b.disabled=false;pw.select();});
</script></body></html>`;

function buildAuth(config, env = process.env) {
  const authCfg = (config && config.auth) || {};
  const passwordHash = authCfg.passwordHash || '';
  const envPassword = env.BL_AUTH_PASSWORD || '';
  const enabled = Boolean(passwordHash || envPassword);

  let secret = authCfg.sessionSecret || env.BL_SESSION_SECRET || '';
  let ephemeralSecret = false;
  if (enabled && !secret) {
    secret = crypto.randomBytes(32).toString('hex');
    ephemeralSecret = true; // yeniden başlatınca oturumlar geçersizleşir — uyarılır
  }
  const ttlMs = Math.max(1, Number(authCfg.sessionHours) || DEFAULT_SESSION_HOURS) * 3600 * 1000;

  function verify(pw) {
    if (passwordHash) return verifyPasswordHash(pw, passwordHash);
    if (envPassword) return constantTimeEquals(pw, envPassword);
    return false;
  }
  function isAuthenticated(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return verifySession(secret, token);
  }

  // Basit IP tabanlı deneme sınırlayıcı (kaba kuvvet önlemi).
  const attempts = new Map();
  function rateLimited(ip) {
    const now = Date.now();
    const rec = attempts.get(ip);
    if (!rec || now > rec.resetAt) { attempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS }); return false; }
    return rec.count >= LOGIN_MAX_ATTEMPTS;
  }
  function noteAttempt(ip, ok) {
    const rec = attempts.get(ip) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
    rec.count = ok ? 0 : rec.count + 1;
    attempts.set(ip, rec);
  }

  function setSessionCookie(req, res) {
    const parts = [
      `${COOKIE_NAME}=${signSession(secret, ttlMs)}`,
      'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(ttlMs / 1000)}`,
    ];
    if (isSecureRequest(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  function clearSessionCookie(req, res) {
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (isSecureRequest(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function loginHandler(req, res) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!enabled) return res.status(404).json({ error: 'Kimlik doğrulama etkin değil.', code: 'AUTH_DISABLED' });
    if (rateLimited(ip)) return res.status(429).json({ error: 'Çok fazla deneme.', code: 'RATE_LIMITED' });
    const pw = (req.body && req.body.password) || '';
    if (!pw || !verify(pw)) {
      noteAttempt(ip, false);
      return res.status(401).json({ error: 'Parola hatalı.', code: 'BAD_CREDENTIALS' });
    }
    noteAttempt(ip, true);
    setSessionCookie(req, res);
    res.json({ ok: true });
  }
  function logoutHandler(req, res) { clearSessionCookie(req, res); res.json({ ok: true }); }
  function statusHandler(req, res) { res.json({ enabled, authenticated: enabled ? isAuthenticated(req) : true }); }
  function loginPageHandler(req, res) {
    if (!enabled || isAuthenticated(req)) return res.redirect(302, '/');
    res.type('html').send(LOGIN_PAGE_HTML);
  }

  // Microsoft OAuth callback kendi tek kullanımlık PKCE state doğrulamasına sahiptir.
  // SameSite=Strict dış parola cookie'si Microsoft'tan dönüşte gönderilmese de
  // yalnız bu callback akışının tamamlanabilmesi için genel auth geçidinden muaftır.
  const ALLOW = new Set(['/api/login', '/api/logout', '/api/auth-status', '/api/health', '/api/status', '/api/outlook/callback', '/api/outlook/webhook', '/api/outlook/lifecycle', '/login']);
  function requireAuth(req, res, next) {
    if (!enabled) return next();
    if (ALLOW.has(req.path)) return next();
    if (isAuthenticated(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Oturum gerekli. Lütfen giriş yapın.', code: 'AUTH_REQUIRED' });
    return res.redirect(302, '/login');
  }

  return {
    enabled, ephemeralSecret, verify, isAuthenticated, requireAuth,
    loginHandler, logoutHandler, statusHandler, loginPageHandler,
    COOKIE_NAME,
  };
}

module.exports = {
  buildAuth, hashPassword, verifyPasswordHash, signSession, verifySession,
  parseCookies, constantTimeEquals, COOKIE_NAME,
};
