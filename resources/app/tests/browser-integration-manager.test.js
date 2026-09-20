'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserIntegrationManager } = require('../server/lib/browser-integration-manager');

function error(code, message = code) {
  return Object.assign(new Error(message), { code, statusCode:409 });
}

test('dashboard readiness is single-flight for repeated refresh requests', async () => {
  let opens = 0;
  let resolveOpen;
  const session = { getSchema: async () => ['Sipariş Kod'], release: async () => {} };
  const connector = {
    openPowerBiImportDashboardSession: async () => {
      opens += 1;
      await new Promise(resolve => { resolveOpen = resolve; });
      return session;
    },
  };
  const manager = createBrowserIntegrationManager({ connector, sleep:async () => {} });
  const requests = Array.from({ length:50 }, () => manager.ensureDashboardSession('user-a'));
  await new Promise(resolve => setImmediate(resolve));
  resolveOpen();
  const sessions = await Promise.all(requests);
  assert.equal(opens, 1);
  assert.ok(sessions.every(value => value === session));
});

test('dashboard reconnect uses bounded backoff and reuses the successful session', async () => {
  const delays = [];
  let opens = 0;
  const session = { getSchema: async () => ['Sipariş Kod'], release: async () => {} };
  const connector = {
    forgetEndpoint() {},
    openPowerBiImportDashboardSession: async () => {
      opens += 1;
      if (opens < 3) throw error('BROWSER_CONTEXT_MISSING');
      return session;
    },
  };
  const manager = createBrowserIntegrationManager({ connector, sleep:async ms => { delays.push(ms); } });
  assert.equal(await manager.ensureDashboardSession('user-a'), session);
  assert.equal(opens, 3);
  assert.deepEqual(delays, [250, 500]);
});

test('missing browser connection opens generic setup and never mentions PLM', async () => {
  let prepared = 0;
  const connector = {
    openPowerBiImportDashboardSession: async () => { throw error('EDGE_EXISTING_PROFILE_DEBUG_DISABLED'); },
    openExistingEdgeDebugSetup: () => { prepared += 1; return { ok:true }; },
  };
  const manager = createBrowserIntegrationManager({ connector, sleep:async () => {} });
  await assert.rejects(
    manager.ensureDashboardSession('user-a'),
    err => err.code === 'BROWSER_INTEGRATION_WAITING_FOR_USER'
      && !/PLM/i.test(err.message)
      && err.waitingForUser === true,
  );
  assert.equal(prepared, 1);
});

test('user approval wait is separate from operation retries and resumes automatically', async () => {
  let opens = 0;
  let prepared = 0;
  const states = [];
  const session = { getSchema: async () => ['Sipariş Kod'], release:async () => {} };
  const connector = {
    openPowerBiImportDashboardSession: async () => {
      opens += 1;
      if (opens === 1) throw error('BROWSER_INTEGRATION_NOT_READY');
      return session;
    },
    openExistingEdgeDebugSetup: () => { prepared += 1; },
    status: async () => ({ existingProfileReady:true }),
  };
  const manager = createBrowserIntegrationManager({
    connector,
    sleep:async () => {},
    userApprovalTimeoutMs:1000,
    userApprovalPollMs:250,
    logger:() => {},
  });
  assert.equal(await manager.ensureDashboardSession('user-a', { onState:state => states.push(state) }), session);
  assert.equal(opens, 2);
  assert.equal(prepared, 1);
  assert.deepEqual(states, ['WAITING_FOR_USER']);
});

test('authentication errors are not retried or converted to browser setup errors', async () => {
  let opens = 0;
  const connector = {
    openPowerBiImportDashboardSession: async () => { opens += 1; throw error('POWERBI_AUTH_REQUIRED', 'Power BI oturumunun yenilenmesi gerekiyor.'); },
  };
  const manager = createBrowserIntegrationManager({ connector, sleep:async () => {} });
  await assert.rejects(manager.ensureDashboardSession('user-a'), err => err.code === 'POWERBI_AUTH_REQUIRED');
  assert.equal(opens, 1);
});

test('closed Edge is reported directly and does not open the setup page', async () => {
  let prepared = 0;
  const connector = {
    openPowerBiImportDashboardSession: async () => { throw error('EDGE_NOT_RUNNING', 'Microsoft Edge açık değil.'); },
    openExistingEdgeDebugSetup: () => { prepared += 1; },
  };
  const manager = createBrowserIntegrationManager({ connector, sleep:async () => {}, logger:() => {} });
  await assert.rejects(manager.ensureDashboardSession('user-a'), err => err.code === 'EDGE_NOT_RUNNING');
  assert.equal(prepared, 0);
});
