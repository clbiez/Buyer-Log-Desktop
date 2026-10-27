'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const Checklist = require('../public/cp-checklist-engine');
const Rules = require('../public/cp-rules-engine');
const row = { orderKey: 'PO1', plannedLoadDate: 21000, plmId: '1', modelName: 'Demo', colourCode: '001' };
const pendingKey = 'user.lcw.cp.checklist.pending.v1';

function browser(saved = new Map(), fetch = async () => ({ ok: true, json: async () => ({ answers: {}, tombstones: {} }) })) {
  const listeners = new Map(), timers = [], notices = [];
  const storage = { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,String(v)), removeItem: k => saved.delete(k) };
  const ctx = { console, Map, Set, WeakMap, Date, JSON, Blob, Promise, localStorage: storage,
    BLStorage: { ...storage, actualKey: k => 'user.' + k, native: storage }, BL_USER_CONTEXT: { id: 'buyer' },
    BLCpChecklistEngine: Checklist, BLCpRulesEngine: Rules,
    BLCpReadinessEngine: { analyzeOrder: x => x, summarizeAnalyses: orders => ({ orders }), recount: x => x },
    BLCpDecisionRuntime: require('../public/cp-decision-runtime'),
    document: { documentElement: { lang: 'en' }, querySelector: () => null, getElementById: () => null },
    fetch, setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    CustomEvent: class { constructor(type, props) { this.type = type; Object.assign(this, props); } },
    addEventListener: (name,f) => { if (!listeners.has(name)) listeners.set(name,[]); listeners.get(name).push(f); },
    dispatchEvent: e => (listeners.get(e.type) || []).forEach(f => f(e)),
    showToast: message => notices.push(message),
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const script of ['cp-overview-assistant.js', 'checklist-answer-merge-engine.js', 'checklist-supplier-sync.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT,'public',script),'utf8'),ctx);
  }
  return { ctx, saved, timers, notices, assistant: ctx.BLCpAssistant, sync: ctx.BLChecklistSupplierSync };
}

test('403 on an old checklist answer preserves the journal and stops automatic retries', async () => {
  const writes = [];
  const b = browser(new Map(), async (_url, options) => {
    if (options && options.method === 'POST') {
      const entries = JSON.parse(options.body).entries;
      writes.push(entries.map(x => x.orderKey));
      if (entries.some(x => x.orderKey === 'PO1')) {
        return { ok: false, status: 403, json: async () => ({
          code: 'CHECKLIST_ORDER_FORBIDDEN', error: 'Current checklist record permission is required.'
        }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ answers: {}, tombstones: {} }) };
  });
  b.assistant.setChecklistAnswer(row, 'tests', 'rejected');
  await assert.rejects(b.sync.syncAnswerChanges(), /permission is required/);
  assert.equal(writes.length, 1);
  assert.equal(b.sync._state.syncRetryTimer, null, 'forbidden is not a transient retry');
  assert.equal(b.sync._state.permissionDeferred.size, 1);
  assert.equal(JSON.parse(b.saved.get(pendingKey))['PO1::tests'].state, 'rejected');

  await b.sync.syncAnswerChanges();
  await b.sync.loadShared();
  await b.sync.loadShared(true);
  assert.equal(writes.length, 1, 'revisiting CP must not resend the same refused edit');

  b.assistant.setChecklistAnswer({ ...row, orderKey: 'PO2' }, 'tests', 'approved');
  await b.sync.syncAnswerChanges();
  assert.deepEqual(writes.at(-1), ['PO2'], 'another locally changed answer can still be saved');
  assert.equal(b.sync._state.pendingAnswers['PO2::tests'], undefined);
  assert.equal(b.sync._state.pendingAnswers['PO1::tests'].state, 'rejected');
});

test('a new status choice retries a previously denied key without discarding evidence', async () => {
  let allowed = false; const writes = [];
  const b = browser(new Map(), async (_url, options) => {
    if (!options || options.method !== 'POST') return { ok: true, json: async () => ({ answers: {}, tombstones: {} }) };
    writes.push(JSON.parse(options.body).entries);
    return allowed ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false, status: 403, json: async () => ({ code: 'CHECKLIST_ORDER_FORBIDDEN', error: 'forbidden' }) };
  });
  b.assistant.setChecklistAnswer(row, 'tests', 'rejected', { note: 'keep' });
  await assert.rejects(b.sync.syncAnswerChanges());
  allowed = true;
  b.assistant.setChecklistAnswer(row, 'tests', 'approved', { note: 'keep' });
  await b.sync.syncAnswerChanges();
  assert.equal(writes.length, 2);
  assert.equal(writes[1][0].note, 'keep');
  assert.equal(b.sync._state.pendingAnswers['PO1::tests'], undefined);
});

test('initial CP checklist GET no longer waits for a stalled answer POST', async () => {
  let releasePost, posts = 0;
  const stalled = new Promise(resolve => { releasePost = resolve; });
  const b = browser(new Map(), async (_url, options) => {
    if (options && options.method === 'POST') {
      posts++;
      await stalled;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ definitions: [], answers: {}, tombstones: {} }) };
  });
  b.assistant.setChecklistAnswer(row, 'tests', 'rejected');
  const loaded = b.sync.loadShared();
  // Release the blocked request even if a regression causes loadShared to wait for it.
  const outcome = await Promise.race([loaded.then(() => 'loaded'), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))]);
  releasePost();
  await loaded;
  if (b.sync._state.syncPromise) await b.sync._state.syncPromise;
  assert.equal(outcome, 'loaded', 'CP load must not await the background save');
  assert.equal(posts, 1);
});

test('a pending write no longer bypasses the CP short freshness window', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'public/checklist-supplier-sync.js'), 'utf8');
  const runtime = bridge.slice(bridge.indexOf('async function startRuntime('), bridge.indexOf('function init()', bridge.indexOf('async function startRuntime(')));
  assert.match(runtime, /opts\.ifStale && state\.runtimeLoadedAt && Date\.now\(\) - state\.runtimeLoadedAt < RUNTIME_FRESH_MS/);
  assert.doesNotMatch(runtime, /pendingAnswers/);
});
