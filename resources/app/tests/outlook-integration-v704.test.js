'use strict';

/* V7.04 — Microsoft 365 / Outlook sipariş maili entegrasyonu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const graph = require('../server/lib/outlook-graph');
const iam = require('../server/lib/iam-core');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const USER_ACCESS = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-access.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'outlook-mail.js'), 'utf8');
const MAIL_CONTENT = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'outlook-mail-content.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const USER_UI = fs.readFileSync(path.join(ROOT, 'public', 'user-access-ui.js'), 'utf8');
const USER_MANAGEMENT = fs.readFileSync(path.join(ROOT, 'public', 'user-management.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function jwt(payload) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.signature`;
}
function response(ok, body, status = ok ? 200 : 400, headers = {}) {
  return { ok, status, json: async () => body, headers: { get: key => headers[String(key).toLowerCase()] || null } };
}

test('yalnız delegated Mail.Read/Mail.Read.Shared scope istenir; yazma/gönderme scope yoktur', () => {
  assert.deepEqual(graph.SCOPES, ['openid', 'profile', 'email', 'offline_access', 'Mail.Read', 'Mail.Read.Shared']);
  const joined = graph.SCOPES.join(' ');
  assert.doesNotMatch(joined, /Mail\.ReadWrite|Mail\.Send|\.default/i);
});

test('feature flag ve secret/token anahtarı public service configine sızmaz', () => {
  const service = graph.createOutlookGraphService({
    env: { NODE_ENV: 'production', MICROSOFT_GRAPH_ENABLED: 'true', MICROSOFT_CLIENT_ID: 'client', MICROSOFT_TENANT_ID: 'tenant', MICROSOFT_REDIRECT_URI: 'https://buyerlog.example/api/outlook/callback', MICROSOFT_CLIENT_SECRET: 'client-secret-value', MICROSOFT_TOKEN_ENCRYPTION_KEY: '01234567890123456789012345678901' },
    dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-outlook-config-')),
    fetchImpl: async () => response(false, {}),
  });
  assert.equal(service.setup.ready, true);
  assert.equal(service.config.clientSecret, undefined);
  assert.equal(service.config.tokenEncryptionKey, undefined);
  assert.doesNotMatch(JSON.stringify(service.config), /client-secret-value|0123456789/);
});

test('production mock kapalı kalır ve eksik token şifreleme anahtarı kurulumu durdurur', () => {
  const config = { microsoftGraph: { enabled: true, mock: true, clientId: 'client', tenantId: 'tenant', redirectUri: 'https://buyerlog.example/api/outlook/callback', clientSecret: 'server-secret' } };
  const normalized = graph.normalizeGraphConfig(config, { NODE_ENV: 'production' });
  assert.equal(normalized.mock, false);
  assert.equal(graph.configurationState(normalized).code, 'TOKEN_KEY_REQUIRED');
});

test('v7.07 Web OAuth yapılandırması Client Secret olmadan hazır sayılmaz', () => {
  const normalized = graph.normalizeGraphConfig({ microsoftGraph:{ enabled:true, clientId:'client', tenantId:'tenant', redirectUri:'http://localhost:4173/api/outlook/callback', tokenEncryptionKey:'01234567890123456789012345678901' } }, { NODE_ENV:'production' });
  assert.equal(graph.configurationState(normalized).code, 'CLIENT_SECRET_REQUIRED');
});

test('Authorization Code + PKCE bağlantısı kullanıcıya bağlanır ve tokenlar AES-GCM ile şifrelenir', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-outlook-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const service = graph.createOutlookGraphService({
    env: { NODE_ENV: 'test', MICROSOFT_GRAPH_ENABLED: 'true', MICROSOFT_CLIENT_ID: 'client-id', MICROSOFT_TENANT_ID: 'tenant-id', MICROSOFT_REDIRECT_URI: 'http://localhost:4173/api/outlook/callback', MICROSOFT_CLIENT_SECRET: 'server-only-secret', MICROSOFT_TOKEN_ENCRYPTION_KEY: '01234567890123456789012345678901' },
    dataRoot: root,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.match(url, /\/token$/);
      assert.match(String(options.body), /code_verifier=/);
      assert.match(String(options.body), /client_secret=server-only-secret/);
      return response(true, { access_token: 'TOP-SECRET-ACCESS', refresh_token: 'TOP-SECRET-REFRESH', expires_in: 3600, scope: 'Mail.Read', id_token: jwt({ oid: 'microsoft-object', tid: 'tenant-id', preferred_username: 'gokberk@example.com', name: 'Gökberk Çelebi' }) });
    },
  });
  const start = service.beginConnect({ id: 'moderator' }, { headers: { host: 'localhost:4173' } });
  const authorize = new URL(start.authorizeUrl), state = authorize.searchParams.get('state');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorize.searchParams.get('code_challenge'));
  assert.match(authorize.searchParams.get('scope'), /Mail\.Read/);
  const linked = await service.handleCallback({ state, code: 'authorization-code' });
  assert.equal(linked.userId, 'moderator');
  assert.equal(linked.email, 'gokberk@example.com');
  assert.equal(calls.length, 1, 'Mail.Read dışında /me User.Read çağrısı yapılmamalı');
  const raw = fs.readFileSync(path.join(root, 'outlook-connections.json'), 'utf8');
  assert.doesNotMatch(raw, /TOP-SECRET-ACCESS|TOP-SECRET-REFRESH|server-only-secret/);
  const stored = JSON.parse(raw).entries.moderator;
  assert.equal(stored.token.alg, 'A256GCM');
  assert.ok(stored.token.iv && stored.token.tag && stored.token.ciphertext);
  assert.equal(service.publicStatus('moderator').connected, true);
  await assert.rejects(() => service.handleCallback({ state, code: 'replay' }), error => error.code === 'OAUTH_STATE_INVALID');
});

test('query builder KQL karakterlerini/operators temizler ve staged arama üretir', () => {
  const queries = graph.buildSearchQueries({ orderNo: '4500" OR evil:(x)', plmCode: '2111030', modelName: 'MAKTANAS', colourCode: '3E8', manufacturer: 'ABC TEXTILE' }, { manual: "shipment' NOT secret", dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert.ok(queries.some(item => item.stage === 1));
  assert.ok(queries.some(item => item.stage === 2));
  assert.ok(queries.some(item => item.stage === 4));
  assert.ok(queries.some(item => item.stage === 5));
  assert.ok(queries.some(item => item.stage === 6));
  assert.ok(queries.every(item => /received>=2026-01-01/.test(item.queryString)));
  assert.ok(queries.every(item => !/\bOR\b|\bNOT\b|evil:|\(/i.test(item.queryString)));
});

test('context normalize, relevance, tekilleştirme ve conversation grouping çalışır', () => {
  const context = graph.normalizeContext({ orderNo: '4500123456', plmCode: '2111030', modelName: 'MAKTANAS', colourCode: '3E8', ignored: 'no' });
  assert.equal(context.ignored, undefined);
  const base = { subject: 'RE: 4500123456 MAKTANAS', bodyPreview: 'PLM 2111030 colour 3E8', receivedDateTime: '2026-08-25T08:00:00Z', from: { emailAddress: { name: 'Supplier', address: 'supplier@example.com' } } };
  const scored = graph.scoreMessage(base, context, { fields: ['orderNo', 'plmCode', 'modelName', 'colourCode'] });
  assert.ok(scored.score >= 95);
  assert.deepEqual(new Set(scored.matchedFields.map(item => item.field)), new Set(['orderNo', 'plmCode', 'modelName', 'colourCode']));
  const first = graph.normalizeMessage({ ...base, id: '1', internetMessageId: '<same>', conversationId: 'thread', webLink: 'https://outlook.office.com/mail/1' }, 1, context, {});
  const duplicate = graph.normalizeMessage({ ...base, id: '2', internetMessageId: '<same>', conversationId: 'thread' }, 2, context, {});
  const second = graph.normalizeMessage({ ...base, id: '3', internetMessageId: '<other>', conversationId: 'thread' }, 3, context, {});
  const unique = graph.deduplicateMessages([first, duplicate, second]);
  assert.equal(unique.length, 2);
  const groups = graph.groupConversations(unique);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('mock arama cachei kullanıcı ve filtre/sayfa imzasıyla izole edilir', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-outlook-cache-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = graph.createOutlookGraphService({ config: { microsoftGraph: { enabled: true, mock: true } }, env: { NODE_ENV: 'test' }, dataRoot: root });
  const context = { orderNo: '4500123456', modelName: 'MAKTANAS' };
  const first = await service.search('user-a', context, { sort: 'relevance', page: 0 });
  const cached = await service.search('user-a', context, { sort: 'relevance', page: 0 });
  const differentSort = await service.search('user-a', context, { sort: 'oldest', page: 0 });
  const otherUser = await service.search('user-b', context, { sort: 'relevance', page: 0 });
  assert.equal(first.cached, undefined);
  assert.equal(cached.cached, true);
  assert.equal(differentSort.cached, undefined);
  assert.equal(otherUser.cached, undefined);
  assert.ok(first.items.length >= 1);
});

test('IAM migrasyonu mevcut Gökberk moderatorü korur ve Outlook yetkisini mevcut matrise ekler', () => {
  const migrated = iam.migrateStore({ schemaVersion: 6, moderator: { id: 'moderator', username: 'Gökberk', displayName: 'Gökberk', role: 'moderator', systemRole: 'moderator', enabled: true }, users: [], iam: { version: 3, roles: {} } });
  assert.equal(migrated.moderator.id, 'moderator');
  assert.equal(migrated.moderator.displayName, 'Gökberk');
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.iam.version, 5);
  assert.ok(migrated.iam.roles.moderator.permissions.includes(iam.OUTLOOK_MAIL_SEARCH));
  assert.equal(iam.OUTLOOK_MAIL_SEARCH, 'OUTLOOK.SEARCH');
});

test('tüm Outlook API uçları backend permission middleware ile korunur', () => {
  for (const route of ['status','connect','disconnect','search','message-detail','message-opened']) {
    const pattern = new RegExp(`app\\.(?:get|post)\\('/api/outlook/${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^\\n]+requireCapability\\('OUTLOOK\\.SEARCH'\\)`);
    assert.match(SERVER, pattern, route);
  }
  assert.match(SERVER, /app\.get\('\/api\/outlook\/callback'/);
  assert.match(USER_ACCESS, /OUTLOOK_PERMISSION_CHANGED/);
  assert.doesNotMatch(UI + INDEX, /MICROSOFT_CLIENT_SECRET|MICROSOFT_TOKEN_ENCRYPTION_KEY|Authorization:\s*Bearer/);
});

test('Role Matrix, kullanıcı menüsü ve dört iş modülü ortak Outlook aksiyonuna bağlıdır', () => {
  assert.match(USER_MANAGEMENT, /resources:\s*\['OUTLOOK'\]/);
  assert.match(USER_MANAGEMENT, /SEARCH:/);
  assert.match(USER_UI, /data-outlook-settings-menu/);
  assert.match(APP, /function outlookRowActionHtml/);
  assert.match(APP, /case 'ordercode':[\s\S]{0,600}outlookRowActionHtml\('',id\)/);
  assert.match(APP, /outlookRowActionHtml\('collection',r\.id\)/);
  assert.match(APP, /outlookRowActionHtml\('backlog',rowIndex\)/);
  assert.match(APP, /window\.BLGetOutlookRow=function/);
  assert.match(UI, /#cpTable/);
  assert.match(UI, /#ordersTable/);
  assert.match(UI, /#kolTable/);
  assert.match(UI, /#backlogDetailTableWrap/);
});

test('drawer performans, hata ve XSS korumalarını içerir', () => {
  assert.match(UI, /AbortController/);
  assert.match(UI, /requestId !== state\.requestId/);
  assert.match(UI, /setTimeout\(\(\) => search\(\{ reset:true \}\), 500\)/);
  assert.match(UI, /data-outlook-more/);
  assert.match(UI, /outlookSkeleton/);
  assert.match(UI, /GRAPH_THROTTLED/);
  assert.match(MAIL_CONTENT, /script\\b/);
  assert.match(MAIL_CONTENT, /iframe\|object\|embed\|form/);
  assert.match(MAIL_CONTENT, /isTrackingImage/);
  assert.match(UI, /data\.content\|\|\{\}/);
  assert.match(UI, /window\.open\(link,'_blank','noopener,noreferrer'\)/);
});

test('OAuth bağlantısı profil/workspace kopyalama kategorilerine dahil değildir', () => {
  const copyArea = USER_MANAGEMENT.match(/copy:\s*\{[\s\S]{0,900}/)?.[0] || '';
  assert.ok(copyArea, 'profil kopyalama kategori modeli bulunmalı');
  assert.doesNotMatch(copyArea, /outlook|microsoft|oauth|token/i);
  assert.doesNotMatch(USER_ACCESS.match(/function permissionCopyHandler[\s\S]{0,18000}/)?.[0] || '', /outlook-connections|refreshToken|accessToken/);
});
