'use strict';

/*
 * v7.23 — OAB PİVOT YEREL FİLTRELERİNDE ÇOKLU SEÇİM + HATA DETAYI
 *
 * Kullanıcı talebi (saha):
 *   · "OAB pivot tablosundaki Klasman Tanımı gibi filtreleme alanlarında
 *      çoklu seçim yapmama izin ver."
 *   · "Fail olan kombinasyonun detayını ... görmek, ... yeniden dene diyerek
 *      pivot alanına dahil etmek istiyorum."
 *
 * Süzme motoru (OABLocalFilterEngine) çoklu değeri ZATEN destekliyordu —
 * filtre bir Set. Kısıt yalnız arayüzdeydi: tek seçimli <select>. Bu yüzden
 * testler "motor çoklu çalışıyor mu"yu da, "arayüz gerçekten çoklu yazıyor
 * mu"yu da ayrı ayrı doğrular; ikincisi olmadan birincisi ölü koddur.
 *
 * public/oab.js bir IIFE olduğu için ilgili fonksiyonlar kaynaktan DİLİMLENİP
 * gerçek gövdeleriyle çalıştırılır (yeniden yazılmaz); böylece test, kodun
 * kendisini sınar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OAB_JS = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const APP_CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const from = OAB_JS.indexOf(startMarker);
  assert.ok(from >= 0, `kaynakta bulunamadı: ${startMarker}`);
  const to = OAB_JS.indexOf(endMarker, from);
  assert.ok(to > from, `kaynakta bulunamadı: ${endMarker}`);
  return OAB_JS.slice(from, to);
}

/* Yerel filtre seçim yolunu GERÇEK gövdeleriyle koşturan küçük bir tezgâh.
   DOM yerine sayılabilir bir sahte kullanılır; amaç etiketin değil, seçimin
   S.localFilters üzerine doğru yazılmasıdır. */
function makeLocalFilterHarness() {
  const source = [
    sliceBetween('function oabApplySelection', 'function oabCloseMultiPopover'),
    sliceBetween('function oabLocalFilterLabelText', 'const OAB_DEFAULT_LOCAL_FILTER_FIELDS'),
  ].join('\n');
  const rendered = [];
  const runner = new Function('S', 'oabT', 'document', 'oabMultiSetSelected', 'oabMultiRenderLabel',
    'oabRenderKpis', 'oabRenderRowCount', 'oabRenderTable', 'rendered',
    `${source}
     return { oabApplySelection, oabLocalFilterSpec, oabLocalFilterLabelText, oabLocalFilterRenderLabel };`);
  const S = { localFilters: {}, localFilterOptions: {} };
  const api = runner(
    S,
    (tr) => tr,
    { querySelectorAll: () => [] },
    () => { throw new Error('yerel filtrede üst filtre yazıcısı çağrılmamalı'); },
    () => { throw new Error('yerel filtrede üst filtre etiketi çağrılmamalı'); },
    () => rendered.push('kpi'), () => rendered.push('rowCount'), () => rendered.push('table'),
    rendered,
  );
  return { ...api, S, rendered };
}

test('v7.23 yerel filtre birden çok değeri S.localFilters üzerine yazar', () => {
  const h = makeLocalFilterHarness();
  h.S.localFilterOptions['Klasman Tanımı'] = [
    { Ref: 'ELBİSE', Name: 'ELBİSE' }, { Ref: 'GÖMLEK', Name: 'GÖMLEK' }, { Ref: 'PANTOLON', Name: 'PANTOLON' },
  ];
  const spec = h.oabLocalFilterSpec('Klasman Tanımı');
  assert.deepEqual(spec.selected(), [], 'başlangıçta filtre yok');
  assert.equal(spec.options().length, 3);

  h.oabApplySelection(spec, '', ['ELBİSE', 'GÖMLEK']);
  assert.deepEqual([...h.S.localFilters['Klasman Tanımı']], ['ELBİSE', 'GÖMLEK'],
    'iki değer birden seçilebilmeli — tek seçim kısıtı kalkmalı');
  assert.deepEqual(spec.selected(), ['ELBİSE', 'GÖMLEK']);
});

test('v7.23 seçim boşaltılınca filtre anahtarı SİLİNİR (boş Set kalmaz)', () => {
  const h = makeLocalFilterHarness();
  const spec = h.oabLocalFilterSpec('Fit');
  h.oabApplySelection(spec, '', ['SLIM']);
  assert.ok(h.S.localFilters.Fit);
  h.oabApplySelection(spec, '', []);
  assert.equal(Object.prototype.hasOwnProperty.call(h.S.localFilters, 'Fit'), false,
    'boş Set bırakmak, motoru gereksizce "filtre var" moduna sokardı');
});

