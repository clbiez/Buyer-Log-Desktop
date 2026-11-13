'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { syncPlmBoms } = require('../server/lib/plm-bom-sync');
const bomApi = require('../server/lib/corenectum-bom-api');
const styleApi = require('../server/lib/corenectum-style-api');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const records = (count = 5) => Array.from({ length: count }, (_, i) => ({ plmId: String(100 + i), styleId: String(200 + i), productType: 'Set Style' }));
const payload = styleId => ({ data: { success: true, coreNectumResultData: { styleBom: { styleId: Number(styleId), styleBomComponents: [] } } } });
const store = () => ({ load: () => ({ models: {} }), saveResults: entries => ({ written: entries.length, revision: 1 }) });
function transport(counters, owner) {
  const call = async (url, body, opts) => {
    counters.active++; counters.total++;
    counters.byOwner[owner] = (counters.byOwner[owner] || 0) + 1;
    counters.peak = Math.max(counters.peak, counters.active);
    counters.ownerPeak[owner] = Math.max(counters.ownerPeak[owner] || 0, counters.byOwner[owner]);
    await pause(8);
    counters.active--; counters.byOwner[owner]--;
    if (url === styleApi.GET_STYLE_LIST_URL) return {};
    if (url === bomApi.GET_STYLE_BOM_INFORMATION_URL) return payload(body.styleId);
    return { data: { success: true, coreNectumResultData: { setStyleChildStyleColorAssociations: Array.from({ length: 6 }, (_, i) => ({ rowId: i + 1, relatedStyleOptions: [{ setStyleId: body.styleId, childStyleId: Number(body.styleId) * 10 + i, childStylePlmCode: Number(body.styleId) * 100 + i, childStyleName: `DEMO-${i}`, perAssemblyCount: 1 }] })) } } };
  };
  return { getJson: call, postJson: call };
}
function counters() { return { active: 0, total: 0, peak: 0, byOwner: {}, ownerPeak: {} }; }

test('INT07: five sets with six children and two jobs share at most five owner reads', async () => {
  const c = counters();
  const opts = { ownerId: 'int07-same', store: store(), ...transport(c, 'same') };
  const results = await Promise.all([syncPlmBoms(records(), opts), syncPlmBoms(records(), opts)]);
  assert.ok(c.peak <= 5, `active reads peaked at ${c.peak}`);
  assert.equal(c.total, 80);
  for (const r of results) { assert.equal(r.fetched, 5); assert.equal(r.failed.length, 0); assert.equal(r.entries.get('100').setComponents.length, 6); }
});

test('INT07: separate owners make progress together without a global serial queue', async () => {
  const c = counters();
  await Promise.all(['int07-a', 'int07-b'].map(owner => syncPlmBoms(records(), { ownerId: owner, store: store(), ...transport(c, owner) })));
  assert.ok(c.peak > 5);
  assert.ok(Object.values(c.ownerPeak).every(value => value <= 5), JSON.stringify(c.ownerPeak));
});

test('INT07: transient reads request one client attempt and stop after four total rounds', async () => {
  const attempts = [];
  const result = await syncPlmBoms([{ plmId: '1', styleId: '2' }], {
    ownerId: 'int07-retry', store: store(), retryRounds: 100, retryDelaysMs: [0],
    postJson: async (_url, _body, options) => { attempts.push(options.retries); throw Object.assign(new Error('503'), { code: 'CORENECTUM_API_HTTP_ERROR', details: { remoteStatus: 503, retryable: true } }); },
  });
  assert.deepEqual(attempts, [1, 1, 1, 1]);
  assert.equal(result.failed.length, 1);
});

test('INT07: permanent HTTP and validation failures do not retry successful read-only POSTs', async () => {
  for (const error of [Object.assign(new Error('400'), { code: 'CORENECTUM_API_HTTP_ERROR', details: { remoteStatus: 400, retryable: false } }), Object.assign(new Error('mismatch'), { code: 'PLM_BOM_STYLE_MISMATCH' })]) {
    let calls = 0;
    const r = await syncPlmBoms([{ plmId: '1', styleId: '2' }], { ownerId: 'int07-permanent', store: store(), retryDelaysMs: [0], postJson: async () => { calls++; throw error; } });
    assert.equal(calls, 1); assert.equal(r.failed.length, 1);
  }
});

module.exports = { records, payload, store, transport, counters };

