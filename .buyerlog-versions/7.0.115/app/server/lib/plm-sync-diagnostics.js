'use strict';

/*
 * PLM SYNC — TANI İZİ (SIRSIZ)
 *
 * NEDEN VAR: PLM SYNC'in başarısız olmasının birbirinden TAMAMEN farklı en az
 * altı sebebi var ve hepsi kullanıcıya aynı cümleyle dönüyordu:
 *
 *     "PLM <kod> GetStyleList ... bulunamadı."
 *
 * Canlıda bu cümle şu beş ayrı durumu maskeledi:
 *   1) Edge bulunamadı / remote debugging kapalı (CDP yok),
 *   2) bağlanılan sekme kullanıcının GERÇEK Edge profilinde değil,
 *   3) CoreNectum oturumu yok (access_token yok),
 *   4) istek 4xx/5xx döndü,
 *   5) istek 200 döndü ama TARANAN EVREN boş/daraltılmış (yetki kapsamı veya
 *      sayfadan devralınan filtre),
 *   6) gerçekten 0 kayıt: model o hesabın kapsamında YOK.
 *
 * Paket başka bir bilgisayara kopyalandığında 1-2-3-5 çok daha olası hâle
 * geliyor; "model bulunamadı" demek kullanıcıyı yanlış yere bakmaya itiyordu.
 *
 * SIR POLİTİKASI: Bu modül bir iz tutar, SIR TUTMAZ. Authorization, Cookie,
 * access_token, parola gibi hiçbir DEĞER buraya yazılamaz — yazılmaya
 * çalışılırsa anahtar/değer sessizce değil, AÇIKÇA düşürülür. Auth durumu
 * yalnız VAR/YOK ve biçim tanındı/tanınmadı olarak taşınır. İz bu yüzden
 * doğrudan HTTP yanıtına ve iş kaydına konabilir.
 */

const STAGES = Object.freeze([
  'BROWSER_DISCOVERED',
  'CDP_CONNECTED',
  'BROWSER_PROFILE_RESOLVED',
  'CORENECTUM_PAGE_READY',
  'AUTH_STATE',
  'STYLE_LIST_REQUEST_SENT',
  'STYLE_LIST_HTTP_STATUS',
  'STYLE_LIST_RESPONSE_RECORDS',
  'STYLE_LIST_NORMALIZED',
]);
const STAGE_SET = new Set(STAGES);

/* Anahtar adı bu kalıba uyuyorsa detay HİÇBİR koşulda taşınmaz. */
const SECRET_KEY = /(authoriz|cookie|token|bearer|secret|password|parola|credential|apikey|api[_-]?key|jwt|session[_-]?id|refresh)/i;
/* Değer sır GİBİ görünüyorsa (JWT, "Bearer ...", uzun opak dize) düşürülür.
   Bu ikinci savunma hattıdır: anahtarı masum bir isimle geçirmek de yetmez. */
const SECRET_VALUE = /^(bearer\s|basic\s|eyj[a-z0-9_-]{8,})/i;
const SAFE_TEXT = /^[\w .:/\\@()+-]{0,200}$/;

function safeKey(key) {
  const name = String(key == null ? '' : key).trim();
  return name && name.length <= 60 && !SECRET_KEY.test(name) ? name : '';
}

/* Taşınabilir değerler: boolean, sonlu sayı ve KISA, sır görünmeyen metin.
   Nesne/dizi taşınmaz — iç içe bir yapı sırrı kazara içeri sokmanın en kolay
   yoludur ve tanı izinin hiçbir aşaması buna ihtiyaç duymaz. */
function safeValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const text = value.replace(/[\r\n\t\0]+/g, ' ').trim().slice(0, 200);
    if (!text) return '';
    if (SECRET_VALUE.test(text) || !SAFE_TEXT.test(text)) return undefined;
    // 40+ karakterlik boşluksuz opak dize: token olma ihtimali gerçek.
    if (text.length >= 40 && !/[ /\\.]/.test(text)) return undefined;
    return text;
  }
  return undefined;
}

function safeDetail(detail) {
  const source = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const name = safeKey(key);
    if (!name) continue;
    const safe = safeValue(value);
    if (safe === undefined) continue;
    out[name] = safe;
  }
  return out;
}

function createTrail() {
  const entries = [];
  function record(stage, detail = {}) {
    const name = String(stage || '').trim().toUpperCase();
    if (!STAGE_SET.has(name)) return null;
    const entry = { stage: name, ...safeDetail(detail) };
    // Aynı aşama tekrar bildirilirse SON değer geçerlidir; iz şişmez.
    const index = entries.findIndex(item => item.stage === name);
    if (index >= 0) entries[index] = entry; else entries.push(entry);
    return entry;
  }
  return {
    record,
    get(stage) { return entries.find(item => item.stage === String(stage || '').toUpperCase()) || null; },
    stages() { return entries.map(item => item.stage); },
    snapshot() { return entries.map(item => ({ ...item })); },
    classify() { return classify(entries); },
  };
}

