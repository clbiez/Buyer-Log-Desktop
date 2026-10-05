'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  staleCalculatedColumnFromError,
  buildAntrepoStaleFallback,
} = require('../server/lib/model-refresh');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const REFRESH = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-refresh.js'), 'utf8');

const IAS_STALE_ERROR =
  "The expression referenced column 'Ithalat'[Retail - YüklemeTalep Durum] which does not hold any data because it needs to be recalculated or refreshed.";

test('IASv2 recalculation error is identified as an upstream stale calculated column', () => {
  const error = Object.assign(new Error(IAS_STALE_ERROR), {
    code: 'MODEL_QUERY_FAILED',
    statusCode: 502,
  });
  assert.deepEqual(staleCalculatedColumnFromError(error), {
    table: 'Ithalat',
    column: 'Retail - YüklemeTalep Durum',
    message: IAS_STALE_ERROR,
  });
  assert.equal(staleCalculatedColumnFromError(new Error('network timeout')), null);
  assert.equal(staleCalculatedColumnFromError(new Error("Column 'X' in table 'Y' cannot be found")), null);
});

test('stale IAS fallback is allowed only with a real last-known-good snapshot for every requested IAS target', () => {
  const previousCp = { cp: true };
  const previousOrders = { orders: true };
  const previousBacklog = { backlog: true };
  const error = Object.assign(new Error(IAS_STALE_ERROR), { code: 'MODEL_QUERY_FAILED' });
  const result = buildAntrepoStaleFallback({
    allowStaleAntrepoFallback: true,
    previousAntrepoLoadedAt: '2026-10-04T17:11:37.753Z',
    previousAntrepoMapByTarget: {
      cp: previousCp,
      orders: previousOrders,
      backlog: previousBacklog,
    },
  }, ['cp', 'orders', 'backlog', 'lfl'], error);

  assert.ok(result);
  assert.equal(result.table, 'Ithalat');
  assert.equal(result.column, 'Retail - YüklemeTalep Durum');
  assert.equal(result.previousLoadedAt, '2026-10-04T17:11:37.753Z');
  assert.deepEqual(result.targets, ['cp', 'orders', 'backlog']);
  assert.equal(result.byTarget.cp, previousCp);
  assert.equal(result.byTarget.orders, previousOrders);
  assert.equal(result.byTarget.backlog, previousBacklog);

  assert.equal(buildAntrepoStaleFallback({
    allowStaleAntrepoFallback: true,
    previousAntrepoMapByTarget: { cp: previousCp },
  }, ['cp'], error), null, 'timestamp olmadan boş/ilk çalıştırma fallback sayılmamalı');

  assert.equal(buildAntrepoStaleFallback({
    allowStaleAntrepoFallback: true,
    previousAntrepoLoadedAt: '2026-10-04T17:11:37.753Z',
    previousAntrepoMapByTarget: { cp: previousCp },
  }, ['cp', 'orders'], error), null, 'istenen IAS hedeflerinden biri eksikse kısmi veri yayınlanmamalı');

  assert.equal(buildAntrepoStaleFallback({
    allowStaleAntrepoFallback: true,
    previousAntrepoLoadedAt: '2026-10-04T17:11:37.753Z',
    previousAntrepoMapByTarget: { cp: previousCp },
  }, ['cp'], new Error('VPN unavailable')), null, 'ağ hatası stale-model fallback ile gizlenmemeli');
});

test('main refresh wires previous IAS runtime into fail-closed last-known-good fallback', () => {
  assert.match(SERVER, /allowStaleAntrepoFallback:\s*antrepoMode === 'database' && needsAntrepo/);
  assert.match(SERVER, /previousAntrepoMapByTarget:\s*runtime\.antrepoMapByTarget \|\| null/);
  assert.match(SERVER, /previousAntrepoLoadedAt:[\s\S]{0,220}?runtime\.loadedAt/);
  assert.match(SERVER, /antrepoLiveAt:\s*result\.antrepoFallback/);

  assert.match(REFRESH, /antrepoFallback = buildAntrepoStaleFallback\(options, requestedTargets, error\)/);
  assert.match(REFRESH, /Object\.assign\(antrepoMapByTarget, antrepoFallback\.byTarget\)/);
  assert.match(REFRESH, /Yanlış veya eksik IAS verisi yazılmadı/);
  assert.match(REFRESH, /IASv2 modeli yeniden işlendiğinde sonraki yenileme otomatik olarak canlı veriye döner/);
});