test('INT07: cancelled queued job never starts HTTP, active calls retain permits until settled', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered = 0, queuedCalls = 0, cancelled = false;
  const singles = records().map(r => ({ ...r, productType: 'Single Style' }));
  const active = syncPlmBoms(singles, { ownerId: 'int07-queue', store: store(), postJson: async (_url, body) => { entered++; await held; return payload(body.styleId); } });
  while (entered < 5) await pause(1);
  const queued = syncPlmBoms(singles, { ownerId: 'int07-queue', store: store(), isCancelled: () => cancelled, postJson: async (_url, body) => { queuedCalls++; return payload(body.styleId); } });
  cancelled = true;
  const result = await queued;
  assert.equal(result.stopped, 'cancelled'); assert.equal(result.skipped, 5); assert.equal(result.failed.length, 0); assert.equal(queuedCalls, 0);
  let afterCalls = 0;
  const after = syncPlmBoms(singles, { ownerId: 'int07-queue', store: store(), postJson: async (_url, body) => { afterCalls++; return payload(body.styleId); } });
  await pause(35); assert.equal(afterCalls, 0);
  release(); await active; await after; assert.equal(afterCalls, 5);
});

test('INT07: total read deadline includes queue and retry waits; it does not launch a replacement fetch', async () => {
  let calls = 0;
  const result = await syncPlmBoms([{ plmId: '1', styleId: '2' }], { ownerId: 'int07-deadline', store: store(), bomAdmissionMs: 5, retryDelaysMs: [0], postJson: async () => {
    calls++; await pause(15); throw Object.assign(new Error('timeout'), { code: 'CORENECTUM_API_TIMEOUT' });
  } });
  assert.equal(calls, 1); assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE');
});

test('INT07: partial failure preserves last successful model; successful set content is equivalent on retry', async () => {
  const c = counters(), baseTransport = transport(c, 'equivalence');
  const old = { plmId: '999', styleId: '999', fingerprint: 'old', summary: 'last known' };
  let saved = [];
  const dataStore = { load: () => ({ models: { 999: old } }), saveResults: entries => { saved = entries; return { revision: 1 }; } };
  const counts = new Map();
  const opts = { ownerId: 'int07-equivalence', store: dataStore, getJson: baseTransport.getJson, retryDelaysMs: [0], postJson: async (url, body, options) => {
    const key = JSON.stringify([url, body]); counts.set(key, (counts.get(key) || 0) + 1);
    if (body.styleId === 999) throw Object.assign(new Error('400'), { code: 'CORENECTUM_API_HTTP_ERROR', details: { remoteStatus: 400 } });
    if (body.styleId === 2000 && counts.get(key) === 1) throw Object.assign(new Error('429'), { code: 'CORENECTUM_API_HTTP_ERROR', details: { remoteStatus: 429 } });
    return baseTransport.postJson(url, body, options);
  } };
  const r = await syncPlmBoms([...records(1), { plmId: '999', styleId: '999' }], opts);
  const baseline = await syncPlmBoms(records(1), { ownerId: 'int07-baseline', store: store(), ...transport(counters(), 'baseline') });
  const normalize = entry => { const result = structuredClone(entry); delete result.fetchedAt; delete result.bomReadAt; return result; };
  assert.deepEqual(normalize(r.entries.get('100')), normalize(baseline.entries.get('100')));
  assert.strictEqual(r.entries.get('999'), old); assert.equal(r.failed.length, 1); assert.equal(saved.length, 1);
});

test('INT07 FINAL: one expired auth consumer detaches without cancelling another live target', async () => {
  const { createTargetBudget } = require('../server/lib/plm-bom-int07-budget');
  const first = createTargetBudget('int07-auth-shared', () => {}, { bomAdmissionMs: 50 });
  const second = createTargetBudget('int07-auth-shared', () => {}, { bomAdmissionMs: 2000 });
  let resolveAuth;
  const auth = new Promise(resolve => { resolveAuth = resolve; });
  try {
    const expired = assert.rejects(first.wait(auth), { code: 'PLM_BOM_READ_DEADLINE' });
    const live = second.wait(auth); await expired; resolveAuth(true);
    assert.equal(await live, true); second.check();
  } finally { first.dispose(); second.dispose(); }
});

test('INT07 FINAL: successful target signal is disposed without being aborted later', async () => {
  let signal;
  const result = await syncPlmBoms([{ plmId: '1', styleId: '2' }], { ownerId: 'int07-success', store: store(), bomAdmissionMs: 80,
    postJson: async (_url, _body, opts) => { signal = opts.signal; return payload(2); } });
  assert.equal(result.fetched, 1); await pause(100); assert.equal(signal.aborted, false);
});