test('v7.23 seçim değişince YALNIZ sonuç tazelenir, filtre çubuğu yeniden çizilmez', () => {
  // Çubuğu yeniden çizmek, açık seçim penceresinin dayandığı düğmeyi DOM'dan
  // siler ve kullanıcı ikinci değeri seçemeden pencere kopardı.
  const h = makeLocalFilterHarness();
  const spec = h.oabLocalFilterSpec('Persona');
  spec.onChange();
  assert.deepEqual(h.rendered, ['table']);
});

test('v7.23 aynı seçim değeri iki kez yazılsa da tekilleşir', () => {
  const h = makeLocalFilterHarness();
  const spec = h.oabLocalFilterSpec('Line Tanımı');
  h.oabApplySelection(spec, '', ['A', 'A', 'B']);
  assert.deepEqual([...h.S.localFilters['Line Tanımı']], ['A', 'B']);
});

test('v7.23 etiket seçim sayısını gösterir', () => {
  const h = makeLocalFilterHarness();
  const spec = h.oabLocalFilterSpec('Siluet');
  assert.equal(h.oabLocalFilterLabelText('Siluet'), 'Tümü');
  h.oabApplySelection(spec, '', ['OVERSIZE']);
  assert.equal(h.oabLocalFilterLabelText('Siluet'), 'OVERSIZE', 'tek seçimde değerin kendisi yazılmalı');
  h.oabApplySelection(spec, '', ['OVERSIZE', 'REGULAR']);
  assert.equal(h.oabLocalFilterLabelText('Siluet'), '2 seçili');
});

test('v7.23 çoklu yerel filtre GERÇEKTEN satır süzüyor (motor + arayüz birlikte)', () => {
  const engineSource = sliceBetween('function OABLocalFilterEngine', '/* -------------------------------------------------------');
  const Engine = new Function(`${engineSource}\nreturn OABLocalFilterEngine;`)();
  const rows = [
    { 'Klasman Tanımı': 'ELBİSE', qty: 1 },
    { 'Klasman Tanımı': 'GÖMLEK', qty: 2 },
    { 'Klasman Tanımı': 'PANTOLON', qty: 3 },
  ];
  const h = makeLocalFilterHarness();
  const spec = h.oabLocalFilterSpec('Klasman Tanımı');
  h.oabApplySelection(spec, '', ['ELBİSE', 'PANTOLON']);
  const filtered = new Engine(rows).apply(h.S.localFilters);
  assert.deepEqual(filtered.map(row => row.qty), [1, 3], 'iki klasman birden görünmeli');
});

test('v7.23 yerel filtre çubuğu <select> değil, çoklu seçim düğmesi üretir', () => {
  const bar = sliceBetween('function oabRenderLocalFilterBar', 'function oabLocalFilterLabelText');
  assert.ok(bar.includes('data-oab-local-filter='), 'düğme, alan adını taşımalı');
  assert.ok(bar.includes('oabMultiTrigger'), 'üst filtrelerle AYNI bileşen kullanılmalı');
  // Yorum satırlarında "<select>" geçebilir; sınanan şey ÜRETİLEN MARKUP.
  const barCode = bar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/<select/i.test(barCode), 'tek seçimli <select> kalmamalı');
  assert.ok(bar.includes('S.localFilterOptions'), 'seçenekler açılır liste için saklanmalı');
});

test('v7.23 tıklama yönlendirmesi yerel filtre düğmelerini de açar', () => {
  const handler = sliceBetween("document.addEventListener('click'", 'document.addEventListener(\'keydown\'');
  assert.ok(handler.includes('trigger.dataset.oabLocalFilter'), 'yerel filtre düğmesi yönlendirilmeli');
  assert.ok(handler.includes('oabLocalFilterSpec('), 'kendi spec\'i ile açılmalı');
  assert.ok(handler.includes('oabCloseMultiPopover()'), 'dışarı tıklayınca kapanmalı');
});

test('v7.23 açılır liste hem üst filtreye hem yerel filtreye hizmet eder', () => {
  const popover = sliceBetween('function oabOpenMultiPopover', "document.addEventListener('click'");
  assert.ok(popover.includes('typeof kindOrSpec === \'string\' ? OAB_MULTI[kindOrSpec] : kindOrSpec'),
    'aynı bileşen iki kaynaktan da spec alabilmeli — ikinci bir seçim deseni doğmamalı');
  assert.ok(popover.includes('oabApplySelection(spec, kind,'), 'yazma tek kapıdan geçmeli');
  assert.ok(!popover.includes('oabMultiSetSelected(kind'), 'doğrudan üst filtre yazımı kalmamalı');
});

