'use strict';

/*
 * v7.20 — OAB toplu çekme akışının UÇTAN UCA doğrulaması.
 *
 * PASS (LC Waikiki intranet raporlama sistemi) bu ortamdan erişilebilir değil.
 * Bu yüzden PASS bağlayıcısı SAHTE bir modülle değiştirilir ve gerçek sunucu
 * uçları (plan → batch → durum → birleştirme) gerçek HTTP üzerinden koşturulur.
 * Sahte katman yalnız AĞI taklit eder; plan, doğrulama, kuyruk, kısmi başarı,
 * iptal ve birleştirme mantığının tamamı GERÇEK koddur.
 *
 * Böylece "PASS'e erişemiyorum" gerekçesiyle test edilmeden bırakılan tek şey
 * PASS'in çoğul BuyerGroupRefs parametresini kabul edip etmediği kalır — ve o
 * zaten çalışma anında yanıt içeriğinden doğrulanıyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-oab-e2e-v720-'));
const PORT = 47311;
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: PORT, host: '127.0.0.1', auth: { passwordHash: '', sessionSecret: '', sessionHours: 12 } }), 'utf8');

process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
process.env.BL_AUTOEXIT = '0';
process.env.BL_KEEP_ALIVE = '1';
process.env.NODE_ENV = 'test';

/* ---------- SAHTE PASS ----------
   Gerçek bağlayıcı yerine konur. Davranışı testler arasında değiştirilebilir:
   toplu parametreyi UYGULAYAN ve YOK SAYAN PASS'lerin ikisi de denenir. */
const fakePass = {
  connected: true,
  honourBatched: true,        // true: virgüllü listeyi uygular, false: ilk ref'i döndürür
  calls: [],
  failOn: null,               // { buyerGroupRef } → o kombinasyon hata versin
  delayMs: 0,
  desktopCalls: 0,            // oab-api-client (masaüstü oturumu) üzerinden yapılan istekler
  captureCalls: 0,            // dış tarayıcı (CDP) yakalama denemeleri
};
const connectorPath = require.resolve('../server/lib/agent-browser-connector');
const realConnector = require(connectorPath);
require.cache[connectorPath] = {
  id: connectorPath, filename: connectorPath, loaded: true, exports: {
    ...realConnector,
    passAuthStatus: () => ({ connected: fakePass.connected, captureInProgress: false }),
    capturePassAuthorization: async () => { fakePass.captureCalls += 1; return { connected: true }; },
    fetchPassReportData: async (ownerId, params) => {
      fakePass.calls.push(params);
      if (fakePass.delayMs) await new Promise(resolve => setTimeout(resolve, fakePass.delayMs));
      const refs = params.buyerGroupRefs && params.buyerGroupRefs.length
        ? (fakePass.honourBatched ? params.buyerGroupRefs : [params.buyerGroupRefs[0]])
        : [params.buyerGroupRef];
      if (fakePass.failOn && refs.includes(fakePass.failOn)) {
        const err = new Error('PASS HTTP 500'); err.code = 'PASS_HTTP_ERROR'; throw err;
      }
      return refs.map(ref => ({
        'Sezon': String(params.seasonRef),
        'Merch Alt Grup': String(params.merchSubGroupRef),
        'Buyer Grup Tanımı': `BG-${ref}`,
        'Klasman Grup Tanımı': 'KG',
        'Toplam Onaylı Sipariş Miktarı': 10,
      }));
    },
  },
};

// Güncel OAB transport backend-RAM authorization + oab-api-client kullanır.
// Ağ katmanını burada sahteleyip batch/plan/state mantığını gerçek server koduyla çalıştırırız.
const oabApiClientPath = require.resolve('../server/lib/oab-api-client');
require.cache[oabApiClientPath] = {
  id: oabApiClientPath, filename: oabApiClientPath, loaded: true, exports: {
    validateAuthorization: async () => true,
    fetchReportData: async params => {
      fakePass.desktopCalls += 1;
      fakePass.calls.push(params);
      if (fakePass.delayMs) await new Promise(resolve => setTimeout(resolve, fakePass.delayMs));
      const refs = params.buyerGroupRefs && params.buyerGroupRefs.length
        ? (fakePass.honourBatched ? params.buyerGroupRefs : [params.buyerGroupRefs[0]])
        : [params.buyerGroupRef];
      if (fakePass.failOn && refs.includes(fakePass.failOn)) {
        const err = new Error('OAB HTTP 500'); err.code = 'OAB_HTTP_ERROR'; throw err;
      }
      return refs.map(ref => ({
        'Sezon': String(params.seasonRef),
        'Merch Alt Grup': String(params.merchSubGroupRef),
        'Buyer Grup Tanımı': `BG-${ref}`,
        'Klasman Grup Tanımı': 'KG',
        'Toplam Onaylı Sipariş Miktarı': 10,
      }));
    },
  },
};
const oabAuthState = require('../server/lib/oab-auth-state');
oabAuthState.setAuthorization(`Bearer ${'x'.repeat(48)}`);

