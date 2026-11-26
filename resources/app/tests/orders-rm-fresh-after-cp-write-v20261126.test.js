'use strict';

/* SİPARİŞLER OKUMA MODELİ — CP YAZIMINDAN SONRA ESKİ DEĞER (ADR-0003 §6D / O3 bulgusu)
 *
 * Okuma modeli açıkken Siparişler satırları sunucudaki pencereli sorgudan gelir;
 * `state.orders` yüklü değildir. CP düzenlemesi Siparişler'e `orderLinePeerRows`
 * (yalnız state.orders) ile, uzak satır yaması `remoteRowLists` (yalnız state.*)
 * ile yansıyordu. Pencere yalnız tam veri yükleme nedenleriyle geçersizleşiyordu
 * ve yazan sekme kendi canlı olayını yok sayıyordu. Sonuç (gerçek tarayıcı, 6/6):
 * CP'de Supp. FOB 777,77 yapıldıktan sonra aynı sekmede Siparişler ≥20 sn 8,97
 * gösterdi; yalnız arama / yeni sekme / yenileme düzeltiyordu.
 *
 * Düzeltme: CP yazımı sunucuda onaylandığında (`buyerlog:cp-write-ack`, üç yazım
 * yolunun ortak sinyali) ve uzak satır yaması geldiğinde pencere geçersizleşir;
 * Siparişler görünürse birleştirilmiş tek yeniden çizim yapılır. Onaydan ÖNCE
 * geçersizleştirilmez: sunucu henüz eski değeri döndürürdü ve o sonuç yeni sanılırdı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function harness({ enabled = true, rows = [{ id: 1 }], tab = 'cp' } = {}) {
  const timers = [];
  const calls = { invalidate: [], render: 0 };
  const ordersRM = { rows, sourceRenderTimer: null };
  const globals = {
    ordersRM,
    ordersReadModelEnabled: () => enabled,
    ordersRMInvalidate: reason => calls.invalidate.push(reason),
    currentActiveTab: () => api.tab,
    renderOrders: () => { calls.render++; },
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
  };
  const fns = loadAppMainFunctions(['ordersRMSourceChanged'], globals);
  const api = { ...fns, calls, ordersRM, timers, tab, flush: () => { for (const t of timers.splice(0)) if (!t.cleared) t.fn(); } };
  return api;
}

test('CP yazım onayı pencereyi geçersiz kılar; Siparişler görünmüyorsa sorgu yapılmaz (sonraki açılış yeniden sorgular)', () => {
  const h = harness({ tab: 'cp' });
  h.ordersRMSourceChanged('cp-write-ack');
  h.flush();
  assert.deepEqual(h.calls.invalidate, ['cp-write-ack']);
  assert.equal(h.calls.render, 0, 'no query while Orders is hidden');
});

test('Siparişler görünürken art arda gelen değişiklikler tek yeniden çizimde birleşir', () => {
  const h = harness({ tab: 'orders' });
  for (let i = 0; i < 5; i++) h.ordersRMSourceChanged('remote-row-patch');
  assert.equal(h.calls.render, 0, 'render is coalesced, not immediate');
  h.flush();
  assert.equal(h.calls.invalidate.length, 5);
  assert.equal(h.calls.render, 1);
});

test('okuma modeli kapalıysa ya da pencere yüklenmediyse hiçbir şey yapılmaz (eski yol state.orders eşlerini zaten günceller)', () => {
  const off = harness({ enabled: false, tab: 'orders' });
  off.ordersRMSourceChanged('cp-write-ack'); off.flush();
  assert.deepEqual(off.calls, { invalidate: [], render: 0 });
  const empty = harness({ rows: null, tab: 'orders' });
  empty.ordersRMSourceChanged('cp-write-ack'); empty.flush();
  assert.deepEqual(empty.calls, { invalidate: [], render: 0 });
});

test('kaynak sözleşmesi: onay sinyali ve uzak satır yaması pencereyi günceller; onaydan önce geçersizleştirilmez', () => {
  assert.match(SOURCE, /window\.addEventListener\('buyerlog:cp-write-ack',\(\)=>ordersRMSourceChanged\('cp-write-ack'\)\)/);
  const live = SOURCE.slice(SOURCE.indexOf("}else if(payload.area==='orders'){"), SOURCE.indexOf("}else if(payload.area==='fabric-cards'){"));
  assert.match(live, /applyRemoteRowPatches\(payload\.rowPatches\);ordersRMSourceChanged\('remote-row-patch'\);return;/);
  const peerSync = SOURCE.slice(SOURCE.indexOf('function syncOrderLinePeersFromCpRow('), SOURCE.indexOf('function captureCpPricingHistory('));
  assert.doesNotMatch(peerSync, /ordersRMSourceChanged|ordersRMInvalidate/, 'edit time is before the server has the value');
});
