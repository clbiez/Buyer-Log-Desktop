'use strict';

/* v9.58 — PLM GÖRSEL HATTI: ÖLÇÜLMÜŞ YAVAŞLIĞIN ÜÇ SEBEBİ
 *
 * Kullanıcı bildirimi: "plmden model görseli çekmek aşırı yavaşladı.
 * thumbnail oluşturması uzun sürüyor."
 *
 * TARAYICIDA GERÇEK ÖLÇÜM (1200x1600, 431 KB ürün fotoğrafı):
 *
 *   Saf CPU (30M döngü)              28 ms   → sayfa yavaş DEĞİL
 *   JPEG encode, ana iş parçacığı  1005 ms   → encode maliyeti değil, KISITLAMA
 *   JPEG encode, Worker içinde        5 ms   → 200 kat fark
 *   Tam hat, ana iş parçacığı      6055 ms
 *   Tam hat, Worker                  47 ms   → ~130 kat
 *
 * Pencere odakta değilken tarayıcı sayfanın ana iş parçacığı görevlerini
 * saniyede bire kısıyor. Otomasyon sayfası arka planda olduğu için her
 * encode ~1 saniye sürüyordu; 6 encode = 6 saniye/görsel.
 *
 * Korunan asıl kusurlar:
 * 1) Görüntü işlemenin ana iş parçacığına geri kayması (kısıtlamaya yakalanır).
 * 2) Tam boy görselin CDP sınırını gereksiz geçmesi (indir→Node→optimize).
 * 3) Worker engellenirse sessizce başarısız olmak.
 * 4) Zaten hedefin altındaki görseli boşuna yeniden kodlamak.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = require('../server/lib/agent-browser-connector.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

const expressionFor = (url, options) => connector.coreNectumFetchOptimizeExpression(url, { rawUrl: true, ...(options || {}) });

test('v9.58 ifade geçerli JavaScript üretiyor', () => {
  const expression = expressionFor('https://example.test/a.jpg');
  assert.doesNotThrow(() => new Function('return ' + expression), 'ifade tarayıcıda ayrıştırılabilmeli');
  assert.ok(expression.length > 1000);
});

/* §1 — en kritik: görüntü işleme Worker'da olmalı. */
test('v9.58 görüntü işleme Worker içinde çalışıyor', () => {
  const expression = expressionFor('https://example.test/a.jpg');
  assert.match(expression, /new Worker\(workerUrl\)/, 'Worker kullanılmalı');
  assert.match(expression, /OffscreenCanvas/);
  assert.match(expression, /convertToBlob/);
  // Worker gövdesi encode'u kendisi yapmalı; ana iş parçacığına iş kalmamalı.
  assert.match(expression, /self\.onmessage/);
  assert.match(expression, /self\.postMessage\(\{ok:true/);
});

/* §3 — Worker engellenirse (kurumsal CSP blob: worker'ı kapatabilir) sessizce
   ölmemeli; yavaş ama çalışan yola düşmeli. */
test('v9.58 Worker yoksa ana iş parçacığına düşülüyor, sessizce başarısız olunmuyor', () => {
  const expression = expressionFor('https://example.test/a.jpg');
  assert.match(expression, /typeof Worker==='function'&&typeof OffscreenCanvas==='function'/);
  assert.match(expression, /path:'main-thread'/, 'yedek yol olmalı');
  assert.match(expression, /path:'worker'/);
  assert.match(expression, /IMAGE_WORKER_TIMEOUT/, 'takılan worker sonsuza kadar beklememeli');
  // Worker kaynakları her durumda bırakılmalı.
  assert.match(expression, /worker\.terminate\(\)/);
  assert.match(expression, /revokeObjectURL/);
});

/* §4 — en hızlı optimize, hiç yapılmayandır. */
test('v9.58 zaten hedefin altındaki JPEG yeniden kodlanmıyor', () => {
  const expression = expressionFor('https://example.test/a.jpg');
  assert.match(expression, /blob\.type==='image\/jpeg'&&sourceBytes<=target/);
  assert.match(expression, /path:'as-is'/);
  assert.match(expression, /encodes:0/);
});

/* §2 — tam boy görsel CDP sınırını geçmemeli. */
test('v9.58 indirme ve optimize TEK ifadede: tam boy görsel CDP\'den geçmiyor', () => {
  // Toplu indirme ve renk görselleri artık birleşik yolu kullanmalı.
  const bulk = SOURCE.slice(SOURCE.indexOf('async function coreNectumBulkImages'), SOURCE.indexOf('async function coreNectumStyleListRowImage'));
  assert.match(bulk, /coreNectumFetchOptimizedImage\(page,url/, 'toplu indirme birleşik yolu kullanmalı');
  assert.doesNotMatch(bulk, /coreNectumOptimizeImage\(/, 'ayrı optimize turu kalmamalı');
  // v10.72: renk başına ayrı bir PLM görsel kaynağı yok. Model görseli yalnız
  // Style List satırından gelir, o da bu birleşik yoldan geçer.
  assert.doesNotMatch(SOURCE, /coreNectumFetchOptimizedImage\(page,sourceUrl/, 'renk seviyesinde ayrı indirme yolu kalmamalı');
  // ASAS teknik görselinde de ayrı fetch+optimize turu kalmamalı.
  const asas = SOURCE.slice(SOURCE.indexOf('async function collectAsasTechnicalImages'), SOURCE.indexOf('function coreNectumImageFailure'));
  // v11.00: ASAS hattı adı değişen tek-ifade yardımcısını kullanıyor.
  assert.match(asas, /_evaluateValue\(pimTechnicalImageFetchExpression\(item\.url\)\)/, 'ASAS tek ifadede indirip optimize etmeli');
  // Probe DOĞRUDAN kaydedilir; ayrı bir optimize turundan geçmez. (Eskiden bu
  // satır coreNectumOptimizeImage'ın yokluğuna bakıyordu; fonksiyon tamamen
  // kaldırıldığı için o kontrol boşa geçer olmuştu.)
  assert.match(asas, /images\.set\(item\.key,\{\.\.\.probe,/);
});

/* Ölçüldü: 5 KB hedef 16 encode + kalite 0.06; 60 KB hedef 5-6 encode +
   kalite 0.49 ve DAHA HIZLI (küçültme döngüsüne girmiyor). */
test('v9.58 varsayılan hedef 60 KB / 900px, kalite tabanı makul', () => {
  assert.equal(connector.IMAGE_TARGET_BYTES, 61440);
  assert.equal(connector.IMAGE_DIMENSION_CAP, 900);
  assert.ok(connector.IMAGE_QUALITY_FLOOR >= 0.3, 'kalite tabanı 0.3\'ün altına düşmemeli');
  // Eski 5120 varsayılanı çalışan kodda kalmamalı.
  const code = SOURCE.split(/\r?\n/).filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /\|\|\s*5120/, 'eski 5 KB varsayılanı kaldırılmalı');
});

test('v9.58 hedef boyut sınırlandırılıyor', () => {
  assert.equal(connector.imageTargetBytes(0), 61440, 'geçersiz değer varsayılana düşmeli');
  assert.equal(connector.imageTargetBytes(null), 61440);
  assert.equal(connector.imageTargetBytes(512), 1024, 'alt sınır');
  assert.equal(connector.imageTargetBytes(99 * 1024 * 1024), 4 * 1024 * 1024, 'üst sınır');
  assert.equal(connector.imageTargetBytes(30720), 30720, 'geçerli değer korunmalı');
});

test('v9.58 zorla yenilemede cache-bust adresi kullanılıyor, normalde kullanılmıyor', () => {
  // Geçerli bir CoreNectum Attachment adresi: doğrulama bu kalıbı şart koşuyor.
  const url = 'https://corenectum.lcwaikiki.com/Attachment/GetAttachment/12345';
  assert.ok(connector.coreNectumAttachmentUrl(url), 'ön koşul: adres geçerli sayılmalı');
  const forced = connector.coreNectumFetchOptimizeExpression(url, { forceRefresh: true, refreshToken: 'TOKEN123' });
  assert.match(forced, /TOKEN123/, 'zorla yenilemede jeton adrese girmeli');
  const normal = connector.coreNectumFetchOptimizeExpression(url, {});
  assert.doesNotMatch(normal, /TOKEN123/);
});

test('v9.58 ASAS teknik görselinde işçi sayısı artırıldı', () => {
  const asas = SOURCE.slice(SOURCE.indexOf('async function collectAsasTechnicalImages'), SOURCE.indexOf('function coreNectumImageFailure'));
  assert.match(asas, /length:Math\.min\(4,candidates\.length\)/, 'iki işçi ağ beklemesini örtmüyordu');
});

test('v9.58 hat oturum kimliğini koruyor (credentials include)', () => {
  const expression = expressionFor('https://example.test/a.jpg');
  assert.match(expression, /credentials:'include'/, 'kurumsal oturum olmadan görsel indirilemez');
  assert.match(expression, /cache:'no-store'/);
});
