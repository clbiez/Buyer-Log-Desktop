'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const AUTH_ROOT = tenant => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
const SCOPES = Object.freeze(['openid', 'profile', 'email', 'offline_access', 'Mail.Read', 'Mail.Read.Shared']);
const MESSAGE_FIELDS = Object.freeze([
  'id', 'internetMessageId', 'conversationId', 'subject', 'from', 'sender',
  'toRecipients', 'ccRecipients', 'receivedDateTime', 'sentDateTime',
  'bodyPreview', 'hasAttachments', 'importance', 'isRead', 'webLink',
]);
const CONTEXT_FIELDS = Object.freeze([
  'orderNo', 'poNo', 'plmCode', 'styleId', 'modelCode', 'modelName', 'colourCode',
  'manufacturer', 'supplier', 'option', 'article', 'department', 'className',
  'orderDate', 'deliveryDate',
]);
const SEARCHABLE_FIELDS = Object.freeze([
  'orderNo', 'poNo', 'plmCode', 'styleId', 'modelCode', 'modelName',
  'colourCode', 'manufacturer', 'supplier', 'option', 'article',
]);
const SCORE_WEIGHTS = Object.freeze({
  orderNo: 100, poNo: 100, plmCode: 80, styleId: 75, modelCode: 70,
  modelName: 60, colourCode: 40, manufacturer: 30, supplier: 30,
  option: 25, article: 25, manual: 20, dateNear: 20,
});
const LABELS = Object.freeze({
  orderNo: 'Sipariş No', poNo: 'PO', plmCode: 'PLM', styleId: 'Style ID',
  modelCode: 'Model Kodu', modelName: 'Model', colourCode: 'Colour',
  manufacturer: 'Üretici', supplier: 'Supplier', option: 'Option', article: 'Article',
  manual: 'Manuel Arama', dateNear: 'Sipariş Tarihi',
});
const CACHE_TTL_MS = 2 * 60 * 1000;
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

function clean(value, max = 240) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function cleanDisplayPreview(value, max = 720) {
  let text = String(value == null ? '' : value)
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '');
  // Stop before quoted message history, transport headers, signatures and corporate disclaimers.
  const cutPatterns = [
    /(?:^|\n)\s*-{2,}\s*(?:original message|forwarded message|ilet(?:ilen|ilmiş) ileti)\s*-{2,}/i,
    /(?:^|\n)\s*(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:/i,
    /(?:^|\n)\s*(?:kind regards|best regards|warm regards|regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i,
    /(?:^|\n)\s*(?:please consider the environment before printing|save paper!?|this e-?mail and any attachments|bu e-?posta ve ekleri)\b/i,
  ];
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && match.index >= 0) text = text.slice(0, match.index);
  }
  // Graph/COM previews can already be flattened to one line. Handle the same markers inline.
  const inlineCuts = [
    /\s+-{2,}\s*(?:original message|forwarded message)\s*-{2,}/i,
    /\s+(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:\s+/i,
    /\s+(?:kind regards|best regards|warm regards|thanks\s*(?:&|and)\s*regards|saygılarımla|saygılar|iyi çalışmalar|best wishes)\b/i,
    /\s+(?:please consider the environment before printing|save paper!?|this e-?mail and any attachments|bu e-?posta ve ekleri)\b/i,
  ];
  for (const pattern of inlineCuts) {
    const match = pattern.exec(text);
    if (match && match.index > 24) text = text.slice(0, match.index);
  }
  text = text
    .replace(/<mailto:[^>]+>/gi, ' ')
    .replace(/mailto:[^\s>]+/gi, ' ')
    .replace(/<?[A-Z0-9._%+\-']+@[A-Z0-9.\-]+\.[A-Z]{2,}>?/gi, ' ')
    .replace(/\b(?:from|kimden|gönderen|sent|gönderildi|to|kime|cc|subject|konu)\s*:\s*/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > max) text = text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  return text;
}
function normalize(value) { return clean(value).toLocaleUpperCase('tr-TR'); }
function bool(value) { return ['1', 'true', 'yes', 'on'].includes(String(value == null ? '' : value).trim().toLowerCase()); }
function unique(values) {
  const out = [], seen = new Set();
  for (const raw of values || []) { const value = clean(raw); const key = normalize(value); if (value && !seen.has(key)) { seen.add(key); out.push(value); } }
  return out;
}
function manualTerms(value) {
  return unique(String(value == null ? '' : value).split(/[,;\n]+/).map(item => clean(item, 300)).filter(Boolean)).slice(0, 12);
}
function base64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest(); }
function contextHash(context) { return base64url(sha256(JSON.stringify(normalizeContext(context)))).slice(0, 32); }
function stableHash(value) {
  const stable = input => Array.isArray(input) ? input.map(stable) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, stable(input[key])])) : input;
  return base64url(sha256(JSON.stringify(stable(value)))).slice(0, 32);
}

