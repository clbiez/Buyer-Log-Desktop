'use strict';

/*
 * v7.23 — BAŞARISIZ OAB KOMBİNASYONLARINI YENİDEN DENEME
 *
 * Kullanıcı talebi (saha): "9 combinations merged · 1 combinations failed
 * hatası alıyorum. Fail olan kombinasyonun detayını ... görmek, fail olan
 * kombinasyonu mevcut başarılı olanların üzerine eklemek için yeniden dene
 * diyerek pivot alanına dahil etmek istiyorum."
 *
 * Bu akışın iki YIKICI hata biçimi var; testler ikisini de çiviler:
 *
 *   1) Yeniden deneme, TAM yeniden çekim yaparsa kullanıcı zaten elinde olan
 *      9 kombinasyon için dakikalarca bekler. Yalnız başarısız üçlü istenmeli.
 *
 *   2) Yeniden denemenin sonucu kalıcı snapshot'ın ÜZERİNE YAZILIRSA (§142
 *      veri kaybı sıfır toleransı), program kapatılıp açıldığında elde yalnız
 *      yeniden denenen 1 kombinasyon kalır; başarılı 9'u yok olur.
 *
 * Ayrıca v7.20'den kalma sessiz bir kayıp burada yakalanır: toplu iş seçimi
 * ÇOĞUL ref'lerle kaydediyordu, snapshot deposu ise yalnız TEKİL alanları
 * yazıyordu. Sonuç: çoklu seçimle çekilen raporun seçimi boş kaydediliyor,
 * açılışta snapshot geri yüklenemiyordu.
 *
 * PASS erişilemez olduğu için ağ katmanı sahtelenir; plan, kuyruk, kısmi
 * başarı, birleştirme ve snapshot mantığının tamamı GERÇEK koddur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-oab-retry-v723-'));
const PORT = 47319;
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: PORT, host: '127.0.0.1', auth: { passwordHash: '', sessionSecret: '', sessionHours: 12 } }), 'utf8');

process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
process.env.BL_AUTOEXIT = '0';
process.env.BL_KEEP_ALIVE = '1';
process.env.NODE_ENV = 'test';

const fakePass = {
  connected: true,
  honourBatched: false, // v7.23 testleri kombinasyon başına modda koşar
  calls: [],
  failOn: null,
};
const connectorPath = require.resolve('../server/lib/agent-browser-connector');
const realConnector = require(connectorPath);
require.cache[connectorPath] = {
  id: connectorPath, filename: connectorPath, loaded: true, exports: {
    ...realConnector,
    passAuthStatus: () => ({ connected: fakePass.connected, captureInProgress: false }),
    capturePassAuthorization: async () => ({ connected: true }),
    fetchPassReportData: async (ownerId, params) => {
      fakePass.calls.push(params);
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
        'Klasman Tanımı': `K-${ref}`,
        'Toplam Onaylı Sipariş Miktarı': 10,
      }));
    },
  },
};

const oabApiClientPath = require.resolve('../server/lib/oab-api-client');
require.cache[oabApiClientPath] = {
  id: oabApiClientPath, filename: oabApiClientPath, loaded: true, exports: {
    validateAuthorization: async () => true,
    fetchReportData: async params => {
      fakePass.calls.push(params);
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
        'Klasman Tanımı': `K-${ref}`,
        'Toplam Onaylı Sipariş Miktarı': 10,
      }));
    },
  },
};
const oabAuthState = require('../server/lib/oab-auth-state');
oabAuthState.setAuthorization(`Bearer ${'x'.repeat(48)}`);

const metadataPath = require.resolve('../server/lib/oab-static-metadata');
const realMetadata = require(metadataPath);
const FAKE_TREE = { S6: { CU4E: ['1', '2', '3'] } };
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
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...(cookie ? { Cookie: cookie } : {}) },
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
const OAB_CACHE_DIR = path.join(root, 'data', 'oab-cache');
test.beforeEach(() => {
  fakePass.calls = []; fakePass.failOn = null;
  fs.rmSync(OAB_CACHE_DIR, { recursive: true, force: true });
});

test('v7.23 başarısız kombinasyon, YENİDEN DENENEBİLİR referansları ile raporlanır', async () => {
  fakePass.failOn = '2';
  const finished = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'], forceRefresh: true });
  assert.equal(finished.job.failures.length, 1);
  const failure = finished.job.failures[0];
  // Detay ekranının gösterdiği alanlar: etiket, kod ve mesaj.
  assert.match(failure.label, /S6/);
  assert.equal(failure.code, 'PASS_HTTP_ERROR');
  assert.match(failure.message, /500/);
  // Ve "yeniden dene" için gereken üçlü: bunlar olmadan tek çare tam çekimdi.
  assert.deepEqual(failure.combinations, [{
    seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '2',
    label: failure.combinations[0].label,
  }]);
});

test('v7.23 yeniden deneme YALNIZ başarısız üçlüyü çeker', async () => {
  fakePass.failOn = '2';
  const first = await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'], forceRefresh: true });
  const combinations = first.job.failures.flatMap(item => item.combinations);
  assert.equal(combinations.length, 1);

  fakePass.failOn = null;
  fakePass.calls = [];
  const retried = await runBatch({ combinations, forceRefresh: true });
  assert.equal(fakePass.calls.length, 1, 'yalnız başarısız kombinasyon istenmeli — tam çekim değil');
  assert.equal(String(fakePass.calls[0].seasonRef), 'S6');
  assert.equal(retried.rows.length, 1);
  assert.equal(retried.rows[0]['Buyer Grup Tanımı'], 'BG-2');
  assert.equal(retried.job.failures.length, 0);
});

test('v7.23 yeniden deneme SNAPSHOT\'I EZMEZ; başarılı kombinasyonlar korunur', async () => {
  fakePass.failOn = '2';
  await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'], forceRefresh: true });
  const before = await request('GET', '/api/oab/state');
  const beforeGroups = before.body.state.snapshot.rows.map(row => row['Buyer Grup Tanımı']).sort();
  assert.deepEqual(beforeGroups, ['BG-1', 'BG-3']);

  fakePass.failOn = null;
  await runBatch({
    combinations: [{ seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '2' }],
    forceRefresh: true,
  });
  const after = await request('GET', '/api/oab/state');
  const rows = after.body.state.snapshot.rows;
  const groups = rows.map(row => row['Buyer Grup Tanımı']).sort();
  assert.deepEqual(groups, ['BG-1', 'BG-2', 'BG-3'], 'yeniden denenen kombinasyon eskilerin ÜZERİNE EKLENMELİ');
  assert.equal(rows.length, 3, 'hiçbir satır düşmemeli, hiçbir satır iki kez sayılmamalı');
});

test('v7.23 yeniden deneme sonrası snapshot SEÇİMİ de birleşiktir', async () => {
  fakePass.failOn = '3';
  await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2', '3'], forceRefresh: true });
  fakePass.failOn = null;
  await runBatch({
    combinations: [{ seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '3' }],
    forceRefresh: true,
  });
  const state = (await request('GET', '/api/oab/state')).body.state;
  assert.deepEqual([...state.selection.buyerGroupRefs].sort(), ['1', '2', '3'],
    'açılışta aynı kapsam geri yüklenebilsin diye seçim birleştirilmeli');
  assert.deepEqual(state.selection.seasonRefs, ['S6']);
  assert.deepEqual(state.selection.merchSubGroupRefs, ['CU4E']);
});

test('v7.23 çoklu seçimle çekilen rapor, snapshot\'a ÇOĞUL ref\'leriyle yazılır', async () => {
  // v7.20 gerilemesi: depo yalnız tekil alanları yazıyordu; çoklu seçim
  // yapıldığında seçim boş kaydediliyor ve açılışta snapshot yüklenemiyordu.
  await runBatch({ seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: ['1', '2'], forceRefresh: true });
  const state = (await request('GET', '/api/oab/state')).body.state;
  assert.deepEqual([...state.selection.buyerGroupRefs].sort(), ['1', '2']);
  // Eski istemcilerin okuduğu tekil alan da dolu kalmalı (geriye dönük uyum).
  assert.equal(state.selection.seasonRef, 'S6');
  assert.equal(state.selection.merchSubGroupRef, 'CU4E');
  assert.ok(state.selection.buyerGroupRef, 'tekil alan boş bırakılmamalı');
});

test('v7.23 istemciden gelen kombinasyon METADATA ile doğrulanır, doğrudan PASS\'e sorulmaz', async () => {
  const res = await request('POST', '/api/oab/batch', {
    combinations: [{ seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: 'UYDURMA' }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'OAB_NO_VALID_COMBINATION');
  assert.equal(fakePass.calls.length, 0, 'doğrulanmamış üçlü için PASS\'e istek gitmemeli');
});

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  setImmediate(() => process.exit(0));
});