// Sahte metadata: gerçek 1,9 MB'lık dosyaya bağlı kalmadan kenar durumları kurar.
const metadataPath = require.resolve('../server/lib/oab-static-metadata');
const realMetadata = require(metadataPath);
const FAKE_TREE = {
  S6: { CU4E: ['1', '2', '3'], CK1E: ['1'] },
  S7: { CU4E: ['1', '2'] },
};
require.cache[metadataPath] = {
  id: metadataPath, filename: metadataPath, loaded: true, exports: {
    ...realMetadata,
    getInfo: () => ({ schemaVersion: 1, reportRef: 'OrderBudget_List_Report', generatedAt: '', counts: {}, source: 'test' }),
    getSeasons: () => Object.keys(FAKE_TREE).map(ref => ({ SeasonRef: ref, Name: ref })),
    getMag: seasonRef => Object.keys(FAKE_TREE[seasonRef] || {}).map(ref => ({ MerchSubGroupRef: ref, Name: ref })),
    getBuyerGroups: () => [],
    validateSelectedRefs: () => ({ ok: true }),
    seasonRefs: () => Object.keys(FAKE_TREE),
    magRefsForSeason: seasonRef => Object.keys(FAKE_TREE[seasonRef] || {}),
    buyerGroupRefsFor: (seasonRef, magRef) => (FAKE_TREE[seasonRef] && FAKE_TREE[seasonRef][magRef]) || [],
    planningMetadata: () => ({
      seasonRefs: () => Object.keys(FAKE_TREE),
      magRefsForSeason: seasonRef => Object.keys(FAKE_TREE[seasonRef] || {}),
      buyerGroupRefsFor: (seasonRef, magRef) => (FAKE_TREE[seasonRef] && FAKE_TREE[seasonRef][magRef]) || [],
    }),
    labelsFor: ({ seasonRef, merchSubGroupRef, buyerGroupRef } = {}) => ({
      season: seasonRef == null ? undefined : String(seasonRef),
      mag: merchSubGroupRef == null ? undefined : String(merchSubGroupRef),
      buyerGroup: buyerGroupRef == null ? undefined : String(buyerGroupRef),
    }),
  },
};

require('../server/server.js');

let cookie = '';
function request(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    }, res => {
      let out = '';
      res.on('data', chunk => { out += chunk; });
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) cookie = setCookie.map(item => item.split(';')[0]).join('; ');
        let parsed = null; try { parsed = JSON.parse(out); } catch (_) { parsed = out; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const res = await request('GET', '/api/health'); if (res.status < 500) return; } catch (_) { /* henüz ayakta değil */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Test sunucusu açılmadı.');
}
async function login() {
  const res = await request('POST', '/api/user-login', { username: 'Gökberk', password: 'BuyerlogTest1!', newPassword: 'BuyerlogTest1!' });
  assert.equal(res.status, 200, `giriş başarısız: ${JSON.stringify(res.body).slice(0, 200)}`);
}
async function runBatch(selection) {
  const started = await request('POST', '/api/oab/batch', selection);
  assert.equal(started.status, 202, `iş başlamadı: ${JSON.stringify(started.body).slice(0, 300)}`);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await request('GET', '/api/oab/batch-status');
    if (status.body.job && !status.body.job.running) return status.body;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Toplu iş bitmedi.');
}

test.before(async () => { await waitForServer(); await login(); });
// Rapor önbelleği testler arasında TAŞINMAMALI: bir testin doldurduğu önbellek
// bir sonrakinde PASS çağrısını sıfırlar ve o test aslında hiçbir şeyi ölçmez.
// (Önbelleğin kendisi ayrı bir testte, bilerek doldurularak sınanır.)
const OAB_CACHE_DIR = path.join(root, 'data', 'oab-cache');
function clearOabCache() { fs.rmSync(OAB_CACHE_DIR, { recursive: true, force: true }); }
test.beforeEach(() => { fakePass.calls = []; fakePass.failOn = null; fakePass.delayMs = 0; fakePass.desktopCalls = 0; fakePass.captureCalls = 0; clearOabCache(); });

