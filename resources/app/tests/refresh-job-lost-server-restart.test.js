'use strict';
// v7.0.340 — TEST 7.0.339 field report: when the server process restarted during a
// refresh, the elapsed counter froze and the user waited 25 minutes for
// "Refresh job could not be verified.". The watcher must detect the lost job at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const between = (source, start, end) => {
  const a = source.indexOf(start); assert.ok(a >= 0, start);
  const b = source.indexOf(end, a + start.length); assert.ok(b > a, end);
  return source.slice(a, b);
};

function watcher(responses, lang = 'tr') {
  const calls = { fetch: 0 };
  const context = {
    appLang: lang, refreshWatchCancelled: false, refreshTimerKey: '', sourceRefreshTimers: {}, topBtn: null,
    document: { getElementById: () => null }, window: {},
    fmtDurationSn: ms => `${ms}`, refreshEtaRangeText: () => '', updateSourceRefreshTimerDisplays() {},
    refreshStagesModalOpen: () => false, renderRefreshStagesBody() {},
    setTimeout: fn => { fn(); return 0; },
    fetch: async () => {
      const next = responses[Math.min(calls.fetch++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return { ok: true, json: async () => next };
    },
  };
  vm.createContext(context);
  vm.runInContext(between(APP, 'function refreshJobWatchVerdict(', 'async function loadFromServer(force, targets)'), context);
  vm.runInContext(between(APP, 'async function waitForRefreshJob(expectedJob=null)', '\n  // İlk sayfa açılışı'), context);
  return { context, calls };
}

const started = { jobId: 'job-a', startedAt: '2026-11-06T10:00:00.000Z', serverInstanceId: 'srv-1', running: true };
const running = { ...started, phase: 'database', elapsedMs: 110100 };

test('server restart mid-refresh fails fast with a lost-job diagnosis instead of a 25 minute frozen wait', async () => {
  const restartedIdle = { running: false, phase: 'idle', jobId: null, serverInstanceId: 'srv-2' };
  const { context, calls } = watcher([running, new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), restartedIdle]);
  await assert.rejects(context.waitForRefreshJob(started), error => {
    assert.equal(error.code, 'REFRESH_JOB_LOST');
    assert.match(error.message, /yeniden başladı/);
    assert.equal(error.diagnosis.code, 'REFRESH_JOB_LOST');
    assert.match(error.diagnosis.title.en, /server restarted/);
    assert.match(error.diagnosis.action.tr, /server-restart\.log/);
    assert.match(error.diagnosis.technical.en, /job-a .*srv-1 → srv-2/);
    return true;
  });
  assert.equal(calls.fetch, 4, 'decided on the first answer from the restarted server');
});

test('an older server without an instance id is detected by the missing job record', async () => {
  const { context } = watcher([{ running: false, phase: 'idle', jobId: null }], 'en');
  await assert.rejects(context.waitForRefreshJob({ jobId: 'job-a', startedAt: started.startedAt }), error => {
    assert.equal(error.code, 'REFRESH_JOB_LOST');
    assert.match(error.message, /server restarted/);
    return true;
  });
});

test('the started job still completes normally and a foreign job is never accepted as success', async () => {
  const done = { ...started, running: false, phase: 'done', loadedAt: 'L2' };
  const ok = watcher([running, done]);
  assert.equal((await ok.context.waitForRefreshJob(started)).loadedAt, 'L2');
  const { refreshJobWatchVerdict } = watcher([done]).context;
  assert.equal(refreshJobWatchVerdict(started, done), 'match');
  assert.equal(refreshJobWatchVerdict(started, { ...done, jobId: 'job-b', startedAt: 'x' }), 'foreign');
  assert.equal(refreshJobWatchVerdict(started, { ...done, serverInstanceId: 'srv-9' }), 'lost');
  assert.equal(refreshJobWatchVerdict(null, { running: false, phase: 'idle', jobId: null }), 'match');
});

test('server reports a per-process instance id on every refresh status, including idle', () => {
  assert.match(SERVER, /const SERVER_INSTANCE_ID = crypto\.randomBytes\(8\)\.toString\('hex'\);/);
  const state = between(SERVER, 'function refreshJobState(id)', 'async function performRefresh');
  assert.match(state, /phase: 'idle', jobId: null, serverInstanceId: SERVER_INSTANCE_ID/);
  assert.match(state, /jobId: job\.jobId \|\| null,\s*serverInstanceId: SERVER_INSTANCE_ID/);
});
