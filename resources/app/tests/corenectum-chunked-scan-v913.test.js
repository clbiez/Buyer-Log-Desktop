'use strict';
/* v9.13 — "CDP komutu zaman aşımına uğradı: Runtime.evaluate"

   BELİRTİ: 10.000 satırlık bir Koleksiyonda PLM Sync bu hatayla düşüyordu;
   ~94 modelde sorunsuz çalışıyordu.

   KÖK NEDEN: coreNectumBulkApiScan, CoreNectum Style List'in BÜTÜN sayfalarını
   TEK bir Runtime.evaluate çağrısının içinde geziyordu. CDP komutunun sabit
   45 sn bütçesi var (portable-web-engine _send varsayılanı) ama tarama süresi
   listenin büyüklüğüyle artıyor: sayfa başına bir ağ turu + 75 ms bekleme.
   ~100 sayfa ≈ 40-78 sn → komut düşüyordu. Yapılandırılmış sayfa bütçesi
   (maxPages:5000) ile 45 sn arasında iki büyüklük mertebesi fark vardı.

   ÇÖZÜM: döngü tarayıcıdan Node'a taşındı. Her CDP çağrısı yalnız birkaç sayfa
   tarar; sayfa içi durum window üzerinde saklanır (10.000 ID her çağrıda
   yeniden gönderilmez).

   Bu dosya taramayı GERÇEKTEN çalıştırır: enjekte edilen ifade sahte bir
   fetch/window ile koşturulur, yani kaynak metin eşleştirmesi değil davranış
   sınanır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const connector = require(path.join(root, 'server/lib/agent-browser-connector.js'));
const CONNECTOR_SRC = fs.readFileSync(path.join(root, 'server/lib/agent-browser-connector.js'), 'utf8');

const PAGE_SIZE = 100;

/* Sahte CoreNectum: istenen sayfa kadar kayıt döndürür. Sahte sayfa ise
   enjekte edilen ifadeyi gerçekten çalıştırır ve window durumunu çağrılar
   arasında korur — parçalı taramanın çalışması buna bağlı. */
function makeHarness(totalRows, { failAtPage = -1 } = {}) {
  const all = Array.from({ length: totalRows }, (_, i) => ({
    plmCode: String(2000000 + i), styleId: String(3000000 + i),
    styleName: `M-${i}`, specialCode: `S${i}`, seasonName: 'S7', lineName: 'L1',
  }));
  const state = { fetchCalls: 0, evalCalls: 0, pagesRequested: [] };
  const fetchMock = async (url, init) => {
    state.fetchCalls += 1;
    const body = JSON.parse(init.body);
    const pageNo = body.pageNumber;
    state.pagesRequested.push(pageNo);
    if (pageNo === failAtPage) return { ok: false, status: 500, json: async () => ({}) };
    const slice = all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
    return { ok: true, status: 200, json: async () => ({ data: { coreNectumResultData: { styleListResult: slice } } }) };
  };
  const win = {};
  const page = {
    _evaluateValue(expression) {
      state.evalCalls += 1;
      return Function('fetch', 'setTimeout', 'window', `return ${expression}`)(fetchMock, setTimeout, win);
    },
  };
  const capture = {
    templates: [{ url: 'https://x/GetStyleList', method: 'POST', headers: {}, body: { pageNumber: 1, pageSize: PAGE_SIZE } }],
    waitForTemplate: async () => {},
  };
  return { page, capture, state, win };
}

test('REGRESYON: 10.000 satırlık liste TEK CDP çağrısında taranmaz', async () => {
  const { page, capture, state } = makeHarness(10000);
  const wanted = new Set(['2000001', '2000005', '2004000', '2007777', '2009999']);
  const out = await connector.coreNectumBulkApiScan(page, capture, wanted.keys());

  assert.equal(out.scannedPages, 100);
  assert.equal(out.scannedRows, 10000);
  // Asıl mesele: iş birden çok CDP çağrısına bölünmüş olmalı. Tek çağrı olsaydı
  // 45 sn bütçesine sığmayacaktı.
  assert.ok(state.evalCalls > 1, `tek çağrıda tarandı (${state.evalCalls})`);
  assert.ok(state.evalCalls >= Math.ceil(100 / connector.CORENECTUM_SCAN_PAGE_BUDGET),
    `beklenenden az parça: ${state.evalCalls}`);
});

