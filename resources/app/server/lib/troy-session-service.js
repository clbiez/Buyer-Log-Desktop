'use strict';

/* v9.40 — TROY (Order Management) OTURUM SERVİSİ
 *
 * Amaç: kullanıcının Order Code sağ tık menüsünden tetiklediği "Siparişi
 * Kapat" / "Download PO" işlemleri, LCW'nin kurumsal SSO'suyla korunan
 * purchaseorder.prod.lcwaikiki.com API'sini çağırmak için bir JWT'ye
 * ihtiyaç duyar. Buyer Log kendi başına login YAPMAZ/YAPAMAZ — kullanıcının
 * zaten açık olan GERÇEK Edge oturumundan (ordermanagement.lcwaikiki.com/Troy)
 * bu token'ı ödünç alır.
 *
 * Yöntem, agent-browser-connector.js'teki PASS entegrasyonuyla (bkz.
 * capturePassAuthorization) AYNI kanıtlanmış deseni kullanır: mevcut Edge'e
 * CDP ile bağlan (ensureContext — YENİ profil ASLA açılmaz), arka planda bir
 * Troy sekmesi aç/kullan, o sekmenin attığı İLK purchaseorder API isteğinin
 * Authorization header'ını Network.requestWillBeSent olayından yakala.
 *
 * PASS'ten KASITLI FARK: burada hiçbir kalıcı cache YOK. PASS bir kere
 * yakaladığı header'ı `passAuthTemplates` Map'inde tutup sonraki tüm
 * isteklerde yeniden kullanır; Troy için bu MODÜL SEVİYESİNDE bir değişkende
 * asla tutulmaz — her çağrı taze bir yakalama yapar, sonuç yalnız o tek
 * çağrının yerel değişkeninde yaşar ve iş bitince kaybolur. Bu, kullanıcının
 * açık talebidir ("JWT'yi dinamik al, cache'e yazma").
 */

const {
  ensureContext, connectorError, safeOwner, sleep, pageForCurrentBuyerLogProfile,
} = require('./agent-browser-connector');

const TROY_UI_HOST = 'ordermanagement.lcwaikiki.com';
const TROY_UI_BASE = 'https://ordermanagement.lcwaikiki.com/';
const TROY_API_MATCH = '/purchaseorder/bf/service/api/';

function clean(value) { return String(value == null ? '' : value).trim(); }

// PASS'teki passHeaderAllowed ile aynı fikir: tarayıcının kendi ürettiği,
// tekrar oynatınca çelişebilecek başlıklar atılır. Authorization KORUNUR.
function troyHeaderAllowed(name) {
  return !/^(host|content-length|cookie|origin|referer|connection|accept-encoding|accept-language|user-agent)$/i.test(name)
    && !/^sec-/i.test(name) && !name.startsWith(':');
}
function troyReplayHeaders(headers) {
  const allowed = {};
  for (const [key, value] of Object.entries(headers || {})) if (troyHeaderAllowed(key)) allowed[key] = value;
  return allowed;
}

function troyLikelyLoginUrl(value) {
  try {
    const url = new URL(clean(value)), host = url.hostname.toLowerCase(), pathText = `${url.pathname}${url.search}`.toLowerCase();
    if (host === TROY_UI_HOST) return /\/(login|signin|auth)(?:\/|$)/i.test(url.pathname);
    return /login|signin|auth|identity|sso|adfs|microsoftonline|oauth|authorize/i.test(`${host}${pathText}`);
  } catch (_) { return false; }
}
async function troyPageLooksLikeLogin(page) {
  if (!page || page.isClosed()) return false;
  if (troyLikelyLoginUrl(page.url())) return true;
  try {
    return Boolean(await page._evaluateValue(`Boolean(document.querySelector('input[type="password"], input[name*="password" i], input[id*="password" i], form[action*="login" i], form[action*="signin" i]'))`));
  } catch (_) { return false; }
}
function isTroyUiPage(candidate) {
  try { const url = new URL(candidate.url()); return !candidate.isClosed() && url.hostname.toLowerCase() === TROY_UI_HOST; }
  catch (_) { return false; }
}

