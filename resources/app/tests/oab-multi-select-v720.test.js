'use strict';

/*
 * v7.20 — OAB ÇOKLU SEÇİM (Season × MAG × Buyer Group)
 *
 * Kullanıcı talebi: "Season, MAG, Buyer Group filtreleri OAB sitesinde çoklu
 * seçime kapalı. Buyer Log'da çoklu seçim yaptırıp, arka planda seçim yapılmış
 * tüm verileri OAB'dan getirtebilir miyiz? ... her kombinasyonun verisini gidip
 * OAB'dan çekip Buyer Log'da tek rapor olarak paylaşabilir."
 *
 * SAHA GERÇEKLERİ (paketlenmiş metadata'dan ölçüldü, uydurma değil):
 *   · 4 sezon, sezon başına 103-132 MAG, MAG başına 11-60 Buyer Group.
 *   · Bir MAG'ın ORTANCA 41 Buyer Group'u var.
 *   · "2 sezon × 2 MAG × tüm Buyer Group" = 164 kombinasyon; tek OAB çağrısı
 *     15-25 saniye olduğu için bu ~55 dakika demek.
 *   · Aynı seçim, PASS'in ÇOĞUL `BuyerGroupRefs` parametresi gerçekten liste
 *     kabul ediyorsa 4 isteğe iner.
 *
 * Bu testler üç şeyi çivilerler:
 *   1) Plan doğru ve karşılıksız kombinasyonlar SESSİZCE atılmıyor.
 *   2) Toplu istek yeteneği VARSAYILMIYOR; yanıt içeriğinden doğrulanıyor.
 *   3) Birleştirme satır kaybetmiyor ve alan birleşimini koruyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-oab-v720-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const batch = require('../server/lib/oab-batch');
const oabStore = require('../server/lib/oab-store');
const staticMetadata = require('../server/lib/oab-static-metadata');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const OAB_JS = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

// Küçük, tamamen kontrol edilebilir bir metadata: gerçek dosyaya bağlı
// kalmadan kenar durumları (sezonda olmayan MAG, MAG'da olmayan grup) kurar.
const fakeMetadata = {
  seasonRefs: () => ['S6', 'S7'],
  magRefsForSeason: seasonRef => (seasonRef === 'S6' ? ['CU4E', 'CK1E'] : ['CU4E']),
  buyerGroupRefsFor: (seasonRef, magRef) => {
    if (magRef === 'CU4E') return ['LISANS', 'DOKUMA'];
    if (magRef === 'CK1E') return ['LISANS'];
    return [];
  },
};

/* ---------------- 1 · Planlama ---------------- */

test('v7.20 kullanıcının örneği: çarpımın yalnız GERÇEKTEN VAR OLAN üçlüleri istenir', () => {
  // Kullanıcının verdiği örnek: Season S6+S7, MAG CU4E+CK1E, Buyer Lisans+Dokuma.
  const plan = batch.planCombinations(fakeMetadata, {
    seasonRefs: ['S6', 'S7'], merchSubGroupRefs: ['CU4E', 'CK1E'], buyerGroupRefs: ['LISANS', 'DOKUMA'],
  });
  // Ham çarpım 2×2×2 = 8. Gerçekte var olan: S6/CU4E×2, S6/CK1E×1, S7/CU4E×2 = 5.
  assert.equal(plan.combinations.length, 5);
  assert.equal(plan.error, '');
  const keys = plan.combinations.map(item => `${item.seasonRef}|${item.merchSubGroupRef}|${item.buyerGroupRef}`);
  assert.ok(keys.includes('S6|CU4E|LISANS'));
  assert.ok(keys.includes('S7|CU4E|DOKUMA'));
  assert.ok(!keys.includes('S7|CK1E|LISANS'), 'CK1E S7 sezonunda yok');
});