test('parçalama sonucu değiştirmez: listenin SONUNDAKİ model de bulunur', async () => {
  const { page, capture } = makeHarness(10000);
  const wanted = new Set(['2000001', '2000005', '2004000', '2007777', '2009999']);
  const out = await connector.coreNectumBulkApiScan(page, capture, wanted.keys());

  assert.equal(out.rows.length, 5);
  assert.deepEqual(out.rows.map(row => row.plmId).sort(), [...wanted].sort());
  // En son sayfadaki kayıt (2009999) parçalar arasında kaybolmamalı.
  assert.ok(out.rows.some(row => row.plmId === '2009999'));
});

test('parçalar arasında ek alan çıkarımı korunur', async () => {
  const { page, capture } = makeHarness(500);
  const out = await connector.coreNectumBulkApiScan(page, capture, new Set(['2000450']).keys());
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].lineRaw, 'L1');
  assert.equal(out.rows[0].styleId, '3000450');
  assert.equal(out.rows[0].styleName, 'M-450');
});

test('hepsi bulununca tarama erken biter — liste sonuna kadar gezilmez', async () => {
  const { page, capture, state } = makeHarness(10000);
  // İlk sayfadaki iki kayıt: taramanın 100 sayfa sürmesi için sebep yok.
  const out = await connector.coreNectumBulkApiScan(page, capture, new Set(['2000001', '2000002']).keys());
  assert.equal(out.rows.length, 2);
  assert.ok(state.fetchCalls < 10, `gereksiz sayfa tarandı: ${state.fetchCalls}`);
});

test('bir sayfa hata verirse o ana kadar bulunanlar korunur ve hata bildirilir', async () => {
  const { page, capture } = makeHarness(10000, { failAtPage: 4 });
  const out = await connector.coreNectumBulkApiScan(page, capture, new Set(['2000001', '2009999']).keys());
  assert.match(String(out.error), /HTTP 500/);
  // 1. sayfadaki kayıt elde kalmalı; hata yüzünden atılmamalı.
  assert.deepEqual(out.rows.map(row => row.plmId), ['2000001']);
});

test('sayfa durumu kaybolursa tarama baştan başlar, sessizce boş dönmez', async () => {
  const { page, capture, win } = makeHarness(300);
  const original = page._evaluateValue.bind(page);
  let wiped = false;
  page._evaluateValue = expression => {
    // İlk parçadan sonra sayfa yenilenmiş gibi durumu sil.
    if (!wiped && Object.keys(win).length) { wiped = true; for (const key of Object.keys(win)) delete win[key]; }
    return original(expression);
  };
  const out = await connector.coreNectumBulkApiScan(page, capture, new Set(['2000250']).keys());
  assert.equal(out.rows.length, 1, 'durum kaybından sonra tarama toparlanmalı');
  assert.equal(out.rows[0].plmId, '2000250');
});

test('döngü Node tarafında, tarayıcıda değil', () => {
  const start = CONNECTOR_SRC.indexOf('async function coreNectumBulkApiScan');
  const end = CONNECTOR_SRC.indexOf('function coreNectumReplayHeaders', start);
  const block = CONNECTOR_SRC.slice(start, end);
  // Node tarafındaki parça döngüsü.
  assert.match(block, /for\(let chunk=0;chunk<CORENECTUM_SCAN_MAX_CHUNKS/);
  assert.match(block, /page\._evaluateValue\(coreNectumScanExpression\(/);
  // İlerleme bildirimi ancak parçalı yapıda mümkün.
  assert.match(block, /options\.onProgress/);
});

test('tarama ilerledikçe ilerleme bildirilir', async () => {
  const { page, capture } = makeHarness(3000);
  const seen = [];
  await connector.coreNectumBulkApiScan(page, capture, new Set(['2002999']).keys(),
    { onProgress: event => seen.push(event) });
  assert.ok(seen.length > 1, `ilerleme bildirilmedi (${seen.length})`);
  assert.equal(seen[0].phase, 'PLM listesi taranıyor');
  assert.equal(seen.at(-1).total, 1);
});
