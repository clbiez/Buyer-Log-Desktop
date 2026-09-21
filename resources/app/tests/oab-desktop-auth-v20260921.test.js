'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const {
  createOabAuthLifecycle,
  authorizationHeaderFromCdpRequest,
  isReportApiRequest,
} = require('../electron/oab-auth-lifecycle');

function cdpRequest(url, authorization = '') {
  const headers = { Accept: 'application/json' };
  if (authorization) headers.Authorization = authorization;
  return { request: { url, method: 'POST', headers } };
}

test('OAB desktop auth uses CDP Network capture before navigation, not session webRequest', () => {
  const start = MAIN.indexOf('async function acquireOabAuthorization');
  const end = MAIN.indexOf('async function clearOabAuthSession', start);
  const body = MAIN.slice(start, end);
  assert.match(body, /webContents\.debugger/);
  assert.match(body, /targetDebugger\.attach\('1\.3'\)/);
  assert.match(body, /sendCommand\('Network\.enable'\)/);
  assert.match(body, /Network\.requestWillBeSent/);
  assert.match(body, /createOabAuthLifecycle/);
  assert.doesNotMatch(body, /onBeforeSendHeaders|OAB_AUTH_CAPTURE_URLS/);
  assert.ok(body.indexOf("targetDebugger.attach('1.3')") < body.indexOf('loadLoginTarget(OAB_VIEWER_URL, true)'));
});

test('CDP capture accepts only the real PASS report API Authorization', () => {
  const token = 'Bearer ' + 'a'.repeat(48);
  const valid = cdpRequest('https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportData', token);
  assert.equal(isReportApiRequest(valid, 'pass.prod.lcwaikiki.com'), true);
  assert.equal(authorizationHeaderFromCdpRequest(valid), token);

  assert.equal(isReportApiRequest(cdpRequest('https://pass.lcwaikiki.com/v3/report/viewer', token), 'pass.prod.lcwaikiki.com'), false);
  assert.equal(isReportApiRequest(cdpRequest('https://pass.prod.lcwaikiki.com/other/api', token), 'pass.prod.lcwaikiki.com'), false);
  assert.equal(authorizationHeaderFromCdpRequest(cdpRequest('https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/x')), '');
});

test('interactive lifecycle waits for login, retries viewer in a bounded way, then resolves only after backend validation', async () => {
  let clock = 1000;
  const phases = [];
  const kicks = [];
  const validated = [];
  const validToken = 'Bearer ' + 'v'.repeat(48);
  const staleToken = 'Bearer ' + 's'.repeat(48);

  const lifecycle = createOabAuthLifecycle({
    apiHost: 'pass.prod.lcwaikiki.com',
    uiHost: 'pass.lcwaikiki.com',
    viewerKickIntervalMs: 1000,
    maxViewerKicks: 3,
    now: () => clock,
    onPhase: phase => phases.push(phase),
    onViewerKick: async detail => { kicks.push(detail); },
    onAuthorization: async authorization => {
      validated.push(authorization);
      return authorization === validToken;
    },
  });

  await lifecycle.observe({ url: 'https://login.microsoftonline.com/common/oauth2/authorize', signIn: true });
  assert.equal(lifecycle.snapshot().phase, 'login-required');
  assert.equal(kicks.length, 0);

  // Login completes and PASS viewer appears. The first viewer observation is
  // attempt zero; success is still false because no report Authorization exists.
  await lifecycle.observe({ url: 'https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report', signIn: false });
  assert.equal(lifecycle.snapshot().phase, 'waiting-report-request');
  assert.equal(lifecycle.snapshot().stopped, false);
  assert.equal(kicks.length, 0);

  // PASS SPA may render the viewer shell without issuing the report request.
  // Retry is bounded and paced, not tied to one did-finish-load event.
  for (let index = 0; index < 5; index += 1) {
    clock += 1100;
    await lifecycle.observe({ url: 'https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report', signIn: false });
  }
  assert.equal(kicks.length, 3);
  assert.equal(lifecycle.snapshot().viewerKicks, 3);

  // A non-report request cannot complete authentication.
  assert.equal(await lifecycle.onNetworkRequest(cdpRequest('https://pass.prod.lcwaikiki.com/health', validToken)), false);
  assert.equal(validated.length, 0);

  // A captured but rejected/expired candidate is not success.
  const reportUrl = 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportVariablesWithData';
  assert.equal(await lifecycle.onNetworkRequest(cdpRequest(reportUrl, staleToken)), false);
  assert.equal(lifecycle.snapshot().stopped, false);

  // Only backend-accepted Authorization completes the lifecycle.
  assert.equal(await lifecycle.onNetworkRequest(cdpRequest(reportUrl, validToken)), true);
  assert.equal(lifecycle.snapshot().stopped, true);
  assert.equal(lifecycle.snapshot().phase, 'backend-validated');
  assert.deepEqual(validated, [staleToken, validToken]);

  // Duplicate requests after success cannot trigger duplicate validation/fetch.
  assert.equal(await lifecycle.onNetworkRequest(cdpRequest(reportUrl, validToken)), false);
  assert.equal(validated.length, 2);
  assert.ok(phases.includes('authorization-captured'));
  assert.ok(phases.includes('backend-validated'));
});