/* ------------------------------------------------- HATA DETAYI / YENİDEN DENE */

function makeFailureHarness(failures) {
  const source = sliceBetween('function oabRetryableCombinations', 'function oabShowFailureDetails');
  const runner = new Function('S', `${source}\nreturn oabRetryableCombinations;`);
  return runner({ batchFailures: failures });
}

test('v7.23 yeniden denenecek kombinasyonlar hatalardan çıkarılır ve tekilleşir', () => {
  const retryable = makeFailureHarness([
    { label: 'A', combinations: [
      { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '1' },
      { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '2' },
    ] },
    { label: 'B', combinations: [
      { seasonRef: 'S6', merchSubGroupRef: 'CU4E', buyerGroupRef: '2' }, // aynısı
    ] },
  ])();
  assert.equal(retryable.length, 2, 'aynı üçlü iki kez istenmemeli');
  assert.deepEqual(retryable.map(item => item.buyerGroupRef), ['1', '2']);
});

test('v7.23 referans taşımayan hata (ör. yetenek doğrulaması) yeniden denenmez', () => {
  const retryable = makeFailureHarness([{ label: 'probe', combinations: [] }])();
  assert.deepEqual(retryable, [], 'kuyruğu zaten yeniden kurulan bir hata için düğme boş iş yapmamalı');
});

test('v7.23 durum mesajı değişince tıklanabilirlik ve eski hata listesi TEMİZLENİR', () => {
  const setStatus = sliceBetween('function oabSetStatus', 'function oabBusyElapsedMs');
  assert.ok(setStatus.includes('S.batchFailures = []'),
    'yeni mesajla birlikte eski hata listesi düşmeli — görünen ile tıklanınca açılan ayrışamaz');
  assert.ok(setStatus.includes("classList.remove('isClickable')"));
  const outcome = sliceBetween('function oabReportBatchOutcome', 'function oabBindFailureDetails');
  const statusAt = outcome.indexOf('oabSetStatus(');
  const assignAt = outcome.indexOf('S.batchFailures = failures');
  assert.ok(statusAt >= 0 && assignAt > statusAt, 'liste, mesaj yazıldıktan SONRA doldurulmalı');
});

test('v7.23 hata şeridi tek tıkla VE klavyeyle açılır', () => {
  const bind = sliceBetween('function oabBindFailureDetails', 'function oabRetryableCombinations');
  assert.ok(bind.includes("addEventListener('click'"), 'tek tık yeterli olmalı');
  assert.ok(bind.includes("event.key === 'Enter'") && bind.includes("event.key === ' '"),
    'klavye kullanıcıları da detayı açabilmeli');
  assert.ok(bind.includes('el._oabFailureBound'), 'dinleyici her raporda yeniden eklenmemeli');
  assert.ok(APP_CSS.includes('.oabStatus.isClickable'), 'tıklanabilirlik görsel olarak da belli olmalı');
});

test('v7.23 yeniden deneme mevcut raporun ÜZERİNE ekler, yerine geçmez', () => {
  const merge = sliceBetween('async function oabMergeRetryRows', 'const OAB_SEASON_FIELD');
  assert.ok(merge.includes('S.rows.filter'), 'eldeki satırlar korunmalı');
  assert.ok(merge.includes('kept.concat(incoming)'), 'yeni satırlar eklenmeli');
  assert.ok(merge.includes("join('')"), 'anahtar ayracı alan değerlerinde bulunmayan U+001F olmalı');
  assert.ok(merge.includes('keepLocalFilters'), 'kullanıcının yerel filtreleri sıfırlanmamalı');
  const retry = sliceBetween('async function oabRetryFailedCombinations', 'async function oabMergeRetryRows');
  assert.ok(retry.includes('OABApi.batchStart({ combinations'), 'yalnız başarısız üçlüler istenmeli');
  assert.ok(retry.includes('await oabMergeRetryRows'), 'birleştirme tamamlanmadan durum yazılmamalı');
});

test('v7.23 yeniden deneme sonrası şerit "EKLENDİ" der, raporu küçültmüş gibi yazmaz', () => {
  const outcome = sliceBetween('function oabReportBatchOutcome', 'function oabBindFailureDetails');
  assert.ok(outcome.includes('options.merged'), 'yeniden deneme ayrı ifade edilmeli');
  assert.ok(outcome.includes('kombinasyon rapora eklendi'),
    '3 kombinasyonluk rapor ekranda dururken "1 kombinasyon birleştirildi" yazmak yanıltıcıydı');
  const retry = sliceBetween('async function oabRetryFailedCombinations', 'async function oabMergeRetryRows');
  assert.ok(retry.includes('oabReportBatchOutcome(finished, { merged: true })'));
});