test('v7.20 karşılıksız kombinasyonlar sessizce atılmaz, sebebiyle raporlanır', () => {
  const plan = batch.planCombinations(fakeMetadata, {
    seasonRefs: ['S6', 'S7', 'YOK'], merchSubGroupRefs: ['CU4E', 'CK1E'], buyerGroupRefs: ['LISANS', 'DOKUMA'],
  });
  const reasons = plan.skipped.map(item => item.reason);
  assert.ok(reasons.includes('season-not-found'), 'bilinmeyen sezon raporlanmalı');
  assert.ok(reasons.includes('mag-not-in-season'), 'sezonda olmayan MAG raporlanmalı');
  assert.ok(reasons.includes('buyer-group-not-in-mag'), "MAG'da olmayan grup raporlanmalı");
  // Atlama kayıtları HATANIN OLDUĞU KADEMEDE toplanır: bilinmeyen bir sezon
  // için dört ayrı satır değil TEK satır yazılır ("YOK sezonu metadata'da
  // yok"). Kullanıcıya okunabilir olan budur.
  assert.equal(plan.skipped.length, 3);

  // Yine de hiçbir üçlü SESSİZCE kaybolmamalı: kayıtlar üçlü düzeyine
  // açıldığında ham çarpımın tamamı ya çekilecek ya açıklanmış olmalı.
  const explained = plan.skipped.reduce((total, item) => {
    if (item.reason === 'season-not-found') return total + 2 * 2;      // o sezonun bütün MAG × grup çarpımı
    if (item.reason === 'mag-not-in-season') return total + 2;         // o MAG'ın bütün grupları
    return total + 1;                                                  // tek üçlü
  }, 0);
  assert.equal(plan.combinations.length + explained, 3 * 2 * 2,
    'çekilen + açıklanan, ham çarpımın tamamını kapatmalı');
});

test('v7.20 boş dizi "hepsi" anlamına gelmez; hepsi için açık bayrak gerekir', () => {
  const empty = batch.planCombinations(fakeMetadata, { seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], buyerGroupRefs: [] });
  assert.equal(empty.error, 'buyer-group-required', 'kazara devasa iş başlatılmamalı');
  const all = batch.planCombinations(fakeMetadata, { seasonRefs: ['S6'], merchSubGroupRefs: ['CU4E'], allBuyerGroups: true });
  assert.equal(all.combinations.length, 2);
});

test('v7.20 gerçek metadata ile ölçülen maliyet: MAG başına onlarca Buyer Group', () => {
  const md = staticMetadata.planningMetadata();
  const seasons = md.seasonRefs().slice(0, 2).map(String);
  const mags = md.magRefsForSeason(seasons[0]).slice(0, 2).map(String);
  const all = batch.planCombinations(md, { seasonRefs: seasons, merchSubGroupRefs: mags, allBuyerGroups: true });
  // Bu sayı, "çoklu seçim ucuz" varsayımının neden yanlış olduğunu çiviler.
  assert.ok(all.combinations.length > 50, `iki sezon iki MAG için ${all.combinations.length} kombinasyon bekleniyordu`);
  // Toplu mod işe yararsa aynı seçim (Sezon × MAG) sayısına iner.
  assert.equal(batch.groupBySeasonMag(all.combinations).length, 4);
});

test('v7.20 süre tahmini ölçülmüş sabitten türetilir ve istek sayısıyla orantılıdır', () => {
  assert.equal(batch.SECONDS_PER_REQUEST, 20);
  assert.equal(batch.estimateSeconds(0), 0);
  assert.equal(batch.estimateSeconds(8), 160);
  assert.equal(batch.estimateSeconds(164), 3280);
});

/* ---------------- 2 · Toplu istek yeteneği ---------------- */