function normalizeGraphConfig(config = {}, env = process.env) {
  const raw = config.microsoftGraph && typeof config.microsoftGraph === 'object' ? config.microsoftGraph : {};
  const enabled = env.MICROSOFT_GRAPH_ENABLED == null ? Boolean(raw.enabled) : bool(env.MICROSOFT_GRAPH_ENABLED);
  const mockRequested = env.MICROSOFT_GRAPH_MOCK == null ? Boolean(raw.mock) : bool(env.MICROSOFT_GRAPH_MOCK);
  const mock = mockRequested && env.NODE_ENV !== 'production';
  return {
    enabled,
    mock,
    clientId: clean(env.MICROSOFT_CLIENT_ID || raw.clientId, 160),
    tenantId: clean(env.MICROSOFT_TENANT_ID || raw.tenantId || 'organizations', 160),
    redirectUri: clean(env.MICROSOFT_REDIRECT_URI || raw.redirectUri, 500),
    clientSecret: clean(env.MICROSOFT_CLIENT_SECRET || raw.clientSecret, 1000),
    tokenEncryptionKey: clean(env.MICROSOFT_TOKEN_ENCRYPTION_KEY || raw.tokenEncryptionKey, 1000),
    applicationClientId: clean(env.MICROSOFT_APPLICATION_CLIENT_ID || raw.applicationClientId || env.MICROSOFT_CLIENT_ID || raw.clientId, 160),
    applicationTenantId: clean(env.MICROSOFT_APPLICATION_TENANT_ID || raw.applicationTenantId || env.MICROSOFT_TENANT_ID || raw.tenantId, 160),
    applicationClientSecret: clean(env.MICROSOFT_APPLICATION_CLIENT_SECRET || raw.applicationClientSecret, 1000),
    sharedMailboxCandidates: unique(String(env.MICROSOFT_SHARED_MAILBOXES || raw.sharedMailboxCandidates || '').split(/[\n,;]+/)),
  };
}

function configurationState(cfg) {
  if (!cfg.enabled) return { ready: false, code: 'DISABLED', message: 'Microsoft Graph özelliği kapalı.' };
  if (cfg.mock) return { ready: true, code: 'MOCK', message: 'Development mock etkin.' };
  if (!cfg.clientId || !cfg.tenantId || !cfg.redirectUri) return { ready: false, code: 'CONFIG_REQUIRED', message: 'Microsoft Client ID, Tenant ID ve Redirect URI yapılandırılmalıdır.' };
  if (!cfg.clientSecret) return { ready: false, code: 'CLIENT_SECRET_REQUIRED', message: 'Microsoft Web OAuth bağlantısı için Client Secret yapılandırılmalıdır.' };
  if (!cfg.tokenEncryptionKey || cfg.tokenEncryptionKey.length < 24) return { ready: false, code: 'TOKEN_KEY_REQUIRED', message: 'MICROSOFT_TOKEN_ENCRYPTION_KEY en az 24 karakter olmalıdır.' };
  return { ready: true, code: 'READY', message: '' };
}
function jwtClaims(token) {
  try {
    const part = clean(token, 20000).split('.')[1]; if (!part) return {};
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : {};
  } catch (_) { return {}; }
}

function normalizeContext(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}, out = {};
  for (const field of CONTEXT_FIELDS) {
    const max = field.endsWith('Date') ? 40 : 240;
    const value = clean(source[field], max);
    if (value) out[field] = value;
  }
  return out;
}

