'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LOCAL_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');

const SCHEMA_VERSION = 1;
const SETTINGS_FILE = path.join(LOCAL_DATA_ROOT, 'outlook-setup-settings.json');
const SECRET_FILE = path.join(LOCAL_DATA_ROOT, '.outlook-setup-key');
const FEATURE_FIELDS = Object.freeze([
  'sharedMailboxEnabled', 'manualLinkEnabled', 'timelineEnabled',
  'attachmentPreviewEnabled', 'aiSummaryEnabled', 'intelligenceEnabled',
  'changeNotificationsEnabled',
]);
const FEATURE_ENV_KEYS = Object.freeze({
  sharedMailboxEnabled:'OUTLOOK_SHARED_MAILBOX_ENABLED', manualLinkEnabled:'OUTLOOK_MANUAL_LINK_ENABLED', timelineEnabled:'OUTLOOK_TIMELINE_ENABLED',
  attachmentPreviewEnabled:'OUTLOOK_ATTACHMENT_PREVIEW_ENABLED', aiSummaryEnabled:'OUTLOOK_AI_SUMMARY_ENABLED', intelligenceEnabled:'OUTLOOK_INTELLIGENCE_ENABLED', changeNotificationsEnabled:'OUTLOOK_CHANGE_NOTIFICATIONS_ENABLED',
});
const ENV_KEYS = Object.freeze([
  'MICROSOFT_GRAPH_ENABLED', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_TENANT_ID',
  'MICROSOFT_REDIRECT_URI', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TOKEN_ENCRYPTION_KEY',
  'MICROSOFT_APPLICATION_CLIENT_ID', 'MICROSOFT_APPLICATION_TENANT_ID',
  'MICROSOFT_APPLICATION_CLIENT_SECRET', 'MICROSOFT_SHARED_MAILBOXES',
  'MICROSOFT_GRAPH_NOTIFICATION_URL', 'MICROSOFT_GRAPH_LIFECYCLE_URL',
  'MICROSOFT_GRAPH_CLIENT_STATE', 'MICROSOFT_GRAPH_SUBSCRIPTION_HOURS',
  'MICROSOFT_GRAPH_RENEWAL_LEAD_MS', 'MICROSOFT_GRAPH_DELTA_FOLDERS',
  'OUTLOOK_SHARED_MAILBOX_ENABLED', 'OUTLOOK_MANUAL_LINK_ENABLED',
  'OUTLOOK_TIMELINE_ENABLED', 'OUTLOOK_ATTACHMENT_PREVIEW_ENABLED',
  'OUTLOOK_AI_SUMMARY_ENABLED', 'OUTLOOK_INTELLIGENCE_ENABLED',
  'OUTLOOK_CHANGE_NOTIFICATIONS_ENABLED',
]);