test('v7.20 toplu yanıt YALNIZ satır içeriği kanıtlıyorsa kabul edilir', () => {
  const requested = ['LISANS', 'DOKUMA'];
  const multi = [{ 'Buyer Grup Tanımı': 'LİSANS' }, { 'Buyer Grup Tanımı': 'DOKUMA' }];
  assert.equal(batch.verifyBatchedBuyerGroupResponse(multi, requested).verified, true);

  // PASS fazladan parametreyi sessizce yok sayıp TEK grubun verisini dönebilir.
  // Bu durumda toplu mod kullanılırsa rapor sessizce eksik olurdu.
  const single = [{ 'Buyer Grup Tanımı': 'LİSANS' }, { 'Buyer Grup Tanımı': 'LİSANS' }];
  const singleVerdict = batch.verifyBatchedBuyerGroupResponse(single, requested);
  assert.equal(singleVerdict.verified, false);
  assert.equal(singleVerdict.reason, 'single-group-returned');

  assert.equal(batch.verifyBatchedBuyerGroupResponse([], requested).reason, 'empty-response');
  assert.equal(batch.verifyBatchedBuyerGroupResponse([{ Baska: 1 }], requested).reason, 'buyer-group-field-missing');
  // Tek grup istenmişse toplu mod KANITLANAMAZ; "doğrulandı" sayılmamalı.
  assert.equal(batch.verifyBatchedBuyerGroupResponse(multi, ['LISANS']).verified, false);
});

test('v7.20 öğrenilen yetenek kalıcı ve sıfırlanabilir', () => {
  assert.equal(oabStore.loadBatchCapability().state, 'unknown');
  oabStore.saveBatchCapability({ state: 'supported', reason: '', distinctGroups: 3 });
  assert.equal(oabStore.loadBatchCapability().state, 'supported');
  assert.equal(oabStore.loadBatchCapability().distinctGroups, 3);
  // Yanlış öğrenilmiş bir 'supported' sessiz eksik rapor demek; sıfırlanabilmeli.
  oabStore.resetBatchCapability();
  assert.equal(oabStore.loadBatchCapability().state, 'unknown');
  // TTL ayarı aynı dosyada; yetenek yazımı onu bozmamalı.
  oabStore.saveCacheSettings({ ttlMinutes: 42 });
  oabStore.saveBatchCapability({ state: 'unsupported' });
  assert.equal(oabStore.loadCacheSettings().ttlMinutes, 42, 'yetenek yazımı TTL ayarını ezmemeli');
  oabStore.resetBatchCapability();
});

test('v7.20 PASS parametresi çoğul liste olarak gönderilebiliyor', () => {
  const connector = require('../server/lib/agent-browser-connector');
  assert.equal(connector.passBuyerGroupParam('97', null), '97', 'tek ref eski davranışın aynısı');
  assert.equal(connector.passBuyerGroupParam('', ['97', '98']), '97,98');
  assert.equal(connector.passBuyerGroupParam('', ['97', '97', '98']), '97,98', 'tekrar eden ref tekilleşmeli');
  assert.equal(connector.passBuyerGroupParam('97', []), '97', 'boş liste tekil ref\'i düşürmemeli');
  // Parametre adının çoğul olduğu gövdede korunmalı.
  assert.match(CONNECTOR, /BuyerGroupRefs:passBuyerGroupParam\(buyerGroupRef,buyerGroupRefs\)/);
});

/* ---------------- 3 · Birleştirme ---------------- */

test('v7.20 birleştirme satır düşürmez ve alan birleşimini korur', () => {
  const merged = batch.mergeReportResults([
    { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: 'LISANS', rows: [{ A: 1 }, { A: 2 }], fields: ['A'], fromCache: true, fetchedAt: 'T1' },
    { seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: 'DOKUMA', rows: [{ A: 3, B: 9 }], fields: ['A', 'B'], fromCache: false, fetchedAt: 'T2' },
  ]);
  assert.equal(merged.rows.length, 3, 'hiçbir satır düşmemeli');
  assert.deepEqual(merged.fields, ['A', 'B'], 'bir tarafta olup diğerinde olmayan alan kaybolmamalı');
  assert.equal(merged.sources.length, 2);
  assert.equal(merged.sources[0].fromCache, true);
  assert.equal(merged.sources[1].rows, 1);
});

test('v7.20 alan listesi boş gelirse satırlardan türetilir', () => {
  // Eski cache kayıtları alan listesi taşımayabilir; rapor alansız kalmamalı.
  const merged = batch.mergeReportResults([{ seasonRef: 'S6', merchSubGroupRef: 'M', buyerGroupRef: 'B', rows: [{ X: 1, Y: 2 }], fields: [] }]);
  assert.deepEqual(merged.fields.sort(), ['X', 'Y']);
});

