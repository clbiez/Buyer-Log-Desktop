'use strict';

/* Desktop OAB relay client.
 *
 * In the desktop app the signed-in PASS page lives, hidden, inside Electron
 * main (persist:oab). PASS API calls are executed there — same origin, Chromium
 * network stack — exactly like the proven Edge/CDP model. This module only
 * forwards a whitelisted endpoint + JSON body over the per-process loopback
 * bridge. No token ever reaches this process. */
const { redactSecrets } = require('../../shared/secret-redaction');
const { buyerGroupParam } = require('./oab-api-client');

const REPORT_REF = 'OrderBudget_List_Report';
const RELAY_TIMEOUT_MS = 130000;

function relayUrl() {
  const value = String(process.env.BUYER_LOG_DESKTOP_OAB_RELAY_URL || '').trim();
  return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value) ? value : '';
}
function relaySecret() { return String(process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET || ''); }
function configured() { return Boolean(relayUrl() && relaySecret()); }

function relayError(message, code, statusCode, details) {
  const error = new Error(redactSecrets(message));
  error.code = code; error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}
async function call(route, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(relayUrl() + route, {
      method:'POST', cache:'no-store', redirect:'error', signal:controller.signal,
      headers:{ 'Content-Type':'application/json', 'X-BuyerLog-Desktop-Bridge':relaySecret() },
      body:JSON.stringify(payload || {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) throw relayError('OAB masaüstü köprüsü isteği reddetti.', 'OAB_RELAY_REJECTED', 502);
    return data;
  } catch (error) {
    if (error && error.code === 'OAB_RELAY_REJECTED') throw error;
    throw relayError('OAB masaüstü köprüsüne ulaşılamadı.', 'OAB_RELAY_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timer);
  }
}
async function status() {
  if (!configured()) return false;
  try { return Boolean((await call('/oab/status', {}, 5000)).ready); }
  catch (_) { return false; }
}
async function request(endpoint, body) {
  const data = await call('/oab/pass-request', { endpoint, body:body || {} }, RELAY_TIMEOUT_MS);
  const result = data.result || {};
  if (result.code === 'OAB_AUTH_REQUIRED') throw relayError('OAB oturumu gerekli.', 'OAB_AUTH_REQUIRED', 401);
  if (result.status === 401 || result.status === 403) throw relayError('OAB oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.', 'OAB_AUTH_EXPIRED', 401, { status:result.status });
  if (result.code === 'OAB_TIMEOUT') throw relayError('OAB servisine erişim zaman aşımına uğradı.', 'OAB_TIMEOUT', 504);
  if (!result.ok) throw relayError(`OAB verileri alınamadı${result.status ? `: HTTP ${result.status}` : ''}`, result.code || 'OAB_HTTP_ERROR', 502, { status:result.status || 0 });
  if (result.json == null) throw relayError('OAB yanıtı JSON olarak ayrıştırılamadı.', 'OAB_INVALID_JSON', 502);
  return result.json;
}
async function fetchReportData({ seasonRef, merchSubGroupRef, buyerGroupRef, buyerGroupRefs } = {}) {
  const payload = await request('Report/GetReportData', {
    reportRef:REPORT_REF,
    languageRef:2,
    parameters:{
      SeasonRef:seasonRef,
      MerchSubGroupRef:merchSubGroupRef,
      BuyerGroupRefs:buyerGroupParam(buyerGroupRef, buyerGroupRefs),
      CategoryGroupRefs:'',
      CategoryRef:'',
    },
  });
  return Array.isArray(payload && payload.Data && payload.Data[0]) ? payload.Data[0] : [];
}

module.exports = { configured, status, request, fetchReportData };
