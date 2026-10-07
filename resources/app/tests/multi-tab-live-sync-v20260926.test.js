'use strict';

/* Aynı bilgisayarda birden çok Buyer Log sekmesi (tarayıcı sekmesi veya
   masaüstü çalışma alanı sekmesi) — bulunan hatalar:

   1) Her sekme kendi SSE bağlantısını sürekli açık tutuyordu. Tarayıcı/Electron
      aynı kaynağa HTTP/1.1 ile en fazla 6 eşzamanlı bağlantı açar; 5 sekmede
      kayıt istekleri kuyrukta bekledi (canlı güncelleme hiç gelmedi), 6. sekme
      takıldı, 7. ve 8. sekme sayfayı hiç yükleyemedi. Artık tek sekme (Web
      Locks lideri) bağlantıyı açar, olaylar BroadcastChannel ile diğer
      sekmelere dağıtılır; lider kapanınca başka sekme devralır.
   2) Bağlantı koptuğunda (401 ile kalıcı kapanma, sunucu yeniden başlatma)
      EventSource bir daha denemiyordu ve boşlukta kaçırılan değişiklikler hiç
      alınmıyordu. Artık geri çekilmeli yeniden bağlanır ve açık veriyi hafifçe
      yeniden okur.
   3) Koleksiyon kaydı öncesi normalleştirme nesne alanlarını (pricing,
      pricingSent, variantOverrides…) yeniden oluşturduğu için sığ karşılaştırma
      dokunulmamış TÜM satırları değişmiş sayıyordu: tek hücre düzenlemesi bütün
      satırları gönderiyor, diğer sekme/kullanıcılar için satır revizyonlarını
      bayatlatıyordu.
   4) Masaüstünde modül sekmesi (?module=koleksiyon vb.) açılırken önce Genel
      Bakış çiziliyor, onun CP bağımlılığı ve Genel Bakış projeksiyonu her yeni
      sekmede yükleniyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAppMainFunctions, extractFunction } = require('./helpers/app-main-functions');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function sharedBrowser() {
  const channels = new Set();
  class FakeChannel {
    constructor(name) { this.name = name; this.onmessage = null; channels.add(this); }
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data));
      for (const other of channels) if (other !== this && other.name === this.name && typeof other.onmessage === 'function') queueMicrotask(() => other.onmessage({ data: copy }));
    }
    close() { channels.delete(this); }
  }
  const waiters = [];
  let holder = null;
  const locks = {
    request(name, callback) {
      return new Promise(resolve => {
        const grant = () => { holder = { release: resolve }; Promise.resolve(callback({ name })); };
        if (!holder) grant(); else waiters.push(grant);
      });
    },
  };
  const releaseLeader = () => { holder = null; const next = waiters.shift(); if (next) next(); };
  const sources = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.readyState = 0; sources.push(this); }
    close() { this.readyState = 2; this.closed = true; }
  }
  return { FakeChannel, locks, releaseLeader, sources, FakeEventSource };
}

function tab(browser, id) {
  const calls = { collection: [], resync: 0, orders: [] };
  const globals = {
    window: { BL_CLIENT_ID: id, dispatchEvent() {} },
    navigator: { locks: browser.locks },
    BroadcastChannel: browser.FakeChannel,
    EventSource: browser.FakeEventSource,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {},
    liveSyncConnected: false,
    renderSyncStatusBadge() {}, syncStatusModalRenderer: null,
    refreshSharedMasterClient: async () => {}, refreshPricingRulesFromServer: async () => {},
    applyRemoteRowPatches: rows => { calls.orders.push(rows); },
    loadFromServer: async () => {},
    kolHandleRemoteChange: async (ownerId, payload) => { calls.collection.push([ownerId, payload && payload.mode]); },
    initKolWorkspaces: async () => {},
    liveSyncResyncAfterGap: () => { calls.resync += 1; },
  };
  const fns = loadAppMainFunctions(['initLiveSync'], globals);
  fns.initLiveSync();
  return { calls, context: fns.context };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

test('sekmeler tek canlı bağlantıyı paylaşır; olay her sekmeye ulaşır, kendi yazdığı hariç', async () => {
  const browser = sharedBrowser();
  const a = tab(browser, 'tab-a'), b = tab(browser, 'tab-b'), c = tab(browser, 'tab-c');
  await flush();
  assert.equal(browser.sources.length, 1, 'yalnız lider sekme SSE açar (6 bağlantı sınırı)');
  const source = browser.sources[0];
  source.readyState = 1; source.onopen();
  await flush();
  assert.equal(b.context.liveSyncConnected, true, 'takipçi sekme de bağlı sayılır');
  source.onmessage({ data: JSON.stringify({ area: 'collection', ownerId: 'o1', mode: 'patch', rowPatches: [{ key: 'id:1' }], originClientId: 'tab-b' }) });
  await flush();
  assert.equal(a.calls.collection.length, 1);
  assert.equal(c.calls.collection.length, 1);
  assert.equal(b.calls.collection.length, 0, 'yazan sekme kendi olayını yeniden uygulamaz');
});

test('lider sekme kapanınca başka sekme bağlantıyı devralır ve kaçırılanları yeniden okur', async () => {
  const browser = sharedBrowser();
  tab(browser, 'tab-a'); const b = tab(browser, 'tab-b');
  await flush();
  browser.sources[0].onopen(); await flush();
  browser.sources[0].close(); browser.releaseLeader();
  await flush();
  assert.equal(browser.sources.length, 2, 'yeni lider bağlantı açar');
  browser.sources[1].onopen(); await flush();
  assert.equal(b.calls.resync, 1, 'devir boşluğunda kaçırılan değişiklikler yeniden okunur');
});

test('kalıcı kapanan bağlantı (401/sunucu yeniden başladı) yeniden kurulur ve boşluk sonrası tüm sekmeler yeniden okur', async () => {
  const browser = sharedBrowser();
  const a = tab(browser, 'tab-a'), b = tab(browser, 'tab-b');
  await flush();
  const first = browser.sources[0];
  first.onopen(); await flush();
  first.readyState = 2; first.onerror();
  await flush();
  assert.equal(b.context.liveSyncConnected, false);
  assert.equal(browser.sources.length, 2, 'EventSource kalıcı kapanınca yeniden kurulur');
  browser.sources[1].onopen(); await flush();
  assert.equal(a.calls.resync, 1);
  assert.equal(b.calls.resync, 1);
  assert.equal(b.context.liveSyncConnected, true);
});

test('BroadcastChannel/Web Locks yoksa sekme kendi bağlantısıyla eski davranışı sürdürür', async () => {
  const browser = sharedBrowser();
  const calls = [];
  const fns = loadAppMainFunctions(['initLiveSync'], {
    window: { BL_CLIENT_ID: 'solo', dispatchEvent() {} }, navigator: {}, EventSource: browser.FakeEventSource,
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {}, liveSyncConnected: false,
    kolHandleRemoteChange: async owner => { calls.push(owner); }, liveSyncResyncAfterGap() {},
  });
  fns.initLiveSync();
  assert.equal(browser.sources.length, 1);
  browser.sources[0].onmessage({ data: JSON.stringify({ area: 'collection', ownerId: 'o1', mode: 'reload' }) });
  await flush();
  assert.deepEqual(calls, ['o1']);
});

test('boşluk sonrası yeniden okuma açık verileri hafif yoldan tazeler', () => {
  const body = extractFunction(APP, 'liveSyncResyncAfterGap');
  assert.match(body, /loadFromServer\(false\)/);
  assert.doesNotMatch(body, /loadFromServer\(true/);
  assert.match(body, /kolHandleRemoteChange\(kolWorkspaceOwnerId,\{mode:'reload'\}\)/);
  assert.match(body, /BL_QUOTATIONS\?\.refresh\?\.\(\)/);
});

test('koleksiyon satır karşılaştırması iç nesneleri içerikle karşılaştırır (normalleştirme tüm satırları değiştirmez)', () => {
  const { kolRowEqual } = loadAppMainFunctions(['kolRowEqual', 'kolValueEqual']);
  const base = { id: 1, not: 'a', pricing: { A: '1' }, pricingSent: {}, variantOverrides: { x: 1 }, _rev: 3 };
  const renormalized = { ...base, pricing: { ...base.pricing }, pricingSent: {}, variantOverrides: { ...base.variantOverrides }, _rev: 3 };
  assert.equal(kolRowEqual(base, renormalized), true);
  assert.equal(kolRowEqual(base, { ...renormalized, pricing: { A: '2' } }), false);
  assert.equal(kolRowEqual(base, { ...renormalized, not: 'b' }), false);
});

test('modül sekmesi Genel Bakış’ı ve onun CP bağımlılığını açılışta yüklemez; Genel Bakış ilk girişte yüklenir', () => {
  const startup=APP.slice(APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"),APP.indexOf('async function refreshFolderLabel'));
  const bootModule=startup.indexOf('window.BL_BOOT_MODULE=requestedModule;');
  const initialLoad=startup.indexOf('await loadInitialBuyerLogData(');
  assert.ok(bootModule>=0&&initialLoad>bootModule,'boot module must be selected before initial data hydration');
  assert.match(extractFunction(APP, 'renderStartupActiveModule'), /if\(activeTab==='overview'&&!window\.BL_BOOT_MODULE\)renderOverview\(\);/);
  assert.match(APP, /if\(state\.overviewDeferred&&currentActiveTab\(\)==='overview'\)void ensureOverviewLoaded\(\);/);
  assert.match(extractFunction(APP, 'switchTab'), /if\(tab==='overview'&&state\.overviewDeferred\)void ensureOverviewLoaded\(\);/);
});

test('koleksiyon kaydı canlı olayı paylaşım yayınını beklemeden gönderir', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'oab-batch-routes.js'), 'utf8');
  const body = route.slice(route.indexOf("app.patch('/api/collection-workspaces/:ownerId'"), route.indexOf("app.get('/api/oab/state'"));
  assert.ok(body.indexOf("liveEvents.notifyChange('collection'") < body.indexOf('publishCollectionReplica(ownerId)'), 'yerel kayıt biter bitmez diğer sekmelere bildirilir');
});
