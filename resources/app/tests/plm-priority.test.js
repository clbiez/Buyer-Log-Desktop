'use strict';
/* "Önce kullanıcı" kuralı: sessiz (arka plan) PLM işi, kullanıcının elle
 * başlattığı PLM işine her zaman yol verir; kullanıcı 409 görmez, sessiz işin
 * yaptığı iş kaybolmaz, manuel iş sürerken sessiz iş başlamaz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createJobRegistry } = require('../server/lib/job-registry.js');
const { createPlmPriority } = require('../server/lib/plm-priority.js');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function setup({ waitMs = 1000 } = {}) {
  const jobs = createJobRegistry();
  let clock = 0;
  const sleeps = [];
  const priority = createPlmPriority({
    jobs, waitMs, pollMs: 10,
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; await new Promise(resolve => setImmediate(resolve)); },
  });
  return { jobs, priority, sleeps, advance: ms => { clock += ms; } };
}

test('registry: cancelBackground cancels only running background jobs of that user', () => {
  const jobs = createJobRegistry();
  const bg = jobs.create('u1', { kind: 'plm-images', background: true });
  const fg = jobs.create('u1', { kind: 'plm-sync' });
  const other = jobs.create('u2', { kind: 'plm-images', background: true });
  assert.deepEqual(jobs.cancelBackground('u1'), [bg.id]);
  assert.equal(jobs.isCancelled('u1', bg.id), true);
  assert.equal(jobs.isCancelled('u1', fg.id), false);
  assert.equal(jobs.isCancelled('u2', other.id), false);
});

test('registry: hasForeground sees only running user-started jobs', () => {
  const jobs = createJobRegistry();
  jobs.create('u1', { kind: 'plm-images', background: true });
  assert.equal(jobs.hasForeground('u1'), false);
  const fg = jobs.create('u1', { kind: 'plm-sync' });
  assert.equal(jobs.hasForeground('u1'), true);
  jobs.finish('u1', fg.id, { status: 'succeeded' });
  assert.equal(jobs.hasForeground('u1'), false);
});

test('silent request is recognised only by the shared header contract', () => {
  const { priority } = setup();
  assert.equal(priority.isBackgroundRequest({ headers: { 'x-buyerlog-auth-mode': 'silent' } }), true);
  assert.equal(priority.isBackgroundRequest({ headers: { 'x-buyerlog-auth-mode': 'interactive' } }), false);
  assert.equal(priority.isBackgroundRequest({ currentUser: { id: 'u1' } }), false);
  assert.equal(priority.isBackgroundRequest(null), false);
});

test('user-started PLM job cancels running silent jobs (rule 1)', () => {
  const { jobs, priority } = setup();
  const bg = jobs.create('u1', { kind: 'plm-bom', background: true });
  assert.deepEqual(priority.admit('u1', { background: false }), [bg.id]);
  assert.equal(jobs.isCancelled('u1', bg.id), true);
});

test('silent job does not start while a user-started PLM job runs (rule 3)', () => {
  const { jobs, priority } = setup();
  jobs.create('u1', { kind: 'plm-sync' });
  assert.throws(() => priority.admit('u1', { background: true }), err => err.code === 'PLM_BACKGROUND_DEFERRED' && err.statusCode === 409);
  assert.doesNotThrow(() => priority.admit('u2', { background: true }), 'another user is not affected');
});

test('user import waits for a silent holder to yield instead of failing with 409', async () => {
  const { jobs, priority } = setup();
  const locks = new Map();
  const bg = jobs.create('u1', { kind: 'plm-images', background: true });
  let releaseSilent;
  const silent = priority.withLock(locks, 'u1', { background: true }, () => new Promise(resolve => { releaseSilent = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const waits = [];
  const user = priority.withLock(locks, 'u1', { background: false, onWait: () => waits.push('waiting') }, async () => 'user-done');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(jobs.isCancelled('u1', bg.id), true, 'silent job is asked to stop');
  assert.deepEqual(waits, ['waiting']);
  releaseSilent('silent-partial');
  assert.equal(await silent, 'silent-partial', 'silent work finishes its checkpoint (nothing lost)');
  assert.equal(await user, 'user-done');
  assert.equal(locks.size, 0);
});

test('user import still gets the old busy error if the silent holder never yields', async () => {
  const { jobs, priority } = setup({ waitMs: 50 });
  const locks = new Map();
  jobs.create('u1', { kind: 'plm-images', background: true });
  void priority.withLock(locks, 'u1', { background: true }, () => new Promise(() => {}));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    priority.withLock(locks, 'u1', { background: false, busyCode: 'MODEL_IMAGE_IMPORT_BUSY' }, async () => 'never'),
    err => err.code === 'MODEL_IMAGE_IMPORT_BUSY' && err.statusCode === 409,
  );
});

test('two user imports keep the existing busy rule; silent never waits behind anyone', async () => {
  const { priority } = setup();
  const locks = new Map();
  void priority.withLock(locks, 'u1', { background: false }, () => new Promise(() => {}));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(priority.withLock(locks, 'u1', { background: false, busyCode: 'MODEL_IMAGE_IMPORT_BUSY' }, async () => 1), err => err.code === 'MODEL_IMAGE_IMPORT_BUSY');
  await assert.rejects(priority.withLock(locks, 'u1', { background: true }, async () => 1), err => err.code === 'PLM_BACKGROUND_DEFERRED');
});

test('server wires the priority rule into PLM jobs and image imports', () => {
  const server = read('server/server.js');
  assert.match(server, /createPlmPriority\(/);
  const withJob = server.slice(server.indexOf('async function withPlmJob'), server.indexOf('async function withPlmJob') + 900);
  assert.match(withJob, /plmPriority\.admit\(userId, \{ background \}\)/);
  const lock = server.slice(server.indexOf('async function withModelImageImportLock'), server.indexOf('async function withModelImageImportLock') + 900);
  assert.match(lock, /plmPriority\.withLock\(modelImageImportLocks/);
  const start = server.indexOf('async function runPlmImageImport');
  const run = server.slice(start, server.indexOf('\nasync function ', start + 10));
  assert.match(run, /plmPriority\.admit\(req\.currentUser\.id, \{ background \}\)/);
  assert.match(run, /withModelImageImportLock\(req\.currentUser\.id,async\(\)=>\{[\s\S]*\}, \{ background, onWait: \(\) => reportStage\('waiting-lock'\) \}\);/);
  assert.match(run, /clearModelOperationProgress\(req\.currentUser&&req\.currentUser\.id,\{background:plmJobBackground\(req\)\}\)/);
});

test('silent jobs never write or clear the user\'s button progress slot (rule 4)', () => {
  const server = read('server/server.js');
  assert.match(server, /function setModelOperationProgress\(userId, value, options\)\{ if\(options&&options\.background\)return;/);
  assert.match(server, /function clearModelOperationProgress\(userId, options\)\{ if\(options&&options\.background\)return;/);
  const report = server.slice(server.indexOf('function reportImageProgress'), server.indexOf('function reportImageProgress') + 400);
  assert.match(report, /\{ background: plmPriority\.isBackgroundRequest\(req\) \}/);
  const routes = read('server/routes/plm-sync-routes.js');
  const fetch = routes.slice(routes.indexOf('function createPlmFetchService'));
  assert.match(fetch, /const background=Boolean\(deps\.plmPriority&&deps\.plmPriority\.isBackgroundRequest\(request\)\)/);
  assert.match(fetch, /clearModelOperationProgress\(profile\.id,\{background\}\)/);
  // The phase-2 BOM job spawned by a silent fetch stays a background job.
  assert.match(fetch.slice(fetch.indexOf('function startBackgroundBom')), /background,?\s/);
});
