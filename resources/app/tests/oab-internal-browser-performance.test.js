'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOabAuthLifecycle } = require('../electron/oab-auth-lifecycle');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../public/oab.js'), 'utf8');
function section(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function pageExpression() {
  return new Function(`
    ${section(main, 'const OAB_STORED_TOKENS_READER =', 'const OAB_STORAGE_PROBE')}
    ${section(main, 'function oabPassRequestExpression', 'function oabWindowOnPass')}
    return oabPassRequestExpression;
  `)();
}
const token = 'Bearer ' + 'sample-access-token-'.repeat(3);
const url = 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportData';
const storage = { length: 0, getItem: key => key === 'access_token' ? token : null };
function runExpression(expression, fetch, timers = { setTimeout, clearTimeout }) {
  return new Function('fetch', 'localStorage', 'sessionStorage', 'AbortController', 'setTimeout', 'clearTimeout', `return ${expression}`)(fetch, storage, null, AbortController, timers.setTimeout, timers.clearTimeout);
}

test('slow authorized report is never reloaded by viewer recovery pulses', async () => {
  let now = 1000, kicks = 0, finish;
  const lifecycle = createOabAuthLifecycle({ apiHost:'pass.prod.lcwaikiki.com', uiHost:'pass.lcwaikiki.com', now:() => now,
    onViewerKick:async () => { kicks++; }, onAuthorization:() => new Promise(resolve => { finish = resolve; }) });
  const viewer = 'https://pass.lcwaikiki.com/v3/report/viewer';
  await lifecycle.observe({ url:viewer });
  const validating = lifecycle.onNetworkRequest({ url, requestHeaders:{ Authorization:token } });
  for (now of [14000, 22000, 45000, 90000]) await lifecycle.observe({ url:viewer });
  const duringValidation = kicks;
  finish(true); await validating;
  assert.equal(duringValidation, 0, 'navigation aborts the live report and starts it again');
});

test('stored Bearer tokens are normalized and used without a captured fallback', async () => {
  const seen = [];
  const result = await runExpression(pageExpression()(url, {}, ''), async (_, options) => {
    seen.push(options.headers.Authorization);
    return { ok:true, status:200, text:async () => '{"Data":[[]]}' };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [token]);
});

test('viewer recovery resumes after rejected authorization', async () => {
  let now = 1000, kicks = 0;
  const lifecycle = createOabAuthLifecycle({ apiHost:'pass.prod.lcwaikiki.com', uiHost:'pass.lcwaikiki.com', now:() => now,
    onViewerKick:async () => { kicks++; }, onAuthorization:async () => false });
  const viewer = 'https://pass.lcwaikiki.com/v3/report/viewer';
  await lifecycle.observe({ url:viewer });
  await lifecycle.onNetworkRequest({ url, requestHeaders:{ Authorization:token } });
  now = 14000; await lifecycle.observe({ url:viewer });
  assert.equal(kicks, 1);
});

test('OIDC storage keys match a literal dot and token whitespace is rejected', () => {
  const reader = new Function(`${section(main, 'const OAB_STORED_TOKENS_READER =', 'const OAB_STORAGE_PROBE')}; return OAB_STORED_TOKENS_READER;`)();
  const read = new Function('localStorage', `${reader}; return readStoredOabTokens();`);
  const values = {'oidc.user:pass':JSON.stringify({access_token:token}), 'oidcXuser:other':JSON.stringify({access_token:'x'.repeat(30)}), access_token:'bad token with spaces'.repeat(2)};
  const store = {length:Object.keys(values).length,key:index => Object.keys(values)[index],getItem:key => values[key]};
  assert.deepEqual(read(store), [token]);
});

test('page requests try fresh storage after a rejected candidate and preserve valid JSON', async () => {
  const seen = [];
  const fallback = 'Bearer ' + 'fallback-'.repeat(6);
  const result = await runExpression(pageExpression()(url, {}, fallback), async (_, options) => {
    seen.push(options.headers.Authorization);
    const ok = seen.length > 1;
    return {ok,status:ok ? 200 : 401,text:async () => ok ? '{"Data":[[{"code":"001"}]]}' : '{}'};
  });
  assert.deepEqual(seen, [token,fallback]);
  assert.deepEqual(result.json, {Data:[[{code:'001'}]]});
  assert.equal(result.timings.totalMs >= 0, true);
  assert.equal(JSON.stringify(result).includes(fallback), false);
});

test('report deadline aborts the actual fetch and covers response body reading', async () => {
  let fire, cleared = false, requestSignal;
  const timers = { setTimeout:callback => { fire = callback; return 1; }, clearTimeout:() => { cleared = true; } };
  const resultPromise = runExpression(pageExpression()(url, {}, token), async (_, options) => {
    requestSignal = options.signal;
    return { ok:true, status:200, text:() => new Promise((resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name:'AbortError'})));
    }) };
  }, timers);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(requestSignal, 'normal report fetches need an AbortSignal too');
  assert.equal(cleared, false, 'headers must not cancel the body deadline');
  fire();
  const result = await resultPromise;
  assert.equal(requestSignal.aborted, true);
  assert.equal(result.code, 'OAB_TIMEOUT');
  assert.equal(cleared, true);
});

test('both internal PASS windows keep running while hidden', () => {
  const flow = section(main, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  const preferences = [...flow.matchAll(/webPreferences:\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.equal(preferences.length, 2);
  for (const prefs of preferences) assert.match(prefs, /backgroundThrottling:\s*false/);
  const navigation = section(flow, 'const loadLoginTarget = async', 'const markLoginRequired');
  assert.match(navigation, /if \(settled \|\| authorizationBusy \|\| navigationBusy/);
});

test('batch auth recovery retains the current selection instead of an empty-filter report', () => {
  const source = section(ui, 'function oabNormalizeAuthContext', 'async function oabEnsureAuthentication');
  const read = new Function(`let oabLastAuthContext={}; ${source}; return oabAuthContextFromRequest;`)();
  assert.deepEqual(read('/api/oab/batch', {body:JSON.stringify({seasonRefs:['20271'],merchSubGroupRefs:['17'],buyerGroupRefs:['97','98']})}),
    {seasonRef:'20271',merchSubGroupRef:'17',buyerGroupRef:'97'});
  const fetch = section(ui, 'async function oabFetchReport(', '/* ================================================================\n     v7.20');
  assert.match(fetch, /oabAuthContextFromRequest\('/);
  assert.match(fetch, /oabEnsureAuthentication\(oabLastAuthContext\)/);
  const batch = section(ui, 'async function oabRunBatch(', 'function oabPollBatch');
  assert.match(batch, /oabLastAuthContext = oabNormalizeAuthContext\(plan.authContext\)/);
});
