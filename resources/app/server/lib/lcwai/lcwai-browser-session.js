'use strict';

/*
 * LCW AI oturum sağlayıcısı — MEVCUT tarayıcı altyapısının üzerinde adaptör.
 *
 * İkinci bir tarayıcı sistemi YOKTUR. Bağlantı, profil sahipliği, cihaz
 * mührü ve READY durumu browser-debug-service.js'te; CDP bağlamı ve "hangi
 * profil mevcut kullanıcınındır" kararı agent-browser-connector.js'tedir
 * (OAB/PASS girişiyle aynı yol). Bu dosya yalnız:
 *   1) bağlanılan profilde LCW AI sekmesini bulur ya da açar,
 *   2) sekmenin kendi localStorage'ındaki access_token'ı okur.
 *
 * Tarayıcıda DOM otomasyonu yapılmaz: hiçbir alan doldurulmaz, düğmeye
 * basılmaz, sohbet ekranı kullanılmaz. Okuma ifadesi yalnız
 * https://lcwai.lcwaikiki.com kökeninde token döndürür; başka kökende
 * (ör. Keycloak giriş ekranı) yalnız "giriş gerekli" sinyali verir.
 * Refresh token okunmaz.
 */
const config = require('./lcwai-config');
const { lcwAiError } = require('./lcwai-errors');

const KEYCLOAK_ORIGIN = new URL(config.KEYCLOAK.issuer).origin;

/* Sayfa bağlamında çalışır. Dönüşte yalnız köken ve (doğru kökendeyse)
   access token bulunur; URL sorgu dizesi (OIDC code/state) DÖNMEZ. */
const TOKEN_READ_EXPRESSION = `(()=>{try{const origin=String(location.origin||'');if(origin!==${JSON.stringify(config.WEB_ORIGIN)})return {origin,token:'',login:origin===${JSON.stringify(KEYCLOAK_ORIGIN)}||Boolean(document.querySelector('input[type="password"]'))};let raw='';try{raw=String(localStorage.getItem('access_token')||'');}catch(_){raw='';}raw=raw.trim();if(raw[0]==='"'){try{raw=String(JSON.parse(raw)||'');}catch(_){raw='';}}raw=raw.replace(/^bearer\\s+/i,'').trim();return {origin,token:raw,login:false};}catch(_){return {origin:'',token:'',login:false};}})()`;

