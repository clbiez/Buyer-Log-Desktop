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
let desktopStyleListTemplate = null;
let desktopStyleListTemplateUpdatedAt = 0;

const STYLE_TEMPLATE_MAX_BYTES = 256 * 1024;

function templateError(message, code = 'CORENECTUM_STYLE_TEMPLATE_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}
function jsonClone(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch (_) { throw templateError('CoreNectum Style List istek şablonu JSON olarak kopyalanamadı.'); }
}
function styleTemplateFields(value) {
  const fields = [];
  const visit = (current, path = []) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = [...path, key];
      const normalized = String(key).replace(/[_\-\s]/g, '').toLowerCase();
      if (typeof child === 'number') {
        let type = '';
        if (/^(page|pageno|pagenumber|pageindex|currentpage|currentpageno|currentpagenumber|currentpageindex)$/.test(normalized)) type = 'page';
        else if (/^(skip|offset|start|startindex|first|firstrow|startrow)$/.test(normalized)) type = 'offset';
        else if (/^(pagesize|size|limit|take|length|rowcount|maxresultcount)$/.test(normalized)) type = 'size';
        if (type) fields.push({ type, path:childPath, key:normalized, base:child });
      }
      if (child && typeof child === 'object') visit(child, childPath);
    }
  };
  visit(value);
  return fields;
}
function valueAtPath(object, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], object);
}
function setAtPath(object, path, value) {
  let current = object;
  for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]];
  current[path[path.length - 1]] = value;
}
function sanitizeStyleListTemplate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw templateError('CoreNectum Style List istek şablonu nesne olmalıdır.');
  }
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch (_) {}
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > STYLE_TEMPLATE_MAX_BYTES) {
    throw templateError('CoreNectum Style List istek şablonu geçersiz veya çok büyük.');
  }
  const clone = JSON.parse(serialized);
  // GetStyleList'in filtre/search/favorite alanları request sözleşmesinin bir
  // parçasıdır. Bunları "genişletmek" için boşaltmak CoreNectum'da HTTP 400
  // üretebilir. Eski doğrulanmış tarama davranışı gibi canlı request body'yi
  // aynen koru; yalnız gövdeye yanlışlıkla düşmüş olabilecek sırları temizle.
  // Sayfalama ayrıca paginateStyleListTemplate içinde kontrollü değiştirilir.
  const secretKey = normalized => /(?:authorization|accesstoken|refreshtoken|bearertoken|password|passwd|secret|cookie|sessiontoken)/.test(normalized);
  const stripSecrets = current => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const normalized = String(key).replace(/[_\-\s]/g, '').toLowerCase();
      if (secretKey(normalized)) { delete current[key]; continue; }
      stripSecrets(child);
    }
  };
  stripSecrets(clone);
  const fields = styleTemplateFields(clone);
  const pageFields = fields.filter(field => field.type === 'page');
  const offsetFields = fields.filter(field => field.type === 'offset');
  const sizeField = fields.find(field => field.type === 'size' && Number(valueAtPath(clone, field.path)) > 0);
  if ((!pageFields.length && !offsetFields.length) || !sizeField) {
    throw templateError('CoreNectum Style List istek şablonunda sayfalama alanları bulunamadı.');
  }
  return clone;
}
function paginateStyleListTemplate(template, logicalPageNumber = 1) {
  const body = jsonClone(template);
  const fields = styleTemplateFields(body);
  const pages = fields.filter(field => field.type === 'page');
  const offsets = fields.filter(field => field.type === 'offset');
  const sizeField = fields.find(field => field.type === 'size' && Number(valueAtPath(body, field.path)) > 0);
  if ((!pages.length && !offsets.length) || !sizeField) throw templateError('CoreNectum Style List sayfalama şablonu geçersiz.');
  const pageSize = Math.max(1, Math.trunc(Number(valueAtPath(body, sizeField.path))) || 1);
  const logical = Math.max(1, Math.trunc(Number(logicalPageNumber)) || 1);
  for (const field of pages) {
    const zeroBased = /index$/.test(field.key) || Number(field.base) === 0;
    setAtPath(body, field.path, zeroBased ? logical - 1 : logical);
  }
  for (const field of offsets) setAtPath(body, field.path, (logical - 1) * pageSize);
  return { body, pageSize };
}
function setDesktopStyleListTemplate(value) {
  desktopStyleListTemplate = sanitizeStyleListTemplate(value);
  desktopStyleListTemplateUpdatedAt = Date.now();
  return { ready:true, updatedAt:new Date(desktopStyleListTemplateUpdatedAt).toISOString() };
}
function getStyleListTemplate() {
  return desktopStyleListTemplate ? jsonClone(desktopStyleListTemplate) : null;
}
function clearDesktopStyleListTemplate() {
  desktopStyleListTemplate = null;
  desktopStyleListTemplateUpdatedAt = 0;
  return { ready:false, updatedAt:'' };
}

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
    styleListTemplateReady: Boolean(desktopStyleListTemplate),
    styleListTemplateUpdatedAt: desktopStyleListTemplateUpdatedAt ? new Date(desktopStyleListTemplateUpdatedAt).toISOString() : '',
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
  clearDesktopStyleListTemplate();
  return publicSettings('desktop');
}
function hasDesktopToken() { return Boolean(desktopToken); }

module.exports = {
  normalizeToken, getToken, publicSettings, saveToken, clearToken,
  setDesktopToken, clearDesktopToken, hasDesktopToken,
  sanitizeStyleListTemplate, paginateStyleListTemplate,
  setDesktopStyleListTemplate, getStyleListTemplate, clearDesktopStyleListTemplate,
};