test('v7.20 plan ucu kombinasyon ve maliyeti hesaplar, karşılıksızları bildirir', async () => {
  const res = await request('POST', '/api/oab/plan', { seasonRefs: ['S6', 'S7'], merchSubGroupRefs: ['CU4E', 'CK1E'], buyerGroupRefs: ['1', '2'] });
  assert.equal(res.status, 200);
  // Gerçek üçlüler: S6/CU4E×2, S6/CK1E×1, S7/CU4E×2 = 5
  assert.equal(res.body.combinationCount, 5);
  // Toplu mod denenecek (yetenek 'unknown') → (Sezon,MAG) başına tek istek = 3
  assert.equal(res.body.requestCount, 3);
  assert.equal(res.body.estimateSeconds, 60);
  assert.ok(res.body.skippedCount >= 1, 'S7/CK1E ve CK1E/2 karşılıksız olmalı');
});

test('v7.20 toplu parametre UYGULANIYORSA tek istekle çok grup gelir ve öğrenilir', async () => {
  fakePass.honourBatched = true;
  const finished = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'] });
  assert.equal(finished.job.batchedBuyerGroups, 'supported', 'yanıt çok gruplu geldiği için yetenek öğrenilmeli');
  assert.equal(fakePass.calls.length, 1, 'üç grup TEK istekle alınmalı');
  assert.equal(finished.rows.length, 3);
  const groups = [...new Set(finished.rows.map(row => row['Buyer Grup Tanımı']))].sort();
  assert.deepEqual(groups, ['BG-1', 'BG-2', 'BG-3']);
  assert.ok(finished.fields.includes('Buyer Grup Tanımı'));
});

test('v7.20 toplu parametre YOK SAYILIYORSA sessizce eksik rapor verilmez', async () => {
  await request('POST', '/api/oab/batch/reset-capability');
  fakePass.honourBatched = false; // PASS parametreyi yok sayıp tek grup döndürüyor
  const finished = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'] });
  assert.equal(finished.job.batchedBuyerGroups, 'unsupported', 'doğrulanamayan yetenek kabul edilmemeli');
  // Kuyruk kombinasyon başına yeniden kurulur: 1 sonda(başarısız) + 3 tekil.
  assert.equal(finished.rows.length, 3, 'üç grubun üçü de rapora girmeli');
  const groups = [...new Set(finished.rows.map(row => row['Buyer Grup Tanımı']))].sort();
  assert.deepEqual(groups, ['BG-1', 'BG-2', 'BG-3'], 'yok sayılan parametre yüzünden grup kaybolmamalı');
});

test('v7.20 öğrenilen "unsupported" sonraki işte tekrar denenmez', async () => {
  fakePass.honourBatched = false;
  const finished = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2'] });
  // Yetenek zaten 'unsupported' biliniyor: doğrulama isteği yapılmaz, doğrudan
  // kombinasyon başına gidilir.
  assert.equal(fakePass.calls.length, 2);
  assert.ok(fakePass.calls.every(call => !call.buyerGroupRefs || call.buyerGroupRefs.length <= 1));
  assert.equal(finished.rows.length, 2);
});

test('v7.20 bir kombinasyon patlarsa diğerleri korunur ve hata adıyla raporlanır', async () => {
  fakePass.honourBatched = false;
  fakePass.failOn = '2';
  const finished = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'] });
  assert.equal(finished.job.failures.length, 1, 'bir kombinasyon başarısız olmalı');
  assert.match(finished.job.failures[0].label, /S6/);
  assert.equal(finished.rows.length, 2, 'başarılı iki kombinasyon rapora girmeli');
  const groups = [...new Set(finished.rows.map(row => row['Buyer Grup Tanımı']))].sort();
  assert.deepEqual(groups, ['BG-1', 'BG-3']);
});