function stageOf(entries, stage) {
  return (Array.isArray(entries) ? entries : []).find(item => item && item.stage === stage) || null;
}

/* ======================================================================
   SINIFLANDIRMA — "0 model bulundu" ile diğerlerini AYIRAN tek yer.

   Sıra bilinçlidir: zincirin EN ERKEN kopan halkası bildirilir. Oturum yokken
   "kapsam boş" demek de en az "model bulunamadı" demek kadar yanlış olurdu.
   ====================================================================== */
function classify(entries) {
  const browser = stageOf(entries, 'BROWSER_DISCOVERED');
  const cdp = stageOf(entries, 'CDP_CONNECTED');
  const profile = stageOf(entries, 'BROWSER_PROFILE_RESOLVED');
  const page = stageOf(entries, 'CORENECTUM_PAGE_READY');
  const auth = stageOf(entries, 'AUTH_STATE');
  const status = stageOf(entries, 'STYLE_LIST_HTTP_STATUS');
  const records = stageOf(entries, 'STYLE_LIST_RESPONSE_RECORDS');
  const normalized = stageOf(entries, 'STYLE_LIST_NORMALIZED');

  if (browser && browser.found === false) {
    return { code: 'EDGE_NOT_FOUND', stage: 'BROWSER_DISCOVERED', message: 'Microsoft Edge bulunamadı. PLM SYNC bu bilgisayarda çalışamaz.' };
  }
  if (cdp && cdp.connected === false) {
    return { code: 'BROWSER_CDP_NOT_READY', stage: 'CDP_CONNECTED', message: 'Edge uzaktan hata ayıklama bağlantısı kurulamadı. Bu bir PLM sorunu değildir; Ayarlar > Tarayıcı bölümünden bağlantıyı kurun.' };
  }
  if (profile && profile.bound === false) {
    return { code: 'BROWSER_PROFILE_UNBOUND', stage: 'BROWSER_PROFILE_RESOLVED', message: 'CoreNectum sekmesi hangi Edge profilinde açılacağı belirlenemedi. Edge\'de CoreNectum\'u kendi profilinizde açıp tekrar deneyin.' };
  }
  if (page && page.ready === false) {
    return { code: 'CORENECTUM_LOGIN_REQUIRED', stage: 'CORENECTUM_PAGE_READY', message: 'CoreNectum Style List açılamadı. Açılan Edge sekmesinde CoreNectum girişini tamamlayıp tekrar deneyin.' };
  }
  if (auth && auth.present === false) {
    return { code: 'CORENECTUM_LOGIN_REQUIRED', stage: 'AUTH_STATE', message: 'Bu bilgisayarda CoreNectum oturumu yok. Açılan Edge sekmesinde CoreNectum\'a giriş yapıp tekrar deneyin.' };
  }
  const httpStatus = Number(status && status.status) || 0;
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'CORENECTUM_LOGIN_REQUIRED', stage: 'STYLE_LIST_HTTP_STATUS', message: 'CoreNectum oturumu reddetti. Edge sekmesinde girişi tazeleyip tekrar deneyin.' };
  }
  if (httpStatus >= 400 || (status && status.ok === false)) {
    return { code: 'CORENECTUM_API_HTTP_ERROR', stage: 'STYLE_LIST_HTTP_STATUS', message: `CoreNectum GetStyleList isteği başarısız${httpStatus ? ` (HTTP ${httpStatus})` : ''}.` };
  }
  if (records && Number(records.records) === 0) {
    return { code: 'CORENECTUM_SCOPE_EMPTY', stage: 'STYLE_LIST_RESPONSE_RECORDS', message: 'CoreNectum isteği başarılı ama HİÇ model döndürmedi. Bu bilgisayardaki CoreNectum hesabının Style List kapsamı boş ya da ekranda bir filtre etkin. Modeller "bulunamadı" değil, sorgulanan listede hiç yok.' };
  }
  if (normalized && Number(normalized.matched) === 0 && Number(normalized.requested) > 0) {
    return { code: 'CORENECTUM_STYLE_NOT_FOUND', stage: 'STYLE_LIST_NORMALIZED', message: 'CoreNectum kayıt döndürdü ama istenen PLM kodları bu hesabın kapsamında yok.' };
  }
  return { code: 'OK', stage: '', message: '' };
}

/* İzi bir connectorError'a iliştirmek için. details.diagnostics HTTP yanıtına
   olduğu gibi çıkar (bkz. server.js automationError). */
function attach(error, trail) {
  if (!error || !trail) return error;
  const snapshot = typeof trail.snapshot === 'function' ? trail.snapshot() : [];
  error.details = { ...(error.details || {}), diagnostics: snapshot };
  return error;
}

module.exports = { STAGES, createTrail, classify, safeDetail, safeValue, attach };