test('v7.20 aynı (Sezon, MAG) altındaki gruplar tek isteğe toplanır, sıra korunur', () => {
  const groups = batch.groupBySeasonMag([
    { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: 'LISANS' },
    { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: 'DOKUMA' },
    { seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: 'LISANS' },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRefs: ['LISANS', 'DOKUMA'] });
  assert.deepEqual(groups[1].buyerGroupRefs, ['LISANS']);
});

/* ---------------- 4 · Sunucu akışı ---------------- */

test('v7.20 toplu çekme uçları var ve iş kimlikli arka planda yürüyor', () => {
  for (const route of ["app.post('/api/oab/plan'", "app.post('/api/oab/batch'", "app.get('/api/oab/batch-status'", "app.post('/api/oab/batch/cancel'", "app.post('/api/oab/batch/reset-capability'"]) {
    assert.ok(SERVER.includes(route), `${route} bulunmalı`);
  }
  // İstek hemen dönmeli: 15-25 sn × N kombinasyonluk bir işi HTTP isteğinde
  // beklemek hem tarayıcıyı hem sunucuyu kilitlerdi.
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/oab/batch'"), SERVER.indexOf("app.get('/api/oab/batch-status'"));
  assert.match(block, /res\.status\(202\)\.json\(\{ started:true/);
});

test('v7.20 kısmi başarı korunur: bir kombinasyonun hatası işi çöpe atmaz', () => {
  const block = SERVER.slice(SERVER.indexOf('async function runOabBatchJob'), SERVER.indexOf('function oabBuildPlan'));
  assert.match(block, /job\.failures\.push/);
  assert.match(block, /oabBatch\.mergeReportResults\(job\.results\)/);
  // İptal kuyruğu durdurur ama eldeki sonuçlar yine birleştirilir.
  assert.match(block, /if \(job\.cancelled\) break;/);
  const cancel = SERVER.slice(SERVER.indexOf("app.post('/api/oab/batch/cancel'"), SERVER.indexOf("app.post('/api/oab/batch/reset-capability'"));
  assert.match(cancel, /job\.cancelled = true/);
  assert.doesNotMatch(cancel, /job\.results\s*=\s*\[\]/, 'iptal, çekilmiş veriyi silmemeli');
});

test('v7.20 toplu yanıt doğrulanmazsa kuyruk kombinasyon başına yeniden kurulur', () => {
  const block = SERVER.slice(SERVER.indexOf('if (job.probe) {'), SERVER.indexOf('await runOabBatchJob(job'));
  assert.match(block, /verdict\.verified \? 'supported' : 'unsupported'/);
  // Doğrulanmayan turun satırları ATILIR: yarım veriyi rapora katmak sessizce
  // eksik rapor vermek olurdu.
  assert.match(block, /job\.results = \[\]/);
  assert.match(block, /job\.queue = built\.plan\.combinations\.map/);
});

test('v7.20 toplu yanıt tek cache anahtarına yazılmaz', () => {
  // Cache anahtarı Season|MAG|BuyerGroup üçlüsüdür. Çok gruplu bir yanıtı tek
  // anahtara yazmak, sonraki tekil isteklere yanlış veri döndürürdü.
  const block = SERVER.slice(SERVER.indexOf('async function oabFetchOneCombination'), SERVER.indexOf('async function oabProbeBatchedBuyerGroups'));
  assert.match(block, /const single = !Array\.isArray\(item\.buyerGroupRefs\) \|\| item\.buyerGroupRefs\.length <= 1;/);
  assert.match(block, /if \(single\) \{[\s\S]*?oabStore\.set\(key/, 'cache yazımı yalnız tekil istekte olmalı');
});

test('v7.20 kaçak "hepsini seç" işleri üst sınırla durdurulur', () => {
  assert.match(SERVER, /const OAB_BATCH_MAX_COMBINATIONS = \d+;/);
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/oab/batch'"), SERVER.indexOf("app.get('/api/oab/batch-status'"));
  assert.match(block, /OAB_BATCH_TOO_LARGE/);
});

/* ---------------- 5 · Arayüz ---------------- */

test('v7.20 üç filtre de çoklu seçim, tekil <select> kalmadı', () => {
  for (const id of ['oabSeasonTrigger', 'oabMagTrigger', 'oabBuyerGroupTrigger']) {
    assert.ok(INDEX.includes(`id="${id}"`), `${id} bulunmalı`);
  }
  for (const id of ['oabSeasonSelect', 'oabMagSelect', 'oabBuyerGroupSelect']) {
    assert.ok(!INDEX.includes(`id="${id}"`), `${id} kaldırılmalı`);
    assert.ok(!OAB_JS.includes(`'${id}'`), `${id} istemcide de kalmamalı`);
  }
});

test('v7.20 maliyet tahmini sunucudaki PLANDAN gelir', () => {
  // İstemcide ayrıca hesaplamak, ekranda görünen sayı ile gerçekte çekilen
  // sayının ayrışması demekti: kullanıcı 8 sanıp 164 kombinasyon başlatabilirdi.
  assert.match(OAB_JS, /plan: selection => oabJson\('\/api\/oab\/plan'/);
  const planBar = OAB_JS.slice(OAB_JS.indexOf('function oabRenderPlanBar'), OAB_JS.indexOf('function oabShowSkippedCombinations'));
  assert.match(planBar, /plan\.combinationCount/);
  assert.match(planBar, /plan\.requestCount/);
  assert.match(planBar, /oabFormatDuration\(plan\.estimateSeconds\)/);
  assert.match(planBar, /plan\.skippedCount/, 'karşılıksız kombinasyonlar kullanıcıya görünmeli');
});

test('v7.20 ağır işler çalıştırılmadan önce onay ister', () => {
  assert.match(OAB_JS, /const OAB_HEAVY_SECONDS = \d+;/);
  const run = OAB_JS.slice(OAB_JS.indexOf('async function oabRunBatch'), OAB_JS.indexOf('function oabPollBatch'));
  assert.match(run, /oabPlanHeavySeconds\(plan\) >= OAB_HEAVY_SECONDS && !\(await oabConfirmHeavyRun\(plan\)\)/);
  assert.match(run, /return;/);
});

test('v7.20 onay eşiği İYİMSER değil EN KÖTÜ duruma bakar', () => {
  // Gerçek tarayıcıda ölçülen tuzak: yetenek 'unknown' iken 164 kombinasyon
  // "4 istek · ~80 sn" görünüyordu ve 180 sn'lik eşiğin altında kaldığı için
  // onay istenmiyordu. Doğrulama başarısız olsaydı aynı iş ~55 dakikaydı.
  const heavy = new Function(`${OAB_JS.slice(OAB_JS.indexOf('function oabPlanHeavySeconds'), OAB_JS.indexOf('function oabFormatDuration'))} return oabPlanHeavySeconds;`)();
  assert.equal(heavy({ estimateSeconds: 80, worstCaseSeconds: 3280 }), 3280, 'en kötü durum baskın olmalı');
  assert.equal(heavy({ estimateSeconds: 160, worstCaseSeconds: 160 }), 160);
  assert.equal(heavy(null), 0);

  // Plan ucu en kötü durumu da yayınlamalı, yoksa istemci hesaplayamaz.
  const block = SERVER.slice(SERVER.indexOf('function oabBuildPlan'), SERVER.indexOf("app.post('/api/oab/plan'"));
  assert.match(block, /worstCaseRequestCount: worstCaseRequests/);
  assert.match(block, /batchUnproven: capability\.state === 'unknown'/);
  // Yetenek 'supported' ise en kötü durum = gerçek durum; boşuna uyarı çıkmaz.
  assert.match(block, /capability\.state === 'supported' \? requestCount : plan\.combinations\.length/);
});

test('v7.20 doğrulanmamış toplu istek kullanıcıya açıkça yazılır', () => {
  const planBar = OAB_JS.slice(OAB_JS.indexOf('function oabRenderPlanBar'), OAB_JS.indexOf('function oabShowSkippedCombinations'));
  assert.match(planBar, /plan\.batchUnproven/);
  assert.match(planBar, /toplu istek doğrulanmazsa/);
  const confirm = OAB_JS.slice(OAB_JS.indexOf('async function oabConfirmHeavyRun'), OAB_JS.indexOf('async function oabRunBatch'));
  assert.match(confirm, /plan\.batchUnproven/, 'onay penceresi de riski yazmalı');
  assert.match(confirm, /plan\.worstCaseRequestCount/);
});

test('v7.20 tek kombinasyon eski tekil yoldan gider', () => {
  // Aynı cache, aynı davranış, aynı hata mesajları: çoklu seçim eklemek tek
  // seçim deneyimini değiştirmemeli.
  const fetchBody = OAB_JS.slice(OAB_JS.indexOf('async function oabFetchReport'), OAB_JS.indexOf('const OAB_HEAVY_SECONDS'));
  assert.match(fetchBody, /const single = S\.seasonRefs\.length === 1 && S\.magRefs\.length === 1 && !S\.allBuyerGroups && S\.buyerGroupRefs\.length === 1;/);
  assert.match(fetchBody, /OABApi\.report\(S\.seasonRefs\[0\], S\.magRefs\[0\], S\.buyerGroupRefs\[0\], forceRefresh\)/);
  assert.match(fetchBody, /await oabRunBatch\(forceRefresh\)/);
});

test('v7.20 zincirleme kural: üst seçim daralınca geçerli kalan alt seçimler korunur', () => {
  // Eski davranış "sezon değişince MAG'ı SIFIRLA" idi. Çoklu seçimde bu,
  // kullanıcının onlarca işaretini bir tıkla silmek anlamına gelirdi.
  const body = OAB_JS.slice(OAB_JS.indexOf('function oabKeepValid'), OAB_JS.indexOf('function oabOnBuyerGroupSelectionChange'));
  assert.match(body, /S\.magRefs = oabKeepValid\(S\.magRefs, S\.mag\)/);
  assert.match(body, /S\.buyerGroupRefs = oabKeepValid\(S\.buyerGroupRefs, S\.buyerGroups\)/);
});

test('v7.20 kısmi başarı ve iptal kullanıcıya bildirilir', () => {
  const outcome = OAB_JS.slice(OAB_JS.indexOf('function oabReportBatchOutcome'), OAB_JS.indexOf('async function oabCancelBatch'));
  assert.match(outcome, /kombinasyon birleştirildi/);
  assert.match(outcome, /iş iptal edildi/);
  assert.match(outcome, /kombinasyon alınamadı/);
  assert.ok(OAB_JS.includes('oabCancelBtn'), 'iptal düğmesi bağlanmalı');
});

test('v7.20 çoklu seçim bileşeni büyük listelerde kullanılabilir', () => {
  // MAG 130'u, Buyer Group 60'ı aşabiliyor: arama ve toplu işaretleme şart.
  const popover = OAB_JS.slice(OAB_JS.indexOf('function oabOpenMultiPopover'), OAB_JS.indexOf('document.addEventListener'));
  assert.match(popover, /oabMultiSearch/, 'arama kutusu olmalı');
  assert.match(popover, /data-oab-multi-all/);
  assert.match(popover, /data-oab-multi-none/);
  // "Tümü" ARANAN listeyi seçmeli; filtreyi yok sayıp 130 MAG'ı birden
  // işaretlemek kullanıcının kastetmediği devasa bir iş demek olurdu.
  // Filtre artık ortak çoklu-değer tablo aramasıyla (parseTableSearchTerms +
  // tableSearchMatches) yapılıyor; iddia, kullanılan yardımcının adına değil
  // "Tümü yalnız GÖRÜNEN listeyi seçer" davranışına bağlı.
  assert.match(popover, /const visibleRefs = spec\.options\(\)[\s\S]*?\.filter\(opt => tableSearchMatches\(/);
  assert.match(popover, /if \(all\) visibleRefs\.forEach\(ref => next\.add\(ref\)\)/);
});