function clean(value, max = 2000) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}
function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    graph: { enabled:false, clientId:'', tenantId:'organizations', redirectUri:'', encryptedClientSecret:null, sharedMailboxCandidates:[] },
    application: { clientId:'', tenantId:'', encryptedClientSecret:null },
    webhook: { notificationUrl:'', lifecycleUrl:'', encryptedClientState:null, subscriptionHours:120, renewalLeadMs:86400000, deltaFolders:['inbox'] },
    features: {
      sharedMailboxEnabled:true, manualLinkEnabled:true, timelineEnabled:true,
      attachmentPreviewEnabled:true, aiSummaryEnabled:true, intelligenceEnabled:true,
      changeNotificationsEnabled:false,
    },
    encryptedTokenKey:null,
    updatedAt:null,
    updatedBy:null,
  };
}
function secretKey() {
  fs.mkdirSync(LOCAL_DATA_ROOT, { recursive:true });
  const fromEnv = clean(process.env.BUYER_LOG_OUTLOOK_SETTINGS_KEY, 2000);
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE);
    if (stored.length === 32) return stored;
  }
  const generated = crypto.randomBytes(32);
  atomicWriteBuffer(SECRET_FILE, generated);
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) {}
  return generated;
}
function encrypt(value) {
  const text = clean(value, 10000); if (!text) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { v:1, alg:'aes-256-gcm', iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), data:data.toString('base64') };
}
function decrypt(payload) {
  if (!payload || payload.alg !== 'aes-256-gcm') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return clean(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'), 10000);
  } catch (_) { return ''; }
}
function mergeSettings(raw) {
  const defaults = defaultSettings(), source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...defaults, ...source, schemaVersion:SCHEMA_VERSION,
    graph:{ ...defaults.graph, ...(source.graph || {}) },
    application:{ ...defaults.application, ...(source.application || {}) },
    webhook:{ ...defaults.webhook, ...(source.webhook || {}) },
    features:{ ...defaults.features, ...(source.features || {}) },
  };
}
function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return defaultSettings();
  try { return mergeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); }
  catch (_) { return defaultSettings(); }
}
function validId(value, field, optional = false) {
  const text = clean(value, 160);
  if (!text && optional) return '';
  if (!text || !/^[A-Za-z0-9._-]{3,160}$/.test(text)) throw Object.assign(new Error(`${field} geçerli değil.`), { code:'OUTLOOK_SETUP_INVALID', statusCode:400 });
  return text;
}
function validTenant(value, optional = false) {
  const text = clean(value || (optional ? '' : 'organizations'), 160);
  if (!text && optional) return '';
  if (!/^(organizations|common|consumers|[A-Za-z0-9][A-Za-z0-9.-]{1,158}[A-Za-z0-9])$/i.test(text)) throw Object.assign(new Error('Microsoft Tenant ID geçerli değil.'), { code:'OUTLOOK_SETUP_INVALID', statusCode:400 });
  return text;
}
function validUrl(value, field, optional = false) {
  const text = clean(value, 2000);
  if (!text && optional) return '';
  let parsed;
  try { parsed = new URL(text); } catch (_) { throw Object.assign(new Error(`${field} geçerli bir URL olmalıdır.`), { code:'OUTLOOK_SETUP_INVALID', statusCode:400 }); }
  const local = ['localhost','127.0.0.1','::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw Object.assign(new Error(`${field} HTTPS olmalıdır; yalnız localhost için HTTP kullanılabilir.`), { code:'OUTLOOK_SETUP_INVALID', statusCode:400 });
  return parsed.toString();
}
function emails(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/), out = [], seen = new Set();
  for (const raw of values) {
    const email = clean(raw, 320).toLowerCase(); if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error(`Shared mailbox adresi geçerli değil: ${email}`), { code:'OUTLOOK_SETUP_INVALID', statusCode:400 });
    if (!seen.has(email)) { seen.add(email); out.push(email); }
  }
  return out.slice(0, 100);
}
function folders(value) {
  const values = Array.isArray(value) ? value : String(value || 'inbox').split(/[\n,;]+/);
  const out = [...new Set(values.map(item=>clean(item,200).toLowerCase()).filter(item=>/^[a-z0-9_-]{1,200}$/.test(item)))];
  return out.length ? out.slice(0,20) : ['inbox'];
}
function saveSettings(input = {}, actorId = '') {
  const current = loadSettings(), next = mergeSettings(current), graph = input.graph || {}, application = input.application || {}, webhook = input.webhook || {}, features = input.features || {};
  next.graph.enabled = bool(graph.enabled, next.graph.enabled);
  next.graph.clientId = validId(graph.clientId, 'Microsoft Client ID', !next.graph.enabled);
  next.graph.tenantId = validTenant(graph.tenantId || next.graph.tenantId);
  next.graph.redirectUri = validUrl(graph.redirectUri, 'Redirect URI', !next.graph.enabled);
  if (clean(graph.clientSecret, 10000)) next.graph.encryptedClientSecret = encrypt(graph.clientSecret);
  if (graph.clearClientSecret === true) next.graph.encryptedClientSecret = null;
  next.graph.sharedMailboxCandidates = emails(graph.sharedMailboxCandidates || []);
  next.application.clientId = validId(application.clientId, 'Application Client ID', true);
  next.application.tenantId = validTenant(application.tenantId, true);
  if (clean(application.clientSecret, 10000)) next.application.encryptedClientSecret = encrypt(application.clientSecret);
  if (application.clearClientSecret === true) next.application.encryptedClientSecret = null;
  next.webhook.notificationUrl = validUrl(webhook.notificationUrl, 'Graph Notification URL', true);
  next.webhook.lifecycleUrl = validUrl(webhook.lifecycleUrl, 'Graph Lifecycle URL', true);
  next.webhook.subscriptionHours = Math.max(1, Math.min(168, Math.round(Number(webhook.subscriptionHours) || 120)));
  next.webhook.renewalLeadMs = Math.max(3600000, Math.min(7*86400000, Math.round(Number(webhook.renewalLeadMs) || 86400000)));
  next.webhook.deltaFolders = folders(webhook.deltaFolders);
  for (const field of FEATURE_FIELDS) if (Object.prototype.hasOwnProperty.call(features, field)) next.features[field] = bool(features[field]);
  if (!next.encryptedTokenKey) next.encryptedTokenKey = encrypt(crypto.randomBytes(32).toString('base64url'));
  if (!next.webhook.encryptedClientState) next.webhook.encryptedClientState = encrypt(crypto.randomBytes(32).toString('base64url'));
  next.updatedAt = new Date().toISOString(); next.updatedBy = clean(actorId, 160) || null;
  atomicWriteJson(SETTINGS_FILE, next);
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch (_) {}
  return publicSettings({}, process.env);
}
function savedRuntime() {
  const settings = loadSettings();
  return {
    settings,
    delegatedClientSecret:decrypt(settings.graph.encryptedClientSecret),
    clientSecret:decrypt(settings.application.encryptedClientSecret),
    tokenEncryptionKey:decrypt(settings.encryptedTokenKey),
    clientState:decrypt(settings.webhook.encryptedClientState),
  };
}
function applyToRuntime(baseConfig = {}, baseEnv = process.env) {
  const saved = savedRuntime(), settings = saved.settings, env = { ...baseEnv }, hasSaved = fs.existsSync(SETTINGS_FILE);
  const setDefault = (key, value) => { if (env[key] == null || env[key] === '') env[key] = value; };
  const microsoftGraph = { ...(baseConfig.microsoftGraph || {}) }, intelligence = { ...(baseConfig.outlookMailIntelligence || {}) };
  if (hasSaved) {
    Object.assign(microsoftGraph, {
      enabled:settings.graph.enabled, clientId:settings.graph.clientId, tenantId:settings.graph.tenantId, redirectUri:settings.graph.redirectUri, clientSecret:saved.delegatedClientSecret,
      tokenEncryptionKey:saved.tokenEncryptionKey, applicationClientId:settings.application.clientId, applicationTenantId:settings.application.tenantId,
      applicationClientSecret:saved.clientSecret, sharedMailboxCandidates:settings.graph.sharedMailboxCandidates,
    });
    Object.assign(intelligence, settings.features, {
      notificationUrl:settings.webhook.notificationUrl, lifecycleUrl:settings.webhook.lifecycleUrl, clientState:saved.clientState,
      subscriptionHours:settings.webhook.subscriptionHours, renewalLeadMs:settings.webhook.renewalLeadMs, deltaFolders:settings.webhook.deltaFolders,
    });
    setDefault('MICROSOFT_GRAPH_NOTIFICATION_URL', settings.webhook.notificationUrl);
    setDefault('MICROSOFT_GRAPH_LIFECYCLE_URL', settings.webhook.lifecycleUrl);
    setDefault('MICROSOFT_GRAPH_CLIENT_STATE', saved.clientState);
    setDefault('MICROSOFT_GRAPH_SUBSCRIPTION_HOURS', String(settings.webhook.subscriptionHours));
    setDefault('MICROSOFT_GRAPH_RENEWAL_LEAD_MS', String(settings.webhook.renewalLeadMs));
    setDefault('MICROSOFT_GRAPH_DELTA_FOLDERS', settings.webhook.deltaFolders.join(';'));
    setDefault('OUTLOOK_CHANGE_NOTIFICATIONS_ENABLED', settings.features.changeNotificationsEnabled ? 'true' : 'false');
  }
  return { config:{ ...baseConfig, microsoftGraph, outlookMailIntelligence:intelligence }, env };
}
function maskSecret(value) {
  const text = clean(value, 10000); return text ? `••••••••${text.slice(-4)}` : '';
}
function publicSettings(baseConfig = {}, baseEnv = process.env) {
  const saved = savedRuntime(), effective = applyToRuntime(baseConfig, baseEnv), env = effective.env, settings = saved.settings, graphRaw=effective.config.microsoftGraph||{}, intelligence=effective.config.outlookMailIntelligence||{};
  const envOr=(key,fallback='')=>env[key]!=null&&String(env[key]).trim()!==''?env[key]:fallback;
  const graphEnabled=env.MICROSOFT_GRAPH_ENABLED==null?Boolean(graphRaw.enabled):bool(env.MICROSOFT_GRAPH_ENABLED);
  const delegatedSecret=envOr('MICROSOFT_CLIENT_SECRET',graphRaw.clientSecret);
  const applicationSecret=envOr('MICROSOFT_APPLICATION_CLIENT_SECRET',graphRaw.applicationClientSecret);
  const tokenKey=envOr('MICROSOFT_TOKEN_ENCRYPTION_KEY',graphRaw.tokenEncryptionKey);
  const featureValue=field=>env[FEATURE_ENV_KEYS[field]]==null?bool(intelligence[field],settings.features[field]):bool(env[FEATURE_ENV_KEYS[field]]);
  const overrides = ENV_KEYS.filter(key => baseEnv[key] != null && String(baseEnv[key]).trim() !== '');
  return {
    schemaVersion:SCHEMA_VERSION,
    graph:{
      enabled:graphEnabled, clientId:clean(envOr('MICROSOFT_CLIENT_ID',graphRaw.clientId),160), tenantId:clean(envOr('MICROSOFT_TENANT_ID',graphRaw.tenantId||'organizations'),160), redirectUri:clean(envOr('MICROSOFT_REDIRECT_URI',graphRaw.redirectUri),2000),
      hasClientSecret:Boolean(clean(delegatedSecret,10000)), maskedClientSecret:maskSecret(delegatedSecret),
      sharedMailboxCandidates:emails(envOr('MICROSOFT_SHARED_MAILBOXES',graphRaw.sharedMailboxCandidates||[])),
    },
    application:{ clientId:clean(envOr('MICROSOFT_APPLICATION_CLIENT_ID',graphRaw.applicationClientId),160), tenantId:clean(envOr('MICROSOFT_APPLICATION_TENANT_ID',graphRaw.applicationTenantId),160), hasClientSecret:Boolean(clean(applicationSecret,10000)), maskedClientSecret:maskSecret(applicationSecret) },
    webhook:{ notificationUrl:clean(envOr('MICROSOFT_GRAPH_NOTIFICATION_URL',intelligence.notificationUrl),2000), lifecycleUrl:clean(envOr('MICROSOFT_GRAPH_LIFECYCLE_URL',intelligence.lifecycleUrl),2000), hasClientState:Boolean(clean(envOr('MICROSOFT_GRAPH_CLIENT_STATE',intelligence.clientState),1000)), subscriptionHours:Number(envOr('MICROSOFT_GRAPH_SUBSCRIPTION_HOURS',intelligence.subscriptionHours))||120, renewalLeadMs:Number(envOr('MICROSOFT_GRAPH_RENEWAL_LEAD_MS',intelligence.renewalLeadMs))||86400000, deltaFolders:folders(envOr('MICROSOFT_GRAPH_DELTA_FOLDERS',intelligence.deltaFolders||['inbox'])) },
    features:Object.fromEntries(FEATURE_FIELDS.map(field=>[field,featureValue(field)])),
    security:{ tokenEncryptionReady:Boolean(clean(tokenKey,1000)), secretsEncryptedAtRest:true, environmentOverrides:overrides },
    restartRequired:false, canRestart:process.env.BL_KEEP_ALIVE==='1', updatedAt:settings.updatedAt, updatedBy:settings.updatedBy,
  };
}

module.exports = { SCHEMA_VERSION, SETTINGS_FILE, SECRET_FILE, FEATURE_FIELDS, FEATURE_ENV_KEYS, loadSettings, saveSettings, savedRuntime, applyToRuntime, publicSettings, validUrl, emails, folders };
