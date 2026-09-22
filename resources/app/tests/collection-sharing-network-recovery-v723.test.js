'use strict';

/*
 * v7.23 — KOLEKSİYON PAYLAŞIMI AĞ KESİNTİSİNDE KALICI OLARAK KAYBOLMASIN
 *
 * Saha bulgusu (kullanıcı, birebir):
 *   "Collection sharing could not be initialized; local page remains
 *    available. Failed to fetch"
 *
 * "Failed to fetch" bir SUNUCU YANITI DEĞİLDİR — istek hiç tamamlanmamıştır.
 * Sebebi pratikte sunucunun o an ayakta olmamasıdır: watchdog yeniden
 * başlatırken, paket güncellenirken veya ağ sürücüsü bir an düştüğünde.
 *
 * Eski davranış tek denemede pes ediyordu ve Koleksiyon sayfası o oturum
 * boyunca salt-okunur kalıyordu. Bu testler yeni davranışı çiviler:
 *   1) Ağ düzeyindeki hata yeniden denenir.
 *   2) HTTP hatası (401/403/500) yeniden DENENMEZ — o bir cevaptır; yetki
 *      hatasını gizleyip sonsuza dek denemek yanlış olurdu.
 *   3) Denemeler tükenince sayfa salt-okunur açılır ama sunucu geri
 *      geldiğinde paylaşım kendiliğinden kurulur.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const from = APP.indexOf(startMarker);
  assert.ok(from >= 0, `kaynakta bulunamadı: ${startMarker}`);
  const to = APP.indexOf(endMarker, from);
  assert.ok(to > from, `kaynakta bulunamadı: ${endMarker}`);
  return APP.slice(from, to);
}

// Gerçek gövdeleriyle çalıştırılan küçük tezgâh: fetch sahtelenir, bekleme
// sıfırlanır; yeniden deneme mantığının KENDİSİ sınanır.
function makeHarness(fetchImpl) {
  const source = [
    sliceBetween('const KOL_INIT_RETRY_DELAYS', 'let kolRecoveryTimer'),
  ].join('\n');
  const runner = new Function('fetch', 'setTimeout', `${source}\nreturn { kolIsNetworkError, kolFetchJson };`);
  return runner(fetchImpl, (fn) => { fn(); return 0; });
}

test('v7.23 ağ hatası ile HTTP hatası birbirinden ayrılır', () => {
  const { kolIsNetworkError } = makeHarness(async () => ({ ok: true, json: async () => ({}) }));
  assert.equal(kolIsNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(kolIsNetworkError(new Error('Failed to fetch')), true, 'tarayıcılar farklı sınıf kullanabilir');
  assert.equal(kolIsNetworkError(new Error('NetworkError when attempting to fetch resource.')), true);
  assert.equal(kolIsNetworkError(new Error('Yetkiniz yok.')), false, 'sunucu cevabı ağ hatası sayılmamalı');
});

test('v7.23 geçici ağ hatası yeniden denenir ve iş tamamlanır', async () => {
  let calls = 0;
  const { kolFetchJson } = makeHarness(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ workspaces: [{ ownerId: 'moderator' }] }) };
  });
  const data = await kolFetchJson('/api/collection-workspaces');
  assert.equal(calls, 3, 'iki başarısız denemeden sonra üçüncüsü başarılı olmalı');
  assert.deepEqual(data.workspaces, [{ ownerId: 'moderator' }]);
});

test('v7.23 HTTP hatası yeniden DENENMEZ; olduğu gibi bildirilir', async () => {
  let calls = 0;
  const { kolFetchJson } = makeHarness(async () => {
    calls += 1;
    return { ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: 'Bu koleksiyona erişiminiz yok.' }) };
  });
  await assert.rejects(() => kolFetchJson('/api/collection-workspaces'), /erişiminiz yok/);
  assert.equal(calls, 1, 'yetki hatası tekrar tekrar denenmemeli');
});

test('v7.23 sunucu hiç dönmezse deneme sayısı SINIRLIDIR', async () => {
  let calls = 0;
  const { kolFetchJson } = makeHarness(async () => { calls += 1; throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => kolFetchJson('/api/collection-workspaces'), /Failed to fetch/);
  assert.equal(calls, 4, 'ilk deneme + üç yeniden deneme; sonsuz döngü olmamalı');
});

test('v7.23 ağ hatasında mesaj sebebi söyler ve arka planda kurtarma başlatılır', () => {
  const init = sliceBetween('async function initKolWorkspaces(options)', 'const KOL_STATUS_API=window.BLCollectionStatusCatalog');
  assert.ok(init.includes('kolIsNetworkError(err)'), 'ağ hatası ayrı ele alınmalı');
  assert.ok(init.includes('kolScheduleSharingRecovery()'), 'sunucu geri gelince kendiliğinden kurulmalı');
  assert.ok(/yeniden başlıyor olabilir|may be restarting/.test(init), 'mesaj sebebi söylemeli');
  assert.ok(init.includes('kolWorkspaceSetReadonly()'), 'yerel sayfa kullanılabilir kalmalı');
});

test('v7.23 kurtarma yoklaması sonsuza kadar sürmez ve tek zamanlayıcı kullanır', () => {
  const recovery = sliceBetween('let kolRecoveryTimer', 'async function initKolWorkspaces(options)');
  assert.ok(recovery.includes('if(kolRecoveryTimer)return'), 'üst üste yoklama başlatılmamalı');
  assert.ok(recovery.includes('KOL_RECOVERY_MAX_MS'), 'yoklamanın bir üst sınırı olmalı');
  assert.ok(recovery.includes('initKolWorkspaces({recovered:true})'), 'sunucu dönünce paylaşım yeniden kurulmalı');
});
