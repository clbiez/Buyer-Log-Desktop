'use strict';
/* Kurumsal oturum koruyucu (PLM + LCW AI; OAB hariç).
 * Düşen oturum kullanıcı komutu beklemeden, pencere açmadan ve geri çekilmeli
 * olarak sessizce yeniden kurulur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const keeperLib = require('../public/corporate-session-keeper.js');
const settings = require('../server/lib/corenectum-api-settings.js');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function harness({ statuses = {}, reconnectResults = {}, online = true } = {}) {
  let clock = 1_000_000;
  const calls = [];
  const changes = [];
  const keeper = keeperLib.createKeeper({
    keys: ['plm', 'lcwai'],
    now: () => clock,
    isOnline: () => online,
    readStatus: async key => {
      const value = statuses[key];
      if (value instanceof Error) throw value;
      return value;
    },
    reconnect: async key => {
      calls.push(key);
      const queue = reconnectResults[key] || [];
      const next = queue.length ? queue.shift() : false;
      if (next === true) statuses[key] = { connected: true, expiresAt: new Date(clock + 3600_000).toISOString() };
      return next;
    },
    onChange: (key, kind) => changes.push([key, kind]),
  });
  return {
    keeper, calls, changes, statuses,
    advance(ms) { clock += ms; },
    setOnline(value) { online = value; },
    now: () => clock,
  };
}

test('connected session with distant expiry is left alone', async () => {
  const h = harness({ statuses: { plm: { connected: true, expiresAt: new Date(1_000_000 + 3600_000).toISOString() } } });
  assert.equal(await h.keeper.check('plm'), 'healthy');
  assert.deepEqual(h.calls, []);
});

test('dropped session reconnects silently without a user command', async () => {
  const h = harness({ statuses: { plm: { connected: false } }, reconnectResults: { plm: [true] } });
  assert.equal(await h.keeper.check('plm'), 'reconnected');
  assert.deepEqual(h.calls, ['plm']);
  assert.deepEqual(h.changes, [['plm', 'reconnected']]);
});

test('session expiring within the refresh window is renewed before it drops', async () => {
  const h = harness({
    statuses: { lcwai: { connected: true, expiresAt: new Date(1_000_000 + 5 * 60_000).toISOString() } },
    reconnectResults: { lcwai: [true] },
  });
  assert.equal(await h.keeper.check('lcwai'), 'reconnected');
  assert.deepEqual(h.calls, ['lcwai']);
});

test('server-side rejected or expired PLM token counts as dropped', async () => {
  const h = harness({ statuses: { plm: { connected: true, rejected: true } }, reconnectResults: { plm: [true] } });
  assert.equal(await h.keeper.check('plm'), 'reconnected');
  const e = harness({ statuses: { plm: { connected: true, expired: true } }, reconnectResults: { plm: [true] } });
  assert.equal(await e.keeper.check('plm'), 'reconnected');
});

test('failed silent attempts back off instead of hammering SSO', async () => {
  const h = harness({ statuses: { plm: { connected: false } }, reconnectResults: { plm: [false, false, true] } });
  assert.equal(await h.keeper.check('plm'), 'failed');
  assert.equal(await h.keeper.check('plm'), 'waiting');
  h.advance(keeperLib.BACKOFF_MS[0]);
  assert.equal(await h.keeper.check('plm'), 'failed');
  h.advance(keeperLib.BACKOFF_MS[0]);
  assert.equal(await h.keeper.check('plm'), 'waiting', 'second failure waits for the longer step');
  h.advance(keeperLib.BACKOFF_MS[1]);
  assert.equal(await h.keeper.check('plm'), 'reconnected');
  assert.equal(h.calls.length, 3);
  assert.ok(keeperLib.BACKOFF_MS.every((ms, i, all) => i === 0 || ms >= all[i - 1]));
  assert.ok(keeperLib.BACKOFF_MS.at(-1) <= 30 * 60_000);
});

test('offline network never attempts sign-in; coming back online retries at once', async () => {
  const h = harness({ statuses: { plm: { connected: false } }, reconnectResults: { plm: [false, true] }, online: false });
  assert.equal(await h.keeper.check('plm'), 'offline');
  assert.deepEqual(h.calls, []);
  h.setOnline(true);
  assert.equal(await h.keeper.check('plm'), 'failed');
  assert.equal(await h.keeper.check('plm'), 'waiting');
  await h.keeper.networkRestored();
  assert.deepEqual(h.calls, ['plm', 'plm']);
});

test('unknown status (backend unavailable) does not trigger sign-in', async () => {
  const h = harness({ statuses: { plm: new Error('down') } });
  assert.equal(await h.keeper.check('plm'), 'unknown');
  assert.deepEqual(h.calls, []);
});

test('explicit user disconnect pauses the key until the user connects again', async () => {
  const h = harness({ statuses: { lcwai: { connected: false } }, reconnectResults: { lcwai: [true] } });
  h.keeper.pause('lcwai');
  assert.equal(await h.keeper.check('lcwai'), 'paused');
  h.keeper.resume('lcwai');
  assert.equal(await h.keeper.check('lcwai'), 'reconnected');
});

test('auth failure observed by a request forces a renewal even if status looks healthy', async () => {
  const h = harness({
    statuses: { plm: { connected: true, expiresAt: new Date(1_000_000 + 3600_000).toISOString() } },
    reconnectResults: { plm: [true] },
  });
  h.keeper.reportAuthFailure('plm');
  assert.equal(await h.keeper.check('plm'), 'reconnected');
  assert.equal(await h.keeper.check('plm'), 'healthy');
});

test('concurrent checks share one silent attempt', async () => {
  const h = harness({ statuses: { plm: { connected: false } }, reconnectResults: { plm: [true] } });
  const [a, b] = await Promise.all([h.keeper.check('plm'), h.keeper.check('plm')]);
  assert.deepEqual(h.calls, ['plm']);
  assert.ok(['reconnected', 'busy'].includes(a) && ['reconnected', 'busy'].includes(b));
  await h.keeper.settle('plm');
});

test('server status reports rejected and expired CoreNectum tokens', () => {
  const jwt = exp => ['e30', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'sig'].join('.');
  settings.clearDesktopToken();
  settings.setDesktopToken(jwt(Math.floor(Date.now() / 1000) + 3600));
  let status = settings.publicSettings('u1');
  assert.equal(status.configured, true);
  assert.equal(status.rejected, false);
  assert.equal(status.expired, false);
  settings.markTokenRejected(settings.currentTokenGeneration() - 1);
  assert.equal(settings.publicSettings('u1').rejected, false, 'a stale 401 from an older token does not mark the new one');
  settings.markTokenRejected(settings.currentTokenGeneration());
  assert.equal(settings.publicSettings('u1').rejected, true);
  settings.setDesktopToken(jwt(Math.floor(Date.now() / 1000) - 60));
  status = settings.publicSettings('u1');
  assert.equal(status.rejected, false, 'a new token clears the rejection');
  assert.equal(status.expired, true);
  settings.clearDesktopToken();
});

test('CoreNectum 401 marks the token generation as rejected (no token value exposed)', () => {
  const client = read('server/lib/corenectum-api-client.js');
  assert.match(client, /settings\.markTokenRejected\(generation\)/);
  assert.doesNotMatch(read('server/lib/corenectum-api-settings.js'), /rejected:[^\n]*getToken\(/);
});

test('keeper is wired for PLM and LCW AI only, never OAB, and never opens an interactive window', () => {
  const code = read('public/corporate-session-keeper.js');
  assert.match(code, /ensureCoreNectumAuth\(\{\s*interactive:\s*false/);
  assert.match(code, /ensureLcwAiAuth\(\{\s*interactive:\s*false/);
  assert.doesNotMatch(code, /interactive:\s*true/);
  assert.doesNotMatch(code, /ensureOabAuth|\/api\/oab/);
  assert.doesNotMatch(code, /Authorization|accessToken|password/i);
  assert.match(read('public/index.html'), /corporate-session-keeper\.js\?v=__BL_ASSET_VERSION__/);
});

test('silent PLM auth recovery goes through the keeper backoff', () => {
  const code = read('public/plm-auth-recovery.js');
  assert.match(code, /BLCorporateSessionKeeper/);
  assert.match(code, /reportAuthFailure\('plm'\)/);
});

test('job registry carries the background flag for silent jobs', () => {
  const { createJobRegistry } = require('../server/lib/job-registry.js');
  const jobs = createJobRegistry();
  const silent = jobs.create('u1', { kind: 'plm-images', scope: 'cp', background: true });
  const normal = jobs.create('u1', { kind: 'plm-images', scope: 'cp' });
  assert.equal(jobs.describe('u1', silent.id).background, true);
  assert.equal(jobs.describe('u1', normal.id).background, false);
});

test('silent request header marks server PLM jobs as background', () => {
  const server = read('server/server.js');
  assert.match(server, /function plmJobBackground\(req\)/);
  assert.match(server, /background: meta\.background === true \|\| plmJobBackground\(req\)/);
  const importPlm = server.slice(server.indexOf("app.post('/api/model-images/import-plm'"));
  assert.match(server.slice(server.indexOf('async function runPlmImageImport'), server.indexOf('async function runPlmImageImport') + 2500), /background: plmJobBackground\(req\)/);
  assert.ok(importPlm.length > 0);
});

test('background jobs never open the Operations Center or the page strip', () => {
  const ops = read('public/plm-operations.js');
  assert.match(ops, /filter\(job => job\.running && !job\.background\)/);
  const app = read('public/app-main.js');
  const helper = app.slice(app.indexOf('async function plmSilentJsonRequest'), app.indexOf('window.BLPlmSilentRequest='));
  assert.match(helper, /X-BuyerLog-Auth-Mode/);
  assert.match(helper, /navigator\.onLine===false/);
  assert.doesNotMatch(helper, /notifyPlmOperationStarted|openPlmSignInAfterAuthFailure|runCoreNectumAutoAuth|showToast|showCenterNotice/);
});

test('explicit disconnect pauses the keeper; explicit connect resumes it', () => {
  const app = read('public/app-main.js');
  assert.match(app, /BLCorporateSessionKeeper\?\.pause\?\.\('plm'\)/);
  const ai = read('public/lcwai-assistant.js');
  assert.match(ai, /BLCorporateSessionKeeper.*pause\('lcwai'\)/);
  assert.match(ai, /BLCorporateSessionKeeper.*resume\('lcwai'\)/);
  const toolbar = read('public/corporate-connections-toolbar.js');
  assert.match(toolbar, /keeper\.settle\(key\)/);
  assert.match(toolbar, /keeper\.resume\(key\)/);
  assert.match(toolbar, /bl:corporate-session-reconnected/);
});

test('user-initiated PLM recovery waits for an in-flight silent attempt before asking interactively', () => {
  const code = read('public/plm-auth-recovery.js');
  const interactive = code.slice(code.indexOf('async function renewCoreNectumSession('), code.indexOf('async function renewCoreNectumSessionSilently'));
  assert.match(interactive, /keeper\.settle\('plm'\)[\s\S]*interactive: true/);
});