test('v7.20 iptal edilen iş, o ana kadar çekilen veriyi KORUR', async () => {
  fakePass.honourBatched = false;
  fakePass.delayMs = 120;
  const started = await request('POST', '/api/oab/batch', { seasonRefs: ['S6', 'S7'], merchSubGroupRefs: ['CU4E', 'CK1E'], allBuyerGroups: true });
  assert.equal(started.status, 202);
  await new Promise(resolve => setTimeout(resolve, 260)); // birkaç kombinasyon geçsin
  const cancelled = await request('POST', '/api/oab/batch/cancel');
  assert.equal(cancelled.body.cancelled, true);
  let finished = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await request('GET', '/api/oab/batch-status');
    if (status.body.job && !status.body.job.running) { finished = status.body; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(finished, 'iptal edilen iş sonlanmalı');
  assert.equal(finished.job.cancelled, true);
  assert.ok(finished.job.completed < finished.job.total, 'kuyruk erken durmalı');
  assert.ok(finished.rows.length > 0, 'iptal, çekilmiş veriyi silmemeli');
  assert.equal(finished.rows.length, finished.job.completed, 'her tamamlanan kombinasyon bir satır üretti');
});

test('v7.20 aynı kullanıcı için ikinci iş paralel başlatılamaz', async () => {
  fakePass.honourBatched = false;
  fakePass.delayMs = 200;
  const first = await request('POST', '/api/oab/batch', { seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'] });
  assert.equal(first.status, 202);
  const second = await request('POST', '/api/oab/batch', { seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1'] });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'OAB_BATCH_IN_PROGRESS');
  await request('POST', '/api/oab/batch/cancel');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await request('GET', '/api/oab/batch-status');
    if (status.body.job && !status.body.job.running) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
});

test('v7.20 tekil kombinasyonlar önbelleğe yazılır, ikinci turda PASS\'e gidilmez', async () => {
  // Bu test önbelleği BİLEREK doldurup ikinci turu ölçer.
  fakePass.honourBatched = false;
  await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2'] });
  const firstCallCount = fakePass.calls.length;
  assert.equal(firstCallCount, 2);
  fakePass.calls = [];
  const second = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2'] });
  assert.equal(fakePass.calls.length, 0, 'taze önbellek varken PASS\'e gidilmemeli');
  assert.equal(second.job.fromCache, 2);
  assert.equal(second.rows.length, 2, 'önbellekten gelen satırlar da rapora girmeli');
});

test('v7.20 hiçbir geçerli kombinasyon yoksa iş başlatılmaz', async () => {
  const res = await request('POST', '/api/oab/batch', { seasonRefs: ['S7'], merchSubGroupRefs: ['CK1E'], buyerGroupRefs: ['1'] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'OAB_NO_VALID_COMBINATION');
});

// Kapanış EN SONA kaydedilir: gerçek bir HTTP sunucusu açık olduğu için süreç
// kendiliğinden sonlanmaz. Erken kaydedilen bir process.exit, son testin
// koşmasını engelliyordu.
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});

const DESKTOP = { 'X-BuyerLog-OAB-Transport': 'desktop' };
test('masaüstü OAB isteği gizli oturumun RAM token\'ıyla doğrudan PASS API\'den çekilir; dış tarayıcıya gidilmez', async () => {
  const res = await request('POST', '/api/oab/report', { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '1', forceRefresh: true }, DESKTOP);
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
  assert.equal(fakePass.desktopCalls, 1);
  assert.equal(fakePass.captureCalls, 0);
  assert.equal(res.body.rows.length, 1);
  const status = await request('GET', '/api/oab/auth/status', null, DESKTOP);
  assert.equal(status.body.status.transport, 'desktop-session');
  assert.equal(status.body.status.authenticated, true);
});

test('masaüstü OAB oturumu yoksa OAB_AUTH_REQUIRED döner; Edge/CDP yakalamasına düşülmez', async () => {
  oabAuthState.clear();
  try {
    const res = await request('POST', '/api/oab/report', { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '2', forceRefresh: true }, DESKTOP);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'OAB_AUTH_REQUIRED');
    const connect = await request('POST', '/api/oab/auth/connect', {}, DESKTOP);
    assert.equal(connect.body.code, 'OAB_AUTH_REQUIRED');
    assert.equal(fakePass.captureCalls, 0, 'masaüstü kipi dış tarayıcı açmamalı');
    assert.equal(fakePass.desktopCalls, 0);
  } finally {
    oabAuthState.setAuthorization(`Bearer ${'x'.repeat(48)}`);
  }
});

test('masaüstü toplu OAB işi başlatan isteğin taşımasını korur', async () => {
  await request('POST', '/api/oab/batch/reset-capability');
  const started = await request('POST', '/api/oab/batch', { seasonRefs: ['S7'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2'], forceRefresh: true }, DESKTOP);
  assert.equal(started.status, 202, JSON.stringify(started.body).slice(0, 300));
  let finished = null;
  for (let attempt = 0; attempt < 200 && !finished; attempt += 1) {
    const status = await request('GET', '/api/oab/batch-status', null, DESKTOP);
    if (status.body.job && !status.body.job.running) finished = status.body;
    else await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(finished, 'toplu iş bitmedi');
  assert.ok(fakePass.desktopCalls >= 1);
  assert.equal(fakePass.desktopCalls, fakePass.calls.length, 'bütün istekler masaüstü oturumundan geçmeli');
  assert.equal(fakePass.captureCalls, 0);
});