/* Mevcut Edge'e bağlanır, bir Troy sekmesi bulur/açar (ARKA PLANDA — odağı
   asla çalmaz, kullanıcı Buyer Log'da çalışmaya devam eder), sekmenin attığı
   ilk purchaseorder API isteğinin header'larını yakalar. Hiçbir sonuç
   modül-seviyesi bir değişkende SAKLANMAZ; yalnız döndürülür.
   Not: bu sekme login gerektiriyorsa BURADA beklenmez/odaklanmaz — Buyer
   Log'un kendi arayüzü kullanıcıya "Edge'de açık olan Troy sekmesine geçip
   oturum aç, sonra Tekrar Dene" der (bkz. çağıran taraf, TROY_LOGIN_REQUIRED).
   Sekme zaten (arka planda) açılmış olduğundan kullanıcı Edge'e geçtiğinde
   onu bulur; Buyer Log başka bir uygulamanın penceresini zorla öne getirmez
   (bu kod tabanında böyle bir emsal yok, bkz. keşif notları).
   Dönüş: {ok:true, headers} | {ok:false, code, opened} */
async function getFreshAuthorization(ownerId, { timeoutMs } = {}) {
  const { context } = await ensureContext(ownerId);
  await context.syncPages().catch(() => {});

  let captured = null;
  const onRequest = params => {
    if (captured) return;
    const request = (params && params.request) || {}, url = clean(request.url);
    if (!url.toLowerCase().includes(TROY_API_MATCH)) return;
    captured = { url, headers: { ...(request.headers || {}) } };
  };
  const attached = new Map();
  const attachPage = async candidate => {
    if (!candidate || candidate.isClosed() || attached.has(candidate.client)) return;
    candidate.client.on('Network.requestWillBeSent', onRequest);
    attached.set(candidate.client, true);
    await candidate.client.send('Network.enable', {}, 10000).catch(() => {});
  };
  const detachAll = () => {
    for (const client of attached.keys()) try { client.off('Network.requestWillBeSent', onRequest); } catch (_) {}
    attached.clear();
  };

  try {
    for (const candidate of context.pages()) await attachPage(candidate);
    let page = context.pages().find(isTroyUiPage);
    let opened = false;
    if (!page) { page = await pageForCurrentBuyerLogProfile(context, TROY_UI_BASE); opened = true; }
    await attachPage(page);
    if (page.url() !== TROY_UI_BASE && (opened || !isTroyUiPage(page))) {
      await page.goto(TROY_UI_BASE, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }

    // Kısa bir süre bekleriz (Troy'un SPA'sı açıldıktan hemen sonra kendi
    // bootstrap çağrısını atar); kullanıcıyı görünmeden bekletmemek için
    // login sayfası tespit edilir edilmez hemen pes edilir.
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 8000);
    let loginRequired = false;
    while (!captured && Date.now() < deadline) {
      await context.syncPages().catch(() => {});
      const pages = context.pages().filter(candidate => !candidate.isClosed());
      for (const candidate of pages) await attachPage(candidate);
      loginRequired = false;
      for (const candidate of pages) { if (await troyPageLooksLikeLogin(candidate)) { loginRequired = true; break; } }
      if (loginRequired) break; // login sayfası görüldü: hemen pes et, kullanıcıyı bekletme
      if (!captured) await sleep(200);
    }

    if (!captured) {
      return { ok: false, code: 'TROY_LOGIN_REQUIRED', opened, loginRequired };
    }
    const headers = troyReplayHeaders(captured.headers);
    if (!Object.keys(headers).some(name => /^authorization$/i.test(name))) {
      return { ok: false, code: 'TROY_LOGIN_REQUIRED', opened, loginRequired: true };
    }
    return { ok: true, headers };
  } finally {
    detachAll();
  }
}

/* Tarayıcı içinde (CDP Runtime.evaluate ile) bir fetch() çalıştırır — token
   Node'un kendi ağ isteğine hiç girmez, yalnız captured header'lar bu ifadeye
   gömülüp tarayıcıya gönderilir (PASS'teki passRequestExpression ile aynı
   fikir). wantBinary:true ise gövde base64 olarak (arrayBuffer üzerinden)
   tarayıcı içinde kodlanır; asıl bayt akışı Node'un ağ yığınına hiç girmez. */
