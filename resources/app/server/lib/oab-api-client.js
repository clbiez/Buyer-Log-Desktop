'use strict';

const authState = require('./oab-auth-state');
const { redactSecrets } = require('../../shared/secret-redaction');

const OAB_API_HOST = 'pass.prod.lcwaikiki.com';
const OAB_API_ROOT = `https://${OAB_API_HOST}/pass/common/report/api/v2.0`;
const REPORT_REF = 'OrderBudget_List_Report';
const REQUEST_TIMEOUT_MS = 90000;

function clientError(message, code, statusCode = 502, details) {
  const error = new Error(redactSecrets(message));
  error.code = code; error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}
function assertAllowedUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw clientError('OAB API adresi geçersiz.', 'OAB_URL_INVALID', 500); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== OAB_API_HOST) {
    throw clientError('OAB isteği izin verilmeyen bir hedefe yönlendirildi.', 'OAB_HOST_BLOCKED', 502);
  }
  return url;
}
async function request(endpoint, body) {
  const url = assertAllowedUrl(`${OAB_API_ROOT}/${String(endpoint || '').replace(/^\/+/, '')}`);
  const authorization = authState.requireAuthorization();
  const controller = new AbortController();
  authState.registerController(controller);
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://pass.lcwaikiki.com',
        Referer: 'https://pass.lcwaikiki.com/',
        Authorization: authorization,
      },
      body: JSON.stringify(body || {}),
    });
    if (response.status >= 300 && response.status < 400) {
      throw clientError('OAB servisi beklenmeyen bir yönlendirme döndürdü.', 'OAB_REDIRECT_BLOCKED', 502, { status: response.status });
    }
    if (response.status === 401 || response.status === 403) {
      authState.clear({ abortPending:false });
      throw clientError('OAB oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.', 'OAB_AUTH_EXPIRED', response.status, { status: response.status });
    }
    if (!response.ok) {
      throw clientError(`OAB verileri alınamadı: HTTP ${response.status}`, 'OAB_HTTP_ERROR', 502, { status: response.status });
    }
    const text = await response.text();
    try { return text ? JSON.parse(text) : {}; }
    catch (_) { throw clientError('OAB yanıtı JSON olarak ayrıştırılamadı.', 'OAB_INVALID_JSON', 502, { status: response.status }); }
  } catch (error) {
    if (error && error.name === 'AbortError') throw clientError('OAB servisine erişim zaman aşımına uğradı.', 'OAB_TIMEOUT', 504);
    if (error && error.code) throw error;
    throw clientError('OAB servisine erişilemedi.', 'OAB_NETWORK_ERROR', 502);
  } finally {
    clearTimeout(timer);
    authState.unregisterController(controller);
  }
}
function buyerGroupParam(buyerGroupRef, buyerGroupRefs) {
  const list = (Array.isArray(buyerGroupRefs) ? buyerGroupRefs : [])
    .map(value => String(value == null ? '' : value).trim()).filter(Boolean);
  if (list.length) return [...new Set(list)].join(',');
  return buyerGroupRef;
}
async function fetchReportData({ seasonRef, merchSubGroupRef, buyerGroupRef, buyerGroupRefs }) {
  const payload = await request('Report/GetReportData', {
    reportRef: REPORT_REF,
    languageRef: 2,
    parameters: {
      SeasonRef: seasonRef,
      MerchSubGroupRef: merchSubGroupRef,
      BuyerGroupRefs: buyerGroupParam(buyerGroupRef, buyerGroupRefs),
      CategoryGroupRefs: '',
      CategoryRef: '',
    },
  });
  return Array.isArray(payload && payload.Data && payload.Data[0]) ? payload.Data[0] : [];
}
async function validateAuthorization() {
  const payload = await request('Report/GetReportVariablesWithData', {
    reportRef: REPORT_REF,
    languageRef: 2,
    variableRef: 534,
    reportVariableRef: 454,
  });
  return Boolean(payload);
}

module.exports = { OAB_API_HOST, OAB_API_ROOT, fetchReportData, validateAuthorization, buyerGroupParam, assertAllowedUrl };
