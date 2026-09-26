'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'outlook-mail.js'), 'utf8');
const SERVER = require('./helpers/server-source')();

function run(script, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-outlook-setup-'));
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      BUYER_LOG_LOCAL_DATA_ROOT:root,
      BUYER_LOG_SERVER_DATA_ROOT:path.join(root, 'server-data'),
      BUYER_LOG_DATA_ROOT:path.join(root, 'app-data'),
      ...extraEnv,
    },
  });
  try { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
  finally { fs.rmSync(root, { recursive:true, force:true }); }
}

test('v7.06 CP/Orders Outlook satır çözümleyicisi kapsayıcı nesne yerine .rows dizisini kullanır', () => {
  const start = APP.indexOf('window.BLGetOutlookRow=function');
  const end = APP.indexOf('\n};', start) + 3;
  const block = APP.slice(start, end);
  assert.match(block, /Array\.isArray\(primary&&primary\.rows\)/);
  assert.match(block, /Array\.isArray\(fallback&&fallback\.rows\)/);
  assert.doesNotMatch(block, /const rows=module==='orders'\?\(state\.orders\|\|state\.cp\|\|\[\]\)/);
});

test('v7.06 Outlook setup secret değerlerini şifreli saklar ve public API maskeler', () => {
  const data = run(`
    const fs=require('fs');
    const settings=require('./server/lib/outlook-setup-settings');
    settings.saveSettings({
      graph:{enabled:true,clientId:'client-123',tenantId:'organizations',redirectUri:'http://localhost:4173/api/outlook/callback',sharedMailboxCandidates:['buying@example.com']},
      application:{clientId:'application-123',tenantId:'tenant-123',clientSecret:'super-secret-value'},
      webhook:{notificationUrl:'https://buyerlog.example/api/outlook/webhook',lifecycleUrl:'https://buyerlog.example/api/outlook/lifecycle',deltaFolders:['inbox']},
      features:{changeNotificationsEnabled:true}
    },'moderator');
    const raw=fs.readFileSync(settings.SETTINGS_FILE,'utf8');
    const pub=settings.publicSettings({},{}),runtime=settings.applyToRuntime({},{});
    process.stdout.write(JSON.stringify({rawContainsSecret:raw.includes('super-secret-value'),masked:pub.application.maskedClientSecret,hasSecret:pub.application.hasClientSecret,runtimeSecret:runtime.config.microsoftGraph.applicationClientSecret,tokenReady:pub.security.tokenEncryptionReady,clientState:pub.webhook.hasClientState,notifications:runtime.env.OUTLOOK_CHANGE_NOTIFICATIONS_ENABLED}));
  `);
  assert.equal(data.rawContainsSecret, false);
  assert.equal(data.hasSecret, true);
  assert.match(data.masked, /alue$/);
  assert.equal(data.runtimeSecret, 'super-secret-value');
  assert.equal(data.tokenReady, true);
  assert.equal(data.clientState, true);
  assert.equal(data.notifications, 'true');
});

test('v7.06 IT ortam değişkenleri uygulama içinden kaydedilen değerlerin önünde kalır', () => {
  const data = run(`
    const settings=require('./server/lib/outlook-setup-settings');
    settings.saveSettings({graph:{enabled:true,clientId:'saved-client',tenantId:'organizations',redirectUri:'http://localhost:4173/api/outlook/callback'}},'moderator');
    const env={MICROSOFT_CLIENT_ID:'it-client',MICROSOFT_TENANT_ID:'it-tenant.example'};
    const runtime=settings.applyToRuntime({},env),pub=settings.publicSettings({},env);
    process.stdout.write(JSON.stringify({clientId:runtime.env.MICROSOFT_CLIENT_ID,tenantId:runtime.env.MICROSOFT_TENANT_ID,overrides:pub.security.environmentOverrides}));
  `);
  assert.equal(data.clientId, 'it-client');
  assert.equal(data.tenantId, 'it-tenant.example');
  assert.ok(data.overrides.includes('MICROSOFT_CLIENT_ID'));
});