function escapeSearchTerm(value) {
  return clean(value, 240)
    .replace(/[\\"']/g, match => `\\${match}`)
    .replace(/[():]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function quoted(value) { const safe = escapeSearchTerm(value); return safe ? `"${safe}"` : ''; }
function searchDateClause(from, to) {
  const parts = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean(from))) parts.push(`received>=${clean(from)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean(to))) parts.push(`received<=${clean(to)}`);
  return parts.join(' AND ');
}

function buildSearchQueries(contextInput, options = {}) {
  const context = normalizeContext(contextInput);
  const requested = Array.isArray(options.fields)
    ? new Set(options.fields.map(value => clean(value)).filter(field => SEARCHABLE_FIELDS.includes(field)))
    : new Set(SEARCHABLE_FIELDS);
  const value = field => requested.has(field) ? quoted(context[field]) : '';
  const manual = manualTerms(options.manual).map(quoted).filter(Boolean);
  const queries = [], add = (stage, values) => {
    // Manual terms are narrowing criteria: every generated Graph query must also
    // include them. Thus adding "RFID, approval" does not broaden the order search.
    const terms = unique([...(values || []), ...manual]).filter(Boolean); if (!terms.length) return;
    const date = searchDateClause(options.dateFrom, options.dateTo);
    const queryString = [...terms, date].filter(Boolean).join(' AND ');
    if (queryString && !queries.some(item => item.queryString === queryString)) queries.push({ stage, queryString });
  };
  add(1, [value('orderNo')]); add(1, [value('poNo')]);
  add(2, [value('plmCode')]); add(2, [value('styleId')]);
  add(3, [value('modelCode') || value('modelName')]);
  add(4, [value('orderNo') || value('poNo'), value('modelCode') || value('modelName')]);
  add(4, [value('plmCode') || value('styleId'), value('modelCode') || value('modelName')]);
  add(4, [value('modelCode') || value('modelName'), value('colourCode')]);
  add(5, [value('modelCode') || value('modelName'), value('manufacturer') || value('supplier')]);
  if (manual.length) add(6, [value('orderNo') || value('poNo'), value('plmCode') || value('styleId'), value('modelCode') || value('modelName')]);
  if (options.broad) {
    add(7, [value('colourCode')]);
    add(7, [value('manufacturer') || value('supplier')]);
    add(7, [value('modelName') || value('modelCode')]);
  }
  return queries.slice(0, 10);
}

function searchableText(message) {
  const address = item => item && item.emailAddress ? `${item.emailAddress.name || ''} ${item.emailAddress.address || ''}` : '';
  return normalize([
    message.subject, message.bodyPreview, address(message.from), address(message.sender),
    ...(message.toRecipients || []).map(address), ...(message.ccRecipients || []).map(address),
  ].join(' '));
}

function scoreMessage(message, contextInput, options = {}) {
  const context = normalizeContext(contextInput), haystack = searchableText(message), matchedFields = [];
  const requested = Array.isArray(options.fields)
    ? new Set(options.fields.map(value => clean(value)).filter(field => SEARCHABLE_FIELDS.includes(field)))
    : new Set(SEARCHABLE_FIELDS);
  let raw = 0, possible = 0;
  for (const field of SEARCHABLE_FIELDS) {
    if (!requested.has(field)) continue;
    const value = normalize(context[field]); if (!value) continue;
    const weight = SCORE_WEIGHTS[field] || 10; possible += weight;
    if (haystack.includes(value)) { raw += weight; matchedFields.push({ field, label: LABELS[field] || field }); }
  }
  const manual = manualTerms(options.manual).map(normalize).filter(Boolean);
  if (manual.length) { possible += SCORE_WEIGHTS.manual; if (manual.every(term => haystack.includes(term))) { raw += SCORE_WEIGHTS.manual; matchedFields.push({ field: 'manual', label: LABELS.manual }); } }
  const orderTime = Date.parse(context.orderDate || ''), mailTime = Date.parse(message.receivedDateTime || message.sentDateTime || '');
  if (Number.isFinite(orderTime) && Number.isFinite(mailTime)) {
    possible += SCORE_WEIGHTS.dateNear;
    if (Math.abs(mailTime - orderTime) <= 90 * 86400000) { raw += SCORE_WEIGHTS.dateNear; matchedFields.push({ field: 'dateNear', label: LABELS.dateNear }); }
  }
  if (matchedFields.length > 1) raw += Math.min(25, (matchedFields.length - 1) * 5);
  const score = possible ? Math.max(1, Math.min(100, Math.round(100 * raw / (possible + Math.min(25, Math.max(0, matchedFields.length - 1) * 5))))) : 0;
  return { score, matchedFields, rawScore: raw };
}

function normalizeMessage(resource, rank, context, options) {
  const source = resource && typeof resource === 'object' ? resource : {};
  const scored = scoreMessage(source, context, options);
  return {
    messageId: clean(source.id, 500), internetMessageId: clean(source.internetMessageId, 500),
    conversationId: clean(source.conversationId, 500), subject: clean(source.subject, 1000),
    sender: source.from && source.from.emailAddress || source.sender && source.sender.emailAddress || {},
    toRecipients: Array.isArray(source.toRecipients) ? source.toRecipients : [],
    ccRecipients: Array.isArray(source.ccRecipients) ? source.ccRecipients : [],
    receivedAt: clean(source.receivedDateTime || source.sentDateTime, 80),
    preview: cleanDisplayPreview(source.bodyPreview, 720), hasAttachments: Boolean(source.hasAttachments),
    importance: clean(source.importance, 40), isRead: Boolean(source.isRead),
    webLink: /^https:\/\//i.test(clean(source.webLink, 2000)) ? clean(source.webLink, 2000) : '',
    graphRank: Number(rank) || 0, score: scored.score, matchedFields: scored.matchedFields,
  };
}

function deduplicateMessages(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalize(item.internetMessageId || item.messageId || `${item.subject}|${item.receivedAt}|${item.sender && item.sender.address}`);
    if (!key) continue;
    const previous = map.get(key);
    if (!previous || Number(item.score) > Number(previous.score)) map.set(key, item);
    else previous.matchedFields = [...new Map([...(previous.matchedFields || []), ...(item.matchedFields || [])].map(value => [value.field, value])).values()];
  }
  return [...map.values()];
}

function groupConversations(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = item.conversationId || item.messageId;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].map(([conversationId, messages]) => {
    messages.sort((a, b) => Date.parse(a.receivedAt || 0) - Date.parse(b.receivedAt || 0));
    const latest = messages[messages.length - 1];
    return { conversationId, count: messages.length, subject: latest.subject, latestAt: latest.receivedAt, sender: latest.sender, score: Math.max(...messages.map(item => item.score || 0)), messages };
  }).sort((a, b) => b.score - a.score || Date.parse(b.latestAt || 0) - Date.parse(a.latestAt || 0));
}

function createOutlookGraphService(options = {}) {
  const cfg = normalizeGraphConfig(options.config || {}, options.env || process.env);
  const setup = configurationState(cfg), fetchImpl = options.fetchImpl || global.fetch;
  const dataRoot = options.dataRoot || path.join(__dirname, '..', 'data');
  const storeFile = path.join(dataRoot, 'outlook-connections.json');
  const writeJson = options.writeJson || ((file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); });
  const pending = new Map(), cache = new Map();
  let applicationTokenCache = null;
  const key = cfg.tokenEncryptionKey ? sha256(cfg.tokenEncryptionKey) : null;

  function loadStore() {
    try { const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8')); return parsed && parsed.entries ? parsed : { schemaVersion: 1, entries: {} }; }
    catch (_) { return { schemaVersion: 1, entries: {} }; }
  }
  function saveStore(store) { writeJson(storeFile, { schemaVersion: 1, entries: store.entries || {} }); }
  function encrypt(value) {
    if (!key) throw Object.assign(new Error('Token encryption key is unavailable.'), { code: 'TOKEN_KEY_REQUIRED' });
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { alg: 'A256GCM', iv: base64url(iv), tag: base64url(cipher.getAuthTag()), ciphertext: base64url(ciphertext) };
  }
  function decrypt(envelope) {
    if (!key || !envelope || envelope.alg !== 'A256GCM') throw Object.assign(new Error('Outlook bağlantısı yeniden doğrulanmalıdır.'), { code: 'REAUTH_REQUIRED', statusCode: 401 });
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
    } catch (_) { throw Object.assign(new Error('Outlook bağlantısı yeniden doğrulanmalıdır.'), { code: 'REAUTH_REQUIRED', statusCode: 401 }); }
  }
  function publicStatus(userId) {
    if (!setup.ready) return { enabled: cfg.enabled, configured: false, connected: false, state: setup.code, message: setup.message };
    if (cfg.mock) return { enabled: true, configured: true, connected: true, state: 'CONNECTED', email: 'mock.user@example.com', accountName: 'Development Mock', connectedAt: new Date().toISOString(), lastValidatedAt: new Date().toISOString(), mock: true };
    const entry = loadStore().entries[clean(userId, 160)];
    if (!entry) return { enabled: true, configured: true, connected: false, state: 'DISCONNECTED' };
    const state = entry.state || 'CONNECTED';
    return { enabled: true, configured: true, connected: state === 'CONNECTED', state, email: entry.email, accountName: entry.accountName, tenantId: entry.tenantId, connectedAt: entry.connectedAt, lastValidatedAt: entry.lastValidatedAt };
  }
  function redirectUri(req) {
    if (cfg.redirectUri) return cfg.redirectUri;
    const proto = clean(req && req.headers && req.headers['x-forwarded-proto']).split(',')[0] || (req && req.secure ? 'https' : 'http');
    return `${proto}://${clean(req && req.headers && req.headers.host, 300)}/api/outlook/callback`;
  }
  function beginConnect(user, req) {
    if (!setup.ready) throw Object.assign(new Error(setup.message), { code: setup.code, statusCode: 503 });
    if (cfg.mock) return { authorizeUrl: '', mock: true };
    for (const [pendingState, value] of pending.entries()) if (!value || value.expiresAt < Date.now()) pending.delete(pendingState);
    const state = base64url(crypto.randomBytes(32)), verifier = base64url(crypto.randomBytes(64));
    pending.set(state, { userId: clean(user.id, 160), verifier, redirectUri: redirectUri(req), expiresAt: Date.now() + AUTH_STATE_TTL_MS });
    const params = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri(req), response_mode: 'query', scope: SCOPES.join(' '), state, code_challenge: base64url(sha256(verifier)), code_challenge_method: 'S256', prompt: 'select_account' });
    return { authorizeUrl: `${AUTH_ROOT(cfg.tenantId)}/authorize?${params.toString()}` };
  }
  async function tokenRequest(params) {
    if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Microsoft bağlantısı için fetch desteği bulunamadı.'), { code: 'GRAPH_CLIENT_UNAVAILABLE', statusCode: 503 });
    if (cfg.clientSecret) params.set('client_secret', cfg.clientSecret);
    const response = await fetchImpl(`${AUTH_ROOT(cfg.tenantId)}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const oauthCode = clean(data.error, 120), reauth = ['invalid_grant','interaction_required','login_required'].includes(oauthCode);
      throw Object.assign(new Error(data.error_description || 'Microsoft oturumu tamamlanamadı.'), { code: reauth ? 'REAUTH_REQUIRED' : oauthCode || 'MICROSOFT_TOKEN_FAILED', statusCode: 401 });
    }
    return data;
  }
  async function graphFetchWithToken(token, resource, request = {}, retry = 0) {
    if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Microsoft Graph istemcisi kullanılamıyor.'), { code: 'GRAPH_CLIENT_UNAVAILABLE', statusCode: 503 });
    const response = await fetchImpl(`${GRAPH_ROOT}${resource}`, { ...request, headers: { Accept: 'application/json', ...(request.body ? { 'Content-Type': 'application/json' } : {}), ...(request.headers || {}), Authorization: `Bearer ${token}` } });
    if ((response.status === 429 || response.status >= 500) && retry < 3) {
      const waitMs = Math.max(500, Math.min(20000, (Number(response.headers.get('retry-after')) || (2 ** retry)) * 1000)) + Math.floor(Math.random() * 500);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return graphFetchWithToken(token, resource, request, retry + 1);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = response.status === 429 ? 'GRAPH_THROTTLED' : response.status === 401 ? 'REAUTH_REQUIRED' : response.status === 403 ? 'MAILBOX_ACCESS_DENIED' : 'GRAPH_REQUEST_FAILED';
      throw Object.assign(new Error(data.error && data.error.message || 'Microsoft Graph isteği tamamlanamadı.'), { code, statusCode: response.status || 502, retryAfter: response.headers.get('retry-after') || null });
    }
    return data;
  }
  async function graphRawFetchWithToken(token, resource, request = {}, retry = 0) {
    if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Microsoft Graph istemcisi kullanılamıyor.'), { code: 'GRAPH_CLIENT_UNAVAILABLE', statusCode: 503 });
    const response = await fetchImpl(`${GRAPH_ROOT}${resource}`, { ...request, headers: { Accept: '*/*', ...(request.headers || {}), Authorization: `Bearer ${token}` } });
    if ((response.status === 429 || response.status >= 500) && retry < 3) {
      const waitSeconds = Math.max(1, Math.min(20, Number(response.headers.get('retry-after')) || (2 ** retry)));
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
      return graphRawFetchWithToken(token, resource, request, retry + 1);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({})), code = response.status === 403 ? 'MAILBOX_ACCESS_DENIED' : response.status === 401 ? 'REAUTH_REQUIRED' : response.status === 429 ? 'GRAPH_THROTTLED' : 'GRAPH_REQUEST_FAILED';
      throw Object.assign(new Error(data.error && data.error.message || 'Microsoft Graph isteği tamamlanamadı.'), { code, statusCode: response.status || 502, retryAfter: response.headers.get('retry-after') || null });
    }
    return response;
  }
  async function handleCallback(query) {
    const state = clean(query && query.state, 500), record = pending.get(state); pending.delete(state);
    if (!record || record.expiresAt < Date.now()) throw Object.assign(new Error('Microsoft bağlantı isteğinin süresi doldu.'), { code: 'OAUTH_STATE_INVALID', statusCode: 400 });
    try {
      if (query.error) throw Object.assign(new Error(clean(query.error_description || query.error, 1000)), { code: clean(query.error, 120) || 'MICROSOFT_CONSENT_DENIED', statusCode: 400 });
      const params = new URLSearchParams({ client_id: cfg.clientId, grant_type: 'authorization_code', code: clean(query.code, 4000), redirect_uri: record.redirectUri, code_verifier: record.verifier, scope: SCOPES.join(' ') });
      const tokens = await tokenRequest(params), claims = jwtClaims(tokens.id_token);
      if (!tokens.access_token || !clean(claims.oid || claims.sub)) throw Object.assign(new Error('Microsoft hesap kimliği doğrulanamadı.'), { code: 'MICROSOFT_IDENTITY_MISSING', statusCode: 401 });
      const now = new Date().toISOString(), store = loadStore();
      store.entries[record.userId] = {
        userId: record.userId, microsoftObjectId: clean(claims.oid || claims.sub, 300), tenantId: clean(claims.tid || cfg.tenantId, 300),
        email: clean(claims.preferred_username || claims.email || claims.upn, 500), accountName: clean(claims.name, 500),
        state: 'CONNECTED', connectedAt: store.entries[record.userId] && store.entries[record.userId].connectedAt || now, lastValidatedAt: now,
        token: encrypt({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000, scope: tokens.scope }),
      };
      saveStore(store); return { userId: record.userId, email: store.entries[record.userId].email, accountName: store.entries[record.userId].accountName };
    } catch (error) { error.userId = error.userId || record.userId; throw error; }
  }
  function markConnectionState(userId, state) {
    const store = loadStore(), entry = store.entries[clean(userId, 160)]; if (!entry) return;
    entry.state = state; entry.lastValidatedAt = new Date().toISOString(); saveStore(store);
  }
  async function accessToken(userId) {
    const store = loadStore(), entry = store.entries[clean(userId, 160)];
    if (!entry) throw Object.assign(new Error('Outlook hesabınız bağlı değil.'), { code: 'OUTLOOK_NOT_CONNECTED', statusCode: 409 });
    const tokens = decrypt(entry.token);
    if (tokens.accessToken && Number(tokens.expiresAt) > Date.now() + 5 * 60 * 1000) return tokens.accessToken;
    if (!tokens.refreshToken) throw Object.assign(new Error('Outlook bağlantınızın yeniden doğrulanması gerekiyor.'), { code: 'REAUTH_REQUIRED', statusCode: 401 });
    const params = new URLSearchParams({ client_id: cfg.clientId, grant_type: 'refresh_token', refresh_token: tokens.refreshToken, scope: SCOPES.join(' ') });
    const refreshed = await tokenRequest(params);
    const next = { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || tokens.refreshToken, expiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in) || 3600) * 1000, scope: refreshed.scope || tokens.scope };
    entry.token = encrypt(next); entry.lastValidatedAt = new Date().toISOString(); entry.state = 'CONNECTED'; saveStore(store);
    return next.accessToken;
  }
  async function applicationAccessToken() {
    if (applicationTokenCache && applicationTokenCache.expiresAt > Date.now() + 300000) return applicationTokenCache.accessToken;
    if (!cfg.applicationClientId || !cfg.applicationTenantId || !cfg.applicationClientSecret) throw Object.assign(new Error('Background Microsoft Graph application credentials yapılandırılmamıştır.'), { code: 'APPLICATION_GRAPH_NOT_CONFIGURED', statusCode: 503 });
    const params = new URLSearchParams({ client_id: cfg.applicationClientId, grant_type: 'client_credentials', client_secret: cfg.applicationClientSecret, scope: 'https://graph.microsoft.com/.default' });
    const response = await fetchImpl(`${AUTH_ROOT(cfg.applicationTenantId)}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw Object.assign(new Error(data.error_description || 'Microsoft application token alınamadı.'), { code: 'APPLICATION_TOKEN_FAILED', statusCode: response.status || 502 });
    applicationTokenCache = { accessToken: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 };
    return applicationTokenCache.accessToken;
  }
  function disconnect(userId) {
    const store = loadStore(), id = clean(userId, 160), existed = Boolean(store.entries[id]); delete store.entries[id]; saveStore(store);
    for (const cacheKey of cache.keys()) if (cacheKey.startsWith(`${id}|`)) cache.delete(cacheKey);
    return existed;
  }
  async function search(userId, contextInput, options = {}) {
    const context = normalizeContext(contextInput), queries = buildSearchQueries(context, options);
    if (!queries.length) throw Object.assign(new Error('Arama için sipariş, PLM, model, renk veya üretici bilgisi bulunamadı.'), { code: 'SEARCH_CONTEXT_EMPTY', statusCode: 400 });
    const pageSize = Math.max(10, Math.min(50, Number(options.pageSize) || 25)), page = Math.max(0, Math.min(100, Number(options.page) || 0));
    const cacheKey = `${clean(userId, 160)}|${contextHash(context)}|${stableHash({ ...options, pageSize, page })}`;
    const cached = cache.get(cacheKey); if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
    let items = [];
    if (cfg.mock) items = mockMessages(context).map((message, index) => normalizeMessage(message, index + 1, context, options));
    else {
      try {
        const token = await accessToken(userId);
        for (const query of queries) {
          const payload = { requests: [{ entityTypes: ['message'], query: { queryString: query.queryString }, from: page * pageSize, size: pageSize, fields: MESSAGE_FIELDS }] };
          const data = await graphFetchWithToken(token, '/search/query', { method: 'POST', body: JSON.stringify(payload) });
          const hits = data && data.value && data.value[0] && data.value[0].hitsContainers && data.value[0].hitsContainers[0] && data.value[0].hitsContainers[0].hits || [];
          hits.forEach(hit => items.push(normalizeMessage(hit.resource || {}, hit.rank, context, options)));
        }
      } catch (error) { if (error.code === 'REAUTH_REQUIRED') markConnectionState(userId, 'REAUTH_REQUIRED'); throw error; }
    }
    items = deduplicateMessages(items).filter(item => item.messageId).filter(item => {
      if (options.unreadOnly && item.isRead) return false;
      if (options.attachment === 'with' && !item.hasAttachments) return false;
      if (options.attachment === 'without' && item.hasAttachments) return false;
      return true;
    });
    const sort = clean(options.sort).toLowerCase();
    items.sort((a, b) => sort === 'oldest' ? Date.parse(a.receivedAt || 0) - Date.parse(b.receivedAt || 0) : sort === 'newest' ? Date.parse(b.receivedAt || 0) - Date.parse(a.receivedAt || 0) : b.score - a.score || Date.parse(b.receivedAt || 0) - Date.parse(a.receivedAt || 0));
    const value = { items, conversations: groupConversations(items), page, pageSize, hasMore: items.length >= pageSize, contextHash: contextHash(context), queries: queries.map(item => ({ stage: item.stage })) };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }
  async function messageDetail(userId, messageId) {
    if (!clean(messageId, 1000)) throw Object.assign(new Error('Mail kimliği zorunludur.'), { code: 'MESSAGE_ID_REQUIRED', statusCode: 400 });
    if (cfg.mock) return { messageId, contentType: 'html', body: '<p>Development mock mail detail.</p>', attachments: [] };
    const token = await accessToken(userId), id = encodeURIComponent(clean(messageId, 1000));
    const data = await graphFetchWithToken(token, `/me/messages/${id}?$select=id,subject,body,hasAttachments,internetMessageId,conversationId,webLink`);
    let attachments = [];
    if (data.hasAttachments) {
      const attachmentData = await graphFetchWithToken(token, `/me/messages/${id}/attachments?$select=id,name,size,contentType,isInline,contentId`);
      attachments = (attachmentData.value || []).map(item => ({ id: clean(item.id, 500), name: clean(item.name, 500), size: Number(item.size) || 0, contentType: clean(item.contentType, 160), isInline: Boolean(item.isInline), contentId: clean(item.contentId,1000) }));
    }
    return { messageId: clean(data.id, 500), internetMessageId:clean(data.internetMessageId,1000), conversationId:clean(data.conversationId,1000), subject: clean(data.subject, 1000), contentType: clean(data.body && data.body.contentType, 20).toLowerCase(), body: String(data.body && data.body.content || '').slice(0, 500000), webLink:/^https:\/\//i.test(clean(data.webLink,2000))?clean(data.webLink,2000):'', attachments };
  }

  function sharedResource(mailbox, suffix) { return `/users/${encodeURIComponent(clean(mailbox, 500))}${suffix}`; }
  async function probeSharedMailbox(userId, mailbox) {
    const address = clean(mailbox, 500).toLowerCase(); if (!address) return null;
    if (cfg.mock) return { mailboxId: address, email: address, displayName: address.split('@')[0], type: 'SHARED_DELEGATED' };
    const token = await accessToken(userId);
    try {
      await graphFetchWithToken(token, sharedResource(address, '/mailFolders/inbox?$select=id,displayName'));
      return { mailboxId: address, email: address, displayName: address, type: 'SHARED_DELEGATED' };
    } catch (error) { if ([401,403,404].includes(Number(error.statusCode))) return null; throw error; }
  }
  async function accessibleSharedMailboxes(userId, additionalCandidates = []) {
    const candidates = unique([...(cfg.sharedMailboxCandidates || []), ...(additionalCandidates || [])]).slice(0, 100), out = [];
    for (const candidate of candidates) { const accessible = await probeSharedMailbox(userId, candidate); if (accessible) out.push(accessible); }
    return out;
  }
  function sharedSearchExpression(context, options = {}) {
    const normalized = normalizeContext(context), requested = Array.isArray(options.fields)
      ? new Set(options.fields.map(value=>clean(value)).filter(field=>SEARCHABLE_FIELDS.includes(field))) : new Set(SEARCHABLE_FIELDS);
    const contextTerms = unique(SEARCHABLE_FIELDS.filter(field=>requested.has(field)).map(field=>quoted(normalized[field])).filter(Boolean)).slice(0,8);
    const manual = manualTerms(options.manual).map(quoted).filter(Boolean);
    if (manual.length && contextTerms.length) return `(${contextTerms.join(' OR ')}) AND ${manual.join(' AND ')}`;
    if (manual.length) return manual.join(' AND ');
    return contextTerms.join(' OR ');
  }
  async function searchSharedMailbox(userId, mailbox, contextInput, options = {}) {
    const context = normalizeContext(contextInput), accessible = await probeSharedMailbox(userId, mailbox);
    if (!accessible) throw Object.assign(new Error('Bu shared mailbox için Microsoft erişiminiz bulunmuyor.'), { code: 'MAILBOX_ACCESS_DENIED', statusCode: 403 });
    const pageSize = Math.max(10, Math.min(50, Number(options.pageSize) || 25)), page = Math.max(0, Math.min(100, Number(options.page) || 0));
    if (cfg.mock) {
      const items = mockMessages(context).map((message,index)=>({ ...normalizeMessage(message,index+1,context,options), mailboxType:'SHARED_DELEGATED', mailboxAddress:accessible.email }));
      return { items, page, pageSize, hasMore:false, mailbox:accessible };
    }
    const token = await accessToken(userId), expression = sharedSearchExpression(context, options);
    if (!expression) throw Object.assign(new Error('Shared mailbox araması için kriter bulunamadı.'), { code:'SEARCH_CONTEXT_EMPTY', statusCode:400 });
    const fetchTop=Math.min(1000,(page+1)*pageSize),params = new URLSearchParams({ '$search': expression, '$select': MESSAGE_FIELDS.join(','), '$top': String(fetchTop) });
    const data = await graphFetchWithToken(token, `${sharedResource(accessible.email, '/messages')}?${params.toString()}`, { headers:{ ConsistencyLevel:'eventual' } });
    let items=(data.value||[]).slice(page*pageSize,(page+1)*pageSize).map((message,index)=>({ ...normalizeMessage(message,page*pageSize+index+1,context,options), mailboxType:'SHARED_DELEGATED', mailboxAddress:accessible.email }));
    items=deduplicateMessages(items).filter(item=>item.messageId);return{items,page,pageSize,hasMore:Boolean(data['@odata.nextLink'])||items.length>=pageSize,mailbox:accessible};
  }
  async function mailboxMessageDetail(userId, mailboxType, mailbox, messageId, useApplication = false) {
    const type=clean(mailboxType,40).toUpperCase(),id=encodeURIComponent(clean(messageId,1000));if(!id)throw Object.assign(new Error('Mail kimliği zorunludur.'),{code:'MESSAGE_ID_REQUIRED',statusCode:400});
    if(type==='PERSONAL')return messageDetail(userId,messageId);
    if(cfg.mock)return{messageId,contentType:'html',body:'<p>Development mock shared mail detail.</p>',attachments:[{id:'mock-att-1',name:'order.pdf',size:1024,contentType:'application/pdf',attachmentType:'file'}]};
    if(!useApplication){const allowed=await probeSharedMailbox(userId,mailbox);if(!allowed)throw Object.assign(new Error('Mailbox erişimi reddedildi.'),{code:'MAILBOX_ACCESS_DENIED',statusCode:403});}
    const token=useApplication?await applicationAccessToken():await accessToken(userId),base=sharedResource(mailbox,`/messages/${id}`),data=await graphFetchWithToken(token,`${base}?$select=id,subject,body,hasAttachments,internetMessageId,conversationId,webLink`);let attachments=[];
    if(data.hasAttachments){const attachmentData=await graphFetchWithToken(token,`${base}/attachments?$select=id,name,size,contentType,isInline,contentId,@odata.type`);attachments=(attachmentData.value||[]).map(item=>({id:clean(item.id,500),name:clean(item.name,500),size:Number(item.size)||0,contentType:clean(item.contentType,160),isInline:Boolean(item.isInline),contentId:clean(item.contentId,1000),attachmentType:/itemAttachment/i.test(item['@odata.type'])?'item':/referenceAttachment/i.test(item['@odata.type'])?'reference':'file'}));}
    return{messageId:clean(data.id,500),internetMessageId:clean(data.internetMessageId,1000),conversationId:clean(data.conversationId,1000),subject:clean(data.subject,1000),contentType:clean(data.body&&data.body.contentType,20).toLowerCase(),body:String(data.body&&data.body.content||'').slice(0,500000),webLink:/^https:\/\//i.test(clean(data.webLink,2000))?clean(data.webLink,2000):'',attachments};
  }
  async function attachmentContent(userId, mailboxType, mailbox, messageId, attachmentId, useApplication = false) {
    if(cfg.mock)return{buffer:Buffer.from('%PDF-1.4\n% Buyer Log mock\n'),name:'order.pdf',contentType:'application/pdf',size:27,attachmentType:'file'};
    const type=clean(mailboxType,40).toUpperCase();if(type!=='PERSONAL'&&!useApplication){const allowed=await probeSharedMailbox(userId,mailbox);if(!allowed)throw Object.assign(new Error('Mailbox erişimi reddedildi.'),{code:'MAILBOX_ACCESS_DENIED',statusCode:403});}
    const token=useApplication?await applicationAccessToken():await accessToken(userId),base=type==='PERSONAL'?`/me/messages/${encodeURIComponent(clean(messageId,1000))}`:sharedResource(mailbox,`/messages/${encodeURIComponent(clean(messageId,1000))}`),meta=await graphFetchWithToken(token,`${base}/attachments/${encodeURIComponent(clean(attachmentId,1000))}`);
    if(!meta.contentBytes)throw Object.assign(new Error('Bu attachment tipi binary preview sağlamıyor.'),{code:'ATTACHMENT_CONTENT_UNAVAILABLE',statusCode:422});
    return{buffer:Buffer.from(meta.contentBytes,'base64'),name:clean(meta.name,500),contentType:clean(meta.contentType,160),size:Number(meta.size)||0,attachmentType:/itemAttachment/i.test(meta['@odata.type'])?'item':/referenceAttachment/i.test(meta['@odata.type'])?'reference':'file'};
  }
  async function applicationGraph(resource,request={}){const token=await applicationAccessToken(),value=clean(resource,10000),relative=value.startsWith(GRAPH_ROOT)?value.slice(GRAPH_ROOT.length):value;return graphFetchWithToken(token,relative,request);}

  const publicConfig = Object.freeze({ enabled: cfg.enabled, mock: cfg.mock, tenantId: cfg.tenantId, redirectUri: cfg.redirectUri, sharedMailboxConfigured:Boolean(cfg.sharedMailboxCandidates.length), applicationConfigured:Boolean(cfg.applicationClientId&&cfg.applicationTenantId&&cfg.applicationClientSecret) });
  return { config: publicConfig, setup, publicStatus, beginConnect, handleCallback, disconnect, search, messageDetail, contextHash, probeSharedMailbox, accessibleSharedMailboxes, searchSharedMailbox, mailboxMessageDetail, attachmentContent, applicationGraph, applicationAccessToken };
}

function mockMessages(context) {
  const order = context.orderNo || context.poNo || '4500123456', model = context.modelName || context.modelCode || 'MAKTANAS', plm = context.plmCode || '2111030', colour = context.colourCode || '3E8';
  return [
    { id: 'mock-1', internetMessageId: '<mock-1@buyerlog>', conversationId: 'mock-thread-1', subject: `RE: ${order} — ${model} Termin Revizesi`, from: { emailAddress: { name: 'Mehmet Yılmaz', address: 'mehmet@example.com' } }, receivedDateTime: new Date().toISOString(), bodyPreview: `${order} siparişi, ${plm} PLM ve ${colour} renk için termin revizesi.`, hasAttachments: true, isRead: false, importance: 'high', webLink: 'https://outlook.office.com/' },
    { id: 'mock-2', internetMessageId: '<mock-2@buyerlog>', conversationId: 'mock-thread-1', subject: `${model} shipment approval`, from: { emailAddress: { name: 'Supplier', address: 'supplier@example.com' } }, receivedDateTime: new Date(Date.now() - 86400000).toISOString(), bodyPreview: `Shipment approval for ${model} / ${colour}.`, hasAttachments: false, isRead: true, importance: 'normal', webLink: 'https://outlook.office.com/' },
  ];
}

module.exports = { cleanDisplayPreview,
  GRAPH_ROOT, SCOPES, MESSAGE_FIELDS, CONTEXT_FIELDS, SEARCHABLE_FIELDS, SCORE_WEIGHTS,
  normalizeGraphConfig, configurationState, jwtClaims, normalizeContext, escapeSearchTerm, manualTerms,
  buildSearchQueries, scoreMessage, normalizeMessage, deduplicateMessages,
  groupConversations, createOutlookGraphService,
};
