'use strict';

/* Açılışta eksik model görselleri otomatik tamamlanır.
 *
 * Regresyon: görünür tablo hücresinde görseli olmayan modeller açılışta
 * boş kalıyor, yalnız kullanıcı PLM Sync'e bastığında "Remote added N" ile
 * bir anda geliyordu. BLImageRuntime görünür kimlikleri eskiden
 * /api/model-images/shared/hydrate'e gönderiyordu; o uç ownerId zorunlu
 * tuttuğu için istek HER ZAMAN 400 ile düşüyordu ve hiçbir görsel
 * tamamlanmıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const recovery = require('../public/plm-auth-recovery.js');

function runtimeSource() {
  const start = APP.indexOf('const BLImageRuntime=(()=>{');
  const end = APP.indexOf('window.BLImageRuntime=BLImageRuntime;', start);
  assert.ok(start >= 0 && end > start, 'BLImageRuntime bloğu bulunmalı');
  return APP.slice(start, end);
}

function createRuntime({ responses = [], activeTab = 'cp' } = {}) {
  const calls = [];
  const applied = [];
  const env = {
    window: {},
    document: { body: { dataset: { activeTab } } },
    state: { overrides: { imagemap: {} } },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const next = responses.length ? responses.shift() : { ok: true, status: 200, data: { ok: true, images: [] } };
      return { ok: next.ok, status: next.status, json: async () => next.data };
    },
    normalizePlmLinkId: value => (/^\d+$/.test(String(value || '').trim()) ? String(value).trim() : ''),
    mergeImageOverridePayload: (current, incoming) => ({ ...current, ...incoming }),
    syncModelImageRegistry: () => {},
    applySyncedPlmImages: data => { applied.push(data); },
    modelAssetScopeApi: () => null,
    plmSyncRepaintAll: () => {},
    kolShowImgPopup: () => {},
  };
  const names = Object.keys(env);
  const runtime = new Function(...names, `${runtimeSource()}; return BLImageRuntime;`)(...names.map(name => env[name]));
  return { runtime, calls, applied, env };
}

function placeholder(plmId, colourCode = 'HFB') {
  return { dataset: { modelId: plmId, colourCode }, isConnected: true, closest: () => null };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('görünür görselsiz hücre açılışta PLM "eksikleri tamamla" isteğine girer (bozuk shared/hydrate değil)', async () => {
  const { runtime, calls, applied } = createRuntime({
    responses: [{ ok: true, status: 200, data: { ok: true, mode: 'missing', images: [{ plmId: '1202929', colourCode: 'HFB', imageRef: 'img-1' }], overrides: { imagemap: { 'plm:1202929|colour:HFB': 'img-1' } } } }],
  });
  runtime.observe(placeholder('1202929'));
  runtime.observe(placeholder('1202930'));
  await wait(400);

  assert.equal(calls.length, 1, 'aynı turdaki kimlikler tek istekte toplanır');
  assert.equal(calls[0].url, '/api/model-images/import-plm');
  assert.equal(calls[0].body.mode, 'missing', 'otomatik iş mevcut görseli asla yeniden indirmez');
  assert.equal(calls[0].body.scope, 'cp');
  assert.deepEqual(calls[0].body.items.map(item => item.plmId).sort(), ['1202929', '1202930']);
  assert.equal(calls[0].init.headers['X-BuyerLog-Auth-Mode'], 'silent', 'otomatik iş login penceresi açtırmaz');
  assert.equal(applied.length, 1, 'gelen görseller ekrana uygulanır');
  assert.doesNotMatch(runtimeSource(), /shared\/hydrate/);
});

test('aynı kimlik soğuma süresinde tekrar istenmez', async () => {
  const { runtime, calls } = createRuntime();
  runtime.observe(placeholder('1202929'));
  await wait(400);
  runtime.scheduleAutoImageComplete(placeholder('1202929'));
  await wait(400);
  assert.equal(calls.length, 1);
});

test('oturum yoksa otomatik iş durur; login açmaz, istek yağdırmaz', async () => {
  const { runtime, calls } = createRuntime({
    responses: [{ ok: false, status: 409, data: { code: 'CORENECTUM_API_TOKEN_REQUIRED' } }],
  });
  runtime.observe(placeholder('1202929'));
  await wait(400);
  runtime.scheduleAutoImageComplete(placeholder('1202931'));
  await wait(400);
  assert.equal(calls.length, 1, 'yetki hatasından sonra otomatik iş beklemeye alınır');
});

test('elle başlatılan görsel işi sürerken otomatik iş istek göndermez', async () => {
  const { runtime, calls } = createRuntime();
  const hold = runtime.holdAutoImageComplete();
  await hold.ready;
  runtime.observe(placeholder('1202929'));
  await wait(400);
  assert.equal(calls.length, 0);
  hold.release({ ok: true });
  await wait(400);
  assert.equal(calls.length, 1, 'elle iş bitince otomatik tamamlama kaldığı yerden sürer');
});

test('kayıtlı ama açılamayan görsel de otomatik tamamlamaya girer', () => {
  const source = runtimeSource();
  assert.match(source, /img\.dataset\.blImageFailed='1';scheduleAutoImageComplete\(img\);/);
});

test('plmJsonRequest elle görsel işini otomatik işin bitmesine bağlar', () => {
  const start = APP.indexOf('async function plmJsonRequest');
  const block = APP.slice(start, APP.indexOf('let coreNectumApiSettingsInFlight', start));
  assert.match(APP, /MODEL_IMAGE_IMPORT_ENDPOINTS=new Set\(\['\/api\/model-images\/import-plm','\/api\/model-images\/import-asas'\]\)/);
  assert.match(block, /BLImageRuntime\.holdAutoImageComplete\(\)/);
  assert.match(block, /await autoHold\.ready/);
  assert.match(block, /autoHold\?\.release\(\{ok:succeeded\}\)/);
});

// Node'un Request'i göreli URL kabul etmez; tarayıcıda aynı istek göreli gider.
const PLM_IMAGE_URL = 'http://127.0.0.1:6194/api/model-images/import-plm';

function fakeRoot({ firstStatus = 409, code = 'CORENECTUM_API_TOKEN_REQUIRED', authOk = true } = {}) {
  const authCalls = [];
  const fetchCalls = [];
  const root = {
    location: { href: 'http://127.0.0.1:6194/', origin: 'http://127.0.0.1:6194' },
    Request,
    buyerLogDesktop: { ensureCoreNectumAuth: async options => { authCalls.push(options); return { ok: authOk }; } },
    fetch: async request => {
      fetchCalls.push(request);
      if (fetchCalls.length === 1) return new Response(JSON.stringify({ code }), { status: firstStatus, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
  recovery.install(root);
  return { root, authCalls, fetchCalls };
}

test('sessiz başlıklı PLM isteği yalnız gizli SSO yenilemesi dener', async () => {
  const { root, authCalls, fetchCalls } = fakeRoot();
  const response = await root.fetch(PLM_IMAGE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BuyerLog-Auth-Mode': 'silent' }, body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(authCalls.length, 1);
  assert.equal(authCalls[0].interactive, false, 'arka plan işi login penceresi açmaz');
  assert.equal(fetchCalls.length, 2, 'başarılı sessiz yenilemeden sonra tek replay');
});

test('sessiz yenileme başarısızsa özgün yanıt döner', async () => {
  const { root, authCalls, fetchCalls } = fakeRoot({ authOk: false });
  const response = await root.fetch(PLM_IMAGE_URL, {
    method: 'POST', headers: { 'X-BuyerLog-Auth-Mode': 'silent' }, body: '{}',
  });
  assert.equal(response.status, 409);
  assert.equal(authCalls[0].interactive, false);
  assert.equal(fetchCalls.length, 1);
});

test('kullanıcı işi eskisi gibi etkileşimli yenileme kullanır', async () => {
  const { root, authCalls } = fakeRoot();
  await root.fetch(PLM_IMAGE_URL, { method: 'POST', body: '{}' });
  assert.equal(authCalls[0].interactive, true);
});