test('v7.06 uygulama içi kayıt yoksa mevcut config.json Graph ayarları korunur', () => {
  const data = run(`
    const settings=require('./server/lib/outlook-setup-settings');
    const base={microsoftGraph:{enabled:true,clientId:'config-client',tenantId:'organizations',redirectUri:'http://localhost:4173/api/outlook/callback'}};
    const runtime=settings.applyToRuntime(base,{}),pub=settings.publicSettings(base,{});
    process.stdout.write(JSON.stringify({config:runtime.config.microsoftGraph,forcedEnv:runtime.env.MICROSOFT_GRAPH_ENABLED,publicGraph:pub.graph}));
  `);
  assert.equal(data.config.clientId, 'config-client');
  assert.equal(data.forcedEnv, undefined);
  assert.equal(data.publicGraph.enabled, true);
  assert.equal(data.publicGraph.clientId, 'config-client');
});

test('v7.06 uzak HTTP webhook adresi reddedilir', () => {
  const data = run(`
    const settings=require('./server/lib/outlook-setup-settings');
    let error=null;try{settings.saveSettings({graph:{enabled:false},webhook:{notificationUrl:'http://buyerlog.example/webhook'}},'moderator');}catch(err){error={code:err.code,statusCode:err.statusCode};}
    process.stdout.write(JSON.stringify(error));
  `);
  assert.equal(data.code, 'OUTLOOK_SETUP_INVALID');
  assert.equal(data.statusCode, 400);
});

test('v7.06 kurulum sihirbazı, admin API ve gerçek Graph test aksiyonları birlikte bulunur', () => {
  assert.match(UI, /Microsoft 365 Kurulum Sihirbazı/);
  assert.match(UI, /data-outlook-setup-form/);
  assert.match(UI, /\/api\/outlook\/v2\/admin\/setup\/test/);
  assert.match(SERVER, /OUTLOOK_SETUP_UPDATED/);
  assert.match(SERVER, /EXCHANGE_RBAC_MAILBOX/);
  assert.match(SERVER, /requireCapability\('OUTLOOK_INTELLIGENCE\.ADMIN'\)/);
  assert.match(SERVER, /BL_KEEP_ALIVE!=='1'/);
});

test('v7.07 kişisel Outlook Client Secret uygulama içinden şifreli saklanır, maskelenir ve runtime Graph configine aktarılır', () => {
  const data = run(`
    const fs=require('fs');
    const settings=require('./server/lib/outlook-setup-settings');
    settings.saveSettings({graph:{enabled:true,clientId:'personal-client-123',tenantId:'organizations',redirectUri:'http://localhost:4173/api/outlook/callback',clientSecret:'personal-secret-value'}},'moderator');
    const raw=fs.readFileSync(settings.SETTINGS_FILE,'utf8');
    const pub=settings.publicSettings({},{}),runtime=settings.applyToRuntime({},{});
    process.stdout.write(JSON.stringify({rawContainsSecret:raw.includes('personal-secret-value'),hasSecret:pub.graph.hasClientSecret,masked:pub.graph.maskedClientSecret,runtimeSecret:runtime.config.microsoftGraph.clientSecret}));
  `);
  assert.equal(data.rawContainsSecret, false);
  assert.equal(data.hasSecret, true);
  assert.match(data.masked, /alue$/);
  assert.equal(data.runtimeSecret, 'personal-secret-value');
  assert.match(UI, /name="delegatedClientSecret"/);
  assert.match(UI, /clearDelegatedSecret/);
  assert.match(SERVER, /graph\.hasClientSecret/);
});

test('v7.07 MICROSOFT_CLIENT_SECRET environment override kişisel secret üzerinde önceliklidir', () => {
  const data = run(`
    const settings=require('./server/lib/outlook-setup-settings');
    settings.saveSettings({graph:{enabled:true,clientId:'saved-client',tenantId:'organizations',redirectUri:'http://localhost:4173/api/outlook/callback',clientSecret:'saved-secret'}},'moderator');
    const env={MICROSOFT_CLIENT_SECRET:'it-secret'};
    const pub=settings.publicSettings({},env);
    process.stdout.write(JSON.stringify({hasSecret:pub.graph.hasClientSecret,masked:pub.graph.maskedClientSecret,overrides:pub.security.environmentOverrides}));
  `);
  assert.equal(data.hasSecret, true);
  assert.match(data.masked, /cret$/);
  assert.ok(data.overrides.includes('MICROSOFT_CLIENT_SECRET'));
});
