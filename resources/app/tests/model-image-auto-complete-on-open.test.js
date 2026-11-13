'use strict';

/* EKSİK GÖRSEL TAMAMLAMA — RENDER/HÜCRE TETİKLEYİCİSİ YOK.
 *
 * Tarihçe: 7.0.250'de açılışta otomatik görsel tamamlama kaldırıldı; eski
 * mimaride tetikleyici RENDER/HÜCRE idi (görselsiz hücre gözlemlenince
 * /api/model-images/import-plm kuyruğuna giriyordu) ve her açılış, filtre ve
 * kaydırma yeni istek doğurduğu için uygulamayı yavaşlatıyordu.
 *
 * Güncel sözleşme (ürün sahibi kararı, sessiz eksik görsel tamamlama):
 * eksik görseller arka planda HİSSETTİRMEDEN tamamlanır, ama tetikleyici
 * yine render/hücre DEĞİLDİR. BLImageRuntime (hücre/gözlemci katmanı) hâlâ
 * PLM'e istek atmaz; tek istek yolu model-image-silent-complete.js'in TEK
 * zamanlayıcısıdır (boşta + kullanıcı sessizken, küçük paket, negatif
 * önbellek). Bu dosya her iki kuralı da korur.
 *
 * Daha eski not (tarihçe): BLImageRuntime görünür kimlikleri eskiden
 * /api/model-images/shared/hydrate'e gönderiyordu; o uç ownerId zorunlu
 * tuttuğu için istek HER ZAMAN 400 ile düşüyordu. */

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

test('görselsiz hücre (render/gözlemci) PLM isteği tetiklemez', async () => {
  const { runtime, calls } = createRuntime();
  runtime.observe(placeholder('1202929'));
  runtime.observe(placeholder('1202930'));
  await wait(400);
  assert.equal(calls.length, 0, 'görünür/eksik görsel PLM isteği tetiklememeli');
  assert.equal(typeof runtime.scheduleAutoImageComplete, 'undefined');
  assert.equal(typeof runtime.holdAutoImageComplete, 'undefined');
});

test('runtime ve plmJsonRequest otomatik PLM görsel işi içermez', () => {
  const source = runtimeSource();
  assert.doesNotMatch(source, /\/api\/model-images\/import-plm/);
  assert.doesNotMatch(source, /shared\/hydrate/);
  assert.match(source, /const markFailed=\(\)=>\{if\(img\.isConnected&&img\.dataset\.src===src\)img\.dataset\.blImageFailed='1';\};/);
  const start = APP.indexOf('async function plmJsonRequest');
  const block = APP.slice(start, APP.indexOf('function openPlmSignInAfterAuthFailure', start));
  assert.doesNotMatch(block, /autoHold|holdAutoImageComplete/);
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

function silentGlueSource() {
  const start = APP.indexOf('/* SESSİZ EKSİK GÖRSEL TAMAMLAMA — bağlantı');
  const end = APP.indexOf('BLSilentImageComplete?.engine.start();', start);
  assert.ok(start >= 0 && end > start, 'sessiz tamamlama bağlantısı bulunmalı');
  return APP.slice(start, end);
}

test('tek PLM görsel yolu sessiz zamanlayıcıdır: sessiz istek, missing modu, ilerleme/toast yok', () => {
  const glue = silentGlueSource();
  assert.match(glue, /window\.BLPlmSilentRequest\('\/api\/model-images\/import-plm'/);
  assert.match(glue, /mode:'missing'/);
  assert.doesNotMatch(glue, /plmJsonRequest\(/, 'etkileşimli istek (Operasyon Merkezi/login) kullanılmaz');
  assert.doesNotMatch(glue, /showToast|openModelAssetProgress|watchModelOperationProgress|BLPlmOps/);
  // Tablo yeniden çizilmez; yalnız hücre yaması.
  assert.doesNotMatch(glue, /renderCP\(|renderOrders\(|renderKol\(|plmSyncRepaintAll\(|modelAssetRepaint\(|__blModelAssetRepaint\(/);
  // Koleksiyon ana tablosu kapsam dışıdır ve yazılmaz.
  assert.doesNotMatch(glue, /kolPictureCell|saveKolRows|applySyncedPlmImages\(/);
  assert.match(glue, /const SILENT_IMAGE_TABLE_WRAPS=\{cp:'cpTableWrap',orders:'ordersTableWrap'\};/);
  // Etkileşim dinleyicileri yalnız zaman damgası yazar.
  assert.match(glue, /const touch=\(\)=>engine\.notifyInteraction\(\);/);
});

test('model dosyaları ve QTX sessiz işe girmez', () => {
  const glue = silentGlueSource().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(glue, /model-files|updateModelFiles|kolPlmSyncModelFilesRun|qtx/i);
});