function troyFetchExpression(url, method, headers, body, { wantBinary = false } = {}) {
  const config = JSON.stringify({ url, method: method || 'POST', headers, body: body === undefined ? null : body });
  if (wantBinary) {
    return `(async()=>{
      const cfg=${config};
      const requestHeaders=new Headers(cfg.headers||{});
      if(cfg.body!=null)requestHeaders.set('Content-Type','application/json');
      const response=await fetch(cfg.url,{method:cfg.method,headers:requestHeaders,credentials:'omit',cache:'no-store',body:cfg.body==null?undefined:JSON.stringify(cfg.body)});
      const buffer=await response.arrayBuffer();
      let binary='';const bytes=new Uint8Array(buffer);const chunk=0x8000;
      for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
      return {ok:response.ok,status:response.status,statusText:String(response.statusText||''),
        contentType:response.headers.get('content-type')||'',contentDisposition:response.headers.get('content-disposition')||'',
        base64:btoa(binary)};
    })()`;
  }
  return `(async()=>{
    const cfg=${config};
    const requestHeaders=new Headers(cfg.headers||{});
    requestHeaders.set('Accept','application/json');
    if(cfg.body!=null)requestHeaders.set('Content-Type','application/json');
    const response=await fetch(cfg.url,{method:cfg.method,headers:requestHeaders,credentials:'omit',cache:'no-store',body:cfg.body==null?undefined:JSON.stringify(cfg.body)});
    const text=await response.text();
    let parsed=null;try{parsed=JSON.parse(text);}catch(_){}
    return {ok:response.ok,status:response.status,statusText:String(response.statusText||''),json:parsed,text:parsed?null:text.slice(0,2000)};
  })()`;
}

async function troyPageForRequest(ownerId) {
  const { context } = await ensureContext(ownerId);
  await context.syncPages().catch(() => {});
  let page = context.pages().find(isTroyUiPage);
  if (!page) page = await pageForCurrentBuyerLogProfile(context, TROY_UI_BASE);
  return page;
}

/* Yakalanan header'larla, TARAYICI İÇİNDE, tek bir istek çalıştırır. 401/403
   döndüğünde token/oturum-süresi-dolmuş sinyali olarak connectorError'a
   TROY_UNAUTHORIZED kodu ile sarılır — çağıran (troy-order-service /
   troy-po-service) bunu tam olarak BİR kez sessiz retry tetiklemek için
   kullanır. */
async function troyRequest(ownerId, headers, url, method, body, options = {}) {
  const page = await troyPageForRequest(ownerId);
  const expression = troyFetchExpression(url, method, headers, body, options);
  let result;
  try { result = await page._evaluateValue(expression); }
  catch (error) { throw connectorError(`Troy isteği çalıştırılamadı: ${clean(error && error.message || error)}`, 'TROY_CDP_FAILED', 502); }
  if (!result) throw connectorError('Troy isteğinden yanıt alınamadı.', 'TROY_NO_RESPONSE', 502);
  if (result.status === 401 || result.status === 403) throw connectorError('Troy oturumu sona ermiş görünüyor.', 'TROY_UNAUTHORIZED', 401);
  return result;
}

module.exports = {
  TROY_UI_HOST, TROY_UI_BASE, TROY_API_MATCH,
  getFreshAuthorization, troyRequest, troyReplayHeaders, troyHeaderAllowed,
  troyLikelyLoginUrl, troyPageLooksLikeLogin, safeOwner, connectorError,
  // Düşük seviye Edge/CDP erişimi: "Revize Et" (v9.45) gibi, JWT yakalamayla
  // ilgisiz ama AYNI mevcut Edge oturumunu (yeni profil YOK) kullanması
  // gereken özellikler için — agent-browser-connector.js'in kendisinden
  // ikinci bir require yerine burada tek yerden re-export edilir.
  ensureContext, pageForCurrentBuyerLogProfile, sleep,
};
