'use strict';
// Test-only experiment. Never imported by the application; no service/credential I/O.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const fixture = require('../fixtures/oab-int12.json');
const app = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-int12-'));
for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT']) process.env[key] = root;
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
process.once('exit', () => fs.rmSync(root, { recursive: true, force: true }));
const batch = require('../../server/lib/oab-batch');
const snapshots = require('../../server/lib/oab-session-store');
const { createOabJobStore } = require('../../server/lib/oab-job-store');
const native = require('../../server/lib/oab-batch-service');
const sourcePath = path.join(app, 'server/lib/oab-batch-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const serverSource = fs.readFileSync(path.join(app, 'server/server.js'), 'utf8');
const helperStart = serverSource.indexOf('function assertOabCurrentAccess(');
const helperEnd = serverSource.indexOf('async function oabDesktopSessionReady()', helperStart);
if (helperStart < 0 || helperEnd <= helperStart) throw Error('Native auth helper anchors changed');
const authSource = serverSource.slice(helperStart, helperEnd);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = code => Object.assign(Error(code), { code });
const slots = new AsyncLocalStorage();
let seq = 0;

function sourceIdentity() {
  return {
    mainWith892: fixture.mainWith892,
    serviceSha256: sha(source), expectedServiceSha256: fixture.sourceSha256,
    authHelperSha256: sha(authSource), fixtureSha256: sha(fs.readFileSync(path.join(__dirname, '../fixtures/oab-int12.json'))),
    harnessSha256: sha(fs.readFileSync(__filename)),
  };
}
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error('Native experiment anchor changed: ' + before);
  return text.replace(before, after);
}
function candidateService() {
  if (sha(source) !== fixture.sourceSha256) throw Error('Native service hash changed; review experiment before repinning');
  // Only the iteration/fetch await is substituted IN MEMORY. The native planner,
  // probe, authority, error handling, receipts, snapshot and continuation execute.
  let experiment = replaceOnce(source, 'for (const item of job.queue) {',
    'for await (const {item,take} of deps.__int12Window(job.queue, item => oabFetchOneCombination(userId,currentUser,item,job.forceRefresh,job.transport,job))) {');
  experiment = replaceOnce(experiment,
    'const result = await oabFetchOneCombination(userId, currentUser, item, job.forceRefresh, job.transport, job);',
    'const result = await take();');
  const isolated = new Module(sourcePath, module);
  isolated.filename = sourcePath;
  isolated.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  isolated._compile(experiment, sourcePath);
  return isolated.exports.createOabBatchService;
}

async function* orderedPairs(queue, fetchOne) {
  // Fixed windows of TWO, ordered consumption; no eager queue-sized Promise.all.
  // The native commitGuard holds speculative cache writes until their turn.
  for (let offset = 0; offset < queue.length; offset += 2) {
    const items = queue.slice(offset, offset + 2);
    let pending;
    // Start only INSIDE the native combination try, after its authority/cancel
    // checks and currentLabel assignment. Iterator.next() must have no auth I/O.
    const start = () => pending ||= items.map(item => {
      let unlock;
      const slot = { discarded: false, turn: new Promise(resolve => { unlock = resolve; }) };
      const outcome = slots.run(slot, () => fetchOne(item)).then(value => ({ value }), error => ({ error }));
      return { item, slot, unlock, outcome };
    });
    try {
      for (const [index, item] of items.entries()) yield { item, take: async () => {
        const entry = start()[index];
        entry.unlock();
        const outcome = await entry.outcome;
        if (outcome.error) throw outcome.error;
        return outcome.value;
      } };
    } finally {
      // Stop/refusal: release and discard speculative effects, and drain every
      // started operation BEFORE native final snapshot/release. Never detach.
      for (const entry of pending || []) { entry.slot.discarded = true; entry.unlock(); }
      for (const entry of pending || []) await entry.outcome;
    }
  }
}

const combinations = fixture.seasons.flatMap(seasonRef => fixture.mags.flatMap(merchSubGroupRef =>
  fixture.buyers.map(buyerGroupRef => ({ seasonRef, merchSubGroupRef, buyerGroupRef }))));
