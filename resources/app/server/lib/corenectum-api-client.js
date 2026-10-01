'use strict';

/* Direct CoreNectum API transport. No Edge, CDP, DOM or browser session is
 * involved. The request shape mirrors PLM_Image_Test_v2.ps1 supplied by the
 * user: Bearer Authorization + Origin/Referer and JSON POST bodies. */
const settings = require('./corenectum-api-settings');
const styleApi = require('./corenectum-style-api');
const requestApi = require('./corenectum-request-api');

const ORIGIN = 'https://corenectum.lcwaikiki.com';
const REFERER = 'https://corenectum.lcwaikiki.com/';
const TECHNICAL_SHEET_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/ReportOperations/CreateTechnicalSheetReport';
const ALLOWED_ENDPOINTS = new Set([styleApi.GET_STYLE_LIST_URL, styleApi.GET_STYLE_IMAGES_URL, TECHNICAL_SHEET_URL, requestApi.GET_REQUEST_LIST_URL]);
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_RETRIES = 3;

function apiError(message, code, statusCode = 502, details = null) {
  const error = new Error(message); error.code = code; error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function safeRemoteBody(text) {
  return String(text == null ? '' : text).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}
function tokenFor(userId, override) {
  const token = settings.normalizeToken(override) || settings.getToken(userId);
  if (!token) throw apiError('CoreNectum API yetkilendirmesi hazır değil. Buyer Log otomatik kurumsal oturum açma ile yetkilendirmeyi yenilemelidir.','CORENECTUM_API_TOKEN_REQUIRED',409);
  return token;
}
function assertEndpoint(url) {
  const normalized = String(url || '');
  if (!ALLOWED_ENDPOINTS.has(normalized)) throw apiError('İzin verilmeyen CoreNectum API uç noktası.','CORENECTUM_API_ENDPOINT_NOT_ALLOWED',400);
  return normalized;
}
async function request(userId, url, body, options = {}) {
  const endpoint = assertEndpoint(url), token = tokenFor(userId, options.token);
  const retries = Math.max(1, Math.min(5, Number(options.retries) || DEFAULT_RETRIES));
  const timeoutMs = Math.max(5000, Math.min(180000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const accept = options.accept || 'application/json, text/plain, */*';
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method:'POST', signal:controller.signal, redirect:'follow', cache:'no-store',
        headers:{
          Accept:accept,
          Authorization:`Bearer ${token}`,
          Origin:ORIGIN,
          Referer:REFERER,
          ...(options.language==='tr'?{'Accept-Language':'tr-TR,tr;q=0.9,en;q=0.7'}:options.language==='en'?{'Accept-Language':'en-US,en;q=0.9,tr;q=0.6'}:{}),
          'Content-Type':'application/json',
        },
        body:JSON.stringify(body == null ? {} : body),
      });
      clearTimeout(timer);
      if (response.status === 401 || response.status === 403) {
        throw apiError(`CoreNectum yetkilendirmesi reddedildi (HTTP ${response.status}). Kurumsal oturumun süresi dolmuş olabilir; Buyer Log otomatik yenileme yapmalıdır.`,'CORENECTUM_API_TOKEN_INVALID',409,{remoteStatus:response.status});
      }
      if (!response.ok) {
        const text = await response.text().catch(()=>'');
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const err = apiError(`CoreNectum API isteği başarısız (HTTP ${response.status})${safeRemoteBody(text)?`: ${safeRemoteBody(text)}`:''}.`,'CORENECTUM_API_HTTP_ERROR',502,{remoteStatus:response.status,retryable});
        if (retryable && attempt < retries) { lastError = err; await sleep(350 * attempt * attempt); continue; }
        throw err;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error && ['CORENECTUM_API_TOKEN_INVALID','CORENECTUM_API_HTTP_ERROR','CORENECTUM_API_TOKEN_REQUIRED'].includes(error.code)) throw error;
      const aborted = error && (error.name === 'AbortError' || /aborted|timeout/i.test(String(error.message||'')));
      lastError = apiError(aborted?'CoreNectum API isteği zaman aşımına uğradı.':`CoreNectum API bağlantısı kurulamadı: ${safeRemoteBody(error&&error.message||error)}`,
        aborted?'CORENECTUM_API_TIMEOUT':'CORENECTUM_API_NETWORK_ERROR',502,{attempt});
      if (attempt < retries) { await sleep(350 * attempt * attempt); continue; }
    }
  }
  throw lastError || apiError('CoreNectum API isteği başarısız.','CORENECTUM_API_NETWORK_ERROR',502);
}
async function postJson(userId, url, body, options = {}) {
  const response = await request(userId, url, body, { ...options, accept:options.accept || 'application/json, text/plain, */*' });
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch (_) { throw apiError('CoreNectum API geçerli JSON döndürmedi.','CORENECTUM_API_INVALID_JSON',502,{remoteStatus:response.status}); }
}
async function postBuffer(userId, url, body, options = {}) {
  const response = await request(userId, url, body, { ...options, accept:options.accept || 'application/pdf, application/octet-stream, */*' });
  return { buffer:Buffer.from(await response.arrayBuffer()), contentType:String(response.headers.get('content-type')||'').toLowerCase(), status:response.status };
}
async function testConnection(userId, tokenOverride) {
  const impossible = '999999999999999';
  const payload = await postJson(userId, styleApi.GET_STYLE_LIST_URL, styleApi.styleListBatchBody([impossible], { pageSize:150 }), { token:tokenOverride, retries:1, timeoutMs:30000 });
  const status = settings.publicSettings(userId);
  return { ok:true, records:styleApi.styleListRecords(payload).length, mode:status.mode, source:status.source };
}

module.exports = { ORIGIN, REFERER, TECHNICAL_SHEET_URL, postJson, postBuffer, testConnection };
