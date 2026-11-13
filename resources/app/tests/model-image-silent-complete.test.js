'use strict';

/* Sessiz eksik görsel tamamlama — zamanlayıcı sözleşmesi.
 * Gerçek zaman yok: saat, zamanlayıcı, boşta geri çağrısı ve depo enjekte. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSilentImageCompleter, readEnabled, writeEnabled, NEGATIVE_KEY } = require('../public/model-image-silent-complete.js');

function memoryStorage() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), map };
}

function harness({ identities = [], resolved = new Set(), requestImpl, options = {}, storage = memoryStorage(), enabled = true, idleTimeout = false } = {}) {
  let clock = 1_000_000;
  const timers = [];
  const calls = [];
  const applied = [];
  let view = { token: 'v1', current: true };
  const env = {
    now: () => clock,
    setTimeout: (fn, ms) => { const t = { fn, at: clock + ms, id: timers.length + 1 }; timers.push(t); return t.id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestIdle: cb => cb({ didTimeout: idleTimeout, timeRemaining: () => 8 }),
    storage,
    isEnabled: () => enabled,
    collect: ({ limit, skip }) => ({
      viewToken: view.token, contextType: 'cp',
      identities: identities.filter(item => !skip(item)).slice(0, limit),
      isStillCurrent: () => view.current,
    }),
    request: async (items) => { calls.push(items); return requestImpl ? requestImpl(items) : { ok: true, images: [] }; },
    apply: (data, ctx) => applied.push(ctx),
    isResolved: identity => resolved.has(identity.key),
    options: { quietMs: 3000, intervalMs: 5000, ...options },
  };
  const api = createSilentImageCompleter(env);
  return {
    api, calls, applied, timers, storage, env,
    setView: next => { view = { ...view, ...next }; },
    advance: async ms => {
      const target = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift(); clock = next.at; next.fn();
        for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
      }
      clock = target;
    },
  };
}

const ids = n => Array.from({ length: n }, (_, i) => ({ key: 'plm:' + (100 + i) + '|colour:HFB', item: { plmId: String(100 + i), colourCode: 'HFB' } }));

test('başlatılmadan ve zamanlayıcı dolmadan istek yok; tek zamanlayıcı', async () => {
  const h = harness({ identities: ids(3) });
  await h.advance(60_000);
  assert.equal(h.calls.length, 0, 'start() yokken istek gitmez');
  h.api.start(); h.api.start();
  assert.equal(h.timers.length, 1, 'tek zamanlayıcı');
  await h.advance(4_999);
  assert.equal(h.calls.length, 0);
  await h.advance(1);
  assert.equal(h.calls.length, 1);
});

test('kullanıcı etkileşimdeyken istek gitmez; sessizlikten sonra gider', async () => {
  const h = harness({ identities: ids(3) });
  h.api.start();
  for (let i = 0; i < 10; i++) { h.api.notifyInteraction(); await h.advance(1000); }
  assert.equal(h.calls.length, 0);
  await h.advance(8000);
  assert.equal(h.calls.length, 1);
});

test('tarayıcı meşgulse (idle zaman aşımı) tur atlanır', async () => {
  const h = harness({ identities: ids(3), idleTimeout: true });
  h.api.start();
  await h.advance(60_000);
  assert.equal(h.calls.length, 0);
  assert.ok(h.api.stats().skippedBusy > 0);
});

test('küçük paket, görünür sıra korunur, aynı görünümde kimlik tekrar istenmez', async () => {
  const list = ids(30);
  const h = harness({ identities: list, options: { batchSize: 12 }, resolved: new Set(list.map(i => i.key)) });
  h.api.start();
  await h.advance(5000);
  assert.equal(h.calls[0].length, 12);
  assert.deepEqual(h.calls[0].map(i => i.plmId), list.slice(0, 12).map(i => i.item.plmId));
  await h.advance(5000); await h.advance(5000); await h.advance(60_000);
  const all = h.calls.flat().map(i => i.plmId);
  assert.equal(all.length, 30, 'her kimlik bir kez');
  assert.equal(new Set(all).size, 30);
});

test('aynı anda tek iş: yanıt beklenirken yeni istek gitmez', async () => {
  let release;
  const h = harness({ identities: ids(40), requestImpl: () => new Promise(r => { release = r; }) });
  h.api.start();
  await h.advance(5000);
  assert.equal(h.calls.length, 1);
  h.api.tick(); h.api.tick();
  assert.equal(h.calls.length, 1);
  release({ ok: true, images: [] });
  await h.api.pending();
});

test('negatif önbellek 24 saat kalıcıdır; açılıştan açılışa aynı boş istek gitmez', async () => {
  const storage = memoryStorage();
  const first = harness({ identities: ids(2), storage });
  first.api.start();
  await first.advance(5000);
  assert.equal(first.calls.length, 1);
  assert.ok(storage.getItem(NEGATIVE_KEY), 'kalıcı');
  first.api.stop();

  const second = harness({ identities: ids(2), storage });
  second.api.start();
  await second.advance(60_000);
  assert.equal(second.calls.length, 0, 'yeni oturumda aynı kimlik istenmez');
  await second.advance(24 * 60 * 60 * 1000);
  assert.equal(second.calls.length, 1, 'süre dolunca yeniden denenir');
});

test('kullanıcı işi sürerken 409 PLM_BACKGROUND_DEFERRED: negatif yazılmaz, sonra yeniden denenir', async () => {
  let n = 0;
  const h = harness({ identities: ids(2), requestImpl: () => { n++; if (n === 1) throw Object.assign(new Error('x'), { code: 'PLM_BACKGROUND_DEFERRED' }); return { ok: true, images: [] }; } });
  h.api.start();
  await h.advance(5000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.api.isNegative(ids(1)[0].key), false);
  await h.advance(20_000);
  assert.equal(h.calls.length, 1, 'geri çekilme süresince istek yok');
  await h.advance(30_000);
  assert.equal(h.calls.length, 2);
});

test('görünüm değişirse yama yapılmaz (current=false); kanonik uygulama çağrılır', async () => {
  let release;
  const h = harness({ identities: ids(2), requestImpl: () => new Promise(r => { release = r; }) });
  h.api.start();
  await h.advance(5000);
  h.setView({ current: false });
  release({ ok: true, images: [] });
  await h.api.pending();
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].current, false);
});

test('anahtar kapalı, sekme gizli veya çevrimdışı iken istek gitmez', async () => {
  const off = harness({ identities: ids(2), enabled: false });
  off.api.start(); await off.advance(60_000);
  assert.equal(off.calls.length, 0);
  const storage = memoryStorage();
  assert.equal(readEnabled(storage), true, 'varsayılan açık');
  writeEnabled(storage, false);
  assert.equal(readEnabled(storage), false);
  const hidden = harness({ identities: ids(2) });
  hidden.env.isHidden = () => true;
  const api = createSilentImageCompleter({ ...hidden.env, isHidden: () => true, isOnline: () => false });
  api.start(); await hidden.advance(60_000);
  assert.equal(hidden.calls.length, 0);
});

test('başka örnek işliyorsa (waitingOtherInstance) bulunamadı belleğine yazılmaz', async () => {
  const h = harness({ identities: ids(2), requestImpl: () => ({ ok: true, images: [], distribution: { waitingOtherInstance: 2 } }) });
  h.api.start(); await h.advance(5000);
  assert.equal(h.api.isNegative(ids(1)[0].key), false);
});

test('PLM oturumu yoksa (token gerekli) 30 dk boyunca yeniden denenmez; giriş istenmez', async () => {
  let n = 0;
  const h = harness({ identities: ids(2), requestImpl: () => { n++; throw Object.assign(new Error('auth'), { code: 'CORENECTUM_API_TOKEN_REQUIRED' }); } });
  h.api.start();
  await h.advance(5000);
  assert.equal(n, 1);
  await h.advance(29 * 60 * 1000);
  assert.equal(n, 1);
  await h.advance(2 * 60 * 1000);
  assert.equal(n, 2);
  assert.equal(h.api.isNegative(ids(1)[0].key), false, 'yetki hatası bulunamadı sayılmaz');
});

test('PLM ertelendi (upstreamDeferred): yerel sonuç uygulanır, çözülen düşer, çözülmeyen negatif yazılmaz', async () => {
  const list = ids(3);
  const resolved = new Set([list[0].key]);
  const h = harness({ identities: list, resolved, requestImpl: () => ({ ok: true, images: [], imagemapPatch: {}, upstreamDeferred: { code: 'CORENECTUM_API_TOKEN_REQUIRED' } }) });
  h.api.start();
  await h.advance(5000);
  assert.equal(h.applied.length, 1, 'yerel/paylaşılan sonuç uygulanır');
  assert.equal(h.api.stats().resolved, 1);
  assert.equal(h.api.isNegative(list[1].key), false);
  assert.equal(h.api.isNegative(list[2].key), false);
  await h.advance(29 * 60 * 1000);
  assert.equal(h.calls.length, 1, 'oturum yokken 30 dk geri çekilir');
});

test('uygulama meşgulken (modül yükleniyor) istek gitmez; meşguliyet bitince gider', async () => {
  let busy = true;
  const h = harness({ identities: ids(2) });
  const api = createSilentImageCompleter({ ...h.env, isBusy: () => busy });
  api.start();
  await h.advance(30_000);
  assert.equal(h.calls.length, 0);
  busy = false;
  await h.advance(5000);
  assert.equal(h.calls.length, 1);
});