const key = p => [p.seasonRef, p.merchSubGroupRef, p.buyerGroupRef].join('|');
function rowsFor(p) {
  return (p.buyerGroupRefs || [p.buyerGroupRef]).flatMap(buyerGroupRef => {
    const item = { seasonRef: p.seasonRef, merchSubGroupRef: p.merchSubGroupRef, buyerGroupRef };
    const index = combinations.findIndex(c => key(c) === key(item));
    if (index < 0) throw Error('Fixture received unapproved combination');
    return index === fixture.emptyIndex ? [] : [{ Sezon: item.seasonRef, 'Merch Alt Grup': item.merchSubGroupRef,
      'Buyer Grup Tanımı': buyerGroupRef, Qty: index + 1, ...(index === 7 ? { Optional: null } : {}) }];
  });
}
const scenarios = ['cold', 'fresh-half', 'fresh-all', 'force-refresh', 'batch-supported', 'probe-verified',
  'probe-fallback', 'partial', 'throttle', 'auth-recovery', 'auth-fatal', 'revoke-auth', 'revoke-response', 'revoke-recovery', 'cancel'];

async function runCase({ scenario, width, diagnostics = false }) {
  if (![1, 2].includes(width)) throw Error('width must be 1 or 2');
  if (!scenarios.includes(scenario)) throw Error('Unknown scenario');
  const identity = sourceIdentity();
  if (identity.serviceSha256 !== fixture.sourceSha256) throw Error('Native source drift');
  const createService = width === 1 ? native.createOabBatchService : candidateService();
  const owner = { id: 'int12_' + (++seq), enabled: true, areas: ['overview'], permissions: ['OAB.VIEW'] };
  let allowed = true, faultsEnabled = true, finished = false, active = 0, peak = 0, resolveDone;
  let capability = { state: scenario === 'batch-supported' ? 'supported' : scenario.startsWith('probe-') ? 'unknown' : 'unsupported' };
  const events = [], audits = [], failures = [], cache = new Map(), attempts = new Map();
  let service;
  const began = performance.now();
  const event = (type, extra = {}) => events.push({ seq: events.length + 1, ms: performance.now() - began, type, authorityAllowed: allowed, ...extra });
  const access = { profileById: id => {
    if (diagnostics) event('authority-check', { stack: new Error('authority observation').stack });
    return id === owner.id && allowed ? owner : null;
  },
    hasArea: (p, a) => p.areas.includes(a), hasCapability: (p, c) => p.permissions.includes(c),
    publicProfile: p => ({ ...p }), appendAudit: (_p, type) => audits.push(type) };
  const rawStore = createOabJobStore({ root: path.join(root, owner.id, 'jobs') });
  const store = { ...rawStore, reserve: (...args) => {
    const result = rawStore.reserve(...args), job = args[1];
    // Observe actual native acceptance, without changing/normalizing any row.
    if (diagnostics && !result.reused) {
      const results = job.results;
      Object.defineProperty(results, 'push', { value: function (...items) {
        event('result-accept', { results: JSON.parse(JSON.stringify(items)) });
        return Array.prototype.push.apply(this, items);
      } });
    }
    return result;
  }, checkpoint: (id, job) => {
    const result = rawStore.checkpoint(id, job);
    event('checkpoint', { completed: job.completed, running: job.running,
      ...(diagnostics ? { results: JSON.parse(JSON.stringify(job.results)), failures: JSON.parse(JSON.stringify(job.failures)), errorCode: job.errorCode } : {}) });
    if (!job.running) resolveDone?.();
    return result;
  } };
  const oabStore = {
    cacheKeyOf: (...args) => args.join('|'), get: id => { const value = cache.get(id); event('cache-read', { key: id, hit: !!value?.fresh }); return value; },
    set: (id, value) => { event('cache-write', { key: id, late: finished }); const result = { ...value, fresh: true, fetchedAt: '2026-11-07T00:00:00.000Z' }; cache.set(id, result); return result; },
    loadBatchCapability: () => ({ ...capability }), saveBatchCapability: value => { capability = { ...value }; event('capability', value); },
  };
  if (['fresh-half', 'fresh-all', 'force-refresh'].includes(scenario)) {
    for (const item of combinations.slice(0, scenario === 'fresh-half' ? 6 : 12)) {
      const rows = rowsFor(item);
      cache.set(key(item), { fresh: true, rows, fields: [...new Set(rows.flatMap(Object.keys))], fetchedAt: '2026-11-07T00:00:00.000Z' });
    }
  }
  async function report(_id, p) {
    const refs = p.buyerGroupRefs || [p.buyerGroupRef];
    const index = combinations.findIndex(c => c.seasonRef === p.seasonRef && c.merchSubGroupRef === p.merchSubGroupRef && c.buyerGroupRef === refs[0]);
    const requestKey = [p.seasonRef, p.merchSubGroupRef, ...refs].join('|');
    const attempt = (attempts.get(requestKey) || 0) + 1; attempts.set(requestKey, attempt);
    active++; peak = Math.max(peak, active); event('report-start', { key: requestKey, index, attempt, active });
    const start = performance.now();
    let errorCode = '';
    try {
      await sleep(fixture.latencyMs[index]);
      if (faultsEnabled) {
        if (scenario === 'revoke-response' && index === 0) { const wasAllowed = allowed; allowed = false; event('revoke', { key: requestKey, wasAllowed }); }
        if (scenario === 'cancel' && index === 0) { service.cancel(owner); event('cancel'); }
        if (scenario === 'partial' && index === fixture.faultIndex) throw fail('OAB_HTTP_ERROR');
        if (scenario === 'throttle' && index === fixture.faultIndex) throw Object.assign(fail('OAB_HTTP_ERROR'), { statusCode: 429, retryAfter: '1' });
        if (scenario === 'auth-fatal' && index === 1) throw fail('OAB_AUTH_EXPIRED');
        if ((scenario === 'auth-recovery' && index < 2 || scenario === 'revoke-recovery' && index === 0) && attempt === 1) throw fail('PASS_SESSION_EXPIRED');
      }
      if (scenario === 'probe-fallback' && refs.length > 1) return rowsFor({ ...p, buyerGroupRefs: [refs[0]] });
      return rowsFor(p);
    } catch (error) { errorCode = error.code; event('report-error', { key: requestKey, code: error.code, statusCode: error.statusCode || null }); throw error; }
    finally { active--; event('report-end', { key: requestKey, index, attempt, errorCode, durationMs: performance.now() - start, active }); }
  }
  const connector = {
    passAuthStatus: () => ({ connected: true }), passStorageAuthStatus: async () => ({ connected: true }),
    fetchPassReportData: report,
    capturePassAuthorization: async (_id, p) => {
      event('recovery-start', { key: key(p) }); await sleep(2);
      if (faultsEnabled && scenario === 'revoke-recovery') { const wasAllowed = allowed; allowed = false; event('revoke', { key: key(p), wasAllowed }); }
      event('recovery-end'); return { connected: true };
    },
  };
  // Same current native browser auth helpers in BOTH arms. This does not load or
  // start server.js; every connector, desktop/API entry is an explicit fake.
  const helpers = new Function('userAccess', 'agentBrowserConnector', 'OAB_DESKTOP_TRANSPORT', 'oabDesktopRelay', 'oabApiClient', 'oabDesktopSessionReady', 'oabDesktopAuthRequired',
    authSource + ';return {ensurePassConnected,fetchOabReportWithLoginRecovery};')(
    access, connector, 'desktop', { configured: () => false }, { fetchReportData: () => { throw Error('No real API allowed'); } },
    async () => true, () => fail('OAB_AUTH_REQUIRED'));
  function buildService() {
    return createService({ jobStore: store, userAccess: access, oabBatch: batch, oabSessionStore: {
      ...snapshots, update: (...args) => {
        if (diagnostics) event('snapshot-start');
        const result = snapshots.update(...args);
        if (diagnostics) event('snapshot-write');
        return result;
      },
    },
      oabStaticMetadata: { planningMetadata: () => ({ seasonRefs: () => fixture.seasons, magRefsForSeason: () => fixture.mags, buyerGroupRefsFor: () => fixture.buyers }),
        labelsFor: i => ({ season: i.seasonRef, mag: i.merchSubGroupRef, buyerGroup: i.buyerGroupRef }) },
      oabStore, ensurePassConnected: async (...args) => {
        event('auth-check', { key: key(args[1]) });
        if (faultsEnabled && scenario === 'revoke-auth') { const wasAllowed = allowed; allowed = false; event('revoke', { key: key(args[1]), wasAllowed }); }
        return helpers.ensurePassConnected(...args);
      }, fetchOabReportWithLoginRecovery: helpers.fetchOabReportWithLoginRecovery,
      redactSecrets: String, logRuntimeFailure: (kind, error) => failures.push({ kind, code: error.code }), __int12Window: orderedPairs });
  }
  const options = { transport: 'browser', withCommitGuard: async work => {
    const slot = slots.getStore();
    if (slot) { await slot.turn; if (slot.discarded) throw fail('OAB_BATCH_CANCELLED'); }
    return work();
  } };
  service = buildService();
  const body = { seasonRefs: fixture.seasons, merchSubGroupRefs: fixture.mags, buyerGroupRefs: fixture.buyers, forceRefresh: scenario === 'force-refresh' };
  const plan = service.plan(body);
  async function execute(start) {
    const done = new Promise(resolve => { resolveDone = resolve; });
    const startTime = performance.now();
    const ack = start();
    let timer;
    try { await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native job did not settle')), 10000); })]); }
    finally { clearTimeout(timer); }
    return { ack, wallMs: performance.now() - startTime };
  }
  const { ack, wallMs } = await execute(() => service.start(owner, body, options));
  const revokeContinuation = diagnostics && !allowed ? {} : null;
  if (!allowed) {
    event('executor-drained', { activeReports: active });
    if (diagnostics) {
      try { revokeContinuation.whileRevoked = { plan: service.continuationPlan(owner, ack.job.jobId, options) }; }
      catch (error) { revokeContinuation.whileRevoked = { errorCode: error.code }; }
    }
    try { service.status(owner, ack.job.jobId); throw Error('Revoked owner could read result'); }
    catch (error) { if (error.code !== 'OAB_ACCESS_REVOKED') throw error; }
    allowed = true; // Read diagnostic receipt only after the stopped executor drained.
    event('diagnostic-access-restored');
  }
  const outcome = service.status(owner, ack.job.jobId);
  const snapshot = snapshots.load(owner.id);
  if (revokeContinuation) {
    try { revokeContinuation.afterRestore = { plan: buildService().continuationPlan(owner, ack.job.jobId, options) }; }
    catch (error) { revokeContinuation.afterRestore = { errorCode: error.code }; }
  }
  const initialEvents = events.slice();
  const initialCache = [...cache.keys()].sort();
  const metrics = {
    wallMs, reports: initialEvents.filter(e => e.type === 'report-start').length, peakReports: peak,
    errors: initialEvents.filter(e => e.type === 'report-error').length,
    throttles: initialEvents.filter(e => e.type === 'report-error' && e.statusCode === 429).length,
    recoveries: initialEvents.filter(e => e.type === 'recovery-start').length,
    authChecks: initialEvents.filter(e => e.type === 'auth-check').length,
    cacheHits: outcome.job.fromCache, cacheWrites: initialEvents.filter(e => e.type === 'cache-write').length,
    cacheReads: initialEvents.filter(e => e.type === 'cache-read').length,
    activeAtFinish: active, lateEffects: initialEvents.filter(e => e.late).length, refreshPostRetries: 0,
  };
  let continued = null, continuationError = null, continuationPlan = null;
  if (['partial', 'throttle', 'auth-fatal', 'cancel'].includes(scenario)) {
    service = buildService(); // Real on-disk receipt/results after service reconstruction.
    try { continuationPlan = service.continuationPlan(owner, ack.job.jobId, options); }
    catch (error) { continuationError = error.code; if (scenario !== 'cancel') throw error; }
    if (continuationPlan) {
      faultsEnabled = false;
      await execute(() => service.continueJob(owner, { jobId: ack.job.jobId, sourceFingerprint: continuationPlan.sourceFingerprint }, { ...options, confirmed: true }));
      continued = service.status(owner);
    }
  }
  finished = true;
  return { scenario, width, identity, plan, capability, metrics, outcome, snapshot, initialCache, continued, continuationPlan,
    continuationError, events: initialEvents, continuationEvents: events.slice(initialEvents.length), audits, failures,
    ...(diagnostics ? { revokeContinuation, durableReceipt: rawStore.get(owner.id, ack.job.jobId, { includePlan: false }),
      durableResults: rawStore.results(owner.id, ack.job.jobId) } : {}) };
}
function stableReport(value) {
  if (!value) return null;
  return { rows: value.rows, fields: value.fields, sources: value.sources?.map(({ fetchedAt, ...rest }) => rest),
    job: Object.fromEntries(['running', 'cancelled', 'total', 'completed', 'fromCache', 'rowCount', 'failures', 'batchedBuyerGroups', 'errorCode', 'snapshotSaved', 'snapshotErrorCode', 'interrupted'].map(k => [k, value.job[k]])) };
}
function equivalent(value) {
  return { outcome: stableReport(value.outcome), snapshot: value.snapshot ? { selection: value.snapshot.selection,
    rows: value.snapshot.snapshot.rows, fields: value.snapshot.snapshot.fields, fromCache: value.snapshot.snapshot.fromCache } : null,
    initialCache: value.initialCache, capability: value.capability, continued: stableReport(value.continued), continuationError: value.continuationError };
}
module.exports = { runCase, equivalent, sourceIdentity, scenarios };