test('main-process success still requires loopback backend validation and closes the login BrowserWindow', () => {
  const start = MAIN.indexOf('async function acquireOabAuthorization');
  const end = MAIN.indexOf('async function clearOabAuthSession', start);
  const body = MAIN.slice(start, end);
  assert.match(body, /pushOabAuthorizationToBackend\(authorization\)/);
  assert.match(body, /settled = true;[\s\S]*?cleanup\(\);[\s\S]*?resolvePromise\(\{ ok:true, authenticated:true/);
  assert.match(body, /targetDebugger\.detach\(\)/);
  assert.match(body, /authWindow\.close\(\)/);
  assert.match(body, /clearInterval\(lifecycleTimer\)/);
});

test('manual interactive window close remains OAB_AUTH_CANCELLED', () => {
  const start = MAIN.indexOf("authWindow.on('closed'");
  const end = MAIN.indexOf('lifecycleTimer = setInterval', start);
  const body = MAIN.slice(start, end);
  assert.match(body, /OAB_AUTH_CANCELLED/);
  assert.match(body, /cleanupCapture\(\)/);
});

test('renderer waits for desktop auth promise and continues the same report action without a second GET OAB click', () => {
  const authStart = OAB.indexOf('async function oabEnsureAuthentication');
  const retryStart = OAB.indexOf('async function oabWithAuthRetry', authStart);
  const fetchStart = OAB.indexOf('async function oabFetchReport', retryStart);
  const authBody = OAB.slice(authStart, retryStart);
  const retryBody = OAB.slice(retryStart, OAB.indexOf('/* ================================================================', retryStart));
  const fetchBody = OAB.slice(fetchStart, OAB.indexOf('/* ================================================================', fetchStart));

  assert.match(authBody, /await desktop\.ensureOabAuth\(\{ interactive:true \}\)/);
  assert.match(retryBody, /await oabEnsureAuthentication\(\{ force:true \}\);[\s\S]*?continue;/);
  assert.match(fetchBody, /await oabEnsureAuthentication\(\);[\s\S]*?await oabWithAuthRetry\(\(\) => OABApi\.report/);
});

test('backend bridge stores Authorization only in RAM and validates through oabApiClient', () => {
  const start = SERVER.indexOf("app.post('/api/internal/desktop/oab-authorization'");
  const end = SERVER.indexOf("app.delete('/api/internal/desktop/oab-authorization'", start);
  const body = SERVER.slice(start, end);
  assert.match(body, /oabAuthState\.setAuthorization/);
  assert.match(body, /await oabApiClient\.validateAuthorization\(\)/);
  assert.match(body, /oabAuthState\.clear\(\)/);
  assert.doesNotMatch(body, /res[^\n]*authorization|json\([^)]*Bearer/i);
});

test('OAB desktop auth never reads credential values or logs Authorization values', () => {
  const signInStart = MAIN.indexOf('async function oabWindowLooksLikeSignIn');
  const signInEnd = MAIN.indexOf('/* Electron loadURL()', signInStart);
  const signInBody = MAIN.slice(signInStart, signInEnd);
  assert.match(signInBody, /querySelector/);
  assert.doesNotMatch(signInBody, /\.value\b|password\s*:/i);

  const authStart = MAIN.indexOf('async function acquireOabAuthorization');
  const authEnd = MAIN.indexOf('async function clearOabAuthSession', authStart);
  const authBody = MAIN.slice(authStart, authEnd);
  assert.doesNotMatch(authBody, /log\([^\n]*authorization\b/i);
  assert.doesNotMatch(authBody, /executeJavaScript\([^\n]*\.value/i);
});