function clean(value) { return String(value == null ? '' : value).trim(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function originOf(value) { try { return new URL(clean(value)).origin; } catch (_) { return ''; } }
function isLcwAiUrl(value) { return originOf(value) === config.WEB_ORIGIN; }
function isKeycloakUrl(value) { return originOf(value) === KEYCLOAK_ORIGIN; }

function createLcwAiBrowserSession(options = {}) {
  const loadConnector = typeof options.connector === 'function' ? options.connector : () => options.connector || require('../agent-browser-connector');
  const wait = typeof options.sleep === 'function' ? options.sleep : sleep;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const pollMs = Math.max(50, Number(options.pollMs) || 1000);

  function connector() {
    const value = loadConnector();
    if (!value) throw lcwAiError('BROWSER_UNAVAILABLE');
    return value;
  }
  function bindingOf(api, context) {
    try { return typeof api.coreNectumProfileBinding === 'function' ? api.coreNectumProfileBinding(context) : null; }
    catch (_) { return null; }
  }
  function inProfile(api, page, binding) {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) return false;
    return typeof api.pageIsInBoundProfile === 'function' ? api.pageIsInBoundProfile(page, binding) : true;
  }
  async function pagesOf(api, context, binding, predicate) {
    try { await context.syncPages(); } catch (_) {}
    return context.pages().filter(page => inProfile(api, page, binding) && predicate(clean(page.url())));
  }
  async function readPage(page) {
    try {
      const result = await page._evaluateValue(TOKEN_READ_EXPRESSION);
      return result && typeof result === 'object' ? { origin: clean(result.origin), token: clean(result.token), login: Boolean(result.login) } : { origin: '', token: '', login: false };
    } catch (_) { return { origin: '', token: '', login: false }; }
  }
  async function openLcwAiPage(api, context, binding) {
    const blank = typeof api.reusableBlankPageInBoundProfile === 'function' ? api.reusableBlankPageInBoundProfile(context, binding) : null;
    if (blank) { await blank.goto(`${config.WEB_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); return blank; }
    if (typeof api.pageInBoundProfile === 'function') return api.pageInBoundProfile(context, `${config.WEB_ORIGIN}/`, binding);
    return context.newPage(`${config.WEB_ORIGIN}/`);
  }
  /* Sekmelerden kullanılabilir ilk token. `login` true ise en az bir sekme
     Keycloak giriş ekranındadır. */
  async function scan(api, context, binding, isUsable) {
    const pages = await pagesOf(api, context, binding, url => isLcwAiUrl(url) || isKeycloakUrl(url));
    let login = false;
    for (const page of pages) {
      const read = await readPage(page);
      if (read.login) login = true;
      if (read.origin === config.WEB_ORIGIN && read.token && isUsable(read.token)) return { token: read.token, page, login: false };
    }
    return { token: '', page: pages.find(page => isLcwAiUrl(page.url())) || null, login, count: pages.length };
  }

  /* SESSİZ okuma: yalnız ZATEN AÇIK ve bağlı tarayıcı kullanılır; Edge
     başlatılmaz. Sekmedeki token süresi dolmuşsa (LCW AI'ın kendi
     yenilemesi henüz çalışmamışsa) sekme bir kez yenilenir; sekme yoksa
     bağlanılan profilde tek bir LCW AI sekmesi açılır. Giriş ekranı çıkarsa
     sessiz yol durur: kullanıcıdan açık giriş istenir. */
  async function readToken(ownerId, { isUsable = () => true } = {}) {
    const api = connector();
    let context;
    try { ({ context } = await api.ensureExistingContext(ownerId)); }
    catch (error) { throw lcwAiError('BROWSER_UNAVAILABLE', { detail: error && error.code }); }
    const binding = bindingOf(api, context);
    if (binding && binding.bound === false) throw lcwAiError('BROWSER_UNAVAILABLE', { detail: binding.source });
    let found = await scan(api, context, binding, isUsable);
    if (found.token) return { token: found.token, source: 'browser-tab' };
    if (found.login) throw lcwAiError('SESSION_EXPIRED');
    let page = found.page;
    if (page) {
      /* Önce LCW AI'ın kendi yenilemesine kısa bir şans verilir: sekmede
         kullanıcının yarım bir sohbeti olabilir, gereksiz yeniden yükleme
         onu bozar. Token gelmezse sekme bir kez yenilenir. */
      const graceUntil = now() + Math.min(3000, config.TIMEOUTS.silentRefreshMs);
      while (now() < graceUntil) {
        await wait(Math.min(pollMs, 500));
        found = await scan(api, context, binding, isUsable);
        if (found.token) return { token: found.token, source: 'browser-tab' };
        if (found.login) throw lcwAiError('SESSION_EXPIRED');
      }
      await page.goto(`${config.WEB_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    } else page = await openLcwAiPage(api, context, binding);
    const deadline = now() + config.TIMEOUTS.silentRefreshMs;
    while (now() < deadline) {
      await wait(Math.min(pollMs, 500));
      found = await scan(api, context, binding, isUsable);
      if (found.token) return { token: found.token, source: 'browser-tab-refresh' };
      if (found.login) throw lcwAiError('SESSION_EXPIRED');
    }
    throw lcwAiError('SESSION_EXPIRED');
  }

  /* ETKİLEŞİMLİ giriş: OAB girişiyle aynı bağlantı yolu (gerekirse mevcut
     kurumsal profil remote debugging ile açılır — browser-debug-service).
     LCW AI sekmesi öne getirilir; kullanıcı normal şekilde giriş yapar. */
  async function login(ownerId, { onPhase = () => {}, isUsable = () => true, timeoutMs = config.TIMEOUTS.loginMs } = {}) {
    const api = connector();
    let context;
    onPhase('opening');
    try { ({ context } = await api.ensureContext(ownerId)); }
    catch (error) { throw lcwAiError('BROWSER_UNAVAILABLE', { detail: error && error.code }); }
    const binding = bindingOf(api, context);
    if (binding && binding.bound === false) throw lcwAiError('BROWSER_UNAVAILABLE', { detail: binding.source });
    let found = await scan(api, context, binding, isUsable);
    if (found.token) { onPhase('connected'); return { token: found.token, source: 'browser-tab' }; }
    let page = found.page;
    if (page) await page.goto(`${config.WEB_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    else page = await openLcwAiPage(api, context, binding);
    try { await page.client?.send?.('Page.bringToFront', {}, 5000); } catch (_) {}
    onPhase('waiting-login');
    const deadline = now() + Math.max(5000, Number(timeoutMs) || config.TIMEOUTS.loginMs);
    while (now() < deadline) {
      await wait(pollMs);
      found = await scan(api, context, binding, isUsable);
      if (found.token) { onPhase('connected'); return { token: found.token, source: 'browser-login' }; }
      onPhase(found.login ? 'login-required' : 'waiting-login');
    }
    throw lcwAiError('LOGIN_TIMEOUT');
  }

  return { readToken, login };
}

module.exports = { createLcwAiBrowserSession, TOKEN_READ_EXPRESSION, isLcwAiUrl, isKeycloakUrl, KEYCLOAK_ORIGIN };
